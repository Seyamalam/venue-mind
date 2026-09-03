import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import { createD1DataProtectionRepository, PROJECT_CASCADE_TABLES } from "../worker/data-protection-repository.ts";

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
      const values = [];
      for (const statement of statements) values.push(await statement.run());
      this.database.exec("COMMIT");
      return values;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  close() { this.database.close(); }
}

const INITIAL = "2026-09-03T00:00:00.000Z";
async function harness() {
  const db = new SqliteD1();
  await applyDatabaseMigrations(db);
  await db.batch([
    db.prepare("INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("user-admin", "test", "admin", "admin@example.test", "active", INITIAL, INITIAL),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-alpha", "Alpha", "alpha", "user-admin", INITIAL, INITIAL),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-bravo", "Bravo", "bravo", "user-admin", INITIAL, INITIAL),
    db.prepare("INSERT INTO organization_memberships (organization_id,user_id,roles_json,status,created_at,updated_at) VALUES (?,?,?,'active',?,?)").bind("org-alpha", "user-admin", '["organization-administrator"]', INITIAL, INITIAL),
    db.prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("project-alpha", "org-alpha", "Alpha", "plan-alpha", INITIAL, INITIAL),
    db.prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)").bind("project-alpha", 10, '{"plan":{"id":"plan-alpha"}}', INITIAL),
    db.prepare("INSERT INTO project_share_links (id,organization_id,project_id,scope,token_hash,created_by,created_at,expires_at,lifecycle_state,creation_ledgered_at) VALUES (?,?,?,?,?,?,?,?,?,?)").bind("share-alpha", "org-alpha", "project-alpha", "read-only", "a".repeat(64), "user-admin", INITIAL, "2026-09-04T00:00:00.000Z", "active", INITIAL),
    db.prepare("INSERT INTO notifications (id,organization_id,project_id,user_id,event_type,body_code,subject_refs_json,created_at) VALUES (?,?,?,?,?,?,?,?)").bind("notification-alpha", "org-alpha", "project-alpha", "user-admin", "review_requested", "notification.review_requested", '{"projectId":"project-alpha"}', INITIAL),
    db.prepare("INSERT INTO notification_email_outbox (id,notification_id,recipient_email,body_code,subject_refs_json,created_at) VALUES (?,?,?,?,?,?)").bind("outbox-alpha", "notification-alpha", "admin@example.test", "notification.review_requested", '{"projectId":"project-alpha"}', INITIAL),
  ]);
  let now = INITIAL;
  return { db, setNow: (value) => { now = value; }, repository: createD1DataProtectionRepository(db, { clock: () => now }) };
}

test("retention policies are tenant-scoped, server-timestamped, and audited", async (t) => {
  const { db, repository } = await harness(); t.after(() => db.close());
  assert.equal((await repository.getPolicy("org-alpha", "user-admin")).projectRecoveryDays, 30);
  const saved = await repository.setPolicy("org-alpha", "user-admin", { operationalSensitiveDays: 90, securityEvidenceDays: 180, projectRecoveryDays: 2 });
  assert.equal(saved.updatedAt, INITIAL);
  assert.deepEqual(await repository.getPolicy("org-alpha", "user-admin"), saved);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM organization_audit_events WHERE organization_id=? AND event_type='retention.policy_updated'").bind("org-alpha").first()).count, 1);
  assert.equal(await db.prepare("SELECT * FROM organization_retention_policies WHERE organization_id=?").bind("org-bravo").first(), null);
});

test("Project deletion is recoverable, cache acknowledgement is idempotent, and revisions are guarded", async (t) => {
  const { db, repository, setNow } = await harness(); t.after(() => db.close());
  await repository.setPolicy("org-alpha", "user-admin", { operationalSensitiveDays: 90, securityEvidenceDays: 180, projectRecoveryDays: 2 });
  const requested = await repository.requestProjectDeletion("org-alpha", "project-alpha", "user-admin", 1, "CUSTOMER_REQUEST");
  assert.equal(requested.projectRevision, 2);
  assert.equal(requested.recoveryUntil, "2026-09-05T00:00:00.000Z");
  assert.deepEqual(requested.deletionTargets.find((target) => target.store === "backup"), {
    store: "backup", action: "expire", dueAt: "2026-10-05T00:00:00.000Z", verification: "backup-window-expired",
  });
  const acknowledged = await repository.acknowledgeBrowserCacheDeletion("org-alpha", "project-alpha", "user-admin", requested.id, requested.cacheDirective.id);
  assert.equal(acknowledged.cacheDirective.acknowledgedAt, INITIAL);
  assert.deepEqual(await repository.acknowledgeBrowserCacheDeletion("org-alpha", "project-alpha", "user-admin", requested.id, requested.cacheDirective.id), acknowledged);
  setNow("2026-09-04T00:00:00.000Z");
  assert.equal((await repository.recoverProject("org-alpha", "project-alpha", "user-admin", requested.id)).status, "recovered");
  assert.equal((await db.prepare("SELECT revision FROM projects WHERE id='project-alpha'").first()).revision, 3);
});

test("on-demand exports omit secret and delivery credentials and create no export storage", async (t) => {
  const { db, repository } = await harness(); t.after(() => db.close());
  const project = await repository.exportProject("org-alpha", "project-alpha", "user-admin");
  await assert.rejects(() => repository.exportProject("org-bravo", "project-alpha", "user-admin"), /PROJECT_NOT_FOUND/);
  assert.doesNotMatch(JSON.stringify(project), /admin@example\.test|a{64}/);
  assert.equal(project.serverStored, false);
  assert.ok(project.manifest.secretColumnsExcluded.includes("project_share_links.token_hash"));
  assert.ok(project.manifest.secretColumnsExcluded.includes("project_presence.session_id"));
  const account = await repository.exportAccount("user-admin", ["org-alpha"]);
  assert.equal(account.serverStored, false);
  assert.equal(account.data.user_sessions.length, 0);
  assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name LIKE '%export%'").first(), null);
});

test("purge removes every Project aggregate through FKs and preserves auditable evidence", async (t) => {
  const { db, repository, setNow } = await harness(); t.after(() => db.close());
  await repository.setPolicy("org-alpha", "user-admin", { operationalSensitiveDays: 90, securityEvidenceDays: 180, projectRecoveryDays: 0 });
  const requested = await repository.requestProjectDeletion("org-alpha", "project-alpha", "user-admin", 1, "CUSTOMER_REQUEST");
  setNow("2026-09-03T00:00:00.001Z");
  const purged = await repository.purgeProject("org-alpha", "project-alpha", "user-admin", requested.id);
  assert.equal(purged.status, "purged");
  assert.equal(Object.keys(purged.purgeVerification).length, PROJECT_CASCADE_TABLES.length + 1);
  assert.ok(Object.values(purged.purgeVerification).every((count) => count === 0));
  assert.equal(await db.prepare("SELECT * FROM projects WHERE id='project-alpha'").first(), null);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM project_deletion_requests WHERE id=?").bind(requested.id).first()).count, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM organization_audit_events WHERE event_type='project.deletion_purged'").first()).count, 1);
});
