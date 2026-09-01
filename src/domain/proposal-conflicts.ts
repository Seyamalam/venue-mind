import { stableFingerprint } from "./activity-ledger.ts";
import { validateConstraints } from "./constraint-engine.ts";
import { venueError } from "./errors.ts";
import { detectLockConflicts } from "./locks.ts";
import { footprintsIntersect, materializeSpatialPlan } from "./spatial-analysis.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));

const acceptedPlanForVersion: any = (ledger: any, version: any) => ledger
  .slice()
  .reverse()
  .find((entry: any) => entry.details?.acceptedPlan?.version === version)
  ?.details.acceptedPlan ?? null;

const conflict: any = (branchId: any, type: any, suffix: any, fields: any) => ({
  id: `conflict-${branchId}-${type}-${suffix}`,
  type,
  ...fields,
});

const conflictPriority: any = { "stale-base": 0, "deleted-dependency": 1, "lock-conflict": 2, "same-object-edit": 3, "geometry-overlap": 4, "constraint-regression": 5 };
const collisionObject: any = (object: any) => object?.placement?.collisionMode === "solid" || object?.restriction?.blocksPlacement === true;

const spatialEffectsFor: any = (change: any, objectId: any) => (change.spatialEffects ?? []).filter((effect: any) => effect.objectId === objectId);
const spatialEffectsAlreadyApplied: any = (change: any, objectId: any, currentObject: any) => {
  const effects: any = spatialEffectsFor(change, objectId);
  if (effects.length === 0) return false;
  return effects.every((effect: any) => {
    if (effect.operation === "update_footprint") return Object.entries(effect.footprint).every(([key, value]: any) => stableFingerprint("value", currentObject.footprint[key]) === stableFingerprint("value", value));
    if (effect.operation === "update_metadata") return Object.entries(effect.values).every(([key, value]: any) => stableFingerprint("value", currentObject[key]) === stableFingerprint("value", value));
    return false;
  });
};

export function detectProposalConflicts(state: any, branchId: any = state.activeBranchId) {
  const branch: any = state.branches.find((item: any) => item.id === branchId);
  if (!branch) throw venueError("BRANCH_NOT_FOUND", { branchId: branchId ?? state.activeBranchId });
  const proposal: any = branch.proposal;
  const conflicts: any[] = [];
  const stale: any = proposal.baseVersion !== state.plan.version;
  if (stale) {
    conflicts.push(conflict(branchId, "stale-base", proposal.baseVersion.replaceAll(".", "-"), {
      severity: "error",
      baseVersion: proposal.baseVersion,
      currentVersion: state.plan.version,
      changeIds: proposal.changes.map((change: any) => change.id),
      objectIds: [],
      resolutionOptions: ["rebase"],
    }));
  }

  const currentObjects: any = new Map(state.plan.objects.map((object: any) => [object.id, object]));
  const basePlan: any = acceptedPlanForVersion(state.ledger, proposal.baseVersion);
  const baseObjects: any = new Map((basePlan?.objects ?? []).map((object: any) => [object.id, object]));
  const lockConflicts: any = detectLockConflicts(state.plan, proposal.changes, state.projectLocks ?? []);
  const lockConflictsByChangeAndObject: any = new Map(lockConflicts.map((item: any) => [`${item.changeId}:${item.objectId}`, item]));

  for (const change of proposal.changes) {
    const addedObjectIds: any = new Set((change.spatialEffects ?? []).filter((effect: any) => effect.operation === "add_object").map((effect: any) => effect.object?.id));
    for (const objectId of [...new Set(change.targetObjectIds ?? [])].sort()) {
      const currentObject: any = currentObjects.get(objectId);
      if (!currentObject && !addedObjectIds.has(objectId)) {
        conflicts.push(conflict(branchId, "deleted-dependency", `${change.id}-${objectId}`, {
          severity: "error",
          baseVersion: proposal.baseVersion,
          currentVersion: state.plan.version,
          changeIds: [change.id],
          objectIds: [objectId],
          resolutionOptions: ["drop-change", "manual-resolution"],
        }));
        continue;
      }
      const lockConflict: any = lockConflictsByChangeAndObject.get(`${change.id}:${objectId}`);
      if (lockConflict) {
        conflicts.push(conflict(branchId, "lock-conflict", `${change.id}-${objectId}`, {
          severity: "error",
          baseVersion: proposal.baseVersion,
          currentVersion: state.plan.version,
          changeIds: [change.id],
          objectIds: [objectId],
          lockId: lockConflict.lockId,
          lockType: lockConflict.lockType,
          lockSource: lockConflict.source,
          resolutionOptions: ["drop-change"],
        }));
      }
      const baseObject: any = baseObjects.get(objectId);
      if (stale && baseObject && stableFingerprint("object", baseObject) !== stableFingerprint("object", currentObject) && !spatialEffectsAlreadyApplied(change, objectId, currentObject)) {
        conflicts.push(conflict(branchId, "same-object-edit", `${change.id}-${objectId}`, {
          severity: "error",
          baseVersion: proposal.baseVersion,
          currentVersion: state.plan.version,
          changeIds: [change.id],
          objectIds: [objectId],
          resolutionOptions: ["keep-proposal", "keep-plan", "manual-resolution"],
        }));
      }
    }
  }

  const comparisonPlan: any = state.plan;
  const overlapChanges: any = proposal.changes.map((change: any) => ({ ...change, spatialEffects: (change.spatialEffects ?? []).filter((effect: any) => ["add_object", "update_room_boundary"].includes(effect.operation) || currentObjects.has(effect.objectId)) }));
  const candidatePlan: any = materializeSpatialPlan(state.plan, overlapChanges, { projectLocks: state.projectLocks ?? [], allowLockConflicts: true });
  const comparisonObjects: any = new Map(comparisonPlan.objects.map((object: any) => [object.id, object]));
  const candidateObjects: any = new Map(candidatePlan.objects.map((object: any) => [object.id, object]));
  const overlapKeys: any = new Set();
  for (const change of overlapChanges) {
    for (const objectId of [...new Set((change.spatialEffects ?? []).map((effect: any) => effect.objectId))].sort()) {
      const candidateObject: any = candidateObjects.get(objectId);
      if (!collisionObject(candidateObject)) continue;
      for (const other of candidatePlan.objects.filter((object: any) => object.id !== objectId && collisionObject(object)).sort((left: any, right: any) => left.id.localeCompare(right.id))) {
        const key: any = [objectId, other.id].sort().join(":");
        if (overlapKeys.has(key)) continue;
        const previousObject: any = comparisonObjects.get(objectId);
        const previousOther: any = comparisonObjects.get(other.id);
        const overlapIsNew: any = !previousObject || !previousOther || !footprintsIntersect(previousObject.footprint, previousOther.footprint);
        if (overlapIsNew && footprintsIntersect(candidateObject.footprint, other.footprint)) {
          overlapKeys.add(key);
          conflicts.push(conflict(branchId, "geometry-overlap", `${change.id}-${key.replace(":", "-")}`, {
            severity: "error",
            baseVersion: proposal.baseVersion,
            currentVersion: state.plan.version,
            changeIds: [change.id],
            objectIds: key.split(":"),
            resolutionOptions: ["keep-plan", "manual-resolution"],
          }));
        }
      }
    }
  }

  const validation: any = validateConstraints({ ...state, proposal: { ...proposal, changes: overlapChanges } });
  for (const check of validation.checks.filter((item: any) => item.status === "fail" && item.id !== "check-locked-objects")) {
    conflicts.push(conflict(branchId, "constraint-regression", check.constraintId, {
      severity: check.severity,
      baseVersion: proposal.baseVersion,
      currentVersion: state.plan.version,
      changeIds: proposal.changes.map((change: any) => change.id),
      objectIds: check.evidence.affectedObjectIds,
      constraintId: check.constraintId,
      validationId: validation.validationId,
      resolutionOptions: ["revise-proposal", "drop-change"],
    }));
  }

  conflicts.sort((left: any, right: any) => (conflictPriority[left.type] ?? 99) - (conflictPriority[right.type] ?? 99) || left.id.localeCompare(right.id));
  return {
    status: conflicts.length === 0 ? "clear" : "conflicts",
    branchId,
    proposalId: proposal.id,
    stale,
    baseVersion: proposal.baseVersion,
    currentVersion: state.plan.version,
    conflicts: clone(conflicts.map((item: any) => ({ ...item, blocking: item.severity === "error" && item.type !== "stale-base" }))),
    blockingConflicts: conflicts.filter((item: any) => item.severity === "error" && item.type !== "stale-base").length,
    validation,
  };
}
