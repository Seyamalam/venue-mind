import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.js";
import { verifyOccupancyLedger } from "../src/domain/live-occupancy.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import { createWorker } from "../worker/index.ts";

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

const runbook = createEventDayRunbook({
  projectId: "project-alpha",
  plan: summitForwardPlan,
  validation: { validationId: "validation-occupancy-routes", inputFingerprint: "validation-input-occupancy-routes", status: "pass" },
  sourceLedgerHeadHash: "activity-ledger-occupancy-routes",
  approvalLedgerEntryId: "approval-occupancy-routes",
  frozenAt: "2026-09-12T10:00:00.000Z",
  frozenBy: "user-seyam",
});

async function harness() {
  const db = new SqliteD1();
  await applyDatabaseMigrations(db);
  await db.batch([
    db.prepare("INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("user-seyam", "test", "planner", "planner@example.test", "active", "2026-09-12T10:00:00.000Z", "2026-09-12T10:00:00.000Z"),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-alpha", "ALPHA", "alpha", "user-seyam", "2026-09-12T10:00:00.000Z", "2026-09-12T10:00:00.000Z"),
    db.prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("project-alpha", "org-alpha", "ALPHA", summitForwardPlan.id, "2026-09-12T10:00:00.000Z", "2026-09-12T10:00:00.000Z"),
    db.prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)").bind("project-alpha", 10, "{}", "2026-09-12T10:00:00.000Z"),
  ]);
  let now = "2026-09-12T11:00:00.000Z";
  const identities = { planner: ["user-seyam", ["planner"]], viewer: ["user-viewer", ["viewer"]] };
  const api = createWorker({
    clock: () => now,
    secureCookies: false,
    identityProvider: { authenticate: (request) => request.headers.get("x-test-identity") ? { provider: "test", subject: request.headers.get("x-test-identity"), email: `${request.headers.get("x-test-identity")}@example.test`, displayName: request.headers.get("x-test-identity").toUpperCase() } : null },
    createAccountRepository: () => ({
      resolveSession: async () => null,
      provision: async (identity) => ({ user: { id: identities[identity.subject][0], email: identity.email, displayName: identity.displayName, status: "active" }, organizations: [{ id: "org-alpha", name: "ALPHA", slug: "alpha", roles: identities[identity.subject][1] }] }),
      createSession: async (userId) => ({ id: `session-${userId}`, userId, createdAt: now, expiresAt: "2026-09-13T00:00:00.000Z", lastSeenAt: now, revokedAt: null }),
    }),
    createProjectRepository: () => ({
      list: async () => [],
      get: async (organizationId, projectId) => organizationId === "org-alpha" && projectId === "project-alpha" ? { id: projectId, organizationId, name: "ALPHA", revision: 1 } : null,
      put: async () => { throw new Error("unused"); },
    }),
  });
  const request = (path, { identity = "planner", method = "GET", body } = {}) => api.fetch(new Request(`https://example.test${path}`, { method, headers: { accept: "application/json", "x-test-identity": identity, "x-venuemind-organization-id": "org-alpha", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), { DB: db });
  return { db, request, setNow: (value) => { now = value; } };
}

test("durable occupancy routes create, ingest, acknowledge, refresh, reload, and export one auditable monitor", async (t) => {
  const { db, request, setNow } = await harness();
  t.after(() => db.close());
  const runbookResponse = await request("/api/projects/project-alpha/runbooks", { method: "POST", body: { runbook } });
  assert.equal(runbookResponse.status, 201);
  const collection = "/api/projects/project-alpha/occupancy-monitors";
  assert.equal((await request(collection, { identity: "viewer", method: "POST", body: { runbookVersionId: runbook.versionId } })).status, 403);
  const createdResponse = await request(collection, { method: "POST", body: { runbookVersionId: runbook.versionId } });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.monitor.runbookVersionId, runbook.versionId);
  assert.equal(created.projection.overallStatus, "unavailable");

  const item = `${collection}/${encodeURIComponent(created.monitor.id)}`;
  setNow("2026-09-12T12:00:05.000Z");
  const command = {
    type: "ingest_occupancy_signal",
    expectedRevision: 0,
    signal: { sourceId: "sensor-east", sourceType: "sensor", sourceVersion: "sensor-east-001", kind: "zone-occupancy", observedAt: "2026-09-12T12:00:00.000Z", confidence: "high", readings: [{ scopeId: "zone-keynote-floor", count: 420 }] },
    idempotencyKey: "route-ingest-001",
    operationId: "route-operation-001",
  };
  const applied = await (await request(`${item}/commands:sync`, { method: "POST", body: { commands: [command, command] } })).json();
  assert.deepEqual(applied.acknowledgements.map((value) => value.status), ["applied", "already-applied"]);
  assert.equal(applied.projection.overallStatus, "exceeded");
  const alert = applied.monitor.activeAlerts.find((candidate) => candidate.code === "CAPACITY_EXCEEDED");

  setNow("2026-09-12T12:00:10.000Z");
  const acknowledged = await (await request(`${item}/commands:sync`, { method: "POST", body: { commands: [{ type: "acknowledge_occupancy_alert", alertId: alert.id, reasonCode: "ops-team-dispatched", expectedRevision: 1, idempotencyKey: "route-ack-001", operationId: "route-operation-002" }] } })).json();
  assert.equal(acknowledged.monitor.activeAlerts[0].status, "acknowledged");
  assert.equal(verifyOccupancyLedger(acknowledged.monitor).status, "pass");

  setNow("2026-09-12T12:03:00.000Z");
  const refreshed = await (await request(`${item}/commands:sync`, { method: "POST", body: { commands: [{ type: "refresh_live_occupancy", expectedRevision: 2, idempotencyKey: "route-refresh-001", operationId: "route-operation-003" }] } })).json();
  assert.equal(refreshed.projection.overallStatus, "stale");
  const loaded = await (await request(item)).json();
  assert.equal(loaded.monitor.revision, 3);
  assert.equal(loaded.projection.overallStatus, "stale");
  const exported = await (await request(`${item}/export`)).json();
  assert.match(exported.artifact.filename, /\.audit\.json$/);
  assert.equal(JSON.parse(exported.artifact.content).integrity.status, "pass");
});
