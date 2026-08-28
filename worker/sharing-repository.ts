import { applyDatabaseMigrations } from "./database-migrations.ts";
import { normalizeNotificationPreferences, shareLinkStatus } from "../src/domain/sharing.js";

type D1Statement = { bind: (...values: unknown[]) => D1Statement; first: <T>() => Promise<T | null>; all: <T>() => Promise<{ results: T[] }>; run: () => Promise<unknown> };
type D1Database = { prepare: (sql: string) => D1Statement; batch: (statements: D1Statement[]) => Promise<unknown> };
const initialized = new WeakSet<object>();
async function ready(db: D1Database) { if (!initialized.has(db as object)) { await applyDatabaseMigrations(db as never); initialized.add(db as object); } }

const mapLink = (row: Record<string, unknown>) => ({ id: String(row.id), organizationId: String(row.organization_id), projectId: String(row.project_id), proposalId: row.proposal_id ? String(row.proposal_id) : null, scope: String(row.scope), tokenHash: String(row.token_hash), createdBy: String(row.created_by), createdAt: String(row.created_at), expiresAt: String(row.expires_at), revokedAt: row.revoked_at ? String(row.revoked_at) : null, revokedBy: row.revoked_by ? String(row.revoked_by) : null });
const mapNotification = (row: Record<string, unknown>) => ({ id: String(row.id), organizationId: String(row.organization_id), projectId: String(row.project_id), userId: String(row.user_id), eventType: String(row.event_type), bodyCode: String(row.body_code), refs: JSON.parse(String(row.subject_refs_json)), createdAt: String(row.created_at), readAt: row.read_at ? String(row.read_at) : null });
const preferencesFromRow = (row: Record<string, unknown>) => normalizeNotificationPreferences({
  inAppEnabled: Boolean(row.in_app_enabled),
  emailEnabled: Boolean(row.email_enabled),
  eventTypes: JSON.parse(String(row.event_types_json)),
});

export function createD1SharingRepository(db: D1Database) {
  return {
    async createLink(link: Record<string, unknown>) { await ready(db); await db.prepare("INSERT INTO project_share_links (id,organization_id,project_id,proposal_id,scope,token_hash,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?)").bind(link.id, link.organizationId, link.projectId, link.proposalId ?? null, link.scope, link.tokenHash, link.createdBy, link.createdAt, link.expiresAt).run(); return link; },
    async listLinks(organizationId: string, projectId: string) { await ready(db); const { results } = await db.prepare("SELECT * FROM project_share_links WHERE organization_id=? AND project_id=? ORDER BY created_at DESC").bind(organizationId, projectId).all<Record<string, unknown>>(); return results.map(mapLink); },
    async resolveLink(tokenHash: string, now: string) { await ready(db); const row = await db.prepare("SELECT * FROM project_share_links WHERE token_hash=?").bind(tokenHash).first<Record<string, unknown>>(); if (!row) return null; const link = mapLink(row); return { ...link, status: shareLinkStatus(link, now) }; },
    async revokeLink(organizationId: string, projectId: string, linkId: string, userId: string, revokedAt: string) { await ready(db); const updated = await db.prepare("UPDATE project_share_links SET revoked_at=?, revoked_by=? WHERE id=? AND organization_id=? AND project_id=? AND revoked_at IS NULL RETURNING *").bind(revokedAt, userId, linkId, organizationId, projectId).first<Record<string, unknown>>(); if (updated) return { link: mapLink(updated), changed: true }; const row = await db.prepare("SELECT * FROM project_share_links WHERE id=? AND organization_id=? AND project_id=?").bind(linkId, organizationId, projectId).first<Record<string, unknown>>(); return row ? { link: mapLink(row), changed: false } : null; },
    async preferences(userId: string) { await ready(db); const row = await db.prepare("SELECT * FROM notification_preferences WHERE user_id=?").bind(userId).first<Record<string, unknown>>(); return row ? preferencesFromRow(row) : normalizeNotificationPreferences(); },
    async setPreferences(userId: string, input: unknown, updatedAt: string) { await ready(db); const value = normalizeNotificationPreferences(input as never); await db.prepare("INSERT INTO notification_preferences (user_id,in_app_enabled,email_enabled,event_types_json,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET in_app_enabled=excluded.in_app_enabled,email_enabled=excluded.email_enabled,event_types_json=excluded.event_types_json,updated_at=excluded.updated_at").bind(userId, value.inAppEnabled ? 1 : 0, value.emailEnabled ? 1 : 0, JSON.stringify(value.eventTypes), updatedAt).run(); return value; },
    async addNotification(notification: Record<string, unknown>, recipientEmail?: string | null) { await ready(db); const insertNotification = db.prepare("INSERT INTO notifications (id,organization_id,project_id,user_id,event_type,body_code,subject_refs_json,created_at,read_at) VALUES (?,?,?,?,?,?,?,?,NULL)").bind(notification.id, notification.organizationId, notification.projectId, notification.userId, notification.eventType, notification.bodyCode, JSON.stringify(notification.refs), notification.createdAt); if (recipientEmail) await db.batch([insertNotification, db.prepare("INSERT INTO notification_email_outbox (id,notification_id,recipient_email,body_code,subject_refs_json,created_at) VALUES (?,?,?,?,?,?)").bind(`email-${notification.id}`, notification.id, recipientEmail, notification.bodyCode, JSON.stringify(notification.refs), notification.createdAt)]); else await insertNotification.run(); return notification; },
    async listNotifications(userId: string, organizationId: string) { await ready(db); const { results } = await db.prepare("SELECT n.* FROM notifications n LEFT JOIN notification_preferences p ON p.user_id=n.user_id WHERE n.user_id=? AND n.organization_id=? AND COALESCE(p.in_app_enabled,1)=1 ORDER BY n.created_at DESC LIMIT 100").bind(userId, organizationId).all<Record<string, unknown>>(); return results.map(mapNotification); },
    async markRead(userId: string, organizationId: string, notificationId: string, readAt: string) { await ready(db); await db.prepare("UPDATE notifications SET read_at=? WHERE id=? AND user_id=? AND organization_id=?").bind(readAt, notificationId, userId, organizationId).run(); },
    async notificationRecipients(organizationId: string, eventType: string, excludeUserId?: string | null) { await ready(db); const { results } = await db.prepare("SELECT u.id,u.email,p.in_app_enabled,p.email_enabled,p.event_types_json FROM organization_memberships m JOIN users u ON u.id=m.user_id LEFT JOIN notification_preferences p ON p.user_id=u.id WHERE m.organization_id=? AND m.status='active' AND u.status='active'").bind(organizationId).all<Record<string, unknown>>(); return results.flatMap((row) => {
      if (String(row.id) === excludeUserId) return [];
      let preferences;
      try { preferences = row.event_types_json == null ? normalizeNotificationPreferences() : preferencesFromRow(row); } catch { return []; }
      if (!preferences.eventTypes.includes(eventType) || (!preferences.inAppEnabled && !preferences.emailEnabled)) return [];
      return [{ userId: String(row.id), email: String(row.email), inAppEnabled: preferences.inAppEnabled, emailEnabled: preferences.emailEnabled }];
    }); },
  };
}

export function createMemorySharingRepository({ recipients = [] } = {}) {
  const links = new Map(); const preferences = new Map(); const notifications = []; const emailOutbox = [];
  return {
    async createLink(link) { links.set(link.id, structuredClone(link)); return structuredClone(link); },
    async listLinks(organizationId, projectId) { return [...links.values()].filter((link) => link.organizationId === organizationId && link.projectId === projectId).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)).map((link) => structuredClone(link)); },
    async resolveLink(tokenHash, now) { const link = [...links.values()].find((item) => item.tokenHash === tokenHash); return link ? { ...structuredClone(link), status: shareLinkStatus(link, now) } : null; },
    async revokeLink(organizationId, projectId, linkId, userId, revokedAt) { const link = links.get(linkId); if (!link || link.organizationId !== organizationId || link.projectId !== projectId) return null; if (link.revokedAt) return { link: structuredClone(link), changed: false }; const next = { ...link, revokedAt, revokedBy: userId }; links.set(linkId, next); return { link: structuredClone(next), changed: true }; },
    async preferences(userId) { return structuredClone(preferences.get(userId) ?? normalizeNotificationPreferences()); },
    async setPreferences(userId, input) { const value = normalizeNotificationPreferences(input); preferences.set(userId, value); return structuredClone(value); },
    async addNotification(notification, recipientEmail = null) { notifications.push(structuredClone(notification)); if (recipientEmail) emailOutbox.push({ id: `email-${notification.id}`, notificationId: notification.id, recipientEmail, bodyCode: notification.bodyCode, refs: structuredClone(notification.refs), createdAt: notification.createdAt }); return structuredClone(notification); },
    async listNotifications(userId, organizationId) { if ((preferences.get(userId) ?? normalizeNotificationPreferences()).inAppEnabled === false) return []; return notifications.filter((item) => item.userId === userId && item.organizationId === organizationId).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id)).slice(0, 100).map((item) => structuredClone(item)); },
    async markRead(userId, organizationId, notificationId, readAt) { const item = notifications.find((entry) => entry.id === notificationId && entry.userId === userId && entry.organizationId === organizationId); if (item) item.readAt = readAt; },
    async notificationRecipients(_organizationId, eventType, excludeUserId = null) { return recipients.flatMap((item) => {
      if (item.userId === excludeUserId) return [];
      const configured = preferences.get(item.userId) ?? normalizeNotificationPreferences({ inAppEnabled: item.inAppEnabled, emailEnabled: item.emailEnabled, eventTypes: item.eventTypes });
      if (!configured.eventTypes.includes(eventType) || (!configured.inAppEnabled && !configured.emailEnabled)) return [];
      return [{ userId: item.userId, email: item.email, inAppEnabled: configured.inAppEnabled, emailEnabled: configured.emailEnabled }];
    }).map((item) => structuredClone(item)); },
    _links: links, _notifications: notifications, _emailOutbox: emailOutbox,
  };
}
