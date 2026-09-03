#!/usr/bin/env node
import { createHash } from "node:crypto";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { DATABASE_MIGRATIONS, DATABASE_SCHEMA_VERSION } from "../db/generated-migrations.ts";
import { verifyActivityLedger, fingerprintPlan } from "../src/domain/activity-ledger.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { exportProjectPackage } from "../src/interchange/venue-package.ts";

const args = process.argv.slice(2);
const command = args.shift();
const option = (name) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : null; };
const has = (name) => args.includes(name);
const database = option("--database");
const sqlite = process.env.SQLITE3_BIN || "sqlite3";

const runSql = (databasePath, input, { json = false } = {}) => new Promise((resolve, reject) => {
  const child = spawn(sqlite, [...(json ? ["-json"] : []), databasePath], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `sqlite3 exited ${code}`)));
  child.stdin.end(input);
});
const query = async (databasePath, sql) => JSON.parse((await runSql(databasePath, `${sql};\n`, { json: true })).trim() || "[]");
const sqlString = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sha256File = async (filename) => createHash("sha256").update(await readFile(filename)).digest("hex");
const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);

async function migrationReport(databasePath) {
  const tables = new Set((await query(databasePath, "SELECT name FROM sqlite_schema WHERE type='table'")).map((row) => row.name));
  let applied = tables.has("schema_migrations") ? await query(databasePath, "SELECT version, name, checksum, applied_at, adopted FROM schema_migrations ORDER BY version") : [];
  let adoptionRequired = false;
  if (!applied.length && tables.has("projects")) {
      if (!tables.has("project_states")) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
      const columns = new Set((await query(databasePath, "PRAGMA table_info(projects)")).map((row) => row.name));
      const lifecycle = ["provenance_json", "archived_at", "deleted_at", "recovery_until", "pinned", "last_opened_at"];
      const tenancy = ["users", "organizations", "organization_memberships", "organization_invitations", "user_sessions", "organization_audit_events", "account_deletion_requests"];
      const concurrency = ["revision", "write_token"];
      const collaboration = ["project_collaboration_events", "project_presence"];
      const sharing = ["project_share_links", "notification_preferences", "notifications", "notification_email_outbox"];
      const hasLifecycle = lifecycle.every((column) => columns.has(column));
      if (!hasLifecycle && lifecycle.some((column) => columns.has(column))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
      const hasTenancy = columns.has("organization_id") && tenancy.every((table) => tables.has(table));
      if (!hasTenancy && (columns.has("organization_id") || tenancy.some((table) => tables.has(table)))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
      const hasConcurrency = concurrency.every((column) => columns.has(column));
      if (!hasConcurrency && concurrency.some((column) => columns.has(column))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
      const hasCollaboration = collaboration.every((table) => tables.has(table));
      if (!hasCollaboration && collaboration.some((table) => tables.has(table))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
      const hasSharing = sharing.every((table) => tables.has(table));
      if (!hasSharing && sharing.some((table) => tables.has(table))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
      let hasSharingDelivery = false;
      if (hasSharing) {
        const shareColumns = new Set((await query(databasePath, "PRAGMA table_info(project_share_links)")).map((row) => row.name));
        const required = ["lifecycle_state", "creation_ledgered_at", "revocation_ledgered_at", "operation_attempts", "last_operation_error"];
        hasSharingDelivery = required.every((column) => shareColumns.has(column));
        if (!hasSharingDelivery && required.some((column) => shareColumns.has(column))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
      }
      const runbooks = ["event_day_runbooks", "event_day_runbook_tasks", "event_day_runbook_transitions", "event_day_runbook_ledger", "event_day_runbook_receipts"];
      const hasRunbooks = runbooks.every((table) => tables.has(table));
      if (!hasRunbooks && runbooks.some((table) => tables.has(table))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
      if (hasRunbooks && !hasSharingDelivery) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
      const baseline = hasRunbooks ? 8 : hasSharingDelivery ? 7 : hasSharing ? 6 : hasCollaboration ? 5 : hasConcurrency ? 4 : hasTenancy ? 3 : hasLifecycle ? 2 : 1;
      applied = DATABASE_MIGRATIONS.slice(0, baseline).map((migration) => ({ version: migration.version, name: migration.name, checksum: migration.checksum, applied_at: null, adopted: 1 }));
      adoptionRequired = true;
  }
  for (const item of applied) {
    const expected = DATABASE_MIGRATIONS.find((migration) => migration.version === item.version);
    if (!expected || expected.name !== item.name || expected.checksum !== item.checksum) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${item.version}`);
  }
  const versions = new Set(applied.map((item) => item.version));
  const pending = DATABASE_MIGRATIONS.filter((migration) => !versions.has(migration.version));
  return { currentVersion: applied.at(-1)?.version ?? 0, targetVersion: DATABASE_SCHEMA_VERSION, adoptionRequired, applied, pending: pending.map(({ statements, ...migration }) => ({ ...migration, statementCount: statements.length })) };
}

async function verifyDatabase(databasePath) {
  const sqliteIntegrity = (await query(databasePath, "PRAGMA integrity_check")).flatMap((row) => Object.values(row).map(String));
  const tables = new Set((await query(databasePath, "SELECT name FROM sqlite_schema WHERE type = 'table'")).map((row) => row.name));
  const orphanChecks = [];
  if (tables.has("projects") && tables.has("project_states")) {
    for (const [id, sql] of [
      ["project-state-without-project", "SELECT COUNT(*) AS count FROM project_states s LEFT JOIN projects p ON p.id=s.project_id WHERE p.id IS NULL"],
      ["project-without-state", "SELECT COUNT(*) AS count FROM projects p LEFT JOIN project_states s ON s.project_id=p.id WHERE s.project_id IS NULL"],
    ]) {
      const count = Number((await query(databasePath, sql))[0]?.count ?? 0);
      orphanChecks.push({ id, count, status: count === 0 ? "pass" : "fail" });
    }
  }
  if (tables.has("organizations")) {
    for (const [id, sql] of [
      ["project-without-organization", "SELECT COUNT(*) AS count FROM projects p LEFT JOIN organizations o ON o.id=p.organization_id WHERE p.organization_id IS NULL OR o.id IS NULL"],
      ["membership-without-user", "SELECT COUNT(*) AS count FROM organization_memberships m LEFT JOIN users u ON u.id=m.user_id WHERE u.id IS NULL"],
      ["membership-without-organization", "SELECT COUNT(*) AS count FROM organization_memberships m LEFT JOIN organizations o ON o.id=m.organization_id WHERE o.id IS NULL"],
      ["session-without-user", "SELECT COUNT(*) AS count FROM user_sessions s LEFT JOIN users u ON u.id=s.user_id WHERE u.id IS NULL"],
    ]) {
      const count = Number((await query(databasePath, sql))[0]?.count ?? 0);
      orphanChecks.push({ id, count, status: count === 0 ? "pass" : "fail" });
    }
  }
  if (tables.has("project_collaboration_events") && tables.has("project_presence")) {
    for (const [id, sql] of [
      ["collaboration-event-without-project", "SELECT COUNT(*) AS count FROM project_collaboration_events e LEFT JOIN projects p ON p.id=e.project_id WHERE p.id IS NULL"],
      ["presence-without-project", "SELECT COUNT(*) AS count FROM project_presence r LEFT JOIN projects p ON p.id=r.project_id WHERE p.id IS NULL"],
      ["presence-without-user", "SELECT COUNT(*) AS count FROM project_presence r LEFT JOIN users u ON u.id=r.user_id WHERE u.id IS NULL"],
    ]) {
      const count = Number((await query(databasePath, sql))[0]?.count ?? 0);
      orphanChecks.push({ id, count, status: count === 0 ? "pass" : "fail" });
    }
  }
  if (["project_share_links", "notification_preferences", "notifications", "notification_email_outbox"].every((table) => tables.has(table))) {
    for (const [id, sql] of [
      ["share-link-without-project", "SELECT COUNT(*) AS count FROM project_share_links l LEFT JOIN projects p ON p.id=l.project_id WHERE p.id IS NULL"],
      ["share-link-organization-mismatch", "SELECT COUNT(*) AS count FROM project_share_links l JOIN projects p ON p.id=l.project_id WHERE p.organization_id != l.organization_id"],
      ["share-link-creator-without-user", "SELECT COUNT(*) AS count FROM project_share_links l LEFT JOIN users u ON u.id=l.created_by WHERE u.id IS NULL"],
      ["share-link-revoker-without-user", "SELECT COUNT(*) AS count FROM project_share_links l LEFT JOIN users u ON u.id=l.revoked_by WHERE l.revoked_by IS NOT NULL AND u.id IS NULL"],
      ["notification-without-project", "SELECT COUNT(*) AS count FROM notifications n LEFT JOIN projects p ON p.id=n.project_id WHERE p.id IS NULL"],
      ["notification-organization-mismatch", "SELECT COUNT(*) AS count FROM notifications n JOIN projects p ON p.id=n.project_id WHERE p.organization_id != n.organization_id"],
      ["notification-without-user", "SELECT COUNT(*) AS count FROM notifications n LEFT JOIN users u ON u.id=n.user_id WHERE u.id IS NULL"],
      ["notification-preference-without-user", "SELECT COUNT(*) AS count FROM notification_preferences n LEFT JOIN users u ON u.id=n.user_id WHERE u.id IS NULL"],
      ["email-outbox-without-notification", "SELECT COUNT(*) AS count FROM notification_email_outbox e LEFT JOIN notifications n ON n.id=e.notification_id WHERE n.id IS NULL"],
      ["active-share-without-creation-ledger", "SELECT COUNT(*) AS count FROM project_share_links WHERE lifecycle_state='active' AND creation_ledgered_at IS NULL"],
      ["revoked-share-without-revocation-ledger", "SELECT COUNT(*) AS count FROM project_share_links WHERE lifecycle_state='revoked' AND revocation_ledgered_at IS NULL"],
      ["pending-revocation-without-actor", "SELECT COUNT(*) AS count FROM project_share_links WHERE lifecycle_state='pending-revoke' AND (revoked_at IS NULL OR revoked_by IS NULL)"],
      ["email-outbox-inconsistent-delivery", "SELECT COUNT(*) AS count FROM notification_email_outbox WHERE delivered_at IS NOT NULL AND (failure_code IS NOT NULL OR lease_token IS NOT NULL)"],
    ]) {
      const count = Number((await query(databasePath, sql))[0]?.count ?? 0);
      orphanChecks.push({ id, count, status: count === 0 ? "pass" : "fail" });
    }
  }
  const rows = tables.has("project_states") ? await query(databasePath, "SELECT p.id, p.organization_id, s.schema_version, s.snapshot_json FROM projects p JOIN project_states s ON s.project_id=p.id ORDER BY p.id") : [];
  const projects = rows.map((row) => {
    try {
      const snapshot = JSON.parse(row.snapshot_json);
      const planner = createVenuePlanner(snapshot.plan?.id === summitForwardPlan.id ? summitForwardPlan : snapshot.plan);
      planner.execute({ type: "restore_snapshot", snapshot });
      const replay = planner.execute({ type: "replay_history" });
      const ledger = verifyActivityLedger(planner.getSnapshot().ledger);
      return { id: row.id, organizationId: row.organization_id ?? null, schemaVersion: Number(row.schema_version), planFingerprint: fingerprintPlan(planner.getSnapshot().plan), ledgerHeadHash: ledger.headHash, replayStatus: replay.status, status: ledger.status === "pass" && replay.status === "pass" ? "pass" : "fail" };
    } catch (error) { return { id: row.id, status: "fail", error: error instanceof Error ? error.message : String(error) }; }
  });
  const status = sqliteIntegrity.every((value) => value === "ok") && orphanChecks.every((check) => check.status === "pass") && projects.every((project) => project.status === "pass") ? "pass" : "fail";
  return { status, sqliteIntegrity, orphanChecks, projects };
}

async function exportProjects(databasePath, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const rows = await query(databasePath, `SELECT p.*, s.schema_version, s.snapshot_json FROM projects p JOIN project_states s ON s.project_id=p.id ORDER BY p.id`);
  const files = [];
  for (const row of rows) {
    const record = { id: row.id, organizationId: row.organization_id ?? "legacy-unassigned", name: row.name, activePlanId: row.active_plan_id, schemaVersion: Number(row.schema_version), snapshot: JSON.parse(row.snapshot_json), createdAt: row.created_at, updatedAt: row.updated_at, ...(row.provenance_json ? { provenance: JSON.parse(row.provenance_json) } : {}) };
    const exported = await exportProjectPackage(record);
    const directory = path.join(outputDirectory, record.organizationId);
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, exported.filename);
    await writeFile(target, exported.content);
    files.push({ projectId: record.id, organizationId: record.organizationId, path: target, payloadSha256: exported.package.manifest.payloadSha256 });
  }
  return files;
}

async function migrate(databasePath, dryRun, exportDirectory) {
  const report = await migrationReport(databasePath);
  if (dryRun) return { status: report.pending.length ? "pending" : "current", dryRun: true, ...report };
  await runSql(databasePath, `CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, adopted INTEGER NOT NULL DEFAULT 0);\n`);
  if (report.adoptionRequired) await runSql(databasePath, `${report.applied.map((migration) => `INSERT INTO schema_migrations (version,name,checksum,applied_at,adopted) VALUES (${migration.version},${sqlString(migration.name)},${sqlString(migration.checksum)},CURRENT_TIMESTAMP,1);`).join("\n")}\n`);
  const exportRequired = report.pending.some((item) => item.destructive || item.requiresProjectExport);
  const exports = exportRequired ? await exportProjects(databasePath, exportDirectory || `${databasePath}.pre-migration-projects`) : [];
  for (const pending of report.pending) {
    const migration = DATABASE_MIGRATIONS.find((item) => item.version === pending.version);
    const appliedAt = new Date().toISOString();
    await runSql(databasePath, `PRAGMA foreign_keys=ON;\nBEGIN IMMEDIATE;\n${migration.statements.map((statement) => `${statement};`).join("\n")}\nINSERT INTO schema_migrations (version,name,checksum,applied_at,adopted) VALUES (${migration.version},${sqlString(migration.name)},${sqlString(migration.checksum)},${sqlString(appliedAt)},0);\nCOMMIT;\n`);
  }
  return { status: "current", dryRun: false, ...(await migrationReport(databasePath)), exports };
}

async function backup(databasePath, output) {
  const verification = await verifyDatabase(databasePath);
  if (verification.status !== "pass") throw new Error("BACKUP_INTEGRITY_FAILED");
  await mkdir(path.dirname(output), { recursive: true });
  await runSql(databasePath, `.backup ${sqlString(output)}\n`);
  const manifest = { schemaVersion: 1, createdAt: new Date().toISOString(), databaseSchemaVersion: (await migrationReport(databasePath)).currentVersion, sha256: await sha256File(output), verification };
  await writeFile(`${output}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { status: "created", output, manifestPath: `${output}.manifest.json`, ...manifest };
}

async function restore(backupPath, databasePath) {
  const manifest = JSON.parse(await readFile(`${backupPath}.manifest.json`, "utf8"));
  if (await sha256File(backupPath) !== manifest.sha256) throw new Error("BACKUP_CHECKSUM_MISMATCH");
  const directory = await mkdtemp(path.join(tmpdir(), "venuemind-restore-"));
  const staged = path.join(directory, "restored.sqlite3");
  try {
    await runSql(staged, `.restore ${sqlString(backupPath)}\n`);
    const verification = await verifyDatabase(staged);
    if (verification.status !== "pass") throw new Error("RESTORE_INTEGRITY_FAILED");
    try {
      await access(databasePath);
      if (!has("--overwrite")) throw new Error("RESTORE_TARGET_EXISTS");
    } catch (error) {
      if (error instanceof Error && error.message === "RESTORE_TARGET_EXISTS") throw error;
      if (error?.code !== "ENOENT") throw error;
    }
    await mkdir(path.dirname(databasePath), { recursive: true });
    await writeFile(databasePath, await readFile(staged));
    return { status: "restored", database: databasePath, verification };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

if (!command || !database) throw new Error("Usage: database-maintenance.mjs <migrate|verify|backup|restore|export-projects> --database <path>");
if (command === "migrate") print(await migrate(database, has("--dry-run"), option("--project-export")));
else if (command === "verify") print(await verifyDatabase(database));
else if (command === "backup") print(await backup(database, option("--output") || `${database}.backup.sqlite3`));
else if (command === "restore") print(await restore(option("--backup"), database));
else if (command === "export-projects") print({ status: "exported", files: await exportProjects(database, option("--output") || `${database}.projects`) });
else throw new Error(`Unknown database command: ${command}`);
