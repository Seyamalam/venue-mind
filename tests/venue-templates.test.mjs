import assert from "node:assert/strict";
import test from "node:test";
import { createRoomTemplateUpdateProposal } from "../src/domain/template-updates.ts";
import { assertCurrentTemplateDocument, evaluateInventoryAvailability, venueTemplateCatalog } from "../src/domain/venue-templates.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const clone = (value) => JSON.parse(JSON.stringify(value));

test("catalog contains reusable Venue, versioned Room, starter, and complete inventory templates", () => {
  assert.ok(venueTemplateCatalog.venueTemplates.length >= 7);
  assert.equal(venueTemplateCatalog.roomTemplates.filter((item) => item.id === "room-template-harborview-main-hall").length, 2);
  assert.deepEqual(new Set(venueTemplateCatalog.roomTemplates.map((item) => item.useCase)), new Set(["conference", "concert", "banquet", "exhibition", "classroom", "community-event"]));
  assert.deepEqual(new Set(venueTemplateCatalog.inventoryTemplates.map((item) => item.category)), new Set(["furniture", "seating", "barriers", "staging", "av", "catering", "signage", "queue"]));
  for (const item of venueTemplateCatalog.inventoryTemplates) {
    assert.ok(item.dimensions);
    assert.equal(typeof item.weightKg, "number");
    assert.equal(typeof item.power.watts, "number");
    assert.equal(typeof item.capacity, "number");
    assert.equal(item.cost.currency, "USD");
    assert.equal(typeof item.availability.total, "number");
  }
});

test("template IDs and Project instance IDs stay in separate identity scopes", () => {
  const bound = summitForwardPlan.objects.filter((object) => object.templateRef?.templateObjectId);
  assert.ok(bound.length >= 4);
  for (const object of bound) {
    assert.notEqual(object.id, object.templateRef.templateId);
    assert.notEqual(object.id, object.templateRef.templateObjectId);
  }
});

test("template boundary accepts schema 1 only", () => {
  assert.equal(assertCurrentTemplateDocument(venueTemplateCatalog.inventoryTemplates[0]).schemaVersion, 1);
  assert.throws(() => assertCurrentTemplateDocument({ schemaVersion: 0, kind: "inventory-item-template", id: "inventory-template-old" }), (error) => error.code === "TEMPLATE_SCHEMA_UNSUPPORTED");
});

test("inventory availability warnings are deterministic", () => {
  const plan = clone(summitForwardPlan);
  plan.objects[0].templateRef = { kind: "inventory-item-template", templateId: "inventory-template-line-array", version: "1.0.0" };
  plan.objects[0].inventoryCount = 30;
  const warnings = evaluateInventoryAvailability(plan);
  const lineArray = warnings.find((item) => item.templateId === "inventory-template-line-array");
  assert.deepEqual(lineArray, { id: "inventory-inventory-template-line-array-1.0.0", templateId: "inventory-template-line-array", version: "1.0.0", requested: 32, available: 24, status: "warning", shortage: 8 });
});

test("Project Overrides suppress template fields and remain inspectable", () => {
  const plan = clone(summitForwardPlan);
  plan.objects.find((object) => object.id === "obj-route-main").templateOverrides = ["footprint.width"];
  const proposal = createRoomTemplateUpdateProposal(plan, { templateId: "room-template-harborview-main-hall", toVersion: "1.1.0" });
  assert.equal(proposal.changes.length, 0);
  assert.deepEqual(proposal.templateUpdate.preservedOverrides, [{ projectObjectId: "obj-route-main", templateObjectId: "roomobj-main-route", path: "footprint.width" }]);
});

test("field-level Project Overrides preserve one field without suppressing safe sibling updates", () => {
  const plan = clone(summitForwardPlan);
  const route = plan.objects.find((object) => object.id === "obj-route-main");
  route.templateOverrides = ["footprint.start.x"];
  route.footprint.start.x = 14.8;
  const proposal = createRoomTemplateUpdateProposal(plan, { templateId: "room-template-harborview-main-hall", toVersion: "1.1.0" });
  const footprint = proposal.changes[0].spatialEffects.find((effect) => effect.operation === "update_footprint").footprint;
  assert.equal(footprint.start.x, 14.8);
  assert.equal(footprint.width, 1.829);
  assert.deepEqual(proposal.templateUpdate.preservedOverrides, [{ projectObjectId: "obj-route-main", templateObjectId: "roomobj-main-route", path: "footprint.start.x" }]);
});

test("Room Template update creates a reviewable Proposal and never mutates the accepted Plan", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const before = clone(planner.getSnapshot().plan);
  const result = planner.execute({ type: "preview_template_update", templateId: "room-template-harborview-main-hall", toVersion: "1.1.0", actor: "agent", idempotencyKey: "template-update-1" });
  assert.equal(result.requiresHumanApproval, true);
  assert.equal(result.changedItems, 1);
  assert.deepEqual(planner.getSnapshot().plan, before);
  assert.equal(planner.getSnapshot().proposal.status, "review");
  assert.equal(planner.getSnapshot().proposal.templateUpdate.toVersion, "1.1.0");
  assert.equal(planner.getSnapshot().ledger.at(-1).type, "template.update_previewed");
});

test("approved Template Update advances the pinned Room version through the normal Approval boundary", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const preview = planner.execute({ type: "preview_revision", goal: "Ready accepted baseline", actor: "agent", idempotencyKey: "baseline-preview" });
  const accepted = planner.execute({ type: "approve_proposal", proposalId: preview.proposalId, baseVersion: preview.baseVersion, actor: "human", actorId: "operator-1", idempotencyKey: "baseline-approve" });
  assert.equal(accepted.planVersion, "3.3");
  const update = planner.execute({ type: "preview_template_update", templateId: "room-template-harborview-main-hall", toVersion: "1.1.0", actor: "agent", idempotencyKey: "template-update-approve-preview" });
  const validation = planner.execute({ type: "validate_layout" });
  assert.equal(validation.status, "pass");
  const approved = planner.execute({ type: "approve_proposal", proposalId: update.proposalId, baseVersion: update.baseVersion, actor: "human", actorId: "operator-1", idempotencyKey: "template-update-approve" });
  assert.equal(approved.planVersion, "3.4");
  assert.equal(planner.getSnapshot().plan.templateBindings.room.version, "1.1.0");
  assert.equal(planner.getSnapshot().plan.objects.find((object) => object.id === "obj-route-main").templateRef.version, "1.1.0");
});
