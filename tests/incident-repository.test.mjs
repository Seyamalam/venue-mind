import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import { createD1IncidentRepository, IncidentRegisterConflict } from "../worker/incident-repository.ts";

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

const register = (overrides = {}) => ({
  schemaVersion: 1,
  id: "incident-register-alpha",
  projectId: "project-alpha",
  runbookVersionId: "runbook-alpha",
  source: { runbookLedgerHeadHash: "runbook-ledger-alpha" },
  baseline: { fingerprint: "incident-baseline-alpha", sourcePlanVersion: "3.3" },
  incidents: [],
  receipts: [],
  ledger: [],
  revision: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...overrides,
});

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

  await assert.rejects(
    () => repository.create("org-alpha", "project-alpha", register({ baseline: { fingerprint: "different-baseline" } })),
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

  const next = register({
    incidents: [{ id: "incident-001", severity: "high" }],
    ledger: [{ hash: "incident-ledger-bravo" }],
    revision: 1,
    updatedAt: "2026-09-12T12:01:00.000Z",
  });
  assert.deepEqual(await repository.put("org-alpha", "project-alpha", next, 0), next);
  assert.deepEqual(await repository.get("org-alpha", "project-alpha", next.id), next);

  await assert.rejects(
    () => repository.put("org-alpha", "project-alpha", { ...next, revision: 2, updatedAt: "2026-09-12T12:02:00.000Z" }, 0),
    (error) => error instanceof IncidentRegisterConflict && error.code === "INCIDENT_REGISTER_REVISION_CONFLICT" && error.details.currentRevision === 1,
  );
  await assert.rejects(
    () => repository.put("org-alpha", "project-alpha", { ...next, baseline: { fingerprint: "changed" }, revision: 2, updatedAt: "2026-09-12T12:02:00.000Z" }, 1),
    (error) => error instanceof IncidentRegisterConflict && error.code === "INCIDENT_REGISTER_BASELINE_IMMUTABLE",
  );
  assert.deepEqual(await repository.get("org-alpha", "project-alpha", next.id), next);
});
