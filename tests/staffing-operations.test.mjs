import test from "node:test";
import assert from "node:assert/strict";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { analyzeStaffingOperations, createStaffingPostMapSvg, createStaffingScheduleCsv, normalizeStaffingPlan } from "../src/domain/staffing-operations.ts";

const clone = (value) => JSON.parse(JSON.stringify(value));

test("staffing model normalizes stable roles, counts, shifts, and coverage requirements", () => {
  const staffing = normalizeStaffingPlan(summitForwardPlan.staffing);
  assert.equal(staffing.roles.length, 4);
  assert.equal(staffing.shifts.length, 2);
  assert.equal(staffing.coverageRequirements.length, 5);
  assert.throws(() => normalizeStaffingPlan({ ...summitForwardPlan.staffing, roles: [...summitForwardPlan.staffing.roles, summitForwardPlan.staffing.roles[0]] }), /unique stable IDs/);
});

test("required operational zones have reachable typed posts and auditable coverage", () => {
  const result = analyzeStaffingOperations(summitForwardPlan);
  assert.equal(result.posts.length, 5);
  assert.equal(result.summary.requiredCoverageChecks, 10);
  assert.equal(result.summary.coverageGaps, 0);
  assert.equal(result.summary.overAssignedRoles, 0);
  assert.ok(result.coverage.every((item) => item.status === "covered" && item.postObjectIds.length > 0 && item.maximumWalkingDistanceM <= result.staffing.maximumWalkingDistanceM));
  assert.deepEqual(result.staffOnlyRouteObjectIds, ["obj-route-replenishment-east", "obj-route-staff-service"]);
  assert.match(result.evidenceFingerprint, /^staffing-operations-/);
});

test("walking-distance, staffing, and handoff risks fail explicitly", () => {
  const plan = clone(summitForwardPlan);
  plan.staffing.maximumWalkingDistanceM = 1;
  plan.staffing.minimumHandoffOverlapMinutes = 20;
  plan.staffing.roles.find((role) => role.id === "role-security").headcount = 2;
  const result = analyzeStaffingOperations(plan);
  assert.ok(result.summary.coverageGaps > 0);
  assert.ok(result.summary.handoffRisks > 0);
  assert.ok(result.summary.overAssignedRoles > 0);
});

test("staffing schedule and post-map exports retain stable object, role, shift, and evidence IDs", () => {
  const result = analyzeStaffingOperations(summitForwardPlan);
  const schedule = createStaffingScheduleCsv(summitForwardPlan, result);
  const map = createStaffingPostMapSvg(summitForwardPlan, result);
  assert.match(schedule, /obj-post-entrance/);
  assert.match(schedule, /role-security/);
  assert.match(schedule, /shift-a/);
  assert.match(map, /data-object-id="obj-post-stage"/);
  assert.match(map, new RegExp(result.evidenceFingerprint));
});

test("planner inspection and shared export command expose staffing without changing accepted Plan truth", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const before = planner.getSnapshot().plan;
  const inspection = planner.execute({ type: "inspect_layout" });
  const schedule = planner.execute({ type: "export_plan", format: "csv-staffing" });
  const postMap = planner.execute({ type: "export_plan", format: "svg-post-map" });
  assert.equal(inspection.staffing.schemaVersion, 1);
  assert.equal(inspection.spatialObjects.filter((object) => object.kind === "staff_post").length, 5);
  assert.equal(schedule.mimeType, "text/csv;charset=utf-8");
  assert.equal(postMap.mimeType, "image/svg+xml");
  assert.deepEqual(planner.getSnapshot().plan, before);
});
