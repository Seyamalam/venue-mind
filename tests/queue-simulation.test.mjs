import test from "node:test";
import assert from "node:assert/strict";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { QUEUE_BENCHMARKS, QUEUE_CATEGORIES } from "../src/domain/queue-simulation.ts";
import { createScenarioRunner, normalizeScenarioDefinition } from "../src/domain/scenario-engine.ts";

const queueScenario = {
  model: "queue",
  id: "scenario-food-queue",
  name: "Food queue",
  seed: 99017,
  horizonSeconds: 900,
  sampleCount: 96,
  inputs: { population: 400, arrivalRatePerMinute: 24, serviceRatePerMinute: 6, servers: 3, mobilityFactor: 1 },
  queue: {
    category: "food",
    bufferAreaM2: 12,
    abandonment: { enabled: true, meanPatienceSeconds: 480 },
    priorityLanes: [{ id: "lane-access", label: "Access", arrivalShare: .08, servers: 1, serviceRatePerServerMinute: 6 }],
  },
};

test("queue Scenario normalization covers rates, servers, abandonment, and priority lanes", () => {
  const normalized = normalizeScenarioDefinition(queueScenario);

  assert.equal(normalized.model, "queue");
  assert.equal(normalized.queue.category, "food");
  assert.equal(normalized.queue.servers, 3);
  assert.equal(normalized.queue.abandonment.meanPatienceSeconds, 480);
  assert.deepEqual(normalized.queue.priorityLanes.map((lane) => lane.id), ["lane-access"]);
  assert.throws(() => normalizeScenarioDefinition({ ...queueScenario, queue: { ...queueScenario.queue, category: "unknown" } }), /category/);
  assert.throws(() => normalizeScenarioDefinition({ ...queueScenario, queue: { ...queueScenario.queue, priorityLanes: [{ id: "a", arrivalShare: .7 }, { id: "b", arrivalShare: .4 }] } }), /less than one/);
});

test("seeded queue runs reproduce wait, percentile, length, abandonment, and overflow metrics", async () => {
  const left = await createScenarioRunner().run({ scenario: queueScenario, plan: summitForwardPlan, branchId: "branch-balanced" });
  const right = await createScenarioRunner().run({ scenario: queueScenario, plan: summitForwardPlan, branchId: "branch-balanced" });

  assert.deepEqual(left.result, right.result);
  assert.ok(left.result.summary.averageWaitSeconds > 0);
  assert.ok(left.result.summary.p95WaitSeconds >= left.result.summary.p50WaitSeconds);
  assert.ok(left.result.summary.maximumQueueLength > 0);
  assert.ok(left.result.summary.abandonmentRate > 0);
  assert.equal(["low", "medium", "high", "critical"].includes(left.result.summary.overflowRisk), true);
});

test("priority lanes retain separate reproducible performance evidence", async () => {
  const result = (await createScenarioRunner().run({ scenario: queueScenario, plan: summitForwardPlan, branchId: "branch-balanced" })).result;

  assert.deepEqual(result.lanes.map((lane) => lane.laneId), ["standard", "lane-access"]);
  assert.ok(result.lanes.every((lane) => lane.p95WaitSeconds >= 0 && lane.maximumQueueLength >= 0));
  assert.ok(result.timeline.length > 10);
});

test("a service-rate increase produces a reproducible measurable improvement", async () => {
  const baseline = (await createScenarioRunner().run({ scenario: queueScenario, plan: summitForwardPlan, branchId: "branch-balanced" })).result;
  const fasterScenario = { ...queueScenario, id: "scenario-food-queue-faster", queue: { ...queueScenario.queue, serviceRatePerServerMinute: 9, priorityLanes: [{ ...queueScenario.queue.priorityLanes[0], serviceRatePerServerMinute: 9 }] } };
  const faster = (await createScenarioRunner().run({ scenario: fasterScenario, plan: summitForwardPlan, branchId: "branch-balanced" })).result;

  assert.ok(faster.summary.p95WaitSeconds < baseline.summary.p95WaitSeconds);
  assert.ok(faster.summary.maximumQueueLength < baseline.summary.maximumQueueLength);
  assert.equal((await createScenarioRunner().run({ scenario: fasterScenario, plan: summitForwardPlan, branchId: "branch-balanced" })).result.summary.p95WaitSeconds, faster.summary.p95WaitSeconds);
});

test("queue overflow identifies exact nearby circulation and exit object IDs", async () => {
  const result = (await createScenarioRunner().run({ scenario: { ...queueScenario, queue: { ...queueScenario.queue, bufferAreaM2: 1 } }, plan: summitForwardPlan, branchId: "branch-balanced" })).result;

  assert.equal(result.spill.status, "spill-risk");
  assert.ok(result.spill.routeObjectIds.length > 0);
  assert.ok(result.spill.routeObjectIds.every((id) => summitForwardPlan.objects.some((object) => object.id === id)));
  assert.ok(result.spill.exitObjectIds.every((id) => summitForwardPlan.objects.some((object) => object.id === id)));
});

test("all supported operational queue categories produce bounded benchmark results", async () => {
  assert.deepEqual(QUEUE_BENCHMARKS.map((benchmark) => benchmark.scenario.queue.category), QUEUE_CATEGORIES);
  for (const benchmark of QUEUE_BENCHMARKS) {
    const summary = (await createScenarioRunner().run({ scenario: benchmark.scenario, plan: summitForwardPlan, branchId: "branch-benchmark" })).result.summary;
    assert.ok(summary.p95WaitSeconds >= benchmark.expected.p95WaitSeconds.minimum && summary.p95WaitSeconds <= benchmark.expected.p95WaitSeconds.maximum, benchmark.id);
    assert.ok(summary.maximumQueueLength >= benchmark.expected.maximumQueueLength.minimum && summary.maximumQueueLength <= benchmark.expected.maximumQueueLength.maximum, benchmark.id);
  }
});

test("queue capacity suggestions remain non-destructive and include deterministic spatial preflight", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const before = planner.getSnapshot();
  const run = await planner.execute({ type: "run_scenario", scenario: queueScenario, branchId: "branch-balanced", actor: "agent", idempotencyKey: "queue-suggestion-run" });
  const option = run.result.suggestion;
  const after = planner.getSnapshot();

  assert.deepEqual(after.plan, before.plan);
  assert.deepEqual(after.proposal, before.proposal);
  assert.equal(option.requiresHumanAction, true);
  assert.equal(option.preflight.status, "spatially-valid");
  assert.deepEqual(option.preflight.spatialOverlapObjectIds, []);
  assert.equal(option.change.spatialEffects[0].operation, "add_object");
});

test("a human can preview the suggested queue option and immediately validate its geometry", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const run = await planner.execute({ type: "run_scenario", scenario: queueScenario, branchId: "branch-balanced", actor: "human", actorId: "operator", idempotencyKey: "queue-option-run" });
  const suggestion = run.result.suggestion;
  const object = suggestion.change.spatialEffects[0].object;
  const preview = planner.execute({ type: "apply_edit", edit: { operation: "place", object, label: suggestion.change.title, shortLabel: suggestion.change.shortTitle, metrics: suggestion.change.metrics }, actor: "human", actorId: "operator", idempotencyKey: "queue-option-preview" });
  const validation = planner.execute({ type: "validate_layout" });

  assert.equal(preview.status, "review");
  assert.equal(planner.getSnapshot().plan.objects.some((item) => item.id === object.id), false);
  assert.equal(planner.getSnapshot().proposal.changes.at(-1).spatialEffects[0].object.id, object.id);
  assert.match(planner.getSnapshot().proposal.changes.at(-1).title, /queue buffer/i);
  assert.equal(validation.candidateGeometryFingerprint.length > 0, true);
  assert.equal(validation.status, "pass");
  assert.equal(validation.blockingIssues, 0);
  assert.equal(validation.spatialEvidence.circulation.obstructedExitObjectIds.length, 0);
  assert.equal(validation.spatialEvidence.accessibility.obstructedDoorObjectIds.length, 0);
});
