import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryAccountRepository, createWorker } from "../dist/server/index.js";
import { createProjectStore } from "../src/persistence/project-store.js";
import { createAgentGrant, createAgentPrincipal } from "../src/domain/authorization.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { venueToolContracts } from "../src/contracts/venue-contracts.js";
import { executeVenueWebMcpTool } from "../src/webmcp/tool-runtime.js";
import { createMemoryProjectRepository } from "../packages/mcp-server/src/project-repository.js";
import { createProjectSession } from "../packages/mcp-server/src/project-session.js";
import { createStructuredLogger, createVenueMindMcpServer } from "../packages/mcp-server/src/index.js";
import { createOrganizationInvitation, createUserSession, invitationStatus, sessionStatus } from "../src/domain/accounts.js";

const NOW = "2026-08-28T10:00:00.000Z";
const later = "2026-08-28T10:30:00.000Z";
const idFactory = (() => { let sequence = 0; return (prefix) => `${prefix}-${++sequence}`; })();
const accounts = createMemoryAccountRepository({ clock: () => NOW, idFactory });
const records = new Map();
const projectRepository = {
  async list(organizationId) { return [...records.values()].filter((record) => record.organizationId === organizationId); },
  async get(organizationId, projectId) { return records.get(projectId)?.organizationId === organizationId ? structuredClone(records.get(projectId)) : null; },
  async put(organizationId, record, { createOnly = false, expectedRevision = null } = {}) {
    const existing = records.get(record.id);
    if (existing && existing.organizationId !== organizationId) throw new Error("PROJECT_ID_CONFLICT");
    if ((createOnly && existing) || (!createOnly && (!existing || existing.revision !== expectedRevision))) throw new Error("PROJECT_REVISION_CONFLICT");
    const saved = { ...structuredClone(record), revision: existing ? existing.revision + 1 : 1 };
    records.set(record.id, saved);
    return structuredClone(saved);
  },
};
const identityProvider = { authenticate: (request) => {
  const identity = request.headers.get("x-test-identity");
  return identity ? { provider: "test", subject: identity, email: `${identity}@example.test`, displayName: identity.toUpperCase() } : null;
} };
const worker = createWorker({ identityProvider, secureCookies: false, createAccountRepository: () => accounts, createProjectRepository: () => projectRepository });
const env = { DB: {} };
const request = (path, { identity, organizationId, method = "GET", body, headers = {} } = {}) => worker.fetch(new Request(`https://example.test${path}`, {
  method,
  headers: { accept: "application/json", ...(identity ? { "x-test-identity": identity } : {}), ...(organizationId ? { "x-venuemind-organization-id": organizationId } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers },
  ...(body ? { body: JSON.stringify(body) } : {}),
}), env);

const projectRecord = (id, name) => {
  const snapshot = createVenuePlanner(summitForwardPlan).getSnapshot();
  return { id, name, activePlanId: snapshot.plan.id, schemaVersion: 10, snapshot, createdAt: NOW, updatedAt: NOW };
};

test("session and invitation lifecycle clocks are bounded", async () => {
  const session = createUserSession({ id: "session-1", userId: "user-1", createdAt: NOW, expiresAt: "2026-08-28T11:00:00.000Z" });
  assert.equal(sessionStatus(session, later), "active");
  assert.equal(sessionStatus(session, "2026-08-28T11:00:00.000Z"), "expired");
  assert.throws(() => createUserSession({ id: "session-long", userId: "user-1", createdAt: NOW, expiresAt: "2026-09-10T10:00:00.000Z" }), /lifetime/);
  const invitation = createOrganizationInvitation({ id: "invite-1", organizationId: "org-1", email: "a@example.test", roles: ["viewer"], invitedBy: "user-1", createdAt: NOW, expiresAt: "2026-08-29T10:00:00.000Z" });
  assert.equal(invitationStatus(invitation, later), "pending");
  assert.equal(invitationStatus(invitation, "2026-08-29T10:00:00.000Z"), "expired");
});

test("Cloudflare anonymous demo mode provisions an isolated durable browser identity", async () => {
  const demoAccounts = createMemoryAccountRepository({ clock: () => NOW });
  const demoWorker = createWorker({ secureCookies: false, createAccountRepository: () => demoAccounts, createProjectRepository: () => projectRepository });
  const demoEnv = { ...env, VENUEMIND_AUTH_MODE: "anonymous-demo" };
  const first = await demoWorker.fetch(new Request("https://example.test/api/session"), demoEnv);
  assert.equal(first.status, 200);
  const firstSession = await first.json();
  const cookies = first.headers.get("set-cookie");
  assert.match(cookies, /venuemind_demo_identity=/);
  assert.match(cookies, /venuemind_session=/);
  assert.equal(firstSession.user.displayName, "Guest Planner");

  const cookieHeader = [...cookies.matchAll(/(venuemind_(?:demo_identity|session)=[^;,]+)/g)].map((match) => match[1]).join("; ");
  const resumed = await demoWorker.fetch(new Request("https://example.test/api/session", { headers: { cookie: cookieHeader } }), demoEnv);
  assert.equal(resumed.status, 200);
  assert.equal((await resumed.json()).user.id, firstSession.user.id);
});

test("API membership, invitations, roles, sessions, export, deletion, and Project access remain tenant isolated", async () => {
  assert.equal((await request("/api/projects")).status, 401);
  const aliceSession = await (await request("/api/session", { identity: "alice" })).json();
  const bobSession = await (await request("/api/session", { identity: "bob" })).json();
  const alphaId = aliceSession.activeOrganizationId;
  const bobOrgId = bobSession.activeOrganizationId;
  assert.notEqual(alphaId, bobOrgId);

  const created = await request("/api/projects/project-alpha", { identity: "alice", organizationId: alphaId, method: "PUT", body: projectRecord("project-alpha", "Alpha"), headers: { "if-none-match": "*" } });
  assert.equal(created.status, 201);
  assert.equal((await created.json()).organizationId, alphaId);
  assert.equal((await request("/api/projects/project-alpha", { identity: "bob", organizationId: bobOrgId })).status, 404);
  assert.equal((await request("/api/projects", { identity: "bob", organizationId: alphaId })).status, 403);
  assert.equal((await request("/api/projects/project-alpha", { identity: "alice", organizationId: alphaId, method: "PUT", body: { ...projectRecord("project-alpha", "Forged"), organizationId: bobOrgId }, headers: { "if-match": created.headers.get("etag") } })).status, 403);

  const invitationResponse = await request("/api/invitations", { identity: "alice", organizationId: alphaId, method: "POST", body: { email: "bob@example.test", roles: ["viewer"], expiresAt: "2026-08-29T10:00:00.000Z" } });
  assert.equal(invitationResponse.status, 201);
  const { token } = await invitationResponse.json();
  assert.equal((await request("/api/invitations/accept", { identity: "bob", method: "POST", body: { token } })).status, 200);
  assert.equal((await request("/api/projects/project-alpha", { identity: "bob", organizationId: alphaId })).status, 200);
  assert.equal((await request("/api/projects/project-beta", { identity: "bob", organizationId: alphaId, method: "PUT", body: projectRecord("project-beta", "Beta"), headers: { "if-none-match": "*" } })).status, 403);

  const members = await (await request("/api/memberships", { identity: "alice", organizationId: alphaId })).json();
  const bob = members.memberships.find((membership) => membership.email === "bob@example.test");
  assert.deepEqual(bob.roles, ["viewer"]);
  assert.equal((await request(`/api/memberships/${bob.userId}`, { identity: "alice", organizationId: alphaId, method: "PATCH", body: { roles: ["planner"] } })).status, 200);
  assert.equal((await request("/api/projects/project-beta", { identity: "bob", organizationId: alphaId, method: "PUT", body: projectRecord("project-beta", "Beta"), headers: { "if-none-match": "*" } })).status, 201);
  const audit = await (await request("/api/organization-audit", { identity: "alice", organizationId: alphaId })).json();
  assert.ok(audit.events.some((event) => event.type === "membership.roles_changed"));
  assert.ok(audit.events.every((event) => event.organizationId === alphaId));

  const exported = await (await request("/api/account/export", { identity: "alice", organizationId: alphaId })).json();
  assert.ok(exported.organizations.some((organization) => organization.id === alphaId));
  assert.ok(exported.organizations.every((organization) => organization.id !== bobOrgId));
  assert.deepEqual(exported.projects.map((project) => project.id).sort(), ["project-alpha", "project-beta"]);
  assert.ok(exported.projects.every((project) => project.organizationId === alphaId));
  assert.equal((await request(`/api/memberships/${bob.userId}`, { identity: "alice", organizationId: alphaId, method: "DELETE" })).status, 200);
  assert.equal((await request("/api/projects/project-alpha", { identity: "bob", organizationId: alphaId })).status, 403);

  const deletion = await request("/api/account", { identity: "bob", organizationId: bobOrgId, method: "DELETE" });
  assert.equal(deletion.status, 202);
  assert.equal((await request("/api/session", { identity: "bob" })).status, 403);
});

test("a revoked session cookie cannot be replayed", async () => {
  const login = await request("/api/session", { identity: "session-user" });
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const revoke = await worker.fetch(new Request("https://example.test/api/session/revoke", { method: "POST", headers: { cookie, accept: "application/json" } }), env);
  assert.equal(revoke.status, 200);
  assert.match(revoke.headers.get("set-cookie"), /Max-Age=0/);
  const replay = await worker.fetch(new Request("https://example.test/api/session", { headers: { cookie, accept: "application/json" } }), env);
  assert.equal(replay.status, 401);
  assert.equal((await replay.json()).code, "AUTHENTICATION_REQUIRED");
});

test("two API sessions cannot overwrite the same stale Project revision", async () => {
  const session = await (await request("/api/session", { identity: "concurrency-owner" })).json();
  const organizationId = session.activeOrganizationId;
  const created = await request("/api/projects/project-concurrent", { identity: "concurrency-owner", organizationId, method: "PUT", body: projectRecord("project-concurrent", "BASE"), headers: { "if-none-match": "*" } });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("etag"), '"venuemind:project-concurrent:1"');

  const tabA = await request("/api/projects/project-concurrent", { identity: "concurrency-owner", organizationId });
  const tabB = await request("/api/projects/project-concurrent", { identity: "concurrency-owner", organizationId });
  const staleEtag = tabA.headers.get("etag");
  assert.equal(staleEtag, tabB.headers.get("etag"));
  const base = await tabA.json();

  const first = await request("/api/projects/project-concurrent", { identity: "concurrency-owner", organizationId, method: "PUT", body: { ...base, name: "TAB A" }, headers: { "if-match": staleEtag } });
  assert.equal(first.status, 200);
  assert.equal((await first.clone().json()).revision, 2);
  const stale = await request("/api/projects/project-concurrent", { identity: "concurrency-owner", organizationId, method: "PUT", body: { ...base, name: "TAB B" }, headers: { "if-match": staleEtag } });
  assert.equal(stale.status, 412);
  const conflict = await stale.json();
  assert.equal(conflict.code, "PROJECT_REVISION_CONFLICT");
  assert.equal(conflict.details.current.name, "TAB A");
  assert.equal(conflict.details.currentRevision, 2);
  assert.equal((await (await request("/api/projects/project-concurrent", { identity: "concurrency-owner", organizationId })).json()).name, "TAB A");
  assert.equal((await request("/api/projects/project-concurrent", { identity: "concurrency-owner", organizationId, method: "PUT", body: { ...base, name: "UNCONDITIONAL" } })).status, 428);
});

test("browser recovery state is partitioned by Organization", async () => {
  const values = new Map();
  const storage = { get length() { return values.size; }, key: (index) => [...values.keys()][index] ?? null, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const offline = async () => { throw new Error("offline"); };
  const alpha = createProjectStore({ organizationId: "org-alpha", storage, fetchImpl: offline, clock: () => NOW });
  const bravo = createProjectStore({ organizationId: "org-bravo", storage, fetchImpl: offline, clock: () => NOW });
  await alpha.save({ ...projectRecord("project-shared", "Alpha"), snapshot: { plan: { id: "plan-summit-forward-2026", version: "3.2" }, receipts: [] } });
  assert.equal((await alpha.list()).projects.length, 1);
  assert.equal((await bravo.list()).projects.length, 0);
  assert.equal((await bravo.load("project-shared")).record, null);
});

test("WebMCP rejects a grant from another Organization", async () => {
  const contract = venueToolContracts.find((item) => item.name === "venue.inspect_layout");
  const planner = createVenuePlanner(summitForwardPlan);
  const grant = createAgentGrant({ id: "grant-cross-org", agentId: "agent-1", organizationId: "org-alpha", projectId: "project-summit-forward", scopes: ["venue:read"], issuedBy: "admin-1", issuedAt: NOW, expiresAt: "2026-08-28T11:00:00.000Z" });
  const result = await executeVenueWebMcpTool({ contract, planner, organizationId: "org-bravo", projectId: "project-summit-forward", authorization: { principal: createAgentPrincipal({ id: "agent-1" }), grant, organizationId: "org-alpha", projectId: "project-summit-forward", clock: () => later }, clock: () => later });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "AUTHORIZATION_DENIED");
  assert.equal(result.structuredContent.error.details.reason, "agent-grant-organization-mismatch");
});

test("stdio MCP repository, session, resources, exports, and logs stay Organization scoped", async () => {
  const alphaRecord = { ...projectRecord("project-alpha", "Alpha"), organizationId: "org-alpha", snapshot: createVenuePlanner(summitForwardPlan).getSnapshot() };
  const alphaRepository = createMemoryProjectRepository([alphaRecord, { ...alphaRecord, id: "project-bravo", organizationId: "org-bravo" }], { organizationId: "org-alpha" });
  assert.deepEqual((await alphaRepository.list()).map((record) => record.id), ["project-alpha"]);
  await assert.rejects(() => alphaRepository.save({ ...alphaRecord, organizationId: "org-bravo" }), /ORGANIZATION_ACCESS_DENIED/);
  const session = createProjectSession({ repository: alphaRepository, organizationId: "org-alpha", clock: () => NOW });
  assert.deepEqual((await session.listProjects()).map((record) => record.id), ["project-alpha", "project-summit-forward"]);
  await assert.rejects(() => session.readProject("project-bravo"), (error) => error.code === "PROJECT_NOT_FOUND");
  const lines = [];
  const logger = createStructuredLogger({ sink: { write: (line) => lines.push(JSON.parse(line)) }, clock: () => NOW });
  createVenueMindMcpServer({ repository: alphaRepository, organizationId: "org-alpha", logger, session });
  assert.ok(lines.some((line) => line.event === "server.created" && line.organizationId === "org-alpha"));
  assert.ok(lines.every((line) => !Object.values(line).includes("org-bravo")));
});
