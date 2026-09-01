import { stableFingerprint } from "./activity-ledger.ts";
import { materializeSpatialPlan } from "./spatial-analysis.ts";
import { venueError } from "./errors.ts";
import { venueTemplateCatalog } from "./venue-templates.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const round: any = (value: any, precision: any = 3) => Number(value.toFixed(precision));
const pointChanged: any = (left: any, right: any) => left?.x !== right?.x || left?.y !== right?.y;

const footprintDelta: any = (left: any, right: any) => {
  if (!left || !right || left.kind !== right.kind) return { moved: false, rotated: false, resized: true };
  const moved: any = pointChanged(left.center, right.center)
    || pointChanged(left.start, right.start)
    || pointChanged(left.end, right.end)
    || (left.kind === "polygon" && stableFingerprint("points", left.points) !== stableFingerprint("points", right.points));
  const rotated: any = left.rotationDegrees !== right.rotationDegrees;
  const resized: any = left.width !== right.width || left.depth !== right.depth || left.radius !== right.radius;
  return { moved, rotated, resized };
};

const withoutFootprint: any = ({ footprint: _footprint, ...object }: any) => object;

const compareObjects: any = (leftPlan: any, rightPlan: any) => {
  const leftObjects: any = new Map(leftPlan.objects.map((object: any) => [object.id, object]));
  const rightObjects: any = new Map(rightPlan.objects.map((object: any) => [object.id, object]));
  const allIds: any = [...new Set([...leftObjects.keys(), ...rightObjects.keys()])].sort();
  const deltas: any = {
    addedObjectIds: [],
    removedObjectIds: [],
    movedObjectIds: [],
    rotatedObjectIds: [],
    resizedObjectIds: [],
    metadataObjectIds: [],
  };

  for (const objectId of allIds) {
    const left: any = leftObjects.get(objectId);
    const right: any = rightObjects.get(objectId);
    if (!left) {
      deltas.addedObjectIds.push(objectId);
      continue;
    }
    if (!right) {
      deltas.removedObjectIds.push(objectId);
      continue;
    }
    const footprint: any = footprintDelta(left.footprint, right.footprint);
    if (footprint.moved) deltas.movedObjectIds.push(objectId);
    if (footprint.rotated) deltas.rotatedObjectIds.push(objectId);
    if (footprint.resized) deltas.resizedObjectIds.push(objectId);
    if (stableFingerprint("object", withoutFootprint(left)) !== stableFingerprint("object", withoutFootprint(right))) deltas.metadataObjectIds.push(objectId);
  }
  return deltas;
};

const inventoryById: any = new Map(venueTemplateCatalog.inventoryTemplates.map((template: any) => [template.id, template]));

const estimatedCost: any = (plan: any) => round(plan.objects.reduce((total: any, object: any) => {
  const template: any = inventoryById.get(object.templateRef?.templateId);
  const amount: any = object.specification?.cost?.amount ?? template?.cost?.amount ?? 0;
  return total + (amount * (object.inventoryCount ?? 1));
}, 0), 2);

const riskScore: any = (validation: any) => validation.checks.reduce((total: any, check: any) => total + (check.status === "fail" ? 10 : check.status === "warning" ? 3 : 0), 0) + (validation.inventoryWarnings * 2);
const worstBottleneck: any = (validation: any) => Math.max(0, ...validation.spatialEvidence.circulation.bottleneckLoads.map((load: any) => load.loadIndex));
const longestEgressPath: any = (validation: any) => Math.max(0, ...validation.spatialEvidence.circulation.shortestExitPaths.map((path: any) => path.distanceM));

const metricRows: any = (leftValidation: any, rightValidation: any, leftPlan: any, rightPlan: any) => {
  const leftEvidence: any = leftValidation.spatialEvidence;
  const rightEvidence: any = rightValidation.spatialEvidence;
  return [
    ["effectiveCapacity", "Capacity", "attendees", leftEvidence.capacity.effectiveCapacity, rightEvidence.capacity.effectiveCapacity],
    ["minimumClearWidthM", "Access width", "m", leftEvidence.accessibility.minimumClearWidthM, rightEvidence.accessibility.minimumClearWidthM],
    ["peakCongestionIndex", "Congestion", "index", leftEvidence.circulation.peakCongestionIndex, rightEvidence.circulation.peakCongestionIndex],
    ["worstBottleneckLoad", "Worst bottleneck", "index", worstBottleneck(leftValidation), worstBottleneck(rightValidation)],
    ["longestEgressPathM", "Egress distance", "m", longestEgressPath(leftValidation), longestEgressPath(rightValidation)],
    ["sightlineCoverage", "Sightlines", "ratio", leftEvidence.sightlines.coverageRatio, rightEvidence.sightlines.coverageRatio],
    ["blockedSightlineSamples", "Blocked samples", "samples", leftEvidence.sightlines.blockedSampleIds.length, rightEvidence.sightlines.blockedSampleIds.length],
    ["cateringServiceCapacity", "Service capacity", "persons", leftValidation.cateringEvidence.summary.minimumPhaseServiceCapacityPersons, rightValidation.cateringEvidence.summary.minimumPhaseServiceCapacityPersons],
    ["cateringQueueRisk", "Service queue risk", "checks", leftValidation.cateringEvidence.summary.queueRiskCount, rightValidation.cateringEvidence.summary.queueRiskCount],
    ["cateringCirculationImpact", "Service circulation", "crossings", leftValidation.cateringEvidence.summary.circulationConflictCount, rightValidation.cateringEvidence.summary.circulationConflictCount],
    ["accessibleServicePoints", "Accessible service", "points", leftValidation.cateringEvidence.summary.accessibleServicePoints, rightValidation.cateringEvidence.summary.accessibleServicePoints],
    ["riskScore", "Risk", "points", riskScore(leftValidation), riskScore(rightValidation)],
    ["estimatedCost", "Cost", "USD", estimatedCost(leftPlan), estimatedCost(rightPlan)],
  ].map(([metric, label, unit, left, right]: any) => ({ metric, label, unit, left, right, delta: round(right - left) }));
};

const statusRank: any = { fail: 0, warning: 1, "not-applicable": 1, pass: 2 };

const constraintRows: any = (leftValidation: any, rightValidation: any) => {
  const leftChecks: any = new Map(leftValidation.checks.map((check: any) => [check.constraintId, check]));
  const rightChecks: any = new Map(rightValidation.checks.map((check: any) => [check.constraintId, check]));
  return [...new Set([...leftChecks.keys(), ...rightChecks.keys()])].sort().map((constraintId: any) => {
    const left: any = leftChecks.get(constraintId);
    const right: any = rightChecks.get(constraintId);
    const delta: any = (statusRank[right?.status] ?? 0) - (statusRank[left?.status] ?? 0);
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

const branchSummary: any = (branch: any, validation: any, candidatePlan: any) => ({
  branchId: branch.id,
  name: branch.name,
  notes: branch.notes ?? "",
  strategy: branch.strategy,
  proposalId: branch.proposal.id,
  baseVersion: branch.proposal.baseVersion,
  changedItems: branch.proposal.changes.length,
  changeIds: branch.proposal.changes.map((change: any) => change.id).sort(),
  validationId: validation.validationId,
  validationStatus: validation.status,
  blockingIssues: validation.blockingIssues,
  unresolvedIssues: validation.unresolvedIssues,
  geometryFingerprint: candidatePlan.spatial.fingerprint,
});

export function compareProposalBranches(state: any, leftBranchId: any, rightBranchId: any, validate: any) {
  const leftBranch: any = state.branches.find((branch: any) => branch.id === leftBranchId);
  const rightBranch: any = state.branches.find((branch: any) => branch.id === rightBranchId);
  if (!leftBranch) throw venueError("BRANCH_NOT_FOUND", { branchId: leftBranchId });
  if (!rightBranch) throw venueError("BRANCH_NOT_FOUND", { branchId: rightBranchId });

  const leftValidation: any = validate({ ...state, proposal: leftBranch.proposal });
  const rightValidation: any = validate({ ...state, proposal: rightBranch.proposal });
  const leftPlan: any = materializeSpatialPlan(state.plan, leftBranch.proposal.changes, { projectLocks: state.projectLocks ?? [], allowLockConflicts: true });
  const rightPlan: any = materializeSpatialPlan(state.plan, rightBranch.proposal.changes, { projectLocks: state.projectLocks ?? [], allowLockConflicts: true });
  const leftChangeIds: any = new Set(leftBranch.proposal.changes.map((change: any) => change.id));
  const rightChangeIds: any = new Set(rightBranch.proposal.changes.map((change: any) => change.id));
  const changeSet: any = {
    sharedIds: [...leftChangeIds].filter((id: any) => rightChangeIds.has(id)).sort(),
    leftOnlyIds: [...leftChangeIds].filter((id: any) => !rightChangeIds.has(id)).sort(),
    rightOnlyIds: [...rightChangeIds].filter((id: any) => !leftChangeIds.has(id)).sort(),
  };
  const metricDeltas: any = metricRows(leftValidation, rightValidation, leftPlan, rightPlan);
  const constraintDeltas: any = constraintRows(leftValidation, rightValidation);
  const objectDeltas: any = compareObjects(leftPlan, rightPlan);
  const acceptedDeltas: any = { left: compareObjects(state.plan, leftPlan), right: compareObjects(state.plan, rightPlan) };
  const comparisonValue: any = {
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
    improvements: constraintDeltas.filter((item: any) => item.outcome === "improved").map((item: any) => item.constraintId),
    regressions: constraintDeltas.filter((item: any) => item.outcome === "regressed").map((item: any) => item.constraintId),
  });
}
