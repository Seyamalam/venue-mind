import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintPlan } from "../src/domain/activity-ledger.ts";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { createIncidentRegister } from "../src/domain/incidents.ts";
import { createLivePlanDeviationRegister } from "../src/domain/live-plan-deviations.ts";
import { createLiveOccupancyMonitor, evaluateLiveOccupancy } from "../src/domain/live-occupancy.ts";
import { createPostEventReview } from "../src/domain/post-event-review.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { createMemoryProjectRepository } from "../packages/mcp-server/src/project-repository.ts";
import { createProjectSession } from "../packages/mcp-server/src/project-session.ts";

const projectId = "project-summit-forward";
const makeReview = () => {
  const runbook = createEventDayRunbook({
    projectId,
    plan: summitForwardPlan,
    validation: { validationId: "validation-post-event", inputFingerprint: "validation-input", status: "pass" },
    sourceLedgerHeadHash: "activity-ledger-head",
    approvalLedgerEntryId: "approval-ledger-entry",
    frozenAt: "2026-09-12T08:00:00.000Z",
    frozenBy: "user-ops",
  });
  const occupancyMonitor = createLiveOccupancyMonitor({
    projectId,
    runbook,
    createdAt: "2026-09-12T08:05:00.000Z",
    createdBy: "user-ops",
  });
  const incidentRegister = createIncidentRegister({
    type: "create_incident_register",
    projectId,
    runbook,
    createdAt: "2026-09-12T08:05:00.000Z",
    createdBy: "user-ops",
  });
  const deviationRegister = createLivePlanDeviationRegister({
    type: "create_deviation_register",
    projectId,
    runbook,
    createdAt: "2026-09-12T08:05:00.000Z",
    createdBy: "user-ops",
  });
  return createPostEventReview({
    type: "create_post_event_review",
    projectId,
    runbook,
    occupancyMonitor,
    occupancyProjection: evaluateLiveOccupancy(occupancyMonitor, { at: "2026-09-12T18:00:00.000Z" }),
    incidentRegister,
    deviationRegister,
    scenarioRuns: [],
    predictions: [{
      key: "occupancy:peak-persons:venue:venue",
      family: "occupancy",
      metric: "peak-persons",
      scope: { kind: "venue", id: "venue" },
      value: 400,
      unit: "persons",
      betterWhen: "target",
      tolerance: { absolute: 10, relative: 0.02 },
      evidenceRefs: [{ kind: "accepted-plan", id: summitForwardPlan.id, fingerprint: fingerprintPlan(summitForwardPlan) }],
    }],
    createdAt: "2026-09-12T18:05:00.000Z",
    createdBy: "user-ops",
  });
};

test("standalone MCP session persists the agent-safe Post-event workflow", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const snapshot = planner.getSnapshot();
  const review = makeReview();
  const repository = createMemoryProjectRepository([{
    id: projectId,
    organizationId: "org-local",
    name: "SummitForward 2026",
    activePlanId: snapshot.plan.id,
    schemaVersion: 10,
    snapshot,
    postEventReview: review,
    createdAt: "2026-09-12T07:00:00.000Z",
    updatedAt: "2026-09-12T07:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    recoveryUntil: null,
    pinned: true,
    lastOpenedAt: null,
  }]);
  let tick = 0;
  const clock = () => new Date(Date.parse("2026-09-12T18:10:00.000Z") + tick++ * 1000).toISOString();
  const session = createProjectSession({ repository, clock });

  const initial = await session.inspectPostEventReview();
  assert.equal(initial.review.revision, 0);
  const evidenceRefs = [{ kind: "accepted-plan", id: summitForwardPlan.id, fingerprint: fingerprintPlan(summitForwardPlan) }];
  const observed = await session.recordPostEventObservation({
    observationId: "observation-peak",
    predictionKey: "occupancy:peak-persons:venue:venue",
    value: 438,
    confidence: "measured",
    evidenceRefs,
    expectedRevision: 0,
    idempotencyKey: "observe-peak",
  });
  assert.equal(observed.review.revision, 1);
  assert.equal(observed.subject.id, "observation-peak");

  const learned = await session.recordPostEventLesson({
    lessonId: "lesson-capacity-buffer",
    comparisonKey: "occupancy:peak-persons:venue:venue",
    lessonCode: "CAPACITY_BUFFER",
    findingCode: "PEAK_ABOVE_MODEL",
    recommendedActionCode: "INCREASE_BUFFER",
    requirementIds: ["req-theater-seating"],
    constraintIds: ["constraint-capacity"],
    expectedRevision: 1,
    idempotencyKey: "lesson-capacity",
  });
  assert.equal(learned.review.revision, 2);

  const proposed = await session.createTemplateImprovementProposal({
    proposalId: "template-proposal-capacity",
    goal: "Increase the standard capacity buffer",
    target: { kind: "room", templateId: "room-template-harborview-main-hall", version: "1.0.0" },
    changes: [{ id: "change-capacity-buffer", effects: { capacityBuffer: 20 } }],
    changeLessonLinks: [{ changeId: "change-capacity-buffer", lessonIds: ["lesson-capacity-buffer"] }],
    expectedRevision: 2,
    idempotencyKey: "proposal-capacity",
  });
  assert.equal(proposed.subject.status, "pending-human-review");
  assert.equal(proposed.subject.publicationStatus, "not-published");

  const artifact = await session.exportPostEventReport({ format: "json" });
  assert.equal(JSON.parse(artifact.content).integrity.status, "pass");

  const reloaded = createProjectSession({ repository, clock });
  const persisted = await reloaded.inspectPostEventReview();
  assert.equal(persisted.review.revision, 3);
  assert.equal(persisted.review.templateProposals[0].status, "pending-human-review");
  assert.equal("reviewTemplateImprovementProposal" in session, false);
});
