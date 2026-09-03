import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fingerprintPlan } from "../src/domain/activity-ledger.ts";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { verifyPostEventReviewLedger } from "../src/domain/post-event-review.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import { createWorker } from "../worker/index.ts";

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { return this.database.prepare(this.sql).run(...this.values); }
}
class SqliteD1 {
  constructor() { this.database = new DatabaseSync(":memory:"); this.database.exec("PRAGMA foreign_keys=ON"); }
  prepare(sql) { return new Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.exec("COMMIT"); return results; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  close() { this.database.close(); }
}

const projectId = "project-alpha";
const runbook = createEventDayRunbook({ projectId, plan: summitForwardPlan, validation: { validationId: "validation", inputFingerprint: "validation-input", status: "pass" }, sourceLedgerHeadHash: "activity-head", approvalLedgerEntryId: "approval", frozenAt: "2026-09-12T08:00:00.000Z", frozenBy: "user-operator" });
const prediction = { key: "occupancy:peak-persons:venue:venue", family: "occupancy", metric: "peak-persons", scope: { kind: "venue", id: "venue" }, value: 400, unit: "persons", betterWhen: "target", tolerance: { absolute: 10, relative: 0 }, evidenceRefs: [{ kind: "accepted-plan", id: summitForwardPlan.id, fingerprint: fingerprintPlan(summitForwardPlan) }] };

async function harness() {
  const db = new SqliteD1(); await applyDatabaseMigrations(db);
  await db.batch([
    db.prepare("INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("user-operator", "test", "operator", "operator@example.test", "active", "2026-09-12T08:00:00.000Z", "2026-09-12T08:00:00.000Z"),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-alpha", "ALPHA", "alpha", "user-operator", "2026-09-12T08:00:00.000Z", "2026-09-12T08:00:00.000Z"),
    db.prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(projectId, "org-alpha", "ALPHA", summitForwardPlan.id, "2026-09-12T08:00:00.000Z", "2026-09-12T08:00:00.000Z"),
    db.prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)").bind(projectId, 10, "{}", "2026-09-12T08:00:00.000Z"),
  ]);
  let now = "2026-09-12T09:00:00.000Z";
  const identities = { operator: ["user-operator", ["planner", "venue-administrator"]], safety: ["user-safety", ["safety-officer"]], approver: ["user-approver", ["approver"]], reviewer: ["user-reviewer", ["reviewer"]], viewer: ["user-viewer", ["viewer"]] };
  const api = createWorker({ clock: () => now, secureCookies: false,
    identityProvider: { authenticate: (request) => { const subject = request.headers.get("x-test-identity"); return subject ? { provider: "test", subject, email: `${subject}@example.test`, displayName: subject.toUpperCase() } : null; } },
    createAccountRepository: () => ({ resolveSession: async () => null, provision: async (identity) => ({ user: { id: identities[identity.subject][0], email: identity.email, displayName: identity.displayName, status: "active" }, organizations: [{ id: "org-alpha", name: "ALPHA", slug: "alpha", roles: identities[identity.subject][1] }] }), createSession: async (userId) => ({ id: `session-${userId}`, userId, createdAt: now, expiresAt: "2026-09-13T00:00:00.000Z", lastSeenAt: now, revokedAt: null }) }),
    createProjectRepository: () => ({ list: async () => [], get: async (organizationId, id) => organizationId === "org-alpha" && id === projectId ? { id, organizationId, name: "ALPHA", revision: 1, snapshot: { scenarioRuns: [] } } : null, put: async () => { throw new Error("unused"); } }),
  });
  const request = (path, { identity = "operator", method = "GET", body } = {}) => api.fetch(new Request(`https://example.test${path}`, { method, headers: { accept: "application/json", "x-test-identity": identity, "x-venuemind-organization-id": "org-alpha", ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }), { DB: db });
  return { db, request, setNow(value) { now = value; } };
}

async function createSources(request) {
  assert.equal((await request(`/api/projects/${projectId}/runbooks`, { method: "POST", body: { runbook } })).status, 201);
  const occupancy = await (await request(`/api/projects/${projectId}/occupancy-monitors`, { method: "POST", body: { runbookVersionId: runbook.versionId } })).json();
  const incidents = await (await request(`/api/projects/${projectId}/incident-registers`, { method: "POST", body: { runbookVersionId: runbook.versionId } })).json();
  const deviations = await (await request(`/api/projects/${projectId}/deviation-registers`, { method: "POST", body: { runbookVersionId: runbook.versionId } })).json();
  return { occupancy: occupancy.monitor, incidents: incidents.register, deviations: deviations.register };
}

test("authenticated Post-event Review routes create, sync, review, reload, and export tenant-scoped state", async (t) => {
  const { db, request, setNow } = await harness(); t.after(() => db.close());
  const sources = await createSources(request);
  const collection = `/api/projects/${projectId}/post-event-reviews`;
  assert.equal((await request(collection, { identity: "viewer", method: "POST", body: {} })).status, 403);
  const response = await request(collection, { method: "POST", body: { runbookVersionId: runbook.versionId, occupancyMonitorId: sources.occupancy.id, incidentRegisterId: sources.incidents.id, deviationRegisterId: sources.deviations.id, scenarioRunIds: [], predictions: [prediction] } });
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  const created = await response.json();
  assert.equal((await request(collection, { method: "POST", body: { runbookVersionId: runbook.versionId, occupancyMonitorId: sources.occupancy.id, incidentRegisterId: sources.incidents.id, deviationRegisterId: sources.deviations.id, scenarioRunIds: [], predictions: [prediction] } })).status, 200);
  const item = `${collection}/${encodeURIComponent(created.review.id)}`;
  const observationEvidence = [{ kind: "occupancy-projection", id: sources.occupancy.id, fingerprint: created.review.source.occupancyProjectionFingerprint }];
  setNow("2026-09-12T18:01:00.000Z");
  const observation = { type: "record_post_event_observation", observationId: "observation-peak", predictionKey: prediction.key, value: 430, confidence: "measured", evidenceRefs: observationEvidence, idempotencyKey: "observe-peak", expectedRevision: 0 };
  const observed = await (await request(`${item}/commands:sync`, { identity: "safety", method: "POST", body: { commands: [observation, observation] } })).json();
  assert.deepEqual(observed.acknowledgements.map(({ status }) => status), ["applied", "already-applied"]);
  assert.equal(observed.review.observations[0].recorded.actorId, "user-safety");
  assert.equal(observed.review.observations[0].recorded.occurredAt, "2026-09-12T18:01:00.000Z");
  const lesson = { type: "record_post_event_lesson", lessonId: "lesson-capacity", comparisonKey: prediction.key, lessonCode: "CAPACITY_BUFFER", findingCode: "PEAK_ABOVE_MODEL", recommendedActionCode: "INCREASE_BUFFER", requirementIds: ["req-theater-seating"], constraintIds: ["constraint-capacity"], idempotencyKey: "lesson-capacity", expectedRevision: 1 };
  const learned = await (await request(`${item}/commands:sync`, { identity: "safety", method: "POST", body: { commands: [lesson] } })).json();
  assert.equal(learned.acknowledgements[0].status, "applied");
  const proposal = { type: "create_template_improvement_proposal", proposalId: "proposal-capacity", goal: "Increase capacity buffer", target: { kind: "room", templateId: "room-template-harborview-main-hall", version: "1.0.0" }, changes: [{ id: "change-capacity", effects: { capacityBuffer: 20 } }], changeLessonLinks: [{ changeId: "change-capacity", lessonIds: ["lesson-capacity"] }], idempotencyKey: "proposal-capacity", expectedRevision: 2 };
  const denied = await (await request(`${item}/commands:sync`, { identity: "safety", method: "POST", body: { commands: [proposal] } })).json();
  assert.equal(denied.acknowledgements[0].code, "AUTHORIZATION_DENIED");
  const proposed = await (await request(`${item}/commands:sync`, { method: "POST", body: { commands: [proposal] } })).json();
  assert.equal(proposed.acknowledgements[0].status, "applied");
  const review = { type: "review_template_improvement_proposal", proposalId: "proposal-capacity", expectedProposalRevision: 1, decision: "approved", reasonCode: "EVIDENCE_ACCEPTED", idempotencyKey: "review-capacity", expectedRevision: 3 };
  const approved = await (await request(`${item}/commands:sync`, { identity: "approver", method: "POST", body: { commands: [review] } })).json();
  assert.equal(approved.acknowledgements[0].subject.status, "approved-recommendation");
  assert.equal(approved.acknowledgements[0].subject.publicationStatus, "not-published");
  const loaded = await (await request(item, { identity: "viewer" })).json();
  assert.equal(verifyPostEventReviewLedger(loaded.review).status, "pass");
  const exported = await (await request(`${item}/export?format=text`, { identity: "reviewer" })).json();
  assert.equal(exported.artifact.mimeType, "text/plain");
});

test("routes reject forged actor/time, unknown fields, stale revisions, and viewer writes", async (t) => {
  const { db, request } = await harness(); t.after(() => db.close());
  const sources = await createSources(request);
  const collection = `/api/projects/${projectId}/post-event-reviews`;
  assert.equal((await request(collection, { method: "POST", body: { runbookVersionId: runbook.versionId, occupancyMonitorId: sources.occupancy.id, incidentRegisterId: sources.incidents.id, deviationRegisterId: sources.deviations.id, scenarioRunIds: [], predictions: [prediction], actorId: "forged" } })).status, 400);
  const created = await (await request(collection, { method: "POST", body: { runbookVersionId: runbook.versionId, occupancyMonitorId: sources.occupancy.id, incidentRegisterId: sources.incidents.id, deviationRegisterId: sources.deviations.id, scenarioRunIds: [], predictions: [prediction] } })).json();
  const item = `${collection}/${encodeURIComponent(created.review.id)}`;
  const base = { type: "record_post_event_observation", observationId: "observation-peak", predictionKey: prediction.key, value: 400, confidence: "measured", evidenceRefs: prediction.evidenceRefs, idempotencyKey: "observe", expectedRevision: 0 };
  const result = await (await request(`${item}/commands:sync`, { method: "POST", body: { commands: [{ ...base, actorType: "agent", actorId: "forged", committedAt: "1999-01-01T00:00:00.000Z" }, base, { ...base, observationId: "stale", idempotencyKey: "stale", expectedRevision: 0 }] } })).json();
  assert.deepEqual(result.acknowledgements.map(({ status }) => status), ["rejected", "applied", "conflict"]);
  assert.equal((await request(`${item}/commands:sync`, { identity: "viewer", method: "POST", body: { commands: [] } })).status, 403);
  assert.equal((await request(`${item}/export`, { identity: "viewer" })).status, 403);
});
