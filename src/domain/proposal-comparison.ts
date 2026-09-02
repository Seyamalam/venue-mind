import { stableFingerprint } from "./activity-ledger.ts";
import { materializeSpatialPlan } from "./spatial-analysis.ts";
import { venueError } from "./errors.ts";
import { venueTemplateCatalog } from "./venue-templates.ts";
import { validateConstraints } from "./constraint-engine.ts";
import type { ConstraintState } from "./constraint-engine.ts";
import type { Footprint, Point, VenueObject, VenuePlan, VenueProposal } from "./geometry.ts";
import type { ObjectLock } from "./locks.ts";

const clone = <T>(value: T): T => structuredClone(value);
const round = (value: number, precision = 3): number => Number(value.toFixed(precision));
const pointChanged = (left: Point | undefined, right: Point | undefined): boolean =>
  left?.x !== right?.x || left?.y !== right?.y;

const footprintDelta = (left: Footprint | undefined, right: Footprint | undefined) => {
  if (!left || !right || left.kind !== right.kind) return { moved: false, rotated: false, resized: true };
  const moved =
    pointChanged("center" in left ? left.center : undefined, "center" in right ? right.center : undefined) ||
    pointChanged("start" in left ? left.start : undefined, "start" in right ? right.start : undefined) ||
    pointChanged("end" in left ? left.end : undefined, "end" in right ? right.end : undefined) ||
    (left.kind === "polygon" &&
      right.kind === "polygon" &&
      stableFingerprint("points", left.points) !== stableFingerprint("points", right.points));
  const rotated =
    ("rotationDegrees" in left ? left.rotationDegrees : undefined) !==
    ("rotationDegrees" in right ? right.rotationDegrees : undefined);
  const resized =
    ("width" in left ? left.width : undefined) !== ("width" in right ? right.width : undefined) ||
    ("depth" in left ? left.depth : undefined) !== ("depth" in right ? right.depth : undefined) ||
    ("radius" in left ? left.radius : undefined) !== ("radius" in right ? right.radius : undefined);
  return { moved, rotated, resized };
};

const withoutFootprint = ({ footprint: _footprint, ...object }: VenueObject): Omit<VenueObject, "footprint"> => object;

const compareObjects = (leftPlan: VenuePlan, rightPlan: VenuePlan) => {
  const leftObjects = new Map(leftPlan.objects.map((object) => [object.id, object]));
  const rightObjects = new Map(rightPlan.objects.map((object) => [object.id, object]));
  const allIds = [...new Set([...leftObjects.keys(), ...rightObjects.keys()])].sort();
  const deltas: Record<
    | "addedObjectIds"
    | "removedObjectIds"
    | "movedObjectIds"
    | "rotatedObjectIds"
    | "resizedObjectIds"
    | "metadataObjectIds",
    string[]
  > = {
    addedObjectIds: [],
    removedObjectIds: [],
    movedObjectIds: [],
    rotatedObjectIds: [],
    resizedObjectIds: [],
    metadataObjectIds: [],
  };

  for (const objectId of allIds) {
    const left = leftObjects.get(objectId);
    const right = rightObjects.get(objectId);
    if (!left) {
      deltas.addedObjectIds.push(objectId);
      continue;
    }
    if (!right) {
      deltas.removedObjectIds.push(objectId);
      continue;
    }
    const footprint = footprintDelta(left.footprint, right.footprint);
    if (footprint.moved) deltas.movedObjectIds.push(objectId);
    if (footprint.rotated) deltas.rotatedObjectIds.push(objectId);
    if (footprint.resized) deltas.resizedObjectIds.push(objectId);
    if (stableFingerprint("object", withoutFootprint(left)) !== stableFingerprint("object", withoutFootprint(right)))
      deltas.metadataObjectIds.push(objectId);
  }
  return deltas;
};

const inventoryById = new Map(venueTemplateCatalog.inventoryTemplates.map((template) => [template.id, template]));

type Validation = ReturnType<typeof validateConstraints>;
type ValidationCheck = Validation["checks"][number];
interface BranchLike {
  id: string;
  name: string;
  notes?: string;
  strategy: string;
  proposal: VenueProposal;
}
type ComparisonState = ConstraintState & { branches: BranchLike[]; projectLocks?: ObjectLock[] };

const estimatedCost = (plan: VenuePlan): number =>
  round(
    plan.objects.reduce((total, object) => {
      const template = object.templateRef ? inventoryById.get(object.templateRef.templateId) : undefined;
      const amount = object.specification?.cost?.amount ?? template?.cost?.amount ?? 0;
      return total + amount * (object.inventoryCount ?? 1);
    }, 0),
    2,
  );

const riskScore = (validation: Validation): number =>
  validation.checks.reduce(
    (total, check) => total + (check.status === "fail" ? 10 : check.status === "warning" ? 3 : 0),
    0,
  ) +
  validation.cateringEvidence.summary.inventoryShortages * 2;
const worstBottleneck = (validation: Validation): number =>
  Math.max(0, ...validation.spatialEvidence.circulation.bottleneckLoads.map((load) => load.loadIndex));
const longestEgressPath = (validation: Validation): number =>
  Math.max(0, ...validation.spatialEvidence.circulation.shortestExitPaths.map((path) => path.distanceM));

const metricRows = (
  leftValidation: Validation,
  rightValidation: Validation,
  leftPlan: VenuePlan,
  rightPlan: VenuePlan,
) => {
  const leftEvidence = leftValidation.spatialEvidence;
  const rightEvidence = rightValidation.spatialEvidence;
  return (
    [
      [
        "effectiveCapacity",
        "Capacity",
        "attendees",
        leftEvidence.capacity.effectiveCapacity,
        rightEvidence.capacity.effectiveCapacity,
      ],
      [
        "minimumClearWidthM",
        "Access width",
        "m",
        leftEvidence.accessibility.minimumClearWidthM,
        rightEvidence.accessibility.minimumClearWidthM,
      ],
      [
        "peakCongestionIndex",
        "Congestion",
        "index",
        leftEvidence.circulation.peakCongestionIndex,
        rightEvidence.circulation.peakCongestionIndex,
      ],
      [
        "worstBottleneckLoad",
        "Worst bottleneck",
        "index",
        worstBottleneck(leftValidation),
        worstBottleneck(rightValidation),
      ],
      [
        "longestEgressPathM",
        "Egress distance",
        "m",
        longestEgressPath(leftValidation),
        longestEgressPath(rightValidation),
      ],
      [
        "sightlineCoverage",
        "Sightlines",
        "ratio",
        leftEvidence.sightlines.coverageRatio,
        rightEvidence.sightlines.coverageRatio,
      ],
      [
        "blockedSightlineSamples",
        "Blocked samples",
        "samples",
        leftEvidence.sightlines.blockedSampleIds.length,
        rightEvidence.sightlines.blockedSampleIds.length,
      ],
      [
        "cateringServiceCapacity",
        "Service capacity",
        "persons",
        leftValidation.cateringEvidence.summary.minimumPhaseServiceCapacityPersons,
        rightValidation.cateringEvidence.summary.minimumPhaseServiceCapacityPersons,
      ],
      [
        "cateringQueueRisk",
        "Service queue risk",
        "checks",
        leftValidation.cateringEvidence.summary.queueRiskCount,
        rightValidation.cateringEvidence.summary.queueRiskCount,
      ],
      [
        "cateringCirculationImpact",
        "Service circulation",
        "crossings",
        leftValidation.cateringEvidence.summary.circulationConflictCount,
        rightValidation.cateringEvidence.summary.circulationConflictCount,
      ],
      [
        "accessibleServicePoints",
        "Accessible service",
        "points",
        leftValidation.cateringEvidence.summary.accessibleServicePoints,
        rightValidation.cateringEvidence.summary.accessibleServicePoints,
      ],
      ["riskScore", "Risk", "points", riskScore(leftValidation), riskScore(rightValidation)],
      ["estimatedCost", "Cost", "USD", estimatedCost(leftPlan), estimatedCost(rightPlan)],
    ] satisfies Array<[string, string, string, number, number]>
  ).map(([metric, label, unit, left, right]) => ({ metric, label, unit, left, right, delta: round(right - left) }));
};

const statusRank: Record<ValidationCheck["status"], number> = { fail: 0, warning: 1, "not-applicable": 1, pass: 2 };

const constraintRows = (leftValidation: Validation, rightValidation: Validation) => {
  const leftChecks = new Map(leftValidation.checks.map((check) => [check.constraintId, check]));
  const rightChecks = new Map(rightValidation.checks.map((check) => [check.constraintId, check]));
  return [...new Set([...leftChecks.keys(), ...rightChecks.keys()])].sort().map((constraintId) => {
    const left = leftChecks.get(constraintId);
    const right = rightChecks.get(constraintId);
    const delta = statusRank[right?.status ?? "not-applicable"] - statusRank[left?.status ?? "not-applicable"];
    return {
      constraintId,
      label: right?.label ?? left?.label ?? constraintId,
      category: right?.category ?? left?.category ?? "unknown",
      leftStatus: left?.status ?? "not-applicable",
      rightStatus: right?.status ?? "not-applicable",
      leftActual: left?.actual ?? null,
      rightActual: right?.actual ?? null,
      unit: right?.unit ?? left?.unit ?? null,
      outcome: delta > 0 ? "improved" : delta < 0 ? "regressed" : "unchanged",
    };
  });
};

const branchSummary = (branch: BranchLike, validation: Validation, candidatePlan: VenuePlan) => ({
  branchId: branch.id,
  name: branch.name,
  notes: branch.notes ?? "",
  strategy: branch.strategy,
  proposalId: branch.proposal.id,
  baseVersion: branch.proposal.baseVersion,
  changedItems: branch.proposal.changes.length,
  changeIds: branch.proposal.changes.map((change) => change.id).sort(),
  validationId: validation.validationId,
  validationStatus: validation.status,
  blockingIssues: validation.blockingIssues,
  unresolvedIssues: validation.unresolvedIssues,
  geometryFingerprint: candidatePlan.spatial.fingerprint,
});

export function compareProposalBranches<State extends ComparisonState>(
  state: State,
  leftBranchId: string,
  rightBranchId: string,
  validate: (value: State & { proposal: VenueProposal }) => Validation = validateConstraints,
) {
  const leftBranch = state.branches.find((branch) => branch.id === leftBranchId);
  const rightBranch = state.branches.find((branch) => branch.id === rightBranchId);
  if (!leftBranch) throw venueError("BRANCH_NOT_FOUND", { branchId: leftBranchId });
  if (!rightBranch) throw venueError("BRANCH_NOT_FOUND", { branchId: rightBranchId });

  const leftValidation = validate({ ...state, proposal: leftBranch.proposal });
  const rightValidation = validate({ ...state, proposal: rightBranch.proposal });
  const leftPlan = materializeSpatialPlan(state.plan, leftBranch.proposal.changes, {
    projectLocks: state.projectLocks ?? [],
    allowLockConflicts: true,
  });
  const rightPlan = materializeSpatialPlan(state.plan, rightBranch.proposal.changes, {
    projectLocks: state.projectLocks ?? [],
    allowLockConflicts: true,
  });
  const leftChangeIds = new Set(leftBranch.proposal.changes.map((change) => change.id));
  const rightChangeIds = new Set(rightBranch.proposal.changes.map((change) => change.id));
  const changeSet = {
    sharedIds: [...leftChangeIds].filter((id) => rightChangeIds.has(id)).sort(),
    leftOnlyIds: [...leftChangeIds].filter((id) => !rightChangeIds.has(id)).sort(),
    rightOnlyIds: [...rightChangeIds].filter((id) => !leftChangeIds.has(id)).sort(),
  };
  const metricDeltas = metricRows(leftValidation, rightValidation, leftPlan, rightPlan);
  const constraintDeltas = constraintRows(leftValidation, rightValidation);
  const objectDeltas = compareObjects(leftPlan, rightPlan);
  const acceptedDeltas = { left: compareObjects(state.plan, leftPlan), right: compareObjects(state.plan, rightPlan) };
  const comparisonValue = {
    planVersion: state.plan.version,
    leftBranchId,
    rightBranchId,
    leftValidationId: leftValidation.validationId,
    rightValidationId: rightValidation.validationId,
    changeSet,
    metricDeltas,
    constraintDeltas,
    objectDeltas,
    acceptedDeltas,
  };

  return clone({
    comparisonId: stableFingerprint("comparison", comparisonValue),
    planVersion: state.plan.version,
    left: branchSummary(leftBranch, leftValidation, leftPlan),
    right: branchSummary(rightBranch, rightValidation, rightPlan),
    changeSet,
    objectDeltas,
    acceptedDeltas,
    overlay: {
      roomBoundary: clone(state.plan.spatial.roomBoundary),
      acceptedObjects: clone(state.plan.objects),
      leftObjects: clone(leftPlan.objects),
      rightObjects: clone(rightPlan.objects),
    },
    metricDeltas,
    constraintDeltas,
    improvements: constraintDeltas.filter((item) => item.outcome === "improved").map((item) => item.constraintId),
    regressions: constraintDeltas.filter((item) => item.outcome === "regressed").map((item) => item.constraintId),
  });
}
