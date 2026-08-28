import { stableFingerprint } from "./activity-ledger.js";
import { materializeSpatialPlan } from "./spatial-analysis.js";
import { venueError } from "./errors.js";
import { venueTemplateCatalog } from "./venue-templates.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value, precision = 3) => Number(value.toFixed(precision));
const pointChanged = (left, right) => left?.x !== right?.x || left?.y !== right?.y;

const footprintDelta = (left, right) => {
  if (!left || !right || left.kind !== right.kind) return { moved: false, rotated: false, resized: true };
  const moved = pointChanged(left.center, right.center)
    || pointChanged(left.start, right.start)
    || pointChanged(left.end, right.end)
    || (left.kind === "polygon" && stableFingerprint("points", left.points) !== stableFingerprint("points", right.points));
  const rotated = left.rotationDegrees !== right.rotationDegrees;
  const resized = left.width !== right.width || left.depth !== right.depth || left.radius !== right.radius;
  return { moved, rotated, resized };
};

const withoutFootprint = ({ footprint: _footprint, ...object }) => object;

const compareObjects = (leftPlan, rightPlan) => {
  const leftObjects = new Map(leftPlan.objects.map((object) => [object.id, object]));
  const rightObjects = new Map(rightPlan.objects.map((object) => [object.id, object]));
  const allIds = [...new Set([...leftObjects.keys(), ...rightObjects.keys()])].sort();
  const deltas = {
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
    if (stableFingerprint("object", withoutFootprint(left)) !== stableFingerprint("object", withoutFootprint(right))) deltas.metadataObjectIds.push(objectId);
  }
  return deltas;
};

const inventoryById = new Map(venueTemplateCatalog.inventoryTemplates.map((template) => [template.id, template]));

const estimatedCost = (plan) => round(plan.objects.reduce((total, object) => {
  const template = inventoryById.get(object.templateRef?.templateId);
  const amount = object.specification?.cost?.amount ?? template?.cost?.amount ?? 0;
  return total + (amount * (object.inventoryCount ?? 1));
}, 0), 2);

const riskScore = (validation) => validation.checks.reduce((total, check) => total + (check.status === "fail" ? 10 : check.status === "warning" ? 3 : 0), 0) + (validation.inventoryWarnings * 2);
const worstBottleneck = (validation) => Math.max(0, ...validation.spatialEvidence.circulation.bottleneckLoads.map((load) => load.loadIndex));
const longestEgressPath = (validation) => Math.max(0, ...validation.spatialEvidence.circulation.shortestExitPaths.map((path) => path.distanceM));

const metricRows = (leftValidation, rightValidation, leftPlan, rightPlan) => {
  const leftEvidence = leftValidation.spatialEvidence;
  const rightEvidence = rightValidation.spatialEvidence;
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
  ].map(([metric, label, unit, left, right]) => ({ metric, label, unit, left, right, delta: round(right - left) }));
};

const statusRank = { fail: 0, warning: 1, "not-applicable": 1, pass: 2 };

const constraintRows = (leftValidation, rightValidation) => {
  const leftChecks = new Map(leftValidation.checks.map((check) => [check.constraintId, check]));
  const rightChecks = new Map(rightValidation.checks.map((check) => [check.constraintId, check]));
  return [...new Set([...leftChecks.keys(), ...rightChecks.keys()])].sort().map((constraintId) => {
    const left = leftChecks.get(constraintId);
    const right = rightChecks.get(constraintId);
    const delta = (statusRank[right?.status] ?? 0) - (statusRank[left?.status] ?? 0);
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

const branchSummary = (branch, validation, candidatePlan) => ({
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

export function compareProposalBranches(state, leftBranchId, rightBranchId, validate) {
  const leftBranch = state.branches.find((branch) => branch.id === leftBranchId);
  const rightBranch = state.branches.find((branch) => branch.id === rightBranchId);
  if (!leftBranch) throw venueError("BRANCH_NOT_FOUND", { branchId: leftBranchId });
  if (!rightBranch) throw venueError("BRANCH_NOT_FOUND", { branchId: rightBranchId });

  const leftValidation = validate({ ...state, proposal: leftBranch.proposal });
  const rightValidation = validate({ ...state, proposal: rightBranch.proposal });
  const leftPlan = materializeSpatialPlan(state.plan, leftBranch.proposal.changes, { projectLocks: state.projectLocks ?? [], allowLockConflicts: true });
  const rightPlan = materializeSpatialPlan(state.plan, rightBranch.proposal.changes, { projectLocks: state.projectLocks ?? [], allowLockConflicts: true });
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
