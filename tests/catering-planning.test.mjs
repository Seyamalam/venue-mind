import test from "node:test";
import assert from "node:assert/strict";
import { analyzeCateringPlan, createReplenishmentScheduleCsv, createServiceStationScheduleCsv, normalizeCateringPolicy } from "../src/domain/catering-planning.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const clone = (value) => JSON.parse(JSON.stringify(value));

test("catering policy and typed objects cover stations, support, queues, water, waste, and replenishment", () => {
  const policy = normalizeCateringPolicy(summitForwardPlan.cateringPolicy);
  const kinds = new Set(summitForwardPlan.objects.map((object) => object.kind));
  assert.equal(policy.minimumAccessibleServicePoints, 2);
  for (const kind of ["bar", "buffet", "kitchen", "prep_zone", "waste_point", "water_point", "queue", "service_lane"]) assert.equal(kinds.has(kind), true, kind);
  assert.ok(summitForwardPlan.objects.some((object) => object.catering?.type === "replenishment-route"));
});

test("catering evidence validates phased capacity, queues, separation, access, replenishment, and inventory", () => {
  const result = analyzeCateringPlan(summitForwardPlan);
  assert.equal(result.summary.status, "pass");
  assert.equal(result.demandShareTotal, 1);
  assert.equal(result.summary.minimumPhaseServiceCapacityPersons, 585);
  assert.equal(result.summary.queueRiskCount, 0);
  assert.equal(result.summary.uncontrolledCirculationConflictCount, 0);
  assert.equal(result.summary.separationFailures, 0);
  assert.equal(result.summary.accessibleServicePoints, 2);
  assert.equal(result.replenishmentRoutes[0].crossingControl, "timed-crossing");
  assert.deepEqual(result.replenishmentRoutes[0].crossingObjectIds, ["obj-route-exit-east"]);
  assert.deepEqual(result.inventoryShortages, []);
  assert.match(result.evidenceFingerprint, /^catering-planning-/);
});

test("catering failure evidence retains exact station, route, queue, production, and inventory IDs", () => {
  const plan = clone(summitForwardPlan);
  const buffet = plan.objects.find((object) => object.id === "obj-refreshment-east");
  buffet.catering.serviceRatePerServerMinute = .05;
  buffet.inventoryCount = 30;
  plan.objects.find((object) => object.id === "obj-queue-buffet-east").footprint.center = { x: 15, y: 4 };
  plan.objects.find((object) => object.id === "obj-bar-east").footprint.center = { x: 21, y: 15 };
  plan.objects.find((object) => object.id === "obj-route-replenishment-east").catering.crossingControl = "none";
  const result = analyzeCateringPlan(plan);
  assert.equal(result.summary.status, "fail");
  assert.ok(result.phaseCapacity.some((phase) => phase.stations.some((station) => station.stationObjectId === buffet.id && station.status === "fail")));
  assert.ok(result.queueConflicts.some((item) => item.queueZoneObjectId === "obj-queue-buffet-east" && item.conflictObjectId === "obj-route-main"));
  assert.ok(result.separationChecks.some((item) => item.serviceObjectId === "obj-bar-east" && item.otherObjectId === "obj-av-desk" && item.status === "fail"));
  assert.equal(result.replenishmentRoutes[0].status, "fail");
  assert.deepEqual(result.inventoryShortages, ["inventory-template-buffet-station"]);
});

test("catering geometry rejects attendee health records", () => {
  const plan = clone(summitForwardPlan);
  plan.objects.find((object) => object.id === "obj-refreshment-east").catering.attendeeHealthRecords = [{ attendeeId: "person-1" }];
  assert.throws(() => createVenuePlanner(plan), /cannot store attendee health records/);
});

test("Catering Changes expose evidence before Approval and preserve accepted Plan truth", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const acceptedBefore = clone(planner.getSnapshot().plan);
  planner.execute({ type: "apply_edit", edit: { operation: "move", objectIds: ["obj-queue-buffet-east"], delta: { x: -7, y: 2.5 } }, actor: "human", actorId: "operator", idempotencyKey: "move-buffet-queue-invalid" });
  const validation = planner.execute({ type: "validate_layout" });
  const cateringCheck = validation.checks.find((check) => check.id === "check-catering-readiness");
  assert.equal(validation.status, "fail");
  assert.equal(cateringCheck.status, "fail");
  assert.ok(cateringCheck.evidence.affectedObjectIds.includes("obj-queue-buffet-east"));
  assert.ok(validation.cateringEvidence.queueConflicts.some((item) => item.conflictObjectId === "obj-route-main"));
  assert.deepEqual(planner.getSnapshot().plan, acceptedBefore);
});

test("branch comparison exposes service capacity, queue, circulation, and accessible-service metrics", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const baseline = planner.execute({ type: "create_branch", name: "Service baseline", strategy: "balanced", actor: "human", idempotencyKey: "catering-baseline-branch" });
  planner.execute({ type: "switch_branch", branchId: "branch-balanced", actor: "human", idempotencyKey: "catering-switch-balanced" });
  planner.execute({ type: "apply_edit", edit: { operation: "move", objectIds: ["obj-queue-buffet-east"], delta: { x: -7, y: 2.5 } }, actor: "human", actorId: "operator", idempotencyKey: "catering-compare-conflict" });
  const comparison = planner.execute({ type: "compare_branches", leftBranchId: baseline.branchId, rightBranchId: "branch-balanced" });
  const metrics = new Map(comparison.metricDeltas.map((metric) => [metric.metric, metric]));
  for (const metric of ["cateringServiceCapacity", "cateringQueueRisk", "cateringCirculationImpact", "accessibleServicePoints"]) assert.ok(metrics.has(metric), metric);
  assert.ok(metrics.get("cateringCirculationImpact").delta > 0);
  assert.equal(comparison.constraintDeltas.find((item) => item.constraintId === "constraint-catering-readiness").outcome, "regressed");
});

test("shared exports publish service-station and replenishment schedules", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const stations = planner.execute({ type: "export_plan", format: "csv-catering-stations" });
  const routes = planner.execute({ type: "export_plan", format: "csv-replenishment" });
  assert.equal(stations.content, createServiceStationScheduleCsv(summitForwardPlan));
  assert.equal(routes.content, createReplenishmentScheduleCsv(summitForwardPlan));
  assert.match(stations.content, /obj-refreshment-east/);
  assert.match(stations.content, /gluten-aware\|vegan\|vegetarian/);
  assert.match(routes.content, /obj-route-replenishment-east/);
  assert.match(routes.content, /timed-crossing/);
});
