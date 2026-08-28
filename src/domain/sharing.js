export const SHARE_SCOPES = Object.freeze(["read-only", "reviewer"]);
export const NOTIFICATION_EVENT_TYPES = Object.freeze(["review_requested", "adjustment_requested", "approval_completed", "conflict_detected"]);
const SAFE_NOTIFICATION_REF_KEYS = Object.freeze(["projectId", "proposalId", "planVersion", "conflictCode", "revision"]);
const SAFE_REFERENCE_PATTERN = /^[\w.:/-]{1,200}$/;

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
  const expiresAt = Date.parse(link.expiresAt);
  const comparedAt = Date.parse(now);
  return Number.isFinite(expiresAt) && Number.isFinite(comparedAt) && expiresAt > comparedAt ? "active" : "expired";
}

export function normalizeNotificationPreferences(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Notification preferences are invalid");
  if (Object.keys(input).some((key) => !["inAppEnabled", "emailEnabled", "eventTypes"].includes(key))) throw new TypeError("Notification preference field is invalid");
  if (input.inAppEnabled !== undefined && typeof input.inAppEnabled !== "boolean") throw new TypeError("Notification channel is invalid");
  if (input.emailEnabled !== undefined && typeof input.emailEnabled !== "boolean") throw new TypeError("Notification channel is invalid");
  if (input.eventTypes !== undefined && !Array.isArray(input.eventTypes)) throw new TypeError("Notification event types are invalid");
  const eventTypes = [...new Set(input.eventTypes ?? NOTIFICATION_EVENT_TYPES)];
  if (eventTypes.some((type) => !NOTIFICATION_EVENT_TYPES.includes(type))) throw new TypeError("Notification event type is invalid");
  return { inAppEnabled: input.inAppEnabled !== false, emailEnabled: input.emailEnabled === true, eventTypes };
}

export function safeNotification({ id, organizationId, projectId, userId, eventType, refs = {}, createdAt }) {
  if (!NOTIFICATION_EVENT_TYPES.includes(eventType)) throw new TypeError("Notification event type is invalid");
  if (!refs || typeof refs !== "object" || Array.isArray(refs)) throw new TypeError("Notification references are unsafe");
  const allowed = new Set(SAFE_NOTIFICATION_REF_KEYS);
  if (Object.entries(refs).some(([key, value]) => !allowed.has(key)
    || (typeof value === "string" ? !SAFE_REFERENCE_PATTERN.test(value) : typeof value !== "number" || !Number.isSafeInteger(value) || value < 0))) {
    throw new TypeError("Notification references are unsafe");
  }
  return { id, organizationId, projectId, userId, eventType, bodyCode: `notification.${eventType}`, refs: structuredClone(refs), createdAt, readAt: null };
}
