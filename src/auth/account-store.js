const ACTIVE_ORGANIZATION_KEY = "venuemind.active-organization";

const safeJson = async (response) => {
  if (!(response.headers.get("content-type") ?? "").includes("application/json")) throw new Error("ACCOUNT_API_UNAVAILABLE");
  const value = await response.json();
  if (!response.ok) {
    const error = new Error(value.error ?? "Account request failed");
    error.code = value.code ?? "ACCOUNT_REQUEST_FAILED";
    throw error;
  }
  return value;
};

export function createAccountStore({ fetchImpl = globalThis.fetch?.bind(globalThis), storage = globalThis.localStorage } = {}) {
  let snapshot = Object.freeze({ status: "loading", source: "remote", user: null, organizations: [], activeOrganizationId: null, errorCode: null });
  let loading = null;
  const listeners = new Set();
  const emit = (next) => { snapshot = Object.freeze(next); listeners.forEach((listener) => listener()); };
  const localFallback = () => {
    const organization = Object.freeze({ id: "org-local", name: "LOCAL", slug: "local", roles: Object.freeze(["organization-administrator"]) });
    emit({ status: "ready", source: "local", user: { id: "user-local", email: "local@venuemind.invalid", displayName: "LOCAL" }, organizations: [organization], activeOrganizationId: organization.id, errorCode: null });
    return snapshot;
  };
  const headers = (organizationId, extra = {}) => ({ ...extra, ...(organizationId ? { "x-venuemind-organization-id": organizationId } : {}) });

  return Object.freeze({
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => snapshot,
    async load() {
      if (loading) return loading;
      loading = (async () => {
        try {
          const preferred = storage?.getItem(ACTIVE_ORGANIZATION_KEY) || null;
          const first = await safeJson(await fetchImpl("/api/session", { credentials: "same-origin", headers: headers(preferred, { accept: "application/json" }) }));
          const activeOrganizationId = first.organizations.some((organization) => organization.id === preferred) ? preferred : first.activeOrganizationId;
          if (activeOrganizationId) storage?.setItem(ACTIVE_ORGANIZATION_KEY, activeOrganizationId);
          emit({ status: "ready", source: "remote", ...first, activeOrganizationId, errorCode: null });
          return snapshot;
        } catch (error) {
          if (error?.code === "AUTHENTICATION_REQUIRED") {
            emit({ status: "unauthenticated", source: "remote", user: null, organizations: [], activeOrganizationId: null, errorCode: error.code });
            return snapshot;
          }
          return localFallback();
        }
      })().finally(() => { loading = null; });
      return loading;
    },
    selectOrganization(organizationId) {
      if (!snapshot.organizations.some((organization) => organization.id === organizationId)) throw new Error("ORGANIZATION_ACCESS_DENIED");
      storage?.setItem(ACTIVE_ORGANIZATION_KEY, organizationId);
      emit({ ...snapshot, activeOrganizationId: organizationId });
    },
    async createOrganization({ name, slug }) {
      const organization = await safeJson(await fetchImpl("/api/organizations", { method: "POST", credentials: "same-origin", headers: headers(snapshot.activeOrganizationId, { "content-type": "application/json", accept: "application/json" }), body: JSON.stringify({ name, slug }) }));
      emit({ ...snapshot, organizations: [...snapshot.organizations, organization], activeOrganizationId: organization.id });
      storage?.setItem(ACTIVE_ORGANIZATION_KEY, organization.id);
      return organization;
    },
    async listMemberships() {
      return safeJson(await fetchImpl("/api/memberships", { credentials: "same-origin", headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }) }));
    },
    async inviteMember({ email, roles, expiresAt }) {
      return safeJson(await fetchImpl("/api/invitations", { method: "POST", credentials: "same-origin", headers: headers(snapshot.activeOrganizationId, { "content-type": "application/json", accept: "application/json" }), body: JSON.stringify({ email, roles, expiresAt }) }));
    },
    async acceptInvitation(token) {
      const membership = await safeJson(await fetchImpl("/api/invitations/accept", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ token }) }));
      await this.load();
      return membership;
    },
    async setMembershipRoles(userId, roles) {
      return safeJson(await fetchImpl(`/api/memberships/${encodeURIComponent(userId)}`, { method: "PATCH", credentials: "same-origin", headers: headers(snapshot.activeOrganizationId, { "content-type": "application/json", accept: "application/json" }), body: JSON.stringify({ roles }) }));
    },
    async removeMembership(userId) {
      return safeJson(await fetchImpl(`/api/memberships/${encodeURIComponent(userId)}`, { method: "DELETE", credentials: "same-origin", headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }) }));
    },
    async organizationAudit() {
      return safeJson(await fetchImpl("/api/organization-audit", { credentials: "same-origin", headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }) }));
    },
    async revokeSession() {
      await safeJson(await fetchImpl("/api/session/revoke", { method: "POST", credentials: "same-origin", headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }) }));
      emit({ status: "unauthenticated", source: "remote", user: null, organizations: [], activeOrganizationId: null, errorCode: "SESSION_REVOKED" });
    },
    async exportAccount() {
      return safeJson(await fetchImpl("/api/account/export", { credentials: "same-origin", headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }) }));
    },
    async deleteAccount() {
      const result = await safeJson(await fetchImpl("/api/account", { method: "DELETE", credentials: "same-origin", headers: headers(snapshot.activeOrganizationId, { accept: "application/json" }) }));
      emit({ status: "unauthenticated", source: "remote", user: null, organizations: [], activeOrganizationId: null, errorCode: "ACCOUNT_DELETED" });
      return result;
    },
  });
}
