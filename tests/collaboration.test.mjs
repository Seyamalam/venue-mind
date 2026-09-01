import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryCollaborationRepository, createWorker } from "../dist/server/index.js";
import { createCollaborationClient } from "../src/collaboration/collaboration-client.ts";
import { projectCollaborationEventTypes } from "../src/domain/collaboration-events.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const NOW = "2026-08-28T12:00:00.000Z";

const createHarness = () => {
  const organization = { id: "org-collab", name: "COLLAB", slug: "collab", roles: ["organization-administrator"] };
  const users = new Map();
  const sessions = new Map();
  let sessionNumber = 0;
  const accounts = {
    async resolveSession(id) { const value = sessions.get(id); return value ? structuredClone(value) : null; },
    async provision(identity) {
      const user = users.get(identity.subject) ?? { id: `user-${identity.subject}`, email: identity.email, displayName: identity.displayName, status: "active" };
      users.set(identity.subject, user);
      return { user: structuredClone(user), organizations: [structuredClone(organization)] };
    },
    async createSession(userId) {
      const user = [...users.values()].find((item) => item.id === userId);
      const session = { id: `session-${++sessionNumber}`, userId, createdAt: NOW, expiresAt: "2026-08-29T12:00:00.000Z", lastSeenAt: NOW, revokedAt: null };
      sessions.set(session.id, { session, user, organizations: [organization] });
      return session;
    },
  };
  const records = new Map();
  const projects = {
    async list(organizationId) { return [...records.values()].filter((record) => record.organizationId === organizationId).map((record) => structuredClone(record)); },
    async get(organizationId, id) { const record = records.get(id); return record?.organizationId === organizationId ? structuredClone(record) : null; },
    async put(organizationId, record, { createOnly = false, expectedRevision = null } = {}) {
      const current = records.get(record.id);
      if ((createOnly && current) || (!createOnly && (!current || current.revision !== expectedRevision))) throw new Error("PROJECT_REVISION_CONFLICT");
      const saved = { ...structuredClone(record), organizationId, revision: current ? current.revision + 1 : 1 };
      records.set(record.id, saved);
      return structuredClone(saved);
    },
  };
  const collaboration = createMemoryCollaborationRepository({ clock: () => NOW });
  const worker = createWorker({ secureCookies: false, clock: () => NOW, identityProvider: { authenticate: (request) => { const subject = request.headers.get("x-test-user"); return subject ? { provider: "test", subject, email: `${subject}@example.test`, displayName: subject.toUpperCase() } : null; } }, createAccountRepository: () => accounts, createProjectRepository: () => projects, createCollaborationRepository: () => collaboration });
  const env = { DB: {} };
  const login = async (subject) => {
    const response = await worker.fetch(new Request("https://example.test/api/session", { headers: { "x-test-user": subject } }), env);
    return { cookie: response.headers.get("set-cookie").split(";", 1)[0], user: (await response.json()).user };
  };
  const request = (path, session, { method = "GET", body, headers = {} } = {}) => worker.fetch(new Request(`https://example.test${path}`, { method, headers: { cookie: session.cookie, "x-venuemind-organization-id": organization.id, ...(body ? { "content-type": "application/json" } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  return { collaboration, login, organization, request };
};

const eventTypesFromSse = (text) => [...text.matchAll(/^event: (.+)$/gm)].map((match) => match[1]);

test("three sessions share presence, stream review events, and converge after serialized Approval", async () => {
  const harness = createHarness();
  const [owner, reviewerA, reviewerB] = await Promise.all([harness.login("owner"), harness.login("reviewer-a"), harness.login("reviewer-b")]);
  const planner = createVenuePlanner(summitForwardPlan);
  const input = { id: "project-live", name: "LIVE", activePlanId: planner.getSnapshot().plan.id, schemaVersion: 10, snapshot: planner.getSnapshot(), createdAt: NOW, updatedAt: NOW };
  const created = await harness.request("/api/projects/project-live", owner, { method: "PUT", body: input, headers: { "if-none-match": "*" } });
  assert.equal(created.status, 201);
  let etag = created.headers.get("etag");

  await Promise.all([
    [owner, "obj-stage-west"], [reviewerA, "obj-seating-west"], [reviewerB, "obj-route-main"],
  ].map(([session, focusedObjectId]) => harness.request("/api/projects/project-live/collaboration/presence", session, { method: "PUT", body: { planVersion: "3.2", focusedObjectId } })));
  const initialStream = await harness.request("/api/projects/project-live/collaboration?after=0", reviewerA);
  const initialText = await initialStream.text();
  assert.match(initialText, /event: presence\.snapshot/);
  const presencePayload = JSON.parse(initialText.match(/event: presence\.snapshot\ndata: (.+)/)[1]);
  assert.equal(presencePayload.presence.length, 3);
  assert.deepEqual(new Set(presencePayload.presence.map((item) => item.focusedObjectId)), new Set(["obj-stage-west", "obj-seating-west", "obj-route-main"]));

  planner.execute({ type: "add_comment", anchor: { kind: "proposal", proposalId: planner.getSnapshot().proposal.id }, body: "Review", actor: "human", actorId: reviewerA.user.id, idempotencyKey: "collab-comment-1" });
  let response = await harness.request("/api/projects/project-live", owner, { method: "PUT", body: { ...input, snapshot: planner.getSnapshot(), revision: 1 }, headers: { "if-match": etag } });
  assert.equal(response.status, 200);
  etag = response.headers.get("etag");
  const reviewStream = await harness.request("/api/projects/project-live/collaboration?after=1", reviewerB);
  const reviewTypes = eventTypesFromSse(await reviewStream.text());
  assert.ok(reviewTypes.includes("comment.updated"));
  assert.ok(reviewTypes.includes("ledger.appended"));

  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", actorId: owner.user.id, idempotencyKey: "collab-approval-1" });
  response = await harness.request("/api/projects/project-live", owner, { method: "PUT", body: { ...input, snapshot: planner.getSnapshot(), revision: 2 }, headers: { "if-match": etag } });
  assert.equal(response.status, 200);
  const approvalEvents = await harness.collaboration.events(harness.organization.id, "project-live", 0, 100);
  assert.ok(approvalEvents.events.some((event) => event.type === "approval.committed" && event.projectRevision === 3));

  const snapshots = await Promise.all([owner, reviewerA, reviewerB].map(async (session) => (await (await harness.request("/api/projects/project-live", session)).json()).snapshot));
  assert.ok(snapshots.every((snapshot) => snapshot.plan.version === "3.3"));
  assert.deepEqual(snapshots[0], snapshots[1]);
  assert.deepEqual(snapshots[1], snapshots[2]);
});

test("durable cursor detects a pruned missed event and resumes in order", async () => {
  const repository = createMemoryCollaborationRepository();
  for (let index = 1; index <= 4; index += 1) await repository.append({ organizationId: "org-1", projectId: "project-1", type: "proposal.updated", actorUserId: "user-1", sessionId: "session-1", projectRevision: index, payload: { index }, occurredAt: NOW });
  repository._events.splice(1, 1);
  const resumed = await repository.events("org-1", "project-1", 1, 100);
  assert.equal(resumed.missed, true);
  assert.deepEqual(resumed.events.map((event) => event.id), [3, 4]);
  assert.equal(resumed.cursor, 4);
  assert.equal((await repository.events("org-1", "project-1", 99, 100)).missed, true);
});

test("collaboration client reconnect surface publishes presence and routes typed events", async () => {
  const listeners = new Map();
  class FakeEventSource {
    constructor(url) { this.url = url; FakeEventSource.instance = this; }
    addEventListener(type, listener) { listeners.set(type, listener); }
    close() { this.closed = true; }
  }
  const requests = [];
  const events = [];
  const client = createCollaborationClient({ projectId: "project-1", organizationId: "org-1", EventSourceImpl: FakeEventSource, fetchImpl: async (url, init) => { requests.push({ url, init }); return new Response("{}", { headers: { "content-type": "application/json" } }); }, onEvent: (event) => events.push(event), heartbeatMs: 60_000 });
  client.start();
  await client.updatePresence({ planVersion: "3.2", focusedObjectId: "obj-1" });
  listeners.get("proposal.updated")({ data: JSON.stringify({ sessionId: "session-2", projectRevision: 4, payload: { proposalId: "proposal-1" } }), lastEventId: "9" });
  assert.equal(events[0].type, "proposal.updated");
  assert.equal(events[0].id, 9);
  assert.ok(requests.some((item) => item.init.method === "PUT" && JSON.parse(item.init.body).focusedObjectId === "obj-1"));
  await client.stop();
  assert.equal(FakeEventSource.instance.closed, true);
  assert.ok(requests.some((item) => item.init.method === "DELETE"));
});

test("collaboration event and presence load retains ordering and bounded pages", async () => {
  const repository = createMemoryCollaborationRepository();
  await Promise.all(Array.from({ length: 60 }, (_, index) => repository.upsertPresence({ organizationId: "org-load", projectId: "project-load", sessionId: `session-${index}`, userId: `user-${index}`, displayName: `USER ${index}`, planVersion: "3.2", focusedObjectId: `obj-${index % 12}`, lastSeenAt: NOW, expiresAt: "2026-08-28T12:01:00.000Z" })));
  for (let index = 1; index <= 500; index += 1) await repository.append({ organizationId: "org-load", projectId: "project-load", type: index % 10 === 0 ? "comment.updated" : "proposal.updated", actorUserId: `user-${index % 60}`, sessionId: `session-${index % 60}`, projectRevision: index, payload: { index }, occurredAt: NOW });
  const first = await repository.events("org-load", "project-load", 0, 100);
  const second = await repository.events("org-load", "project-load", first.events.at(-1).id, 100);
  assert.equal((await repository.presence("org-load", "project-load", NOW)).length, 60);
  assert.equal(first.events.length, 100);
  assert.equal(second.events.length, 100);
  assert.equal(second.events[0].previousEventId, first.events.at(-1).id);
  assert.ok([...first.events, ...second.events].every((event, index, values) => index === 0 || event.id > values[index - 1].id));
});

test("event classification covers comments, ledger, Proposal, and Approval without duplicating metadata-only writes", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const before = { id: "project-1", snapshot: structuredClone(planner.getSnapshot()) };
  planner.execute({ type: "add_comment", anchor: { kind: "project", projectId: "project-1" }, body: "Review", actor: "human", actorId: "reviewer", idempotencyKey: "event-comment" });
  const afterComment = { id: "project-1", snapshot: structuredClone(planner.getSnapshot()) };
  assert.deepEqual(projectCollaborationEventTypes(before, afterComment), ["comment.updated", "ledger.appended"]);
  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "event-approval" });
  const afterApproval = { id: "project-1", snapshot: structuredClone(planner.getSnapshot()) };
  assert.deepEqual(projectCollaborationEventTypes(afterComment, afterApproval), ["ledger.appended", "proposal.updated", "approval.committed"]);
});
