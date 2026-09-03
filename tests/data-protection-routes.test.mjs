import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createWorker } from "../worker/index.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

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
    try { const out = []; for (const item of statements) out.push(await item.run()); this.database.exec("COMMIT"); return out; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  close() { this.database.close(); }
}

test("admin data-protection routes enforce exact bodies and return an immediate browser purge directive", async (t) => {
  const db = new SqliteD1(); t.after(() => db.close());
  const logs = [];
  let now = "2026-09-03T00:00:00.000Z";
  const api = createWorker({
    secureCookies: false,
    clock: () => now,
    log: (record) => logs.push(record),
    identityProvider: { authenticate: async () => ({ provider: "test", subject: "admin", email: "admin@example.test", displayName: "Admin" }) },
  });
  const env = { DB: db };
  const sessionResponse = await api.fetch(new Request("https://api.example.test/api/session"), env);
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json();
  const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
  const headers = { cookie, "x-venuemind-organization-id": session.activeOrganizationId, "content-type": "application/json" };
  const snapshot = createVenuePlanner(summitForwardPlan).getSnapshot();
  await db.batch([
    db.prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("project-alpha", session.activeOrganizationId, "Alpha", snapshot.plan.id, now, now),
    db.prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)").bind("project-alpha", 10, JSON.stringify(snapshot), now),
    db.prepare("INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("user-viewer", "test", "viewer", "viewer@example.test", "active", now, now),
    db.prepare("INSERT INTO organization_memberships (organization_id,user_id,roles_json,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)").bind(session.activeOrganizationId, "user-viewer", '["viewer"]', now, now),
  ]);

  const viewerApi = createWorker({
    secureCookies: false,
    clock: () => now,
    log: () => undefined,
    identityProvider: { authenticate: async () => ({ provider: "test", subject: "viewer", email: "viewer@example.test", displayName: "Viewer" }) },
  });
  const viewerPolicy = await viewerApi.fetch(new Request("https://api.example.test/api/data-protection/retention-policy", {
    headers: { "x-venuemind-organization-id": session.activeOrganizationId },
  }), env);
  assert.equal(viewerPolicy.status, 403);

  const policy = await api.fetch(new Request("https://api.example.test/api/data-protection/retention-policy", { headers }), env);
  assert.equal(policy.status, 200);
  assert.equal((await policy.json()).organizationId, session.activeOrganizationId);
  const extraField = await api.fetch(new Request("https://api.example.test/api/data-protection/retention-policy", {
    method: "PUT", headers, body: JSON.stringify({ operationalSensitiveDays: 90, securityEvidenceDays: 180, projectRecoveryDays: 7, updatedAt: now }),
  }), env);
  assert.equal(extraField.status, 400);
  const savedPolicy = await api.fetch(new Request("https://api.example.test/api/data-protection/retention-policy", {
    method: "PUT", headers, body: JSON.stringify({ operationalSensitiveDays: 90, securityEvidenceDays: 180, projectRecoveryDays: 7 }),
  }), env);
  assert.equal(savedPolicy.status, 200);
  const projectExport = await api.fetch(new Request("https://api.example.test/api/projects/project-alpha/export", { headers }), env);
  assert.equal(projectExport.status, 200);
  assert.equal((await projectExport.json()).serverStored, false);
  const accountExport = await api.fetch(new Request("https://api.example.test/api/account/export", { headers }), env);
  assert.equal(accountExport.status, 200);
  assert.equal((await accountExport.json()).dataProtection.serverStored, false);

  const deletion = await api.fetch(new Request("https://api.example.test/api/projects/project-alpha", {
    method: "DELETE", headers: { ...headers, "x-venuemind-expected-revision": "1" }, body: JSON.stringify({ reasonCode: "CUSTOMER_REQUEST" }),
  }), env);
  assert.equal(deletion.status, 202);
  assert.equal(deletion.headers.get("clear-site-data"), '"cache"');
  const evidence = await deletion.json();
  assert.equal(deletion.headers.get("x-venuemind-cache-directive"), evidence.cacheDirective.id);
  assert.equal((await api.fetch(new Request("https://api.example.test/api/projects/project-alpha", { headers }), env)).status, 404);
  const ack = await api.fetch(new Request("https://api.example.test/api/projects/project-alpha/deletion/cache-ack", {
    method: "POST", headers, body: JSON.stringify({ deletionRequestId: evidence.id, directiveId: evidence.cacheDirective.id }),
  }), env);
  assert.equal(ack.status, 200);
  now = "2026-09-11T00:00:00.000Z";
  const purge = await api.fetch(new Request("https://api.example.test/api/projects/project-alpha/deletion/purge", {
    method: "POST", headers, body: JSON.stringify({ deletionRequestId: evidence.id }),
  }), env);
  assert.equal(purge.status, 200);
  now = "2026-10-12T00:00:00.000Z";
  const expectations = await api.fetch(new Request("https://api.example.test/api/data-protection/backup-expiry", { headers }), env);
  assert.equal((await expectations.json()).expectations[0].status, "eligible");
  const verified = await api.fetch(new Request("https://api.example.test/api/data-protection/backup-expiry/verify", {
    method: "POST", headers, body: JSON.stringify({ deletionRequestId: evidence.id, evidenceRef: "drill:route-2026-10-12" }),
  }), env);
  assert.equal(verified.status, 200);
  assert.equal((await verified.json()).claim, "eligibility-and-operator-evidence-only");
  await db.prepare("INSERT INTO organization_audit_events (id,organization_id,event_type,actor_user_id,details_json,fingerprint,occurred_at) VALUES (?,?,?,?,?,?,?)")
    .bind("audit-scheduled-old", session.activeOrganizationId, "old.event", session.user.id, "{}", "old-fingerprint", "2025-01-01T00:00:00.000Z").run();
  await api.scheduled({}, env);
  assert.equal(await db.prepare("SELECT id FROM organization_audit_events WHERE id='audit-scheduled-old'").first(), null);
  assert.ok(logs.some((record) => record.event === "retention.sweep_completed"));
  assert.ok(logs.length >= 3);
  assert.doesNotMatch(JSON.stringify(logs), /admin@example|CUSTOMER_REQUEST/);
});
