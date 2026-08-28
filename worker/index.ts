import { createD1AccountRepository, isOrganizationAdministrator } from "./account-repository.ts";
import { createSitesIdentityProvider, type IdentityProvider } from "./authentication.ts";
import { createD1ProjectRepository, ProjectRevisionConflict, type ProjectRecord } from "./project-repository.ts";
import { parseProjectEtag, projectEtag } from "../src/domain/project-concurrency.js";
import { collaborationEventPayload, projectCollaborationEventTypes } from "../src/domain/collaboration-events.js";
import { createD1CollaborationRepository, createMemoryCollaborationRepository } from "./collaboration-repository.ts";
import { createD1SharingRepository, createMemorySharingRepository } from "./sharing-repository.ts";
import { createShareToken, hashShareToken, safeNotification, SHARE_SCOPES } from "../src/domain/sharing.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";

export { createD1AccountRepository, createMemoryAccountRepository } from "./account-repository.ts";
export { createSitesIdentityProvider, createStaticIdentityProvider } from "./authentication.ts";
export { applyDatabaseMigrations, inspectDatabaseIntegrity, planDatabaseMigrations } from "./database-migrations.ts";
export { createD1CollaborationRepository, createMemoryCollaborationRepository } from "./collaboration-repository.ts";
export { createD1SharingRepository, createMemorySharingRepository } from "./sharing-repository.ts";

type ProjectRepository = ReturnType<typeof createD1ProjectRepository>;
type AccountRepository = ReturnType<typeof createD1AccountRepository>;
type CollaborationRepository = ReturnType<typeof createD1CollaborationRepository>;
type SharingRepository = ReturnType<typeof createD1SharingRepository>;
type WorkerEnv = { ASSETS: { fetch: (request: Request) => Promise<Response> }; DB: unknown };
type WorkerOptions = {
  createProjectRepository?: (db: unknown) => ProjectRepository;
  createAccountRepository?: (db: unknown) => AccountRepository;
  createCollaborationRepository?: (db: unknown) => CollaborationRepository;
  createSharingRepository?: (db: unknown) => SharingRepository;
  identityProvider?: IdentityProvider;
  secureCookies?: boolean;
  clock?: () => string;
};

const SESSION_COOKIE = "venuemind_session";
const json = (value: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(value), {
  ...init,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...init.headers },
});
const apiError = (status: number, code: string, message: string, details?: unknown, headers?: HeadersInit) => json({ error: message, code, ...(details === undefined ? {} : { details }) }, { status, headers });
const projectIdFrom = (pathname: string) => decodeURIComponent(pathname.slice("/api/projects/".length));
const cookieValue = (request: Request, name: string) => request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
const sessionCookie = (id: string, secure: boolean) => `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure ? "; Secure" : ""}`;
const clearedSessionCookie = (secure: boolean) => `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
const readBody = async <T>(request: Request): Promise<T> => {
  if (Number(request.headers.get("content-length") ?? 0) > 2_000_000) throw new Error("PAYLOAD_TOO_LARGE");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2_000_000) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(text) as T;
};
const safeMutationOrigin = (request: Request) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
};

export function createWorker(options: WorkerOptions = {}) {
  const projectRepositoryFactory = options.createProjectRepository ?? ((db) => createD1ProjectRepository(db as never));
  const accountRepositoryFactory = options.createAccountRepository ?? ((db) => createD1AccountRepository(db as never));
  const memoryCollaboration = createMemoryCollaborationRepository({ clock: options.clock });
  const collaborationRepositoryFactory = options.createCollaborationRepository ?? (options.createProjectRepository ? (() => memoryCollaboration as never) : ((db) => createD1CollaborationRepository(db as never)));
  const memorySharing = createMemorySharingRepository();
  const sharingRepositoryFactory = options.createSharingRepository ?? (options.createProjectRepository ? (() => memorySharing as never) : ((db) => createD1SharingRepository(db as never)));
  const identityProvider = options.identityProvider ?? createSitesIdentityProvider();
  const secureCookies = options.secureCookies ?? true;
  const clock = options.clock ?? (() => new Date().toISOString());

  return {
    async fetch(request: Request, env: WorkerEnv) {
      const url = new URL(request.url);
      const publicShareMatch = url.pathname.match(/^\/api\/share\/([0-9a-f]{64})$/);
      if (publicShareMatch && request.method === "GET") {
        const sharing = sharingRepositoryFactory(env.DB);
        const link = await sharing.resolveLink(await hashShareToken(publicShareMatch[1]), clock());
        if (!link || link.status !== "active") return apiError(404, "SHARE_LINK_UNAVAILABLE", "Share link unavailable");
        const record = await projectRepositoryFactory(env.DB).get(link.organizationId, link.projectId);
        if (!record) return apiError(404, "SHARE_LINK_UNAVAILABLE", "Share link unavailable");
        const snapshot = record.snapshot as { plan?: unknown; proposal?: { id?: string }; branches?: Array<{ proposal?: { id?: string } }> };
        const proposals = [snapshot.proposal, ...(snapshot.branches ?? []).map((branch) => branch.proposal)].filter(Boolean);
        const proposal = link.scope === "reviewer" ? proposals.find((item: { id?: string }) => item.id === link.proposalId) ?? null : null;
        if (link.scope === "reviewer" && !proposal) return apiError(404, "SHARE_LINK_UNAVAILABLE", "Share link unavailable");
        return json({ shareLinkId: link.id, scope: link.scope, expiresAt: link.expiresAt, project: { id: record.id, name: record.name, revision: record.revision }, plan: snapshot.plan, ...(proposal ? { proposal } : {}) });
      }
      if (!url.pathname.startsWith("/api/")) {
        const response = await env.ASSETS.fetch(request);
        const acceptsHtml = request.headers.get("accept")?.includes("text/html");
        if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return response;
        const indexUrl = new URL(request.url);
        indexUrl.pathname = "/index.html";
        indexUrl.search = "";
        return env.ASSETS.fetch(new Request(indexUrl, request));
      }

      if (!safeMutationOrigin(request)) return apiError(403, "ORIGIN_DENIED", "Cross-origin mutation denied");
      const accounts = accountRepositoryFactory(env.DB);
      let sessionId = cookieValue(request, SESSION_COOKIE);
      let account = sessionId ? await accounts.resolveSession(decodeURIComponent(sessionId)) : null;
      let setCookie: string | null = null;
      if (!account) {
        const identity = await identityProvider.authenticate(request);
        if (!identity) return apiError(401, "AUTHENTICATION_REQUIRED", "Authentication required");
        try {
          const provisioned = await accounts.provision(identity);
          const session = await accounts.createSession(provisioned.user.id);
          sessionId = session.id;
          account = { session, ...provisioned };
          setCookie = sessionCookie(session.id, secureCookies);
        } catch (cause) {
          return apiError(403, cause instanceof Error ? cause.message : "ACCOUNT_UNAVAILABLE", "Account unavailable");
        }
      }

      const respond = (value: unknown, init: ResponseInit = {}) => {
        const response = json(value, init);
        if (setCookie) response.headers.append("set-cookie", setCookie);
        return response;
      };
      const requestedOrganizationId = request.headers.get("x-venuemind-organization-id")?.trim() || (url.pathname.endsWith("/collaboration") || url.pathname.endsWith("/presence") ? url.searchParams.get("organizationId")?.trim() : null) || null;
      const organization = requestedOrganizationId ? account.organizations.find((item) => item.id === requestedOrganizationId) : account.organizations[0];
      const admin = organization ? isOrganizationAdministrator({ status: "active", roles: organization.roles }) : false;

      if (url.pathname === "/api/session" && request.method === "GET") return respond({
        user: { id: account.user.id, email: account.user.email, displayName: account.user.displayName },
        session: { id: account.session.id, expiresAt: account.session.expiresAt },
        organizations: account.organizations,
        activeOrganizationId: organization?.id ?? null,
      });

      if (url.pathname === "/api/session/revoke" && request.method === "POST") {
        await accounts.revokeSession(account.session.id);
        const response = respond({ status: "revoked" });
        response.headers.set("set-cookie", clearedSessionCookie(secureCookies));
        return response;
      }

      if (url.pathname === "/api/organizations" && request.method === "POST") {
        const body = await readBody<{ name?: string; slug?: string }>(request);
        if (!body.name?.trim() || !/^[a-z0-9][a-z0-9-]{1,62}$/.test(body.slug?.trim() ?? "")) return apiError(400, "ORGANIZATION_INVALID", "Organization name and slug are required");
        return respond(await accounts.createOrganization(account.user.id, { name: body.name, slug: body.slug! }), { status: 201 });
      }

      if (url.pathname === "/api/invitations/accept" && request.method === "POST") {
        const body = await readBody<{ token?: string }>(request);
        if (!body.token) return apiError(400, "INVITATION_INVALID", "Invitation token required");
        try { return respond(await accounts.acceptInvitation(account.user.id, account.user.email, body.token)); }
        catch { return apiError(400, "INVITATION_INVALID", "Invitation is invalid or unavailable"); }
      }

      if (!organization) return apiError(403, "ORGANIZATION_ACCESS_DENIED", "Active organization membership required");

      if (url.pathname === "/api/memberships" && request.method === "GET") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        return respond({ memberships: await accounts.listMemberships(organization.id) });
      }

      if (url.pathname === "/api/invitations" && request.method === "POST") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        const body = await readBody<{ email?: string; roles?: string[]; expiresAt?: string }>(request);
        if (!body.email || !body.roles?.length || !body.expiresAt) return apiError(400, "INVITATION_INVALID", "Invitation fields are required");
        try { return respond(await accounts.createInvitation(organization.id, account.user.id, body as { email: string; roles: string[]; expiresAt: string }), { status: 201 }); }
        catch { return apiError(400, "INVITATION_INVALID", "Invitation is invalid"); }
      }

      const membershipMatch = url.pathname.match(/^\/api\/memberships\/([^/]+)$/);
      if (membershipMatch && request.method === "PATCH") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        const targetUserId = decodeURIComponent(membershipMatch[1]);
        const body = await readBody<{ roles?: string[] }>(request);
        try { return respond(await accounts.setMembershipRoles(organization.id, account.user.id, targetUserId, body.roles ?? [])); }
        catch { return apiError(400, "MEMBERSHIP_INVALID", "Membership roles are invalid"); }
      }
      if (membershipMatch && request.method === "DELETE") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        const targetUserId = decodeURIComponent(membershipMatch[1]);
        if (targetUserId === account.user.id) return apiError(409, "SELF_REMOVAL_DENIED", "Transfer administration before leaving");
        await accounts.removeMembership(organization.id, account.user.id, targetUserId);
        return respond({ status: "removed" });
      }

      if (url.pathname === "/api/organization-audit" && request.method === "GET") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        return respond({ events: await accounts.auditEvents(organization.id) });
      }
      if (url.pathname === "/api/account/export" && request.method === "GET") {
        const accountExport = await accounts.exportAccount(account.user.id);
        const repository = projectRepositoryFactory(env.DB);
        const projects = (await Promise.all(account.organizations.map((item) => repository.list(item.id)))).flat();
        return respond({ ...accountExport, projects });
      }
      if (url.pathname === "/api/account" && request.method === "DELETE") {
        const result = await accounts.requestAccountDeletion(account.user.id);
        const response = respond(result, { status: 202 });
        response.headers.set("set-cookie", clearedSessionCookie(secureCookies));
        return response;
      }

      const projects = projectRepositoryFactory(env.DB);
      const sharing = sharingRepositoryFactory(env.DB);
      const appendShareLedger = async (record: ProjectRecord, command: Record<string, unknown>) => {
        const snapshot = record.snapshot as { plan: Record<string, unknown>; brief: unknown; proposal: unknown };
        const planner = createVenuePlanner({ ...snapshot.plan, brief: snapshot.brief, proposal: snapshot.proposal }, { projectId: record.id });
        planner.execute({ type: "restore_snapshot", snapshot: record.snapshot });
        planner.execute(command);
        const saved = await projects.put(organization.id, { ...record, snapshot: planner.getSnapshot(), updatedAt: clock() }, { expectedRevision: record.revision });
        await collaborationRepositoryFactory(env.DB).append({ organizationId: organization.id, projectId: record.id, type: "ledger.appended", actorUserId: account.user.id, sessionId: account.session.id, projectRevision: saved.revision, payload: collaborationEventPayload("ledger.appended", record, saved), occurredAt: clock() });
        return saved;
      };
      const notifyOrganization = async (eventType: string, record: ProjectRecord, refs: Record<string, string | number>, excludeUserId: string | null = account.user.id) => {
        const recipients = await sharing.notificationRecipients(organization.id, eventType, excludeUserId);
        for (const recipient of recipients) {
          const notification = safeNotification({ id: `notification-${crypto.randomUUID()}`, organizationId: organization.id, projectId: record.id, userId: recipient.userId, eventType, refs: { projectId: record.id, revision: record.revision, ...refs }, createdAt: clock() });
          await sharing.addNotification(notification, recipient.emailEnabled ? recipient.email : null);
        }
      };
      if (url.pathname === "/api/notifications" && request.method === "GET") return respond({ notifications: await sharing.listNotifications(account.user.id, organization.id) });
      if (url.pathname === "/api/notification-preferences" && request.method === "GET") return respond(await sharing.preferences(account.user.id));
      if (url.pathname === "/api/notification-preferences" && request.method === "PUT") {
        const body = await readBody(request);
        try { return respond(await sharing.setPreferences(account.user.id, body, clock())); } catch { return apiError(400, "NOTIFICATION_PREFERENCES_INVALID", "Notification preferences are invalid"); }
      }
      const notificationReadMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if (notificationReadMatch && request.method === "POST") { await sharing.markRead(account.user.id, decodeURIComponent(notificationReadMatch[1]), clock()); return respond({ status: "read" }); }

      const shareCollectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/share-links$/);
      if (shareCollectionMatch && request.method === "GET") {
        if (!["venue-administrator", "organization-administrator"].some((role) => organization.roles.includes(role))) return apiError(403, "SHARE_LINK_DENIED", "Share-link management role required");
        const projectId = decodeURIComponent(shareCollectionMatch[1]);
        if (!await projects.get(organization.id, projectId)) return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        return respond({ links: (await sharing.listLinks(organization.id, projectId)).map(({ tokenHash: _tokenHash, ...link }) => ({ ...link, status: link.revokedAt ? "revoked" : Date.parse(link.expiresAt) <= Date.parse(clock()) ? "expired" : "active" })) });
      }
      if (shareCollectionMatch && request.method === "POST") {
        if (!["venue-administrator", "organization-administrator"].some((role) => organization.roles.includes(role))) return apiError(403, "SHARE_LINK_DENIED", "Share-link management role required");
        const projectId = decodeURIComponent(shareCollectionMatch[1]);
        const current = await projects.get(organization.id, projectId);
        if (!current) return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        const body = await readBody<{ scope?: string; proposalId?: string; expiresAt?: string }>(request);
        if (!SHARE_SCOPES.includes(body.scope as never) || !body.expiresAt || Date.parse(body.expiresAt) <= Date.parse(clock()) || Date.parse(body.expiresAt) > Date.parse(clock()) + 30 * 24 * 60 * 60 * 1000) return apiError(400, "SHARE_LINK_INVALID", "Share link fields are invalid");
        const snapshot = current.snapshot as { proposal?: { id?: string }; branches?: Array<{ proposal?: { id?: string } }> };
        const proposalIds = new Set([snapshot.proposal?.id, ...(snapshot.branches ?? []).map((branch) => branch.proposal?.id)].filter(Boolean));
        if (body.scope === "reviewer" && (!body.proposalId || !proposalIds.has(body.proposalId))) return apiError(400, "SHARE_PROPOSAL_INVALID", "Reviewer link requires one current Proposal");
        const id = `share-${crypto.randomUUID()}`;
        const token = createShareToken();
        const tokenHash = await hashShareToken(token);
        const createdAt = clock();
        const saved = await appendShareLedger(current, { type: "record_share_link_created", shareLinkId: id, scope: body.scope, proposalId: body.scope === "reviewer" ? body.proposalId : null, expiresAt: body.expiresAt, actor: "human", actorId: account.user.id, idempotencyKey: `share-create-${id}`, source: "studio", sessionId: account.session.id });
        await sharing.createLink({ id, organizationId: organization.id, projectId, proposalId: body.scope === "reviewer" ? body.proposalId : null, scope: body.scope, tokenHash, createdBy: account.user.id, createdAt, expiresAt: body.expiresAt, revokedAt: null, revokedBy: null });
        return respond({ id, scope: body.scope, proposalId: body.scope === "reviewer" ? body.proposalId : null, expiresAt: body.expiresAt, token, url: `/share/${token}`, projectRevision: saved.revision }, { status: 201 });
      }
      const shareRevokeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/share-links\/([^/]+)\/revoke$/);
      if (shareRevokeMatch && request.method === "POST") {
        if (!["venue-administrator", "organization-administrator"].some((role) => organization.roles.includes(role))) return apiError(403, "SHARE_LINK_DENIED", "Share-link management role required");
        const projectId = decodeURIComponent(shareRevokeMatch[1]);
        const linkId = decodeURIComponent(shareRevokeMatch[2]);
        const revoked = await sharing.revokeLink(organization.id, projectId, linkId, account.user.id, clock());
        if (!revoked) return apiError(404, "SHARE_LINK_NOT_FOUND", "Share link not found");
        const current = await projects.get(organization.id, projectId);
        if (!current) return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        const saved = await appendShareLedger(current, { type: "record_share_link_revoked", shareLinkId: linkId, reasonCode: "operator-revoked", actor: "human", actorId: account.user.id, idempotencyKey: `share-revoke-${linkId}`, source: "studio", sessionId: account.session.id });
        return respond({ status: "revoked", id: linkId, revokedAt: revoked.revokedAt, projectRevision: saved.revision });
      }
      const collaborationMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/collaboration$/);
      const presenceMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/collaboration\/presence$/);
      if (collaborationMatch && request.method === "GET") {
        const projectId = decodeURIComponent(collaborationMatch[1]);
        const project = await projects.get(organization.id, projectId);
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        const afterValue = request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? "0";
        const after = Number(afterValue);
        if (!Number.isSafeInteger(after) || after < 0) return apiError(400, "COLLABORATION_CURSOR_INVALID", "Collaboration cursor is invalid");
        const collaboration = collaborationRepositoryFactory(env.DB);
        const batch = await collaboration.events(organization.id, projectId, after, 100);
        const presence = await collaboration.presence(organization.id, projectId, clock());
        const chunks = ["retry: 1500", `event: presence.snapshot\ndata: ${JSON.stringify({ presence })}`];
        if (batch.missed) chunks.push(`id: ${batch.cursor}\nevent: sync.reset\ndata: ${JSON.stringify({ projectId, revision: project.revision, cursor: batch.cursor })}`);
        for (const event of batch.events) chunks.push(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}`);
        chunks.push(`event: sync.cursor\ndata: ${JSON.stringify({ cursor: batch.cursor, revision: project.revision })}`);
        const response = new Response(`${chunks.join("\n\n")}\n\n`, { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-collaboration-cursor": String(batch.cursor) } });
        if (setCookie) response.headers.append("set-cookie", setCookie);
        return response;
      }
      if (presenceMatch && request.method === "PUT") {
        const projectId = decodeURIComponent(presenceMatch[1]);
        const project = await projects.get(organization.id, projectId);
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        const body = await readBody<{ planVersion?: string; focusedObjectId?: string | null; viewport?: Record<string, unknown> | null }>(request);
        if (!body.planVersion || (body.focusedObjectId !== undefined && body.focusedObjectId !== null && typeof body.focusedObjectId !== "string")) return apiError(400, "PRESENCE_INVALID", "Presence payload is invalid");
        const focusableIds = new Set([
          ...((project.snapshot as { plan?: { objects?: Array<{ id?: string }> } })?.plan?.objects ?? []).map((object) => object.id),
          ...((project.snapshot as { proposal?: { changes?: Array<{ targetObjectIds?: string[] }> } })?.proposal?.changes ?? []).flatMap((change) => change.targetObjectIds ?? []),
        ].filter(Boolean));
        if (body.focusedObjectId && !focusableIds.has(body.focusedObjectId)) return apiError(400, "PRESENCE_FOCUS_INVALID", "Focused object is unavailable");
        const viewport = body.viewport === null || body.viewport === undefined ? null : body.viewport;
        if (viewport && (Object.keys(viewport).some((key) => !["x", "y", "zoom", "width", "height"].includes(key)) || Object.values(viewport).some((item) => typeof item !== "number" || !Number.isFinite(item)) || (typeof viewport.zoom === "number" && viewport.zoom <= 0))) return apiError(400, "PRESENCE_VIEWPORT_INVALID", "Presence viewport is invalid");
        const now = clock();
        const expiresAt = new Date(Date.parse(now) + 30_000).toISOString();
        const value = await collaborationRepositoryFactory(env.DB).upsertPresence({ organizationId: organization.id, projectId, sessionId: account.session.id, userId: account.user.id, displayName: account.user.displayName || account.user.email, planVersion: body.planVersion, focusedObjectId: body.focusedObjectId ?? null, viewport, lastSeenAt: now, expiresAt });
        return respond(value);
      }
      if (presenceMatch && request.method === "DELETE") {
        const projectId = decodeURIComponent(presenceMatch[1]);
        await collaborationRepositoryFactory(env.DB).removePresence(organization.id, projectId, account.session.id, account.user.id);
        return respond({ status: "offline" });
      }
      if (url.pathname === "/api/projects" && request.method === "GET") return respond({ organizationId: organization.id, projects: await projects.list(organization.id) });
      if (url.pathname.startsWith("/api/projects/") && request.method === "GET") {
        const projectId = projectIdFrom(url.pathname);
        const record = await projects.get(organization.id, projectId);
        return record ? respond(record, { headers: { etag: projectEtag(record.id, record.revision) } }) : apiError(404, "PROJECT_NOT_FOUND", "Project not found");
      }
      if (url.pathname.startsWith("/api/projects/") && request.method === "PUT") {
        const projectId = projectIdFrom(url.pathname);
        let body: Partial<ProjectRecord>;
        try { body = await readBody(request); } catch { return apiError(413, "PAYLOAD_TOO_LARGE", "Project payload too large"); }
        if (body.id !== projectId || !body.name || !body.activePlanId || body.schemaVersion !== 10 || !body.snapshot) return apiError(400, "PROJECT_INVALID", "Invalid project record");
        if (body.organizationId && body.organizationId !== organization.id) return apiError(403, "ORGANIZATION_ACCESS_DENIED", "Project organization does not match active organization");
        if (!["planner", "venue-administrator", "organization-administrator"].some((role) => organization.roles.includes(role))) return apiError(403, "PROJECT_WRITE_DENIED", "Project write role required");
        const record = { ...body, organizationId: organization.id } as ProjectRecord;
        const current = await projects.get(organization.id, projectId);
        const createOnly = request.headers.get("if-none-match") === "*";
        const ifMatch = request.headers.get("if-match");
        if (createOnly && ifMatch) return apiError(400, "PROJECT_PRECONDITION_INVALID", "Choose one Project write precondition");
        if (createOnly && current) return apiError(409, "PROJECT_ID_CONFLICT", "Project already exists", { current, currentEtag: projectEtag(current.id, current.revision) }, { etag: projectEtag(current.id, current.revision) });
        if (!createOnly && !current) return apiError(412, "PROJECT_REVISION_CONFLICT", "Project revision is unavailable", { current: null, expectedRevision: null });
        if (!createOnly && !ifMatch) return apiError(428, "PROJECT_PRECONDITION_REQUIRED", "If-Match is required for an existing Project");
        const expectedRevision = ifMatch ? parseProjectEtag(ifMatch, projectId) : null;
        if (!createOnly && expectedRevision === null) return apiError(400, "PROJECT_ETAG_INVALID", "Project ETag is invalid");
        if (!createOnly && body.revision !== undefined && body.revision !== expectedRevision) return apiError(400, "PROJECT_REVISION_INVALID", "Project body revision does not match If-Match");
        try {
          const saved = await projects.put(organization.id, record, { createOnly, expectedRevision });
          const collaboration = collaborationRepositoryFactory(env.DB);
          const collaborationTypes = projectCollaborationEventTypes(current, saved);
          for (const type of collaborationTypes) {
            await collaboration.append({ organizationId: organization.id, projectId, type, actorUserId: account.user.id, sessionId: account.session.id, projectRevision: saved.revision, payload: collaborationEventPayload(type, current, saved), occurredAt: clock() });
          }
          const currentLedgerLength = ((current?.snapshot as { ledger?: unknown[] } | undefined)?.ledger ?? []).length;
          const newLedger = ((saved.snapshot as { ledger?: Array<{ type?: string }> })?.ledger ?? []).slice(currentLedgerLength);
          if (newLedger.some((entry) => entry.type === "proposal.adjustment_requested")) await notifyOrganization("adjustment_requested", saved, { proposalId: (saved.snapshot as { proposal?: { id?: string } }).proposal?.id ?? "proposal-unknown" });
          else if (collaborationTypes.includes("approval.committed")) await notifyOrganization("approval_completed", saved, { planVersion: (saved.snapshot as { plan?: { version?: string } }).plan?.version ?? "0.0" });
          else if (collaborationTypes.includes("proposal.updated")) await notifyOrganization("review_requested", saved, { proposalId: (saved.snapshot as { proposal?: { id?: string } }).proposal?.id ?? "proposal-unknown" });
          const correlationId = request.headers.get("x-correlation-id");
          return respond(saved, { status: createOnly ? 201 : 200, headers: { etag: projectEtag(saved.id, saved.revision), ...(correlationId ? { "x-correlation-id": correlationId } : {}) } });
        } catch (cause) {
          if (cause instanceof ProjectRevisionConflict || (cause instanceof Error && cause.message === "PROJECT_REVISION_CONFLICT")) {
            const latest = cause instanceof ProjectRevisionConflict ? cause.current : await projects.get(organization.id, projectId);
            const preferences = await sharing.preferences(account.user.id);
            if (latest && preferences.eventTypes.includes("conflict_detected") && (preferences.inAppEnabled || preferences.emailEnabled)) {
              const notification = safeNotification({ id: `notification-${crypto.randomUUID()}`, organizationId: organization.id, projectId, userId: account.user.id, eventType: "conflict_detected", refs: { projectId, revision: latest.revision, conflictCode: "PROJECT_REVISION_CONFLICT" }, createdAt: clock() });
              await sharing.addNotification(notification, preferences.emailEnabled ? account.user.email : null);
            }
            return apiError(412, "PROJECT_REVISION_CONFLICT", "Project revision is stale", { current: latest, expectedRevision, currentRevision: latest?.revision ?? null, currentEtag: latest ? projectEtag(latest.id, latest.revision) : null }, latest ? { etag: projectEtag(latest.id, latest.revision) } : undefined);
          }
          if (cause instanceof Error && cause.message === "PROJECT_ID_CONFLICT") return apiError(409, "PROJECT_ID_CONFLICT", "Project ID belongs to another organization");
          throw cause;
        }
      }
      return apiError(404, "NOT_FOUND", "Not found");
    },
  };
}

export default createWorker();
