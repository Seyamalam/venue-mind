import test from "node:test";
import assert from "node:assert/strict";
import { analyzeEmergencyPlan, emergencyChangeObjectIds, normalizeEmergencyPlan } from "../src/domain/emergency-planning.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const clone = (value) => JSON.parse(JSON.stringify(value));
const emergencyEdit = (planner, key = "move-first-aid-review") => planner.execute({ type: "apply_edit", edit: { operation: "move", objectIds: ["obj-first-aid-north"], delta: { x: -1, y: 0 } }, actor: "human", actorId: "operator", idempotencyKey: key });

test("Emergency Plan models exits, assembly, responder access, fire equipment, first aid, and command", () => {
  const policy = normalizeEmergencyPlan(summitForwardPlan.emergencyPlan);
  const kinds = new Set(summitForwardPlan.objects.map((object) => object.kind));
  assert.deepEqual(policy.authorizedReviewerRoles, ["safety-officer", "venue-administrator"]);
  assert.deepEqual(new Set(policy.scenarioDefinitions.map((scenario) => scenario.type)), new Set(["blocked-exit", "unavailable-corridor", "power-loss"]));
  for (const kind of ["fire_exit", "assembly_point", "emergency_access_lane", "fire_equipment", "first_aid", "command_post"]) assert.equal(kinds.has(kind), true, kind);
});

test("Emergency readiness is structurally valid while Degraded Scenarios retain independent hard failures", () => {
  const result = analyzeEmergencyPlan(createVenuePlanner(summitForwardPlan).getSnapshot().plan);
  assert.equal(result.summary.status, "pass");
  assert.equal(result.summary.exitCount, 2);
  assert.equal(result.totalExitCapacityPersons, 700);
  assert.equal(result.totalAssemblyCapacityPersons, 450);
  assert.equal(result.fireEquipmentCoverageRatio, 1);
  assert.ok(result.accessLaneChecks.every((check) => check.status === "pass"));
  assert.match(result.evidenceFingerprint, /^emergency-planning-/);

  const blocked = result.degradedScenarios.find((scenario) => scenario.scenarioType === "blocked-exit");
  assert.equal(blocked.status, "fail");
  assert.deepEqual(blocked.affectedZoneObjectIds, ["obj-seating-west"]);
  assert.deepEqual(blocked.alternativeRoutes[0].routeObjectIds, ["obj-route-north-link-a", "obj-route-north-link-b", "obj-route-seating-west"]);
  assert.equal(blocked.alternativeRoutes[0].exitObjectId, "obj-fire-exit-north");
  assert.deepEqual(blocked.capacityImpact, { baselineExitCapacityPersons: 700, availableExitCapacityPersons: 250, deltaPersons: -450, operationalLoadPersons: 438, shortfallPersons: 188 });
  assert.deepEqual(blocked.hardFailures.map((failure) => failure.code), ["EXIT_CAPACITY_SHORTFALL"]);
  assert.equal(blocked.unresolvedHardFailures, 1);

  const power = result.degradedScenarios.find((scenario) => scenario.scenarioType === "power-loss");
  assert.equal(power.status, "pass");
  assert.deepEqual(power.powerFailures, []);
});

test("emergency-only hard Constraint reports exact missing or obstructed infrastructure IDs", () => {
  const plan = clone(summitForwardPlan);
  plan.objects = plan.objects.filter((object) => object.id !== "obj-command-post-north");
  plan.objects.find((object) => object.id === "obj-emergency-access-east").footprint = { kind: "line", start: { x: 20.5, y: 3.5 }, end: { x: 23.5, y: 3.5 }, width: 1.2 };
  const evidence = analyzeEmergencyPlan(createVenuePlanner(plan).getSnapshot().plan);
  assert.equal(evidence.summary.status, "fail");
  assert.ok(evidence.structuralFailures.some((failure) => failure.code === "COMMAND_POST"));
  assert.ok(evidence.structuralFailures.some((failure) => failure.code === "EMERGENCY_ACCESS" && failure.affectedObjectIds.includes("obj-refreshment-east")));
});

test("Emergency Changes expose review requirements before Approval without mutating accepted truth", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const accepted = clone(planner.getSnapshot().plan);
  emergencyEdit(planner);
  const validation = planner.execute({ type: "validate_layout" });
  assert.equal(validation.status, "pass");
  assert.equal(validation.emergencyReviewRequired, true);
  assert.deepEqual(validation.emergencyChangedObjectIds, ["obj-first-aid-north"]);
  assert.deepEqual(validation.authorizedEmergencyReviewerRoles, ["safety-officer", "venue-administrator"]);
  assert.deepEqual(emergencyChangeObjectIds(accepted, planner.getSnapshot().proposal.changes), ["obj-first-aid-north"]);
  assert.deepEqual(emergencyChangeObjectIds(accepted, [{
    targetObjectIds: [],
    spatialEffects: [{ operation: "add_object", object: { id: "obj-first-aid-mobile", kind: "first_aid", emergency: { accessible: true } } }],
  }]), ["obj-first-aid-mobile"]);
  assert.deepEqual(planner.getSnapshot().plan, accepted);
});

test("Emergency Plan Approval requires and records an authorized human review", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  emergencyEdit(planner, "move-first-aid-approval");
  const proposal = planner.getSnapshot().proposal;
  assert.throws(() => planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", actorId: "operator", idempotencyKey: "emergency-approve-missing" }), (error) => error.code === "EMERGENCY_REVIEW_REQUIRED");
  assert.throws(() => planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", actorId: "operator", emergencyReview: { reviewerId: "reviewer-1", reviewerRole: "planner", assumptionsAccepted: true }, idempotencyKey: "emergency-approve-unauthorized" }), (error) => error.code === "EMERGENCY_REVIEW_UNAUTHORIZED");
  const approved = planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", actorId: "operator", emergencyReview: { reviewerId: "reviewer-1", reviewerRole: "safety-officer", assumptionsAccepted: true, note: "Reviewed routes and assumptions" }, idempotencyKey: "emergency-approve-authorized" });
  assert.equal(approved.status, "approved");
  const review = planner.getSnapshot().plan.emergencyReviews[0];
  assert.equal(review.reviewerId, "reviewer-1");
  assert.equal(review.reviewerRole, "safety-officer");
  assert.equal(review.assumptionsAccepted, true);
  assert.deepEqual(review.assumptions, ["all-attendees-evacuate", "no-lift-use-during-fire", "staff-assist-access-needs"]);
  assert.equal(review.acceptedPlanVersion, approved.planVersion);
  assert.equal(planner.execute({ type: "get_change_log" }).at(-1).details.emergencyReview.id, review.id);
});

test("audit package stores Emergency assumptions, reviewer identity, scenario evidence, and fingerprints", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  emergencyEdit(planner, "move-first-aid-audit");
  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", actorId: "operator", emergencyReview: { reviewerId: "safety-lead", reviewerRole: "venue-administrator", assumptionsAccepted: true }, idempotencyKey: "emergency-audit-approve" });
  const audit = JSON.parse(planner.execute({ type: "export_plan", format: "audit" }).content);
  assert.equal(audit.emergency.reviews[0].reviewerId, "safety-lead");
  assert.deepEqual(audit.emergency.plan.assumptions, ["all-attendees-evacuate", "staff-assist-access-needs", "no-lift-use-during-fire"]);
  assert.equal(audit.emergency.evidence.degradedScenarios.length, 3);
  assert.equal(audit.manifest.emergencyEvidenceFingerprint, audit.emergency.evidence.evidenceFingerprint);
  assert.deepEqual(audit.manifest.emergencyReviewIds, [audit.emergency.reviews[0].id]);
});

test("print-safe Emergency Plan export is a one-page vector PDF", () => {
  const output = createVenuePlanner(summitForwardPlan).execute({ type: "export_plan", format: "pdf-emergency" });
  const bytes = Buffer.from(output.content, "base64");
  const text = bytes.toString("ascii");
  assert.equal(output.mimeType, "application/pdf");
  assert.match(output.filename, /-emergency\.pdf$/);
  assert.equal(bytes.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.match(text, /EMERGENCY PLAN/);
  assert.match(text, /BLOCKED-EXIT/);
  assert.match(text, /\/Count 1/);
});
