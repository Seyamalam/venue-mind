import assert from "node:assert/strict";
import test from "node:test";
import { createActivityEntry, fingerprintPlan, replayActivityLedger, sealActivityLedger } from "../src/domain/activity-ledger.ts";
import { detectLockConflicts, normalizeObjectLocks } from "../src/domain/locks.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";

const templateLock = (objectId, type) => ({ id: `lock-${objectId}-${type}`, objectId, type, source: "venue-template", reasonCode: "venue-infrastructure", authorId: "venue-template", active: true });

test("boolean lock flags do not create authority without typed Locks", () => {
  const object = normalizeObjectLocks({ id: "obj-stage", kind: "stage", locked: true });
  assert.equal(object.locked, false);
  assert.deepEqual(object.locks, []);
});

test("partial Locks reject only matching spatial properties", () => {
  const object = normalizeObjectLocks({ id: "obj-table-a", kind: "table", locked: false, locks: [templateLock("obj-table-a", "position")], footprint: { kind: "rectangle", center: { x: 4, y: 4 }, width: 2, depth: 1, rotationDegrees: 0 } });
  const plan = { objects: [object] };
  const move = [{ id: "chg-move", targetObjectIds: [object.id], spatialEffects: [{ operation: "update_footprint", objectId: object.id, footprint: { center: { x: 5, y: 4 } } }] }];
  const resize = [{ id: "chg-resize", targetObjectIds: [object.id], spatialEffects: [{ operation: "update_footprint", objectId: object.id, footprint: { width: 3 } }] }];

  assert.deepEqual(detectLockConflicts(plan, resize), []);
  assert.deepEqual(detectLockConflicts(plan, move).map((conflict) => [conflict.objectId, conflict.lockType, conflict.changeId]), [[object.id, "position", "chg-move"]]);
});

test("Activity Ledger replay preserves partial Lock semantics", () => {
  const before = structuredClone(createVenuePlanner(summitForwardPlan).getSnapshot().plan);
  const avDesk = before.objects.find((object) => object.id === "obj-av-desk");
  avDesk.locks = [templateLock(avDesk.id, "position")];
  avDesk.locked = true;
  const after = structuredClone(before);
  after.version = "3.3";
  after.objects.find((object) => object.id === avDesk.id).footprint.width = 4;
  const ledger = sealActivityLedger([
    createActivityEntry(1, "plan.opened", "human", { acceptedPlan: before, planFingerprint: fingerprintPlan(before) }),
    createActivityEntry(2, "proposal.approved", "human", { acceptedPlan: after, planFingerprint: fingerprintPlan(after) }),
  ]);

  const replay = replayActivityLedger(ledger, after);
  assert.equal(replay.status, "pass");
  assert.deepEqual(replay.lockedObjectViolations, []);
});

test("planner boundary returns one stable LOCK_CONFLICT for multi-object partial Lock violations", () => {
  const initial = structuredClone(summitForwardPlan);
  const avDesk = initial.objects.find((object) => object.id === "obj-av-desk");
  const mainRoute = initial.objects.find((object) => object.id === "obj-route-main");
  avDesk.locks = [templateLock(avDesk.id, "position")];
  avDesk.locked = false;
  mainRoute.locks = [templateLock(mainRoute.id, "dimension")];
  mainRoute.locked = false;
  initial.proposal.changes = [{
    id: "chg-multi-locked",
    number: 1,
    title: "Move AV and narrow route",
    shortTitle: "Locked changes",
    metrics: [],
    targetObjectIds: [avDesk.id, mainRoute.id],
    spatialEffects: [
      { operation: "update_footprint", objectId: avDesk.id, footprint: { center: { x: 24, y: 15 } } },
      { operation: "update_footprint", objectId: mainRoute.id, footprint: { width: 1 } },
    ],
    effects: {},
  }];

  assert.throws(
    () => createVenuePlanner(initial),
    (error) => error.code === "LOCK_CONFLICT"
      && error.details.conflicts.length === 2
      && error.details.conflicts.map((conflict) => conflict.objectId).join(",") === "obj-av-desk,obj-route-main",
  );
});

test("snapshot restore rejects objects without typed Locks", () => {
  const source = createVenuePlanner(summitForwardPlan);
  const snapshot = structuredClone(source.getSnapshot());
  delete snapshot.plan.objects[0].locks;
  const restored = createVenuePlanner(summitForwardPlan);
  assert.throws(() => restored.execute({ type: "restore_snapshot", snapshot }), (error) => error.code === "SNAPSHOT_INVALID");
});

test("human Project Locks are temporary, inspectable, validated, auditable, and retry-safe", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const beforeFingerprint = fingerprintPlan(planner.getSnapshot().plan);
  const setCommand = { type: "set_object_lock", objectId: "obj-av-desk", lockType: "position", reasonCode: "operator-hold", expiresAt: "2026-08-28T00:00:00.000Z", actor: "human", actorId: "operator-1", idempotencyKey: "lock-av-position" };
  const added = planner.execute(setCommand);
  const inspection = planner.execute({ type: "inspect_layout" });
  const validation = planner.execute({ type: "validate_layout" });

  assert.equal(added.status, "locked");
  assert.equal(inspection.projectLocks[0].source, "project");
  assert.equal(inspection.lockedObjects.find((object) => object.id === "obj-av-desk").locks[0].type, "position");
  assert.equal(validation.status, "fail");
  assert.equal(validation.checks.find((check) => check.id === "check-locked-objects").evidence.details.lockConflicts[0].lockId, added.lockId);

  const rejectedCommand = { type: "preview_revision", goal: "Move AV", actor: "agent", actorId: "agent-1", idempotencyKey: "preview-locked-av" };
  let firstError;
  try { planner.execute(rejectedCommand); } catch (error) { firstError = error; }
  assert.equal(firstError.code, "LOCK_CONFLICT");
  assert.equal(firstError.details.conflicts[0].lockType, "position");
  assert.equal(planner.getSnapshot().ledger.at(-1).type, "proposal.lock_rejected");
  assert.equal(planner.getSnapshot().ledger.at(-1).details.beforePlanVersion, planner.getSnapshot().plan.version);
  assert.equal(planner.getSnapshot().receipts.at(-1).error.code, "LOCK_CONFLICT");
  const rejectedLedgerCount = planner.getSnapshot().ledger.length;
  assert.throws(() => planner.execute(rejectedCommand), (error) => error.code === "LOCK_CONFLICT" && error.details.commandReceiptId === firstError.details.commandReceiptId);
  assert.equal(planner.getSnapshot().ledger.length, rejectedLedgerCount);

  const released = planner.execute({ type: "release_object_lock", lockId: added.lockId, actor: "human", actorId: "operator-1", idempotencyKey: "release-av-position" });
  const previewed = planner.execute({ ...rejectedCommand, idempotencyKey: "preview-unlocked-av" });
  assert.equal(released.status, "released");
  assert.equal(previewed.requiresHumanApproval, true);
  assert.equal(fingerprintPlan(planner.getSnapshot().plan), beforeFingerprint);
  assert.equal(planner.getSnapshot().ledger.some((entry) => entry.type === "object.lock_added"), true);
  assert.equal(planner.getSnapshot().ledger.some((entry) => entry.type === "object.lock_released"), true);
});
