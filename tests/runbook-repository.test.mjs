import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import {
  createD1RunbookRepository,
  RunbookIdempotencyConflict,
  RunbookTransitionConflict,
} from "../worker/runbook-repository.ts";

const NOW = "2026-09-01T10:00:00.000Z";

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

const runbookInput = {
  id: "runbook-fixture",
  schemaVersion: 1,
  sourcePlanId: "plan-fixture",
  sourcePlanVersion: "3.3",
  sourcePlanFingerprint: "plan-11111111",
  sourceValidationId: "validation-fixture",
  sourceValidationFingerprint: "validation-input-22222222",
  sourceActivityLedgerHeadHash: "ledger-33333333",
  frozenBy: "user-owner",
  frozenAt: NOW,
  definition: {
    phases: [
      { id: "phase-setup", kind: "setup", label: "SETUP" },
      { id: "phase-doors", kind: "doors", label: "DOORS" },
    ],
  },
  tasks: [
    { id: "task-stage", phaseId: "phase-setup", ownerRole: "production", status: "pending", definition: { label: "STAGE READY", dependencyIds: [] } },
    { id: "task-doors", phaseId: "phase-doors", ownerRole: null, status: "pending", definition: { label: "DOORS OPEN", dependencyIds: ["task-stage"] } },
  ],
};

async function harness() {
  const db = new SqliteD1();
  await applyDatabaseMigrations(db);
  await db.batch([
    db.prepare("INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("user-owner", "test", "owner", "owner@example.test", "active", NOW, NOW),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-alpha", "ALPHA", "alpha", "user-owner", NOW, NOW),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-bravo", "BRAVO", "bravo", "user-owner", NOW, NOW),
    db.prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("project-alpha", "org-alpha", "ALPHA", "plan-fixture", NOW, NOW),
    db.prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)").bind("project-alpha", 10, "{}", NOW),
  ]);
  return { db, repository: createD1RunbookRepository(db, { clock: () => NOW }) };
}

const transition = (overrides = {}) => ({
  id: "transition-stage-started",
  taskId: "task-stage",
  expectedTaskRevision: 0,
  fromStatus: "pending",
  toStatus: "in-progress",
  actorType: "human",
  actorId: "user-owner",
  source: "studio",
  sessionId: "session-owner",
  reasonCode: "operator-started",
  clientId: "device-a",
  clientSequence: 1,
  clientOccurredAt: "2026-09-01T09:59:58.000Z",
  evidence: [
    { code: "stage-check", ref: "photo://stage-ready" },
    { code: "access-check", ref: "checklist://accessible-route" },
    { code: "stage-check", ref: "photo://stage-ready" },
  ],
  idempotencyKey: "offline-stage-started",
  correlationId: "corr-stage-started",
  ...overrides,
});

test("Runbook repository creates and reads one frozen tenant-scoped baseline", async (t) => {
  const { db, repository } = await harness();
  t.after(() => db.close());

  const created = await repository.createRunbook("org-alpha", "project-alpha", runbookInput);
  assert.equal(created.id, "runbook-fixture");
  assert.equal(created.sourcePlanVersion, "3.3");
  assert.equal(created.sequence, 0);
  assert.equal(created.ledgerHeadHash, "ledger-33333333");
  assert.equal(created.tasks.find((task) => task.id === "task-doors").ownerRole, null);
  assert.deepEqual(created.tasks.map(({ id, status, taskRevision }) => ({ id, status, taskRevision })), [
    { id: "task-doors", status: "pending", taskRevision: 0 },
    { id: "task-stage", status: "pending", taskRevision: 0 },
  ]);
  assert.equal(await repository.getRunbook("org-bravo", "project-alpha", "runbook-fixture"), null);
  assert.deepEqual(await repository.createRunbook("org-alpha", "project-alpha", structuredClone(runbookInput)), created);
  await assert.rejects(
    () => repository.createRunbook("org-alpha", "project-alpha", { ...runbookInput, sourcePlanFingerprint: "plan-different" }),
    (error) => error.code === "RUNBOOK_ID_CONFLICT",
  );
  await assert.rejects(
    () => repository.createRunbook("org-bravo", "project-alpha", { ...runbookInput, id: "runbook-forged" }),
    (error) => error.code === "RUNBOOK_PROJECT_SCOPE_INVALID",
  );
});

test("Runbook transition batches atomically persist projections, receipts, and a hash-chained ledger", async (t) => {
  const { db, repository } = await harness();
  t.after(() => db.close());
  await repository.createRunbook("org-alpha", "project-alpha", runbookInput);

  const commands = [
    transition(),
    transition({ id: "transition-doors-ready", taskId: "task-doors", toStatus: "ready", clientSequence: 2, idempotencyKey: "offline-doors-ready", correlationId: "corr-doors-ready" }),
  ];
  const applied = await repository.applyTransitionBatch("org-alpha", "project-alpha", "runbook-fixture", commands);
  assert.deepEqual(applied.results.map((item) => item.status), ["applied", "applied"]);
  assert.deepEqual(applied.results.map((item) => item.runbookSequence), [1, 2]);
  assert.deepEqual(applied.runbook.tasks.map(({ id, status, taskRevision }) => ({ id, status, taskRevision })), [
    { id: "task-doors", status: "ready", taskRevision: 1 },
    { id: "task-stage", status: "in-progress", taskRevision: 1 },
  ]);
  assert.equal(applied.runbook.transitions.length, 2);
  assert.equal(applied.runbook.receipts.length, 2);
  assert.equal(applied.runbook.ledger.length, 2);
  assert.equal(applied.runbook.ledger[0].previousHash, "ledger-33333333");
  assert.deepEqual(applied.runbook.transitions[0].evidence, [
    { code: "access-check", ref: "checklist://accessible-route" },
    { code: "stage-check", ref: "photo://stage-ready" },
  ]);
  assert.equal(applied.runbook.ledger[1].previousHash, applied.runbook.ledger[0].hash);
  assert.equal(applied.runbook.ledgerHeadHash, applied.runbook.ledger[1].hash);
  assert.deepEqual({
    reasonCode: applied.runbook.transitions[0].reasonCode,
    clientId: applied.runbook.transitions[0].clientId,
    clientSequence: applied.runbook.transitions[0].clientSequence,
    clientOccurredAt: applied.runbook.transitions[0].clientOccurredAt,
  }, {
    reasonCode: "operator-started",
    clientId: "device-a",
    clientSequence: 1,
    clientOccurredAt: "2026-09-01T09:59:58.000Z",
  });
  assert.equal(applied.runbook.ledger[0].details.reasonCode, "operator-started");
  assert.equal(applied.runbook.ledger[0].details.clientSequence, 1);

  const creationRetryAfterTransitions = await repository.createRunbook("org-alpha", "project-alpha", structuredClone(runbookInput));
  assert.equal(creationRetryAfterTransitions.sequence, 2);
  assert.equal(creationRetryAfterTransitions.tasks.find((task) => task.id === "task-stage").status, "in-progress");

  const retried = await repository.applyTransitionBatch("org-alpha", "project-alpha", "runbook-fixture", commands);
  assert.deepEqual(retried.results, applied.results);
  const rotatedSessionRetry = await repository.applyTransitionBatch("org-alpha", "project-alpha", "runbook-fixture", [{ ...commands[0], sessionId: "session-rotated" }]);
  assert.deepEqual(rotatedSessionRetry.results, [applied.results[0]]);
  assert.equal(retried.runbook.transitions.length, 2);
  assert.equal(retried.runbook.receipts.length, 2);
  assert.equal(retried.runbook.ledger.length, 2);
});

test("Runbook transition batches accept ordered transitions for the same task", async (t) => {
  const { db, repository } = await harness();
  t.after(() => db.close());
  await repository.createRunbook("org-alpha", "project-alpha", runbookInput);

  const applied = await repository.applyTransitionBatch("org-alpha", "project-alpha", "runbook-fixture", [
    transition(),
    transition({ id: "transition-stage-completed", expectedTaskRevision: 1, fromStatus: "in-progress", toStatus: "completed", clientSequence: 2, idempotencyKey: "offline-stage-completed", correlationId: "corr-stage-completed" }),
  ]);
  assert.equal(applied.runbook.tasks.find((task) => task.id === "task-stage").status, "completed");
  assert.equal(applied.runbook.tasks.find((task) => task.id === "task-stage").taskRevision, 2);
  assert.deepEqual(applied.results.map((item) => item.runbookSequence), [1, 2]);
});

test("Runbook idempotency conflicts and stale batches leave every durable surface unchanged", async (t) => {
  const { db, repository } = await harness();
  t.after(() => db.close());
  await repository.createRunbook("org-alpha", "project-alpha", runbookInput);
  await repository.applyTransitionBatch("org-alpha", "project-alpha", "runbook-fixture", [transition()]);

  await assert.rejects(
    () => repository.applyTransitionBatch("org-alpha", "project-alpha", "runbook-fixture", [transition({ toStatus: "blocked" })]),
    (error) => error instanceof RunbookIdempotencyConflict && error.code === "RUNBOOK_IDEMPOTENCY_CONFLICT",
  );
  const before = await repository.getRunbook("org-alpha", "project-alpha", "runbook-fixture");

  await assert.rejects(
    () => repository.applyTransitionBatch("org-alpha", "project-alpha", "runbook-fixture", [
      transition({ id: "transition-doors-ready", taskId: "task-doors", toStatus: "ready", clientSequence: 2, idempotencyKey: "offline-doors-ready" }),
      transition({ id: "transition-stage-stale", expectedTaskRevision: 0, fromStatus: "pending", toStatus: "completed", clientSequence: 3, idempotencyKey: "offline-stage-stale" }),
    ]),
    (error) => error instanceof RunbookTransitionConflict && error.code === "RUNBOOK_TASK_REVISION_CONFLICT",
  );

  const after = await repository.getRunbook("org-alpha", "project-alpha", "runbook-fixture");
  assert.deepEqual(after, before);
  const counts = await db.prepare("SELECT (SELECT COUNT(*) FROM event_day_runbook_transitions) AS transitions, (SELECT COUNT(*) FROM event_day_runbook_receipts) AS receipts, (SELECT COUNT(*) FROM event_day_runbook_ledger) AS ledger").first();
  assert.deepEqual({ ...counts }, { transitions: 1, receipts: 1, ledger: 1 });
});
