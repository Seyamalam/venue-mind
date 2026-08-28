export const SHARE_SCOPES = Object.freeze(["read-only", "reviewer"]);
export const NOTIFICATION_EVENT_TYPES = Object.freeze(["review_requested", "adjustment_requested", "approval_completed", "conflict_detected"]);

export function createShareToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashShareToken(token) {
  if (!/^[0-9a-f]{64}$/.test(token ?? "")) throw new TypeError("Share token is invalid");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function shareLinkStatus(link, now = new Date().toISOString()) {
  if (link.revokedAt) return "revoked";
  return Date.parse(link.expiresAt) <= Date.parse(now) ? "expired" : "active";
}

export function normalizeNotificationPreferences(input = {}) {
  const eventTypes = [...new Set(input.eventTypes ?? NOTIFICATION_EVENT_TYPES)];
  if (eventTypes.some((type) => !NOTIFICATION_EVENT_TYPES.includes(type))) throw new TypeError("Notification event type is invalid");
  return { inAppEnabled: input.inAppEnabled !== false, emailEnabled: input.emailEnabled === true, eventTypes };
}

export function safeNotification({ id, organizationId, projectId, userId, eventType, refs = {}, createdAt }) {
  if (!NOTIFICATION_EVENT_TYPES.includes(eventType)) throw new TypeError("Notification event type is invalid");
  const allowed = new Set(["projectId", "proposalId", "planVersion", "conflictCode", "revision"]);
  if (Object.keys(refs).some((key) => !allowed.has(key)) || Object.values(refs).some((item) => !["string", "number"].includes(typeof item))) throw new TypeError("Notification references are unsafe");
  return { id, organizationId, projectId, userId, eventType, bodyCode: `notification.${eventType}`, refs: structuredClone(refs), createdAt, readAt: null };
}
