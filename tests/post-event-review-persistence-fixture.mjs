import { fingerprintPlan, stableFingerprint } from "../src/domain/activity-ledger.ts";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { createIncidentRegister } from "../src/domain/incidents.ts";
import { createLivePlanDeviationRegister } from "../src/domain/live-plan-deviations.ts";
import { createLiveOccupancyMonitor, evaluateLiveOccupancy } from "../src/domain/live-occupancy.ts";
import { createPostEventReview } from "../src/domain/post-event-review.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

export const projectId = "project-summit-forward";

export const makePostEventReviewFixture = () => {
  const runbook = createEventDayRunbook({
    projectId,
    plan: summitForwardPlan,
    validation: { validationId: "validation-accepted", inputFingerprint: "validation-input-accepted", status: "pass" },
    sourceLedgerHeadHash: "activity-ledger-head",
    approvalLedgerEntryId: "approval-ledger-entry",
    frozenAt: "2026-09-12T08:00:00.000Z",
    frozenBy: "user-ops",
  });
  const occupancyMonitor = createLiveOccupancyMonitor({
    type: "create_occupancy_monitor",
    projectId,
    runbook,
    createdAt: "2026-09-12T08:05:00.000Z",
    createdBy: "user-ops",
  });
  const occupancyProjection = evaluateLiveOccupancy(occupancyMonitor, { at: "2026-09-12T18:00:00.000Z" });
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
  const scenarioRun = {
    id: "scenario-run-arrival",
    scenarioId: "scenario-arrival",
    scenarioFingerprint: "scenario-definition-fingerprint",
    scenarioSnapshot: { schemaVersion: 1, id: "scenario-arrival", name: "Arrival", model: "arrival-throughput" },
    model: "arrival-throughput",
    branchId: "main",
    planId: summitForwardPlan.id,
    planVersion: String(summitForwardPlan.version),
    inputFingerprint: "scenario-input-fingerprint",
    engineVersion: "1",
    status: "completed",
    progress: 1,
    completedPhaseIds: ["simulate"],
    partialResult: null,
    result: { peakPersons: 400, averageWaitSeconds: 120 },
    startedAt: "2026-09-11T08:00:00.000Z",
    completedAt: "2026-09-11T08:00:01.000Z",
    cancellationReason: null,
  };
  const planEvidence = {
    kind: "accepted-plan",
    id: summitForwardPlan.id,
    fingerprint: fingerprintPlan(summitForwardPlan),
  };
  const scenarioEvidence = {
    kind: "scenario-run",
    id: scenarioRun.id,
    fingerprint: stableFingerprint("post-event-scenario-run", scenarioRun),
  };
  const predictions = [
    {
      key: "occupancy:peak-persons:venue:venue",
      family: "occupancy",
      metric: "peak-persons",
      scope: { kind: "venue", id: "venue" },
      value: 400,
      unit: "persons",
      betterWhen: "target",
      tolerance: { absolute: 10, relative: 0.02 },
      evidenceRefs: [planEvidence, scenarioEvidence],
    },
  ];
  const review = createPostEventReview({
    type: "create_post_event_review",
    projectId,
    runbook,
    occupancyMonitor,
    occupancyProjection,
    incidentRegister,
    deviationRegister,
    scenarioRuns: [scenarioRun],
    predictions,
    createdAt: "2026-09-12T18:05:00.000Z",
    createdBy: "user-ops",
  });
  return { review, runbook, occupancyMonitor, incidentRegister, deviationRegister, scenarioRun, predictions, planEvidence };
};

export const observationCommand = (clientSequence, idempotencyKey, value = 400) => {
  const { review, planEvidence } = makePostEventReviewFixture();
  return {
    type: "record_post_event_observation",
    projectId,
    observationId: `observation-${clientSequence}`,
    predictionKey: review.predictions[0].key,
    value,
    confidence: "measured",
    evidenceRefs: [planEvidence],
    expectedRevision: 0,
    actorType: "human",
    actorId: "user-ops",
    source: "studio",
    sessionId: "session-review",
    operationId: `operation-${clientSequence}`,
    correlationId: `correlation-${clientSequence}`,
    clientId: "browser-a",
    clientSequence,
    clientOccurredAt: "2026-09-12T18:10:00.000Z",
    idempotencyKey,
  };
};
