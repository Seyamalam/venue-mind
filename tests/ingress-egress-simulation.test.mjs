import test from "node:test";
import assert from "node:assert/strict";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { INGRESS_EGRESS_BENCHMARKS } from "../src/domain/ingress-egress-simulation.js";
import { compareSimulationResults, createScenarioRunner, normalizeScenarioDefinition } from "../src/domain/scenario-engine.js";

const scenario = {
  model: "ingress-egress",
  id: "scenario-summit-egress",
  name: "Summit egress",
  seed: 73421,
  horizonSeconds: 1800,
  sampleCount: 96,
  inputs: { population: 400, arrivalRatePerMinute: 40, serviceRatePerMinute: 30, servers: 2, mobilityFactor: 1 },
  ingressEgress: {
    mode: "normal",
    mobilityProfiles: [
      { id: "profile-standard", label: "Standard", share: 0.92, speedFactor: 1, accessibleRouteRequired: false },
      { id: "profile-access", label: "Access", share: 0.08, speedFactor: 0.68, accessibleRouteRequired: true },
    ],
  },
};

test("ingress/egress Scenario normalization produces monotonic curves and aggregate mobility cohorts", () => {
  const normalized = normalizeScenarioDefinition(scenario);

  assert.equal(normalized.model, "ingress-egress");
  assert.equal(normalized.ingressEgress.curves.arrival[0].cumulativeShare, 0);
  assert.equal(normalized.ingressEgress.curves.arrival.at(-1).cumulativeShare, 1);
  assert.equal(normalized.ingressEgress.mobilityProfiles.reduce((sum, profile) => sum + profile.share, 0), 1);
  assert.equal(JSON.stringify(normalized).includes("personId"), false);
  assert.throws(() => normalizeScenarioDefinition({ ...scenario, ingressEgress: { curves: { arrival: [{ second: 0, cumulativeShare: 0.5 }, { second: 10, cumulativeShare: 0.2 }] } } }), /monotonic/);
});

test("ingress/egress result inventories modeled infrastructure and emits zone clearance evidence", async () => {
  const outcome = await createScenarioRunner().run({ scenario, plan: summitForwardPlan, branchId: "branch-balanced" });
  const result = outcome.result;

  assert.equal(result.model, "ingress-egress");
  assert.deepEqual(result.infrastructure.entrances.map((item) => item.id), ["obj-accessible-entrance-south"]);
  assert.deepEqual(result.infrastructure.exits.map((item) => item.id), ["obj-fire-exit-east", "obj-fire-exit-north"]);
  assert.deepEqual(result.infrastructure.doors.map((item) => item.id), ["obj-door-south-access"]);
  assert.equal(result.infrastructure.corridors.length, 7);
  assert.equal(result.egress.zones.length, 2);
  assert.equal(result.egress.zones.every((zone) => zone.status === "served" && zone.p95ClearanceSeconds > 0), true);
  assert.equal(result.summary.worstBottleneckObjectId, "obj-fire-exit-north");
  assert.equal(result.summary.accessibleRouteStatus, "served");
});

test("checkpoint, stairs, and elevator metadata enter the versioned infrastructure input", async () => {
  const plan = structuredClone(summitForwardPlan);
  plan.objects.push(
    { id: "obj-checkpoint-south", kind: "checkpoint", label: "South checkpoint", layer: "safety", elevationM: 0, locked: false, circulation: { role: "checkpoint", capacityPersonsPerMinute: 24, servesZoneIds: ["zone-keynote-floor"] }, footprint: { kind: "rectangle", center: { x: 17, y: 2 }, width: 2, depth: 1, rotationDegrees: 0 } },
    { id: "obj-stairs-north", kind: "stairs", label: "North stairs", layer: "architecture", elevationM: 0, locked: false, circulation: { clearWidthM: 1.4, servesZoneIds: ["zone-keynote-floor"] }, footprint: { kind: "rectangle", center: { x: 2, y: 2 }, width: 1.4, depth: 3, rotationDegrees: 0 } },
    { id: "obj-elevator-north", kind: "elevator", label: "North elevator", layer: "architecture", elevationM: 0, locked: false, circulation: { carCapacityPersons: 14, cycleSeconds: 55, servesZoneIds: ["zone-keynote-floor"] }, footprint: { kind: "rectangle", center: { x: 4, y: 2 }, width: 2, depth: 2, rotationDegrees: 0 } },
  );
  plan.spatial.fingerprint = "geometry-multilevel-flow";
  const result = (await createScenarioRunner().run({ scenario, plan, branchId: "branch-multilevel" })).result;

  assert.deepEqual(result.infrastructure.checkpoints.map((item) => item.id), ["obj-checkpoint-south"]);
  assert.deepEqual(result.infrastructure.stairs.map((item) => item.id), ["obj-stairs-north"]);
  assert.deepEqual(result.infrastructure.elevators.map((item) => item.id), ["obj-elevator-north"]);
  assert.equal(result.ingress.worstBottleneck.objectId, "obj-checkpoint-south");
  assert.ok(result.ingress.totalAdmissionSeconds > 0);
});

test("normal and emergency assumptions are compared inside one auditable result", async () => {
  const result = (await createScenarioRunner().run({ scenario, plan: summitForwardPlan, branchId: "branch-balanced" })).result;

  assert.equal(result.assumptions.normal.mode, "normal");
  assert.equal(result.assumptions.emergency.mode, "emergency");
  assert.equal(result.assumptionComparison.emergencyMinusNormalClearanceSeconds, result.assumptions.emergency.p95ClearanceSeconds - result.assumptions.normal.p95ClearanceSeconds);
  assert.equal(result.assumptions.emergency.accessibleRoutePerformance.status, "served");
});

test("density frames are time ordered, spatially keyed, and clear by the terminal frame", async () => {
  const result = (await createScenarioRunner().run({ scenario, plan: summitForwardPlan, branchId: "branch-balanced" })).result;

  assert.equal(result.densityFrames.length, 9);
  assert.deepEqual(result.densityFrames.map((frame) => frame.second), result.densityFrames.map((frame) => frame.second).slice().sort((left, right) => left - right));
  assert.equal(result.densityFrames.every((frame) => frame.cells.every((cell) => cell.objectId && Number.isFinite(cell.point.x) && Number.isFinite(cell.point.y))), true);
  assert.equal(result.densityFrames.at(-1).cells.filter((cell) => cell.kind === "zone").every((cell) => cell.occupancyPersons === 0), true);
});

test("two branches compare total clearance, worst bottleneck, and accessible-route performance", async () => {
  const plan = structuredClone(summitForwardPlan);
  const narrowed = structuredClone(summitForwardPlan);
  narrowed.objects.find((object) => object.id === "obj-route-exit-east").footprint.width = 0.7;
  narrowed.spatial.fingerprint = "geometry-narrow-egress";
  const left = await createScenarioRunner().run({ scenario, plan, branchId: "branch-balanced" });
  const right = await createScenarioRunner().run({ scenario, plan: narrowed, branchId: "branch-narrow" });
  const comparison = compareSimulationResults(left.result, right.result);

  assert.ok(comparison.deltas.p95ClearanceSeconds > 0);
  assert.ok(comparison.deltas.worstBottleneckDurationSeconds > 0);
  assert.ok(comparison.deltas.accessibleRouteClearanceSeconds > 0);
  assert.equal(comparison.right.branchId, "branch-narrow");
});

test("changed Scenario parameters with one reused ID are not comparable", async () => {
  const runner = createScenarioRunner();
  const left = await runner.run({ scenario, plan: summitForwardPlan, branchId: "branch-balanced" });
  const right = await runner.run({ scenario: { ...scenario, inputs: { ...scenario.inputs, population: 420 } }, plan: summitForwardPlan, branchId: "branch-balanced" });

  assert.throws(() => compareSimulationResults(left.result, right.result), /not comparable/);
});

test("ingress/egress benchmark outputs remain inside versioned expected ranges", async () => {
  for (const benchmark of INGRESS_EGRESS_BENCHMARKS) {
    const result = (await createScenarioRunner().run({ scenario: benchmark.scenario, plan: summitForwardPlan, branchId: "branch-benchmark" })).result;
    assert.ok(result.summary.p95ClearanceSeconds >= benchmark.expected.p95ClearanceSeconds.minimum, benchmark.id);
    assert.ok(result.summary.p95ClearanceSeconds <= benchmark.expected.p95ClearanceSeconds.maximum, benchmark.id);
    assert.equal(result.summary.accessibleRouteStatus, benchmark.expected.accessibleRouteStatus);
  }
});

test("planner persists, exports, and compares ingress/egress runs without changing Validation", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const beforeValidation = planner.execute({ type: "validate_layout" });
  const left = await planner.execute({ type: "run_scenario", scenario, branchId: "branch-balanced", actor: "human", actorId: "operator", idempotencyKey: "egress-run-left" });
  const right = await planner.execute({ type: "run_scenario", scenario, branchId: "branch-balanced", actor: "human", actorId: "operator", idempotencyKey: "egress-run-right" });
  const afterValidation = planner.execute({ type: "validate_layout" });
  const run = planner.execute({ type: "list_scenario_runs" }).find((item) => item.id === left.runId);
  const exported = JSON.parse(planner.execute({ type: "export_simulation", runId: left.runId }).content);

  assert.deepEqual(afterValidation, beforeValidation);
  assert.equal(right.runId, left.runId);
  assert.equal(run.model, "ingress-egress");
  assert.equal(run.scenarioSnapshot.model, "ingress-egress");
  assert.equal(exported.result.densityFrames.length, 9);
});
