import { applyDatabaseMigrations } from "./database-migrations.ts";
import {
  DEFAULT_RETENTION_RULES,
  createOrganizationRetentionPolicy,
  projectDeletionTargets,
} from "../src/security/data-protection.ts";
import type { OrganizationRetentionPolicy } from "../src/security/data-protection.ts";
import type { DeletionTarget } from "../src/security/data-protection.ts";

const initializedDatabases = new WeakSet<object>();
const PROJECT_CASCADE_TABLES = Object.freeze([
  "project_states",
  "project_collaboration_events",
  "project_presence",
  "project_share_links",
  "notifications",
  "event_day_runbooks",
  "event_day_runbook_tasks",
  "event_day_runbook_transitions",
  "event_day_runbook_ledger",
  "event_day_runbook_receipts",
  "live_occupancy_monitors",
  "event_day_incident_registers",
  "event_day_deviation_registers",
] as const);

type Row = Record<string, unknown>;

export class DataProtectionConflict extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, string | number | boolean | null>>;

  constructor(code: string, details: Readonly<Record<string, string | number | boolean | null>> = {}) {
    super(code);
    this.name = "DataProtectionConflict";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export interface ProjectDeletionEvidence {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly status: "recoverable" | "recovered" | "purged";
  readonly reasonCode: string;
  readonly requestedBy: string;
  readonly requestedAt: string;
  readonly recoveryUntil: string;
  readonly deletionTargets: readonly DeletionTarget[];
  readonly cacheDirective: {
    readonly id: string;
    readonly action: "delete-project-cache";
    readonly issuedAt: string;
    readonly acknowledgedAt: string | null;
    readonly acknowledgedBy: string | null;
  };
  readonly recoveredAt: string | null;
  readonly recoveredBy: string | null;
  readonly purgedAt: string | null;
  readonly purgedBy: string | null;
  readonly purgeVerification: Readonly<Record<string, number>> | null;
  readonly evidenceFingerprint: string;
}

const ensureSchema = async (db: D1Database): Promise<void> => {
  if (initializedDatabases.has(db)) return;
  await applyDatabaseMigrations(db);
  initializedDatabases.add(db);
};

const sha256 = async (value: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const isRecord = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
const parseObject = (value: unknown, field: string): Row => {
  if (typeof value !== "string") throw new TypeError(`${field} must be JSON text`);
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new TypeError(`${field} must be a JSON object`);
  return parsed;
};
const nullableText = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value !== "string") throw new TypeError("Stored optional text is invalid");
  return value;
};
const jsonColumn = (row: Row, key: string): unknown => {
  const value = row[key];
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new DataProtectionConflict("EXPORT_STORED_JSON_INVALID", { column: key });
  }
};
const mapRows = (
  rows: readonly Row[],
  jsonColumns: readonly string[] = [],
  excludedColumns: readonly string[] = [],
): readonly Row[] =>
  rows.map((row) =>
    Object.freeze(
      Object.fromEntries(
        Object.entries(row)
          .filter(([key]) => !excludedColumns.includes(key))
          .map(([key, value]) => [key, jsonColumns.includes(key) ? jsonColumn(row, key) : value]),
      ),
    ),
  );
const all = async (db: D1Database, sql: string, ...bindings: unknown[]): Promise<Row[]> =>
  (await db.prepare(sql).bind(...bindings).all<Row>()).results;

const mapPolicy = (row: Row): OrganizationRetentionPolicy =>
  createOrganizationRetentionPolicy({
    organizationId: String(row.organization_id),
    operationalSensitiveDays: Number(row.operational_sensitive_days),
    securityEvidenceDays: Number(row.security_evidence_days),
    projectRecoveryDays: Number(row.project_recovery_days),
    updatedAt: String(row.updated_at),
    updatedBy: String(row.updated_by),
  });

const mapDeletion = (row: Row): ProjectDeletionEvidence => {
  const verification = row.purge_verification_json == null ? null : parseObject(row.purge_verification_json, "Purge verification");
  const numericVerification: Readonly<Record<string, number>> | null = verification
    ? Object.freeze(Object.fromEntries(Object.entries(verification).map(([key, value]) => {
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
          throw new TypeError("Stored purge verification is invalid");
        return [key, value];
      })))
    : null;
  const status = String(row.status);
  if (status !== "recoverable" && status !== "recovered" && status !== "purged")
    throw new TypeError("Stored Project deletion status is invalid");
  const requestedAt = String(row.requested_at);
  const recoveryUntil = String(row.recovery_until);
  const backupDueAt = new Date(Date.parse(recoveryUntil) + 30 * 24 * 60 * 60 * 1_000).toISOString();
  return Object.freeze({
    schemaVersion: 1,
    id: String(row.id),
    organizationId: String(row.organization_id),
    projectId: String(row.project_id),
    projectRevision: Number(row.project_revision),
    status,
    reasonCode: String(row.reason_code),
    requestedBy: String(row.requested_by),
    requestedAt,
    recoveryUntil,
    deletionTargets: Object.freeze([
      Object.freeze({ store: "d1-primary", action: "expire", dueAt: recoveryUntil, verification: "project-cascade-absent" }),
      Object.freeze({ store: "browser-cache", action: "purge-now", dueAt: requestedAt, verification: "project-cache-absent" }),
      Object.freeze({ store: "on-demand-export", action: "user-managed", dueAt: null, verification: "export-not-server-stored" }),
      Object.freeze({ store: "backup", action: "expire", dueAt: backupDueAt, verification: "backup-window-expired" }),
    ] satisfies DeletionTarget[]),
    cacheDirective: Object.freeze({
      id: String(row.cache_directive_id),
      action: "delete-project-cache" as const,
      issuedAt: requestedAt,
      acknowledgedAt: nullableText(row.cache_acknowledged_at),
      acknowledgedBy: nullableText(row.cache_acknowledged_by),
    }),
    recoveredAt: nullableText(row.recovered_at),
    recoveredBy: nullableText(row.recovered_by),
    purgedAt: nullableText(row.purged_at),
    purgedBy: nullableText(row.purged_by),
    purgeVerification: numericVerification,
    evidenceFingerprint: String(row.evidence_fingerprint),
  });
};

const audit = async (
  db: D1Database,
  organizationId: string,
  actorUserId: string,
  eventType: string,
  occurredAt: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): Promise<void> => {
  const id = `audit-${crypto.randomUUID()}`;
  const fingerprint = await sha256(JSON.stringify({ id, organizationId, eventType, actorUserId, details, occurredAt }));
  await db
    .prepare("INSERT INTO organization_audit_events (id,organization_id,event_type,actor_user_id,target_user_id,details_json,fingerprint,occurred_at) VALUES (?,?,?,?,NULL,?,?,?)")
    .bind(id, organizationId, eventType, actorUserId, JSON.stringify(details), fingerprint, occurredAt)
    .run();
};

const defaultPolicy = (organizationId: string, updatedAt: string, updatedBy: string): OrganizationRetentionPolicy =>
  createOrganizationRetentionPolicy({
    organizationId,
    operationalSensitiveDays: DEFAULT_RETENTION_RULES["operational-sensitive"].activeDays ?? 365,
    securityEvidenceDays: DEFAULT_RETENTION_RULES["security-evidence"].activeDays ?? 400,
    projectRecoveryDays: DEFAULT_RETENTION_RULES["project-content"].deletedRecoveryDays,
    updatedAt,
    updatedBy,
  });

export function createD1DataProtectionRepository(
  db: D1Database,
  { clock = () => new Date().toISOString() } = {},
) {
  const getPolicy = async (organizationId: string, defaultActorId: string): Promise<OrganizationRetentionPolicy> => {
    await ensureSchema(db);
    const row = await db
      .prepare("SELECT * FROM organization_retention_policies WHERE organization_id = ?")
      .bind(organizationId)
      .first<Row>();
    return row ? mapPolicy(row) : defaultPolicy(organizationId, clock(), defaultActorId);
  };

  const getDeletion = async (organizationId: string, projectId: string, requestId: string): Promise<ProjectDeletionEvidence | null> => {
    const row = await db
      .prepare("SELECT * FROM project_deletion_requests WHERE id = ? AND organization_id = ? AND project_id = ?")
      .bind(requestId, organizationId, projectId)
      .first<Row>();
    return row ? mapDeletion(row) : null;
  };

  return Object.freeze({
    getPolicy,

    async listOrganizationProjectIds(organizationId: string): Promise<readonly string[]> {
      await ensureSchema(db);
      const rows = await all(db, "SELECT id FROM projects WHERE organization_id=? ORDER BY id", organizationId);
      return Object.freeze(rows.map((row) => String(row.id)));
    },

    async setPolicy(
      organizationId: string,
      actorUserId: string,
      input: Pick<OrganizationRetentionPolicy, "operationalSensitiveDays" | "securityEvidenceDays" | "projectRecoveryDays">,
    ): Promise<OrganizationRetentionPolicy> {
      await ensureSchema(db);
      const now = clock();
      const policy = createOrganizationRetentionPolicy({ organizationId, ...input, updatedAt: now, updatedBy: actorUserId });
      await db
        .prepare("INSERT INTO organization_retention_policies (organization_id,schema_version,operational_sensitive_days,security_evidence_days,project_recovery_days,updated_at,updated_by) VALUES (?,1,?,?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET operational_sensitive_days=excluded.operational_sensitive_days,security_evidence_days=excluded.security_evidence_days,project_recovery_days=excluded.project_recovery_days,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
        .bind(organizationId, policy.operationalSensitiveDays, policy.securityEvidenceDays, policy.projectRecoveryDays, now, actorUserId)
        .run();
      await audit(db, organizationId, actorUserId, "retention.policy_updated", now, {
        operationalSensitiveDays: policy.operationalSensitiveDays,
        securityEvidenceDays: policy.securityEvidenceDays,
        projectRecoveryDays: policy.projectRecoveryDays,
      });
      return policy;
    },

    async requestProjectDeletion(
      organizationId: string,
      projectId: string,
      actorUserId: string,
      expectedRevision: number,
      reasonCode: string,
    ): Promise<ProjectDeletionEvidence> {
      await ensureSchema(db);
      const current = await db
        .prepare("SELECT revision, deleted_at FROM projects WHERE id = ? AND organization_id = ?")
        .bind(projectId, organizationId)
        .first<{ revision: number; deleted_at: string | null }>();
      if (!current) throw new DataProtectionConflict("PROJECT_NOT_FOUND");
      if (current.deleted_at)
        throw new DataProtectionConflict("PROJECT_DELETION_ALREADY_REQUESTED", { currentRevision: Number(current.revision) });
      if (Number(current.revision) !== expectedRevision)
        throw new DataProtectionConflict("PROJECT_REVISION_CONFLICT", { currentRevision: Number(current.revision) });
      const now = clock();
      const policy = await getPolicy(organizationId, actorUserId);
      const recoveryUntil = projectDeletionTargets(now, policy).find((target) => target.store === "d1-primary")?.dueAt;
      if (!recoveryUntil) throw new DataProtectionConflict("PROJECT_DELETION_POLICY_INVALID");
      const id = `project-deletion-${crypto.randomUUID()}`;
      const cacheDirectiveId = `cache-delete-${crypto.randomUUID()}`;
      const projectRevision = expectedRevision + 1;
      const immutableEvidence = { id, organizationId, projectId, projectRevision, reasonCode, actorUserId, now, recoveryUntil, cacheDirectiveId };
      const fingerprint = await sha256(JSON.stringify(immutableEvidence));
      await db.batch([
        db.prepare("UPDATE projects SET deleted_at=?, recovery_until=?, updated_at=?, revision=revision+1 WHERE id=? AND organization_id=? AND revision=? AND deleted_at IS NULL")
          .bind(now, recoveryUntil, now, projectId, organizationId, expectedRevision),
        db.prepare("INSERT INTO project_deletion_requests (id,organization_id,project_id,project_revision,status,reason_code,requested_by,requested_at,recovery_until,cache_directive_id,evidence_fingerprint) SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id=? AND organization_id=? AND revision=? AND deleted_at=?)")
          .bind(id, organizationId, projectId, projectRevision, "recoverable", reasonCode, actorUserId, now, recoveryUntil, cacheDirectiveId, fingerprint, projectId, organizationId, projectRevision, now),
      ]);
      const evidence = await getDeletion(organizationId, projectId, id);
      if (!evidence) throw new DataProtectionConflict("PROJECT_REVISION_CONFLICT", { currentRevision: Number(current.revision) });
      await audit(db, organizationId, actorUserId, "project.deletion_requested", now, {
        projectId, deletionRequestId: id, projectRevision, recoveryUntil, cacheDirectiveId,
      });
      return evidence;
    },

    async acknowledgeBrowserCacheDeletion(
      organizationId: string,
      projectId: string,
      actorUserId: string,
      requestId: string,
      directiveId: string,
    ): Promise<ProjectDeletionEvidence> {
      await ensureSchema(db);
      const current = await getDeletion(organizationId, projectId, requestId);
      if (!current || current.cacheDirective.id !== directiveId)
        throw new DataProtectionConflict("PROJECT_CACHE_DIRECTIVE_NOT_FOUND");
      if (current.cacheDirective.acknowledgedAt) return current;
      const now = clock();
      await db.prepare("UPDATE project_deletion_requests SET cache_acknowledged_at=?,cache_acknowledged_by=? WHERE id=? AND organization_id=? AND status='recoverable' AND cache_acknowledged_at IS NULL")
        .bind(now, actorUserId, requestId, organizationId).run();
      const evidence = await getDeletion(organizationId, projectId, requestId);
      if (!evidence?.cacheDirective.acknowledgedAt)
        throw new DataProtectionConflict("PROJECT_CACHE_DIRECTIVE_NOT_ACTIVE");
      await audit(db, organizationId, actorUserId, "project.cache_deletion_acknowledged", now, {
        projectId, deletionRequestId: requestId, cacheDirectiveId: directiveId,
      });
      return evidence;
    },

    async recoverProject(
      organizationId: string,
      projectId: string,
      actorUserId: string,
      requestId: string,
    ): Promise<ProjectDeletionEvidence> {
      await ensureSchema(db);
      const current = await getDeletion(organizationId, projectId, requestId);
      if (!current) throw new DataProtectionConflict("PROJECT_DELETION_NOT_FOUND");
      if (current.status !== "recoverable") throw new DataProtectionConflict("PROJECT_DELETION_NOT_RECOVERABLE");
      const now = clock();
      if (Date.parse(now) > Date.parse(current.recoveryUntil)) throw new DataProtectionConflict("PROJECT_RECOVERY_WINDOW_EXPIRED");
      await db.batch([
        db.prepare("UPDATE projects SET deleted_at=NULL,recovery_until=NULL,updated_at=?,revision=revision+1 WHERE id=? AND organization_id=? AND deleted_at=?")
          .bind(now, projectId, organizationId, current.requestedAt),
        db.prepare("UPDATE project_deletion_requests SET status='recovered',recovered_at=?,recovered_by=? WHERE id=? AND organization_id=? AND status='recoverable'")
          .bind(now, actorUserId, requestId, organizationId),
      ]);
      const evidence = await getDeletion(organizationId, projectId, requestId);
      if (evidence?.status !== "recovered") throw new DataProtectionConflict("PROJECT_RECOVERY_CONFLICT");
      await audit(db, organizationId, actorUserId, "project.deletion_recovered", now, { projectId, deletionRequestId: requestId });
      return evidence;
    },

    async purgeProject(
      organizationId: string,
      projectId: string,
      actorUserId: string,
      requestId: string,
    ): Promise<ProjectDeletionEvidence> {
      await ensureSchema(db);
      const current = await getDeletion(organizationId, projectId, requestId);
      if (!current) throw new DataProtectionConflict("PROJECT_DELETION_NOT_FOUND");
      if (current.status !== "recoverable") throw new DataProtectionConflict("PROJECT_DELETION_NOT_PURGEABLE");
      const now = clock();
      if (Date.parse(now) < Date.parse(current.recoveryUntil)) throw new DataProtectionConflict("PROJECT_RECOVERY_WINDOW_ACTIVE");
      const exists = await db.prepare("SELECT id FROM projects WHERE id=? AND organization_id=? AND deleted_at=?").bind(projectId, organizationId, current.requestedAt).first<{ id: string }>();
      if (!exists) throw new DataProtectionConflict("PROJECT_PURGE_CONFLICT");
      const verification: Record<string, number> = Object.fromEntries(
        [...PROJECT_CASCADE_TABLES, "notification_email_outbox_orphans"].map((table) => [table, 0]),
      );
      await db.batch([
        db.prepare("DELETE FROM projects WHERE id=? AND organization_id=? AND deleted_at=?").bind(projectId, organizationId, current.requestedAt),
        db.prepare("UPDATE project_deletion_requests SET status='purged',purged_at=?,purged_by=?,purge_verification_json=? WHERE id=? AND organization_id=? AND status='recoverable'")
          .bind(now, actorUserId, JSON.stringify(verification), requestId, organizationId),
      ]);
      const observedVerification: Record<string, number> = {};
      for (const table of PROJECT_CASCADE_TABLES) {
        const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE project_id=?`).bind(projectId).first<{ count: number }>();
        observedVerification[table] = Number(row?.count ?? 0);
      }
      const orphanedOutbox = await db.prepare("SELECT COUNT(*) AS count FROM notification_email_outbox o LEFT JOIN notifications n ON n.id=o.notification_id WHERE n.id IS NULL").first<{ count: number }>();
      observedVerification.notification_email_outbox_orphans = Number(orphanedOutbox?.count ?? 0);
      const failed = Object.entries(observedVerification).filter(([, count]) => count !== 0);
      if (failed.length) throw new DataProtectionConflict("PROJECT_PURGE_VERIFICATION_FAILED", { count: failed.length });
      const evidence = await getDeletion(organizationId, projectId, requestId);
      if (evidence?.status !== "purged") throw new DataProtectionConflict("PROJECT_PURGE_CONFLICT");
      await audit(db, organizationId, actorUserId, "project.deletion_purged", now, {
        projectId, deletionRequestId: requestId, cascadeTableCount: PROJECT_CASCADE_TABLES.length + 1, verified: true,
      });
      return evidence;
    },

    async exportProject(organizationId: string, projectId: string, actorUserId: string) {
      await ensureSchema(db);
      const projects = await all(db, "SELECT id,organization_id,name,active_plan_id,created_at,updated_at,provenance_json,archived_at,deleted_at,recovery_until,pinned,last_opened_at,revision FROM projects WHERE id=? AND organization_id=?", projectId, organizationId);
      if (!projects.length) throw new DataProtectionConflict("PROJECT_NOT_FOUND");
      const exportedAt = clock();
      const [states, collaboration, presence, shareLinks, notifications, outbox, runbooks, tasks, transitions, ledger, receipts, occupancy, incidents, deviations, deletions] = await Promise.all([
        all(db, "SELECT * FROM project_states WHERE project_id=?", projectId),
        all(db, "SELECT * FROM project_collaboration_events WHERE project_id=? AND organization_id=? ORDER BY id", projectId, organizationId),
        all(db, "SELECT * FROM project_presence WHERE project_id=? AND organization_id=? ORDER BY session_id", projectId, organizationId),
        all(db, "SELECT id,organization_id,project_id,proposal_id,scope,created_by,created_at,expires_at,revoked_at,revoked_by,lifecycle_state,creation_ledgered_at,revocation_ledgered_at,operation_attempts,last_operation_error FROM project_share_links WHERE project_id=? AND organization_id=? ORDER BY created_at", projectId, organizationId),
        all(db, "SELECT * FROM notifications WHERE project_id=? AND organization_id=? ORDER BY created_at", projectId, organizationId),
        all(db, "SELECT o.id,o.notification_id,o.body_code,o.subject_refs_json,o.created_at,o.delivered_at,o.failure_code,o.attempt_count,o.last_attempt_at FROM notification_email_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.project_id=? AND n.organization_id=? ORDER BY o.created_at", projectId, organizationId),
        all(db, "SELECT * FROM event_day_runbooks WHERE project_id=? AND organization_id=? ORDER BY frozen_at", projectId, organizationId),
        all(db, "SELECT * FROM event_day_runbook_tasks WHERE project_id=? AND organization_id=? ORDER BY runbook_id,id", projectId, organizationId),
        all(db, "SELECT * FROM event_day_runbook_transitions WHERE project_id=? AND organization_id=? ORDER BY runbook_id,runbook_sequence", projectId, organizationId),
        all(db, "SELECT * FROM event_day_runbook_ledger WHERE project_id=? AND organization_id=? ORDER BY runbook_id,sequence", projectId, organizationId),
        all(db, "SELECT * FROM event_day_runbook_receipts WHERE project_id=? AND organization_id=? ORDER BY runbook_id,occurred_at", projectId, organizationId),
        all(db, "SELECT * FROM live_occupancy_monitors WHERE project_id=? AND organization_id=? ORDER BY created_at", projectId, organizationId),
        all(db, "SELECT * FROM event_day_incident_registers WHERE project_id=? AND organization_id=? ORDER BY created_at", projectId, organizationId),
        all(db, "SELECT * FROM event_day_deviation_registers WHERE project_id=? AND organization_id=? ORDER BY created_at", projectId, organizationId),
        all(db, "SELECT * FROM project_deletion_requests WHERE project_id=? AND organization_id=? ORDER BY requested_at", projectId, organizationId),
      ]);
      const payload = Object.freeze({
        schemaVersion: 1, exportKind: "project", generatedOnDemand: true, serverStored: false, exportedAt,
        organizationId, projectId,
        manifest: Object.freeze({ secretColumnsExcluded: Object.freeze(["project_share_links.token_hash", "notification_email_outbox.recipient_email", "notification_email_outbox.lease_token", "project_collaboration_events.session_id", "project_presence.session_id", "event_day_runbook_transitions.session_id", "event_day_runbook_ledger.session_id"]), tables: Object.freeze(["projects", ...PROJECT_CASCADE_TABLES, "notification_email_outbox", "project_deletion_requests"]) }),
        data: Object.freeze({
          projects: mapRows(projects, ["provenance_json"]), project_states: mapRows(states, ["snapshot_json"]),
          project_collaboration_events: mapRows(collaboration, ["payload_json"], ["session_id"]), project_presence: mapRows(presence, ["viewport_json"], ["session_id"]),
          project_share_links: mapRows(shareLinks), notifications: mapRows(notifications, ["subject_refs_json"]), notification_email_outbox: mapRows(outbox, ["subject_refs_json"]),
          event_day_runbooks: mapRows(runbooks, ["definition_json"]), event_day_runbook_tasks: mapRows(tasks, ["assignee_json", "related_object_ids_json"]),
          event_day_runbook_transitions: mapRows(transitions, ["evidence_json"], ["session_id"]), event_day_runbook_ledger: mapRows(ledger, ["details_json"], ["session_id"]),
          event_day_runbook_receipts: mapRows(receipts, ["receipt_json"]), live_occupancy_monitors: mapRows(occupancy, ["baseline_json", "monitor_json"]),
          event_day_incident_registers: mapRows(incidents, ["baseline_json", "register_json"]), event_day_deviation_registers: mapRows(deviations, ["baseline_json", "register_json"]),
          project_deletion_requests: mapRows(deletions, ["purge_verification_json"]),
        }),
      });
      await audit(db, organizationId, actorUserId, "project.export_generated", exportedAt, { projectId, serverStored: false });
      return payload;
    },

    async exportAccount(userId: string, organizationIds: readonly string[]) {
      await ensureSchema(db);
      const exportedAt = clock();
      for (const organizationId of organizationIds)
        await audit(db, organizationId, userId, "account.export_generated", exportedAt, { serverStored: false });
      const user = await all(db, "SELECT id,identity_provider,provider_subject,email,display_name,status,created_at,updated_at,deleted_at FROM users WHERE id=?", userId);
      if (!user.length) throw new DataProtectionConflict("ACCOUNT_UNAVAILABLE");
      const memberships = await all(db, "SELECT * FROM organization_memberships WHERE user_id=? ORDER BY organization_id", userId);
      const preferences = await all(db, "SELECT * FROM notification_preferences WHERE user_id=?", userId);
      const sessions = await all(db, "SELECT created_at,expires_at,revoked_at,last_seen_at FROM user_sessions WHERE user_id=? ORDER BY created_at", userId);
      const deletionRequests = await all(db, "SELECT * FROM account_deletion_requests WHERE user_id=? ORDER BY requested_at", userId);
      const organizations = organizationIds.length
        ? await all(db, `SELECT id,name,slug,created_at,updated_at,deleted_at FROM organizations WHERE id IN (${organizationIds.map(() => "?").join(",")}) ORDER BY id`, ...organizationIds)
        : [];
      const invitations = organizationIds.length
        ? await all(db, `SELECT i.id,i.organization_id,i.email,i.roles_json,i.invited_by,i.created_at,i.expires_at,i.accepted_at,i.revoked_at FROM organization_invitations i JOIN users u ON u.id=? WHERE i.email=u.email AND i.organization_id IN (${organizationIds.map(() => "?").join(",")}) ORDER BY i.created_at`, userId, ...organizationIds)
        : [];
      const auditEvents = organizationIds.length
        ? await all(db, `SELECT * FROM organization_audit_events WHERE (actor_user_id=? OR target_user_id=?) AND organization_id IN (${organizationIds.map(() => "?").join(",")}) ORDER BY occurred_at`, userId, userId, ...organizationIds)
        : [];
      const notifications = organizationIds.length
        ? await all(db, `SELECT * FROM notifications WHERE user_id=? AND organization_id IN (${organizationIds.map(() => "?").join(",")}) ORDER BY created_at`, userId, ...organizationIds)
        : [];
      const notificationDeliveries = organizationIds.length
        ? await all(db, `SELECT o.id,o.notification_id,o.body_code,o.subject_refs_json,o.created_at,o.delivered_at,o.failure_code,o.attempt_count,o.last_attempt_at FROM notification_email_outbox o JOIN notifications n ON n.id=o.notification_id WHERE n.user_id=? AND n.organization_id IN (${organizationIds.map(() => "?").join(",")}) ORDER BY o.created_at`, userId, ...organizationIds)
        : [];
      return Object.freeze({
        schemaVersion: 1, exportKind: "account", generatedOnDemand: true, serverStored: false, exportedAt,
        manifest: Object.freeze({ secretColumnsExcluded: Object.freeze(["user_sessions.id", "organization_invitations.token_hash", "notification_email_outbox.recipient_email", "notification_email_outbox.lease_token", "project_share_links.token_hash"]), tables: Object.freeze(["users", "organizations", "organization_memberships", "organization_invitations", "notification_preferences", "user_sessions", "account_deletion_requests", "organization_audit_events", "notifications", "notification_email_outbox"]) }),
        data: Object.freeze({ users: mapRows(user), organizations: mapRows(organizations), organization_memberships: mapRows(memberships, ["roles_json"]), organization_invitations: mapRows(invitations, ["roles_json"]), notification_preferences: mapRows(preferences, ["event_types_json"]), user_sessions: mapRows(sessions), account_deletion_requests: mapRows(deletionRequests), organization_audit_events: mapRows(auditEvents, ["details_json"]), notifications: mapRows(notifications, ["subject_refs_json"]), notification_email_outbox: mapRows(notificationDeliveries, ["subject_refs_json"]) }),
      });
    },
  });
}

export { PROJECT_CASCADE_TABLES };
