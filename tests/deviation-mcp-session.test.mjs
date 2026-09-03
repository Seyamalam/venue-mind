import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryProjectRepository } from "../packages/mcp-server/src/project-repository.ts";
import { createProjectSession } from "../packages/mcp-server/src/project-session.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";

const clockValues = [
  "2026-09-12T08:00:00.000Z",
  "2026-09-12T09:00:00.000Z",
  "2026-09-12T09:05:00.000Z",
  "2026-09-12T09:10:00.000Z",
  "2026-09-12T09:15:00.000Z",
  "2026-09-12T09:20:00.000Z",
];
const tickingClock = () => {
  let index = 0;
  return () => clockValues[Math.min(index++, clockValues.length - 1)];
};

const change = {
  id: "change-live-egress",
  title: "East exit controlled",
  targetObjectIds: ["obj-fire-exit-east"],
  spatialEffects: [
    { operation: "update_metadata", objectId: "obj-fire-exit-east", values: { label: "East exit — controlled" } },
  ],
};

test("MCP Project session persists the supervised Live Plan Deviation lifecycle", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const seedProposal = planner.getSnapshot().proposal;
  planner.execute({
    type: "approve_proposal",
    proposalId: seedProposal.id,
    baseVersion: seedProposal.baseVersion,
    actor: "human",
    actorId: "seed-approver",
    idempotencyKey: "seed-deviation-session",
  });
  const snapshot = planner.getSnapshot();
  const repository = createMemoryProjectRepository([
    {
      id: "project-summit-forward",
      organizationId: "org-local",
      name: "SummitForward 2026",
      activePlanId: snapshot.plan.id,
      schemaVersion: 10,
      snapshot,
      createdAt: "2026-09-12T07:00:00.000Z",
      updatedAt: "2026-09-12T07:00:00.000Z",
      archivedAt: null,
      deletedAt: null,
      recoveryUntil: null,
      pinned: true,
      lastOpenedAt: null,
    },
  ]);
  const session = createProjectSession({ repository, clock: tickingClock() });
  const initial = await session.inspectLivePlanDeviations();
  assert.equal(initial.register.revision, 0);
  assert.deepEqual(initial.deviations, []);

  const recorded = await session.recordLivePlanDeviation({
    deviationId: "deviation-east-exit",
    disposition: "revision-candidate",
    reasonCode: "LIVE_EGRESS_CONTROL",
    location: { kind: "plan-object", planObjectId: "obj-fire-exit-east" },
    affectedObjectIds: ["obj-fire-exit-east"],
    availableConstraintIds: ["constraint-emergency-readiness", "constraint-peak-congestion"],
    change,
    idempotencyKey: "record-east-exit",
  });
  assert.equal(recorded.register.revision, 1);
  assert.equal(recorded.deviation.status, "active");

  const ended = await session.endLivePlanDeviation({
    deviationId: "deviation-east-exit",
    expectedDeviationRevision: 1,
    reasonCode: "CONTROL_RELEASED",
    idempotencyKey: "end-east-exit",
  });
  assert.equal(ended.deviation.status, "ended");

  const proposed = await session.createPostEventDeviationProposal({
    proposalId: "proposal-post-event-egress",
    goal: "Retain the validated event-day egress control",
    deviationIds: ["deviation-east-exit"],
    idempotencyKey: "propose-east-exit",
  });
  assert.equal(proposed.proposal.status, "review");
  assert.equal(proposed.register.baseline.acceptedPlan.version, initial.register.baseline.acceptedPlan.version);

  const artifact = await session.exportLivePlanDeviations();
  const parsed = JSON.parse(artifact.content);
  assert.equal(parsed.kind, "venuemind-live-plan-deviations");
  assert.deepEqual(Object.keys(parsed).filter((key) => ["approvedPlan", "liveDeviations", "postEventRecommendedRevisions"].includes(key)).sort(), [
    "approvedPlan",
    "liveDeviations",
    "postEventRecommendedRevisions",
  ]);

  const reloaded = createProjectSession({ repository, clock: tickingClock() });
  const persisted = await reloaded.inspectLivePlanDeviations();
  assert.equal(persisted.register.revision, 3);
  assert.equal(persisted.deviations[0].status, "ended");
});
