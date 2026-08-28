import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryCollaborationRepository, createMemorySharingRepository, createWorker, drainNotificationEmail } from "../dist/server/index.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { hashShareToken, NOTIFICATION_EVENT_TYPES, safeNotification, shareLinkStatus } from "../src/domain/sharing.js";

const NOW = "2026-08-28T12:00:00.000Z";

function harness({ rolesBySubject = {}, emailDelivery = null } = {}) {
  const organization = { id: "org-share", name: "SHARE", slug: "share", roles: ["organization-administrator"] };
  const organizationFor = (subject) => ({ ...organization, roles: rolesBySubject[subject] ?? organization.roles });
  const users = new Map(); const sessions = new Map(); const records = new Map(); let sequence = 0; let updateFailures = 0;
  const accounts = {
    async resolveSession(id) { return structuredClone(sessions.get(id) ?? null); },
    async provision(identity) { const user = users.get(identity.subject) ?? { id: `user-${identity.subject}`, email: `${identity.subject}@example.test`, displayName: identity.subject.toUpperCase(), status: "active" }; users.set(identity.subject, user); return { user, organizations: [organizationFor(identity.subject)] }; },
    async createSession(userId) { const [subject, user] = [...users.entries()].find(([, item]) => item.id === userId); const session = { id: `session-${++sequence}`, userId, createdAt: NOW, expiresAt: "2026-08-29T12:00:00.000Z", lastSeenAt: NOW, revokedAt: null }; sessions.set(session.id, { session, user, organizations: [organizationFor(subject)] }); return session; },
  };
  const projects = {
    async list(org) { return [...records.values()].filter((item) => item.organizationId === org).map((item) => structuredClone(item)); },
    async get(org, id) { const item = records.get(id); return item?.organizationId === org ? structuredClone(item) : null; },
    async put(org, record, { createOnly = false, expectedRevision = null } = {}) { const current = records.get(record.id); if (!createOnly && updateFailures > 0) { updateFailures -= 1; throw new Error("PROJECT_REVISION_CONFLICT"); } if ((createOnly && current) || (!createOnly && (!current || current.revision !== expectedRevision))) throw new Error("PROJECT_REVISION_CONFLICT"); const saved = { ...structuredClone(record), organizationId: org, revision: current ? current.revision + 1 : 1 }; records.set(record.id, saved); return structuredClone(saved); },
  };
  const sharing = createMemorySharingRepository({ recipients: [{ organizationId: organization.id, userId: "user-reviewer", email: "reviewer@example.test", inAppEnabled: true, emailEnabled: false }] });
  const worker = createWorker({ secureCookies: false, clock: () => NOW, emailDelivery, identityProvider: { authenticate: (request) => { const subject = request.headers.get("x-test-user"); return subject ? { provider: "test", subject, email: `${subject}@example.test`, displayName: subject.toUpperCase() } : null; } }, createAccountRepository: () => accounts, createProjectRepository: () => projects, createCollaborationRepository: () => createMemoryCollaborationRepository(), createSharingRepository: () => sharing });
  const env = { ASSETS: { fetch: async () => new Response("missing", { status: 404 }) }, DB: {} };
  const login = async (subject) => { const response = await worker.fetch(new Request("https://example.test/api/session", { headers: { "x-test-user": subject } }), env); return { cookie: response.headers.get("set-cookie").split(";", 1)[0], ...(await response.json()) }; };
  const request = (path, session = null, { method = "GET", body, headers = {} } = {}) => worker.fetch(new Request(`https://example.test${path}`, { method, headers: { ...(session ? { cookie: session.cookie, "x-venuemind-organization-id": organization.id } : {}), ...(body ? { "content-type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  return { login, request, sharing, worker, env, failProjectUpdates(count) { updateFailures = count; } };
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

test("channel and event preferences suppress delivery, tenants, and recipient email", async () => {
  const sharing = createMemorySharingRepository({ recipients: [
    { organizationId: "org", userId: "user-reviewer", email: "private@example.test", inAppEnabled: true, emailEnabled: false },
    { organizationId: "org-other", userId: "user-other", email: "other@example.test", inAppEnabled: true, emailEnabled: true },
  ] });
  await sharing.setPreferences("user-reviewer", { inAppEnabled: false, emailEnabled: true, eventTypes: ["review_requested"] });
  assert.equal((await sharing.notificationRecipients("org", "approval_completed")).length, 0);
  const recipients = await sharing.notificationRecipients("org", "review_requested");
  assert.deepEqual(recipients, [{ userId: "user-reviewer", email: "private@example.test", inAppEnabled: false, emailEnabled: true }]);
  assert.equal(recipients.some((recipient) => recipient.userId === "user-other"), false);
  const notification = safeNotification({ id: "notification-safe", organizationId: "org", projectId: "project", userId: "user-reviewer", eventType: "review_requested", refs: { projectId: "project", revision: 1 }, createdAt: NOW });
  await sharing.addNotification(notification, { inAppEnabled: recipients[0].inAppEnabled, recipientEmail: recipients[0].email });
  assert.deepEqual(await sharing.listNotifications("user-reviewer", "org"), []);
  await sharing.setPreferences("user-reviewer", { inAppEnabled: true, emailEnabled: true, eventTypes: ["review_requested"] });
  assert.deepEqual(await sharing.listNotifications("user-reviewer", "org"), [], "re-enabling APP must not reveal events created while disabled");
  assert.equal(Object.hasOwn(sharing._notifications[0], "recipientEmail"), false);
  assert.equal(sharing._emailOutbox[0].recipientEmail, "private@example.test");
});

test("pending create and revoke operations fail closed and reconcile each ledger transition exactly once", async () => {
  const app = harness(); const owner = await app.login("owner");
  const planner = createVenuePlanner(summitForwardPlan); const snapshot = planner.getSnapshot();
  const record = { id: "project-recovery", name: "RECOVERY", activePlanId: snapshot.plan.id, schemaVersion: 10, snapshot, createdAt: NOW, updatedAt: NOW };
  assert.equal((await app.request("/api/projects/project-recovery", owner, { method: "PUT", body: record, headers: { "if-none-match": "*" } })).status, 201);

  app.failProjectUpdates(8);
  const creating = await app.request("/api/projects/project-recovery/share-links", owner, { method: "POST", body: { scope: "reviewer", proposalId: snapshot.proposal.id, expiresAt: "2026-08-29T12:00:00.000Z" } });
  assert.equal(creating.status, 202);
  const pendingLink = await creating.json();
  assert.equal((await app.request(`/api/share/${pendingLink.token}`)).status, 404);
  assert.equal((await app.sharing.resolveLink(await hashShareToken(pendingLink.token), NOW)).status, "pending");
  assert.equal((await app.request(`/api/share/${pendingLink.token}`)).status, 200);
  let authoritative = await (await app.request("/api/projects/project-recovery", owner)).json();
  assert.equal(authoritative.snapshot.ledger.filter((entry) => entry.type === "share_link.created" && entry.details.shareLinkId === pendingLink.id).length, 1);

  app.failProjectUpdates(8);
  const revoking = await app.request(`/api/projects/project-recovery/share-links/${pendingLink.id}/revoke`, owner, { method: "POST" });
  assert.equal(revoking.status, 202);
  assert.equal((await app.request(`/api/share/${pendingLink.token}`)).status, 404);
  assert.equal((await app.request(`/api/share/${pendingLink.token}`)).status, 404);
  authoritative = await (await app.request("/api/projects/project-recovery", owner)).json();
  assert.equal(authoritative.snapshot.ledger.filter((entry) => entry.type === "share_link.revoked" && entry.details.shareLinkId === pendingLink.id).length, 1);
});

test("ledgered create and revoke operations recover when repository finalization fails", async () => {
  const app = harness(); const owner = await app.login("owner");
  const planner = createVenuePlanner(summitForwardPlan); const snapshot = planner.getSnapshot();
  const record = { id: "project-finalize", name: "FINALIZE", activePlanId: snapshot.plan.id, schemaVersion: 10, snapshot, createdAt: NOW, updatedAt: NOW };
  await app.request("/api/projects/project-finalize", owner, { method: "PUT", body: record, headers: { "if-none-match": "*" } });
  app.sharing._failNext("markLinkCreated");
  const creating = await app.request("/api/projects/project-finalize/share-links", owner, { method: "POST", body: { scope: "read-only", expiresAt: "2026-08-29T12:00:00.000Z" } });
  assert.equal(creating.status, 202);
  const link = await creating.json();
  assert.equal((await app.request(`/api/share/${link.token}`)).status, 200);
  app.sharing._failNext("markLinkRevoked");
  assert.equal((await app.request(`/api/projects/project-finalize/share-links/${link.id}/revoke`, owner, { method: "POST" })).status, 202);
  assert.equal((await app.request(`/api/share/${link.token}`)).status, 404);
  const authoritative = await (await app.request("/api/projects/project-finalize", owner)).json();
  assert.equal(authoritative.snapshot.ledger.filter((entry) => entry.type === "share_link.created" && entry.details.shareLinkId === link.id).length, 1);
  assert.equal(authoritative.snapshot.ledger.filter((entry) => entry.type === "share_link.revoked" && entry.details.shareLinkId === link.id).length, 1);
});

test("reviewer link retains its exact Proposal after the branch advances", async () => {
  const app = harness(); const owner = await app.login("owner");
  const planner = createVenuePlanner(summitForwardPlan); const initial = planner.getSnapshot(); const pinnedId = initial.proposal.id;
  const record = { id: "project-retained", name: "RETAINED", activePlanId: initial.plan.id, schemaVersion: 10, snapshot: initial, createdAt: NOW, updatedAt: NOW };
  await app.request("/api/projects/project-retained", owner, { method: "PUT", body: record, headers: { "if-none-match": "*" } });
  const created = await app.request("/api/projects/project-retained/share-links", owner, { method: "POST", body: { scope: "reviewer", proposalId: pinnedId, expiresAt: "2026-08-29T12:00:00.000Z" } });
  const link = await created.json();
  const authoritative = await app.request("/api/projects/project-retained", owner); const etag = authoritative.headers.get("etag"); const current = await authoritative.json();
  planner.execute({ type: "restore_snapshot", snapshot: current.snapshot });
  planner.execute({ type: "preview_revision", goal: "Advance branch", actor: "human", idempotencyKey: "advance-retained" });
  const advanced = planner.getSnapshot();
  assert.notEqual(advanced.proposal.id, pinnedId);
  assert.ok(advanced.branches.some((branch) => branch.revisions.some((proposal) => proposal.id === pinnedId)));
  assert.equal((await app.request("/api/projects/project-retained", owner, { method: "PUT", body: { ...current, snapshot: advanced }, headers: { "if-match": etag } })).status, 200);
  const shared = await (await app.request(`/api/share/${link.token}`)).json();
  assert.equal(shared.proposal.id, pinnedId);
});

test("email dispatcher leases, retries, confirms delivery, and sends only safe references", async () => {
  const sharing = createMemorySharingRepository();
  const notification = safeNotification({ id: "notification-email", organizationId: "org", projectId: "project", userId: "user", eventType: "review_requested", refs: { projectId: "project", proposalId: "proposal-1", revision: 2 }, createdAt: NOW });
  await sharing.addNotification(notification, { inAppEnabled: false, recipientEmail: "reviewer@example.test" });
  const calls = [];
  let fail = true;
  const delivery = { async send(message) { calls.push(message); if (fail) throw new Error("PROVIDER_TEMPORARY"); return { delivered: true, providerMessageId: "provider-1" }; } };
  assert.deepEqual(await drainNotificationEmail({ repository: sharing, delivery: null, clock: () => NOW }), { status: "provider-unavailable", claimed: 0, delivered: 0, failed: 0 });
  let result = await drainNotificationEmail({ repository: sharing, delivery, clock: () => NOW });
  assert.deepEqual(result, { status: "drained", claimed: 1, delivered: 0, failed: 1 });
  assert.equal(sharing._emailOutbox[0].deliveredAt, null);
  assert.equal(sharing._emailOutbox[0].failureCode, "PROVIDER_TEMPORARY");
  fail = false;
  result = await drainNotificationEmail({ repository: sharing, delivery, clock: () => "2026-08-28T12:01:00.000Z" });
  assert.deepEqual(result, { status: "drained", claimed: 1, delivered: 1, failed: 0 });
  assert.equal(sharing._emailOutbox[0].attemptCount, 2);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.deepEqual(Object.keys(calls[1]).sort(), ["bodyCode", "idempotencyKey", "refs", "to"]);
  assert.doesNotMatch(JSON.stringify(calls[1]), /geometry|PRIVATE/i);
  assert.equal((await drainNotificationEmail({ repository: sharing, delivery, clock: () => "2026-08-28T12:02:00.000Z" })).claimed, 0);
});

test("scheduled email drain is wired and manual drain is Organization-admin secured", async () => {
  const delivered = [];
  const app = harness({ rolesBySubject: { viewer: ["viewer"] }, emailDelivery: { async send(message) { delivered.push(message); return { delivered: true }; } } });
  const owner = await app.login("owner"); const reviewer = await app.login("reviewer"); const viewer = await app.login("viewer");
  await app.request("/api/notification-preferences", reviewer, { method: "PUT", body: { inAppEnabled: false, emailEnabled: true, eventTypes: ["review_requested"] } });
  const planner = createVenuePlanner(summitForwardPlan); const initial = planner.getSnapshot();
  const record = { id: "project-scheduled-email", name: "EMAIL", activePlanId: initial.plan.id, schemaVersion: 10, snapshot: initial, createdAt: NOW, updatedAt: NOW };
  const created = await app.request("/api/projects/project-scheduled-email", owner, { method: "PUT", body: record, headers: { "if-none-match": "*" } });
  planner.execute({ type: "preview_revision", goal: "Email review", actor: "human", idempotencyKey: "email-review" });
  assert.equal((await app.request("/api/projects/project-scheduled-email", owner, { method: "PUT", body: { ...record, snapshot: planner.getSnapshot(), revision: 1 }, headers: { "if-match": created.headers.get("etag") } })).status, 200);
  assert.equal((await app.request("/api/notifications/email/drain", viewer, { method: "POST" })).status, 403);
  assert.equal(delivered.length, 0);
  await app.worker.scheduled({}, app.env);
  assert.equal(delivered.length, 1);
  assert.equal(app.sharing._emailOutbox[0].deliveredAt, NOW);
  const drained = await app.request("/api/notifications/email/drain", owner, { method: "POST" });
  assert.deepEqual(await drained.json(), { status: "drained", claimed: 0, delivered: 0, failed: 0 });
});
