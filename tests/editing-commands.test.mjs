import assert from "node:assert/strict";
import test from "node:test";
import { buildEditingChange, measureObjects, snapCoordinate } from "../src/domain/editing-commands.ts";
import { fingerprintPlan } from "../src/domain/activity-ledger.ts";
import { normalizePlanGeometry } from "../src/domain/geometry.ts";
import { materializeSpatialPlan } from "../src/domain/spatial-analysis.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";

const clone = (value) => JSON.parse(JSON.stringify(value));

test("snap tolerance is explicit and deterministic", () => {
  assert.equal(snapCoordinate(3.94, { enabled: true, sizeM: 0.25, toleranceM: 0.08 }), 4);
  assert.equal(snapCoordinate(3.9, { enabled: true, sizeM: 0.25, toleranceM: 0.08 }), 3.9);
  assert.equal(snapCoordinate(3.94, { enabled: false }), 3.94);
});

test("editing operations produce canonical add, transform, group, measure, and delete effects", () => {
  const accepted = createVenuePlanner(summitForwardPlan).getSnapshot().plan;
  const source = accepted.objects.find((object) => object.id === "obj-av-desk");
  const duplicate = buildEditingChange(accepted, { operation: "duplicate", objectIds: [source.id], newObjectIds: ["obj-av-desk-copy"], offset: { x: 1, y: -1 } });
  let candidate = materializeSpatialPlan(accepted, [duplicate]);
  assert.equal(candidate.objects.some((object) => object.id === "obj-av-desk-copy"), true);

  const moved = buildEditingChange(candidate, { operation: "move", objectIds: ["obj-av-desk-copy"], delta: { x: 0.06, y: 0 }, snap: { enabled: true, sizeM: 0.25, toleranceM: 0.08 } });
  candidate = materializeSpatialPlan(candidate, [moved]);
  assert.equal(candidate.objects.find((object) => object.id === "obj-av-desk-copy").footprint.center.x, 22);

  const grouped = buildEditingChange(candidate, { operation: "group", objectIds: [source.id, "obj-av-desk-copy"], groupId: "group-av" });
  candidate = materializeSpatialPlan(candidate, [grouped]);
  assert.equal(candidate.objects.filter((object) => object.groupId === "group-av").length, 2);
  assert.equal(measureObjects(candidate, [source.id, "obj-av-desk-copy"]).distances.length, 1);

  const removed = buildEditingChange(candidate, { operation: "delete", objectIds: ["obj-av-desk-copy"] });
  candidate = materializeSpatialPlan(candidate, [removed]);
  assert.equal(candidate.objects.some((object) => object.id === "obj-av-desk-copy"), false);
});

test("shared apply_edit command previews, undoes, redoes, and ledgers without mutating the accepted Plan", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const before = fingerprintPlan(planner.getSnapshot().plan);
  const applied = planner.execute({ type: "apply_edit", edit: { operation: "move", objectIds: ["obj-av-desk"], delta: { x: 1, y: 0 } }, actor: "human", actorId: "operator-1", idempotencyKey: "edit-move-av" });
  assert.equal(applied.requiresHumanApproval, true);
  assert.equal(fingerprintPlan(planner.getSnapshot().plan), before);
  assert.equal(planner.getSnapshot().ledger.at(-1).type, "editor.change_applied");

  const undone = planner.execute({ type: "undo", actor: "human", idempotencyKey: "edit-undo-av" });
  assert.equal(undone.status, "edit-undone");
  assert.equal(planner.getSnapshot().proposal.changes.some((change) => change.id === applied.changeId), false);

  const redone = planner.execute({ type: "redo", actor: "human", idempotencyKey: "edit-redo-av" });
  assert.equal(redone.status, "edit-redone");
  assert.equal(planner.getSnapshot().proposal.changes.some((change) => change.id === applied.changeId), true);
  assert.deepEqual(planner.execute({ type: "measure_objects", objectIds: ["obj-av-desk", "obj-stage-west"] }).objectIds, ["obj-av-desk", "obj-stage-west"]);
});

test("placing every seeded object from an empty matching room reproduces canonical geometry", () => {
  const accepted = createVenuePlanner(summitForwardPlan).getSnapshot().plan;
  let constructed = normalizePlanGeometry({ ...clone(accepted), objects: [] });
  const changes = accepted.objects.map((object) => buildEditingChange(constructed, { operation: "place", object: clone(object) }));
  constructed = materializeSpatialPlan(constructed, changes);
  assert.equal(constructed.spatial.fingerprint, accepted.spatial.fingerprint);
  assert.equal(constructed.objects.length, accepted.objects.length);
  assert.equal(fingerprintPlan(constructed), fingerprintPlan(accepted));
});

test("one mouse-selectable layout preset can reconstruct the seeded Room from a different empty boundary", () => {
  const accepted = createVenuePlanner(summitForwardPlan).getSnapshot().plan;
  const empty = normalizePlanGeometry({ ...clone(accepted), spatial: { ...clone(accepted.spatial), roomBoundary: { outer: [{ x: 0, y: 0 }, { x: 24, y: 0 }, { x: 24, y: 16 }, { x: 0, y: 16 }], holes: [] } }, objects: [] });
  const layout = buildEditingChange(empty, { operation: "apply-layout", roomBoundary: clone(accepted.spatial.roomBoundary), objects: clone(accepted.objects) });
  const constructed = materializeSpatialPlan(empty, [layout]);
  assert.equal(constructed.spatial.fingerprint, accepted.spatial.fingerprint);
  assert.deepEqual(constructed.objects, accepted.objects);
});
