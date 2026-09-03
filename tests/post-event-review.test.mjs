import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintPlan, stableFingerprint } from "../src/domain/activity-ledger.ts";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { createIncidentRegister } from "../src/domain/incidents.ts";
import { createLivePlanDeviationRegister } from "../src/domain/live-plan-deviations.ts";
import { createLiveOccupancyMonitor, evaluateLiveOccupancy } from "../src/domain/live-occupancy.ts";
import {
  comparePostEventOutcomes,
  createPostEventReview,
  createTemplateImprovementProposal,
  exportPostEventReport,
  recordPostEventLesson,
  recordPostEventObservation,
  reviewTemplateImprovementProposal,
  verifyPostEventReviewLedger,
} from "../src/domain/post-event-review.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const projectId = "project-summit-forward";
const makeFixture = () => {
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
  const planEvidence = { kind: "accepted-plan", id: summitForwardPlan.id, fingerprint: fingerprintPlan(summitForwardPlan) };
  const occupancyEvidence = {
    kind: "occupancy-projection",
    id: occupancyMonitor.id,
    fingerprint: stableFingerprint("post-event-occupancy-projection", occupancyProjection),
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
    {
      key: "queue:average-wait-seconds:queue:check-in",
      family: "queue",
      metric: "average-wait-seconds",
      scope: { kind: "queue", id: "check-in" },
      value: 120,
      unit: "seconds",
      betterWhen: "lower",
      tolerance: { absolute: 10, relative: 0.05 },
      evidenceRefs: [scenarioEvidence],
    },
  ];
  const create = {
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
  };
  return { create, planEvidence, scenarioEvidence, occupancyEvidence };
};

const context = (idempotencyKey, expectedRevision, overrides = {}) => ({
  idempotencyKey,
  expectedRevision,
  actorType: "human",
  actorId: "user-ops",
  source: "studio",
  sessionId: "session-review",
  ...overrides,
});

test("PostEventReview freezes exact operational provenance and deterministically compares all outcomes", () => {
  const { create, planEvidence, occupancyEvidence } = makeFixture();
  const review = createPostEventReview(create);
  assert.equal(review.source.planFingerprint, fingerprintPlan(summitForwardPlan));
  assert.equal(review.baseline.runbook.versionId, create.runbook.versionId);
  assert.equal(Object.isFrozen(review), true);
  assert.deepEqual(comparePostEventOutcomes(review).map(({ status }) => status), ["insufficient-evidence", "insufficient-evidence"]);

  const first = recordPostEventObservation(review, {
    type: "record_post_event_observation",
    observationId: "observation-peak",
    predictionKey: "occupancy:peak-persons:venue:venue",
    value: 407,
    confidence: "measured",
    evidenceRefs: [occupancyEvidence],
    committedAt: "2026-09-12T18:10:00.000Z",
    ...context("observe-peak", 0),
  });
  const second = recordPostEventObservation(first.review, {
    type: "record_post_event_observation",
    observationId: "observation-queue",
    predictionKey: "queue:average-wait-seconds:queue:check-in",
    value: 80,
    confidence: "estimated",
    evidenceRefs: [planEvidence],
    committedAt: "2026-09-12T18:11:00.000Z",
    ...context("observe-queue", 1),
  });
  assert.deepEqual(comparePostEventOutcomes(second.review).map(({ status }) => status), ["matched", "better"]);
  assert.equal(verifyPostEventReviewLedger(second.review).status, "pass");
  assert.equal(fingerprintPlan(second.review.baseline.runbook.baseline.acceptedPlan), review.source.planFingerprint);
});

test("observation mutations are revision checked, evidence bound, and exactly idempotent", () => {
  const { create, planEvidence } = makeFixture();
  const review = createPostEventReview(create);
  const command = {
    type: "record_post_event_observation",
    observationId: "observation-peak",
    predictionKey: "occupancy:peak-persons:venue:venue",
    value: 450,
    confidence: "measured",
    evidenceRefs: [planEvidence],
    committedAt: "2026-09-12T18:10:00.000Z",
    ...context("observe-peak", 0),
  };
  const result = recordPostEventObservation(review, command);
  const retry = recordPostEventObservation(result.review, command);
  assert.equal(retry.duplicate, true);
  assert.equal(retry.review.revision, 1);
  assert.equal(retry.review.ledger.length, 1);
  assert.equal(comparePostEventOutcomes(result.review)[0].status, "worse");
  assert.throws(
    () => recordPostEventObservation(result.review, { ...command, observationId: "stale", idempotencyKey: "stale" }),
    (error) => error.code === "POST_EVENT_REVISION_CONFLICT",
  );
  assert.throws(
    () => recordPostEventObservation(review, { ...command, evidenceRefs: [{ ...planEvidence, fingerprint: "tampered" }] }),
    (error) => error.code === "POST_EVENT_EVIDENCE_INVALID",
  );
  assert.throws(
    () => recordPostEventObservation(result.review, { ...command, value: 451 }),
    (error) => error.code === "IDEMPOTENCY_KEY_CONFLICT",
  );
});

test("lessons keep requirement and constraint lineage; template recommendations require observed evidence and human review", () => {
  const { create, planEvidence } = makeFixture();
  let review = createPostEventReview(create);
  ({ review } = recordPostEventObservation(review, {
    type: "record_post_event_observation",
    observationId: "observation-peak",
    predictionKey: "occupancy:peak-persons:venue:venue",
    value: 440,
    confidence: "measured",
    evidenceRefs: [planEvidence],
    committedAt: "2026-09-12T18:10:00.000Z",
    ...context("observe-peak", 0),
  }));
  ({ review } = recordPostEventLesson(review, {
    type: "record_post_event_lesson",
    lessonId: "lesson-capacity-buffer",
    comparisonKey: "occupancy:peak-persons:venue:venue",
    lessonCode: "CAPACITY_BUFFER",
    findingCode: "PEAK_ABOVE_MODEL",
    recommendedActionCode: "INCREASE_BUFFER",
    requirementIds: ["req-theater-seating"],
    constraintIds: ["constraint-capacity"],
    committedAt: "2026-09-12T18:15:00.000Z",
    ...context("lesson-capacity", 1),
  }));
  const acceptedPlanFingerprint = fingerprintPlan(review.baseline.runbook.baseline.acceptedPlan);
  const created = createTemplateImprovementProposal(review, {
    type: "create_template_improvement_proposal",
    proposalId: "template-proposal-capacity",
    goal: "Increase the standard capacity buffer",
    target: { kind: "room", templateId: "room-template-harborview-main-hall", version: "1.0.0" },
    changes: [{ id: "change-capacity-buffer", effects: { capacityBuffer: 20 } }],
    changeLessonLinks: [{ changeId: "change-capacity-buffer", lessonIds: ["lesson-capacity-buffer"] }],
    committedAt: "2026-09-12T18:20:00.000Z",
    ...context("propose-capacity", 2, { actorType: "agent", actorId: "agent-review", source: "agent-tool" }),
  });
  assert.equal(created.subject.status, "pending-human-review");
  assert.equal(created.subject.publicationStatus, "not-published");
  assert.equal(created.subject.proposal.status, "review");
  assert.throws(
    () => reviewTemplateImprovementProposal(created.review, {
      type: "review_template_improvement_proposal",
      proposalId: "template-proposal-capacity",
      expectedProposalRevision: 1,
      decision: "approved",
      reasonCode: "EVIDENCE_ACCEPTED",
      committedAt: "2026-09-12T18:25:00.000Z",
      ...context("approve-capacity-agent", 3, { actorType: "agent", actorId: "agent-review" }),
    }),
    (error) => error.code === "POST_EVENT_HUMAN_REQUIRED",
  );
  const approved = reviewTemplateImprovementProposal(created.review, {
    type: "review_template_improvement_proposal",
    proposalId: "template-proposal-capacity",
    expectedProposalRevision: 1,
    decision: "approved",
    reasonCode: "EVIDENCE_ACCEPTED",
    committedAt: "2026-09-12T18:26:00.000Z",
    ...context("approve-capacity", 3),
  });
  assert.equal(approved.subject.status, "approved-recommendation");
  assert.equal(approved.subject.publicationStatus, "not-published");
  assert.equal(approved.subject.proposal.status, "review");
  assert.equal(fingerprintPlan(approved.review.baseline.runbook.baseline.acceptedPlan), acceptedPlanFingerprint);
  assert.equal(verifyPostEventReviewLedger(approved.review).status, "pass");
});

test("unobserved lessons cannot seed template changes and tampering invalidates reports", () => {
  const { create } = makeFixture();
  let review = createPostEventReview(create);
  ({ review } = recordPostEventLesson(review, {
    type: "record_post_event_lesson",
    lessonId: "lesson-no-observation",
    comparisonKey: "queue:average-wait-seconds:queue:check-in",
    lessonCode: "QUEUE_UNKNOWN",
    findingCode: "EVIDENCE_GAP",
    recommendedActionCode: "ADD_QUEUE_SENSOR",
    requirementIds: ["req-theater-seating"],
    constraintIds: [],
    committedAt: "2026-09-12T18:15:00.000Z",
    ...context("lesson-queue", 0),
  }));
  assert.throws(
    () => createTemplateImprovementProposal(review, {
      type: "create_template_improvement_proposal",
      proposalId: "template-proposal-queue",
      goal: "Change the queue template",
      target: { kind: "venue", templateId: "venue-template-harborview", version: "1.0.0" },
      changes: [{ id: "change-queue" }],
      changeLessonLinks: [{ changeId: "change-queue", lessonIds: ["lesson-no-observation"] }],
      ...context("propose-queue", 1),
    }),
    (error) => error.code === "POST_EVENT_TEMPLATE_PROPOSAL_INVALID",
  );
  const tampered = structuredClone(review);
  tampered.lessons[0].findingCode = "TAMPERED";
  assert.equal(verifyPostEventReviewLedger(tampered).status, "fail");
  assert.throws(
    () => exportPostEventReport(tampered, { format: "json", exportedAt: "2026-09-12T19:00:00.000Z" }),
    (error) => error.code === "POST_EVENT_LEDGER_INTEGRITY_FAILED",
  );
});

test("JSON and plain-text reports are generated on demand without persisted blobs", () => {
  const review = createPostEventReview(makeFixture().create);
  const json = exportPostEventReport(review, { format: "json", exportedAt: "2026-09-12T19:00:00.000Z" });
  const text = exportPostEventReport(review, { format: "text", exportedAt: "2026-09-12T19:00:00.000Z" });
  assert.equal(JSON.parse(json.content).integrity.status, "pass");
  assert.match(text.content, /OUTCOMES/);
  assert.match(text.content, /INSUFFICIENT-EVIDENCE/);
  assert.equal("reportBlob" in review, false);
});
