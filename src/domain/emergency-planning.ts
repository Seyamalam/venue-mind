import { stableFingerprint } from "./activity-ledger.ts";
import { analyzeSpatialPlan, footprintsIntersect } from "./spatial-analysis.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const round: any = (value: any, precision: any = 3) => Number(Number(value).toFixed(precision));
const distance: any = (left: any, right: any) => Math.hypot(right.x - left.x, right.y - left.y);

const centerOf: any = (footprint: any) => {
  if (footprint?.center) return clone(footprint.center);
  if (footprint?.start && footprint?.end) return { x: round((footprint.start.x + footprint.end.x) / 2), y: round((footprint.start.y + footprint.end.y) / 2) };
  const points: any = footprint?.points ?? [];
  return points.length ? { x: round(points.reduce((sum: any, point: any) => sum + point.x, 0) / points.length), y: round(points.reduce((sum: any, point: any) => sum + point.y, 0) / points.length) } : { x: 0, y: 0 };
};

const pointToSegmentDistance: any = (point: any, start: any, end: any) => {
  const dx: any = end.x - start.x;
  const dy: any = end.y - start.y;
  const lengthSquared: any = dx * dx + dy * dy;
  if (!lengthSquared) return distance(point, start);
  const ratio: any = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, { x: start.x + ratio * dx, y: start.y + ratio * dy });
};

const pointTouchesFootprint: any = (point: any, footprint: any, tolerance: any = .2) => {
  if (footprint?.kind === "circle") return distance(point, footprint.center) <= footprint.radius + tolerance;
  if (footprint?.kind === "line") return pointToSegmentDistance(point, footprint.start, footprint.end) <= footprint.width / 2 + tolerance;
  if (footprint?.kind === "rectangle") {
    const radians: any = (-(footprint.rotationDegrees ?? 0) * Math.PI) / 180;
    const dx: any = point.x - footprint.center.x;
    const dy: any = point.y - footprint.center.y;
    const x: any = dx * Math.cos(radians) - dy * Math.sin(radians);
    const y: any = dx * Math.sin(radians) + dy * Math.cos(radians);
    return Math.abs(x) <= footprint.width / 2 + tolerance && Math.abs(y) <= footprint.depth / 2 + tolerance;
  }
  if (footprint?.kind === "polygon") {
    let inside: any = false;
    for (let current: any = 0, previous: any = footprint.points.length - 1; current < footprint.points.length; previous = current, current += 1) {
      const a: any = footprint.points[current];
      const b: any = footprint.points[previous];
      if (((a.y > point.y) !== (b.y > point.y)) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }
  return false;
};

const uniqueStrings: any = (values: any = []) => [...new Set(values.map((value: any) => String(value).trim()).filter(Boolean))].sort();

export const EMERGENCY_SCENARIO_TYPES = Object.freeze(["blocked-exit", "unavailable-corridor", "power-loss"]);
export const EMERGENCY_REVIEWER_ROLES = Object.freeze(["safety-officer", "venue-administrator"]);

export function normalizeEmergencyPlan(value: any = {}) {
  const defaultScenarios: any = [
    { id: "scenario-blocked-exit", label: "Blocked exit", type: "blocked-exit", unavailableObjectIds: [], unavailableCircuitIds: [], durationMinutes: 120, assumptions: ["one-exit-unavailable"] },
    { id: "scenario-unavailable-corridor", label: "Unavailable corridor", type: "unavailable-corridor", unavailableObjectIds: [], unavailableCircuitIds: [], durationMinutes: 120, assumptions: ["one-corridor-unavailable"] },
    { id: "scenario-power-loss", label: "Power loss", type: "power-loss", unavailableObjectIds: [], unavailableCircuitIds: [], durationMinutes: 120, assumptions: ["utility-power-unavailable"] },
  ];
  const scenarioDefinitions: any = (value.scenarioDefinitions?.length ? value.scenarioDefinitions : defaultScenarios).map((scenario: any) => ({
    id: String(scenario.id),
    label: String(scenario.label ?? scenario.id),
    type: String(scenario.type),
    unavailableObjectIds: uniqueStrings(scenario.unavailableObjectIds),
    unavailableCircuitIds: uniqueStrings(scenario.unavailableCircuitIds),
    durationMinutes: Math.trunc(Number(scenario.durationMinutes ?? 120)),
    assumptions: uniqueStrings(scenario.assumptions),
  }));
  if (new Set(scenarioDefinitions.map((item: any) => item.id)).size !== scenarioDefinitions.length || scenarioDefinitions.some((item: any) => !item.id || !EMERGENCY_SCENARIO_TYPES.includes(item.type) || !Number.isInteger(item.durationMinutes) || item.durationMinutes <= 0)) throw new Error("Emergency scenarios require unique IDs, supported types, and positive durations");
  const requiredTypes: any = new Set(EMERGENCY_SCENARIO_TYPES);
  if ([...requiredTypes].some((type: any) => !scenarioDefinitions.some((item: any) => item.type === type))) throw new Error("Emergency Plan requires blocked-exit, unavailable-corridor, and power-loss scenarios");
  const authorizedReviewerRoles: any = uniqueStrings(value.authorizedReviewerRoles ?? EMERGENCY_REVIEWER_ROLES);
  if (!authorizedReviewerRoles.length || authorizedReviewerRoles.some((role: any) => !EMERGENCY_REVIEWER_ROLES.includes(role))) throw new Error("Emergency Plan requires supported authorized reviewer roles");
  const numeric: any = (field: any, fallback: any, integer: any = false) => {
    const result: any = Number(value[field] ?? fallback);
    if (!Number.isFinite(result) || result <= 0 || (integer && !Number.isInteger(result))) throw new Error(`Emergency Plan ${field} must be positive`);
    return integer ? result : round(result);
  };
  return {
    schemaVersion: 1,
    minimumExitCount: numeric("minimumExitCount", 2, true),
    minimumExitCapacityPersons: numeric("minimumExitCapacityPersons", 438, true),
    minimumAssemblyCapacityPersons: numeric("minimumAssemblyCapacityPersons", 438, true),
    minimumEmergencyAccessWidthM: numeric("minimumEmergencyAccessWidthM", 1.2),
    minimumFireEquipmentCoverageRatio: numeric("minimumFireEquipmentCoverageRatio", 1),
    requiredFirstAidPosts: numeric("requiredFirstAidPosts", 1, true),
    requiredCommandPosts: numeric("requiredCommandPosts", 1, true),
    authorizedReviewerRoles,
    scenarioDefinitions,
    assumptions: uniqueStrings(value.assumptions ?? ["all-attendees-evacuate", "staff-assist-access-needs", "no-lift-use-during-fire"]),
  };
}

const shortestPath: any = (graph: any, sourceNodeIds: any, targetNodeIds: any, excludedRouteObjectIds: any = new Set()) => {
  const targets: any = new Set(targetNodeIds);
  const nodes: any = new Map(graph.nodes.map((node: any) => [node.id, node]));
  const edges: any = new Map(graph.edges.map((edge: any) => [edge.id, edge]));
  const distances: any = new Map(graph.nodes.map((node: any) => [node.id, Number.POSITIVE_INFINITY]));
  const previous: any = new Map();
  const queue: any = new Set(graph.nodes.map((node: any) => node.id));
  for (const id of sourceNodeIds) if (distances.has(id)) distances.set(id, 0);
  while (queue.size) {
    const currentId: any = [...queue].sort((left: any, right: any) => distances.get(left) - distances.get(right) || left.localeCompare(right))[0];
    queue.delete(currentId);
    if (!Number.isFinite(distances.get(currentId))) break;
    if (targets.has(currentId)) {
      const routeObjectIds: any[] = [];
      let cursor: any = currentId;
      while (previous.has(cursor)) {
        const step: any = previous.get(cursor);
        routeObjectIds.push(edges.get(step.edgeId).objectId);
        cursor = step.nodeId;
      }
      return { targetNodeId: currentId, distanceM: round(distances.get(currentId)), routeObjectIds: [...new Set(routeObjectIds)].sort() };
    }
    for (const edgeId of nodes.get(currentId)?.edgeIds ?? []) {
      const edge: any = edges.get(edgeId);
      if (!edge || edge.blockedByObjectIds.length || excludedRouteObjectIds.has(edge.objectId)) continue;
      const neighborId: any = edge.startNodeId === currentId ? edge.endNodeId : edge.startNodeId;
      if (!queue.has(neighborId)) continue;
      const candidate: any = distances.get(currentId) + edge.lengthM;
      if (candidate < distances.get(neighborId)) {
        distances.set(neighborId, candidate);
        previous.set(neighborId, { nodeId: currentId, edgeId });
      }
    }
  }
  return null;
};

const pathSet: any = (path: any) => `${path?.exitObjectId ?? "none"}:${(path?.routeObjectIds ?? []).join("|")}`;

const evaluateDegradedScenario: any = (plan: any, emergencyPlan: any, spatialEvidence: any, definition: any) => {
  const objects: any = new Map(plan.objects.map((object: any) => [object.id, object]));
  const graph: any = { nodes: spatialEvidence.circulation.graphNodes, edges: spatialEvidence.circulation.graphEdges };
  const exits: any = plan.objects.filter((object: any) => object.kind === "fire_exit");
  const occupiedZones: any = plan.objects.filter((object: any) => object.kind === "seating_section" && object.capacity > 0);
  const unavailable: any = new Set(definition.unavailableObjectIds);
  const availableExits: any = exits.filter((exit: any) => !unavailable.has(exit.id));
  const exitNodes: any = new Map(availableExits.map((exit: any) => [exit.id, graph.nodes.filter((node: any) => pointTouchesFootprint(node.point, exit.footprint)).map((node: any) => node.id)]));
  const allExitNodeIds: any = [...exitNodes.values()].flat();
  const exitForNode: any = (nodeId: any) => availableExits.find((exit: any) => exitNodes.get(exit.id).includes(nodeId))?.id ?? null;
  const pathsFor: any = (excluded: any = new Set()) => occupiedZones.map((zone: any) => {
    const sourceNodeIds: any = graph.nodes.filter((node: any) => pointTouchesFootprint(node.point, zone.footprint)).map((node: any) => node.id);
    const path: any = shortestPath(graph, sourceNodeIds, allExitNodeIds, excluded);
    return { zoneObjectId: zone.id, sourceNodeIds, ...(path ? { ...path, exitObjectId: exitForNode(path.targetNodeId), status: "available" } : { targetNodeId: null, exitObjectId: null, distanceM: null, routeObjectIds: [], status: "unavailable" }) };
  });
  const baselineExitNodes: any = new Map(exits.map((exit: any) => [exit.id, graph.nodes.filter((node: any) => pointTouchesFootprint(node.point, exit.footprint)).map((node: any) => node.id)]));
  const baselineTargets: any = [...baselineExitNodes.values()].flat();
  const baselineExitForNode: any = (nodeId: any) => exits.find((exit: any) => baselineExitNodes.get(exit.id).includes(nodeId))?.id ?? null;
  const baselinePaths: any = occupiedZones.map((zone: any) => {
    const sources: any = graph.nodes.filter((node: any) => pointTouchesFootprint(node.point, zone.footprint)).map((node: any) => node.id);
    const path: any = shortestPath(graph, sources, baselineTargets);
    return { zoneObjectId: zone.id, ...(path ? { ...path, exitObjectId: baselineExitForNode(path.targetNodeId), status: "available" } : { exitObjectId: null, routeObjectIds: [], status: "unavailable" }) };
  });
  const excludedRoutes: any = new Set(definition.unavailableObjectIds.filter((id: any) => graph.edges.some((edge: any) => edge.objectId === id)));
  const scenarioPaths: any = pathsFor(excludedRoutes);
  const affectedZoneObjectIds: any = scenarioPaths.filter((path: any) => pathSet(path) !== pathSet(baselinePaths.find((item: any) => item.zoneObjectId === path.zoneObjectId))).map((path: any) => path.zoneObjectId).sort();
  const alternativeRoutes: any = scenarioPaths.filter((path: any) => affectedZoneObjectIds.includes(path.zoneObjectId) && path.status === "available").map((path: any) => ({ zoneObjectId: path.zoneObjectId, exitObjectId: path.exitObjectId, routeObjectIds: path.routeObjectIds, distanceM: path.distanceM }));
  const unreachableZoneObjectIds: any = scenarioPaths.filter((path: any) => path.status === "unavailable").map((path: any) => path.zoneObjectId).sort();
  const reachableExitObjectIds: any = [...new Set(scenarioPaths.map((path: any) => path.exitObjectId).filter(Boolean))].sort();
  const baselineExitCapacityPersons: any = exits.reduce((sum: any, exit: any) => sum + exit.exit.capacityPersons, 0);
  const availableExitCapacityPersons: any = reachableExitObjectIds.reduce((sum: any, id: any) => sum + objects.get(id).exit.capacityPersons, 0);
  const operationalLoadPersons: any = spatialEvidence.capacity.operationalLoad;
  const powerFailures: any = plan.objects.filter((object: any) => object.emergency?.powerSourceCircuitId && definition.unavailableCircuitIds.includes(object.emergency.powerSourceCircuitId) && Number(object.emergency.backupPowerMinutes ?? 0) < definition.durationMinutes).map((object: any) => ({ objectId: object.id, circuitId: object.emergency.powerSourceCircuitId, backupPowerMinutes: Number(object.emergency.backupPowerMinutes ?? 0), requiredMinutes: definition.durationMinutes })).sort((left: any, right: any) => left.objectId.localeCompare(right.objectId));
  const hardFailures: any = [
    ...(unreachableZoneObjectIds.length ? [{ code: "UNREACHABLE_ZONES", affectedObjectIds: unreachableZoneObjectIds }] : []),
    ...(availableExitCapacityPersons < operationalLoadPersons ? [{ code: "EXIT_CAPACITY_SHORTFALL", affectedObjectIds: reachableExitObjectIds, actual: availableExitCapacityPersons, required: operationalLoadPersons }] : []),
    ...powerFailures.map((failure: any) => ({ code: "BACKUP_POWER_SHORTFALL", affectedObjectIds: [failure.objectId], actual: failure.backupPowerMinutes, required: failure.requiredMinutes })),
  ];
  const result: any = {
    schemaVersion: 1,
    kind: "emergency-degraded-scenario-result",
    scenarioId: definition.id,
    scenarioType: definition.type,
    planId: plan.id,
    planVersion: plan.version,
    geometryFingerprint: plan.spatial.fingerprint,
    assumptions: [...emergencyPlan.assumptions, ...definition.assumptions].sort(),
    unavailableObjectIds: definition.unavailableObjectIds,
    unavailableCircuitIds: definition.unavailableCircuitIds,
    baselinePaths,
    scenarioPaths,
    affectedZoneObjectIds,
    alternativeRoutes,
    unreachableZoneObjectIds,
    reachableExitObjectIds,
    capacityImpact: { baselineExitCapacityPersons, availableExitCapacityPersons, deltaPersons: availableExitCapacityPersons - baselineExitCapacityPersons, operationalLoadPersons, shortfallPersons: Math.max(0, operationalLoadPersons - availableExitCapacityPersons) },
    powerFailures,
    hardFailures,
    unresolvedHardFailures: hardFailures.length,
    status: hardFailures.length ? "fail" : "pass",
  };
  result.evidenceFingerprint = stableFingerprint("emergency-scenario", result);
  return result;
};

export function analyzeEmergencyPlan(plan: any) {
  const emergencyPlan: any = normalizeEmergencyPlan(plan.emergencyPlan);
  const spatialEvidence: any = analyzeSpatialPlan({ plan }).evidence;
  const exits: any = plan.objects.filter((object: any) => object.kind === "fire_exit").sort((left: any, right: any) => left.id.localeCompare(right.id));
  const assemblyPoints: any = plan.objects.filter((object: any) => object.kind === "assembly_point").sort((left: any, right: any) => left.id.localeCompare(right.id));
  const accessLanes: any = plan.objects.filter((object: any) => object.kind === "emergency_access_lane").sort((left: any, right: any) => left.id.localeCompare(right.id));
  const fireEquipment: any = plan.objects.filter((object: any) => object.kind === "fire_equipment").sort((left: any, right: any) => left.id.localeCompare(right.id));
  const firstAidPosts: any = plan.objects.filter((object: any) => object.kind === "first_aid").sort((left: any, right: any) => left.id.localeCompare(right.id));
  const commandPosts: any = plan.objects.filter((object: any) => object.kind === "command_post").sort((left: any, right: any) => left.id.localeCompare(right.id));
  const operationalLoadPersons: any = spatialEvidence.capacity.operationalLoad;
  const totalExitCapacityPersons: any = exits.reduce((sum: any, exit: any) => sum + exit.exit.capacityPersons, 0);
  const totalAssemblyCapacityPersons: any = assemblyPoints.reduce((sum: any, point: any) => sum + point.emergency.capacityPersons, 0);
  const laneBlockers: any = plan.objects.filter((object: any) => object.occupancy?.excludesUsableArea && !["emergency_access_lane", "fire_equipment", "first_aid", "command_post"].includes(object.kind));
  const accessLaneChecks: any = accessLanes.map((lane: any) => {
    const obstructingObjectIds: any = laneBlockers.filter((object: any) => footprintsIntersect(lane.footprint, object.footprint)).map((object: any) => object.id).sort();
    return { laneObjectId: lane.id, clearWidthM: lane.footprint.width, minimumClearWidthM: emergencyPlan.minimumEmergencyAccessWidthM, obstructingObjectIds, status: lane.footprint.width >= emergencyPlan.minimumEmergencyAccessWidthM && obstructingObjectIds.length === 0 ? "pass" : "fail" };
  });
  const occupiedZones: any = plan.objects.filter((object: any) => object.kind === "seating_section" && object.capacity > 0);
  const fireCoverage: any = occupiedZones.map((zone: any) => {
    const coveringEquipmentObjectIds: any = fireEquipment.filter((equipment: any) => distance(centerOf(zone.footprint), centerOf(equipment.footprint)) <= Number(equipment.emergency.coverageRadiusM ?? 0)).map((equipment: any) => equipment.id).sort();
    return { zoneObjectId: zone.id, coveringEquipmentObjectIds, status: coveringEquipmentObjectIds.length ? "covered" : "gap" };
  });
  const fireEquipmentCoverageRatio: any = fireCoverage.length ? round(fireCoverage.filter((item: any) => item.status === "covered").length / fireCoverage.length) : 0;
  const assemblyChecks: any = assemblyPoints.map((point: any) => ({ assemblyPointObjectId: point.id, capacityPersons: point.emergency.capacityPersons, designatedExitObjectIds: uniqueStrings(point.emergency.designatedExitObjectIds), missingExitObjectIds: uniqueStrings(point.emergency.designatedExitObjectIds).filter((id: any) => !exits.some((exit: any) => exit.id === id)), status: uniqueStrings(point.emergency.designatedExitObjectIds).length > 0 && uniqueStrings(point.emergency.designatedExitObjectIds).every((id: any) => exits.some((exit: any) => exit.id === id)) ? "pass" : "fail" }));
  const degradedScenarios: any = emergencyPlan.scenarioDefinitions.map((definition: any) => evaluateDegradedScenario(plan, emergencyPlan, spatialEvidence, definition));
  const structuralFailures: any = [
    ...(exits.length < emergencyPlan.minimumExitCount ? [{ code: "EXIT_COUNT", affectedObjectIds: exits.map((exit: any) => exit.id) }] : []),
    ...(totalExitCapacityPersons < emergencyPlan.minimumExitCapacityPersons || totalExitCapacityPersons < operationalLoadPersons ? [{ code: "EXIT_CAPACITY", affectedObjectIds: exits.map((exit: any) => exit.id) }] : []),
    ...(totalAssemblyCapacityPersons < emergencyPlan.minimumAssemblyCapacityPersons || assemblyChecks.some((check: any) => check.status === "fail") ? [{ code: "ASSEMBLY_CAPACITY", affectedObjectIds: assemblyPoints.map((point: any) => point.id) }] : []),
    ...accessLaneChecks.filter((check: any) => check.status === "fail").map((check: any) => ({ code: "EMERGENCY_ACCESS", affectedObjectIds: [check.laneObjectId, ...check.obstructingObjectIds] })),
    ...(fireEquipmentCoverageRatio < emergencyPlan.minimumFireEquipmentCoverageRatio ? [{ code: "FIRE_COVERAGE", affectedObjectIds: [...fireEquipment.map((item: any) => item.id), ...fireCoverage.filter((item: any) => item.status === "gap").map((item: any) => item.zoneObjectId)] }] : []),
    ...(firstAidPosts.length < emergencyPlan.requiredFirstAidPosts ? [{ code: "FIRST_AID", affectedObjectIds: firstAidPosts.map((item: any) => item.id) }] : []),
    ...(commandPosts.length < emergencyPlan.requiredCommandPosts ? [{ code: "COMMAND_POST", affectedObjectIds: commandPosts.map((item: any) => item.id) }] : []),
  ];
  const result: any = {
    schemaVersion: 1,
    kind: "emergency-planning-result",
    planId: plan.id,
    planVersion: plan.version,
    geometryFingerprint: plan.spatial.fingerprint,
    emergencyPlan,
    operationalLoadPersons,
    exitObjectIds: exits.map((exit: any) => exit.id),
    totalExitCapacityPersons,
    assemblyPointObjectIds: assemblyPoints.map((point: any) => point.id),
    totalAssemblyCapacityPersons,
    accessLaneChecks,
    fireEquipmentObjectIds: fireEquipment.map((item: any) => item.id),
    fireCoverage,
    fireEquipmentCoverageRatio,
    firstAidPostObjectIds: firstAidPosts.map((item: any) => item.id),
    commandPostObjectIds: commandPosts.map((item: any) => item.id),
    assemblyChecks,
    structuralFailures,
    degradedScenarios,
    summary: { status: structuralFailures.length ? "fail" : "pass", structuralFailures: structuralFailures.length, degradedScenarioFailures: degradedScenarios.filter((scenario: any) => scenario.status === "fail").length, exitCount: exits.length, totalExitCapacityPersons, totalAssemblyCapacityPersons, accessibleEmergencyRoutes: spatialEvidence.accessibility.connected },
  };
  result.evidenceFingerprint = stableFingerprint("emergency-planning", result);
  return result;
}

export const emergencyChangeObjectIds = (plan: any, changes: any) => {
  const emergencyKinds: any = new Set(["fire_exit", "assembly_point", "emergency_access_lane", "fire_equipment", "first_aid", "command_post"]);
  const objects: any = new Map(plan.objects.map((object: any) => [object.id, object]));
  const changedEmergencyIds: any = (changes ?? []).flatMap((change: any) => {
    const existingIds: any = (change.targetObjectIds ?? []).filter((id: any) => {
      const object: any = objects.get(id);
      return object && (emergencyKinds.has(object.kind) || object.emergency);
    });
    const addedObjects: any = (change.spatialEffects ?? [])
      .filter((effect: any) => effect.operation === "add_object" && effect.object)
      .map((effect: any) => effect.object)
      .filter((object: any) => emergencyKinds.has(object.kind) || object.emergency)
      .map((object: any) => object.id);
    return [...existingIds, ...addedObjects];
  });
  return [...new Set(changedEmergencyIds)].sort();
};
