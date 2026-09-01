import { DATABASE_MIGRATIONS, DATABASE_SCHEMA_VERSION } from "../db/generated-migrations.ts";

type D1Statement = { bind: (...values: unknown[]) => D1Statement; all: <T>() => Promise<{ results: T[] }>; run: () => Promise<unknown> };
type D1Database = { prepare: (sql: string) => D1Statement; batch: (statements: D1Statement[]) => Promise<unknown> };
type AppliedMigration = { version: number; name: string; checksum: string; applied_at: string; adopted: number };

const bootstrapSql = `CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  adopted INTEGER NOT NULL DEFAULT 0
)`;

const requiredLegacyTables = ["projects", "project_states"];
const lifecycleColumns = ["provenance_json", "archived_at", "deleted_at", "recovery_until", "pinned", "last_opened_at"];
const tenancyTables = ["users", "organizations", "organization_memberships", "organization_invitations", "user_sessions", "organization_audit_events", "account_deletion_requests"];
const concurrencyColumns = ["revision", "write_token"];
const collaborationTables = ["project_collaboration_events", "project_presence"];
const sharingTables = ["project_share_links", "notification_preferences", "notifications", "notification_email_outbox"];
const sharingDeliveryColumns = ["lifecycle_state", "creation_ledgered_at", "revocation_ledgered_at", "operation_attempts", "last_operation_error"];
const runbookTables = ["event_day_runbooks", "event_day_runbook_tasks", "event_day_runbook_transitions", "event_day_runbook_ledger", "event_day_runbook_receipts"];
const occupancyTables = ["live_occupancy_monitors"];

async function legacyBaseline(db: D1Database) {
  const { results: tableRows } = await db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all<{ name: string }>();
  const tables = new Set(tableRows.map((row) => String(row.name)));
  if (!tables.has("projects")) return 0;
  if (!requiredLegacyTables.every((table) => tables.has(table))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  const { results: columnRows } = await db.prepare("PRAGMA table_info(projects)").all<{ name: string }>();
  const columns = new Set(columnRows.map((row) => String(row.name)));
  const hasLifecycle = lifecycleColumns.every((column) => columns.has(column));
  if (!hasLifecycle && lifecycleColumns.some((column) => columns.has(column))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  const hasTenancy = columns.has("organization_id") && tenancyTables.every((table) => tables.has(table));
  if (!hasTenancy && (columns.has("organization_id") || tenancyTables.some((table) => tables.has(table)))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  const hasConcurrency = concurrencyColumns.every((column) => columns.has(column));
  if (!hasConcurrency && concurrencyColumns.some((column) => columns.has(column))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  const hasCollaboration = collaborationTables.every((table) => tables.has(table));
  if (!hasCollaboration && collaborationTables.some((table) => tables.has(table))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  const hasSharing = sharingTables.every((table) => tables.has(table));
  if (!hasSharing && sharingTables.some((table) => tables.has(table))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  let hasSharingDelivery = false;
  if (hasSharing) {
    const { results: shareColumnRows } = await db.prepare("PRAGMA table_info(project_share_links)").all<{ name: string }>();
    const shareColumns = new Set(shareColumnRows.map((row) => String(row.name)));
    hasSharingDelivery = sharingDeliveryColumns.every((column) => shareColumns.has(column));
    if (!hasSharingDelivery && sharingDeliveryColumns.some((column) => shareColumns.has(column))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  }
  const hasRunbooks = runbookTables.every((table) => tables.has(table));
  if (!hasRunbooks && runbookTables.some((table) => tables.has(table))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  const hasOccupancy = occupancyTables.every((table) => tables.has(table));
  if (!hasOccupancy && occupancyTables.some((table) => tables.has(table))) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  if (hasOccupancy && !hasRunbooks) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  if (hasRunbooks && !hasSharingDelivery) throw new Error("MIGRATION_LEGACY_SCHEMA_PARTIAL");
  return hasOccupancy ? 9 : hasRunbooks ? 8 : hasSharingDelivery ? 7 : hasSharing ? 6 : hasCollaboration ? 5 : hasConcurrency ? 4 : hasTenancy ? 3 : hasLifecycle ? 2 : 1;
}

export async function planDatabaseMigrations(db: D1Database, { clock = () => new Date().toISOString() } = {}) {
  const { results: tableRows } = await db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all<{ name: string }>();
  const tables = new Set(tableRows.map((row) => String(row.name)));
  let applied = tables.has("schema_migrations")
    ? (await db.prepare("SELECT version, name, checksum, applied_at, adopted FROM schema_migrations ORDER BY version").all<AppliedMigration>()).results
    : [];
  let adoptionRequired = false;
  if (!applied.length && tables.has("projects")) {
    const baseline = await legacyBaseline(db);
    if (baseline) {
      const adoptedAt = clock();
      applied = DATABASE_MIGRATIONS.slice(0, baseline).map((migration) => ({ version: migration.version, name: migration.name, checksum: migration.checksum, applied_at: adoptedAt, adopted: 1 }));
      adoptionRequired = true;
    }
  }
  const byVersion = new Map(applied.map((migration) => [Number(migration.version), migration]));
  for (const migration of applied) {
    const expected = DATABASE_MIGRATIONS.find((candidate) => candidate.version === Number(migration.version));
    if (!expected) throw new Error(`MIGRATION_UNKNOWN_VERSION:${migration.version}`);
    if (expected.name !== migration.name || expected.checksum !== migration.checksum) throw new Error(`MIGRATION_CHECKSUM_MISMATCH:${migration.version}`);
  }
  const pending = DATABASE_MIGRATIONS.filter((migration) => !byVersion.has(migration.version));
  const highest = applied.at(-1)?.version ?? 0;
  if (pending.some((migration, index) => migration.version !== highest + index + 1)) throw new Error("MIGRATION_SEQUENCE_INVALID");
  return { currentVersion: highest, targetVersion: DATABASE_SCHEMA_VERSION, adoptionRequired, applied: applied.map((migration) => ({ ...migration, version: Number(migration.version), adopted: Boolean(migration.adopted) })), pending };
}

export async function applyDatabaseMigrations(db: D1Database, { dryRun = false, clock = () => new Date().toISOString(), projectExport } = {}) {
  const report = await planDatabaseMigrations(db, { clock });
  if (dryRun) return { ...report, status: report.pending.length ? "pending" : "current", dryRun: true };
  await db.prepare(bootstrapSql).run();
  if (report.adoptionRequired) {
    await db.batch(report.applied.map((migration) => db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (?, ?, ?, ?, 1)").bind(migration.version, migration.name, migration.checksum, migration.applied_at)));
  }
  for (const migration of report.pending) {
    if ((migration.destructive || migration.requiresProjectExport) && typeof projectExport !== "function") throw new Error(`MIGRATION_PROJECT_EXPORT_REQUIRED:${migration.version}`);
    if (migration.destructive || migration.requiresProjectExport) await projectExport(migration);
    await db.batch([
      ...migration.statements.map((sql) => db.prepare(sql)),
      db.prepare("INSERT INTO schema_migrations (version, name, checksum, applied_at, adopted) VALUES (?, ?, ?, ?, 0)").bind(migration.version, migration.name, migration.checksum, clock()),
    ]);
  }
  return { ...(await planDatabaseMigrations(db, { clock })), status: "current", dryRun: false };
}

export async function inspectDatabaseIntegrity(db: D1Database) {
  const { results: integrityRows } = await db.prepare("PRAGMA integrity_check").all<Record<string, unknown>>();
  const integrity = integrityRows.flatMap((row) => Object.values(row).map(String));
  const checks = [];
  for (const [id, sql] of [
    ["project-state-without-project", "SELECT COUNT(*) AS count FROM project_states s LEFT JOIN projects p ON p.id = s.project_id WHERE p.id IS NULL"],
    ["project-without-state", "SELECT COUNT(*) AS count FROM projects p LEFT JOIN project_states s ON s.project_id = p.id WHERE s.project_id IS NULL"],
    ["project-without-organization", "SELECT COUNT(*) AS count FROM projects p LEFT JOIN organizations o ON o.id = p.organization_id WHERE p.organization_id IS NULL OR o.id IS NULL"],
    ["membership-without-user", "SELECT COUNT(*) AS count FROM organization_memberships m LEFT JOIN users u ON u.id = m.user_id WHERE u.id IS NULL"],
    ["membership-without-organization", "SELECT COUNT(*) AS count FROM organization_memberships m LEFT JOIN organizations o ON o.id = m.organization_id WHERE o.id IS NULL"],
    ["session-without-user", "SELECT COUNT(*) AS count FROM user_sessions s LEFT JOIN users u ON u.id = s.user_id WHERE u.id IS NULL"],
  ]) {
    const { results } = await db.prepare(sql).all<{ count: number }>();
    checks.push({ id, count: Number(results[0]?.count ?? 0), status: Number(results[0]?.count ?? 0) === 0 ? "pass" : "fail" });
  }
  for (const [id, sql] of [
    ["collaboration-event-without-project", "SELECT COUNT(*) AS count FROM project_collaboration_events e LEFT JOIN projects p ON p.id = e.project_id WHERE p.id IS NULL"],
    ["presence-without-project", "SELECT COUNT(*) AS count FROM project_presence r LEFT JOIN projects p ON p.id = r.project_id WHERE p.id IS NULL"],
    ["presence-without-user", "SELECT COUNT(*) AS count FROM project_presence r LEFT JOIN users u ON u.id = r.user_id WHERE u.id IS NULL"],
  ]) {
    const { results } = await db.prepare(sql).all<{ count: number }>();
    checks.push({ id, count: Number(results[0]?.count ?? 0), status: Number(results[0]?.count ?? 0) === 0 ? "pass" : "fail" });
  }
  for (const [id, sql] of [
    ["share-link-without-project", "SELECT COUNT(*) AS count FROM project_share_links l LEFT JOIN projects p ON p.id = l.project_id WHERE p.id IS NULL"],
    ["share-link-organization-mismatch", "SELECT COUNT(*) AS count FROM project_share_links l JOIN projects p ON p.id = l.project_id WHERE p.organization_id != l.organization_id"],
    ["share-link-creator-without-user", "SELECT COUNT(*) AS count FROM project_share_links l LEFT JOIN users u ON u.id = l.created_by WHERE u.id IS NULL"],
    ["share-link-revoker-without-user", "SELECT COUNT(*) AS count FROM project_share_links l LEFT JOIN users u ON u.id = l.revoked_by WHERE l.revoked_by IS NOT NULL AND u.id IS NULL"],
    ["notification-without-project", "SELECT COUNT(*) AS count FROM notifications n LEFT JOIN projects p ON p.id = n.project_id WHERE p.id IS NULL"],
    ["notification-organization-mismatch", "SELECT COUNT(*) AS count FROM notifications n JOIN projects p ON p.id = n.project_id WHERE p.organization_id != n.organization_id"],
    ["notification-without-user", "SELECT COUNT(*) AS count FROM notifications n LEFT JOIN users u ON u.id = n.user_id WHERE u.id IS NULL"],
    ["notification-preference-without-user", "SELECT COUNT(*) AS count FROM notification_preferences n LEFT JOIN users u ON u.id = n.user_id WHERE u.id IS NULL"],
    ["email-outbox-without-notification", "SELECT COUNT(*) AS count FROM notification_email_outbox e LEFT JOIN notifications n ON n.id = e.notification_id WHERE n.id IS NULL"],
    ["active-share-without-creation-ledger", "SELECT COUNT(*) AS count FROM project_share_links WHERE lifecycle_state='active' AND creation_ledgered_at IS NULL"],
    ["revoked-share-without-revocation-ledger", "SELECT COUNT(*) AS count FROM project_share_links WHERE lifecycle_state='revoked' AND revocation_ledgered_at IS NULL"],
    ["pending-revocation-without-actor", "SELECT COUNT(*) AS count FROM project_share_links WHERE lifecycle_state='pending-revoke' AND (revoked_at IS NULL OR revoked_by IS NULL)"],
    ["email-outbox-inconsistent-delivery", "SELECT COUNT(*) AS count FROM notification_email_outbox WHERE delivered_at IS NOT NULL AND (failure_code IS NOT NULL OR lease_token IS NOT NULL)"],
  ]) {
    const { results } = await db.prepare(sql).all<{ count: number }>();
    checks.push({ id, count: Number(results[0]?.count ?? 0), status: Number(results[0]?.count ?? 0) === 0 ? "pass" : "fail" });
  }
  return { status: integrity.every((value) => value === "ok") && checks.every((check) => check.status === "pass") ? "pass" : "fail", sqlite: integrity, checks };
}
