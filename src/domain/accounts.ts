import { stableFingerprint } from "./activity-ledger.ts";

export const ORGANIZATION_ROLES = Object.freeze([
  "viewer",
  "planner",
  "reviewer",
  "approver",
  "safety-officer",
  "venue-administrator",
  "organization-administrator",
]);

export const MEMBERSHIP_STATUSES = Object.freeze(["active", "suspended"]);
export const INVITATION_STATUSES = Object.freeze(["pending", "accepted", "revoked", "expired"]);
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const required: any = (value: any, field: any) => {
  const normalized: any = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
};

const uniqueRoles: any = (roles: any) => {
  const normalized: any = [...new Set((roles ?? []).map(String))].sort();
  if (!normalized.length || normalized.some((role: any) => !ORGANIZATION_ROLES.includes(role))) {
    throw new TypeError("Membership roles must contain published organization roles");
  }
  return Object.freeze(normalized);
};

export function createAuthenticatedIdentity({ provider, subject, email, displayName = null }: any) {
  const normalizedEmail: any = required(email, "Identity email").toLowerCase();
  return Object.freeze({
    provider: required(provider, "Identity provider"),
    subject: required(subject, "Identity subject"),
    email: normalizedEmail,
    displayName: displayName == null ? null : String(displayName).trim() || null,
  });
}

export function createOrganization({ id, name, slug, createdBy, createdAt }: any) {
  return Object.freeze({
    id: required(id, "Organization ID"),
    name: required(name, "Organization name"),
    slug: required(slug, "Organization slug").toLowerCase(),
    createdBy: required(createdBy, "Organization creator"),
    createdAt: required(createdAt, "Organization creation time"),
  });
}

export function createOrganizationMembership({ organizationId, userId, roles, status = "active", createdAt, updatedAt = createdAt }: any) {
  if (!MEMBERSHIP_STATUSES.includes(status)) throw new TypeError("Unsupported membership status");
  return Object.freeze({
    organizationId: required(organizationId, "Organization ID"),
    userId: required(userId, "User ID"),
    roles: uniqueRoles(roles),
    status,
    createdAt: required(createdAt, "Membership creation time"),
    updatedAt: required(updatedAt, "Membership update time"),
  });
}

export function createOrganizationInvitation({ id, organizationId, email, roles, invitedBy, createdAt, expiresAt, acceptedAt = null, revokedAt = null }: any) {
  const createdMs: any = Date.parse(createdAt);
  const expiresMs: any = Date.parse(expiresAt);
  if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs) || expiresMs <= createdMs) throw new TypeError("Invitation expiry must follow creation");
  return Object.freeze({
    id: required(id, "Invitation ID"),
    organizationId: required(organizationId, "Organization ID"),
    email: required(email, "Invitation email").toLowerCase(),
    roles: uniqueRoles(roles),
    invitedBy: required(invitedBy, "Inviting user"),
    createdAt,
    expiresAt,
    acceptedAt,
    revokedAt,
  });
}

export function invitationStatus(invitation: any, at: any = new Date().toISOString()) {
  if (invitation.revokedAt) return "revoked";
  if (invitation.acceptedAt) return "accepted";
  if (Date.parse(at) >= Date.parse(invitation.expiresAt)) return "expired";
  return "pending";
}

export function createUserSession({ id, userId, createdAt, expiresAt, revokedAt = null, lastSeenAt = createdAt }: any) {
  const ttl: any = Date.parse(expiresAt) - Date.parse(createdAt);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > MAX_SESSION_TTL_MS) throw new TypeError("Session lifetime is invalid");
  return Object.freeze({
    id: required(id, "Session ID"),
    userId: required(userId, "User ID"),
    createdAt,
    expiresAt,
    revokedAt,
    lastSeenAt,
  });
}

export const sessionStatus = (session: any, at: any = new Date().toISOString()) => session.revokedAt
  ? "revoked"
  : Date.parse(at) >= Date.parse(session.expiresAt) ? "expired" : "active";

export const canAdministerOrganization = (membership: any) => membership?.status === "active"
  && membership.roles.includes("organization-administrator");

export const createAccountAuditEvent = ({ id, organizationId, type, actorUserId, targetUserId = null, details = {}, occurredAt }: any) => Object.freeze({
  id: required(id, "Audit event ID"),
  organizationId: required(organizationId, "Organization ID"),
  type: required(type, "Audit event type"),
  actorUserId: required(actorUserId, "Audit actor"),
  targetUserId,
  details: Object.freeze(structuredClone(details)),
  occurredAt: required(occurredAt, "Audit event time"),
  fingerprint: stableFingerprint("account-audit-event", { id, organizationId, type, actorUserId, targetUserId, details, occurredAt }),
});

export const personalOrganizationSlug = (identity: any) => `personal-${stableFingerprint("organization", {
  provider: identity.provider,
  subject: identity.subject,
}).slice(0, 16)}`;
