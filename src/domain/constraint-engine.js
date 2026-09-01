import { analyzeSpatialPlan } from "./spatial-analysis.js";
import { analyzeProductionPlan } from "./production-planning.js";
import { analyzeCateringPlan } from "./catering-planning.js";
import { analyzeEmergencyPlan, emergencyChangeObjectIds } from "./emergency-planning.js";
import { venueError } from "./errors.js";
import { detectLockConflicts } from "./locks.js";

export const VALIDATION_ENGINE_VERSION = "2.7.0";

const clone = (value) => JSON.parse(JSON.stringify(value));

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const hash = (prefix, value) => {
  const input = stableStringify(value);
  let result = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    result ^= input.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return `${prefix}-${(result >>> 0).toString(16).padStart(8, "0")}`;
};

const metricConstraint = ({ id, checkId, label, category, metric, comparator, threshold, unit, remediation }) => ({
  id,
  checkId,
  evaluator: comparator === "gte" ? "minimum_metric" : "maximum_metric",
  label,
  category,
  severity: "error",
  scope: { kind: "plan" },
  parameters: { metric, comparator, threshold, unit },
  remediation,
});

export function createDefaultConstraintRegistry(options = {}) {
  return [
    {
      id: "constraint-protected-objects",
      checkId: "check-locked-objects",
      evaluator: "protected_objects_unchanged",
      label: "Locked objects",
      category: "protection",
      severity: "error",
      scope: { kind: "plan" },
      parameters: { objectIds: [...(options.protectedObjectIds ?? [])] },
      remediation: "Remove Changes that target protected venue objects.",
    },
    metricConstraint({
      id: "constraint-accessible-route",
      checkId: "check-accessible-route",
      label: "Accessible route",
      category: "accessibility",
      metric: "accessibleRouteWidthFt",
      comparator: "gte",
      threshold: options.accessibleRouteMinWidthFt ?? 6,
      unit: "ft",
      remediation: "Increase the minimum clear accessible route width.",
    }),
    metricConstraint({
      id: "constraint-capacity",
      checkId: "check-capacity",
      label: "Capacity",
      category: "capacity",
      metric: "attendeeCapacity",
      comparator: "gte",
      threshold: options.attendeeCapacityMin ?? 0,
      unit: "attendees",
      remediation: "Restore enough usable places to meet the attendance requirement.",
    }),
    metricConstraint({
      id: "constraint-sightlines",
      checkId: "check-sightlines",
      label: "Sightline coverage",
      category: "sightlines",
      metric: "sightlineCoverage",
      comparator: "gte",
      threshold: options.sightlineCoverageMin ?? 0,
      unit: "ratio",
      remediation: "Move obstructions or focal equipment to restore sightline coverage.",
    }),
    metricConstraint({
      id: "constraint-peak-congestion",
      checkId: "check-circulation",
      label: "Peak congestion",
      category: "circulation",
      metric: "peakCongestionIndex",
      comparator: "lte",
      threshold: options.peakCongestionMax ?? 80,
      unit: "index",
      remediation: "Increase circulation capacity or reduce demand at the bottleneck.",
    }),
  ];
}

export function normalizeConstraints(constraints) {
  if (!Array.isArray(constraints)) throw venueError("CONSTRAINT_INVALID", { field: "constraints" }, "Constraints must be a current registry array");
  const registry = constraints;
  const ids = new Set();
  return registry.map((constraint) => {
    if (!constraint?.id || !constraint?.checkId || !constraint?.evaluator) throw venueError("CONSTRAINT_INVALID", { constraintId: constraint?.id ?? null }, "Constraint requires stable IDs and an evaluator");
    if (ids.has(constraint.id)) throw venueError("CONSTRAINT_DUPLICATE", { constraintId: constraint.id }, `Duplicate Constraint ID: ${constraint.id}`);
    ids.add(constraint.id);
    if (!constraint.category || !["error", "warning"].includes(constraint.severity)) throw venueError("CONSTRAINT_INVALID", { constraintId: constraint.id }, `Invalid Constraint metadata: ${constraint.id}`);
    if (constraint.severity === "error" && constraint.waivable === true) throw venueError("CONSTRAINT_INVALID", { constraintId: constraint.id, field: "waivable" }, `Hard Constraint cannot be waivable: ${constraint.id}`);
    if (constraint.severity === "warning" && constraint.waivable === false) throw venueError("CONSTRAINT_INVALID", { constraintId: constraint.id, field: "waivable" }, `Warning Constraint must be waivable: ${constraint.id}`);
    return clone({ ...constraint, waivable: constraint.severity === "warning", scope: constraint.scope ?? { kind: "plan" } });
  });
}

const applyEffects = (metrics, changes) => changes.reduce(
  (next, change) => ({ ...next, ...change.effects }),
  { ...metrics },
);

const evaluateMetric = (constraint, candidateMetrics) => {
  const { metric, comparator, threshold, unit } = constraint.parameters;
  const actual = candidateMetrics[metric];
  if (!Number.isFinite(actual) || !Number.isFinite(threshold)) throw venueError("CONSTRAINT_EVIDENCE_INVALID", { constraintId: constraint.id, metric }, `Constraint ${constraint.id} requires numeric metric evidence`);
  const passes = comparator === "gte" ? actual >= threshold : actual <= threshold;
  return { passes, actual, threshold, unit, metric, comparator, affectedObjectIds: [] };
};

const evaluators = {
  minimum_metric: evaluateMetric,
  maximum_metric: evaluateMetric,
  protected_objects_unchanged: (constraint, _candidateMetrics, context) => {
    const protectedIds = new Set(constraint.parameters.objectIds);
    const protectedTargetObjectIds = context.changes
      .flatMap((change) => change.targetObjectIds ?? [])
      .filter((id) => protectedIds.has(id));
    const lockConflicts = detectLockConflicts(context.state.plan, context.changes, context.state.projectLocks ?? []);
    const affectedObjectIds = [...new Set([...protectedTargetObjectIds, ...lockConflicts.map((conflict) => conflict.objectId)])].sort();
    return {
      passes: affectedObjectIds.length === 0,
      actual: affectedObjectIds.length,
      threshold: 0,
      unit: "objects",
      metric: "changedProtectedObjects",
      comparator: "lte",
      affectedObjectIds,
      details: { lockConflicts },
    };
  },
  accessible_route_graph: (constraint, _candidateMetrics, context) => {
    const access = context.spatialEvidence.accessibility;
    const threshold = constraint.parameters.minimumWidthM;
    return {
      passes: access.connected && access.minimumClearWidthM >= threshold,
      actual: access.minimumClearWidthM,
      threshold,
      unit: "m",
      metric: "minimumClearWidthM",
      comparator: "gte",
      affectedObjectIds: access.unreachableDestinationIds,
      details: access,
    };
  },
  turning_clearance: (constraint, _candidateMetrics, context) => {
    const access = context.spatialEvidence.accessibility;
    const threshold = constraint.parameters.minimumDiameterM;
    return { passes: access.turningClearanceM >= threshold, actual: access.turningClearanceM, threshold, unit: "m", metric: "turningClearanceM", comparator: "gte", affectedObjectIds: access.routeObjectIds, details: access };
  },
  accessible_seating: (constraint, _candidateMetrics, context) => {
    const access = context.spatialEvidence.accessibility;
    const threshold = constraint.parameters.minimumSeats;
    const companionPass = !constraint.parameters.requireCompanionAdjacency || access.companionAdjacencySatisfied;
    return { passes: access.accessibleSeats >= threshold && access.seatingDistributed && companionPass, actual: access.accessibleSeats, threshold, unit: "seats", metric: "accessibleSeats", comparator: "gte", affectedObjectIds: access.accessibleSeatingSections.map((section) => section.objectId), details: access };
  },
  accessible_seating_sightlines: (constraint, _candidateMetrics, context) => {
    const access = context.spatialEvidence.accessibility;
    const threshold = constraint.parameters.minimumCoverageRatio;
    const sectionThreshold = constraint.parameters.minimumSectionCoverageRatio ?? threshold;
    const failingSections = access.accessibleSeatSightlineSections.filter((section) => section.sampleIds.length === 0 || section.coverageRatio < sectionThreshold).map((section) => section.objectId);
    return {
      passes: access.accessibleSeatSampleIds.length > 0 && access.accessibleSeatSightlineCoverageRatio >= threshold && failingSections.length === 0,
      actual: access.accessibleSeatSightlineCoverageRatio,
      threshold,
      unit: "ratio",
      metric: "accessibleSeatSightlineCoverage",
      comparator: "gte",
      affectedObjectIds: failingSections,
      details: { sampleIds: access.accessibleSeatSampleIds, blockedSampleIds: access.blockedAccessibleSeatSampleIds, sections: access.accessibleSeatSightlineSections, missingSampleSectionIds: access.missingAccessibleSeatSampleSectionIds },
    };
  },
  door_clearance: (constraint, _candidateMetrics, context) => {
    const access = context.spatialEvidence.accessibility;
    const threshold = constraint.parameters.minimumClearWidthM;
    const obstructingObjectIds = [...new Set(access.doorClearanceZones.flatMap((zone) => zone.obstructingObjectIds))].sort();
    return {
      applicable: access.accessibleDoorObjectIds.length > 0,
      passes: access.accessibleDoorObjectIds.length > 0 && access.minimumDoorClearWidthM >= threshold && access.obstructedDoorObjectIds.length === 0,
      actual: access.minimumDoorClearWidthM,
      threshold,
      unit: "m",
      metric: "minimumDoorClearWidthM",
      comparator: "gte",
      affectedObjectIds: [...new Set([...access.obstructedDoorObjectIds, ...obstructingObjectIds])].sort(),
      details: { doorObjectIds: access.accessibleDoorObjectIds, obstructedDoorObjectIds: access.obstructedDoorObjectIds, clearanceZones: access.doorClearanceZones },
    };
  },
  temporary_ramp: (constraint, _candidateMetrics, context) => {
    const access = context.spatialEvidence.accessibility;
    const failing = access.ramps.filter((ramp) => ramp.status === "fail");
    return {
      applicable: access.ramps.length > 0,
      passes: access.ramps.length > 0 && failing.length === 0,
      actual: access.ramps.length ? Math.min(...access.ramps.map((ramp) => ramp.slopeRatio)) : null,
      threshold: constraint.parameters.minimumSlopeRatio,
      unit: "run-per-rise",
      metric: "minimumRampSlopeRatio",
      comparator: "gte",
      affectedObjectIds: failing.map((ramp) => ramp.objectId),
      details: { ramps: access.ramps, policy: access.rampPolicy },
    };
  },
  occupancy_capacity: (constraint, _candidateMetrics, context) => {
    const capacity = context.spatialEvidence.capacity;
    const threshold = constraint.parameters.minimumAttendeeCapacity;
    const maximumLoad = constraint.parameters.maximumOperationalLoad;
    const sectionViolations = capacity.sectionCapacities.filter((section) => section.status !== "within-limit");
    const zoneViolations = capacity.zoneCapacities.filter((zone) => zone.status !== "within-limit");
    return {
      passes: capacity.effectiveCapacity >= threshold
        && capacity.operationalLoad <= maximumLoad
        && sectionViolations.length === 0
        && zoneViolations.length === 0,
      actual: capacity.effectiveCapacity,
      threshold,
      unit: "attendees",
      metric: "effectiveCapacity",
      comparator: "gte",
      affectedObjectIds: [...new Set([
        ...sectionViolations.map((section) => section.objectId),
        ...zoneViolations.flatMap((zone) => zone.sectionObjectIds),
        ...(capacity.effectiveCapacity < threshold || capacity.operationalLoad > maximumLoad ? capacity.sectionCapacities.map((section) => section.objectId) : []),
      ])].sort(),
      details: { ...capacity, sectionViolations, zoneViolations },
    };
  },
  circulation_graph: (constraint, _candidateMetrics, context) => {
    const circulation = context.spatialEvidence.circulation;
    const threshold = constraint.parameters.maximumCongestionIndex;
    return {
      passes: circulation.connected && circulation.peakCongestionIndex <= threshold,
      actual: circulation.peakCongestionIndex,
      threshold,
      unit: "index",
      metric: "peakCongestionIndex",
      comparator: "lte",
      affectedObjectIds: [...new Set([
        ...circulation.disconnectedOccupiedObjectIds,
        ...circulation.blockingObjectIds,
        ...circulation.obstructedExitObjectIds,
        ...circulation.exitApproachZones.flatMap((zone) => zone.obstructingObjectIds),
      ])].sort(),
      details: circulation,
    };
  },
  sightline_raycast: (constraint, _candidateMetrics, context) => {
    const sightlines = context.spatialEvidence.sightlines;
    const threshold = constraint.parameters.minimumCoverageRatio;
    const maximumDistance = constraint.parameters.maximumViewingDistanceM;
    const maximumBlockedSectionRatio = constraint.parameters.maximumBlockedSectionRatio ?? 1;
    const failingSectionIds = sightlines.sectionSummaries.filter((section) => section.blockedRatio > maximumBlockedSectionRatio).map((section) => section.objectId);
    return {
      passes: sightlines.coverageRatio >= threshold && sightlines.maximumViewingDistanceM <= maximumDistance && failingSectionIds.length === 0,
      actual: sightlines.coverageRatio,
      threshold,
      unit: "ratio",
      metric: "sightlineCoverage",
      comparator: "gte",
      affectedObjectIds: [...new Set([...sightlines.obstructionObjectIds, ...failingSectionIds])].sort(),
      details: sightlines,
    };
  },
  production_readiness: (constraint, _candidateMetrics, context) => {
    const production = context.productionEvidence;
    const failedObjectIds = [
      ...production.throwDistanceChecks.filter((item) => item.status === "fail").flatMap((item) => [item.projectorObjectId, item.screenObjectId]),
      ...production.screenVisibility.filter((item) => item.status === "fail").flatMap((item) => [item.screenObjectId, ...item.rays.flatMap((ray) => ray.blockedByObjectIds)]),
      ...production.speakerCoverage.filter((item) => item.status === "fail").map((item) => item.seatingObjectId),
      ...production.cameraChecks.filter((item) => item.status === "fail").flatMap((item) => [item.cameraObjectId, item.targetObjectId, ...item.blockedByObjectIds]),
      ...production.controlSightlines.filter((item) => item.status === "fail").flatMap((item) => [item.controlObjectId, item.targetObjectId, ...item.blockedByObjectIds]),
      ...production.cableCrossings.filter((item) => item.status === "fail").flatMap((item) => [item.cableObjectId, item.routeObjectId]),
      ...production.circuits.filter((item) => item.status === "fail").flatMap((item) => [item.utilityObjectId, ...item.connectedObjectIds]),
      ...production.unpoweredObjectIds,
      ...production.rigging.filter((item) => item.status === "fail").flatMap((item) => [item.riggingPointObjectId, ...item.suspendedObjectIds]),
      ...production.unresolvedRiggingObjectIds,
    ].filter(Boolean);
    return {
      passes: production.summary.status === "pass",
      actual: production.summary.failedChecks,
      threshold: 0,
      unit: "checks",
      metric: "productionFailedChecks",
      comparator: "lte",
      affectedObjectIds: [...new Set(failedObjectIds)].sort(),
      details: production,
    };
  },
  catering_readiness: (constraint, _candidateMetrics, context) => {
    const catering = context.cateringEvidence;
    const affectedObjectIds = [
      ...catering.phaseCapacity.flatMap((phase) => phase.stations.filter((item) => item.status === "fail").map((item) => item.stationObjectId)),
      ...catering.queueConflicts.flatMap((item) => [item.stationObjectId, item.queueZoneObjectId, item.conflictObjectId]),
      ...catering.separationChecks.filter((item) => item.status === "fail").flatMap((item) => [item.serviceObjectId, item.otherObjectId]),
      ...catering.accessibleServicePoints.filter((item) => item.status === "fail").map((item) => item.stationObjectId),
      ...catering.replenishmentRoutes.filter((item) => item.status === "fail").flatMap((item) => [item.routeObjectId, item.sourceObjectId, ...item.targetObjectIds, ...item.crossingObjectIds, ...item.missingEndpointIds]),
      ...catering.inventory.filter((item) => item.status === "warning").flatMap((item) => item.placedObjectIds),
      ...catering.invalidStationReferences,
    ].filter(Boolean);
    return {
      passes: catering.summary.status === "pass",
      actual: catering.summary.queueRiskCount + catering.summary.uncontrolledCirculationConflictCount + catering.summary.separationFailures + catering.summary.missingSupportObjects + catering.summary.inventoryShortages,
      threshold: 0,
      unit: "checks",
      metric: "cateringFailedChecks",
      comparator: "lte",
      affectedObjectIds: [...new Set(affectedObjectIds)].sort(),
      details: catering,
    };
  },
  emergency_readiness: (constraint, _candidateMetrics, context) => {
    const emergency = context.emergencyEvidence;
    return {
      passes: emergency.summary.status === "pass",
      actual: emergency.summary.structuralFailures,
      threshold: 0,
      unit: "checks",
      metric: "emergencyStructuralFailures",
      comparator: "lte",
      affectedObjectIds: [...new Set(emergency.structuralFailures.flatMap((failure) => failure.affectedObjectIds))].sort(),
      details: emergency,
    };
  },
};

const statusFor = (passes, severity, applicable = true) => !applicable ? "not-applicable" : passes ? "pass" : severity === "warning" ? "warning" : "fail";

const validationInputValue = (state) => ({
        engineVersion: VALIDATION_ENGINE_VERSION,
  plan: {
    id: state.plan.id,
    version: state.plan.version,
    attendeeTarget: state.plan.event?.attendeeTarget ?? null,
    spatial: state.plan.spatial,
    objects: state.plan.objects.map(({ label: _label, ...object }) => object),
    accessibilityPolicy: state.plan.accessibilityPolicy ?? null,
    productionPolicy: state.plan.productionPolicy ?? null,
    cateringPolicy: state.plan.cateringPolicy ?? null,
    emergencyPlan: state.plan.emergencyPlan ?? null,
    occupancy: state.plan.occupancy ?? null,
    metrics: state.plan.metrics,
    constraints: state.plan.constraints,
  },
  brief: state.brief ? { attendeeTarget: state.brief.attendeeTarget, occupancyMode: state.brief.occupancyMode } : null,
  projectLocks: state.projectLocks ?? [],
  proposal: state.proposal ? {
    id: state.proposal.id,
    revision: state.proposal.revision,
    status: state.proposal.status,
    changes: state.proposal.changes.map(({ id, targetObjectIds, targetRequirementIds, effects, spatialEffects, planningEffects }) => ({ id, targetObjectIds, targetRequirementIds, effects, spatialEffects, planningEffects })),
  } : null,
});

const computeValidation = (state, analyzeSpatial, inputFingerprint) => {
  const changes = state.proposal?.status === "review" ? state.proposal.changes : [];
  const spatial = analyzeSpatial({ plan: state.plan, changes, brief: state.brief, projectLocks: state.projectLocks ?? [] });
  const productionEvidence = analyzeProductionPlan(spatial.candidatePlan);
  const cateringEvidence = analyzeCateringPlan(spatial.candidatePlan);
  const emergencyEvidence = analyzeEmergencyPlan(spatial.candidatePlan);
  const evidenceFamilyFingerprints = {
    accessibility: hash("evidence-accessibility", spatial.evidence.accessibility),
    capacity: hash("evidence-capacity", spatial.evidence.capacity),
    catering: hash("evidence-catering", cateringEvidence),
    emergency: hash("evidence-emergency", emergencyEvidence),
    flow: hash("evidence-flow", spatial.evidence.circulation),
    operations: hash("evidence-operations", { schedule: state.brief?.schedule ?? null }),
    production: hash("evidence-production", productionEvidence),
    sightlines: hash("evidence-sightlines", spatial.evidence.sightlines),
  };
  const candidateMetrics = { ...applyEffects(state.plan.metrics, changes), ...spatial.metrics };
  const checks = state.plan.constraints.map((constraint) => {
    if (constraint.enabled === false) {
      return {
        id: constraint.checkId,
        constraintId: constraint.id,
        evaluator: constraint.evaluator,
        label: constraint.label,
        category: constraint.category,
        severity: constraint.severity,
        waivable: constraint.waivable,
        scope: clone(constraint.scope),
        status: "not-applicable",
        actual: null,
        threshold: constraint.parameters?.threshold ?? null,
        unit: constraint.parameters?.unit ?? null,
        evidence: {
          comparator: constraint.parameters?.comparator ?? null,
          metric: constraint.parameters?.metric ?? null,
          actual: null,
          threshold: constraint.parameters?.threshold ?? null,
          unit: constraint.parameters?.unit ?? null,
          affectedObjectIds: [],
        },
        remediation: constraint.remediation,
        waiver: null,
      };
    }
    const evaluate = evaluators[constraint.evaluator];
    if (!evaluate) throw venueError("CONSTRAINT_EVALUATOR_UNSUPPORTED", { constraintId: constraint.id, evaluator: constraint.evaluator }, `Unsupported Constraint evaluator: ${constraint.evaluator}`);
    const result = evaluate(constraint, candidateMetrics, { changes, state, spatialEvidence: spatial.evidence, productionEvidence, cateringEvidence, emergencyEvidence });
    return {
      id: constraint.checkId,
      constraintId: constraint.id,
      evaluator: constraint.evaluator,
      label: constraint.label,
      category: constraint.category,
      severity: constraint.severity,
      waivable: constraint.waivable,
      scope: clone(constraint.scope),
      status: statusFor(result.passes, constraint.severity, result.applicable),
      actual: result.actual,
      threshold: result.threshold,
      unit: result.unit,
      evidence: {
        comparator: result.comparator,
        metric: result.metric,
        actual: result.actual,
        threshold: result.threshold,
        unit: result.unit,
        affectedObjectIds: result.affectedObjectIds,
        details: result.details ?? null,
      },
      remediation: constraint.remediation,
      waiver: null,
    };
  }).sort((left, right) => left.severity.localeCompare(right.severity)
    || left.category.localeCompare(right.category)
    || left.id.localeCompare(right.id));
  const blockingIssues = checks.filter((check) => check.status === "fail" && check.severity === "error").length;
  const unresolvedIssues = checks.filter((check) => ["warning", "fail"].includes(check.status)).length;
  return {
    validationId: hash("validation", inputFingerprint),
    inputFingerprint,
    engineVersion: VALIDATION_ENGINE_VERSION,
    evaluatedPlanVersion: state.plan.version,
    evaluatedProposalId: state.proposal?.id ?? null,
    status: blockingIssues === 0 ? "pass" : "fail",
    checks,
    candidateMetrics,
    candidateGeometryFingerprint: spatial.candidatePlan.spatial.fingerprint,
    spatialEvidence: spatial.evidence,
    productionEvidence,
    cateringEvidence,
    emergencyEvidence,
    evidenceFamilyFingerprints,
    emergencyReviewRequired: emergencyChangeObjectIds(state.plan, changes).length > 0,
    emergencyChangedObjectIds: emergencyChangeObjectIds(state.plan, changes),
    authorizedEmergencyReviewerRoles: emergencyEvidence.emergencyPlan.authorizedReviewerRoles,
    blockingIssues,
    waivedWarnings: 0,
    unwaivedWarnings: checks.filter((check) => check.status === "warning").length,
    unresolvedIssues,
  };
};

const applyWarningWaivers = (result, state) => {
  const waivers = [...(state.proposal?.waivers ?? []), ...(state.plan.waivers ?? [])];
  const activeWaiver = (check) => waivers.find((waiver) => waiver.constraintId === check.constraintId
    && ((waiver.proposalId === state.proposal?.id
      && waiver.baseVersion === state.plan.version
      && waiver.validationInputFingerprint === result.inputFingerprint)
      || waiver.acceptedPlanVersion === state.plan.version)) ?? null;
  const checks = result.checks.map((check) => check.status === "warning" ? { ...check, waiver: clone(activeWaiver(check)) } : check);
  const waivedWarnings = checks.filter((check) => check.status === "warning" && check.waiver).length;
  const unwaivedWarnings = checks.filter((check) => check.status === "warning" && !check.waiver).length;
  return {
    ...result,
    checks,
    waivedWarnings,
    unwaivedWarnings,
    unresolvedIssues: result.checks.filter((check) => check.status === "fail").length + unwaivedWarnings,
  };
};

export function createValidationEngine({ maxEntries = 128, analyzeSpatial = analyzeSpatialPlan } = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw new Error("Validation cache maxEntries must be a positive integer");
  const cache = new Map();
  return Object.freeze({
    validate(state) {
      const inputValue = validationInputValue(state);
      const serializedInput = stableStringify(inputValue);
      const inputFingerprint = hash("input", inputValue);
      const cached = cache.get(inputFingerprint);
      if (cached?.serializedInput === serializedInput) {
        cache.delete(inputFingerprint);
        cache.set(inputFingerprint, cached);
        return applyWarningWaivers(clone(cached.result), state);
      }
      const result = computeValidation(state, analyzeSpatial, inputFingerprint);
      cache.set(inputFingerprint, { serializedInput, result: clone(result) });
      if (cache.size > maxEntries) cache.delete(cache.keys().next().value);
      return applyWarningWaivers(clone(result), state);
    },
    clear() {
      cache.clear();
    },
  });
}

const defaultValidationEngine = createValidationEngine();

export const validateConstraints = (state) => defaultValidationEngine.validate(state);
