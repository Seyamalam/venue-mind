import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import { createD1DeviationRepository, DeviationRegisterConflict } from "../worker/deviation-repository.ts";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import {
  createLivePlanDeviationRegister,
  recordLivePlanDeviation,
} from "../src/domain/live-plan-deviations.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const NOW = "2026-09-12T12:00:00.000Z";

class SqliteStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) {
    return new SqliteStatement(this.database, this.sql, values);
  }
  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }
  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }
  async run() {
    return this.database.prepare(this.sql).run(...this.values);
  }
}
class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys=ON");
  }
  prepare(sql) {
    return new SqliteStatement(this.database, sql);
  }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.database.close();
  }
}

const runbook = createEventDayRunbook({
  projectId: "project-alpha",
  plan: summitForwardPlan,
  validation: { validationId: "validation-deviations", inputFingerprint: "validation-input-deviations", status: "pass" },
  sourceLedgerHeadHash: "activity-ledger-deviations",
  approvalLedgerEntryId: "approval-deviations",
  frozenAt: "2026-09-12T10:00:00.000Z",
  frozenBy: "user-owner",
});
const register = () =>
  createLivePlanDeviationRegister({
    type: "create_deviation_register",
    projectId: "project-alpha",
    runbook,
    createdAt: NOW,
    createdBy: "user-owner",
  });
const advance = (current) =>
  recordLivePlanDeviation(
    current,
    {
      type: "record_live_plan_deviation",
      deviationId: "deviation-exit",
      disposition: "temporary",
      reasonCode: "LIVE_EGRESS_CONTROL",
      location: { kind: "plan-object", planObjectId: "obj-fire-exit-east" },
      affectedObjectIds: ["obj-fire-exit-east"],
      availableConstraintIds: ["constraint-emergency-readiness"],
      change: {
        id: "change-live-exit",
        targetObjectIds: ["obj-fire-exit-east"],
        spatialEffects: [
          {
            operation: "update_metadata",
            objectId: "obj-fire-exit-east",
            values: { label: "East exit — controlled" },
          },
        ],
      },
      idempotencyKey: "record-live-exit",
      expectedRevision: 0,
      actorType: "human",
      actorId: "user-owner",
      source: "studio",
      sessionId: "session-owner",
    },
    { committedAt: "2026-09-12T12:01:00.000Z" },
  ).register;

async function harness() {
  const db = new SqliteD1();
  await applyDatabaseMigrations(db);
  await db.batch([
    db
      .prepare("INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind("user-owner", "test", "owner", "owner@example.test", "active", NOW, NOW),
    db
      .prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind("org-alpha", "ALPHA", "alpha", "user-owner", NOW, NOW),
    db
      .prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind("org-bravo", "BRAVO", "bravo", "user-owner", NOW, NOW),
    db
      .prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind("project-alpha", "org-alpha", "ALPHA", summitForwardPlan.id, NOW, NOW),
    db
      .prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)")
      .bind("project-alpha", 10, "{}", NOW),
    db
      .prepare(
        "INSERT INTO event_day_runbooks (id,organization_id,project_id,schema_version,source_plan_id,source_plan_version,source_plan_fingerprint,source_activity_ledger_head_hash,definition_json,frozen_by,frozen_at,updated_at,sequence,ledger_head_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        runbook.versionId,
        "org-alpha",
        "project-alpha",
        1,
        runbook.source.planId,
        String(runbook.source.planVersion),
        runbook.source.planFingerprint,
        runbook.source.sourceLedgerHeadHash,
        "{}",
        "user-owner",
        NOW,
        NOW,
        0,
        runbook.source.sourceLedgerHeadHash,
      ),
  ]);
  return { db, repository: createD1DeviationRepository(db) };
}

test("Deviation repository persists one immutable Runbook baseline inside its tenant", async (t) => {
  const { db, repository } = await harness();
  t.after(() => db.close());
  const created = await repository.create("org-alpha", "project-alpha", register());
  assert.deepEqual(await repository.get("org-alpha", "project-alpha", created.id), created);
  assert.deepEqual(await repository.getByRunbook("org-alpha", "project-alpha", runbook.versionId), created);
  assert.equal(await repository.get("org-bravo", "project-alpha", created.id), null);
  assert.deepEqual(await repository.create("org-alpha", "project-alpha", structuredClone(created)), created);
  await assert.rejects(
    () => repository.create("org-alpha", "project-alpha", { ...created, projectId: "project-bravo" }),
    (error) => error instanceof DeviationRegisterConflict && error.code === "DEVIATION_REGISTER_SCOPE_INVALID",
  );
});

test("Deviation repository advances exactly one revision and rejects stale or baseline-changing writes", async (t) => {
  const { db, repository } = await harness();
  t.after(() => db.close());
  const initial = register();
  await repository.create("org-alpha", "project-alpha", initial);
  const next = advance(initial);
  assert.deepEqual(await repository.put("org-alpha", "project-alpha", next, 0), next);
  assert.deepEqual(await repository.get("org-alpha", "project-alpha", next.id), next);
  await assert.rejects(
    () => repository.put("org-alpha", "project-alpha", next, 0),
    (error) =>
      error instanceof DeviationRegisterConflict &&
      error.code === "DEVIATION_REGISTER_REVISION_CONFLICT" &&
      error.details.currentRevision === 1,
  );
  const changedBaseline = structuredClone(next);
  changedBaseline.baseline.acceptedPlan.version = "forged";
  changedBaseline.revision = 2;
  changedBaseline.updatedAt = "2026-09-12T12:02:00.000Z";
  await assert.rejects(
    () => repository.put("org-alpha", "project-alpha", changedBaseline, 1),
    (error) => error instanceof DeviationRegisterConflict && error.code === "DEVIATION_REGISTER_BASELINE_IMMUTABLE",
  );
  assert.deepEqual(await repository.get("org-alpha", "project-alpha", next.id), next);
});

test("Deviation repository reads fail closed when ledger or row evidence is corrupted", async (t) => {
  const { db, repository } = await harness();
  t.after(() => db.close());
  const next = advance(register());
  await repository.create("org-alpha", "project-alpha", register());
  await repository.put("org-alpha", "project-alpha", next, 0);

  const forged = structuredClone(next);
  forged.deviations[0].reasonCode = "ALTERED";
  db.database.exec("DROP TRIGGER validate_event_day_deviation_register_update");
  await db
    .prepare("UPDATE event_day_deviation_registers SET register_json=? WHERE id=?")
    .bind(JSON.stringify(forged), forged.id)
    .run();
  await assert.rejects(
    () => repository.get("org-alpha", "project-alpha", forged.id),
    (error) => error instanceof DeviationRegisterConflict && error.code === "DEVIATION_REGISTER_INTEGRITY_FAILED",
  );
});
