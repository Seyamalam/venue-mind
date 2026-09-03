import test from "node:test";
import assert from "node:assert/strict";
import { fingerprintPlan } from "../src/domain/activity-ledger.ts";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import {
  createLivePlanDeviationRegister,
  createPostEventDeviationProposal,
  endLivePlanDeviation,
  exportLivePlanDeviations,
  inspectLivePlanDeviations,
  inspectLivePlanOverlay,
  recordLivePlanDeviation,
  verifyDeviationLedger,
} from "../src/domain/live-plan-deviations.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { normalizeProposalPlanningEffects } from "../src/domain/planning-effects.ts";

const makeRunbook = () =>
  createEventDayRunbook({
    projectId: "project-summit-forward",
    plan: summitForwardPlan,
    validation: {
      validationId: "validation-approved",
      inputFingerprint: "validation-input-approved",
      status: "pass",
    },
    sourceLedgerHeadHash: "activity-ledger-head",
    approvalLedgerEntryId: "approval-ledger-entry",
    frozenAt: "2026-09-12T08:00:00.000Z",
    frozenBy: "user-ops",
  });

const makeRegister = () =>
  createLivePlanDeviationRegister({
    type: "create_deviation_register",
    projectId: "project-summit-forward",
    runbook: makeRunbook(),
    createdAt: "2026-09-12T09:00:00.000Z",
    createdBy: "user-ops",
  });

const commandContext = (idempotencyKey, expectedRevision, overrides = {}) => ({
  idempotencyKey,
  expectedRevision,
  actorType: "human",
  actorId: "user-ops",
  source: "studio",
  sessionId: "session-event-day",
  ...overrides,
});

const metadataChange = (id, objectId, label) => ({
  id,
  title: label,
  targetObjectIds: [objectId],
  spatialEffects: [{ operation: "update_metadata", objectId, values: { label } }],
});

const record = (overrides = {}) => ({
  type: "record_live_plan_deviation",
  deviationId: "deviation-east-exit",
  disposition: "temporary",
  reasonCode: "LIVE_EGRESS_CONTROL",
  location: { kind: "plan-object", planObjectId: "obj-fire-exit-east" },
  affectedObjectIds: ["obj-fire-exit-east"],
  availableConstraintIds: ["constraint-emergency-readiness", "constraint-peak-congestion"],
  change: metadataChange("change-live-egress", "obj-fire-exit-east", "East exit — controlled"),
  ...commandContext("record-east-exit", 0),
  ...overrides,
});

test("Deviation Register freezes one active Runbook baseline and derives a validated overlay", () => {
  const register = makeRegister();
  const acceptedFingerprint = fingerprintPlan(register.baseline.acceptedPlan);
  const result = recordLivePlanDeviation(register, record(), { committedAt: "2026-09-12T09:05:00.000Z" });
  const overlay = inspectLivePlanOverlay(result.register);

  assert.equal(register.runbookVersionId, makeRunbook().versionId);
  assert.equal(register.source.planFingerprint, acceptedFingerprint);
  assert.equal(fingerprintPlan(register.baseline.acceptedPlan), acceptedFingerprint);
  assert.equal(result.deviation.id, "deviation-east-exit");
  assert.equal(result.deviation.status, "active");
  assert.equal(result.deviation.disposition, "temporary");
  assert.equal(result.deviation.authored.actorId, "user-ops");
  assert.equal(result.deviation.authored.occurredAt, "2026-09-12T09:05:00.000Z");
  assert.deepEqual(result.deviation.affectedObjectIds, ["obj-fire-exit-east"]);
  assert.equal(result.deviation.objectLineage[0].beforeObject.id, "obj-fire-exit-east");
  assert.equal(result.deviation.objectLineage[0].afterObject.label, "East exit — controlled");
  assert.notEqual(
    result.deviation.objectLineage[0].beforeFingerprint,
    result.deviation.objectLineage[0].afterFingerprint,
  );
  assert.deepEqual(result.deviation.validation.availableConstraintIds, [
    "constraint-emergency-readiness",
    "constraint-peak-congestion",
  ]);
  assert.equal(overlay.overlayPlan.objects.find(({ id }) => id === "obj-fire-exit-east").label, "East exit — controlled");
  assert.deepEqual(overlay.activeDeviationIds, ["deviation-east-exit"]);
  assert.equal(overlay.overlayFingerprint, result.deviation.validation.overlayFingerprint);
  assert.equal(verifyDeviationLedger(result.register).status, "pass");
  assert.equal(Object.isFrozen(result.register), true);
});

test("active overlay is deterministic and ending a temporary deviation removes only its effect", () => {
  let register = makeRegister();
  ({ register } = recordLivePlanDeviation(register, record(), { committedAt: "2026-09-12T09:05:00.000Z" }));
  ({ register } = recordLivePlanDeviation(
    register,
    record({
      deviationId: "deviation-bar",
      disposition: "revision-candidate",
      reasonCode: "LIVE_SERVICE_RELOCATION",
      location: { kind: "plan-object", planObjectId: "obj-bar-east" },
      affectedObjectIds: ["obj-bar-east"],
      availableConstraintIds: ["constraint-catering-readiness"],
      change: metadataChange("change-live-bar", "obj-bar-east", "Bar — temporary west service"),
      ...commandContext("record-bar", 1, { actorType: "agent", actorId: "agent-ops", source: "webmcp" }),
    }),
    { committedAt: "2026-09-12T09:06:00.000Z" },
  ));
  const first = inspectLivePlanOverlay(register);
  const second = inspectLivePlanOverlay(structuredClone(register));
  assert.equal(first.overlayFingerprint, second.overlayFingerprint);
  assert.deepEqual(first.activeDeviationIds, ["deviation-east-exit", "deviation-bar"]);

  const ended = endLivePlanDeviation(
    register,
    {
      type: "end_live_plan_deviation",
      deviationId: "deviation-east-exit",
      expectedDeviationRevision: 1,
      reasonCode: "CONTROL_RELEASED",
      ...commandContext("end-east-exit", 2),
    },
    { committedAt: "2026-09-12T09:10:00.000Z" },
  );
  const overlay = inspectLivePlanOverlay(ended.register);
  assert.deepEqual(overlay.activeDeviationIds, ["deviation-bar"]);
  assert.equal(
    overlay.overlayPlan.objects.find(({ id }) => id === "obj-fire-exit-east").label,
    summitForwardPlan.objects.find(({ id }) => id === "obj-fire-exit-east").label,
  );
  assert.equal(ended.deviation.ended.reasonCode, "CONTROL_RELEASED");
  assert.equal(ended.deviation.ended.actorId, "user-ops");
  assert.equal(fingerprintPlan(ended.register.baseline.acceptedPlan), ended.register.source.planFingerprint);
});

test("mutations are register- and entity-revision checked and exact retries stay single", () => {
  const initial = makeRegister();
  const command = record();
  const first = recordLivePlanDeviation(initial, command, { committedAt: "2026-09-12T09:05:00.000Z" });
  const retry = recordLivePlanDeviation(first.register, command, { committedAt: "2026-09-12T09:06:00.000Z" });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.register.revision, 1);
  assert.equal(retry.register.ledger.length, 1);
  assert.throws(
    () =>
      recordLivePlanDeviation(
        first.register,
        record({ deviationId: "deviation-stale", ...commandContext("record-stale", 0) }),
      ),
    (error) => error.code === "DEVIATION_REGISTER_REVISION_CONFLICT" && error.details.currentRevision === 1,
  );
  assert.throws(
    () =>
      endLivePlanDeviation(first.register, {
        type: "end_live_plan_deviation",
        deviationId: "deviation-east-exit",
        expectedDeviationRevision: 0,
        reasonCode: "CONTROL_RELEASED",
        ...commandContext("end-stale-entity", 1),
      }),
    (error) => error.code === "DEVIATION_REVISION_CONFLICT" && error.details.currentDeviationRevision === 1,
  );
  assert.throws(
    () => recordLivePlanDeviation(first.register, record({ reasonCode: "DIFFERENT_REASON" })),
    (error) => error.code === "IDEMPOTENCY_KEY_CONFLICT",
  );
});

test("recording requires exact objects, valid Plan location, and available live Constraints", () => {
  const register = makeRegister();
  assert.throws(
    () => recordLivePlanDeviation(register, record({ affectedObjectIds: ["obj-bar-east"] })),
    (error) => error.code === "DEVIATION_INVALID" && error.details.reason === "affected-objects-mismatch",
  );
  assert.throws(
    () =>
      recordLivePlanDeviation(
        register,
        record({ location: { kind: "coordinate", point: { x: -100, y: -100 } } }),
      ),
    (error) => error.code === "DEVIATION_LOCATION_INVALID",
  );
  assert.throws(
    () => recordLivePlanDeviation(register, record({ availableConstraintIds: ["constraint-does-not-exist"] })),
    (error) => error.code === "DEVIATION_CONSTRAINT_UNAVAILABLE",
  );
  assert.throws(
    () => recordLivePlanDeviation(register, record({ availableConstraintIds: [] })),
    (error) => error.code === "DEVIATION_INVALID" && error.details.reason === "available-constraint-required",
  );
  assert.throws(
    () =>
      recordLivePlanDeviation(
        register,
        record({
          change: {
            id: "change-room",
            targetObjectIds: [],
            spatialEffects: [{ operation: "update_room_boundary", roomBoundary: summitForwardPlan.spatial.roomBoundary }],
          },
          affectedObjectIds: [],
        }),
      ),
    (error) => error.code === "DEVIATION_INVALID" && error.details.reason === "room-boundary-change-not-operational",
  );
});

test("a failed emergency Constraint is recorded as live truth with explicit blocking evidence", () => {
  const register = makeRegister();
  const result = recordLivePlanDeviation(
    register,
    record({
      deviationId: "deviation-exit-unavailable",
      reasonCode: "EXIT_UNAVAILABLE",
      affectedObjectIds: ["obj-fire-exit-east"],
      availableConstraintIds: ["constraint-emergency-readiness"],
      change: {
        id: "change-exit-unavailable",
        targetObjectIds: ["obj-fire-exit-east"],
        spatialEffects: [{ operation: "delete_object", objectId: "obj-fire-exit-east" }],
      },
    }),
    { committedAt: "2026-09-12T09:05:00.000Z" },
  );
  assert.equal(result.deviation.validation.status, "fail");
  assert.equal(result.deviation.validation.blockingIssues, 1);
  assert.deepEqual(
    result.deviation.validation.checks.map(({ constraintId, status }) => [constraintId, status]),
    [["constraint-emergency-readiness", "fail"]],
  );
  assert.equal(result.deviation.objectLineage[0].afterObject, null);
  assert.equal(result.register.deviations.length, 1);
  assert.equal(fingerprintPlan(result.register.baseline.acceptedPlan), result.register.source.planFingerprint);
});

test("revision candidates create a normal post-event Proposal without changing accepted Plan truth", () => {
  let register = makeRegister();
  ({ register } = recordLivePlanDeviation(
    register,
    record({ disposition: "revision-candidate" }),
    { committedAt: "2026-09-12T09:05:00.000Z" },
  ));
  assert.throws(
    () =>
      createPostEventDeviationProposal(register, {
        type: "create_post_event_deviation_proposal",
        proposalId: "proposal-too-early",
        goal: "Too early",
        deviationIds: ["deviation-east-exit"],
        ...commandContext("post-event-too-early", 1),
      }),
    (error) => error.code === "DEVIATION_INVALID" && error.details.reason === "active-deviation-not-post-event",
  );
  ({ register } = endLivePlanDeviation(
    register,
    {
      type: "end_live_plan_deviation",
      deviationId: "deviation-east-exit",
      expectedDeviationRevision: 1,
      reasonCode: "EVENT_ENDED",
      ...commandContext("end-candidate", 1),
    },
    { committedAt: "2026-09-12T17:55:00.000Z" },
  ));
  const before = fingerprintPlan(register.baseline.acceptedPlan);
  const result = createPostEventDeviationProposal(
    register,
    {
      type: "create_post_event_deviation_proposal",
      proposalId: "proposal-post-event-egress",
      goal: "Retain the event-day egress control",
      deviationIds: ["deviation-east-exit"],
      ...commandContext("post-event-egress", 2),
    },
    { committedAt: "2026-09-12T18:00:00.000Z" },
  );

  assert.equal(result.proposal.id, "proposal-post-event-egress");
  assert.equal(result.proposal.baseVersion, summitForwardPlan.version);
  assert.equal(result.proposal.status, "review");
  assert.equal(result.proposal.validation, null);
  assert.equal(result.proposal.changes[0].lineage.deviationId, "deviation-east-exit");
  assert.equal(normalizeProposalPlanningEffects(result.proposal).id, result.proposal.id);
  assert.equal(result.register.recommendations[0].proposalFingerprint.length > 0, true);
  assert.equal(fingerprintPlan(result.register.baseline.acceptedPlan), before);
  assert.equal(before, result.register.source.planFingerprint);
  assert.throws(
    () =>
      createPostEventDeviationProposal(result.register, {
        type: "create_post_event_deviation_proposal",
        proposalId: "proposal-duplicate-source",
        goal: "Duplicate",
        deviationIds: ["deviation-east-exit"],
        ...commandContext("post-event-duplicate", 3),
      }),
    (error) => error.code === "DEVIATION_INVALID" && error.details.reason === "deviation-already-recommended",
  );
});

test("temporary deviations cannot become Proposals and integrity export separates all three truths", () => {
  let register = makeRegister();
  ({ register } = recordLivePlanDeviation(register, record(), { committedAt: "2026-09-12T09:05:00.000Z" }));
  assert.throws(
    () =>
      createPostEventDeviationProposal(register, {
        type: "create_post_event_deviation_proposal",
        proposalId: "proposal-invalid",
        goal: "Invalid retention",
        deviationIds: ["deviation-east-exit"],
        ...commandContext("post-event-invalid", 1),
      }),
    (error) => error.code === "DEVIATION_INVALID" && error.details.reason === "temporary-deviation-not-revision-candidate",
  );

  const exported = exportLivePlanDeviations(register, {
    type: "export_live_plan_deviations",
    exportedAt: "2026-09-12T18:00:00.000Z",
  });
  const artifact = JSON.parse(exported.content);
  assert.equal(artifact.kind, "venuemind-live-plan-deviations");
  assert.equal(artifact.approvedPlan.identity.planFingerprint, register.source.planFingerprint);
  assert.deepEqual(artifact.activeOverlay.activeDeviationIds, ["deviation-east-exit"]);
  assert.equal(artifact.liveDeviations.length, 1);
  assert.deepEqual(artifact.postEventRecommendedRevisions, []);
  assert.equal(artifact.integrity.status, "pass");

  const tampered = structuredClone(register);
  tampered.ledger[0].details.reasonCode = "ALTERED";
  assert.equal(verifyDeviationLedger(tampered).status, "fail");
  assert.throws(
    () => exportLivePlanDeviations(tampered, { type: "export_live_plan_deviations" }),
    (error) => error.code === "DEVIATION_LEDGER_INTEGRITY_FAILED",
  );
  const projectionTampered = structuredClone(register);
  projectionTampered.deviations[0].reasonCode = "ALTERED";
  assert.equal(verifyDeviationLedger(projectionTampered).status, "fail");
  assert.deepEqual(
    inspectLivePlanDeviations(register, { disposition: "temporary", status: "active" }).map(({ id }) => id),
    ["deviation-east-exit"],
  );
});
