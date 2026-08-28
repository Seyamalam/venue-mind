import test from "node:test";
import assert from "node:assert/strict";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createActivityEntry, fingerprintPlan, replayActivityLedger, sealActivityLedger } from "../src/domain/activity-ledger.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";

const createPlanner = () => createVenuePlanner(summitForwardPlan);

test("inspection exposes stable IDs, locks, constraints, and the active proposal", () => {
  const planner = createPlanner();
  const result = planner.execute({ type: "inspect_layout" });

  assert.equal(result.planId, "plan-summit-forward-2026");
  assert.equal(result.planVersion, "3.2");
  assert.deepEqual(result.lockedObjects.map((object) => object.id), [
    "obj-stage-west",
    "obj-fire-exit-east",
    "obj-fire-exit-north",
    "obj-assembly-east",
    "obj-emergency-access-east",
    "obj-fire-equipment-east",
    "obj-column-southwest",
    "obj-power-west",
    "obj-rigging-center",
    "obj-accessible-entrance-south",
    "obj-door-south-access",
    "obj-restroom-accessible",
  ]);
  assert.equal(result.proposal.baseVersion, "3.2");
  assert.equal(result.proposal.changedItems, 4);
});

test("Event Brief requirements expose stable priorities and Constraint coverage", () => {
  const planner = createPlanner();
  const brief = planner.execute({ type: "get_project_brief" });

  assert.equal(brief.id, "brief-summit-forward-2026");
  assert.equal(brief.requirements.length, 7);
  assert.deepEqual(brief.requirements.map((requirement) => requirement.id), [
    "req-theater-seating",
    "req-west-stage",
    "req-breakout-access",
    "req-accessible-route",
    "req-av-control",
    "req-catering-rear",
    "req-emergency-readiness",
  ]);
  assert.equal(brief.requirements.find((requirement) => requirement.id === "req-accessible-route").priority, "critical");
  assert.equal(brief.coverage.find((item) => item.requirementId === "req-accessible-route").status, "satisfied");
  assert.equal(brief.summary.total, 7);
  assert.equal(brief.summary.measured, 5);
  assert.equal(brief.summary.ambiguous, 0);
  assert.equal(brief.coverageMatrix.activeProposal.find((item) => item.requirementId === "req-accessible-route").status, "satisfied");
  assert.equal(brief.coverageMatrix.acceptedPlan.find((item) => item.requirementId === "req-accessible-route").status, "blocked");
});

test("measurable Requirements without Constraint links are flagged before planning", () => {
  const planner = createPlanner();
  const brief = structuredClone(planner.getSnapshot().brief);
  brief.requirements.push({ id: "req-security-egress", category: "security", label: "Security egress post", priority: "high", owner: "security", status: "open", measurable: true, constraintIds: [], evidenceRefs: [] });

  planner.execute({ type: "update_event_brief", brief, actor: "human", idempotencyKey: "brief-security-egress" });
  const updated = planner.execute({ type: "get_project_brief" });

  assert.deepEqual(updated.ambiguities, [{ id: "ambiguity-req-security-egress-constraint", requirementId: "req-security-egress", field: "constraint" }]);
  assert.equal(updated.summary.ambiguous, 1);
});

test("a human can update the Event Brief without mutating the accepted Plan", () => {
  const planner = createPlanner();
  const beforeVersion = planner.getSnapshot().plan.version;
  const brief = planner.execute({ type: "get_project_brief" });
  const requirements = brief.requirements.map((requirement) => requirement.id === "req-catering-rear" ? { ...requirement, priority: "high", status: "confirmed" } : requirement);

  const result = planner.execute({ type: "update_event_brief", brief: { ...brief, attendeeTarget: 420, requirements }, actor: "human", idempotencyKey: "brief-attendance-420" });

  assert.equal(result.status, "updated");
  assert.equal(result.attendeeTarget, 420);
  assert.equal(planner.getSnapshot().plan.version, beforeVersion);
  assert.equal(planner.execute({ type: "get_project_brief" }).requirements.find((requirement) => requirement.id === "req-catering-rear").priority, "high");
  assert.equal(planner.execute({ type: "get_change_log" }).at(-1).type, "brief.updated");
});

test("inspection exposes canonical real-world geometry and stable footprints", () => {
  const planner = createPlanner();
  const result = planner.execute({ type: "inspect_layout" });

  assert.equal(result.spatial.schemaVersion, 1);
  assert.equal(result.spatial.unit, "m");
  assert.deepEqual(result.spatial.units, { length: "m", area: "m2", angle: "deg", time: "s" });
  assert.deepEqual(result.spatial.layers, ["architecture", "furniture", "access", "production", "catering", "safety", "annotations"]);
  assert.equal(result.spatial.coordinateSystem.origin, "southwest");
  assert.deepEqual(result.spatial.roomBoundary.outer, [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
    { x: 30, y: 20 },
    { x: 0, y: 20 },
  ]);
  assert.match(result.spatial.fingerprint, /^geom-[0-9a-f]{8}$/);
  assert.deepEqual(result.spatialObjects.find((object) => object.id === "obj-stage-west").footprint, {
    kind: "rectangle",
    center: { x: 4, y: 10 },
    width: 6,
    depth: 12,
    rotationDegrees: 0,
  });
});

test("inspection exposes typed operational geometry for doors, exits, routes, and restricted zones", () => {
  const result = createPlanner().execute({ type: "inspect_layout" });
  const objects = new Map(result.spatialObjects.map((object) => [object.id, object]));

  assert.equal(objects.get("obj-door-south-access").kind, "door");
  assert.equal(objects.get("obj-door-south-access").footprint.kind, "line");
  assert.deepEqual(objects.get("obj-door-south-access").operational.door, { clearWidthM: 1.8, swing: "inward", accessible: true, clearance: { side: "left", depthM: 1.5, latchSideM: 0.45 } });
  assert.equal(objects.get("obj-fire-exit-east").operational.exit.emergency, true);
  assert.equal(objects.get("obj-route-main").kind, "corridor");
  assert.equal(objects.get("obj-route-seating-west").kind, "aisle");
  assert.equal(objects.get("obj-route-stage").kind, "service_lane");
  assert.deepEqual(objects.get("obj-restricted-production").operational.restriction, { access: "staff-only", reasonCode: "production-clearance", blocksPlacement: true });
});

test("inspection exposes Occupancy Zones and Seating Section capacity", () => {
  const result = createPlanner().execute({ type: "inspect_layout" });
  const west = result.spatialObjects.find((object) => object.id === "obj-seating-west");

  assert.equal(west.capacity, 200);
  assert.deepEqual(result.occupancy.sections.find((section) => section.objectId === west.id), { objectId: "obj-seating-west", zoneId: "zone-keynote-floor", minimumCapacity: 180, maximumCapacity: 220 });
  assert.deepEqual(result.occupancy.zones.map((zone) => zone.id), ["zone-keynote-floor"]);
});

test("snapshot restore rejects operational geometry with an incompatible footprint", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.plan.objects.push({
    id: "obj-door-invalid",
    kind: "door",
    label: "Invalid door",
    layer: "architecture",
    elevationM: 0,
    locked: false,
    door: { clearWidthM: 1, swing: "inward", accessible: false },
    footprint: { kind: "rectangle", center: { x: 20, y: 2 }, width: 1, depth: 1, rotationDegrees: 0 },
  });

  assert.throws(() => planner.execute({ type: "restore_snapshot", snapshot }), /door.+line footprint/i);
});

test("snapshot restore canonicalizes geometry precision and rotation", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  const avDesk = snapshot.plan.objects.find((object) => object.id === "obj-av-desk");
  avDesk.footprint.center.x = 21.12349;
  avDesk.footprint.rotationDegrees = 450.14;

  planner.execute({ type: "restore_snapshot", snapshot });
  const restored = planner.getSnapshot().plan.objects.find((object) => object.id === "obj-av-desk");

  assert.equal(restored.footprint.center.x, 21.123);
  assert.equal(restored.footprint.rotationDegrees, 90.1);
});

test("snapshot restore rejects self-intersecting room boundaries", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.plan.spatial.roomBoundary.outer = [
    { x: 0, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
    { x: 20, y: 0 },
  ];

  assert.throws(
    () => planner.execute({ type: "restore_snapshot", snapshot }),
    /self-intersecting room boundary/i,
  );
});

test("snapshot restore rejects object footprints outside the room boundary", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.plan.objects.find((object) => object.id === "obj-av-desk").footprint.center.x = 40;

  assert.throws(
    () => planner.execute({ type: "restore_snapshot", snapshot }),
    /outside the room boundary/i,
  );
});

test("legacy snapshots inherit canonical geometry by stable object ID", () => {
  const planner = createPlanner();
  const legacy = structuredClone(planner.getSnapshot());
  delete legacy.plan.spatial;
  for (const object of legacy.plan.objects) delete object.footprint;

  planner.execute({ type: "restore_snapshot", snapshot: legacy });

  assert.equal(planner.getSnapshot().plan.spatial.unit, "m");
  assert.equal(
    planner.getSnapshot().plan.objects.find((object) => object.id === "obj-column-southwest").footprint.kind,
    "circle",
  );
});

test("metric-only snapshots migrate to geometry-backed evidence by stable IDs", () => {
  const source = createPlanner();
  const legacy = structuredClone(source.getSnapshot());
  const evidenceObjectIds = new Set(["obj-accessible-entrance-south", "obj-restroom-accessible", "obj-seating-west", "obj-seating-east", "obj-route-main", "obj-route-stage", "obj-route-seating-west", "obj-route-seating-east", "obj-route-exit-east", "obj-door-south-access", "obj-restricted-production"]);
  legacy.plan.objects = legacy.plan.objects.filter((object) => !evidenceObjectIds.has(object.id));
  legacy.plan.constraints = legacy.plan.constraints.filter((constraint) => !["constraint-turning-clearance", "constraint-accessible-seating"].includes(constraint.id)).map((constraint) => {
    if (constraint.id === "constraint-accessible-route") return { ...constraint, evaluator: "minimum_metric", parameters: { metric: "accessibleRouteWidthFt", comparator: "gte", threshold: 6, unit: "ft" } };
    if (constraint.id === "constraint-capacity") return { ...constraint, evaluator: "minimum_metric", parameters: { metric: "attendeeCapacity", comparator: "gte", threshold: 400, unit: "attendees" } };
    if (constraint.id === "constraint-peak-congestion") return { ...constraint, evaluator: "maximum_metric", parameters: { metric: "peakCongestionIndex", comparator: "lte", threshold: 80, unit: "index" } };
    if (constraint.id === "constraint-sightlines") return { ...constraint, evaluator: "minimum_metric", parameters: { metric: "sightlineCoverage", comparator: "gte", threshold: 0.85, unit: "ratio" } };
    return constraint;
  });
  for (const change of legacy.proposal.changes) {
    delete change.spatialEffects;
    delete change.targetObjectIds;
  }
  legacy.branches[0].proposal = structuredClone(legacy.proposal);

  const restored = createPlanner();
  restored.execute({ type: "restore_snapshot", snapshot: legacy });
  const validation = restored.execute({ type: "validate_layout" });

  assert.equal(restored.getSnapshot().plan.objects.some((object) => object.id === "obj-route-main"), true);
  assert.equal(restored.getSnapshot().plan.constraints.find((constraint) => constraint.id === "constraint-accessible-route").evaluator, "accessible_route_graph");
  assert.equal(restored.getSnapshot().proposal.changes.find((change) => change.id === "chg-center-aisle-width").spatialEffects.length, 5);
  assert.equal(validation.status, "pass", JSON.stringify(validation.checks.filter((check) => check.status !== "pass")));
  assert.match(validation.spatialEvidence.accessibility.graphFingerprint, /^graph-/);
  assert.equal(restored.execute({ type: "get_change_log" }).at(-1).type, "schema.migrated");
  const replay = restored.execute({ type: "replay_history" });
  assert.equal(replay.status, "pass", JSON.stringify(replay));
});

test("schema-v6 snapshots migrate generic routes to typed operational geometry", () => {
  const source = createPlanner();
  const legacy = structuredClone(source.getSnapshot());
  legacy.plan.objects = legacy.plan.objects.filter((object) => !["obj-door-south-access", "obj-restricted-production"].includes(object.id)).map((object) => {
    const { locks: _locks, ...unlocked } = object;
    if (unlocked.accessibility) delete unlocked.accessibility.accessibleSeatSampleIds;
    if (object.id === "obj-fire-exit-east") {
      const { exit, ...rest } = unlocked;
      return rest;
    }
    if (["corridor", "aisle", "service_lane", "accessible_route"].includes(object.kind)) {
      const { route, ...rest } = unlocked;
      return { ...rest, kind: "accessible_route" };
    }
    return unlocked;
  });
  legacy.plan.constraints = legacy.plan.constraints.filter((constraint) => !["accessible_seating_sightlines", "door_clearance", "temporary_ramp"].includes(constraint.evaluator));

  const restored = createPlanner();
  restored.execute({ type: "restore_snapshot", snapshot: legacy });
  const objects = new Map(restored.getSnapshot().plan.objects.map((object) => [object.id, object]));
  const migrations = restored.execute({ type: "get_change_log" }).filter((entry) => entry.type === "schema.migrated");

  assert.equal(objects.get("obj-door-south-access").kind, "door");
  assert.equal(objects.get("obj-route-main").kind, "corridor");
  assert.equal(objects.get("obj-route-seating-west").kind, "aisle");
  assert.equal(objects.get("obj-route-stage").kind, "service_lane");
  assert.equal(objects.get("obj-fire-exit-east").exit.emergency, true);
  assert.equal(objects.get("obj-restricted-production").restriction.blocksPlacement, true);
  assert.deepEqual(migrations.map((entry) => entry.details.migrationId), ["project-schema-v6-to-v7-operational-geometry", "project-schema-v7-to-v8-typed-locks", "project-schema-v8-to-v9-accessibility-infrastructure"]);
  assert.equal(restored.execute({ type: "replay_history" }).status, "pass");
});

test("schema-v8 snapshots migrate accessible sightlines and clearance infrastructure by stable ID", () => {
  const source = createPlanner();
  const legacy = structuredClone(source.getSnapshot());
  for (const object of legacy.plan.objects) {
    if (object.accessibility) delete object.accessibility.accessibleSeatSampleIds;
    if (object.door) delete object.door.clearance;
  }
  legacy.plan.constraints = legacy.plan.constraints.filter((constraint) => !["accessible_seating_sightlines", "door_clearance", "temporary_ramp"].includes(constraint.evaluator));

  const restored = createPlanner();
  restored.execute({ type: "restore_snapshot", snapshot: legacy });
  const snapshot = restored.getSnapshot();
  const migrations = snapshot.ledger.filter((entry) => entry.type === "schema.migrated");

  assert.deepEqual(snapshot.plan.objects.find((object) => object.id === "obj-seating-east").accessibility.accessibleSeatSampleIds, ["seat-east-01", "seat-east-05"]);
  assert.deepEqual(snapshot.plan.objects.find((object) => object.id === "obj-door-south-access").door.clearance, { side: "left", depthM: 1.5, latchSideM: 0.45 });
  assert.deepEqual(migrations.map((entry) => entry.details.migrationId), ["project-schema-v8-to-v9-accessibility-infrastructure"]);
  assert.equal(restored.execute({ type: "validate_layout" }).status, "pass");
  assert.equal(restored.execute({ type: "replay_history" }).status, "pass");
});

test("preview creates a new non-destructive proposal and records the agent action", () => {
  const planner = createPlanner();
  const before = planner.execute({ type: "inspect_layout" });
  const preview = planner.execute({ type: "preview_revision", goal: "Reduce entrance congestion", actor: "agent", idempotencyKey: "preview-reduce-entrance" });
  const after = planner.execute({ type: "inspect_layout" });
  const ledger = planner.execute({ type: "get_change_log" });

  assert.equal(before.planVersion, after.planVersion);
  assert.equal(preview.baseVersion, before.planVersion);
  assert.equal(preview.requiresHumanApproval, true);
  assert.equal(after.proposal.goal, "Reduce entrance congestion");
  assert.equal(ledger.at(-1).type, "proposal.previewed");
  assert.equal(ledger.at(-1).actor, "agent");
});

test("mutating commands require an idempotency key", () => {
  const planner = createPlanner();

  assert.throws(
    () => planner.execute({ type: "preview_revision", goal: "Reduce entrance congestion", actor: "agent" }),
    /idempotency key is required/i,
  );
  assert.equal(planner.getSnapshot().proposal.revision, 1);
});

test("exact command retries return one receipt and produce one state transition", () => {
  const planner = createPlanner();
  const command = {
    type: "preview_revision",
    goal: "Reduce entrance congestion",
    actor: "agent",
    idempotencyKey: "preview-entrance-001",
    correlationId: "corr-agent-turn-001",
  };

  const first = planner.execute(command);
  const retries = Array.from({ length: 9 }, () => planner.execute(command));
  const receipt = planner.getSnapshot().receipts[0];

  assert.ok(retries.every((result) => JSON.stringify(result) === JSON.stringify(first)));
  assert.equal(planner.getSnapshot().proposal.revision, 2);
  assert.equal(planner.getSnapshot().ledger.filter((entry) => entry.type === "proposal.previewed").length, 1);
  assert.equal(planner.getSnapshot().receipts.length, 1);
  assert.equal(receipt.idempotencyKey, "preview-entrance-001");
  assert.equal(receipt.commandType, "preview_revision");
  assert.match(receipt.inputFingerprint, /^command-[0-9a-f]{8}$/);
  assert.equal(receipt.correlationId, "corr-agent-turn-001");
  assert.deepEqual(receipt.resultIds, { proposalId: first.proposalId });
  assert.equal(planner.getSnapshot().ledger.at(-1).details.commandReceiptId, receipt.id);
  assert.equal(planner.getSnapshot().ledger.at(-1).details.correlationId, "corr-agent-turn-001");
});

test("ten identical command requests return one equivalent receipt and one transition", () => {
  const planner = createPlanner();
  const command = { type: "preview_revision", goal: "Ten retry proof", actor: "agent", idempotencyKey: "preview-ten-retries" };
  const responses = Array.from({ length: 10 }, () => planner.execute(command));

  assert.equal(responses.every((response) => JSON.stringify(response) === JSON.stringify(responses[0])), true);
  assert.equal(new Set(responses.map((response) => response.receipt.id)).size, 1);
  assert.equal(planner.getSnapshot().receipts.filter((receipt) => receipt.idempotencyKey === command.idempotencyKey).length, 1);
  assert.equal(planner.getSnapshot().ledger.filter((entry) => entry.type === "proposal.previewed").length, 1);
});

test("an idempotency key cannot be reused with different command input", () => {
  const planner = createPlanner();
  planner.execute({ type: "preview_revision", goal: "Goal A", actor: "agent", idempotencyKey: "preview-shared-key" });

  assert.throws(
    () => planner.execute({ type: "preview_revision", goal: "Goal B", actor: "agent", idempotencyKey: "preview-shared-key" }),
    /idempotency key conflict/i,
  );
  assert.equal(planner.getSnapshot().proposal.goal, "Goal A");
});

test("command receipts preserve retry safety across snapshot restore", () => {
  const firstPlanner = createPlanner();
  const command = { type: "preview_revision", goal: "Persistent retry", actor: "agent", idempotencyKey: "preview-persisted-001" };
  const first = firstPlanner.execute(command);
  const snapshot = structuredClone(firstPlanner.getSnapshot());
  const restoredPlanner = createPlanner();

  restoredPlanner.execute({ type: "restore_snapshot", snapshot });
  const retried = restoredPlanner.execute(command);

  assert.deepEqual(retried, first);
  assert.equal(restoredPlanner.getSnapshot().receipts.length, 1);
  assert.equal(restoredPlanner.getSnapshot().ledger.filter((entry) => entry.type === "proposal.previewed").length, 1);
});

test("every planner mutation is retry-safe", () => {
  const scenarios = [
    ["brief", (planner) => ({ type: "update_event_brief", brief: { ...planner.getSnapshot().brief, attendeeTarget: 401 }, actor: "human", idempotencyKey: "retry-brief" })],
    ["preview", () => ({ type: "preview_revision", goal: "Retry preview", actor: "agent", idempotencyKey: "retry-preview" })],
    ["adjustment", () => ({ type: "request_adjustment", instruction: "Retry adjustment", actor: "human", idempotencyKey: "retry-adjustment" })],
    ["revert", () => ({ type: "revert_change", changeId: "chg-refreshment-buffer", actor: "human", idempotencyKey: "retry-revert" })],
    ["waiver", (planner) => {
      const snapshot = structuredClone(planner.getSnapshot());
      snapshot.plan.constraints.push({ id: "constraint-retry-warning", checkId: "check-retry-warning", evaluator: "minimum_metric", label: "Retry warning", category: "operations", severity: "warning", waivable: true, scope: { kind: "plan" }, parameters: { metric: "attendeeCapacity", comparator: "gte", threshold: 450, unit: "attendees" }, remediation: "Record a disposition." });
      planner.execute({ type: "restore_snapshot", snapshot });
      return { type: "waive_warning", constraintId: "constraint-retry-warning", reasonCode: "operational-acceptance", actor: "human", actorId: "operator-retry", idempotencyKey: "retry-waiver" };
    }],
    ["lock", () => ({ type: "set_object_lock", objectId: "obj-av-desk", lockType: "rotation", reasonCode: "operator-hold", actor: "human", actorId: "operator-retry", idempotencyKey: "retry-lock" })],
    ["release lock", (planner) => {
      const lock = planner.execute({ type: "set_object_lock", objectId: "obj-av-desk", lockType: "rotation", reasonCode: "operator-hold", actor: "human", actorId: "operator-retry", idempotencyKey: "prepare-release-lock" });
      return { type: "release_object_lock", lockId: lock.lockId, actor: "human", actorId: "operator-retry", idempotencyKey: "retry-release-lock" };
    }],
    ["branch", () => ({ type: "create_branch", name: "Retry branch", strategy: "access-first", actor: "human", idempotencyKey: "retry-branch" })],
    ["switch", () => ({ type: "switch_branch", branchId: "branch-balanced", actor: "human", idempotencyKey: "retry-switch" })],
    ["branch metadata", () => ({ type: "update_branch_metadata", branchId: "branch-balanced", name: "Balanced review", notes: "Operator note", actor: "human", idempotencyKey: "retry-branch-metadata" })],
    ["branch duplicate", () => ({ type: "duplicate_branch", branchId: "branch-balanced", name: "Balanced copy", actor: "human", idempotencyKey: "retry-branch-duplicate" })],
    ["branch archive", (planner) => {
      const branch = planner.execute({ type: "create_branch", name: "Archive source", strategy: "balanced", actor: "human", idempotencyKey: "prepare-branch-archive" });
      return { type: "archive_branch", branchId: branch.branchId, actor: "human", idempotencyKey: "retry-branch-archive" };
    }],
    ["branch restore", (planner) => {
      const branch = planner.execute({ type: "create_branch", name: "Restore source", strategy: "balanced", actor: "human", idempotencyKey: "prepare-branch-restore-create" });
      planner.execute({ type: "archive_branch", branchId: branch.branchId, actor: "human", idempotencyKey: "prepare-branch-restore-archive" });
      return { type: "restore_branch", branchId: branch.branchId, actor: "human", idempotencyKey: "retry-branch-restore" };
    }],
    ["branch decision", (planner) => {
      const branch = planner.execute({ type: "create_branch", name: "Decision source", strategy: "access-first", actor: "human", idempotencyKey: "prepare-branch-decision" });
      return { type: "record_branch_decision", chosenBranchId: branch.branchId, rejectedBranchIds: ["branch-balanced"], note: "Access evidence", actor: "human", actorId: "operator-retry", idempotencyKey: "retry-branch-decision" };
    }],
    ["comment add", () => ({ type: "add_comment", anchor: { kind: "coordinate", planVersion: "3.2", point: { x: 10, y: 10 } }, body: "Retry comment", actor: "human", actorId: "operator-retry", idempotencyKey: "retry-comment-add" })],
    ["comment edit", (planner) => {
      const comment = planner.execute({ type: "add_comment", anchor: { kind: "plan-version", planVersion: "3.2" }, body: "Before", actor: "human", actorId: "operator-retry", idempotencyKey: "prepare-comment-edit" });
      return { type: "edit_comment", commentId: comment.commentId, body: "After", actor: "human", actorId: "operator-retry", idempotencyKey: "retry-comment-edit" };
    }],
    ["comment status", (planner) => {
      const comment = planner.execute({ type: "add_comment", anchor: { kind: "project", projectId: "project-summit-forward" }, body: "Resolve", actor: "human", actorId: "operator-retry", idempotencyKey: "prepare-comment-status" });
      return { type: "set_comment_status", commentId: comment.commentId, status: "resolved", actor: "human", actorId: "operator-retry", idempotencyKey: "retry-comment-status" };
    }],
    ["approval", (planner) => ({ type: "approve_proposal", proposalId: planner.getSnapshot().proposal.id, baseVersion: planner.getSnapshot().plan.version, actor: "human", idempotencyKey: "retry-approval" })],
    ["undo", (planner) => {
      const proposal = planner.getSnapshot().proposal;
      planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "prepare-undo" });
      return { type: "undo", actor: "human", idempotencyKey: "retry-undo" };
    }],
    ["redo", (planner) => {
      const proposal = planner.getSnapshot().proposal;
      planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "prepare-redo-approval" });
      planner.execute({ type: "undo", actor: "human", idempotencyKey: "prepare-redo-undo" });
      return { type: "redo", actor: "human", idempotencyKey: "retry-redo" };
    }],
    ["rebase", (planner) => {
      const branch = planner.execute({ type: "create_branch", name: "Retry rebase", strategy: "balanced", actor: "human", idempotencyKey: "prepare-rebase-branch" });
      planner.execute({ type: "switch_branch", branchId: "branch-balanced", actor: "human", idempotencyKey: "prepare-rebase-switch" });
      const proposal = planner.getSnapshot().proposal;
      planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "prepare-rebase-approval" });
      return { type: "rebase_proposal", branchId: branch.branchId, actor: "human", idempotencyKey: "retry-rebase" };
    }],
    ["conflict resolution", (planner) => {
      const snapshot = structuredClone(planner.getSnapshot());
      snapshot.plan.objects.push(
        { id: "obj-retry-solid-a", kind: "table", label: "Solid A", layer: "furniture", elevationM: 0, locked: false, placement: { collisionMode: "solid" }, footprint: { kind: "rectangle", center: { x: 5, y: 2 }, width: 1, depth: 1, rotationDegrees: 0 } },
        { id: "obj-retry-solid-b", kind: "table", label: "Solid B", layer: "furniture", elevationM: 0, locked: false, placement: { collisionMode: "solid" }, footprint: { kind: "rectangle", center: { x: 8, y: 2 }, width: 1, depth: 1, rotationDegrees: 0 } },
      );
      snapshot.proposal.changes.push({ id: "chg-retry-overlap", number: 5, title: "Overlap", shortTitle: "Overlap", metrics: [], targetObjectIds: ["obj-retry-solid-a"], spatialEffects: [{ operation: "update_footprint", objectId: "obj-retry-solid-a", footprint: { center: { x: 8, y: 2 } } }], effects: {} });
      snapshot.branches[0].proposal = structuredClone(snapshot.proposal);
      planner.execute({ type: "restore_snapshot", snapshot });
      const detected = planner.execute({ type: "detect_conflicts", branchId: "branch-balanced" });
      const overlap = detected.conflicts.find((conflict) => conflict.type === "geometry-overlap");
      return { type: "resolve_conflict", branchId: "branch-balanced", conflictId: overlap.id, outcome: "keep-plan", actor: "human", actorId: "operator-retry", idempotencyKey: "retry-conflict-resolution" };
    }],
  ];

  for (const [name, createCommand] of scenarios) {
    const planner = createPlanner();
    const command = createCommand(planner);
    const receiptsBefore = planner.getSnapshot().receipts.length;
    const first = planner.execute(command);
    const ledgerAfterFirst = planner.getSnapshot().ledger.length;
    const second = planner.execute(command);
    assert.deepEqual(second, first, `${name} returns its original result`);
    assert.equal(planner.getSnapshot().receipts.length, receiptsBefore + 1, `${name} stores one receipt`);
    assert.equal(planner.getSnapshot().ledger.length, ledgerAfterFirst, `${name} does not duplicate ledger entries`);
  }
});

test("validation evaluates the visible proposal against deterministic constraints", () => {
  const planner = createPlanner();
  const validation = planner.execute({ type: "validate_layout" });

  assert.equal(validation.status, "pass");
  assert.equal(validation.unresolvedIssues, 0);
  assert.equal(validation.candidateMetrics.accessibleRouteWidthFt, 6);
  assert.equal(validation.candidateMetrics.peakCongestionIndex, 66.5);
  assert.equal(validation.checks.length, 13);
});

test("accessibility Validation is derived from a traversable route graph", () => {
  const planner = createPlanner();
  const validation = planner.execute({ type: "validate_layout" });
  const access = validation.spatialEvidence.accessibility;
  const check = validation.checks.find((item) => item.id === "check-accessible-route");

  assert.equal(check.evaluator, "accessible_route_graph");
  assert.equal(check.status, "pass");
  assert.equal(check.actual, 1.829);
  assert.equal(check.threshold, 1.8);
  assert.equal(check.unit, "m");
  assert.equal(access.connected, true);
  assert.equal(access.minimumClearWidthM, 1.829);
  assert.deepEqual(access.routeObjectIds, [
    "obj-route-exit-east",
    "obj-route-main",
    "obj-route-north-link-a",
    "obj-route-north-link-b",
    "obj-route-seating-east",
    "obj-route-seating-west",
    "obj-route-stage",
  ]);
  assert.deepEqual(access.reachableDestinationIds, [
    "obj-fire-exit-east",
    "obj-fire-exit-north",
    "obj-restroom-accessible",
    "obj-seating-east",
    "obj-seating-west",
    "obj-stage-west",
  ]);
  assert.match(access.graphFingerprint, /^graph-[0-9a-f]{8}$/);
});

test("accessibility evidence includes turning clearance and distributed companion seating", () => {
  const planner = createPlanner();
  const validation = planner.execute({ type: "validate_layout" });
  const access = validation.spatialEvidence.accessibility;

  assert.equal(access.turningClearanceM, 1.829);
  assert.equal(access.minimumTurningClearanceM, 1.5);
  assert.deepEqual(access.accessibleSeatingSections, [
    { objectId: "obj-seating-east", accessibleSeats: 4, companionSeats: 4 },
    { objectId: "obj-seating-west", accessibleSeats: 4, companionSeats: 4 },
  ]);
  assert.equal(access.accessibleSeats, 8);
  assert.equal(access.companionSeats, 8);
  assert.equal(access.seatingDistributed, true);
  assert.ok(access.reachableDestinationIds.includes("obj-restroom-accessible"));
  assert.equal(validation.checks.find((item) => item.id === "check-turning-clearance").status, "pass");
  assert.equal(validation.checks.find((item) => item.id === "check-accessible-seating").status, "pass");
});

test("accessible seating sightlines fail deterministically for a blocked designated sample", () => {
  const initial = structuredClone(summitForwardPlan);
  initial.objects.push({ id: "obj-access-sightline-blocker", kind: "column", label: "Sightline blocker", layer: "production", elevationM: 2, locked: false, sightline: { opacity: 1, heightM: 2 }, footprint: { kind: "circle", center: { x: 12, y: 8 }, radius: 0.7 } });
  const planner = createVenuePlanner(initial);
  const first = planner.execute({ type: "validate_layout" });
  const second = planner.execute({ type: "validate_layout" });
  const check = first.checks.find((item) => item.id === "check-accessible-seating-sightlines");

  assert.deepEqual(second, first);
  assert.equal(check.status, "fail");
  assert.equal(check.actual, 0.75);
  assert.deepEqual(check.evidence.details.blockedSampleIds, ["seat-east-01"]);
  assert.deepEqual(check.evidence.affectedObjectIds, ["obj-seating-east"]);
  assert.equal(check.evidence.details.sections.find((section) => section.objectId === "obj-seating-east").coverageRatio, 0.5);
  assert.ok(first.spatialEvidence.sightlines.rays.some((ray) => ray.sampleId === "seat-east-01" && ray.blockedByObjectIds.includes("obj-access-sightline-blocker")));
});

test("door clearance zones identify exact obstructing objects", () => {
  const initial = structuredClone(summitForwardPlan);
  initial.objects.push({ id: "obj-door-cart", kind: "table", label: "Door cart", layer: "catering", elevationM: 0.8, locked: false, footprint: { kind: "rectangle", center: { x: 15, y: 1 }, width: 0.6, depth: 0.6, rotationDegrees: 0 } });
  const validation = createVenuePlanner(initial).execute({ type: "validate_layout" });
  const check = validation.checks.find((item) => item.id === "check-door-clearance");
  const zone = validation.spatialEvidence.accessibility.doorClearanceZones[0];

  assert.equal(check.status, "fail");
  assert.deepEqual(check.evidence.affectedObjectIds, ["obj-door-cart", "obj-door-south-access"]);
  assert.equal(zone.id, "door-clearance-obj-door-south-access-left");
  assert.equal(zone.status, "blocked");
  assert.deepEqual(zone.obstructingObjectIds, ["obj-door-cart"]);
  assert.deepEqual(zone.points, [{ x: 13.65, y: 0.1 }, { x: 16.35, y: 0.1 }, { x: 16.35, y: 1.6 }, { x: 13.65, y: 1.6 }]);
});

test("temporary ramps validate slope, width, landing, edge protection, and handrails", () => {
  const rampObject = (ramp) => ({ id: "obj-temporary-ramp", kind: "temporary_ramp", label: "Temporary ramp", layer: "access", elevationM: 0, locked: false, ramp, footprint: { kind: "line", start: { x: 1, y: 2 }, end: { x: 13, y: 2 }, width: 1 } });
  const valid = structuredClone(summitForwardPlan);
  valid.objects.push(rampObject({ riseM: 0.15, runM: 1.8, clearWidthM: 1, landingLengthM: 1.6, edgeProtectionHeightM: 0.1, handrails: true }));
  const passing = createVenuePlanner(valid).execute({ type: "validate_layout" }).checks.find((item) => item.id === "check-temporary-ramps");
  const invalid = structuredClone(summitForwardPlan);
  invalid.objects.push(rampObject({ riseM: 0.8, runM: 4, clearWidthM: 0.7, landingLengthM: 1, edgeProtectionHeightM: 0.03, handrails: false }));
  const failing = createVenuePlanner(invalid).execute({ type: "validate_layout" }).checks.find((item) => item.id === "check-temporary-ramps");

  assert.equal(passing.status, "pass");
  assert.equal(passing.actual, 12);
  assert.equal(failing.status, "fail");
  assert.equal(failing.actual, 5);
  assert.deepEqual(failing.evidence.details.ramps[0].failures, ["slope", "width", "landing", "edge-protection", "handrails"]);
  assert.deepEqual(failing.evidence.affectedObjectIds, ["obj-temporary-ramp"]);
});

test("seeded broken accessible route is identified and resolved by canonical Proposal evidence", () => {
  const planner = createPlanner();
  const proposed = planner.execute({ type: "validate_layout" });
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.proposal.status = "approved";
  snapshot.branches = snapshot.branches.map((branch) => ({ ...branch, proposal: { ...branch.proposal, status: "approved" } }));
  planner.execute({ type: "restore_snapshot", snapshot });
  const accepted = planner.execute({ type: "validate_layout" });
  const proposedCheck = proposed.checks.find((item) => item.id === "check-accessible-route");
  const acceptedCheck = accepted.checks.find((item) => item.id === "check-accessible-route");

  assert.equal(acceptedCheck.status, "fail");
  assert.equal(acceptedCheck.actual, 1.219);
  assert.equal(acceptedCheck.threshold, 1.8);
  assert.match(acceptedCheck.remediation, /connect|width/i);
  assert.equal(proposedCheck.status, "pass");
  assert.equal(proposedCheck.actual, 1.829);
  assert.equal(proposed.spatialEvidence.accessibility.edges.length, 7);
});

test("capacity and circulation reconcile from geometry, inventory, and route paths", () => {
  const planner = createPlanner();
  const validation = planner.execute({ type: "validate_layout" });
  const capacity = validation.spatialEvidence.capacity;
  const circulation = validation.spatialEvidence.circulation;

  assert.deepEqual(capacity.sectionCapacities, [
    { objectId: "obj-seating-east", label: "East seating", zoneId: "zone-keynote-floor", capacity: 200, minimumCapacity: 180, maximumCapacity: 220, status: "within-limit", deltaFromMinimum: 20, headroom: 20 },
    { objectId: "obj-seating-west", label: "West seating", zoneId: "zone-keynote-floor", capacity: 200, minimumCapacity: 180, maximumCapacity: 220, status: "within-limit", deltaFromMinimum: 20, headroom: 20 },
  ]);
  assert.deepEqual(capacity.zoneCapacities, [
    { zoneId: "zone-keynote-floor", label: "Keynote floor", sectionObjectIds: ["obj-seating-east", "obj-seating-west"], capacity: 400, minimumCapacity: 390, maximumCapacity: 410, status: "within-limit", deltaFromMinimum: 10, headroom: 10 },
  ]);
  assert.equal(capacity.roomAreaM2, 600);
  assert.equal(capacity.usableRoomAreaM2, 498.664);
  assert.ok(capacity.excludedObjectIds.includes("obj-restricted-production"));
  assert.equal(capacity.placedCapacity, 400);
  assert.equal(capacity.densityCapacity, 623);
  assert.equal(capacity.venueMaximum, 450);
  assert.equal(capacity.nonAttendeeLoad, 38);
  assert.equal(capacity.operationalLoad, 438);
  assert.equal(capacity.effectiveCapacity, 400);
  assert.deepEqual(capacity.explanations, []);
  assert.deepEqual(capacity.changeDeltas.map(({ changeId, effectiveCapacityDelta }) => ({ changeId, effectiveCapacityDelta })), [
    { changeId: "chg-seat-center-shift", effectiveCapacityDelta: 0 },
    { changeId: "chg-center-aisle-width", effectiveCapacityDelta: 0 },
    { changeId: "chg-av-desk-east", effectiveCapacityDelta: 0 },
    { changeId: "chg-refreshment-buffer", effectiveCapacityDelta: 0 },
  ]);
  assert.equal(validation.checks.find((item) => item.id === "check-capacity").evaluator, "occupancy_capacity");

  assert.equal(circulation.connected, true);
  assert.deepEqual(circulation.blockedRouteObjectIds, []);
  assert.deepEqual(circulation.exitApproachZones, [
    { id: "exit-approach-obj-fire-exit-east", exitObjectId: "obj-fire-exit-east", depthM: 1.2, points: [{ x: 29.9, y: 8.5 }, { x: 29.9, y: 11.5 }, { x: 28.7, y: 11.5 }, { x: 28.7, y: 8.5 }], status: "clear", obstructingObjectIds: [] },
    { id: "exit-approach-obj-fire-exit-north", exitObjectId: "obj-fire-exit-north", depthM: 1.2, points: [{ x: 10, y: 19 }, { x: 12, y: 19 }, { x: 12, y: 17.8 }, { x: 10, y: 17.8 }], status: "clear", obstructingObjectIds: [] },
  ]);
  assert.deepEqual(circulation.criticalRouteEdges.find((edge) => edge.routeObjectId === "obj-route-seating-west").impactedOccupiedObjectIds, ["obj-seating-west"]);
  assert.deepEqual(circulation.bottleneckLoads[0], { id: "bottleneck-exit-obj-fire-exit-north", kind: "exit", objectId: "obj-fire-exit-north", demand: 219, ratedDemand: 250, loadIndex: 87.6 });
  assert.equal(circulation.bottleneckWidthM, 1.829);
  assert.equal(circulation.peakCongestionIndex, 66.5);
  assert.deepEqual(circulation.shortestExitPaths, [
    { occupiedObjectId: "obj-seating-east", exitObjectId: "obj-fire-exit-north", distanceM: 10.198, routeObjectIds: ["obj-route-north-link-b"] },
    { occupiedObjectId: "obj-seating-west", exitObjectId: "obj-fire-exit-east", distanceM: 15.9, routeObjectIds: ["obj-route-exit-east", "obj-route-seating-west"] },
  ]);
  assert.deepEqual(circulation.phaseProfiles.map(({ phase, demand, congestionIndex }) => ({ phase, demand, congestionIndex })), [
    { phase: "ingress", demand: 300, congestionIndex: 45.6 },
    { phase: "interval", demand: 140, congestionIndex: 21.3 },
    { phase: "egress", demand: 438, congestionIndex: 66.5 },
    { phase: "emergency", demand: 438, congestionIndex: 66.5 },
  ]);
  assert.equal(validation.checks.find((item) => item.id === "check-circulation").evaluator, "circulation_graph");
});

test("exit approach zones reject exact placement obstructions", () => {
  const plan = structuredClone(summitForwardPlan);
  plan.objects.push({ id: "obj-exit-cart", kind: "table", label: "Exit cart", layer: "furniture", elevationM: 0.9, locked: false, footprint: { kind: "circle", center: { x: 29.2, y: 10 }, radius: 0.25 } });
  const validation = createVenuePlanner(plan).execute({ type: "validate_layout" });
  const circulation = validation.spatialEvidence.circulation;
  const check = validation.checks.find((item) => item.id === "check-circulation");

  assert.deepEqual(circulation.obstructedExitObjectIds, ["obj-fire-exit-east"]);
  assert.deepEqual(circulation.exitApproachZones[0].obstructingObjectIds, ["obj-exit-cart"]);
  assert.equal(circulation.exitApproachZones[0].status, "blocked");
  assert.equal(check.status, "fail");
  assert.deepEqual(check.evidence.affectedObjectIds, ["obj-exit-cart", "obj-fire-exit-east"]);
});

test("moving one obstruction changes paths and produces a deterministic congestion delta", () => {
  const plan = structuredClone(summitForwardPlan);
  for (const object of plan.objects.filter((item) => ["accessible_route", "aisle", "corridor", "service_lane"].includes(item.kind))) object.footprint.width = 1.829;
  plan.objects.push({ id: "obj-egress-cart", kind: "table", label: "Egress cart", layer: "furniture", elevationM: 0.9, locked: false, circulation: { blocksPath: true }, footprint: { kind: "circle", center: { x: 25, y: 5 }, radius: 0.6 } });
  plan.proposal.changes = [{ id: "chg-block-egress", number: 1, title: "Move egress cart", shortTitle: "Cart moved", metrics: [["Congestion", "+933.5"]], targetObjectIds: ["obj-egress-cart"], spatialEffects: [{ operation: "update_footprint", objectId: "obj-egress-cart", footprint: { center: { x: 22, y: 10 } } }], effects: {} }];
  const planner = createVenuePlanner(plan);
  const first = planner.execute({ type: "validate_layout" });
  const second = planner.execute({ type: "validate_layout" });
  const circulation = first.spatialEvidence.circulation;
  const delta = circulation.changeDeltas[0];

  assert.deepEqual(second, first);
  assert.deepEqual(circulation.blockedRouteObjectIds, ["obj-route-exit-east"]);
  assert.deepEqual(circulation.blockingObjectIds, ["obj-egress-cart"]);
  assert.deepEqual(circulation.disconnectedOccupiedObjectIds, []);
  assert.deepEqual(delta.changedPathObjectIds, ["obj-seating-west"]);
  assert.deepEqual(delta.newlyDisconnectedOccupiedObjectIds, []);
  assert.equal(delta.peakCongestionIndexDelta, 933.5);
  const audit = JSON.parse(planner.execute({ type: "export_plan", format: "audit" }).content);
  assert.equal(audit.validation.validationId, first.validationId);
  assert.deepEqual(audit.validation.spatialEvidence.circulation.blockingObjectIds, ["obj-egress-cart"]);
});

test("capacity validates sections and zones independently of the Plan total", () => {
  const sectionPlan = structuredClone(summitForwardPlan);
  sectionPlan.objects.find((object) => object.id === "obj-seating-west").capacity = 221;
  sectionPlan.objects.find((object) => object.id === "obj-seating-east").capacity = 179;
  const sectionValidation = createVenuePlanner(sectionPlan).execute({ type: "validate_layout" });
  const sectionCheck = sectionValidation.checks.find((item) => item.id === "check-capacity");

  assert.equal(sectionValidation.spatialEvidence.capacity.placedCapacity, 400);
  assert.equal(sectionValidation.spatialEvidence.capacity.zoneCapacities[0].status, "within-limit");
  assert.deepEqual(sectionCheck.evidence.details.sectionViolations.map(({ objectId, status }) => ({ objectId, status })), [
    { objectId: "obj-seating-east", status: "under-target" },
    { objectId: "obj-seating-west", status: "over-capacity" },
  ]);
  assert.equal(sectionCheck.status, "fail");

  const zonePlan = structuredClone(summitForwardPlan);
  zonePlan.objects.find((object) => object.id === "obj-seating-west").capacity = 211;
  const zoneValidation = createVenuePlanner(zonePlan).execute({ type: "validate_layout" });
  const zoneCheck = zoneValidation.checks.find((item) => item.id === "check-capacity");

  assert.equal(zoneValidation.spatialEvidence.capacity.sectionCapacities.every((section) => section.status === "within-limit"), true);
  assert.equal(zoneValidation.spatialEvidence.capacity.zoneCapacities[0].status, "over-capacity");
  assert.deepEqual(zoneCheck.evidence.details.zoneViolations.map((zone) => zone.zoneId), ["zone-keynote-floor"]);
  assert.equal(zoneCheck.status, "fail");
});

test("capacity evidence explains scope failures and attributes deltas to each Proposal Change", () => {
  const plan = structuredClone(summitForwardPlan);
  plan.proposal.changes.push({
    id: "chg-west-capacity-ten",
    number: 5,
    title: "Add ten west seats",
    shortTitle: "West +10",
    metrics: [["Capacity", "+10"]],
    targetObjectIds: ["obj-seating-west"],
    spatialEffects: [{ operation: "update_metadata", objectId: "obj-seating-west", values: { capacity: 210 } }],
    effects: {},
  });
  const validation = createVenuePlanner(plan).execute({ type: "validate_layout" });
  const delta = validation.spatialEvidence.capacity.changeDeltas.find((item) => item.changeId === "chg-west-capacity-ten");

  assert.equal(delta.placedCapacityDelta, 10);
  assert.equal(delta.effectiveCapacityDelta, 10);
  assert.deepEqual(delta.sectionDeltas, [{ objectId: "obj-seating-west", before: 200, after: 210, delta: 10 }]);
  assert.deepEqual(delta.zoneDeltas, [{ zoneId: "zone-keynote-floor", before: 400, after: 410, delta: 10 }]);

  const broken = structuredClone(summitForwardPlan);
  broken.objects.find((object) => object.id === "obj-seating-west").capacity = 221;
  broken.objects.find((object) => object.id === "obj-seating-east").capacity = 179;
  const explanations = createVenuePlanner(broken).execute({ type: "validate_layout" }).spatialEvidence.capacity.explanations;
  assert.deepEqual(explanations.map(({ code, scopeId, delta: difference }) => ({ code, scopeId, delta: difference })), [
    { code: "SECTION_UNDER_TARGET", scopeId: "obj-seating-east", delta: -1 },
    { code: "SECTION_OVER_CAPACITY", scopeId: "obj-seating-west", delta: 1 },
  ]);
});

test("sightline Validation stores deterministic sampled-seat ray evidence", () => {
  const planner = createPlanner();
  const proposed = planner.execute({ type: "validate_layout" });
  const sightlines = proposed.spatialEvidence.sightlines;
  const check = proposed.checks.find((item) => item.id === "check-sightlines");

  assert.equal(check.evaluator, "sightline_raycast");
  assert.equal(check.status, "pass");
  assert.equal(sightlines.focalPointId, "focal-stage-center");
  assert.equal(sightlines.sampledSeatIds.length, 16);
  assert.deepEqual(sightlines.blockedSampleIds, []);
  assert.equal(sightlines.coverageRatio, 1);
  assert.equal(sightlines.maximumViewingDistanceM, 20.15);
  assert.equal(sightlines.rays.length, 16);
  assert.ok(sightlines.rays.every((ray) => ray.status === "clear"));
  assert.match(sightlines.evidenceFingerprint, /^sightlines-[0-9a-f]{8}$/);

  planner.execute({ type: "revert_change", changeId: "chg-av-desk-east", actor: "human", idempotencyKey: "revert-sightline-move" });
  const acceptedGeometry = planner.execute({ type: "validate_layout" }).spatialEvidence.sightlines;
  assert.deepEqual(acceptedGeometry.blockedSampleIds, ["seat-east-05", "seat-east-06", "seat-east-07", "seat-east-08"]);
  assert.equal(acceptedGeometry.coverageRatio, 0.75);
});

test("moving one obstruction changes only affected sightline checks and preserves ray IDs", () => {
  const planAt = (center) => {
    const initial = structuredClone(summitForwardPlan);
    initial.objects.push({ id: "obj-movable-screen", kind: "column", label: "Movable screen", layer: "production", elevationM: 2, locked: false, sightline: { opacity: 1, heightM: 2 }, footprint: { kind: "circle", center, radius: 0.7 } });
    return createVenuePlanner(initial).execute({ type: "validate_layout" });
  };
  const accepted = planAt({ x: 20, y: 12 });
  const proposed = planAt({ x: 11, y: 12 });
  const proposedSections = proposed.spatialEvidence.sightlines.sectionSummaries;

  assert.deepEqual(proposed.spatialEvidence.sightlines.rays.map((ray) => ray.id), accepted.spatialEvidence.sightlines.rays.map((ray) => ray.id));
  assert.equal(accepted.checks.find((check) => check.id === "check-sightlines").status, "pass");
  assert.equal(proposed.checks.find((check) => check.id === "check-sightlines").status, "fail");
  assert.equal(proposed.checks.find((check) => check.id === "check-accessible-seating-sightlines").status, "fail");
  assert.equal(proposed.checks.find((check) => check.id === "check-production-readiness").status, "fail");
  assert.equal(proposedSections.find((section) => section.objectId === "obj-seating-east").blockedRatio, 0.5);
  const sightlineCheckIds = new Set(["check-sightlines", "check-accessible-seating-sightlines", "check-production-readiness"]);
  assert.deepEqual(proposed.checks.filter((check) => !sightlineCheckIds.has(check.id)).map((check) => [check.id, check.status, check.actual]), accepted.checks.filter((check) => !sightlineCheckIds.has(check.id)).map((check) => [check.id, check.status, check.actual]));
});

test("validation emits typed, ordered evidence with a deterministic input fingerprint", () => {
  const planner = createPlanner();
  const first = planner.execute({ type: "validate_layout" });
  const second = planner.execute({ type: "validate_layout" });

  assert.deepEqual(second, first);
  assert.equal(first.engineVersion, "2.7.0");
  assert.match(first.validationId, /^validation-[0-9a-f]{8}$/);
  assert.match(first.inputFingerprint, /^input-[0-9a-f]{8}$/);
  assert.equal(first.evaluatedPlanVersion, "3.2");
  assert.equal(first.evaluatedProposalId, "proposal-32-a");
  assert.equal(first.blockingIssues, 0);
  assert.deepEqual(first.checks.map((check) => check.category), [
    "accessibility",
    "accessibility",
    "accessibility",
    "accessibility",
    "accessibility",
    "accessibility",
    "capacity",
    "catering",
    "circulation",
    "emergency",
    "production",
    "protection",
    "sightlines",
  ]);
  assert.equal(first.checks[0].evaluator, "accessible_route_graph");
  assert.equal(first.checks[0].evidence.metric, "minimumClearWidthM");
  assert.equal(first.checks[0].evidence.details.graphFingerprint, first.spatialEvidence.accessibility.graphFingerprint);
  assert.match(first.candidateGeometryFingerprint, /^geom-[0-9a-f]{8}$/);
});

test("legacy constraint parameters migrate into the typed registry", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.plan.constraints = {
    accessibleRouteMinWidthFt: 6,
    attendeeCapacityMin: 400,
    sightlineCoverageMin: 0.85,
    protectedObjectIds: ["obj-stage-west", "obj-fire-exit-east", "obj-column-southwest"],
  };

  planner.execute({ type: "restore_snapshot", snapshot });

  assert.deepEqual(planner.getSnapshot().plan.constraints.map((constraint) => constraint.id), [
    "constraint-protected-objects",
    "constraint-accessible-route",
    "constraint-turning-clearance",
    "constraint-accessible-seating",
    "constraint-accessible-seating-sightlines",
    "constraint-door-clearance",
    "constraint-temporary-ramps",
    "constraint-capacity",
    "constraint-sightlines",
    "constraint-production-readiness",
    "constraint-catering-readiness",
    "constraint-emergency-readiness",
    "constraint-peak-congestion",
  ]);
  assert.equal(planner.execute({ type: "validate_layout" }).status, "pass");
});

test("preference warnings remain non-blocking and disabled constraints are not applicable", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.plan.constraints.push(
    {
      id: "constraint-preferred-capacity",
      checkId: "check-preferred-capacity",
      evaluator: "minimum_metric",
      label: "Preferred capacity",
      category: "capacity",
      severity: "warning",
      scope: { kind: "plan" },
      parameters: { metric: "attendeeCapacity", comparator: "gte", threshold: 450, unit: "attendees" },
      remediation: "Add optional seating if operationally useful.",
    },
    {
      id: "constraint-disabled-buffer",
      checkId: "check-disabled-buffer",
      evaluator: "minimum_metric",
      label: "Optional queue buffer",
      category: "circulation",
      severity: "warning",
      enabled: false,
      scope: { kind: "plan" },
      parameters: { metric: "queueBufferSqFt", comparator: "gte", threshold: 200, unit: "sq ft" },
      remediation: "Expand the optional queue buffer.",
    },
  );

  planner.execute({ type: "restore_snapshot", snapshot });
  const validation = planner.execute({ type: "validate_layout" });

  assert.equal(validation.status, "pass");
  assert.equal(validation.blockingIssues, 0);
  assert.equal(validation.unresolvedIssues, 1);
  assert.equal(validation.checks.find((check) => check.id === "check-preferred-capacity").status, "warning");
  assert.equal(validation.checks.find((check) => check.id === "check-disabled-buffer").status, "not-applicable");
});

test("Approval requires an auditable human Warning Waiver for every waivable warning", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.plan.constraints.push({
    id: "constraint-preferred-capacity",
    checkId: "check-preferred-capacity",
    evaluator: "minimum_metric",
    label: "Preferred capacity",
    category: "capacity",
    severity: "warning",
    waivable: true,
    scope: { kind: "plan" },
    parameters: { metric: "attendeeCapacity", comparator: "gte", threshold: 450, unit: "attendees" },
    remediation: "Add optional seating if operationally useful.",
  });
  planner.execute({ type: "restore_snapshot", snapshot });
  const proposal = planner.getSnapshot().proposal;
  const before = planner.execute({ type: "validate_layout" });

  assert.equal(before.unwaivedWarnings, 1);
  assert.equal(before.waivedWarnings, 0);
  assert.throws(() => planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "approve-without-waiver" }), /warning waiver/i);
  assert.throws(() => planner.execute({ type: "waive_warning", constraintId: "constraint-preferred-capacity", reasonCode: "operational-acceptance", actor: "agent", actorId: "agent-1", idempotencyKey: "agent-waiver" }), /human/i);

  const waived = planner.execute({
    type: "waive_warning",
    constraintId: "constraint-preferred-capacity",
    reasonCode: "operational-acceptance",
    actor: "human",
    actorId: "operator-17",
    source: "studio",
    sessionId: "session-waiver-test",
    idempotencyKey: "waive-capacity-001",
  });
  const after = planner.execute({ type: "validate_layout" });
  const waiver = planner.getSnapshot().proposal.waivers[0];

  assert.equal(waived.status, "waived");
  assert.equal(waived.waiverId, waiver.id);
  assert.equal(waiver.constraintId, "constraint-preferred-capacity");
  assert.equal(waiver.authorId, "operator-17");
  assert.equal(waiver.reasonCode, "operational-acceptance");
  assert.equal(waiver.proposalId, proposal.id);
  assert.equal(waiver.baseVersion, proposal.baseVersion);
  assert.equal(waiver.validationInputFingerprint, before.inputFingerprint);
  assert.match(waiver.createdAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(after.unwaivedWarnings, 0);
  assert.equal(after.waivedWarnings, 1);
  assert.equal(after.unresolvedIssues, 0);
  assert.equal(after.checks.find((check) => check.constraintId === waiver.constraintId).waiver.id, waiver.id);
  assert.equal(planner.execute({ type: "get_change_log" }).at(-1).type, "constraint.warning_waived");

  const approved = planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "approve-with-waiver" });
  assert.equal(approved.status, "approved");
  assert.equal(approved.validation.waivedWarnings, 1);
  assert.equal(planner.getSnapshot().plan.waivers[0].acceptedPlanVersion, approved.planVersion);
  assert.equal(planner.execute({ type: "validate_layout" }).waivedWarnings, 1);
  assert.equal(JSON.parse(planner.execute({ type: "export_plan", format: "audit" }).content).proposalBranches[0].proposal.waivers[0].id, waiver.id);
});

test("Warning Waivers expire when Proposal input changes", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.plan.constraints.push({ id: "constraint-preferred-capacity", checkId: "check-preferred-capacity", evaluator: "minimum_metric", label: "Preferred capacity", category: "capacity", severity: "warning", waivable: true, scope: { kind: "plan" }, parameters: { metric: "attendeeCapacity", comparator: "gte", threshold: 450, unit: "attendees" }, remediation: "Add optional seating." });
  planner.execute({ type: "restore_snapshot", snapshot });
  planner.execute({ type: "waive_warning", constraintId: "constraint-preferred-capacity", reasonCode: "temporary-condition", actor: "human", actorId: "operator-17", idempotencyKey: "waive-before-adjustment" });

  planner.execute({ type: "request_adjustment", instruction: "Increase rear clearance", actor: "human", idempotencyKey: "adjust-after-waiver" });
  const validation = planner.execute({ type: "validate_layout" });

  assert.deepEqual(planner.getSnapshot().proposal.waivers, []);
  assert.equal(validation.unwaivedWarnings, 1);
  assert.equal(validation.waivedWarnings, 0);
});

test("approval rejects stale callers before committing a proposal", () => {
  const planner = createPlanner();
  const proposal = planner.getSnapshot().proposal;

  assert.throws(() => planner.execute({
    type: "approve_proposal",
    proposalId: proposal.id,
    baseVersion: "3.1",
    actor: "human",
    idempotencyKey: "approve-stale-001",
  }), /version conflict/i);
  assert.equal(planner.getSnapshot().plan.version, "3.2");
});

test("approval creates a new Plan Version and an auditable ledger entry", () => {
  const planner = createPlanner();
  const proposal = planner.getSnapshot().proposal;
  const result = planner.execute({
    type: "approve_proposal",
    proposalId: proposal.id,
    baseVersion: proposal.baseVersion,
    actor: "human",
    idempotencyKey: "approve-proposal-001",
  });

  assert.equal(result.planVersion, "3.3");
  assert.equal(result.status, "approved");
  assert.equal(planner.getSnapshot().plan.metrics.sightlineCoverage, 1);
  assert.deepEqual(planner.getSnapshot().plan.objects.find((object) => object.id === "obj-av-desk").footprint.center, { x: 27, y: 3 });
  assert.equal(planner.execute({ type: "get_change_log" }).at(-1).type, "proposal.approved");
});

test("Activity Ledger entries are versioned and hash chained", () => {
  const planner = createPlanner();
  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "approve-ledger-chain", source: "studio", sessionId: "session-ledger-test" });
  const ledger = planner.execute({ type: "get_change_log" });

  assert.equal(ledger[0].schemaVersion, 1);
  assert.equal(ledger[0].previousHash, "genesis");
  assert.match(ledger[0].hash, /^ledger-[0-9a-f]{8}$/);
  assert.equal(ledger[1].previousHash, ledger[0].hash);
  assert.match(ledger[1].hash, /^ledger-[0-9a-f]{8}$/);
  assert.equal(ledger[1].actorId, "human");
  assert.equal(ledger[1].actorType, "human");
  assert.equal(ledger[1].source, "studio");
  assert.equal(ledger[1].sessionId, "session-ledger-test");
  assert.equal(ledger[1].details.fromVersion, "3.2");
  assert.equal(ledger[1].details.toVersion, "3.3");
  assert.equal(ledger[1].details.branchId, "branch-balanced");
  assert.equal(ledger[1].details.changeIds.length, 4);
  assert.match(ledger[1].details.validationId, /^validation-[0-9a-f]{8}$/);
  assert.equal(ledger[1].details.acceptedPlan.version, "3.3");
  assert.match(ledger[1].details.planFingerprint, /^plan-[0-9a-f]{8}$/);
});

test("snapshot restore rejects a tampered Activity Ledger", () => {
  const planner = createPlanner();
  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "approve-before-tamper" });
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.ledger[1].details.toVersion = "99.9";

  assert.throws(
    () => createPlanner().execute({ type: "restore_snapshot", snapshot }),
    /Activity Ledger integrity failed/i,
  );
});

test("replay reconstructs accepted Plan history and verifies the current fingerprint", () => {
  const planner = createPlanner();
  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "approve-before-replay" });
  planner.execute({ type: "undo", actor: "human", idempotencyKey: "undo-before-replay" });
  planner.execute({ type: "redo", actor: "human", idempotencyKey: "redo-before-replay" });

  const replay = planner.execute({ type: "replay_history" });

  assert.equal(replay.status, "pass");
  assert.deepEqual(replay.transitions.map((transition) => transition.planVersion), ["3.2", "3.3", "3.2", "3.3"]);
  assert.equal(replay.currentPlanVersion, "3.3");
  assert.equal(replay.replayedFingerprint, replay.currentFingerprint);
  assert.match(replay.ledgerHeadHash, /^ledger-[0-9a-f]{8}$/);
  assert.deepEqual(replay.lockedObjectViolations, []);
});

test("replay rejects accepted transitions that move or delete a Locked Object", () => {
  const planner = createPlanner();
  const before = structuredClone(planner.getSnapshot().plan);
  const after = structuredClone(before);
  after.version = "3.3";
  after.objects.find((object) => object.id === "obj-stage-west").footprint.center.x = 5;
  const ledger = sealActivityLedger([
    createActivityEntry(1, "plan.opened", "human", { acceptedPlan: before, planFingerprint: fingerprintPlan(before) }),
    createActivityEntry(2, "proposal.approved", "human", { acceptedPlan: after, planFingerprint: fingerprintPlan(after) }),
  ]);

  const replay = replayActivityLedger(ledger, after);

  assert.equal(replay.status, "fail");
  assert.deepEqual(replay.lockedObjectViolations.map((violation) => [violation.objectId, violation.type, violation.lockTypes]), [["obj-stage-west", "locked-property-changed", ["position"]]]);
});

test("undo and redo restore accepted versions without erasing the ledger", () => {
  const planner = createPlanner();
  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "approve-before-history" });

  const undo = planner.execute({ type: "undo", actor: "human", idempotencyKey: "undo-history-001" });
  const redo = planner.execute({ type: "redo", actor: "human", idempotencyKey: "redo-history-001" });
  assert.equal(undo.status, "undone");
  assert.equal(undo.planVersion, "3.2");
  assert.equal(redo.status, "redone");
  assert.equal(redo.planVersion, "3.3");
  assert.deepEqual(planner.execute({ type: "get_change_log" }).slice(-2).map((entry) => entry.type), ["plan.undone", "plan.redone"]);
});

test("adjustment requests revise the proposal and preserve the accepted plan", () => {
  const planner = createPlanner();
  const before = planner.execute({ type: "inspect_layout" });
  const result = planner.execute({ type: "request_adjustment", instruction: "AV desk +2 ft east", actor: "human", idempotencyKey: "adjust-av-desk" });
  const after = planner.execute({ type: "inspect_layout" });

  assert.equal(after.planVersion, before.planVersion);
  assert.equal(result.revision, 2);
  assert.equal(planner.getSnapshot().proposal.adjustment, "AV desk +2 ft east");
  assert.equal(planner.execute({ type: "get_change_log" }).at(-1).type, "proposal.adjustment_requested");
});

test("individual proposal changes can be reverted without mutating the accepted plan", () => {
  const planner = createPlanner();
  const before = planner.execute({ type: "inspect_layout" });
  const result = planner.execute({ type: "revert_change", changeId: "chg-refreshment-buffer", actor: "human", idempotencyKey: "revert-refreshment" });
  const after = planner.execute({ type: "inspect_layout" });

  assert.equal(result.status, "reverted");
  assert.equal(result.changedItems, 3);
  assert.equal(after.planVersion, before.planVersion);
  assert.equal(after.proposal.changedItems, 3);
  assert.equal(planner.execute({ type: "get_change_log" }).at(-1).type, "proposal.change_reverted");
});

test("proposal branches keep independent change sets and validation results", () => {
  const planner = createPlanner();
  const created = planner.execute({ type: "create_branch", name: "Access first", strategy: "access-first", actor: "human", idempotencyKey: "branch-access-first" });
  const branches = planner.execute({ type: "list_branches" });

  assert.equal(created.branchId, "branch-2");
  assert.equal(branches.length, 2);
  assert.equal(branches.find((branch) => branch.id === "branch-balanced").validationStatus, "pass");
  assert.equal(branches.find((branch) => branch.id === "branch-2").changedItems, 3);
  assert.equal(branches.find((branch) => branch.id === "branch-2").unresolvedIssues, 2);

  planner.execute({ type: "switch_branch", branchId: "branch-balanced", actor: "human", idempotencyKey: "switch-balanced" });
  assert.equal(planner.getSnapshot().proposal.changes.length, 4);
  assert.equal(planner.execute({ type: "get_change_log" }).at(-1).type, "proposal.branch_selected");
});

test("proposal branch comparison returns deterministic spatial and Constraint deltas without changing state", () => {
  const planner = createPlanner();
  const access = planner.execute({ type: "create_branch", name: "Access", strategy: "access-first", actor: "human", idempotencyKey: "compare-create-access" });
  planner.execute({ type: "switch_branch", branchId: "branch-balanced", actor: "human", idempotencyKey: "compare-switch-balanced" });
  const sightlines = planner.execute({ type: "create_branch", name: "Sightlines", strategy: "sightlines-first", actor: "human", idempotencyKey: "compare-create-sightlines" });
  const before = structuredClone(planner.getSnapshot());

  const comparison = planner.execute({ type: "compare_branches", leftBranchId: access.branchId, rightBranchId: sightlines.branchId });
  const retry = planner.execute({ type: "compare_branches", leftBranchId: access.branchId, rightBranchId: sightlines.branchId });

  assert.match(comparison.comparisonId, /^comparison-[0-9a-f]{8}$/);
  assert.deepEqual(retry, comparison);
  assert.equal(comparison.left.strategy, "access-first");
  assert.equal(comparison.right.strategy, "sightlines-first");
  assert.deepEqual(comparison.changeSet.leftOnlyIds, ["chg-center-aisle-width"]);
  assert.deepEqual(comparison.changeSet.rightOnlyIds, ["chg-av-desk-east"]);
  assert.deepEqual(comparison.objectDeltas.movedObjectIds, ["obj-av-desk"]);
  assert.deepEqual(comparison.objectDeltas.resizedObjectIds, ["obj-route-exit-east", "obj-route-main", "obj-route-seating-east", "obj-route-seating-west", "obj-route-stage"]);
  assert.equal(comparison.metricDeltas.find((metric) => metric.metric === "minimumClearWidthM").delta, -0.61);
  assert.equal(comparison.metricDeltas.find((metric) => metric.metric === "sightlineCoverage").delta, 0.25);
  assert.equal(comparison.constraintDeltas.find((constraint) => constraint.constraintId === "constraint-accessible-route").outcome, "regressed");
  assert.equal(comparison.constraintDeltas.find((constraint) => constraint.constraintId === "constraint-sightlines").outcome, "improved");
  assert.deepEqual(new Set(comparison.metricDeltas.map((metric) => metric.metric)), new Set(["effectiveCapacity", "minimumClearWidthM", "peakCongestionIndex", "worstBottleneckLoad", "longestEgressPathM", "sightlineCoverage", "blockedSightlineSamples", "cateringServiceCapacity", "cateringQueueRisk", "cateringCirculationImpact", "accessibleServicePoints", "riskScore", "estimatedCost"]));
  assert.equal(comparison.overlay.acceptedObjects.length, planner.getSnapshot().plan.objects.length);
  assert.deepEqual(comparison.acceptedDeltas.left.resizedObjectIds, ["obj-route-exit-east", "obj-route-main", "obj-route-seating-east", "obj-route-seating-west", "obj-route-stage"]);
  assert.deepEqual(planner.getSnapshot(), before);
});

test("branch notes, prior-revision duplication, archive, restore, and human decision remain auditable", () => {
  const planner = createPlanner();
  planner.execute({ type: "update_branch_metadata", branchId: "branch-balanced", name: "Balanced ops", notes: "Keep service clearance", actor: "human", idempotencyKey: "branch-meta-1" });
  const firstProposalId = planner.getSnapshot().proposal.id;
  planner.execute({ type: "request_adjustment", instruction: "Retain west access", actor: "human", idempotencyKey: "branch-revision-1" });
  const duplicate = planner.execute({ type: "duplicate_branch", branchId: "branch-balanced", proposalId: firstProposalId, name: "Balanced prior", actor: "human", idempotencyKey: "branch-duplicate-prior" });
  assert.equal(planner.getSnapshot().branches.find((branch) => branch.id === duplicate.branchId).source.proposalId, firstProposalId);

  planner.execute({ type: "archive_branch", branchId: duplicate.branchId, actor: "human", idempotencyKey: "branch-archive-1" });
  assert.equal(planner.execute({ type: "list_branches" }).find((branch) => branch.id === duplicate.branchId).archived, true);
  planner.execute({ type: "restore_branch", branchId: duplicate.branchId, actor: "human", idempotencyKey: "branch-restore-1" });
  const decision = planner.execute({ type: "record_branch_decision", chosenBranchId: "branch-balanced", rejectedBranchIds: [duplicate.branchId], comparisonId: "comparison-review", note: "Lower risk", actor: "human", actorId: "operator-1", idempotencyKey: "branch-decision-1" });
  assert.match(decision.decisionId, /^decision-[0-9a-f]{8}$/);
  assert.equal(planner.execute({ type: "list_branches" }).find((branch) => branch.id === duplicate.branchId).decisionStatus, "rejected");
  assert.equal(planner.execute({ type: "get_change_log" }).at(-1).type, "proposal.branch_decision_recorded");
});

test("proposal branch comparison rejects unknown stable Branch IDs", () => {
  const planner = createPlanner();
  assert.throws(
    () => planner.execute({ type: "compare_branches", leftBranchId: "branch-balanced", rightBranchId: "branch-missing" }),
    (error) => error.code === "BRANCH_NOT_FOUND" && error.details.branchId === "branch-missing",
  );
});

test("access-first and sightlines-first branches preserve their geometry priorities", () => {
  const planner = createPlanner();
  planner.execute({ type: "create_branch", name: "Access", strategy: "access-first", actor: "human", idempotencyKey: "branch-access-evidence" });
  const accessValidation = planner.execute({ type: "validate_layout" });

  assert.equal(accessValidation.checks.find((check) => check.id === "check-accessible-route").status, "pass");
  assert.equal(accessValidation.checks.find((check) => check.id === "check-sightlines").status, "fail");
  assert.equal(accessValidation.spatialEvidence.accessibility.minimumClearWidthM, 1.829);
  assert.equal(accessValidation.spatialEvidence.sightlines.coverageRatio, 0.75);

  planner.execute({ type: "switch_branch", branchId: "branch-balanced", actor: "human", idempotencyKey: "strategy-switch-balanced" });
  planner.execute({ type: "create_branch", name: "Sightlines", strategy: "sightlines-first", actor: "human", idempotencyKey: "branch-sightline-evidence" });
  const sightlineValidation = planner.execute({ type: "validate_layout" });

  assert.equal(sightlineValidation.checks.find((check) => check.id === "check-accessible-route").status, "fail");
  assert.equal(sightlineValidation.checks.find((check) => check.id === "check-sightlines").status, "pass");
  assert.equal(sightlineValidation.spatialEvidence.accessibility.minimumClearWidthM, 1.219);
  assert.equal(sightlineValidation.spatialEvidence.sightlines.coverageRatio, 1);
});

test("circulation-first branches retain aisle and queue Changes", () => {
  const planner = createPlanner();
  const created = planner.execute({ type: "create_branch", name: "Circulation", strategy: "circulation-first", actor: "human", idempotencyKey: "branch-circulation-evidence" });
  const branch = planner.getSnapshot().branches.find((item) => item.id === created.branchId);

  assert.equal(created.strategy, "circulation-first");
  assert.deepEqual(branch.proposal.changes.map((change) => change.id), ["chg-center-aisle-width", "chg-refreshment-buffer"]);
  assert.equal(planner.execute({ type: "validate_layout" }).spatialEvidence.circulation.changeDeltas.find((delta) => delta.changeId === "chg-center-aisle-width").peakCongestionIndexDelta, -33.3);
});

test("geometry overlap conflicts expose safe structured choices", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.plan.objects.push(
    { id: "obj-solid-a", kind: "table", label: "Solid A", layer: "furniture", elevationM: 0, locked: false, placement: { collisionMode: "solid" }, footprint: { kind: "rectangle", center: { x: 5, y: 2 }, width: 1, depth: 1, rotationDegrees: 0 } },
    { id: "obj-solid-b", kind: "table", label: "Solid B", layer: "furniture", elevationM: 0, locked: false, placement: { collisionMode: "solid" }, footprint: { kind: "rectangle", center: { x: 8, y: 2 }, width: 1, depth: 1, rotationDegrees: 0 } },
  );
  snapshot.proposal.changes.push({ id: "chg-solid-overlap", number: 5, title: "Move solid A", shortTitle: "Solid A moved", metrics: [], targetObjectIds: ["obj-solid-a"], spatialEffects: [{ operation: "update_footprint", objectId: "obj-solid-a", footprint: { center: { x: 8, y: 2 } } }], effects: {} });
  snapshot.branches[0].proposal = structuredClone(snapshot.proposal);
  planner.execute({ type: "restore_snapshot", snapshot });

  const detected = planner.execute({ type: "detect_conflicts", branchId: "branch-balanced" });
  const overlap = detected.conflicts.find((conflict) => conflict.type === "geometry-overlap");

  assert.deepEqual(overlap.objectIds, ["obj-solid-a", "obj-solid-b"]);
  assert.deepEqual(overlap.changeIds, ["chg-solid-overlap"]);
  assert.deepEqual(overlap.resolutionOptions, ["keep-plan", "manual-resolution"]);
  assert.equal(overlap.blocking, true);
  assert.throws(() => planner.execute({ type: "resolve_conflict", branchId: "branch-balanced", conflictId: overlap.id, outcome: "keep-proposal", actor: "human", actorId: "operator-1", idempotencyKey: "unsafe-overlap-resolution" }), (error) => error.code === "CONFLICT_RESOLUTION_INVALID");
});

test("manual conflict resolution transforms only the affected Change ID", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.plan.objects.push(
    { id: "obj-manual-a", kind: "table", label: "Manual A", layer: "furniture", elevationM: 0, locked: false, placement: { collisionMode: "solid" }, footprint: { kind: "rectangle", center: { x: 5, y: 2 }, width: 1, depth: 1, rotationDegrees: 0 } },
    { id: "obj-manual-b", kind: "table", label: "Manual B", layer: "furniture", elevationM: 0, locked: false, placement: { collisionMode: "solid" }, footprint: { kind: "rectangle", center: { x: 8, y: 2 }, width: 1, depth: 1, rotationDegrees: 0 } },
  );
  snapshot.proposal.changes.push({ id: "chg-manual-overlap", number: 5, title: "Move manual A", shortTitle: "Manual A moved", metrics: [], targetObjectIds: ["obj-manual-a"], spatialEffects: [{ operation: "update_footprint", objectId: "obj-manual-a", footprint: { center: { x: 8, y: 2 } } }], effects: {} });
  snapshot.branches[0].proposal = structuredClone(snapshot.proposal);
  planner.execute({ type: "restore_snapshot", snapshot });
  const beforeIds = planner.getSnapshot().proposal.changes.map((change) => change.id);
  const overlap = planner.execute({ type: "detect_conflicts", branchId: "branch-balanced" }).conflicts.find((conflict) => conflict.type === "geometry-overlap");
  const result = planner.execute({
    type: "resolve_conflict",
    branchId: "branch-balanced",
    conflictId: overlap.id,
    outcome: "manual-resolution",
    manualChange: { title: "Move manual A clear", shortTitle: "Manual A clear", targetObjectIds: ["obj-manual-a"], spatialEffects: [{ operation: "update_footprint", objectId: "obj-manual-a", footprint: { center: { x: 6.5, y: 2 } } }] },
    actor: "human",
    actorId: "operator-1",
    idempotencyKey: "manual-overlap-resolution",
  });
  const proposal = planner.getSnapshot().proposal;

  assert.match(result.transformedChangeId, /^chg-[0-9a-f]{8}$/);
  assert.equal(proposal.changes.some((change) => change.id === "chg-manual-overlap"), false);
  assert.deepEqual(proposal.changes.filter((change) => beforeIds.includes(change.id)).map((change) => change.id), beforeIds.filter((id) => id !== "chg-manual-overlap"));
  assert.deepEqual(proposal.changes.find((change) => change.id === result.transformedChangeId).lineage.transformedFromChangeIds, ["chg-manual-overlap"]);
  assert.equal(result.validationStatus, "pass");
  assert.equal(result.remainingConflicts, 0);
  assert.equal(planner.execute({ type: "get_change_log" }).at(-1).type, "proposal.conflict_resolved");
});

test("keep-proposal resolves a safe same-object edit without changing its Change ID", () => {
  const planner = createPlanner();
  const alternative = planner.execute({ type: "create_branch", name: "Keep proposal", strategy: "balanced", actor: "human", idempotencyKey: "create-keep-proposal" });
  planner.execute({ type: "switch_branch", branchId: "branch-balanced", actor: "human", idempotencyKey: "switch-before-keep-proposal" });
  const primary = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: primary.id, baseVersion: primary.baseVersion, actor: "human", idempotencyKey: "approve-before-keep-proposal" });
  const snapshot = structuredClone(planner.getSnapshot());
  const branch = snapshot.branches.find((item) => item.id === alternative.branchId);
  const avChange = branch.proposal.changes.find((change) => change.id === "chg-av-desk-east");
  avChange.spatialEffects[0].footprint.center = { x: 26, y: 3.5 };
  planner.execute({ type: "restore_snapshot", snapshot });
  const sameObject = planner.execute({ type: "detect_conflicts", branchId: alternative.branchId }).conflicts.find((conflict) => conflict.type === "same-object-edit");

  const result = planner.execute({ type: "resolve_conflict", branchId: alternative.branchId, conflictId: sameObject.id, outcome: "keep-proposal", actor: "human", actorId: "operator-1", idempotencyKey: "keep-proposal-resolution" });
  const resolved = planner.getSnapshot().branches.find((item) => item.id === alternative.branchId).proposal;

  assert.equal(result.outcome, "keep-proposal");
  assert.equal(resolved.baseVersion, "3.3");
  assert.equal(resolved.changes.some((change) => change.id === "chg-av-desk-east"), true);
  assert.equal(result.transformedChangeId, null);
  assert.equal(result.remainingConflicts, 0);
});

test("a stale Proposal Branch rebases onto the latest Plan Version without changing stable Change IDs", () => {
  const planner = createPlanner();
  const alternative = planner.execute({ type: "create_branch", name: "Alternative", strategy: "balanced", actor: "human", idempotencyKey: "create-alternative-before-approval" });
  const changeIdsBefore = planner.getSnapshot().proposal.changes.map((change) => change.id);
  planner.execute({ type: "switch_branch", branchId: "branch-balanced", actor: "human", idempotencyKey: "switch-primary-before-approval" });
  const primary = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: primary.id, baseVersion: primary.baseVersion, actor: "human", idempotencyKey: "approve-primary-before-rebase" });

  const conflicts = planner.execute({ type: "detect_conflicts", branchId: alternative.branchId });
  const rebased = planner.execute({ type: "rebase_proposal", branchId: alternative.branchId, actor: "human", idempotencyKey: "rebase-alternative-001" });
  const branch = planner.getSnapshot().branches.find((item) => item.id === alternative.branchId);

  assert.equal(conflicts.status, "conflicts");
  assert.equal(conflicts.stale, true);
  assert.equal(conflicts.conflicts[0].type, "stale-base");
  assert.deepEqual(conflicts.conflicts[0].resolutionOptions, ["rebase"]);
  assert.equal(rebased.status, "rebased");
  assert.equal(rebased.fromVersion, "3.2");
  assert.equal(rebased.toVersion, "3.3");
  assert.equal(rebased.validationStatus, "pass");
  assert.match(rebased.validationId, /^validation-[0-9a-f]{8}$/);
  assert.deepEqual(branch.proposal.changes.map((change) => change.id), changeIdsBefore);
  assert.equal(branch.proposal.baseVersion, "3.3");
  assert.equal(planner.execute({ type: "detect_conflicts", branchId: alternative.branchId }).status, "clear");
  assert.equal(planner.execute({ type: "get_change_log" }).some((entry) => entry.type === "proposal.rebased"), true);
  planner.execute({ type: "switch_branch", branchId: alternative.branchId, actor: "human", idempotencyKey: "switch-rebased-alternative" });
  const rebasedProposal = planner.getSnapshot().proposal;
  const approved = planner.execute({ type: "approve_proposal", proposalId: rebasedProposal.id, baseVersion: rebasedProposal.baseVersion, actor: "human", idempotencyKey: "approve-rebased-alternative" });
  assert.equal(approved.planVersion, "3.4");
});

test("planner restore rejects locked mutations and rebase blocks deleted dependencies", () => {
  const planner = createPlanner();
  const snapshot = structuredClone(planner.getSnapshot());
  snapshot.proposal.changes[0].targetObjectIds = ["obj-missing"];
  snapshot.branches[0].proposal = structuredClone(snapshot.proposal);
  planner.execute({ type: "restore_snapshot", snapshot });

  const conflicts = planner.execute({ type: "detect_conflicts", branchId: "branch-balanced" });

  assert.deepEqual(conflicts.conflicts.map((conflict) => conflict.type), ["deleted-dependency"]);
  assert.throws(
    () => planner.execute({ type: "rebase_proposal", branchId: "branch-balanced", actor: "human", idempotencyKey: "rebase-blocked-001" }),
    (error) => error.code === "REBASE_CONFLICT",
  );
  assert.equal(planner.getSnapshot().receipts.some((receipt) => receipt.idempotencyKey === "rebase-blocked-001"), false);

  const lockedPlanner = createPlanner();
  const lockedSnapshot = structuredClone(lockedPlanner.getSnapshot());
  lockedSnapshot.proposal.changes[0].targetObjectIds = ["obj-stage-west"];
  lockedSnapshot.branches[0].proposal = structuredClone(lockedSnapshot.proposal);
  assert.throws(() => lockedPlanner.execute({ type: "restore_snapshot", snapshot: lockedSnapshot }), (error) => error.code === "LOCK_CONFLICT" && error.details.objectIds[0] === "obj-stage-west");
});

test("legacy snapshots are normalized with a primary proposal branch", () => {
  const planner = createPlanner();
  const legacy = structuredClone(planner.getSnapshot());
  delete legacy.branches;
  delete legacy.activeBranchId;

  planner.execute({ type: "restore_snapshot", snapshot: legacy });
  const branches = planner.execute({ type: "list_branches" });
  assert.equal(branches.length, 1);
  assert.equal(branches[0].id, "branch-balanced");
  assert.equal(branches[0].active, true);
});

test("exports are read-only and include validation and ledger data", () => {
  const planner = createPlanner();
  const beforeCount = planner.getSnapshot().ledger.length;
  const json = planner.execute({ type: "export_plan", format: "json" });
  const text = planner.execute({ type: "export_plan", format: "text" });
  const audit = planner.execute({ type: "export_plan", format: "audit" });

  assert.equal(json.format, "json");
  assert.equal(JSON.parse(json.content).validation.status, "pass");
  assert.match(JSON.parse(json.content).validation.spatialEvidence.accessibility.graphFingerprint, /^graph-/);
  assert.deepEqual(JSON.parse(json.content).commandReceipts, []);
  assert.equal(JSON.parse(json.content).historyReplay.status, "pass");
  assert.equal(audit.format, "audit");
  assert.equal(JSON.parse(audit.content).manifest.format, "venuemind-audit");
  assert.equal(JSON.parse(audit.content).replay.status, "pass");
  assert.match(text.content, /Plan v3\.2/);
  assert.match(text.content, /Access graph graph-/);
  assert.match(text.content, /Sightline evidence sightlines-/);
  assert.equal(planner.getSnapshot().ledger.length, beforeCount);
});

test("a fresh planner reconstructs every accepted Plan Version from the audit package", () => {
  const planner = createPlanner();
  let proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "audit-version-33" });
  planner.execute({ type: "preview_revision", goal: "Audit version 3.4", actor: "agent", idempotencyKey: "audit-preview-34" });
  proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "audit-version-34" });
  const audit = JSON.parse(planner.execute({ type: "export_plan", format: "audit" }).content);
  const acceptedEntries = audit.activityLedger.filter((entry) => entry.details.acceptedPlan);
  const versions = [...new Map(acceptedEntries.map((entry) => [entry.details.acceptedPlan.version, entry])).values()];

  assert.deepEqual(versions.map((entry) => entry.details.acceptedPlan.version), ["3.2", "3.3", "3.4"]);
  for (const entry of versions) {
    const fresh = createVenuePlanner({
      ...structuredClone(entry.details.acceptedPlan),
      brief: structuredClone(summitForwardPlan.brief),
      proposal: { id: `proposal-reconstruct-${entry.details.acceptedPlan.version.replace(".", "-")}`, revision: 1, goal: "", changes: [] },
    });
    assert.equal(fingerprintPlan(fresh.getSnapshot().plan), entry.details.planFingerprint);
    assert.equal(audit.replay.transitions.some((transition) => transition.planVersion === entry.details.acceptedPlan.version && transition.planFingerprint === entry.details.planFingerprint), true);
  }
});
