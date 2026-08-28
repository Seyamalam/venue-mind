import test from "node:test";
import assert from "node:assert/strict";
import { analyzeProductionPlan, createProductionMapSvg, createProductionScheduleCsv, normalizeProductionPolicy } from "../src/domain/production-planning.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

test("production policy and typed equipment cover every required production class", () => {
  const policy = normalizeProductionPolicy(summitForwardPlan.productionPolicy);
  const kinds = new Set(summitForwardPlan.objects.map((object) => object.kind));
  assert.equal(policy.minimumControlSightlineRatio, 1);
  for (const kind of ["stage", "screen", "projector", "speaker", "camera", "av_desk", "cable_route", "utility_point", "rigging_point", "backstage_zone"]) assert.equal(kinds.has(kind), true, kind);
});

test("production evidence validates throw, visibility, sound, cameras, control, cable, power, rigging, and inventory", () => {
  const result = analyzeProductionPlan(summitForwardPlan);
  assert.equal(result.summary.status, "pass");
  assert.equal(result.throwDistanceChecks[0].throwRatio, 1.8);
  assert.equal(result.screenVisibility[0].coverageRatio, .75);
  assert.ok(result.speakerCoverage.every((item) => item.coverageRatio === 1));
  assert.ok(result.cameraChecks.every((item) => item.status === "pass"));
  assert.equal(result.controlSightlineRatio, 1);
  assert.ok(result.cableCrossings.length >= 1 && result.cableCrossings.every((item) => item.status === "pass"));
  assert.equal(result.circuits[0].demandWatts, 5180);
  assert.equal(result.rigging[0].demandKg, 191);
  assert.deepEqual(result.inventoryShortages, []);
  assert.match(result.evidenceFingerprint, /^production-planning-/);
});

test("production failures identify exact equipment and infrastructure IDs", () => {
  const plan = clone(summitForwardPlan);
  plan.objects.find((object) => object.id === "obj-projector-center").footprint.center.x = 25.5;
  plan.objects.find((object) => object.id === "obj-cable-loom-main").production.crossingTreatment = "none";
  plan.objects.find((object) => object.id === "obj-power-west").utility.maxWatts = 1000;
  plan.objects.find((object) => object.id === "obj-rigging-center").rigging.safeWorkingLoadKg = 100;
  plan.objects.find((object) => object.id === "obj-speaker-stage-north").production.coverageRangeM = 1;
  plan.objects.find((object) => object.id === "obj-speaker-stage-south").production.coverageRangeM = 1;
  const result = analyzeProductionPlan(plan);
  assert.equal(result.summary.status, "fail");
  assert.equal(result.throwDistanceChecks[0].status, "fail");
  assert.ok(result.cableCrossings.some((item) => item.status === "fail" && item.routeObjectId === "obj-route-main"));
  assert.equal(result.circuits[0].status, "fail");
  assert.equal(result.rigging[0].status, "fail");
  assert.ok(result.speakerCoverage.every((item) => item.status === "fail"));
});

test("inventory reconciliation blocks unavailable production demand", () => {
  const plan = clone(summitForwardPlan);
  plan.objects.find((object) => object.id === "obj-projector-center").inventoryCount = 9;
  const result = analyzeProductionPlan(plan);
  assert.equal(result.summary.status, "fail");
  assert.deepEqual(result.inventoryShortages, ["inventory-template-laser-projector"]);
});

test("Production Changes expose deterministic evidence before Approval", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const acceptedBefore = clone(planner.getSnapshot().plan);
  planner.execute({ type: "apply_edit", edit: { operation: "move", objectIds: ["obj-projector-center"], delta: { x: 10, y: 0 } }, actor: "human", actorId: "operator", idempotencyKey: "move-projector-invalid" });
  const validation = planner.execute({ type: "validate_layout" });
  const productionCheck = validation.checks.find((check) => check.id === "check-production-readiness");
  assert.equal(validation.status, "fail");
  assert.equal(productionCheck.status, "fail");
  assert.ok(productionCheck.evidence.affectedObjectIds.includes("obj-projector-center"));
  assert.equal(validation.productionEvidence.throwDistanceChecks[0].status, "fail");
  assert.deepEqual(planner.getSnapshot().plan, acceptedBefore);
});

test("shared exports publish a production schedule and production-only map", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const schedule = planner.execute({ type: "export_plan", format: "csv-production" });
  const map = planner.execute({ type: "export_plan", format: "svg-production" });
  assert.match(schedule.content, /obj-projector-center/);
  assert.match(schedule.content, /circuit-west-63a/);
  assert.match(schedule.content, /inventory-template-laser-projector/);
  assert.match(map.content, /data-object-id="obj-screen-stage"/);
  assert.match(map.content, /production-planning-/);
  assert.equal(schedule.mimeType, "text/csv;charset=utf-8");
  assert.equal(map.mimeType, "image/svg+xml");
});
