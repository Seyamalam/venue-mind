import { applyDatabaseMigrations } from "./database-migrations.ts";
import {
  DEFAULT_SESSION_TTL_MS,
  ORGANIZATION_ROLES,
  canAdministerOrganization,
  createAccountAuditEvent,
  createOrganizationInvitation,
  createOrganizationMembership,
  createUserSession,
  invitationStatus,
  personalOrganizationSlug,
  sessionStatus,
} from "../src/domain/accounts.ts";
import type { JsonValue, OrganizationRole } from "../src/domain/accounts.ts";
import type { AuthenticatedIdentity } from "./authentication.ts";

type IdFactory = (prefix: string) => string;

export type AccountUser = {
  id: string;
  provider: string;
  providerSubject: string;
  email: string;
  displayName: string | null;
  status: "active" | "deleted";
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type AccountContext = {
  user: AccountUser;
  organizations: Array<{ id: string; name: string; slug: string; roles: OrganizationRole[] }>;
};

const randomId: IdFactory = (prefix) => `${prefix}-${globalThis.crypto.randomUUID()}`;
const initializedDatabases = new WeakSet<object>();
const sha256 = async (value: string) =>
  Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isJsonValue = (value: unknown): value is JsonValue =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  (Array.isArray(value) && value.every(isJsonValue)) ||
  (isRecord(value) && Object.values(value).every(isJsonValue));
const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} must be a non-empty string`);
  return value;
};
const optionalString = (value: unknown, field: string): string | null =>
  value == null ? null : requiredString(value, field);
const parseUnknown = (value: unknown, field: string): unknown => {
  if (typeof value !== "string") throw new TypeError(`${field} must be JSON text`);
  const parsed: unknown = JSON.parse(value);
  return parsed;
};
const parseStringArray = (value: unknown, field: string): string[] => {
  const parsed = parseUnknown(value, field);
  if (!Array.isArray(parsed) || !parsed.every((item): item is string => typeof item === "string")) {
    throw new TypeError(`${field} must be an array of strings`);
  }
  return parsed;
};
const isOrganizationRole = (value: unknown): value is OrganizationRole =>
  typeof value === "string" && ORGANIZATION_ROLES.some((role) => role === value);
const parseOrganizationRoles = (value: unknown, field: string): OrganizationRole[] => {
  const parsed = parseUnknown(value, field);
  if (!Array.isArray(parsed) || !parsed.every(isOrganizationRole))
    throw new TypeError(`${field} contains an invalid role`);
  return parsed;
};
const parseJsonValue = (value: unknown, field: string): JsonValue => {
  const parsed = parseUnknown(value, field);
  if (!isJsonValue(parsed)) throw new TypeError(`${field} must contain valid JSON`);
  return parsed;
};

async function ensureSchema(db: D1Database) {
  if (initializedDatabases.has(db)) return;
  await applyDatabaseMigrations(db);
  initializedDatabases.add(db);
}

const mapUser = (row: Record<string, unknown>): AccountUser => ({
  id: String(row.id),
  provider: String(row.identity_provider),
  providerSubject: String(row.provider_subject),
  email: String(row.email),
  displayName: optionalString(row.display_name, "User display name"),
  status: row.status === "deleted" ? "deleted" : "active",
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
  deletedAt: optionalString(row.deleted_at, "User deletion time"),
});

export function createD1AccountRepository(
  db: D1Database,
  { clock = () => new Date().toISOString(), idFactory = randomId, sessionTtlMs = DEFAULT_SESSION_TTL_MS } = {},
) {
  const audit = async (
    organizationId: string,
    type: string,
    actorUserId: string,
    targetUserId: string | null = null,
    details: Readonly<Record<string, JsonValue>> = {},
  ) => {
    const event = createAccountAuditEvent({
      id: idFactory("audit"),
      organizationId,
      type,
      actorUserId,
      targetUserId,
      details,
      occurredAt: clock(),
    });
    await db
      .prepare(
        `INSERT INTO organization_audit_events (id, organization_id, event_type, actor_user_id, target_user_id, details_json, fingerprint, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        event.id,
        organizationId,
        type,
        actorUserId,
        targetUserId,
        JSON.stringify(details),
        event.fingerprint,
        event.occurredAt,
      )
      .run();
    return event;
  };

  const contextForUser = async (userId: string): Promise<AccountContext | null> => {
    await ensureSchema(db);
    const row = await db.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first<Record<string, unknown>>();
    if (!row || row.status !== "active") return null;
    const { results } = await db
      .prepare(
        `SELECT o.id, o.name, o.slug, m.roles_json FROM organizations o
       JOIN organization_memberships m ON m.organization_id = o.id
       WHERE m.user_id = ? AND m.status = 'active' AND o.deleted_at IS NULL ORDER BY o.name`,
      )
      .bind(userId)
      .all<Record<string, unknown>>();
    return {
      user: mapUser(row),
      organizations: results.map((item) => ({
        id: String(item.id),
        name: String(item.name),
        slug: String(item.slug),
        roles: parseOrganizationRoles(item.roles_json, "Membership roles"),
      })),
    };
  };

  return Object.freeze({
    async provision(identity: AuthenticatedIdentity): Promise<AccountContext> {
      await ensureSchema(db);
      const now = clock();
      const row = await db
        .prepare("SELECT * FROM users WHERE identity_provider = ? AND provider_subject = ?")
        .bind(identity.provider, identity.subject)
        .first<Record<string, unknown>>();
      const userId = row ? String(row.id) : idFactory("user");
      if (!row) {
        await db
          .prepare(
            `INSERT INTO users (id, identity_provider, provider_subject, email, display_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
          )
          .bind(userId, identity.provider, identity.subject, identity.email, identity.displayName, now, now)
          .run();
      } else if (row.status !== "active") {
        throw new Error("ACCOUNT_UNAVAILABLE");
      } else if (row.email !== identity.email || row.display_name !== identity.displayName) {
        await db
          .prepare("UPDATE users SET email = ?, display_name = ?, updated_at = ? WHERE id = ?")
          .bind(identity.email, identity.displayName, now, userId)
          .run();
      }
      let context = await contextForUser(userId);
      if (!context?.organizations.length) {
        const organizationId = idFactory("org");
        const slug = personalOrganizationSlug(identity);
        const name = identity.displayName ?? identity.email.split("@")[0] ?? identity.email;
        await db.batch([
          db
            .prepare(
              `INSERT INTO organizations (id, name, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(organizationId, name, slug, userId, now, now),
          db
            .prepare(
              `INSERT INTO organization_memberships (organization_id, user_id, roles_json, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`,
            )
            .bind(
              organizationId,
              userId,
              JSON.stringify(["organization-administrator", "venue-administrator"]),
              now,
              now,
            ),
        ]);
        await audit(organizationId, "membership.created", userId, userId, {
          roles: ["organization-administrator", "venue-administrator"],
          source: "provisioning",
        });
        context = await contextForUser(userId);
      }
      if (!context) throw new Error("ACCOUNT_UNAVAILABLE");
      return context;
    },

    contextForUser,

    async createSession(userId: string) {
      await ensureSchema(db);
      const createdAt = clock();
      const session = createUserSession({
        id: idFactory("session"),
        userId,
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + sessionTtlMs).toISOString(),
      });
      await db
        .prepare(
          `INSERT INTO user_sessions (id, user_id, created_at, expires_at, revoked_at, last_seen_at) VALUES (?, ?, ?, ?, NULL, ?)`,
        )
        .bind(session.id, userId, session.createdAt, session.expiresAt, session.lastSeenAt)
        .run();
      return session;
    },

    async resolveSession(sessionId: string) {
      await ensureSchema(db);
      const row = await db
        .prepare("SELECT * FROM user_sessions WHERE id = ?")
        .bind(sessionId)
        .first<Record<string, unknown>>();
      if (!row) return null;
      const session = createUserSession({
        id: String(row.id),
        userId: String(row.user_id),
        createdAt: String(row.created_at),
        expiresAt: String(row.expires_at),
        revokedAt: optionalString(row.revoked_at, "Session revocation time"),
        lastSeenAt: String(row.last_seen_at),
      });
      if (sessionStatus(session, clock()) !== "active") return null;
      await db.prepare("UPDATE user_sessions SET last_seen_at = ? WHERE id = ?").bind(clock(), sessionId).run();
      const context = await contextForUser(session.userId);
      return context ? { session, ...context } : null;
    },

    async revokeSession(sessionId: string) {
      await ensureSchema(db);
      await db
        .prepare("UPDATE user_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
        .bind(clock(), sessionId)
        .run();
    },

    async createOrganization(userId: string, { name, slug }: { name: string; slug: string }) {
      await ensureSchema(db);
      const now = clock();
      const organizationId = idFactory("org");
      await db.batch([
        db
          .prepare(
            `INSERT INTO organizations (id, name, slug, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(organizationId, name.trim(), slug.trim().toLowerCase(), userId, now, now),
        db
          .prepare(
            `INSERT INTO organization_memberships (organization_id, user_id, roles_json, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)`,
          )
          .bind(
            organizationId,
            userId,
            JSON.stringify(["organization-administrator", "venue-administrator"]),
            now,
            now,
          ),
      ]);
      await audit(organizationId, "organization.created", userId, userId, {
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
      });
      return (await contextForUser(userId))?.organizations.find((organization) => organization.id === organizationId);
    },

    async membership(organizationId: string, userId: string) {
      await ensureSchema(db);
      const row = await db
        .prepare("SELECT * FROM organization_memberships WHERE organization_id = ? AND user_id = ?")
        .bind(organizationId, userId)
        .first<Record<string, unknown>>();
      return row
        ? createOrganizationMembership({
            organizationId,
            userId,
            roles: parseStringArray(row.roles_json, "Membership roles"),
            status: String(row.status),
            createdAt: String(row.created_at),
            updatedAt: String(row.updated_at),
          })
        : null;
    },

    async listMemberships(organizationId: string) {
      await ensureSchema(db);
      const { results } = await db
        .prepare(
          `SELECT m.*, u.email, u.display_name FROM organization_memberships m JOIN users u ON u.id = m.user_id WHERE m.organization_id = ? ORDER BY u.email`,
        )
        .bind(organizationId)
        .all<Record<string, unknown>>();
      return results.map((row) => ({
        userId: String(row.user_id),
        email: String(row.email),
        displayName: optionalString(row.display_name, "Member display name"),
        roles: parseStringArray(row.roles_json, "Membership roles"),
        status: String(row.status),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
      }));
    },

    async setMembershipRoles(organizationId: string, actorUserId: string, targetUserId: string, roles: string[]) {
      await ensureSchema(db);
      const membership = createOrganizationMembership({
        organizationId,
        userId: targetUserId,
        roles,
        createdAt: clock(),
      });
      await db
        .prepare(
          "UPDATE organization_memberships SET roles_json = ?, status = 'active', updated_at = ? WHERE organization_id = ? AND user_id = ?",
        )
        .bind(JSON.stringify(membership.roles), clock(), organizationId, targetUserId)
        .run();
      await audit(organizationId, "membership.roles_changed", actorUserId, targetUserId, { roles: membership.roles });
      return this.membership(organizationId, targetUserId);
    },

    async removeMembership(organizationId: string, actorUserId: string, targetUserId: string) {
      await ensureSchema(db);
      await db
        .prepare(
          "UPDATE organization_memberships SET status = 'suspended', updated_at = ? WHERE organization_id = ? AND user_id = ?",
        )
        .bind(clock(), organizationId, targetUserId)
        .run();
      await audit(organizationId, "membership.removed", actorUserId, targetUserId);
    },

    async createInvitation(
      organizationId: string,
      actorUserId: string,
      { email, roles, expiresAt }: { email: string; roles: string[]; expiresAt: string },
    ) {
      await ensureSchema(db);
      const token = `${idFactory("invite-token")}.${idFactory("secret")}`;
      const invitation = createOrganizationInvitation({
        id: idFactory("invite"),
        organizationId,
        email,
        roles,
        invitedBy: actorUserId,
        createdAt: clock(),
        expiresAt,
      });
      await db
        .prepare(
          `INSERT INTO organization_invitations (id, organization_id, email, roles_json, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          invitation.id,
          organizationId,
          invitation.email,
          JSON.stringify(invitation.roles),
          await sha256(token),
          actorUserId,
          invitation.createdAt,
          invitation.expiresAt,
        )
        .run();
      await audit(organizationId, "invitation.created", actorUserId, null, {
        invitationId: invitation.id,
        email: invitation.email,
        roles: invitation.roles,
      });
      return { invitation, token };
    },

    async acceptInvitation(userId: string, email: string, token: string) {
      await ensureSchema(db);
      const row = await db
        .prepare("SELECT * FROM organization_invitations WHERE token_hash = ?")
        .bind(await sha256(token))
        .first<Record<string, unknown>>();
      if (!row) throw new Error("INVITATION_INVALID");
      const invitation = createOrganizationInvitation({
        id: String(row.id),
        organizationId: String(row.organization_id),
        email: String(row.email),
        roles: parseStringArray(row.roles_json, "Invitation roles"),
        invitedBy: String(row.invited_by),
        createdAt: String(row.created_at),
        expiresAt: String(row.expires_at),
        acceptedAt: optionalString(row.accepted_at, "Invitation acceptance time"),
        revokedAt: optionalString(row.revoked_at, "Invitation revocation time"),
      });
      if (invitation.email !== email.toLowerCase() || invitationStatus(invitation, clock()) !== "pending")
        throw new Error("INVITATION_INVALID");
      const now = clock();
      await db.batch([
        db
          .prepare(
            `INSERT INTO organization_memberships (organization_id, user_id, roles_json, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?) ON CONFLICT(organization_id, user_id) DO UPDATE SET roles_json = excluded.roles_json, status = 'active', updated_at = excluded.updated_at`,
          )
          .bind(invitation.organizationId, userId, JSON.stringify(invitation.roles), now, now),
        db.prepare("UPDATE organization_invitations SET accepted_at = ? WHERE id = ?").bind(now, invitation.id),
      ]);
      await audit(invitation.organizationId, "invitation.accepted", userId, userId, {
        invitationId: invitation.id,
        roles: invitation.roles,
      });
      return this.membership(invitation.organizationId, userId);
    },

    async auditEvents(organizationId: string) {
      await ensureSchema(db);
      const { results } = await db
        .prepare("SELECT * FROM organization_audit_events WHERE organization_id = ? ORDER BY occurred_at DESC")
        .bind(organizationId)
        .all<Record<string, unknown>>();
      return results.map((row) => ({
        id: String(row.id),
        organizationId,
        type: String(row.event_type),
        actorUserId: String(row.actor_user_id),
        targetUserId: optionalString(row.target_user_id, "Audit target user ID"),
        details: parseJsonValue(row.details_json, "Audit details"),
        fingerprint: String(row.fingerprint),
        occurredAt: String(row.occurred_at),
      }));
    },

    async exportAccount(userId: string) {
      const context = await contextForUser(userId);
      if (!context) throw new Error("ACCOUNT_UNAVAILABLE");
      const memberships = await Promise.all(
        context.organizations.map((organization) => this.listMemberships(organization.id)),
      );
      const auditLogs = await Promise.all(
        context.organizations.map((organization) => this.auditEvents(organization.id)),
      );
      return {
        schemaVersion: 1,
        exportedAt: clock(),
        user: context.user,
        organizations: context.organizations,
        memberships: memberships.flat().filter((membership) => membership.userId === userId),
        auditEvents: auditLogs.flat().filter((event) => event.actorUserId === userId || event.targetUserId === userId),
      };
    },

    async requestAccountDeletion(userId: string) {
      await ensureSchema(db);
      const now = clock();
      const request = { id: idFactory("deletion"), userId, requestedAt: now, completedAt: now, status: "completed" };
      await db.batch([
        db
          .prepare(
            "INSERT INTO account_deletion_requests (id, user_id, requested_at, completed_at, status) VALUES (?, ?, ?, ?, ?)",
          )
          .bind(request.id, userId, now, now, request.status),
        db
          .prepare("UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL")
          .bind(now, userId),
        db
          .prepare("UPDATE organization_memberships SET status = 'suspended', updated_at = ? WHERE user_id = ?")
          .bind(now, userId),
        db
          .prepare(
            "UPDATE users SET email = ?, display_name = NULL, status = 'deleted', deleted_at = ?, updated_at = ? WHERE id = ?",
          )
          .bind(`deleted+${userId}@invalid`, now, now, userId),
      ]);
      return request;
    },
  });
}

export const isOrganizationAdministrator = canAdministerOrganization;

export function createMemoryAccountRepository({
  clock = () => new Date().toISOString(),
  idFactory = randomId,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
} = {}) {
  const users = new Map<string, AccountUser>();
  const identities = new Map<string, string>();
  const organizations = new Map<
    string,
    { id: string; name: string; slug: string; createdBy: string; createdAt: string }
  >();
  const memberships = new Map<string, ReturnType<typeof createOrganizationMembership>>();
  const sessions = new Map<string, ReturnType<typeof createUserSession>>();
  const invitations = new Map<
    string,
    { invitation: ReturnType<typeof createOrganizationInvitation>; tokenHash: string }
  >();
  const events: ReturnType<typeof createAccountAuditEvent>[] = [];
  const key = (organizationId: string, userId: string) => `${organizationId}:${userId}`;
  const contextForUser = async (userId: string): Promise<AccountContext | null> => {
    const user = users.get(userId);
    if (!user || user.status !== "active") return null;
    const memberOrganizations = [...memberships.values()]
      .filter((membership) => membership.userId === userId && membership.status === "active")
      .map((membership) => {
        const organization = organizations.get(membership.organizationId);
        if (!organization) throw new Error("ORGANIZATION_NOT_FOUND");
        return { id: organization.id, name: organization.name, slug: organization.slug, roles: [...membership.roles] };
      })
      .sort((left, right) => left.name.localeCompare(right.name));
    return { user: structuredClone(user), organizations: memberOrganizations };
  };
  const audit = (
    organizationId: string,
    type: string,
    actorUserId: string,
    targetUserId: string | null = null,
    details: Readonly<Record<string, JsonValue>> = {},
  ) => {
    const event = createAccountAuditEvent({
      id: idFactory("audit"),
      organizationId,
      type,
      actorUserId,
      targetUserId,
      details,
      occurredAt: clock(),
    });
    events.push(event);
    return event;
  };

  const repository = {
    async provision(identity: AuthenticatedIdentity) {
      const identityKey = `${identity.provider}:${identity.subject}`;
      let userId = identities.get(identityKey);
      if (!userId) {
        userId = idFactory("user");
        const now = clock();
        users.set(userId, {
          id: userId,
          provider: identity.provider,
          providerSubject: identity.subject,
          email: identity.email,
          displayName: identity.displayName,
          status: "active",
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        });
        identities.set(identityKey, userId);
      }
      const user = users.get(userId);
      if (!user) throw new Error("ACCOUNT_UNAVAILABLE");
      if (user.status !== "active") throw new Error("ACCOUNT_UNAVAILABLE");
      user.email = identity.email;
      user.displayName = identity.displayName;
      let context = await contextForUser(userId);
      if (!context?.organizations.length) {
        const now = clock();
        const organizationId = idFactory("org");
        organizations.set(organizationId, {
          id: organizationId,
          name: identity.displayName || identity.email.split("@")[0] || identity.email,
          slug: personalOrganizationSlug(identity),
          createdBy: userId,
          createdAt: now,
        });
        memberships.set(
          key(organizationId, userId),
          createOrganizationMembership({
            organizationId,
            userId,
            roles: ["organization-administrator", "venue-administrator"],
            createdAt: now,
          }),
        );
        audit(organizationId, "membership.created", userId, userId, {
          roles: ["organization-administrator", "venue-administrator"],
          source: "provisioning",
        });
        context = await contextForUser(userId);
      }
      if (!context) throw new Error("ACCOUNT_UNAVAILABLE");
      return context;
    },
    contextForUser,
    async createSession(userId: string) {
      const createdAt = clock();
      const session = createUserSession({
        id: idFactory("session"),
        userId,
        createdAt,
        expiresAt: new Date(Date.parse(createdAt) + sessionTtlMs).toISOString(),
      });
      sessions.set(session.id, session);
      return session;
    },
    async resolveSession(sessionId: string) {
      const session = sessions.get(sessionId);
      if (!session || sessionStatus(session, clock()) !== "active") return null;
      const context = await contextForUser(session.userId);
      return context ? { session, ...context } : null;
    },
    async revokeSession(sessionId: string) {
      const session = sessions.get(sessionId);
      if (session) sessions.set(sessionId, createUserSession({ ...session, revokedAt: clock() }));
    },
    async createOrganization(userId: string, { name, slug }: { name: string; slug: string }) {
      if ([...organizations.values()].some((organization) => organization.slug === slug))
        throw new Error("ORGANIZATION_SLUG_CONFLICT");
      const now = clock();
      const organization = {
        id: idFactory("org"),
        name: name.trim(),
        slug: slug.trim().toLowerCase(),
        createdBy: userId,
        createdAt: now,
      };
      organizations.set(organization.id, organization);
      memberships.set(
        key(organization.id, userId),
        createOrganizationMembership({
          organizationId: organization.id,
          userId,
          roles: ["organization-administrator", "venue-administrator"],
          createdAt: now,
        }),
      );
      audit(organization.id, "organization.created", userId, userId, {
        name: organization.name,
        slug: organization.slug,
      });
      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        roles: ["organization-administrator", "venue-administrator"],
      };
    },
    async membership(organizationId: string, userId: string) {
      return memberships.get(key(organizationId, userId)) ?? null;
    },
    async listMemberships(organizationId: string) {
      return [...memberships.values()]
        .filter((membership) => membership.organizationId === organizationId)
        .map((membership) => {
          const user = users.get(membership.userId);
          if (!user) throw new Error("ACCOUNT_UNAVAILABLE");
          return {
            userId: user.id,
            email: user.email,
            displayName: user.displayName,
            roles: [...membership.roles],
            status: membership.status,
            createdAt: membership.createdAt,
            updatedAt: membership.updatedAt,
          };
        });
    },
    async setMembershipRoles(organizationId: string, actorUserId: string, targetUserId: string, roles: string[]) {
      const prior = memberships.get(key(organizationId, targetUserId));
      if (!prior) throw new Error("MEMBERSHIP_NOT_FOUND");
      const next = createOrganizationMembership({ ...prior, roles, status: "active", updatedAt: clock() });
      memberships.set(key(organizationId, targetUserId), next);
      audit(organizationId, "membership.roles_changed", actorUserId, targetUserId, { roles: next.roles });
      return next;
    },
    async removeMembership(organizationId: string, actorUserId: string, targetUserId: string) {
      const prior = memberships.get(key(organizationId, targetUserId));
      if (!prior) return;
      memberships.set(
        key(organizationId, targetUserId),
        createOrganizationMembership({ ...prior, status: "suspended", updatedAt: clock() }),
      );
      audit(organizationId, "membership.removed", actorUserId, targetUserId);
    },
    async createInvitation(
      organizationId: string,
      actorUserId: string,
      { email, roles, expiresAt }: { email: string; roles: string[]; expiresAt: string },
    ) {
      const token = `${idFactory("invite-token")}.${idFactory("secret")}`;
      const invitation = createOrganizationInvitation({
        id: idFactory("invite"),
        organizationId,
        email,
        roles,
        invitedBy: actorUserId,
        createdAt: clock(),
        expiresAt,
      });
      invitations.set(invitation.id, { invitation, tokenHash: await sha256(token) });
      audit(organizationId, "invitation.created", actorUserId, null, {
        invitationId: invitation.id,
        email: invitation.email,
        roles: invitation.roles,
      });
      return { invitation, token };
    },
    async acceptInvitation(userId: string, email: string, token: string) {
      const tokenHash = await sha256(token);
      const entry = [...invitations.values()].find((candidate) => candidate.tokenHash === tokenHash);
      if (
        !entry ||
        entry.invitation.email !== email.toLowerCase() ||
        invitationStatus(entry.invitation, clock()) !== "pending"
      )
        throw new Error("INVITATION_INVALID");
      const now = clock();
      const membership = createOrganizationMembership({
        organizationId: entry.invitation.organizationId,
        userId,
        roles: entry.invitation.roles,
        createdAt: now,
      });
      memberships.set(key(membership.organizationId, userId), membership);
      invitations.set(entry.invitation.id, {
        ...entry,
        invitation: createOrganizationInvitation({ ...entry.invitation, acceptedAt: now }),
      });
      audit(membership.organizationId, "invitation.accepted", userId, userId, {
        invitationId: entry.invitation.id,
        roles: entry.invitation.roles,
      });
      return membership;
    },
    async auditEvents(organizationId: string) {
      return events.filter((event) => event.organizationId === organizationId).map((event) => structuredClone(event));
    },
    async exportAccount(userId: string) {
      const context = await contextForUser(userId);
      if (!context) throw new Error("ACCOUNT_UNAVAILABLE");
      return {
        schemaVersion: 1,
        exportedAt: clock(),
        user: context.user,
        organizations: context.organizations,
        memberships: [...memberships.values()].filter((membership) => membership.userId === userId),
        auditEvents: events.filter((event) => event.actorUserId === userId || event.targetUserId === userId),
      };
    },
    async requestAccountDeletion(userId: string) {
      const now = clock();
      for (const [id, session] of sessions)
        if (session.userId === userId) sessions.set(id, createUserSession({ ...session, revokedAt: now }));
      for (const [id, membership] of memberships)
        if (membership.userId === userId)
          memberships.set(id, createOrganizationMembership({ ...membership, status: "suspended", updatedAt: now }));
      const user = users.get(userId);
      if (!user) throw new Error("ACCOUNT_UNAVAILABLE");
      users.set(userId, {
        ...user,
        email: `deleted+${userId}@invalid`,
        displayName: null,
        status: "deleted",
        deletedAt: now,
        updatedAt: now,
      });
      return { id: idFactory("deletion"), userId, requestedAt: now, completedAt: now, status: "completed" };
    },
  };
  return Object.freeze(repository);
}
