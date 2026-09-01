import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createEventDayRunbook, transitionRunbookTask, verifyRunbookLedger } from "../src/domain/event-day-runbook.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import { createWorker } from "../worker/index.ts";

const NOW = "2026-09-01T10:00:00.000Z";

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

const browserRunbook = (overrides = {}) => ({
  schemaVersion: 1,
  id: "runbook-project-alpha-plan",
  versionId: "runbook-project-alpha-plan-v1",
  version: 1,
  source: {
    projectId: "project-alpha",
    planId: "plan-alpha",
    planVersion: "3.3",
    planFingerprint: "plan-alpha-fingerprint",
    validationId: "validation-alpha",
    validationInputFingerprint: "validation-alpha-fingerprint",
    sourceLedgerHeadHash: "activity-ledger-alpha-head",
  },
  baseline: { fingerprint: "baseline-alpha" },
  definitionFingerprint: "definition-alpha",
  status: "active",
  phases: [{ id: "phase-live", kind: "live-event", order: 0, startAt: NOW, endAt: "2026-09-01T12:00:00.000Z" }],
  tasks: [{
    id: "task-stage",
    key: "stage",
    phaseId: "phase-live",
    order: 0,
    code: "STAGE",
    workstream: "production",
    owner: { roleId: null, shiftId: null, staffPostObjectId: null, assigneeId: null },
    dependencyTaskIds: [],
    planObjectIds: [],
    requiredEvidenceCodes: ["STAGE_PHOTO"],
    required: true,
    status: "in-progress",
    revision: 1,
    evidence: [{ code: "LOCAL_ONLY", ref: "photo://optimistic" }],
  }],
  transitions: [{ id: "optimistic", sequence: 1 }],
  receipts: [{ id: "optimistic" }],
  ledger: [{ id: "optimistic" }],
  revision: 1,
  frozenAt: "2026-09-01T09:55:00.000Z",
  frozenBy: "forged-user",
  ...overrides,
});

const command = (overrides = {}) => ({
  type: "transition_runbook_task",
  runbookVersionId: "runbook-project-alpha-plan-v1",
  taskId: "task-stage",
  expectedTaskRevision: 0,
  toStatus: "in-progress",
  reasonCode: null,
  evidence: [],
  operationId: "operation-start",
  idempotencyKey: "idempotency-start",
  correlationId: "correlation-start",
  clientId: "tablet-ops",
  clientSequence: 1,
  clientOccurredAt: "2026-09-01T09:59:58.000Z",
  actorType: "agent",
  actorId: "forged-agent",
  source: "mcp",
  sessionId: "forged-session",
  ...overrides,
});

async function harness() {
  const db = new SqliteD1();
  await applyDatabaseMigrations(db);
  await db.batch([
    db.prepare("INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("user-seyam", "test", "seyam", "seyam@example.test", "active", NOW, NOW),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-alpha", "ALPHA", "alpha", "user-seyam", NOW, NOW),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-bravo", "BRAVO", "bravo", "user-seyam", NOW, NOW),
    db.prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("project-alpha", "org-alpha", "ALPHA", "plan-alpha", NOW, NOW),
    db.prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)").bind("project-alpha", 10, "{}", NOW),
  ]);
  const users = {
    planner: { id: "user-seyam", organization: { id: "org-alpha", name: "ALPHA", slug: "alpha", roles: ["planner"] } },
    viewer: { id: "user-viewer", organization: { id: "org-alpha", name: "ALPHA", slug: "alpha", roles: ["viewer"] } },
    outsider: { id: "user-outsider", organization: { id: "org-bravo", name: "BRAVO", slug: "bravo", roles: ["planner"] } },
  };
  const worker = createWorker({
    clock: () => NOW,
    secureCookies: false,
    identityProvider: { authenticate: (request) => {
      const identity = request.headers.get("x-test-identity");
      return identity && users[identity] ? { provider: "test", subject: identity, email: `${identity}@example.test`, displayName: identity.toUpperCase() } : null;
    } },
    createAccountRepository: () => ({
      resolveSession: async () => null,
      provision: async (identity) => {
        const fixture = users[identity.subject];
        return { user: { id: fixture.id, email: identity.email, displayName: identity.displayName, status: "active" }, organizations: [fixture.organization] };
      },
      createSession: async (userId) => ({ id: `session-${userId}`, userId, createdAt: NOW, expiresAt: "2026-09-01T22:00:00.000Z", lastSeenAt: NOW, revokedAt: null }),
    }),
    createProjectRepository: () => ({
      list: async () => [],
      get: async (organizationId, projectId) => organizationId === "org-alpha" && projectId === "project-alpha" ? { id: projectId, organizationId, name: "ALPHA", revision: 1 } : null,
      put: async () => { throw new Error("unused"); },
    }),
  });
  const request = (path, { identity, organizationId, method = "GET", body } = {}) => worker.fetch(new Request(`https://example.test${path}`, {
    method,
    headers: { accept: "application/json", ...(identity ? { "x-test-identity": identity } : {}), ...(organizationId ? { "x-venuemind-organization-id": organizationId } : {}), ...(body ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), { DB: db });
  return { db, request };
}

test("authenticated Runbook routes seed initial state, retry creation, and stay Organization scoped", async (t) => {
  const { db, request } = await harness();
  t.after(() => db.close());
  const collection = "/api/projects/project-alpha/runbooks";
  assert.equal((await request(collection, { method: "POST", body: browserRunbook() })).status, 401);
  assert.equal((await request(collection, { identity: "viewer", organizationId: "org-alpha", method: "POST", body: browserRunbook() })).status, 403);

  const createdResponse = await request(collection, { identity: "planner", organizationId: "org-alpha", method: "POST", body: { runbook: browserRunbook() } });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.status, "created");
  assert.equal(created.runbook.frozenBy, "user-seyam");
  assert.deepEqual({ status: created.runbook.tasks[0].status, revision: created.runbook.tasks[0].revision, evidence: created.runbook.tasks[0].evidence }, { status: "pending", revision: 0, evidence: [] });

  const retried = await request(collection, { identity: "planner", organizationId: "org-alpha", method: "POST", body: browserRunbook() });
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).status, "already-applied");
  const conflicting = await request(collection, { identity: "planner", organizationId: "org-alpha", method: "POST", body: browserRunbook({ definitionFingerprint: "different" }) });
  assert.equal(conflicting.status, 409);
  assert.equal((await conflicting.json()).code, "RUNBOOK_ID_CONFLICT");

  const item = "/api/projects/project-alpha/runbooks/runbook-project-alpha-plan-v1";
  assert.equal((await request(item, { identity: "outsider", organizationId: "org-bravo" })).status, 404);
  const loaded = await (await request(item, { identity: "planner", organizationId: "org-alpha" })).json();
  assert.equal(loaded.runbook.versionId, "runbook-project-alpha-plan-v1");
});

test("transition sync returns per-command outcomes and authoritative browser Runbook state", async (t) => {
  const { db, request } = await harness();
  t.after(() => db.close());
  const created = await (await request("/api/projects/project-alpha/runbooks", { identity: "planner", organizationId: "org-alpha", method: "POST", body: browserRunbook() })).json();
  const syncPath = "/api/projects/project-alpha/runbooks/runbook-project-alpha-plan-v1/transitions:sync";
  const response = await request(syncPath, { identity: "planner", organizationId: "org-alpha", method: "POST", body: { commands: [
    command(),
    command(),
    command({ operationId: "operation-stale", idempotencyKey: "idempotency-stale", clientSequence: 2, toStatus: "blocked" }),
    command({ operationId: "operation-no-evidence", idempotencyKey: "idempotency-no-evidence", clientSequence: 3, expectedTaskRevision: 1, toStatus: "completed" }),
  ] } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.acknowledgements.map((item) => item.status), ["applied", "already-applied", "conflict", "rejected"]);
  assert.equal(result.acknowledgements[2].code, "RUNBOOK_TASK_REVISION_CONFLICT");
  assert.equal(result.acknowledgements[3].code, "RUNBOOK_EVIDENCE_REQUIRED");
  assert.deepEqual({ status: result.runbook.tasks[0].status, revision: result.runbook.tasks[0].revision }, { status: "in-progress", revision: 1 });
  assert.deepEqual({ actorType: result.runbook.ledger[0].actorType, actorId: result.runbook.ledger[0].actorId, source: result.runbook.ledger[0].source, sessionId: result.runbook.ledger[0].sessionId }, { actorType: "human", actorId: "user-seyam", source: "studio", sessionId: "session-user-seyam" });
  assert.deepEqual({ clientId: result.runbook.transitions[0].clientId, clientSequence: result.runbook.transitions[0].clientSequence, clientOccurredAt: result.runbook.transitions[0].clientOccurredAt }, { clientId: "tablet-ops", clientSequence: 1, clientOccurredAt: "2026-09-01T09:59:58.000Z" });
  const domainReceipt = transitionRunbookTask(created.runbook, { ...command(), actorType: "human", actorId: "user-seyam", source: "studio", sessionId: "session-user-seyam" }, { committedAt: NOW }).receipt;
  assert.equal(result.runbook.receipts[0].inputFingerprint, domainReceipt.inputFingerprint);
  assert.deepEqual(verifyRunbookLedger(result.runbook), { status: "pass", entries: 1, headHash: result.runbook.ledger[0].hash });

  const blockedResponse = await request(syncPath, { identity: "planner", organizationId: "org-alpha", method: "POST", body: { commands: [
    command({ operationId: "operation-blocked", idempotencyKey: "idempotency-blocked", clientSequence: 2, expectedTaskRevision: 1, toStatus: "blocked", reasonCode: "safety-hold" }),
  ] } });
  const blocked = await blockedResponse.json();
  assert.equal(blocked.acknowledgements[0].status, "applied");
  assert.equal(blocked.runbook.transitions[1].reasonCode, "safety-hold");
  assert.equal(blocked.runbook.ledger[1].details.reasonCode, "safety-hold");
  assert.deepEqual(verifyRunbookLedger(blocked.runbook), { status: "pass", entries: 2, headHash: blocked.runbook.ledger[1].hash });
});

test("a complete seeded event synchronizes once and exact retries create no duplicate transitions", async (t) => {
  const { db, request } = await harness();
  t.after(() => db.close());
  let local = createEventDayRunbook({
    projectId: "project-alpha",
    plan: summitForwardPlan,
    validation: { validationId: "validation-seeded-event", inputFingerprint: "validation-seeded-event-input", status: "pass" },
    sourceLedgerHeadHash: "activity-ledger-seeded-event-head",
    approvalLedgerEntryId: "activity-ledger-seeded-event-approval",
    frozenAt: "2026-09-01T09:55:00.000Z",
    frozenBy: "user-seyam",
  });
  const commands = [];
  let clientSequence = 0;
  for (const task of local.tasks) {
    const start = {
      type: "transition_runbook_task",
      runbookVersionId: local.versionId,
      taskId: task.id,
      expectedTaskRevision: 0,
      fromStatus: "pending",
      toStatus: "in-progress",
      evidence: [],
      operationId: `operation-${task.key}-start`,
      idempotencyKey: `idempotency-${task.key}-start`,
      correlationId: `correlation-${task.key}-start`,
      clientId: "tablet-seeded-event",
      clientSequence: ++clientSequence,
      clientOccurredAt: `2026-09-01T10:${String(clientSequence).padStart(2, "0")}:00.000Z`,
      actorType: "human",
      actorId: "user-seyam",
      source: "studio",
      sessionId: "session-user-seyam",
    };
    local = transitionRunbookTask(local, start, { committedAt: start.clientOccurredAt }).runbook;
    commands.push(start);
    const current = local.tasks.find((candidate) => candidate.id === task.id);
    const complete = {
      ...start,
      expectedTaskRevision: current.revision,
      fromStatus: "in-progress",
      toStatus: "completed",
      evidence: current.requiredEvidenceCodes.map((code) => ({ code, ref: `evidence://${task.id}/${code}` })),
      operationId: `operation-${task.key}-complete`,
      idempotencyKey: `idempotency-${task.key}-complete`,
      correlationId: `correlation-${task.key}-complete`,
      clientSequence: ++clientSequence,
      clientOccurredAt: `2026-09-01T10:${String(clientSequence).padStart(2, "0")}:00.000Z`,
    };
    local = transitionRunbookTask(local, complete, { committedAt: complete.clientOccurredAt }).runbook;
    commands.push(complete);
  }

  const collection = "/api/projects/project-alpha/runbooks";
  const created = await request(collection, { identity: "planner", organizationId: "org-alpha", method: "POST", body: { runbook: local } });
  assert.equal(created.status, 201);
  const syncPath = `${collection}/${encodeURIComponent(local.versionId)}/transitions:sync`;
  const first = await (await request(syncPath, { identity: "planner", organizationId: "org-alpha", method: "POST", body: { commands } })).json();
  assert.equal(first.acknowledgements.length, 18);
  assert.ok(first.acknowledgements.every((item) => item.status === "applied"));
  assert.ok(first.runbook.tasks.every((task) => task.status === "completed" && task.revision === 2));
  assert.equal(first.runbook.transitions.length, 18);
  assert.equal(first.runbook.receipts.length, 18);
  assert.deepEqual(verifyRunbookLedger(first.runbook), { status: "pass", entries: 18, headHash: first.runbook.ledger.at(-1).hash });

  const retry = await (await request(syncPath, { identity: "planner", organizationId: "org-alpha", method: "POST", body: { commands } })).json();
  assert.ok(retry.acknowledgements.every((item) => item.status === "already-applied"));
  assert.equal(retry.runbook.transitions.length, 18);
  assert.equal(retry.runbook.receipts.length, 18);
  assert.equal(retry.runbook.ledger.length, 18);
});
