import test from "node:test";
import assert from "node:assert/strict";
import { createDeviationCommandBus } from "../src/domain/deviation-command-bus.ts";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const runbook = createEventDayRunbook({
  projectId: "project-summit-forward",
  plan: summitForwardPlan,
  validation: { validationId: "validation-approved", inputFingerprint: "validation-input-approved", status: "pass" },
  sourceLedgerHeadHash: "activity-ledger-head",
  approvalLedgerEntryId: "approval-ledger-entry",
  frozenAt: "2026-09-12T08:00:00.000Z",
  frozenBy: "user-ops",
});

const create = {
  type: "create_deviation_register",
  projectId: "project-summit-forward",
  runbook,
  createdAt: "2026-09-12T09:00:00.000Z",
  createdBy: "user-ops",
};
const record = {
  type: "record_live_plan_deviation",
  deviationId: "deviation-east-exit",
  disposition: "revision-candidate",
  reasonCode: "LIVE_EGRESS_CONTROL",
  location: { kind: "plan-object", planObjectId: "obj-fire-exit-east" },
  affectedObjectIds: ["obj-fire-exit-east"],
  availableConstraintIds: ["constraint-emergency-readiness"],
  change: {
    id: "change-live-egress",
    targetObjectIds: ["obj-fire-exit-east"],
    spatialEffects: [
      {
        operation: "update_metadata",
        objectId: "obj-fire-exit-east",
        values: { label: "East exit — controlled" },
      },
    ],
  },
  idempotencyKey: "record-east-exit",
  expectedRevision: 0,
  actorType: "agent",
  actorId: "agent-ops",
  source: "webmcp",
  sessionId: "session-event-day",
  committedAt: "2026-09-12T09:05:00.000Z",
};

test("Deviation command bus is the shared create, mutation, inspection, Proposal, and export seam", () => {
  const events = [];
  const bus = createDeviationCommandBus({ onChange: (register, event) => events.push({ register, event }) });
  assert.equal(bus.execute(create).status, "created");
  assert.equal(bus.execute(create).status, "existing");
  const recorded = bus.execute(record);
  assert.equal(recorded.deviation.id, "deviation-east-exit");
  assert.deepEqual(bus.execute({ type: "inspect_live_plan_overlay" }).activeDeviationIds, ["deviation-east-exit"]);
  assert.deepEqual(
    bus.execute({ type: "inspect_live_plan_deviations", disposition: "revision-candidate" }).map(({ id }) => id),
    ["deviation-east-exit"],
  );
  bus.execute({
    type: "end_live_plan_deviation",
    deviationId: "deviation-east-exit",
    expectedDeviationRevision: 1,
    reasonCode: "EVENT_ENDED",
    idempotencyKey: "end-egress",
    expectedRevision: 1,
    actorType: "human",
    actorId: "user-ops",
    source: "studio",
    sessionId: "session-event-day",
    committedAt: "2026-09-12T17:55:00.000Z",
  });
  const recommended = bus.execute({
    type: "create_post_event_deviation_proposal",
    proposalId: "proposal-post-event-egress",
    goal: "Retain the egress control",
    deviationIds: ["deviation-east-exit"],
    idempotencyKey: "recommend-egress",
    expectedRevision: 2,
    actorType: "human",
    actorId: "user-ops",
    source: "studio",
    sessionId: "session-event-day",
    committedAt: "2026-09-12T18:00:00.000Z",
  });
  assert.equal(recommended.proposal.status, "review");
  assert.equal(JSON.parse(bus.execute({ type: "export_live_plan_deviations" }).content).integrity.status, "pass");
  assert.equal(events.length, 4);
  assert.deepEqual(
    events.map(({ event }) => event.type),
    ["deviation.register.created", "deviation.recorded", "deviation.ended", "deviation.post_event_proposal_created"],
  );
});

test("Deviation command bus hydrates recovery state, suppresses duplicate publishes, and rejects unsupported commands", () => {
  const seed = createDeviationCommandBus();
  seed.execute(create);
  seed.execute(record);
  const events = [];
  const bus = createDeviationCommandBus({ onChange: (_register, event) => events.push(event) });
  bus.hydrate(seed.getSnapshot());
  const retry = bus.execute(record);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(events.map(({ type }) => type), ["deviation.register.hydrated"]);
  assert.throws(() => bus.execute({ type: "unsupported_deviation_command" }), (error) => error.code === "COMMAND_UNSUPPORTED");
});
