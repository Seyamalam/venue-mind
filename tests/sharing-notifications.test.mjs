import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryCollaborationRepository, createMemorySharingRepository, createWorker } from "../dist/server/index.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { NOTIFICATION_EVENT_TYPES, safeNotification, shareLinkStatus } from "../src/domain/sharing.js";

const NOW = "2026-08-28T12:00:00.000Z";

function harness({ rolesBySubject = {} } = {}) {
  const organization = { id: "org-share", name: "SHARE", slug: "share", roles: ["organization-administrator"] };
  const organizationFor = (subject) => ({ ...organization, roles: rolesBySubject[subject] ?? organization.roles });
  const users = new Map(); const sessions = new Map(); const records = new Map(); let sequence = 0;
  const accounts = {
    async resolveSession(id) { return structuredClone(sessions.get(id) ?? null); },
    async provision(identity) { const user = users.get(identity.subject) ?? { id: `user-${identity.subject}`, email: `${identity.subject}@example.test`, displayName: identity.subject.toUpperCase(), status: "active" }; users.set(identity.subject, user); return { user, organizations: [organizationFor(identity.subject)] }; },
    async createSession(userId) { const [subject, user] = [...users.entries()].find(([, item]) => item.id === userId); const session = { id: `session-${++sequence}`, userId, createdAt: NOW, expiresAt: "2026-08-29T12:00:00.000Z", lastSeenAt: NOW, revokedAt: null }; sessions.set(session.id, { session, user, organizations: [organizationFor(subject)] }); return session; },
  };
  const projects = {
    async list(org) { return [...records.values()].filter((item) => item.organizationId === org).map((item) => structuredClone(item)); },
    async get(org, id) { const item = records.get(id); return item?.organizationId === org ? structuredClone(item) : null; },
    async put(org, record, { createOnly = false, expectedRevision = null } = {}) { const current = records.get(record.id); if ((createOnly && current) || (!createOnly && (!current || current.revision !== expectedRevision))) throw new Error("PROJECT_REVISION_CONFLICT"); const saved = { ...structuredClone(record), organizationId: org, revision: current ? current.revision + 1 : 1 }; records.set(record.id, saved); return structuredClone(saved); },
  };
  const sharing = createMemorySharingRepository({ recipients: [{ userId: "user-reviewer", email: "reviewer@example.test", inAppEnabled: true, emailEnabled: false }] });
  const worker = createWorker({ secureCookies: false, clock: () => NOW, identityProvider: { authenticate: (request) => { const subject = request.headers.get("x-test-user"); return subject ? { provider: "test", subject, email: `${subject}@example.test`, displayName: subject.toUpperCase() } : null; } }, createAccountRepository: () => accounts, createProjectRepository: () => projects, createCollaborationRepository: () => createMemoryCollaborationRepository(), createSharingRepository: () => sharing });
  const env = { ASSETS: { fetch: async () => new Response("missing", { status: 404 }) }, DB: {} };
  const login = async (subject) => { const response = await worker.fetch(new Request("https://example.test/api/session", { headers: { "x-test-user": subject } }), env); return { cookie: response.headers.get("set-cookie").split(";", 1)[0], ...(await response.json()) }; };
  const request = (path, session = null, { method = "GET", body, headers = {} } = {}) => worker.fetch(new Request(`https://example.test${path}`, { method, headers: { ...(session ? { cookie: session.cookie, "x-venuemind-organization-id": organization.id } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  return { login, request, sharing };
}

test("revoked Proposal-scoped share link loses access immediately and both transitions are ledgered", async () => {
  const app = harness(); const owner = await app.login("owner");
  const planner = createVenuePlanner(summitForwardPlan); const snapshot = planner.getSnapshot();
  const record = { id: "project-share", name: "SHARE", activePlanId: snapshot.plan.id, schemaVersion: 10, snapshot, createdAt: NOW, updatedAt: NOW };
  assert.equal((await app.request("/api/projects/project-share", owner, { method: "PUT", body: record, headers: { "if-none-match": "*" } })).status, 201);
  const created = await app.request("/api/projects/project-share/share-links", owner, { method: "POST", body: { scope: "reviewer", proposalId: snapshot.proposal.id, expiresAt: "2026-08-29T12:00:00.000Z" } });
  assert.equal(created.status, 201);
  const link = await created.json();
  assert.equal(link.url, `/share/${link.token}`);
  const shared = await app.request(`/api/share/${link.token}`);
  assert.equal(shared.status, 200);
  const sharedBody = await shared.json();
  assert.equal(sharedBody.proposal.id, snapshot.proposal.id);
  assert.equal(Object.hasOwn(sharedBody, "organizationId"), false);
  assert.equal(Object.hasOwn(sharedBody, "ledger"), false);

  const revoked = await app.request(`/api/projects/project-share/share-links/${encodeURIComponent(link.id)}/revoke`, owner, { method: "POST" });
  assert.equal(revoked.status, 200);
  assert.equal((await app.request(`/api/share/${link.token}`)).status, 404);
  const authoritative = await (await app.request("/api/projects/project-share", owner)).json();
  assert.deepEqual(authoritative.snapshot.ledger.slice(-2).map((entry) => entry.type), ["share_link.created", "share_link.revoked"]);
  assert.ok(authoritative.snapshot.ledger.slice(-2).every((entry) => entry.details.shareLinkId === link.id));
  assert.ok(authoritative.snapshot.ledger.every((entry) => !JSON.stringify(entry).includes(link.token)));
  const persistedLink = [...app.sharing._links.values()][0];
  assert.notEqual(persistedLink.tokenHash, link.token);
  assert.match(persistedLink.tokenHash, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(persistedLink), new RegExp(link.token));
  const listed = await (await app.request("/api/projects/project-share/share-links", owner)).json();
  assert.equal(listed.links[0].status, "revoked");
  assert.equal(Object.hasOwn(listed.links[0], "tokenHash"), false);
  const duplicate = await app.request(`/api/projects/project-share/share-links/${encodeURIComponent(link.id)}/revoke`, owner, { method: "POST" });
  assert.equal((await duplicate.json()).status, "already-revoked");
  const afterDuplicate = await (await app.request("/api/projects/project-share", owner)).json();
  assert.equal(afterDuplicate.snapshot.ledger.filter((entry) => entry.type === "share_link.revoked" && entry.details.shareLinkId === link.id).length, 1);
});

test("in-product notification preferences and safe bodies cover review, Approval, and conflict", async () => {
  const app = harness(); const owner = await app.login("owner"); const reviewer = await app.login("reviewer");
  const planner = createVenuePlanner(summitForwardPlan); const initial = planner.getSnapshot();
  const record = { id: "project-notify", name: "PRIVATE EVENT NAME", activePlanId: initial.plan.id, schemaVersion: 10, snapshot: initial, createdAt: NOW, updatedAt: NOW };
  const created = await app.request("/api/projects/project-notify", owner, { method: "PUT", body: record, headers: { "if-none-match": "*" } });
  let etag = created.headers.get("etag");
  planner.execute({ type: "preview_revision", goal: "PRIVATE GEOMETRY REQUEST", actor: "human", idempotencyKey: "notify-review" });
  let saved = await app.request("/api/projects/project-notify", owner, { method: "PUT", body: { ...record, snapshot: planner.getSnapshot(), revision: 1 }, headers: { "if-match": etag } });
  assert.equal(saved.status, 200); etag = saved.headers.get("etag");
  let notifications = (await (await app.request("/api/notifications", reviewer)).json()).notifications;
  assert.equal(notifications[0].eventType, "review_requested");
  assert.equal(notifications[0].bodyCode, "notification.review_requested");
  assert.doesNotMatch(JSON.stringify(notifications[0]), /PRIVATE|geometry/i);

  planner.execute({ type: "request_adjustment", instruction: "PRIVATE ADJUSTMENT", actor: "human", idempotencyKey: "notify-adjustment" });
  saved = await app.request("/api/projects/project-notify", owner, { method: "PUT", body: { ...record, snapshot: planner.getSnapshot(), revision: 2 }, headers: { "if-match": etag } });
  assert.equal(saved.status, 200); etag = saved.headers.get("etag");
  notifications = (await (await app.request("/api/notifications", reviewer)).json()).notifications;
  assert.ok(notifications.some((item) => item.eventType === "adjustment_requested"));
  assert.doesNotMatch(JSON.stringify(notifications), /PRIVATE|geometry/i);

  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "notify-approval" });
  saved = await app.request("/api/projects/project-notify", owner, { method: "PUT", body: { ...record, snapshot: planner.getSnapshot(), revision: 3 }, headers: { "if-match": etag } });
  assert.equal(saved.status, 200);
  notifications = (await (await app.request("/api/notifications", reviewer)).json()).notifications;
  assert.ok(notifications.some((item) => item.eventType === "approval_completed" && item.refs.planVersion === "3.3"));

  const preferences = await app.request("/api/notification-preferences", reviewer, { method: "PUT", body: { inAppEnabled: true, emailEnabled: false, eventTypes: ["conflict_detected"] } });
  assert.deepEqual(await preferences.json(), { inAppEnabled: true, emailEnabled: false, eventTypes: ["conflict_detected"] });
  const stale = await app.request("/api/projects/project-notify", reviewer, { method: "PUT", body: { ...record, revision: 1 }, headers: { "if-match": '"venuemind:project-notify:1"' } });
  assert.equal(stale.status, 412);
  const reviewerNotifications = (await (await app.request("/api/notifications", reviewer)).json()).notifications;
  assert.ok(reviewerNotifications.some((item) => item.eventType === "conflict_detected" && item.refs.conflictCode === "PROJECT_REVISION_CONFLICT"));
});

test("notification payload rejects narrative, geometry, and unsupported event types", () => {
  assert.deepEqual(new Set(NOTIFICATION_EVENT_TYPES), new Set(["review_requested", "adjustment_requested", "approval_completed", "conflict_detected"]));
  assert.throws(() => safeNotification({ id: "n", organizationId: "o", projectId: "p", userId: "u", eventType: "review_requested", refs: { geometry: "secret" }, createdAt: NOW }), /unsafe/);
  assert.throws(() => safeNotification({ id: "n", organizationId: "o", projectId: "p", userId: "u", eventType: "freeform", refs: {}, createdAt: NOW }), /invalid/);
  assert.throws(() => safeNotification({ id: "n", organizationId: "o", projectId: "p", userId: "u", eventType: "review_requested", refs: { revision: Number.NaN }, createdAt: NOW }), /unsafe/);
});

test("share expiration and revocation status fail closed", () => {
  const link = { expiresAt: "2026-08-28T12:00:01.000Z", revokedAt: null };
  assert.equal(shareLinkStatus(link, "2026-08-28T12:00:00.000Z"), "active");
  assert.equal(shareLinkStatus(link, "2026-08-28T12:00:01.000Z"), "expired");
  assert.equal(shareLinkStatus({ ...link, revokedAt: "2026-08-28T11:59:00.000Z" }, "2026-08-28T12:00:00.000Z"), "revoked");
  assert.equal(shareLinkStatus({ expiresAt: "not-a-date", revokedAt: null }, "2026-08-28T12:00:00.000Z"), "expired");
});

test("read-only share exposes accepted Plan without any Proposal", async () => {
  const app = harness(); const owner = await app.login("owner");
  const planner = createVenuePlanner(summitForwardPlan); const snapshot = planner.getSnapshot();
  const record = { id: "project-read-only", name: "READ ONLY", activePlanId: snapshot.plan.id, schemaVersion: 10, snapshot, createdAt: NOW, updatedAt: NOW };
  assert.equal((await app.request("/api/projects/project-read-only", owner, { method: "PUT", body: record, headers: { "if-none-match": "*" } })).status, 201);
  const created = await app.request("/api/projects/project-read-only/share-links", owner, { method: "POST", body: { scope: "read-only", expiresAt: "2026-08-29T12:00:00.000Z" } });
  assert.equal(created.status, 201);
  const link = await created.json();
  const shared = await (await app.request(`/api/share/${link.token}`)).json();
  assert.equal(shared.scope, "read-only");
  assert.equal(shared.plan.version, snapshot.plan.version);
  assert.equal(Object.hasOwn(shared, "proposal"), false);
});

test("share management is role-isolated and malformed fields fail closed", async () => {
  const app = harness({ rolesBySubject: { viewer: ["viewer"] } });
  const owner = await app.login("owner");
  const viewer = await app.login("viewer");
  const planner = createVenuePlanner(summitForwardPlan); const snapshot = planner.getSnapshot();
  const record = { id: "project-role", name: "ROLE", activePlanId: snapshot.plan.id, schemaVersion: 10, snapshot, createdAt: NOW, updatedAt: NOW };
  assert.equal((await app.request("/api/projects/project-role", owner, { method: "PUT", body: record, headers: { "if-none-match": "*" } })).status, 201);
  assert.equal((await app.request("/api/projects/project-role/share-links", viewer)).status, 403);
  assert.equal((await app.request("/api/projects/project-role/share-links", viewer, { method: "POST", body: { scope: "read-only", expiresAt: "2026-08-29T12:00:00.000Z" } })).status, 403);
  for (const body of [
    { scope: "read-only", expiresAt: "not-a-date" },
    { scope: "read-only", proposalId: snapshot.proposal.id, expiresAt: "2026-08-29T12:00:00.000Z" },
    { scope: "reviewer", proposalId: "proposal-other", expiresAt: "2026-08-29T12:00:00.000Z" },
  ]) assert.equal((await app.request("/api/projects/project-role/share-links", owner, { method: "POST", body })).status, 400);
});

test("channel and event preferences suppress delivery and never expose recipient email", async () => {
  const sharing = createMemorySharingRepository({ recipients: [{ userId: "user-reviewer", email: "private@example.test", inAppEnabled: true, emailEnabled: false }] });
  await sharing.setPreferences("user-reviewer", { inAppEnabled: false, emailEnabled: true, eventTypes: ["review_requested"] });
  assert.equal((await sharing.notificationRecipients("org", "approval_completed")).length, 0);
  const recipients = await sharing.notificationRecipients("org", "review_requested");
  assert.deepEqual(recipients, [{ userId: "user-reviewer", email: "private@example.test", inAppEnabled: false, emailEnabled: true }]);
  const notification = safeNotification({ id: "notification-safe", organizationId: "org", projectId: "project", userId: "user-reviewer", eventType: "review_requested", refs: { projectId: "project", revision: 1 }, createdAt: NOW });
  await sharing.addNotification(notification, recipients[0].email);
  assert.deepEqual(await sharing.listNotifications("user-reviewer", "org"), []);
  assert.equal(Object.hasOwn(sharing._notifications[0], "recipientEmail"), false);
  assert.equal(sharing._emailOutbox[0].recipientEmail, "private@example.test");
});
