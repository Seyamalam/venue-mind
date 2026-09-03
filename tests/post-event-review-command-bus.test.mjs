import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintPlan } from "../src/domain/activity-ledger.ts";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { createIncidentRegister } from "../src/domain/incidents.ts";
import { createLivePlanDeviationRegister } from "../src/domain/live-plan-deviations.ts";
import { createLiveOccupancyMonitor, evaluateLiveOccupancy } from "../src/domain/live-occupancy.ts";
import { createPostEventReviewCommandBus } from "../src/domain/post-event-review-command-bus.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const projectId = "project-summit-forward";
const runbook = createEventDayRunbook({
  projectId,
  plan: summitForwardPlan,
  validation: { validationId: "validation", inputFingerprint: "validation-input", status: "pass" },
  sourceLedgerHeadHash: "activity-ledger-head",
  approvalLedgerEntryId: "approval-ledger-entry",
  frozenAt: "2026-09-12T08:00:00.000Z",
  frozenBy: "user-ops",
});
const occupancyMonitor = createLiveOccupancyMonitor({ projectId, runbook, createdAt: "2026-09-12T08:05:00.000Z", createdBy: "user-ops" });
const incidentRegister = createIncidentRegister({ type: "create_incident_register", projectId, runbook, createdAt: "2026-09-12T08:05:00.000Z", createdBy: "user-ops" });
const deviationRegister = createLivePlanDeviationRegister({ type: "create_deviation_register", projectId, runbook, createdAt: "2026-09-12T08:05:00.000Z", createdBy: "user-ops" });
const create = {
  type: "create_post_event_review",
  projectId,
  runbook,
  occupancyMonitor,
  occupancyProjection: evaluateLiveOccupancy(occupancyMonitor, { at: "2026-09-12T18:00:00.000Z" }),
  incidentRegister,
  deviationRegister,
  scenarioRuns: [],
  predictions: [{
    key: "incidents:incident-count:venue:venue",
    family: "incidents",
    metric: "incident-count",
    scope: { kind: "venue", id: "venue" },
    value: 0,
    unit: "incidents",
    betterWhen: "lower",
    tolerance: { absolute: 0, relative: 0 },
    evidenceRefs: [{ kind: "accepted-plan", id: summitForwardPlan.id, fingerprint: fingerprintPlan(summitForwardPlan) }],
  }],
  createdAt: "2026-09-12T18:05:00.000Z",
  createdBy: "user-ops",
};
const observe = {
  type: "record_post_event_observation",
  observationId: "observation-incidents",
  predictionKey: "incidents:incident-count:venue:venue",
  value: 0,
  confidence: "measured",
  evidenceRefs: [{ kind: "accepted-plan", id: summitForwardPlan.id, fingerprint: fingerprintPlan(summitForwardPlan) }],
  idempotencyKey: "observe-incidents",
  expectedRevision: 0,
  actorType: "human",
  actorId: "user-ops",
  source: "studio",
  sessionId: "session-review",
  committedAt: "2026-09-12T18:10:00.000Z",
};

test("PostEventReview command bus provides one create, mutation, inspect, and export seam", () => {
  const events = [];
  const bus = createPostEventReviewCommandBus({ onChange: (_review, event) => events.push(event.type) });
  assert.equal(bus.execute(create).status, "created");
  assert.equal(bus.execute(create).status, "existing");
  assert.equal(bus.execute(observe).subject.id, "observation-incidents");
  assert.equal(bus.execute({ type: "inspect_post_event_review" }).comparisons[0].status, "matched");
  assert.equal(JSON.parse(bus.execute({ type: "export_post_event_report", format: "json" }).content).integrity.status, "pass");
  assert.deepEqual(events, ["post-event.review.created", "post-event.observation-recorded"]);
});

test("hydration recovers state and exact retries do not publish twice", () => {
  const seed = createPostEventReviewCommandBus();
  seed.execute(create);
  seed.execute(observe);
  const events = [];
  const bus = createPostEventReviewCommandBus({ onChange: (_review, event) => events.push(event.type) });
  bus.hydrate(seed.getSnapshot());
  assert.equal(bus.execute(observe).duplicate, true);
  assert.deepEqual(events, ["post-event.review.hydrated"]);
});
