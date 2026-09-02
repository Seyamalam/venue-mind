import { ORGANIZATION_ROLES, type MembershipStatus, type OrganizationRole } from "../domain/accounts";

const ACTIVE_ORGANIZATION_KEY = "venuemind.active-organization";

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

export interface AccountUser {
  id: string;
  email: string;
  displayName: string;
}
export interface AccountOrganization {
  id: string;
  name: string;
  slug: string;
  roles: readonly OrganizationRole[];
}
export interface AccountMembership {
  userId: string;
  email: string;
  displayName: string | null;
  roles: readonly OrganizationRole[];
  status: MembershipStatus;
  createdAt: string;
  updatedAt: string;
}
export interface AccountAuditEvent {
  id: string;
  organizationId: string;
  type: string;
  actorUserId: string;
  targetUserId: string | null;
  details: JsonObject;
  fingerprint: string;
  occurredAt: string;
}
export interface AccountSnapshot {
  status: "loading" | "ready" | "unauthenticated";
  source: "remote" | "local";
  user: AccountUser | null;
  organizations: readonly AccountOrganization[];
  activeOrganizationId: string | null;
  errorCode: string | null;
}

class AccountRequestError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "AccountRequestError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isRole = (value: unknown): value is OrganizationRole =>
  typeof value === "string" && ORGANIZATION_ROLES.some((role) => role === value);
const requiredString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim())
    throw new AccountRequestError(`Invalid ${field}`, "ACCOUNT_RESPONSE_INVALID");
  return value;
};
const decodeOrganization = (value: unknown): AccountOrganization => {
  if (!isObject(value) || !Array.isArray(value["roles"]) || !value["roles"].every(isRole))
    throw new AccountRequestError("Invalid organization response", "ACCOUNT_RESPONSE_INVALID");
  return Object.freeze({
    id: requiredString(value["id"], "organization.id"),
    name: requiredString(value["name"], "organization.name"),
    slug: requiredString(value["slug"], "organization.slug"),
    roles: Object.freeze([...value["roles"]]),
  });
};
const decodeMembership = (value: unknown): AccountMembership => {
  if (!isObject(value) || !Array.isArray(value["roles"]) || !value["roles"].every(isRole))
    throw new AccountRequestError("Invalid membership response", "ACCOUNT_RESPONSE_INVALID");
  const status = value["status"];
  if (status !== "active" && status !== "suspended")
    throw new AccountRequestError("Invalid membership status", "ACCOUNT_RESPONSE_INVALID");
  return {
    userId: requiredString(value["userId"], "membership.userId"),
    email: requiredString(value["email"], "membership.email"),
    displayName: value["displayName"] === null ? null : requiredString(value["displayName"], "membership.displayName"),
    roles: [...value["roles"]],
    status,
    createdAt: requiredString(value["createdAt"], "membership.createdAt"),
    updatedAt: requiredString(value["updatedAt"], "membership.updatedAt"),
  };
};
const decodeMembershipList = (value: unknown): { memberships: AccountMembership[] } => {
  if (!isObject(value) || !Array.isArray(value["memberships"]))
    throw new AccountRequestError("Invalid membership list", "ACCOUNT_RESPONSE_INVALID");
  return { memberships: value["memberships"].map(decodeMembership) };
};
const decodeAuditEvent = (value: unknown): AccountAuditEvent => {
  if (!isObject(value)) throw new AccountRequestError("Invalid audit event", "ACCOUNT_RESPONSE_INVALID");
  return {
    id: requiredString(value["id"], "audit.id"),
    organizationId: requiredString(value["organizationId"], "audit.organizationId"),
    type: requiredString(value["type"], "audit.type"),
    actorUserId: requiredString(value["actorUserId"], "audit.actorUserId"),
    targetUserId: value["targetUserId"] === null ? null : requiredString(value["targetUserId"], "audit.targetUserId"),
    details: decodeJsonObject(value["details"]),
    fingerprint: requiredString(value["fingerprint"], "audit.fingerprint"),
    occurredAt: requiredString(value["occurredAt"], "audit.occurredAt"),
  };
};
const decodeAuditList = (value: unknown): { events: AccountAuditEvent[] } => {
  if (!isObject(value) || !Array.isArray(value["events"]))
    throw new AccountRequestError("Invalid audit list", "ACCOUNT_RESPONSE_INVALID");
  return { events: value["events"].map(decodeAuditEvent) };
};
const decodeInvitation = (value: unknown): { token: string; invitation: JsonObject } => {
  if (!isObject(value)) throw new AccountRequestError("Invalid invitation", "ACCOUNT_RESPONSE_INVALID");
  return {
    token: requiredString(value["token"], "invitation.token"),
    invitation: decodeJsonObject(value["invitation"]),
  };
};
const decodeUser = (value: unknown): AccountUser => {
  if (!isObject(value)) throw new AccountRequestError("Invalid user response", "ACCOUNT_RESPONSE_INVALID");
  return Object.freeze({
    id: requiredString(value["id"], "user.id"),
    email: requiredString(value["email"], "user.email"),
    displayName: requiredString(value["displayName"], "user.displayName"),
  });
};
const decodeSession = (value: unknown): Omit<AccountSnapshot, "status" | "source" | "errorCode"> => {
  if (!isObject(value) || !Array.isArray(value["organizations"]))
    throw new AccountRequestError("Invalid session response", "ACCOUNT_RESPONSE_INVALID");
  return {
    user: value["user"] === null ? null : decodeUser(value["user"]),
    organizations: value["organizations"].map(decodeOrganization),
    activeOrganizationId:
      value["activeOrganizationId"] === null
        ? null
        : requiredString(value["activeOrganizationId"], "activeOrganizationId"),
  };
};
const decodeJsonValue = (value: unknown): JsonValue => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value)) return value.map(decodeJsonValue);
  if (!isObject(value)) throw new AccountRequestError("Invalid account response", "ACCOUNT_RESPONSE_INVALID");
  const output: JsonObject = {};
  for (const [key, item] of Object.entries(value)) output[key] = decodeJsonValue(item);
  return output;
};
const decodeJsonObject = (value: unknown): JsonObject => {
  const decoded = decodeJsonValue(value);
  if (decoded === null || Array.isArray(decoded) || typeof decoded !== "object")
    throw new AccountRequestError("Invalid account response", "ACCOUNT_RESPONSE_INVALID");
  return decoded;
};
const safeJson = async (response: Response): Promise<unknown> => {
  if (!(response.headers.get("content-type") ?? "").includes("application/json"))
    throw new AccountRequestError("Account endpoint unavailable", "ACCOUNT_API_UNAVAILABLE");
  const value: unknown = await response.json();
  if (!response.ok) {
    const errorRecord = isObject(value) ? value : {};
    throw new AccountRequestError(
      typeof errorRecord["error"] === "string" ? errorRecord["error"] : "Account request failed",
      typeof errorRecord["code"] === "string" ? errorRecord["code"] : "ACCOUNT_REQUEST_FAILED",
    );
  }
  return value;
};

export interface AccountStoreOptions {
  fetchImpl?: typeof globalThis.fetch;
  storage?: Storage;
}

export function createAccountStore({
  fetchImpl = globalThis.fetch.bind(globalThis),
  storage = typeof window === "undefined" ? undefined : window.localStorage,
}: AccountStoreOptions = {}) {
  let snapshot: Readonly<AccountSnapshot> = Object.freeze({
    status: "loading",
    source: "remote",
    user: null,
    organizations: [],
    activeOrganizationId: null,
    errorCode: null,
  });
  let loading: Promise<Readonly<AccountSnapshot>> | null = null;
  const listeners = new Set<() => void>();
  const emit = (next: AccountSnapshot) => {
    snapshot = Object.freeze(next);
    listeners.forEach((listener) => listener());
  };
  const localFallback = () => {
    const organization: AccountOrganization = Object.freeze({
      id: "org-local",
      name: "LOCAL",
      slug: "local",
      roles: Object.freeze(["organization-administrator", "venue-administrator"] as const),
    });
    emit({
      status: "ready",
      source: "local",
      user: { id: "user-local", email: "local@venuemind.invalid", displayName: "LOCAL" },
      organizations: [organization],
      activeOrganizationId: organization.id,
      errorCode: null,
    });
    return snapshot;
  };
  const headers = (organizationId: string | null, extra: HeadersInit = {}): HeadersInit => {
    const result: Record<string, string> = {};
    new Headers(extra).forEach((value, name) => {
      result[name] = value;
    });
    if (organizationId) result["x-venuemind-organization-id"] = organizationId;
    return result;
  };

  return Object.freeze({
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    async load() {
      if (loading) return loading;
      loading = (async () => {
        try {
          const preferred = storage?.getItem(ACTIVE_ORGANIZATION_KEY) || null;
          const first = decodeSession(
            await safeJson(
              await fetchImpl("/api/session", {
                credentials: "same-origin",
                headers: headers(preferred, { accept: "application/json" }),
              }),
            ),
          );
          const activeOrganizationId = first.organizations.some((organization) => organization.id === preferred)
            ? preferred
            : first.activeOrganizationId;
          if (activeOrganizationId) storage?.setItem(ACTIVE_ORGANIZATION_KEY, activeOrganizationId);
          emit({ status: "ready", source: "remote", ...first, activeOrganizationId, errorCode: null });
          return snapshot;
        } catch (error) {
          if (error instanceof AccountRequestError && error.code === "AUTHENTICATION_REQUIRED") {
            emit({
              status: "unauthenticated",
              source: "remote",
              user: null,
              organizations: [],
              activeOrganizationId: null,
              errorCode: error.code,
            });
            return snapshot;
          }
          return localFallback();
        }
      })().finally(() => {
        loading = null;
      });
      return loading;
    },
    selectOrganization(organizationId: string) {
      if (!snapshot.organizations.some((organization) => organization.id === organizationId))
        throw new AccountRequestError("Organization access denied", "ORGANIZATION_ACCESS_DENIED");
      storage?.setItem(ACTIVE_ORGANIZATION_KEY, organizationId);
      emit({ ...snapshot, activeOrganizationId: organizationId });
    },
    async createOrganization({ name, slug }: { name: string; slug: string }) {
      const organization = decodeOrganization(
        await safeJson(
          await fetchImpl("/api/organizations", {
            method: "POST",
            credentials: "same-origin",
            headers: headers(snapshot.activeOrganizationId, {
              "content-type": "application/json",
              accept: "application/json",
            }),
            body: JSON.stringify({ name, slug }),
          }),
        ),
      );
      emit({
        ...snapshot,
        organizations: [...snapshot.organizations, organization],
        activeOrganizationId: organization.id,
      });
      storage?.setItem(ACTIVE_ORGANIZATION_KEY, organization.id);
      return organization;
    },
    async listMemberships() {
      return decodeMembershipList(
        await safeJson(
          await fetchImpl("/api/memberships", {
            credentials: "same-origin",
            headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }),
          }),
        ),
      );
    },
    async inviteMember({
      email,
      roles,
      expiresAt,
    }: {
      email: string;
      roles: readonly OrganizationRole[];
      expiresAt: string;
    }) {
      return decodeInvitation(
        await safeJson(
          await fetchImpl("/api/invitations", {
            method: "POST",
            credentials: "same-origin",
            headers: headers(snapshot.activeOrganizationId, {
              "content-type": "application/json",
              accept: "application/json",
            }),
            body: JSON.stringify({ email, roles, expiresAt }),
          }),
        ),
      );
    },
    async acceptInvitation(token: string) {
      const membership = decodeJsonObject(
        await safeJson(
          await fetchImpl("/api/invitations/accept", {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ token }),
          }),
        ),
      );
      await this.load();
      return membership;
    },
    async setMembershipRoles(userId: string, roles: readonly OrganizationRole[]) {
      return decodeJsonValue(
        await safeJson(
          await fetchImpl(`/api/memberships/${encodeURIComponent(userId)}`, {
            method: "PATCH",
            credentials: "same-origin",
            headers: headers(snapshot.activeOrganizationId, {
              "content-type": "application/json",
              accept: "application/json",
            }),
            body: JSON.stringify({ roles }),
          }),
        ),
      );
    },
    async removeMembership(userId: string) {
      return decodeJsonObject(
        await safeJson(
          await fetchImpl(`/api/memberships/${encodeURIComponent(userId)}`, {
            method: "DELETE",
            credentials: "same-origin",
            headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }),
          }),
        ),
      );
    },
    async organizationAudit() {
      return decodeAuditList(
        await safeJson(
          await fetchImpl("/api/organization-audit", {
            credentials: "same-origin",
            headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }),
          }),
        ),
      );
    },
    async revokeSession() {
      await safeJson(
        await fetchImpl("/api/session/revoke", {
          method: "POST",
          credentials: "same-origin",
          headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }),
        }),
      );
      emit({
        status: "unauthenticated",
        source: "remote",
        user: null,
        organizations: [],
        activeOrganizationId: null,
        errorCode: "SESSION_REVOKED",
      });
    },
    async exportAccount() {
      return decodeJsonObject(
        await safeJson(
          await fetchImpl("/api/account/export", {
            credentials: "same-origin",
            headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }),
          }),
        ),
      );
    },
    async deleteAccount() {
      const result = decodeJsonObject(
        await safeJson(
          await fetchImpl("/api/account", {
            method: "DELETE",
            credentials: "same-origin",
            headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }),
          }),
        ),
      );
      emit({
        status: "unauthenticated",
        source: "remote",
        user: null,
        organizations: [],
        activeOrganizationId: null,
        errorCode: "ACCOUNT_DELETED",
      });
      return result;
    },
  });
}
