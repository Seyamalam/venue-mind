import { stableFingerprint } from "./activity-ledger.ts";
import { validateConstraints } from "./constraint-engine.ts";
import { venueError } from "./errors.ts";
import { detectLockConflicts } from "./locks.ts";
import { footprintsIntersect, materializeSpatialPlan } from "./spatial-analysis.ts";
import type { ActivityLedgerEntry } from "./activity-ledger.ts";
import type { VenueObject, VenuePlan } from "./geometry.ts";
import type { PlanningChange } from "./planning-effects.ts";
import type { PlannerState } from "./venue-planner.ts";

const clone = <T>(value: T): T => structuredClone(value);

const acceptedPlanForVersion = (ledger: readonly ActivityLedgerEntry[], version: string): VenuePlan | null =>
  ledger
    .slice()
    .reverse()
    .find((entry) => entry.details?.acceptedPlan?.version === version)?.details.acceptedPlan ?? null;

type ConflictType =
  | "stale-base"
  | "deleted-dependency"
  | "lock-conflict"
  | "same-object-edit"
  | "geometry-overlap"
  | "constraint-regression";
interface ConflictFields {
  severity: "error" | "warning";
  baseVersion: string;
  currentVersion: string;
  changeIds: string[];
  objectIds: string[];
  resolutionOptions: string[];
  lockId?: string;
  lockType?: string;
  lockSource?: string;
  constraintId?: string;
  validationId?: string;
}
interface ProposalConflict extends ConflictFields {
  id: string;
  type: ConflictType;
}

const conflict = (branchId: string, type: ConflictType, suffix: string, fields: ConflictFields): ProposalConflict => ({
  id: `conflict-${branchId}-${type}-${suffix}`,
  type,
  ...fields,
});

const conflictPriority: Record<ConflictType, number> = {
  "stale-base": 0,
  "deleted-dependency": 1,
  "lock-conflict": 2,
  "same-object-edit": 3,
  "geometry-overlap": 4,
  "constraint-regression": 5,
};
const collisionObject = (object: VenueObject | undefined): boolean =>
  object?.placement?.collisionMode === "solid" || object?.restriction?.blocksPlacement === true;

const spatialEffectsFor = (change: PlanningChange, objectId: string) =>
  (change.spatialEffects ?? []).filter((effect) => effect.objectId === objectId);
const spatialEffectsAlreadyApplied = (
  change: PlanningChange,
  objectId: string,
  currentObject: VenueObject | undefined,
): boolean => {
  if (!currentObject) return false;
  const effects = spatialEffectsFor(change, objectId);
  if (effects.length === 0) return false;
  return effects.every((effect) => {
    if (effect.operation === "update_footprint" && effect.footprint)
      return Object.entries(effect.footprint).every(
        ([key, value]) =>
          stableFingerprint("value", Reflect.get(currentObject.footprint, key)) === stableFingerprint("value", value),
      );
    if (effect.operation === "update_metadata" && effect.values)
      return Object.entries(effect.values).every(
        ([key, value]) =>
          stableFingerprint("value", Reflect.get(currentObject, key)) === stableFingerprint("value", value),
      );
    return false;
  });
};

export function detectProposalConflicts(state: PlannerState, branchId = state.activeBranchId) {
  const branch = state.branches.find((item) => item.id === branchId);
  if (!branch) throw venueError("BRANCH_NOT_FOUND", { branchId: branchId ?? state.activeBranchId });
  const proposal = branch.proposal;
  const conflicts: ProposalConflict[] = [];
  const stale = proposal.baseVersion !== state.plan.version;
  if (stale) {
    conflicts.push(
      conflict(branchId, "stale-base", proposal.baseVersion.replaceAll(".", "-"), {
        severity: "error",
        baseVersion: proposal.baseVersion,
        currentVersion: state.plan.version,
        changeIds: proposal.changes.map((change) => change.id),
        objectIds: [],
        resolutionOptions: ["rebase"],
      }),
    );
  }

  const currentObjects = new Map(state.plan.objects.map((object) => [object.id, object]));
  const basePlan = acceptedPlanForVersion(state.ledger, proposal.baseVersion);
  const baseObjects = new Map((basePlan?.objects ?? []).map((object) => [object.id, object]));
  const lockConflicts = detectLockConflicts(state.plan, proposal.changes, state.projectLocks ?? []);
  const lockConflictsByChangeAndObject = new Map(
    lockConflicts.map((item) => [`${item.changeId}:${item.objectId}`, item]),
  );

  for (const change of proposal.changes) {
    const addedObjectIds = new Set(
      (change.spatialEffects ?? [])
        .filter((effect) => effect.operation === "add_object" && typeof effect.object?.id === "string")
        .map((effect) => effect.object?.id)
        .filter((id): id is string => typeof id === "string"),
    );
    for (const objectId of [...new Set(change.targetObjectIds ?? [])].sort()) {
      const currentObject = currentObjects.get(objectId);
      if (!currentObject && !addedObjectIds.has(objectId)) {
        conflicts.push(
          conflict(branchId, "deleted-dependency", `${change.id}-${objectId}`, {
            severity: "error",
            baseVersion: proposal.baseVersion,
            currentVersion: state.plan.version,
            changeIds: [change.id],
            objectIds: [objectId],
            resolutionOptions: ["drop-change", "manual-resolution"],
          }),
        );
        continue;
      }
      const lockConflict = lockConflictsByChangeAndObject.get(`${change.id}:${objectId}`);
      if (lockConflict) {
        conflicts.push(
          conflict(branchId, "lock-conflict", `${change.id}-${objectId}`, {
            severity: "error",
            baseVersion: proposal.baseVersion,
            currentVersion: state.plan.version,
            changeIds: [change.id],
            objectIds: [objectId],
            lockId: lockConflict.lockId,
            lockType: lockConflict.lockType,
            lockSource: lockConflict.source,
            resolutionOptions: ["drop-change"],
          }),
        );
      }
      const baseObject = baseObjects.get(objectId);
      if (
        stale &&
        baseObject &&
        stableFingerprint("object", baseObject) !== stableFingerprint("object", currentObject) &&
        !spatialEffectsAlreadyApplied(change, objectId, currentObject)
      ) {
        conflicts.push(
          conflict(branchId, "same-object-edit", `${change.id}-${objectId}`, {
            severity: "error",
            baseVersion: proposal.baseVersion,
            currentVersion: state.plan.version,
            changeIds: [change.id],
            objectIds: [objectId],
            resolutionOptions: ["keep-proposal", "keep-plan", "manual-resolution"],
          }),
        );
      }
    }
  }

  const comparisonPlan = state.plan;
  const overlapChanges = proposal.changes.map((change) => ({
    ...change,
    spatialEffects: (change.spatialEffects ?? []).filter(
      (effect) =>
        ["add_object", "update_room_boundary"].includes(effect.operation) ||
        (typeof effect.objectId === "string" && currentObjects.has(effect.objectId)),
    ),
  }));
  const candidatePlan = materializeSpatialPlan(state.plan, overlapChanges, {
    projectLocks: state.projectLocks ?? [],
    allowLockConflicts: true,
  });
  const comparisonObjects = new Map(comparisonPlan.objects.map((object) => [object.id, object]));
  const candidateObjects = new Map(candidatePlan.objects.map((object) => [object.id, object]));
  const overlapKeys = new Set();
  for (const change of overlapChanges) {
    for (const objectId of [
      ...new Set(
        (change.spatialEffects ?? [])
          .map((effect) => effect.objectId)
          .filter((id): id is string => typeof id === "string"),
      ),
    ].sort()) {
      const candidateObject = candidateObjects.get(objectId);
      if (!collisionObject(candidateObject)) continue;
      for (const other of candidatePlan.objects
        .filter((object) => object.id !== objectId && collisionObject(object))
        .sort((left, right) => left.id.localeCompare(right.id))) {
        const key = [objectId, other.id].sort().join(":");
        if (overlapKeys.has(key)) continue;
        const previousObject = comparisonObjects.get(objectId);
        const previousOther = comparisonObjects.get(other.id);
        const overlapIsNew =
          !previousObject || !previousOther || !footprintsIntersect(previousObject.footprint, previousOther.footprint);
        if (overlapIsNew && candidateObject && footprintsIntersect(candidateObject.footprint, other.footprint)) {
          overlapKeys.add(key);
          conflicts.push(
            conflict(branchId, "geometry-overlap", `${change.id}-${key.replace(":", "-")}`, {
              severity: "error",
              baseVersion: proposal.baseVersion,
              currentVersion: state.plan.version,
              changeIds: [change.id],
              objectIds: key.split(":"),
              resolutionOptions: ["keep-plan", "manual-resolution"],
            }),
          );
        }
      }
    }
  }

  const validation = validateConstraints({ ...state, proposal: { ...proposal, changes: overlapChanges } });
  for (const check of validation.checks.filter(
    (item) => item.status === "fail" && item.id !== "check-locked-objects",
  )) {
    conflicts.push(
      conflict(branchId, "constraint-regression", check.constraintId, {
        severity: check.severity,
        baseVersion: proposal.baseVersion,
        currentVersion: state.plan.version,
        changeIds: proposal.changes.map((change) => change.id),
        objectIds: check.evidence.affectedObjectIds,
        constraintId: check.constraintId,
        validationId: validation.validationId,
        resolutionOptions: ["revise-proposal", "drop-change"],
      }),
    );
  }

  conflicts.sort(
    (left, right) =>
      (conflictPriority[left.type] ?? 99) - (conflictPriority[right.type] ?? 99) || left.id.localeCompare(right.id),
  );
  return {
    status: conflicts.length === 0 ? "clear" : "conflicts",
    branchId,
    proposalId: proposal.id,
    stale,
    baseVersion: proposal.baseVersion,
    currentVersion: state.plan.version,
    conflicts: clone(
      conflicts.map((item) => ({ ...item, blocking: item.severity === "error" && item.type !== "stale-base" })),
    ),
    blockingConflicts: conflicts.filter((item) => item.severity === "error" && item.type !== "stale-base").length,
    validation,
  };
}
