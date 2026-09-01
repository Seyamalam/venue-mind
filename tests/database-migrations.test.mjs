import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { DATABASE_MIGRATIONS, DATABASE_SCHEMA_VERSION } from "../db/generated-migrations.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { fingerprintPlan, verifyActivityLedger } from "../src/domain/activity-ledger.js";

const execute = promisify(execFile);
const root = path.resolve(new URL("../", import.meta.url).pathname);
const maintenance = path.join(root, "scripts/database-maintenance.mjs");
const fixtureManifest = JSON.parse(await readFile(new URL("./fixtures/database-migrations.json", import.meta.url), "utf8"));
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlite = (database, input) => new Promise((resolve, reject) => {
  const child = spawn("sqlite3", [database], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr)));
  child.stdin.end(input);
});
const cli = async (...args) => JSON.parse((await execute(process.execPath, [maintenance, ...args], { cwd: root })).stdout);

const snapshot = createVenuePlanner(summitForwardPlan).getSnapshot();
const expectedPlanFingerprint = fingerprintPlan(snapshot.plan);
const expectedLedgerHeadHash = verifyActivityLedger(snapshot.ledger).headHash;

async function createFixture(database, version, { tracked = true } = {}) {
  const migrations = DATABASE_MIGRATIONS.slice(0, version);
  const schema = [
    "PRAGMA foreign_keys=ON",
    ...(tracked ? ["CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0)"] : []),
    ...migrations.flatMap((migration) => [...migration.statements, ...(tracked ? [`INSERT INTO schema_migrations (version,name,checksum,applied_at,adopted) VALUES (${migration.version},${sqlString(migration.name)},${sqlString(migration.checksum)},'2026-08-28T00:00:00.000Z',0)`] : [])]),
  ];
  if (version >= 3) schema.push(
    "INSERT INTO users (id,identity_provider,provider_subject,email,display_name,status,created_at,updated_at) VALUES ('user-fixture','test','fixture','fixture@example.test','FIXTURE','active','2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z')",
    "INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES ('org-fixture','Fixture','fixture','user-fixture','2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z')",
    "INSERT INTO organization_memberships (organization_id,user_id,roles_json,status,created_at,updated_at) VALUES ('org-fixture','user-fixture','[\"organization-administrator\"]','active','2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z')",
  );
  const projectColumns = version >= 3 ? "id,organization_id,name,active_plan_id,created_at,updated_at" : "id,name,active_plan_id,created_at,updated_at";
  const projectValues = version >= 3 ? "'project-fixture','org-fixture','Fixture','plan-summit-forward-2026','2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z'" : "'project-fixture','Fixture','plan-summit-forward-2026','2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z'";
  schema.push(`INSERT INTO projects (${projectColumns}) VALUES (${projectValues})`);
  schema.push(`INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES ('project-fixture',10,${sqlString(JSON.stringify(snapshot))},'2026-08-28T00:00:00.000Z')`);
  await sqlite(database, `${schema.map((statement) => `${statement};`).join("\n")}\n`);
}

test("numbered migration fixtures from every released database version upgrade with stable fingerprints", async () => {
  assert.deepEqual(fixtureManifest.releasedDatabaseVersions, DATABASE_MIGRATIONS.map((migration) => migration.version));
  assert.equal(fixtureManifest.expectedCurrentVersion, DATABASE_SCHEMA_VERSION);
  assert.equal(DATABASE_MIGRATIONS.find((migration) => migration.version === 6).checksum, "b7271cddc304567f93e12c4177069a91187a2ab92a6ded865d5e625b8c05034d", "released migration 0006 is immutable");
  const directory = await mkdtemp(path.join(root, ".venuemind-migrations-"));
  try {
    for (const version of fixtureManifest.releasedDatabaseVersions) {
      const database = path.join(directory, `v${version}.sqlite3`);
      await createFixture(database, version);
      const dryRun = await cli("migrate", "--database", database, "--dry-run");
      assert.equal(dryRun.currentVersion, version);
      assert.equal(dryRun.targetVersion, DATABASE_SCHEMA_VERSION);
      const report = await cli("migrate", "--database", database);
      assert.equal(report.currentVersion, DATABASE_SCHEMA_VERSION);
      const verification = await cli("verify", "--database", database);
      assert.equal(verification.status, "pass", `fixture v${version}`);
      assert.equal(verification.projects[0].planFingerprint, expectedPlanFingerprint);
      assert.equal(verification.projects[0].ledgerHeadHash, expectedLedgerHeadHash);
      assert.equal(verification.projects[0].organizationId, version < 3 ? "org-legacy-migration" : "org-fixture");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("dry run adopts no metadata and an untracked legacy database upgrades explicitly", async () => {
  const directory = await mkdtemp(path.join(root, ".venuemind-legacy-adoption-"));
  try {
    const database = path.join(directory, "legacy-v2.sqlite3");
    await createFixture(database, 2, { tracked: false });
    const dryRun = await cli("migrate", "--database", database, "--dry-run");
    assert.equal(dryRun.currentVersion, 2);
    assert.equal(dryRun.adoptionRequired, true);
    assert.equal((await sqlite(database, "SELECT COUNT(*) FROM sqlite_schema WHERE type='table' AND name='schema_migrations';\n")).trim(), "0");
    const migrated = await cli("migrate", "--database", database);
    assert.equal(migrated.currentVersion, DATABASE_SCHEMA_VERSION);
    assert.equal(migrated.applied.filter((item) => item.adopted).length, 2);
    const verification = await cli("verify", "--database", database);
    assert.equal(verification.status, "pass");
    assert.equal(verification.projects[0].organizationId, "org-legacy-migration");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("released v6 sharing rows upgrade to recoverable v7 lifecycle state", async () => {
  const directory = await mkdtemp(path.join(root, ".venuemind-v6-sharing-upgrade-"));
  try {
    const database = path.join(directory, "v6.sqlite3");
    await createFixture(database, 6);
    await sqlite(database, `INSERT INTO project_share_links (id,organization_id,project_id,proposal_id,scope,token_hash,created_by,created_at,expires_at) VALUES ('share-active','org-fixture','project-fixture',NULL,'read-only','${"a".repeat(64)}','user-fixture','2026-08-28T00:00:00.000Z','2026-08-29T00:00:00.000Z'); INSERT INTO project_share_links (id,organization_id,project_id,proposal_id,scope,token_hash,created_by,created_at,expires_at,revoked_at,revoked_by) VALUES ('share-revoked','org-fixture','project-fixture',NULL,'read-only','${"b".repeat(64)}','user-fixture','2026-08-28T00:00:00.000Z','2026-08-29T00:00:00.000Z','2026-08-28T01:00:00.000Z','user-fixture');\n`);
    const report = await cli("migrate", "--database", database);
    assert.equal(report.currentVersion, DATABASE_SCHEMA_VERSION);
    const rows = JSON.parse(await sqlite(database, ".mode json\nSELECT id,lifecycle_state,creation_ledgered_at,revocation_ledgered_at FROM project_share_links ORDER BY id;\n"));
    assert.deepEqual(rows, [
      { id: "share-active", lifecycle_state: "active", creation_ledgered_at: "2026-08-28T00:00:00.000Z", revocation_ledgered_at: null },
      { id: "share-revoked", lifecycle_state: "pending-revoke", creation_ledgered_at: "2026-08-28T00:00:00.000Z", revocation_ledgered_at: null },
    ]);
    assert.equal((await cli("verify", "--database", database)).status, "pass");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("untracked complete event-day runbook schema adopts migration v8 without replaying tables", async () => {
  const directory = await mkdtemp(path.join(root, ".venuemind-runbook-adoption-"));
  try {
    const database = path.join(directory, "untracked-v8.sqlite3");
    await createFixture(database, 8, { tracked: false });
    const dryRun = await cli("migrate", "--database", database, "--dry-run");
    assert.equal(dryRun.currentVersion, 8);
    assert.equal(dryRun.adoptionRequired, true);
    assert.equal(dryRun.pending.length, 0);
    const migrated = await cli("migrate", "--database", database);
    assert.equal(migrated.currentVersion, DATABASE_SCHEMA_VERSION);
    assert.equal(migrated.applied.filter((item) => item.adopted).length, 8);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("backup and staged restore preserve Project and ledger fingerprints", async () => {
  const directory = await mkdtemp(path.join(root, ".venuemind-backup-"));
  try {
    const source = path.join(directory, "source.sqlite3");
    const backup = path.join(directory, "source.backup.sqlite3");
    const restored = path.join(directory, "restored.sqlite3");
    await createFixture(source, 1);
    await cli("migrate", "--database", source);
    const created = await cli("backup", "--database", source, "--output", backup);
    assert.equal(created.status, "created");
    const result = await cli("restore", "--backup", backup, "--database", restored);
    assert.equal(result.status, "restored");
    assert.equal(result.verification.status, "pass");
    assert.equal(result.verification.projects[0].planFingerprint, expectedPlanFingerprint);
    assert.equal(result.verification.projects[0].ledgerHeadHash, expectedLedgerHeadHash);
    await writeFile(backup, Buffer.concat([await readFile(backup), Buffer.from("tamper")]));
    await assert.rejects(() => cli("restore", "--backup", backup, "--database", path.join(directory, "tampered.sqlite3")), /BACKUP_CHECKSUM_MISMATCH/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("migration checksum drift and database orphans fail closed", async () => {
  const directory = await mkdtemp(path.join(root, ".venuemind-integrity-"));
  try {
    const checksumDatabase = path.join(directory, "checksum.sqlite3");
    await createFixture(checksumDatabase, 1);
    await sqlite(checksumDatabase, "UPDATE schema_migrations SET checksum='tampered' WHERE version=1;\n");
    await assert.rejects(() => cli("migrate", "--database", checksumDatabase, "--dry-run"), /MIGRATION_CHECKSUM_MISMATCH/);

    const orphanDatabase = path.join(directory, "orphan.sqlite3");
    await createFixture(orphanDatabase, 3);
    await sqlite(orphanDatabase, "DELETE FROM project_states WHERE project_id='project-fixture';\n");
    const verification = await cli("verify", "--database", orphanDatabase);
    assert.equal(verification.status, "fail");
    assert.equal(verification.orphanChecks.find((check) => check.id === "project-without-state").count, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("sharing schema rejects cross-tenant rows, raw tokens, and invalid scope records", async () => {
  const directory = await mkdtemp(path.join(root, ".venuemind-sharing-schema-"));
  try {
    const database = path.join(directory, "sharing.sqlite3");
    await createFixture(database, 7);
    await sqlite(database, "INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES ('org-other','Other','other','user-fixture','2026-08-28T00:00:00.000Z','2026-08-28T00:00:00.000Z');\n");
    const base = "'share-invalid','org-fixture','project-fixture',NULL,'read-only'";
    await assert.rejects(() => sqlite(database, `PRAGMA foreign_keys=ON; INSERT INTO project_share_links (id,organization_id,project_id,proposal_id,scope,token_hash,created_by,created_at,expires_at) VALUES (${base},'raw-token','user-fixture','2026-08-28T00:00:00.000Z','2026-08-29T00:00:00.000Z');\n`), /constraint|invalid/i);
    await assert.rejects(() => sqlite(database, `PRAGMA foreign_keys=ON; INSERT INTO project_share_links (id,organization_id,project_id,proposal_id,scope,token_hash,created_by,created_at,expires_at) VALUES ('share-scope','org-fixture','project-fixture','proposal-1','read-only','${"a".repeat(64)}','user-fixture','2026-08-28T00:00:00.000Z','2026-08-29T00:00:00.000Z');\n`), /constraint|invalid/i);
    await assert.rejects(() => sqlite(database, `PRAGMA foreign_keys=ON; INSERT INTO project_share_links (id,organization_id,project_id,proposal_id,scope,token_hash,created_by,created_at,expires_at) VALUES ('share-tenant','org-other','project-fixture',NULL,'read-only','${"b".repeat(64)}','user-fixture','2026-08-28T00:00:00.000Z','2026-08-29T00:00:00.000Z');\n`), /constraint|invalid/i);
    await sqlite(database, `PRAGMA foreign_keys=ON; INSERT INTO notifications (id,organization_id,project_id,user_id,event_type,body_code,subject_refs_json,created_at) VALUES ('notification-valid','org-fixture','project-fixture','user-fixture','review_requested','notification.review_requested','{"projectId":"project-fixture","proposalId":"proposal-1"}','2026-08-28T00:00:00.000Z'); INSERT INTO notification_email_outbox (id,notification_id,recipient_email,body_code,subject_refs_json,created_at) VALUES ('email-valid','notification-valid','fixture@example.test','notification.review_requested','{"projectId":"project-fixture","proposalId":"proposal-1"}','2026-08-28T00:00:00.000Z');\n`);
    await assert.rejects(() => sqlite(database, "UPDATE notifications SET organization_id='org-other' WHERE id='notification-valid';\n"), /organization|invalid/i);
    await assert.rejects(() => sqlite(database, "UPDATE notification_email_outbox SET body_code='unsafe-freeform' WHERE id='email-valid';\n"), /notification|invalid/i);
    await sqlite(database, `PRAGMA foreign_keys=OFF; DROP TRIGGER validate_share_link_insert; INSERT INTO project_share_links (id,organization_id,project_id,proposal_id,scope,token_hash,created_by,created_at,expires_at) VALUES ('share-corrupt','org-other','project-fixture',NULL,'read-only','${"c".repeat(64)}','user-fixture','2026-08-28T00:00:00.000Z','2026-08-29T00:00:00.000Z');\n`);
    const verification = await cli("verify", "--database", database);
    assert.equal(verification.status, "fail");
    assert.equal(verification.orphanChecks.find((check) => check.id === "share-link-organization-mismatch").count, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Project safety export is available before a future destructive migration", async () => {
  const directory = await mkdtemp(path.join(root, ".venuemind-project-export-"));
  try {
    const database = path.join(directory, "source.sqlite3");
    const output = path.join(directory, "projects");
    await createFixture(database, 3);
    const result = await cli("export-projects", "--database", database, "--output", output);
    assert.equal(result.status, "exported");
    assert.equal(result.files.length, 1);
    const exported = JSON.parse(await readFile(result.files[0].path, "utf8"));
    assert.equal(exported.project.id, "project-fixture");
    assert.equal(Object.hasOwn(exported.project, "organizationId"), false);
    assert.equal(exported.manifest.payloadSha256, result.files[0].payloadSha256);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
