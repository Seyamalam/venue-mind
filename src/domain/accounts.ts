import { stableFingerprint } from "./activity-ledger.ts";

export const ORGANIZATION_ROLES = [
  "viewer",
  "planner",
  "reviewer",
  "approver",
  "safety-officer",
  "venue-administrator",
  "organization-administrator",
] as const;

export const MEMBERSHIP_STATUSES = ["active", "suspended"] as const;
export const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;
export const DEFAULT_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];
type JsonScalar = string | number | boolean | null;
export type JsonValue = JsonScalar | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface AuthenticatedIdentity {
  readonly provider: string;
  readonly subject: string;
  readonly email: string;
  readonly displayName: string | null;
}

export interface OrganizationMembership {
  readonly organizationId: string;
  readonly userId: string;
  readonly roles: readonly OrganizationRole[];
  readonly status: MembershipStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OrganizationInvitation {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly roles: readonly OrganizationRole[];
  readonly invitedBy: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly acceptedAt: string | null;
  readonly revokedAt: string | null;
}

export interface UserSession {
  readonly id: string;
  readonly userId: string;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly revokedAt: string | null;
  readonly lastSeenAt: string;
}

const required = (value: string | null | undefined, field: string): string => {
  const normalized = (value ?? "").trim();
  if (!normalized) throw new TypeError(`${field} is required`);
  return normalized;
};

const isOrganizationRole = (role: string): role is OrganizationRole =>
  ORGANIZATION_ROLES.some((candidate) => candidate === role);
const isMembershipStatus = (status: string): status is MembershipStatus =>
  MEMBERSHIP_STATUSES.some((candidate) => candidate === status);

const uniqueRoles = (roles: readonly string[] | null | undefined): readonly OrganizationRole[] => {
  const normalized = [...new Set(roles ?? [])].sort();
  if (!normalized.length || !normalized.every(isOrganizationRole)) {
    throw new TypeError("Membership roles must contain published organization roles");
  }
  return Object.freeze(normalized);
};

export function createAuthenticatedIdentity({
  provider,
  subject,
  email,
  displayName = null,
}: {
  provider: string;
  subject: string;
  email: string;
  displayName?: string | null;
}): AuthenticatedIdentity {
  const normalizedEmail = required(email, "Identity email").toLowerCase();
  return Object.freeze({
    provider: required(provider, "Identity provider"),
    subject: required(subject, "Identity subject"),
    email: normalizedEmail,
    displayName: displayName == null ? null : displayName.trim() || null,
  });
}

export function createOrganization({
  id,
  name,
  slug,
  createdBy,
  createdAt,
}: {
  id: string;
  name: string;
  slug: string;
  createdBy: string;
  createdAt: string;
}) {
  return Object.freeze({
    id: required(id, "Organization ID"),
    name: required(name, "Organization name"),
    slug: required(slug, "Organization slug").toLowerCase(),
    createdBy: required(createdBy, "Organization creator"),
    createdAt: required(createdAt, "Organization creation time"),
  });
}

export function createOrganizationMembership({
  organizationId,
  userId,
  roles,
  status = "active",
  createdAt,
  updatedAt = createdAt,
}: {
  organizationId: string;
  userId: string;
  roles: readonly string[];
  status?: string;
  createdAt: string;
  updatedAt?: string;
}): OrganizationMembership {
  if (!isMembershipStatus(status)) throw new TypeError("Unsupported membership status");
  return Object.freeze({
    organizationId: required(organizationId, "Organization ID"),
    userId: required(userId, "User ID"),
    roles: uniqueRoles(roles),
    status,
    createdAt: required(createdAt, "Membership creation time"),
    updatedAt: required(updatedAt, "Membership update time"),
  });
}

export function createOrganizationInvitation({
  id,
  organizationId,
  email,
  roles,
  invitedBy,
  createdAt,
  expiresAt,
  acceptedAt = null,
  revokedAt = null,
}: {
  id: string;
  organizationId: string;
  email: string;
  roles: readonly string[];
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
}): OrganizationInvitation {
  const createdMs = Date.parse(createdAt);
  const expiresMs = Date.parse(expiresAt);
  if (!Number.isFinite(createdMs) || !Number.isFinite(expiresMs) || expiresMs <= createdMs)
    throw new TypeError("Invitation expiry must follow creation");
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

export function invitationStatus(
  invitation: Pick<OrganizationInvitation, "revokedAt" | "acceptedAt" | "expiresAt">,
  at: string = new Date().toISOString(),
): InvitationStatus {
  if (invitation.revokedAt) return "revoked";
  if (invitation.acceptedAt) return "accepted";
  if (Date.parse(at) >= Date.parse(invitation.expiresAt)) return "expired";
  return "pending";
}

export function createUserSession({
  id,
  userId,
  createdAt,
  expiresAt,
  revokedAt = null,
  lastSeenAt = createdAt,
}: {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  lastSeenAt?: string;
}): UserSession {
  const ttl = Date.parse(expiresAt) - Date.parse(createdAt);
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

export const sessionStatus = (
  session: Pick<UserSession, "revokedAt" | "expiresAt">,
  at: string = new Date().toISOString(),
): "revoked" | "expired" | "active" =>
  session.revokedAt ? "revoked" : Date.parse(at) >= Date.parse(session.expiresAt) ? "expired" : "active";

export const canAdministerOrganization = (
  membership: Pick<OrganizationMembership, "status" | "roles"> | null | undefined,
): boolean => membership?.status === "active" && membership.roles.includes("organization-administrator");

export const createAccountAuditEvent = ({
  id,
  organizationId,
  type,
  actorUserId,
  targetUserId = null,
  details = {},
  occurredAt,
}: {
  id: string;
  organizationId: string;
  type: string;
  actorUserId: string;
  targetUserId?: string | null;
  details?: Readonly<Record<string, JsonValue>>;
  occurredAt: string;
}) =>
  Object.freeze({
    id: required(id, "Audit event ID"),
    organizationId: required(organizationId, "Organization ID"),
    type: required(type, "Audit event type"),
    actorUserId: required(actorUserId, "Audit actor"),
    targetUserId,
    details: Object.freeze(structuredClone(details)),
    occurredAt: required(occurredAt, "Audit event time"),
    fingerprint: stableFingerprint("account-audit-event", {
      id,
      organizationId,
      type,
      actorUserId,
      targetUserId,
      details,
      occurredAt,
    }),
  });

export const personalOrganizationSlug = (identity: Pick<AuthenticatedIdentity, "provider" | "subject">) =>
  `personal-${stableFingerprint("organization", {
    provider: identity.provider,
    subject: identity.subject,
  }).slice(0, 16)}`;
