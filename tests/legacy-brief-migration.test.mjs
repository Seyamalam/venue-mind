import assert from "node:assert/strict";
import test from "node:test";
import { createWorker } from "../dist/server/index.js";
import { sealActivityLedger } from "../src/domain/activity-ledger.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";

const legacyRecord = () => {
  const planner = createVenuePlanner(summitForwardPlan);
  planner.execute({ type: "update_event_brief", brief: { ...planner.getSnapshot().brief, attendeeTarget: 420 }, actor: "human", idempotencyKey: "legacy-brief-update" });
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.ledger = sealActivityLedger(snapshot.ledger.map((entry) => {
    const details = structuredClone(entry.details);
    delete details.acceptedBrief;
    delete details.briefFingerprint;
    delete details.briefMigrationProof;
    return { ...entry, details };
  }));
  return { id: "project-summit-forward", organizationId: "org-test", name: "SummitForward 2026", activePlanId: snapshot.plan.id, schemaVersion: 10, snapshot, createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z", revision: 4 };
};

const harness = (roles = ["organization-administrator"]) => {
  const records = new Map([["org-test:project-summit-forward", legacyRecord()]]);
  const user = { id: "user-admin", email: "admin@example.com", displayName: "Admin", status: "active" };
  const worker = createWorker({
    secureCookies: false,
    clock: () => "2026-08-28T12:00:00.000Z",
    identityProvider: { authenticate: () => ({ provider: "test", subject: "subject-admin", email: user.email, displayName: user.displayName }) },
    createAccountRepository: () => ({
      resolveSession: async () => null,
      provision: async () => ({ user, organizations: [{ id: "org-test", name: "Test", slug: "test", roles }] }),
      createSession: async () => ({ id: "session-admin", userId: user.id, createdAt: "2026-08-28T00:00:00.000Z", expiresAt: "2026-08-29T00:00:00.000Z", lastSeenAt: "2026-08-28T00:00:00.000Z", revokedAt: null }),
    }),
    createProjectRepository: () => ({
      list: async (organizationId) => [...records.values()].filter((record) => record.organizationId === organizationId),
      get: async (organizationId, id) => records.get(`${organizationId}:${id}`) ?? null,
      put: async (organizationId, record, { expectedRevision = null } = {}) => {
        const key = `${organizationId}:${record.id}`;
        const current = records.get(key);
        if (!current || current.revision !== expectedRevision) throw new Error("PROJECT_REVISION_CONFLICT");
        const saved = { ...record, revision: current.revision + 1 };
        records.set(key, saved);
        return saved;
      },
    }),
  });
  const env = { ASSETS: { fetch: async () => new Response("missing", { status: 404 }) }, DB: {} };
  const request = (path, init = {}) => worker.fetch(new Request(`https://example.test${path}`, { ...init, headers: { "x-venuemind-organization-id": "org-test", ...(init.headers ?? {}) } }), env);
  return { records, request };
};

test("administrator inspects and atomically attests an edited legacy Brief", async () => {
  const { records, request } = harness();
  const inspectionResponse = await request("/api/projects/project-summit-forward/migrations/legacy-brief");
  assert.equal(inspectionResponse.status, 200);
  const inspection = await inspectionResponse.json();
  assert.equal(inspection.status, "attestation-required");
  assert.equal(inspection.projectRevision, 4);
  assert.equal(inspection.legacyEvidence.attendeeTarget, 420);
  assert.equal(inspection.brief.attendeeTarget, 420);
  assert.equal(inspection.brief.eventName, "SummitForward 2026");
  assert.equal(Array.isArray(inspection.brief.requirements), true);
  assert.match(inspection.planSha256, /^[0-9a-f]{64}$/);
  assert.match(inspection.briefSha256, /^[0-9a-f]{64}$/);

  const body = {
    challengeId: inspection.challengeId,
    expectedProjectRevision: inspection.projectRevision,
    expectedLedgerHeadHash: inspection.legacyLedgerHeadHash,
    expectedPlanSha256: inspection.planSha256,
    expectedBriefSha256: inspection.briefSha256,
    reason: "Reviewed legacy Event Brief",
    idempotencyKey: "attest-legacy-brief-420",
  };
  const attestedResponse = await request("/api/projects/project-summit-forward/migrations/legacy-brief/attest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(attestedResponse.status, 200);
  const attested = await attestedResponse.json();
  assert.equal(attested.status, "attested");
  assert.equal(attested.project.revision, 5);
  const proof = attested.project.snapshot.ledger.at(-1).details.briefMigrationProof;
  assert.equal(proof.challengeId, inspection.challengeId);
  assert.equal(proof.actorId, "user-admin");
  assert.equal(proof.actorRole, "organization-administrator");
  assert.equal(attested.project.snapshot.brief.attendeeTarget, 420);
  const snapshot = records.get("org-test:project-summit-forward").snapshot;
  const restored = createVenuePlanner({ ...snapshot.plan, brief: snapshot.brief, proposal: snapshot.proposal });
  assert.equal(restored.execute({ type: "restore_snapshot", snapshot }).status, "restored");

  const retry = await request("/api/projects/project-summit-forward/migrations/legacy-brief/attest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).status, "already-attested");
  assert.equal(records.get("org-test:project-summit-forward").revision, 5);
});

test("legacy Brief attestation rejects stale bindings and non-administrators", async () => {
  const admin = harness();
  const inspection = await (await admin.request("/api/projects/project-summit-forward/migrations/legacy-brief")).json();
  const stale = await admin.request("/api/projects/project-summit-forward/migrations/legacy-brief/attest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: inspection.challengeId, expectedProjectRevision: 3, expectedLedgerHeadHash: inspection.legacyLedgerHeadHash, expectedPlanSha256: inspection.planSha256, expectedBriefSha256: inspection.briefSha256, reason: "Reviewed", idempotencyKey: "stale-attestation" }) });
  assert.equal(stale.status, 412);
  assert.equal((await stale.json()).code, "LEGACY_BRIEF_CHALLENGE_STALE");

  const planner = harness(["planner"]);
  const deniedInspection = await (await planner.request("/api/projects/project-summit-forward/migrations/legacy-brief")).json();
  const denied = await planner.request("/api/projects/project-summit-forward/migrations/legacy-brief/attest", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challengeId: deniedInspection.challengeId, expectedProjectRevision: deniedInspection.projectRevision, expectedLedgerHeadHash: deniedInspection.legacyLedgerHeadHash, expectedPlanSha256: deniedInspection.planSha256, expectedBriefSha256: deniedInspection.briefSha256, reason: "Reviewed", idempotencyKey: "denied-attestation" }) });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "LEGACY_BRIEF_ATTESTATION_DENIED");
});
