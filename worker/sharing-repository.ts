import { applyDatabaseMigrations } from "./database-migrations.ts";
import { normalizeNotificationPreferences, safeNotification, shareLinkStatus } from "../src/domain/sharing.ts";
import type {
  NotificationEventType,
  NotificationPreferences,
  NotificationRefs,
  ShareScope,
} from "../src/domain/sharing.ts";

type ShareLifecycleState = "pending-create" | "active" | "pending-revoke" | "revoked";

export interface ShareLinkInput {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly proposalId: string | null;
  readonly scope: ShareScope;
  readonly tokenHash: string;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface ShareLinkRecord extends ShareLinkInput {
  readonly revokedAt: string | null;
  readonly revokedBy: string | null;
  readonly lifecycleState: ShareLifecycleState;
  readonly creationLedgeredAt: string | null;
  readonly revocationLedgeredAt: string | null;
  readonly operationAttempts: number;
  readonly lastOperationError: string | null;
}

export interface StoredNotification {
  readonly id: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly userId: string;
  readonly eventType: NotificationEventType;
  readonly bodyCode: string;
  readonly refs: NotificationRefs;
  readonly createdAt: string;
  readAt: string | null;
}

interface VisibleNotification extends StoredNotification {
  readonly inAppVisible: boolean;
}

interface NotificationDelivery {
  readonly inAppEnabled?: boolean;
  readonly recipientEmail?: string | null;
}

interface NotificationRecipientConfiguration {
  readonly organizationId: string;
  readonly userId: string;
  readonly email: string;
  readonly inAppEnabled?: boolean;
  readonly emailEnabled?: boolean;
  readonly eventTypes?: NotificationEventType[];
}

interface NotificationRecipient {
  readonly userId: string;
  readonly email: string;
  readonly inAppEnabled: boolean;
  readonly emailEnabled: boolean;
}

interface EmailOutboxItem {
  readonly id: string;
  readonly notificationId: string;
  readonly recipientEmail: string;
  readonly bodyCode: string;
  readonly refs: NotificationRefs;
  readonly createdAt: string;
  deliveredAt: string | null;
  failureCode: string | null;
  attemptCount: number;
  lastAttemptAt: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
}

interface PendingLinkFilter {
  readonly organizationId?: string | null;
  readonly projectId?: string | null;
  readonly linkId?: string | null;
  readonly limit?: number;
}

interface ClaimEmailInput {
  readonly organizationId?: string | null;
  readonly now: string;
  readonly leaseExpiresAt: string;
  readonly leaseToken: string;
  readonly limit?: number;
}

const initialized = new WeakSet<object>();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value) throw new TypeError(`${field} must be a non-empty string`);
  return value;
};
const optionalString = (value: unknown, field: string): string | null =>
  value == null ? null : requiredString(value, field);
const parseUnknown = (value: unknown, field: string): unknown => {
  if (typeof value !== "string") throw new TypeError(`${field} must be JSON text`);
  const parsed: unknown = JSON.parse(value);
  return parsed;
};
const isNotificationEventType = (value: unknown): value is NotificationEventType =>
  value === "review_requested" ||
  value === "adjustment_requested" ||
  value === "approval_completed" ||
  value === "conflict_detected";
const eventType = (value: unknown): NotificationEventType => {
  if (!isNotificationEventType(value)) throw new TypeError("Notification event type is invalid");
  return value;
};
const scope = (value: unknown): ShareScope => {
  if (value !== "read-only" && value !== "reviewer") throw new TypeError("Share scope is invalid");
  return value;
};
const lifecycleState = (value: unknown): ShareLifecycleState => {
  if (value !== "pending-create" && value !== "active" && value !== "pending-revoke" && value !== "revoked") {
    throw new TypeError("Share lifecycle state is invalid");
  }
  return value;
};
const parseRefs = (value: unknown): NotificationRefs => {
  const parsed = parseUnknown(value, "Notification references");
  if (!isRecord(parsed)) throw new TypeError("Notification references must be an object");
  const refs: NotificationRefs = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item !== "string" && typeof item !== "number") throw new TypeError("Notification reference is invalid");
    if (key === "projectId") refs.projectId = item;
    else if (key === "proposalId") refs.proposalId = item;
    else if (key === "planVersion") refs.planVersion = item;
    else if (key === "conflictCode") refs.conflictCode = item;
    else if (key === "revision") refs.revision = item;
    else throw new TypeError("Notification reference key is invalid");
  }
  return safeNotification({
    id: "validation",
    organizationId: "validation",
    projectId: "validation",
    userId: "validation",
    eventType: "review_requested",
    refs,
    createdAt: "validation",
  }).refs;
};

async function ready(db: D1Database): Promise<void> {
  if (initialized.has(db)) return;
  await applyDatabaseMigrations(db);
  initialized.add(db);
}

const mapLink = (row: Record<string, unknown>): ShareLinkRecord => ({
  id: requiredString(row.id, "Share link ID"),
  organizationId: requiredString(row.organization_id, "Share link organization ID"),
  projectId: requiredString(row.project_id, "Share link project ID"),
  proposalId: optionalString(row.proposal_id, "Share link proposal ID"),
  scope: scope(row.scope),
  tokenHash: requiredString(row.token_hash, "Share token hash"),
  createdBy: requiredString(row.created_by, "Share link creator"),
  createdAt: requiredString(row.created_at, "Share link creation time"),
  expiresAt: requiredString(row.expires_at, "Share link expiration time"),
  revokedAt: optionalString(row.revoked_at, "Share link revocation time"),
  revokedBy: optionalString(row.revoked_by, "Share link revoker"),
  lifecycleState: lifecycleState(row.lifecycle_state ?? "active"),
  creationLedgeredAt: optionalString(row.creation_ledgered_at, "Share creation ledger time"),
  revocationLedgeredAt: optionalString(row.revocation_ledgered_at, "Share revocation ledger time"),
  operationAttempts: Number(row.operation_attempts ?? 0),
  lastOperationError: optionalString(row.last_operation_error, "Share operation error"),
});

const statusFor = (link: ShareLinkRecord, now: string): "pending" | "active" | "expired" | "revoked" =>
  link.lifecycleState === "pending-create"
    ? "pending"
    : link.lifecycleState === "pending-revoke" || link.lifecycleState === "revoked"
      ? "revoked"
      : shareLinkStatus(link, now);

const mapNotification = (row: Record<string, unknown>): StoredNotification => ({
  id: requiredString(row.id, "Notification ID"),
  organizationId: requiredString(row.organization_id, "Notification organization ID"),
  projectId: requiredString(row.project_id, "Notification project ID"),
  userId: requiredString(row.user_id, "Notification user ID"),
  eventType: eventType(row.event_type),
  bodyCode: requiredString(row.body_code, "Notification body code"),
  refs: parseRefs(row.subject_refs_json),
  createdAt: requiredString(row.created_at, "Notification creation time"),
  readAt: optionalString(row.read_at, "Notification read time"),
});

const mapEmail = (row: Record<string, unknown>): EmailOutboxItem => ({
  id: requiredString(row.id, "Email ID"),
  notificationId: requiredString(row.notification_id, "Email notification ID"),
  recipientEmail: requiredString(row.recipient_email, "Email recipient"),
  bodyCode: requiredString(row.body_code, "Email body code"),
  refs: parseRefs(row.subject_refs_json),
  createdAt: requiredString(row.created_at, "Email creation time"),
  deliveredAt: optionalString(row.delivered_at, "Email delivery time"),
  failureCode: optionalString(row.failure_code, "Email failure code"),
  attemptCount: Number(row.attempt_count ?? 0),
  lastAttemptAt: optionalString(row.last_attempt_at, "Email attempt time"),
  leaseToken: optionalString(row.lease_token, "Email lease token"),
  leaseExpiresAt: optionalString(row.lease_expires_at, "Email lease expiration time"),
});

const preferencesFromRow = (row: Record<string, unknown>): NotificationPreferences =>
  normalizeNotificationPreferences({
    inAppEnabled: Boolean(row.in_app_enabled),
    emailEnabled: Boolean(row.email_enabled),
    eventTypes: parseUnknown(row.event_types_json, "Notification event types"),
  });

export function createD1SharingRepository(db: D1Database) {
  return {
    async createLink(link: ShareLinkInput) {
      await ready(db);
      await db
        .prepare(
          "INSERT INTO project_share_links (id,organization_id,project_id,proposal_id,scope,token_hash,created_by,created_at,expires_at,lifecycle_state,creation_ledgered_at,revocation_ledgered_at,operation_attempts,last_operation_error) VALUES (?,?,?,?,?,?,?,?,?,'pending-create',NULL,NULL,0,NULL)",
        )
        .bind(
          link.id,
          link.organizationId,
          link.projectId,
          link.proposalId,
          link.scope,
          link.tokenHash,
          link.createdBy,
          link.createdAt,
          link.expiresAt,
        )
        .run();
      return {
        ...link,
        revokedAt: null,
        revokedBy: null,
        lifecycleState: "pending-create" as const,
        creationLedgeredAt: null,
        revocationLedgeredAt: null,
        operationAttempts: 0,
        lastOperationError: null,
      };
    },
    async listLinks(organizationId: string, projectId: string) {
      await ready(db);
      const { results } = await db
        .prepare(
          "SELECT * FROM project_share_links WHERE organization_id=? AND project_id=? ORDER BY created_at DESC,id DESC",
        )
        .bind(organizationId, projectId)
        .all<Record<string, unknown>>();
      return results.map(mapLink);
    },
    async resolveLink(tokenHash: string, now: string) {
      await ready(db);
      const row = await db
        .prepare("SELECT * FROM project_share_links WHERE token_hash=?")
        .bind(tokenHash)
        .first<Record<string, unknown>>();
      if (!row) return null;
      const link = mapLink(row);
      return { ...link, status: statusFor(link, now) };
    },
    async pendingLinkOperations({
      organizationId = null,
      projectId = null,
      linkId = null,
      limit = 100,
    }: PendingLinkFilter = {}) {
      await ready(db);
      const clauses = ["lifecycle_state IN ('pending-create','pending-revoke')"];
      const values: Array<string | number> = [];
      if (organizationId) {
        clauses.push("organization_id=?");
        values.push(organizationId);
      }
      if (projectId) {
        clauses.push("project_id=?");
        values.push(projectId);
      }
      if (linkId) {
        clauses.push("id=?");
        values.push(linkId);
      }
      values.push(Math.max(1, Math.min(100, limit)));
      const { results } = await db
        .prepare(`SELECT * FROM project_share_links WHERE ${clauses.join(" AND ")} ORDER BY created_at,id LIMIT ?`)
        .bind(...values)
        .all<Record<string, unknown>>();
      return results.map(mapLink);
    },
    async markLinkCreated(linkId: string, ledgeredAt: string) {
      await ready(db);
      const row = await db
        .prepare(
          "UPDATE project_share_links SET lifecycle_state='active',creation_ledgered_at=?,last_operation_error=NULL WHERE id=? AND lifecycle_state='pending-create' RETURNING *",
        )
        .bind(ledgeredAt, linkId)
        .first<Record<string, unknown>>();
      return row ? mapLink(row) : null;
    },
    async beginRevoke(organizationId: string, projectId: string, linkId: string, userId: string, revokedAt: string) {
      await ready(db);
      const updated = await db
        .prepare(
          "UPDATE project_share_links SET lifecycle_state='pending-revoke',revoked_at=?,revoked_by=?,last_operation_error=NULL WHERE id=? AND organization_id=? AND project_id=? AND lifecycle_state='active' RETURNING *",
        )
        .bind(revokedAt, userId, linkId, organizationId, projectId)
        .first<Record<string, unknown>>();
      if (updated) return { link: mapLink(updated), changed: true };
      const row = await db
        .prepare("SELECT * FROM project_share_links WHERE id=? AND organization_id=? AND project_id=?")
        .bind(linkId, organizationId, projectId)
        .first<Record<string, unknown>>();
      return row ? { link: mapLink(row), changed: false } : null;
    },
    async markLinkRevoked(linkId: string, ledgeredAt: string) {
      await ready(db);
      const row = await db
        .prepare(
          "UPDATE project_share_links SET lifecycle_state='revoked',revocation_ledgered_at=?,last_operation_error=NULL WHERE id=? AND lifecycle_state='pending-revoke' RETURNING *",
        )
        .bind(ledgeredAt, linkId)
        .first<Record<string, unknown>>();
      return row ? mapLink(row) : null;
    },
    async recordLinkOperationFailure(linkId: string, failureCode: string) {
      await ready(db);
      await db
        .prepare(
          "UPDATE project_share_links SET operation_attempts=operation_attempts+1,last_operation_error=? WHERE id=? AND lifecycle_state IN ('pending-create','pending-revoke')",
        )
        .bind(failureCode, linkId)
        .run();
    },
    async preferences(userId: string) {
      await ready(db);
      const row = await db
        .prepare("SELECT * FROM notification_preferences WHERE user_id=?")
        .bind(userId)
        .first<Record<string, unknown>>();
      return row ? preferencesFromRow(row) : normalizeNotificationPreferences();
    },
    async setPreferences(userId: string, input: unknown, updatedAt: string) {
      await ready(db);
      const value = normalizeNotificationPreferences(input);
      await db
        .prepare(
          "INSERT INTO notification_preferences (user_id,in_app_enabled,email_enabled,event_types_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET in_app_enabled=excluded.in_app_enabled,email_enabled=excluded.email_enabled,event_types_json=excluded.event_types_json,updated_at=excluded.updated_at",
        )
        .bind(
          userId,
          value.inAppEnabled ? 1 : 0,
          value.emailEnabled ? 1 : 0,
          JSON.stringify(value.eventTypes),
          updatedAt,
        )
        .run();
      return value;
    },
    async addNotification(notification: StoredNotification, delivery: NotificationDelivery = {}) {
      await ready(db);
      const insertNotification = db
        .prepare(
          "INSERT INTO notifications (id,organization_id,project_id,user_id,event_type,body_code,subject_refs_json,created_at,read_at,in_app_visible) VALUES (?,?,?,?,?,?,?,?,NULL,?)",
        )
        .bind(
          notification.id,
          notification.organizationId,
          notification.projectId,
          notification.userId,
          notification.eventType,
          notification.bodyCode,
          JSON.stringify(notification.refs),
          notification.createdAt,
          delivery.inAppEnabled === false ? 0 : 1,
        );
      if (delivery.recipientEmail) {
        await db.batch([
          insertNotification,
          db
            .prepare(
              "INSERT INTO notification_email_outbox (id,notification_id,recipient_email,body_code,subject_refs_json,created_at,attempt_count) VALUES (?,?,?,?,?,?,0)",
            )
            .bind(
              `email-${notification.id}`,
              notification.id,
              delivery.recipientEmail,
              notification.bodyCode,
              JSON.stringify(notification.refs),
              notification.createdAt,
            ),
        ]);
      } else {
        await insertNotification.run();
      }
      return notification;
    },
    async listNotifications(userId: string, organizationId: string) {
      await ready(db);
      const { results } = await db
        .prepare(
          "SELECT * FROM notifications WHERE user_id=? AND organization_id=? AND in_app_visible=1 ORDER BY created_at DESC,id DESC LIMIT 100",
        )
        .bind(userId, organizationId)
        .all<Record<string, unknown>>();
      return results.map(mapNotification);
    },
    async markRead(userId: string, organizationId: string, notificationId: string, readAt: string) {
      await ready(db);
      await db
        .prepare(
          "UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND organization_id=? AND in_app_visible=1",
        )
        .bind(readAt, notificationId, userId, organizationId)
        .run();
    },
    async notificationRecipients(
      organizationId: string,
      notificationEventType: NotificationEventType,
      excludeUserId: string | null = null,
    ): Promise<NotificationRecipient[]> {
      await ready(db);
      const { results } = await db
        .prepare(
          "SELECT u.id,u.email,p.in_app_enabled,p.email_enabled,p.event_types_json FROM organization_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE m.organization_id=? AND m.status='active' AND u.status='active'",
        )
        .bind(organizationId)
        .all<Record<string, unknown>>();
      return results.flatMap((row): NotificationRecipient[] => {
        if (String(row.id) === excludeUserId) return [];
        let configured: NotificationPreferences;
        try {
          configured = row.event_types_json == null ? normalizeNotificationPreferences() : preferencesFromRow(row);
        } catch {
          return [];
        }
        if (
          !configured.eventTypes.includes(notificationEventType) ||
          (!configured.inAppEnabled && !configured.emailEnabled)
        )
          return [];
        return [
          {
            userId: requiredString(row.id, "Notification recipient ID"),
            email: requiredString(row.email, "Notification recipient email"),
            inAppEnabled: configured.inAppEnabled,
            emailEnabled: configured.emailEnabled,
          },
        ];
      });
    },
    async claimEmailBatch({ organizationId = null, now, leaseExpiresAt, leaseToken, limit = 25 }: ClaimEmailInput) {
      await ready(db);
      await db
        .prepare(
          "UPDATE notification_email_outbox SET lease_token=NULL,lease_expires_at=NULL WHERE delivered_at IS NULL AND lease_expires_at IS NOT NULL AND lease_expires_at<=?",
        )
        .bind(now)
        .run();
      const where = organizationId ? "AND n.organization_id=?" : "";
      const values: Array<string | number> = organizationId ? [organizationId, limit] : [limit];
      const { results } = await db
        .prepare(
          `SELECT e.id FROM notification_email_outbox e JOIN notifications n ON n.id=e.notification_id WHERE e.delivered_at IS NULL AND e.lease_token IS NULL ${where} ORDER BY e.created_at,e.id LIMIT ?`,
        )
        .bind(...values)
        .all<{ id: string }>();
      const claimed: EmailOutboxItem[] = [];
      for (const result of results) {
        const row = await db
          .prepare(
            "UPDATE notification_email_outbox SET lease_token=?,lease_expires_at=? WHERE id=? AND delivered_at IS NULL AND lease_token IS NULL RETURNING *",
          )
          .bind(leaseToken, leaseExpiresAt, result.id)
          .first<Record<string, unknown>>();
        if (row) claimed.push(mapEmail(row));
      }
      return claimed;
    },
    async markEmailDelivered(id: string, leaseToken: string, deliveredAt: string) {
      await ready(db);
      await db
        .prepare(
          "UPDATE notification_email_outbox SET delivered_at=?,failure_code=NULL,last_attempt_at=?,attempt_count=attempt_count+1,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=? AND delivered_at IS NULL",
        )
        .bind(deliveredAt, deliveredAt, id, leaseToken)
        .run();
    },
    async markEmailFailed(id: string, leaseToken: string, failureCode: string, attemptedAt: string) {
      await ready(db);
      await db
        .prepare(
          "UPDATE notification_email_outbox SET failure_code=?,last_attempt_at=?,attempt_count=attempt_count+1,lease_token=NULL,lease_expires_at=NULL WHERE id=? AND lease_token=? AND delivered_at IS NULL",
        )
        .bind(failureCode, attemptedAt, id, leaseToken)
        .run();
    },
  };
}

export function createMemorySharingRepository({
  recipients = [],
}: { readonly recipients?: NotificationRecipientConfiguration[] } = {}) {
  const links = new Map<string, ShareLinkRecord>();
  const preferences = new Map<string, NotificationPreferences>();
  const notifications: VisibleNotification[] = [];
  const emailOutbox: EmailOutboxItem[] = [];
  const failures = new Map<string, number>();
  const maybeFail = (name: string): void => {
    const count = failures.get(name) ?? 0;
    if (count > 0) {
      failures.set(name, count - 1);
      throw new Error(`INJECTED_${name.toUpperCase()}_FAILURE`);
    }
  };
  const cloneLink = (link: ShareLinkRecord): ShareLinkRecord => structuredClone(link);
  return {
    async createLink(link: ShareLinkInput) {
      maybeFail("createLink");
      const value: ShareLinkRecord = {
        ...structuredClone(link),
        revokedAt: null,
        revokedBy: null,
        lifecycleState: "pending-create",
        creationLedgeredAt: null,
        revocationLedgeredAt: null,
        operationAttempts: 0,
        lastOperationError: null,
      };
      links.set(link.id, value);
      return cloneLink(value);
    },
    async listLinks(organizationId: string, projectId: string) {
      return [...links.values()]
        .filter((link) => link.organizationId === organizationId && link.projectId === projectId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
        .map(cloneLink);
    },
    async resolveLink(tokenHash: string, now: string) {
      const link = [...links.values()].find((item) => item.tokenHash === tokenHash);
      return link ? { ...cloneLink(link), status: statusFor(link, now) } : null;
    },
    async pendingLinkOperations({
      organizationId = null,
      projectId = null,
      linkId = null,
      limit = 100,
    }: PendingLinkFilter = {}) {
      return [...links.values()]
        .filter(
          (link) =>
            (link.lifecycleState === "pending-create" || link.lifecycleState === "pending-revoke") &&
            (!organizationId || link.organizationId === organizationId) &&
            (!projectId || link.projectId === projectId) &&
            (!linkId || link.id === linkId),
        )
        .slice(0, limit)
        .map(cloneLink);
    },
    async markLinkCreated(linkId: string, ledgeredAt: string) {
      maybeFail("markLinkCreated");
      const link = links.get(linkId);
      if (!link || link.lifecycleState !== "pending-create") return null;
      const value: ShareLinkRecord = {
        ...link,
        lifecycleState: "active",
        creationLedgeredAt: ledgeredAt,
        lastOperationError: null,
      };
      links.set(linkId, value);
      return cloneLink(value);
    },
    async beginRevoke(organizationId: string, projectId: string, linkId: string, userId: string, revokedAt: string) {
      maybeFail("beginRevoke");
      const link = links.get(linkId);
      if (!link || link.organizationId !== organizationId || link.projectId !== projectId) return null;
      if (link.lifecycleState !== "active") return { link: cloneLink(link), changed: false };
      const value: ShareLinkRecord = {
        ...link,
        lifecycleState: "pending-revoke",
        revokedAt,
        revokedBy: userId,
        lastOperationError: null,
      };
      links.set(linkId, value);
      return { link: cloneLink(value), changed: true };
    },
    async markLinkRevoked(linkId: string, ledgeredAt: string) {
      maybeFail("markLinkRevoked");
      const link = links.get(linkId);
      if (!link || link.lifecycleState !== "pending-revoke") return null;
      const value: ShareLinkRecord = {
        ...link,
        lifecycleState: "revoked",
        revocationLedgeredAt: ledgeredAt,
        lastOperationError: null,
      };
      links.set(linkId, value);
      return cloneLink(value);
    },
    async recordLinkOperationFailure(linkId: string, failureCode: string) {
      const link = links.get(linkId);
      if (link && (link.lifecycleState === "pending-create" || link.lifecycleState === "pending-revoke"))
        links.set(linkId, { ...link, operationAttempts: link.operationAttempts + 1, lastOperationError: failureCode });
    },
    async preferences(userId: string) {
      return structuredClone(preferences.get(userId) ?? normalizeNotificationPreferences());
    },
    async setPreferences(userId: string, input: unknown) {
      const value = normalizeNotificationPreferences(input);
      preferences.set(userId, value);
      return structuredClone(value);
    },
    async addNotification(notification: StoredNotification, delivery: NotificationDelivery = {}) {
      const stored: VisibleNotification = {
        ...structuredClone(notification),
        inAppVisible: delivery.inAppEnabled !== false,
      };
      notifications.push(stored);
      if (delivery.recipientEmail) {
        emailOutbox.push({
          id: `email-${notification.id}`,
          notificationId: notification.id,
          recipientEmail: delivery.recipientEmail,
          bodyCode: notification.bodyCode,
          refs: structuredClone(notification.refs),
          createdAt: notification.createdAt,
          deliveredAt: null,
          failureCode: null,
          attemptCount: 0,
          lastAttemptAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
        });
      }
      return structuredClone(notification);
    },
    async listNotifications(userId: string, organizationId: string): Promise<StoredNotification[]> {
      return notifications
        .filter((item) => item.userId === userId && item.organizationId === organizationId && item.inAppVisible)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
        .slice(0, 100)
        .map(({ inAppVisible: _inAppVisible, ...item }) => structuredClone(item));
    },
    async markRead(userId: string, organizationId: string, notificationId: string, readAt: string) {
      const item = notifications.find(
        (entry) =>
          entry.id === notificationId &&
          entry.userId === userId &&
          entry.organizationId === organizationId &&
          entry.inAppVisible,
      );
      if (item) item.readAt = readAt;
    },
    async notificationRecipients(
      organizationId: string,
      notificationEventType: NotificationEventType,
      excludeUserId: string | null = null,
    ): Promise<NotificationRecipient[]> {
      return recipients
        .flatMap((item): NotificationRecipient[] => {
          if (item.organizationId !== organizationId || item.userId === excludeUserId) return [];
          const configured =
            preferences.get(item.userId) ??
            normalizeNotificationPreferences({
              inAppEnabled: item.inAppEnabled,
              emailEnabled: item.emailEnabled,
              eventTypes: item.eventTypes,
            });
          if (
            !configured.eventTypes.includes(notificationEventType) ||
            (!configured.inAppEnabled && !configured.emailEnabled)
          )
            return [];
          return [
            {
              userId: item.userId,
              email: item.email,
              inAppEnabled: configured.inAppEnabled,
              emailEnabled: configured.emailEnabled,
            },
          ];
        })
        .map((item) => structuredClone(item));
    },
    async claimEmailBatch({ organizationId = null, now, leaseExpiresAt, leaseToken, limit = 25 }: ClaimEmailInput) {
      for (const item of emailOutbox) {
        if (!item.deliveredAt && item.leaseExpiresAt && item.leaseExpiresAt <= now) {
          item.leaseToken = null;
          item.leaseExpiresAt = null;
        }
      }
      const claimed: EmailOutboxItem[] = [];
      for (const item of emailOutbox) {
        const notification = notifications.find((entry) => entry.id === item.notificationId);
        if (
          claimed.length >= limit ||
          item.deliveredAt ||
          item.leaseToken ||
          (organizationId && notification?.organizationId !== organizationId)
        )
          continue;
        item.leaseToken = leaseToken;
        item.leaseExpiresAt = leaseExpiresAt;
        claimed.push(structuredClone(item));
      }
      return claimed;
    },
    async markEmailDelivered(id: string, leaseToken: string, deliveredAt: string) {
      const item = emailOutbox.find(
        (entry) => entry.id === id && entry.leaseToken === leaseToken && !entry.deliveredAt,
      );
      if (item) {
        item.deliveredAt = deliveredAt;
        item.failureCode = null;
        item.lastAttemptAt = deliveredAt;
        item.attemptCount += 1;
        item.leaseToken = null;
        item.leaseExpiresAt = null;
      }
    },
    async markEmailFailed(id: string, leaseToken: string, failureCode: string, attemptedAt: string) {
      const item = emailOutbox.find(
        (entry) => entry.id === id && entry.leaseToken === leaseToken && !entry.deliveredAt,
      );
      if (item) {
        item.failureCode = failureCode;
        item.lastAttemptAt = attemptedAt;
        item.attemptCount += 1;
        item.leaseToken = null;
        item.leaseExpiresAt = null;
      }
    },
    _failNext(name: string, count = 1) {
      failures.set(name, count);
    },
    _links: links,
    _notifications: notifications,
    _emailOutbox: emailOutbox,
  };
}
