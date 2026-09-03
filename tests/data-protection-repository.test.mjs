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
  assert.equal((await repository.listBackupExpiryExpectations("org-alpha"))[0].status, "pending");
  setNow("2026-10-04T00:00:00.001Z");
  assert.equal((await repository.listBackupExpiryExpectations("org-alpha"))[0].status, "eligible");
  const backupEvidence = await repository.recordBackupExpiryEvidence("org-alpha", "user-admin", requested.id, "drill:local-2026-10-04");
  assert.equal(backupEvidence.status, "operator-evidence-recorded");
  assert.equal(backupEvidence.claim, "eligibility-and-operator-evidence-only");
  assert.match(backupEvidence.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(await repository.recordBackupExpiryEvidence("org-alpha", "user-admin", requested.id, "drill:local-2026-10-04"), backupEvidence);
  await assert.rejects(
    () => repository.recordBackupExpiryEvidence("org-alpha", "user-admin", requested.id, "drill:different"),
    /BACKUP_EXPIRY_EVIDENCE_CONFLICT/,
  );
});

test("retention sweep removes bounded old operational and security rows within each tenant", async (t) => {
  const { db, repository, setNow } = await harness(); t.after(() => db.close());
  await repository.setPolicy("org-alpha", "user-admin", { operationalSensitiveDays: 30, securityEvidenceDays: 90, projectRecoveryDays: 7 });
  const old = "2025-01-01T00:00:00.000Z";
  await db.batch([
    db.prepare("INSERT INTO event_day_runbooks (id,organization_id,project_id,schema_version,source_plan_id,source_plan_version,source_plan_fingerprint,source_activity_ledger_head_hash,definition_json,frozen_by,frozen_at,updated_at,sequence,ledger_head_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind("runbook-old", "org-alpha", "project-alpha", 1, "plan-alpha", "1", "fingerprint", "ledger-head", "{}", "user-admin", old, old, 0, "ledger-head"),
    db.prepare("INSERT INTO organization_audit_events (id,organization_id,event_type,actor_user_id,details_json,fingerprint,occurred_at) VALUES (?,?,?,?,?,?,?)").bind("audit-old", "org-alpha", "old.event", "user-admin", "{}", "old-fingerprint", old),
  ]);
  setNow("2026-09-03T00:00:00.000Z");
  const first = await repository.sweepRetention(1);
  assert.equal(first.exhausted, true);
  assert.equal(first.deleted.runbooks, 1);
  assert.equal(await db.prepare("SELECT id FROM event_day_runbooks WHERE id='runbook-old'").first(), null);
  assert.ok(await db.prepare("SELECT id FROM organization_audit_events WHERE id='audit-old'").first());
  const second = await repository.sweepRetention(10);
  assert.equal(second.deleted.securityAuditEvents, 1);
  assert.equal(await db.prepare("SELECT id FROM organization_audit_events WHERE id='audit-old'").first(), null);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM organization_audit_events WHERE event_type='retention.sweep_completed' AND organization_id='org-alpha'").first()).count, 2);
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM data_retention_purge_leases").first()).count, 0);
});

test("retention sweep purges due recoverable Projects under the same global batch bound", async (t) => {
  const { db, repository, setNow } = await harness(); t.after(() => db.close());
  await repository.setPolicy("org-alpha", "user-admin", { operationalSensitiveDays: 30, securityEvidenceDays: 90, projectRecoveryDays: 0 });
  const requested = await repository.requestProjectDeletion("org-alpha", "project-alpha", "user-admin", 1, "CUSTOMER_REQUEST");
  setNow("2026-09-03T00:00:00.001Z");
  const summary = await repository.sweepRetention(1);
  assert.equal(summary.exhausted, true);
  assert.equal(summary.deleted.projects, 1);
  assert.equal(await db.prepare("SELECT id FROM projects WHERE id='project-alpha'").first(), null);
  const evidence = await db.prepare("SELECT status,purged_by FROM project_deletion_requests WHERE id=?").bind(requested.id).first();
  assert.equal(evidence.status, "purged");
  assert.equal(evidence.purged_by, "system:data-retention");
});
