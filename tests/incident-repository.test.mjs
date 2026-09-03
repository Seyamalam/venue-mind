import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import { createD1IncidentRepository, IncidentRegisterConflict } from "../worker/incident-repository.ts";
import { stableFingerprint } from "../src/domain/activity-ledger.ts";
import { reportIncident } from "../src/domain/incidents.ts";

const NOW = "2026-09-12T12:00:00.000Z";

class SqliteStatement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new SqliteStatement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { return this.database.prepare(this.sql).run(...this.values); }
}

class SqliteD1 {
  constructor() { this.database = new DatabaseSync(":memory:"); this.database.exec("PRAGMA foreign_keys=ON"); }
  prepare(sql) { return new SqliteStatement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  close() { this.database.close(); }
}

const register = (overrides = {}) => {
  const source = {
    runbookVersionId: "runbook-alpha",
    runbookLedgerHeadHash: "runbook-ledger-alpha",
    planId: "plan-alpha",
    planVersion: "3.3",
    planFingerprint: "plan-alpha-fingerprint",
  };
  const acceptedPlan = {
    id: "plan-alpha",
    version: "3.3",
    objects: [{ id: "object-alpha" }],
    spatial: { roomBoundary: { outer: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], holes: [] } },
  };
  const baseline = { acceptedPlan, emergencyPlan: null, runbookTaskIds: [] };
  baseline.fingerprint = stableFingerprint("incident-baseline", { source, acceptedPlan, emergencyPlan: null, runbookTaskIds: [] });
  return {
    schemaVersion: 1,
    id: "incident-register-alpha",
    projectId: "project-alpha",
    runbookVersionId: "runbook-alpha",
    source,
    baseline,
    incidents: [],
    transitions: [],
    receipts: [],
    ledger: [],
    revision: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
};

const advance = (current) => reportIncident(current, {
  incidentId: "incident-001",
  severity: "high",
  category: "facilities",
  summaryCode: "FACILITY_BLOCKED",
  location: { kind: "plan-object", planObjectId: "object-alpha" },
  relatedRefs: [],
  idempotencyKey: "incident-report-001",
  actorType: "human",
  actorId: "user-owner",
  source: "studio",
  sessionId: "session-alpha",
}, { committedAt: "2026-09-12T12:01:00.000Z" }).register;

async function harness() {
  const db = new SqliteD1();
  await applyDatabaseMigrations(db);
  await db.batch([
    db.prepare("INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("user-owner", "test", "owner", "owner@example.test", "active", NOW, NOW),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-alpha", "ALPHA", "alpha", "user-owner", NOW, NOW),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-bravo", "BRAVO", "bravo", "user-owner", NOW, NOW),
    db.prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("project-alpha", "org-alpha", "ALPHA", "plan-alpha", NOW, NOW),
    db.prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)").bind("project-alpha", 10, "{}", NOW),
    db.prepare("INSERT INTO event_day_runbooks (id,organization_id,project_id,schema_version,source_plan_id,source_plan_version,source_plan_fingerprint,source_activity_ledger_head_hash,definition_json,frozen_by,frozen_at,updated_at,sequence,ledger_head_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind("runbook-alpha", "org-alpha", "project-alpha", 1, "plan-alpha", "3.3", "plan-alpha-fingerprint", "activity-ledger-alpha", "{}", "user-owner", NOW, NOW, 0, "activity-ledger-alpha"),
  ]);
  return { db, repository: createD1IncidentRepository(db) };
}

test("Incident Register repository persists one immutable Runbook baseline and tenant-scoped aggregate", async (t) => {
  const { db, repository } = await harness();
  t.after(() => db.close());

  const created = await repository.create("org-alpha", "project-alpha", register());
  assert.deepEqual(await repository.get("org-alpha", "project-alpha", created.id), created);
  assert.deepEqual(await repository.getByRunbook("org-alpha", "project-alpha", "runbook-alpha"), created);
  assert.equal(await repository.get("org-bravo", "project-alpha", created.id), null);
  assert.deepEqual(await repository.create("org-alpha", "project-alpha", structuredClone(created)), created);

  const conflicting = structuredClone(register());
  conflicting.baseline.acceptedPlan.version = "3.4";
  conflicting.baseline.fingerprint = stableFingerprint("incident-baseline", {
    source: conflicting.source,
    acceptedPlan: conflicting.baseline.acceptedPlan,
    emergencyPlan: null,
    runbookTaskIds: [],
  });
  await assert.rejects(
    () => repository.create("org-alpha", "project-alpha", conflicting),
    (error) => error instanceof IncidentRegisterConflict && error.code === "INCIDENT_REGISTER_ID_CONFLICT",
  );
  await assert.rejects(
    () => repository.create("org-alpha", "project-alpha", register({ id: "incident-register-forged", projectId: "project-bravo" })),
    (error) => error instanceof IncidentRegisterConflict && error.code === "INCIDENT_REGISTER_SCOPE_INVALID",
  );
});

test("Incident Register writes advance exactly one revision and reject stale or baseline-changing updates", async (t) => {
  const { db, repository } = await harness();
  t.after(() => db.close());
  await repository.create("org-alpha", "project-alpha", register());

  const next = advance(register());
  assert.deepEqual(await repository.put("org-alpha", "project-alpha", next, 0), next);
  assert.deepEqual(await repository.get("org-alpha", "project-alpha", next.id), next);

  await assert.rejects(
    () => repository.put("org-alpha", "project-alpha", next, 0),
    (error) => error instanceof IncidentRegisterConflict && error.code === "INCIDENT_REGISTER_REVISION_CONFLICT" && error.details.currentRevision === 1,
  );
  await assert.rejects(
    () => repository.put("org-alpha", "project-alpha", { ...next, baseline: { fingerprint: "changed" }, revision: 2, updatedAt: "2026-09-12T12:02:00.000Z" }, 1),
    (error) => error instanceof IncidentRegisterConflict && error.code === "INCIDENT_REGISTER_BASELINE_IMMUTABLE",
  );
  await assert.rejects(
    () => repository.put("org-alpha", "project-alpha", { ...next, source: { runbookLedgerHeadHash: "forged" }, revision: 2, updatedAt: "2026-09-12T12:02:00.000Z" }, 1),
    (error) => error instanceof IncidentRegisterConflict && error.code === "INCIDENT_REGISTER_BASELINE_IMMUTABLE",
  );
  assert.deepEqual(await repository.get("org-alpha", "project-alpha", next.id), next);

  const forged = structuredClone(next);
  forged.baseline.sourcePlanVersion = "forged";
  db.database.exec("DROP TRIGGER validate_event_day_incident_register_update");
  await db.prepare("UPDATE event_day_incident_registers SET register_json=? WHERE id=?").bind(JSON.stringify(forged), next.id).run();
  await assert.rejects(
    () => repository.get("org-alpha", "project-alpha", next.id),
    (error) => error instanceof IncidentRegisterConflict && error.code === "INCIDENT_REGISTER_BASELINE_IMMUTABLE",
  );
});

test("Incident Register reads fail closed when row metadata, source, or ledger evidence is corrupted", async (t) => {
  const { db, repository } = await harness();
  t.after(() => db.close());
  const next = advance(register());
  await repository.create("org-alpha", "project-alpha", register());
  await repository.put("org-alpha", "project-alpha", next, 0);

  const forged = structuredClone(next);
  forged.source.approvalLedgerEntryId = "forged";
  forged.revision = 2;
  forged.updatedAt = "2026-09-12T12:02:00.000Z";
  await db.prepare("UPDATE event_day_incident_registers SET register_json=?,revision=?,updated_at=? WHERE id=?")
    .bind(JSON.stringify(forged), forged.revision, forged.updatedAt, forged.id).run();

  await assert.rejects(
    () => repository.get("org-alpha", "project-alpha", forged.id),
    (error) => error instanceof IncidentRegisterConflict && error.code === "INCIDENT_REGISTER_INTEGRITY_FAILED",
  );
});
