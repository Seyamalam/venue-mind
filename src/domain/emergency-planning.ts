import { stableFingerprint } from "./activity-ledger.ts";
import { analyzeSpatialPlan, footprintsIntersect } from "./spatial-analysis.ts";
import type {
  EmergencyMetadata,
  EmergencyPlan,
  EmergencyScenarioDefinition,
  ExitMetadata,
  Footprint,
  LineFootprint,
  Point,
  VenueObject,
  VenuePlan,
} from "./geometry.ts";
import type { PlanningChange } from "./planning-effects.ts";

const clone = <T>(value: T): T => structuredClone(value);
const round = (value: number, precision = 3): number => Number(value.toFixed(precision));
const distance = (left: Point, right: Point): number => Math.hypot(right.x - left.x, right.y - left.y);

const centerOf = (footprint: Footprint): Point => {
  if (footprint.kind === "rectangle" || footprint.kind === "circle") return clone(footprint.center);
  if (footprint.kind === "line")
    return { x: round((footprint.start.x + footprint.end.x) / 2), y: round((footprint.start.y + footprint.end.y) / 2) };
  return {
    x: round(footprint.points.reduce((sum, point) => sum + point.x, 0) / footprint.points.length),
    y: round(footprint.points.reduce((sum, point) => sum + point.y, 0) / footprint.points.length),
  };
};

const pointToSegmentDistance = (point: Point, start: Point, end: Point): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return distance(point, start);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return distance(point, { x: start.x + ratio * dx, y: start.y + ratio * dy });
};

const pointTouchesFootprint = (point: Point, footprint: Footprint, tolerance = 0.2): boolean => {
  if (footprint.kind === "circle") return distance(point, footprint.center) <= footprint.radius + tolerance;
  if (footprint.kind === "line")
    return pointToSegmentDistance(point, footprint.start, footprint.end) <= footprint.width / 2 + tolerance;
  if (footprint.kind === "rectangle") {
    const radians = (-(footprint.rotationDegrees ?? 0) * Math.PI) / 180;
    const dx = point.x - footprint.center.x;
    const dy = point.y - footprint.center.y;
    const x = dx * Math.cos(radians) - dy * Math.sin(radians);
    const y = dx * Math.sin(radians) + dy * Math.cos(radians);
    return Math.abs(x) <= footprint.width / 2 + tolerance && Math.abs(y) <= footprint.depth / 2 + tolerance;
  }
  if (footprint.kind === "polygon") {
    let inside = false;
    for (
      let current = 0, previous = footprint.points.length - 1;
      current < footprint.points.length;
      previous = current, current += 1
    ) {
      const a = footprint.points[current];
      const b = footprint.points[previous];
      if (a && b && a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
        inside = !inside;
    }
    return inside;
  }
  return false;
};

const uniqueStrings = (values: readonly string[] = []): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();

export const EMERGENCY_SCENARIO_TYPES = Object.freeze(["blocked-exit", "unavailable-corridor", "power-loss"]);
export const EMERGENCY_REVIEWER_ROLES = Object.freeze(["safety-officer", "venue-administrator"]);

type SpatialEvidence = ReturnType<typeof analyzeSpatialPlan>["evidence"];
interface CirculationGraph {
  nodes: SpatialEvidence["circulation"]["graphNodes"];
  edges: SpatialEvidence["circulation"]["graphEdges"];
}
type ExitObject = VenueObject & { exit: ExitMetadata };
type EmergencyObject = VenueObject & { emergency: EmergencyMetadata };
type EmergencyLaneObject = VenueObject & { footprint: LineFootprint };
const isExitObject = (object: VenueObject): object is ExitObject =>
  object.kind === "fire_exit" && object.exit !== undefined;
const hasEmergencyMetadata = (object: VenueObject): object is EmergencyObject => object.emergency !== undefined;
const isEmergencyLane = (object: VenueObject): object is EmergencyLaneObject =>
  object.kind === "emergency_access_lane" && object.footprint.kind === "line";

export function normalizeEmergencyPlan(value: Partial<EmergencyPlan> = {}): EmergencyPlan {
  const defaultScenarios: EmergencyScenarioDefinition[] = [
    {
      id: "scenario-blocked-exit",
      label: "Blocked exit",
      type: "blocked-exit",
      unavailableObjectIds: [],
      unavailableCircuitIds: [],
      durationMinutes: 120,
      assumptions: ["one-exit-unavailable"],
    },
    {
      id: "scenario-unavailable-corridor",
      label: "Unavailable corridor",
      type: "unavailable-corridor",
      unavailableObjectIds: [],
      unavailableCircuitIds: [],
      durationMinutes: 120,
      assumptions: ["one-corridor-unavailable"],
    },
    {
      id: "scenario-power-loss",
      label: "Power loss",
      type: "power-loss",
      unavailableObjectIds: [],
      unavailableCircuitIds: [],
      durationMinutes: 120,
      assumptions: ["utility-power-unavailable"],
    },
  ];
  const scenarioDefinitions = (value.scenarioDefinitions?.length ? value.scenarioDefinitions : defaultScenarios).map(
    (scenario) => ({
      id: String(scenario.id),
      label: String(scenario.label ?? scenario.id),
      type: scenario.type,
      unavailableObjectIds: uniqueStrings(scenario.unavailableObjectIds),
      unavailableCircuitIds: uniqueStrings(scenario.unavailableCircuitIds),
      durationMinutes: Math.trunc(Number(scenario.durationMinutes ?? 120)),
      assumptions: uniqueStrings(scenario.assumptions),
    }),
  );
  if (
    new Set(scenarioDefinitions.map((item) => item.id)).size !== scenarioDefinitions.length ||
    scenarioDefinitions.some(
      (item) =>
        !item.id ||
        !EMERGENCY_SCENARIO_TYPES.includes(item.type) ||
        !Number.isInteger(item.durationMinutes) ||
        item.durationMinutes <= 0,
    )
  )
    throw new Error("Emergency scenarios require unique IDs, supported types, and positive durations");
  const requiredTypes = new Set(EMERGENCY_SCENARIO_TYPES);
  if ([...requiredTypes].some((type) => !scenarioDefinitions.some((item) => item.type === type)))
    throw new Error("Emergency Plan requires blocked-exit, unavailable-corridor, and power-loss scenarios");
  const authorizedReviewerRoles = uniqueStrings(value.authorizedReviewerRoles ?? EMERGENCY_REVIEWER_ROLES);
  if (
    !authorizedReviewerRoles.length ||
    authorizedReviewerRoles.some((role) => !EMERGENCY_REVIEWER_ROLES.includes(role))
  )
    throw new Error("Emergency Plan requires supported authorized reviewer roles");
  const numeric = (field: keyof EmergencyPlan, fallback: number, integer = false): number => {
    const result = Number(value[field] ?? fallback);
    if (!Number.isFinite(result) || result <= 0 || (integer && !Number.isInteger(result)))
      throw new Error(`Emergency Plan ${field} must be positive`);
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
    assumptions: uniqueStrings(
      value.assumptions ?? ["all-attendees-evacuate", "staff-assist-access-needs", "no-lift-use-during-fire"],
    ),
  };
}

interface ShortestPathResult {
  targetNodeId: string;
  distanceM: number;
  routeObjectIds: string[];
}
const shortestPath = (
  graph: CirculationGraph,
  sourceNodeIds: readonly string[],
  targetNodeIds: readonly string[],
  excludedRouteObjectIds: ReadonlySet<string> = new Set(),
): ShortestPathResult | null => {
  const targets = new Set(targetNodeIds);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const distances = new Map(graph.nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const queue = new Set(graph.nodes.map((node) => node.id));
  for (const id of sourceNodeIds) if (distances.has(id)) distances.set(id, 0);
  while (queue.size) {
    const currentId = [...queue].sort(
      (left, right) =>
        (distances.get(left) ?? Number.POSITIVE_INFINITY) - (distances.get(right) ?? Number.POSITIVE_INFINITY) ||
        left.localeCompare(right),
    )[0];
    if (!currentId) break;
    queue.delete(currentId);
    const currentDistance = distances.get(currentId) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(currentDistance)) break;
    if (targets.has(currentId)) {
      const routeObjectIds: string[] = [];
      let cursor = currentId;
      while (previous.has(cursor)) {
        const step = previous.get(cursor);
        if (!step) break;
        const edge = edges.get(step.edgeId);
        if (edge) routeObjectIds.push(edge.objectId);
        cursor = step.nodeId;
      }
      return {
        targetNodeId: currentId,
        distanceM: round(currentDistance),
        routeObjectIds: [...new Set(routeObjectIds)].sort(),
      };
    }
    for (const edgeId of nodes.get(currentId)?.edgeIds ?? []) {
      const edge = edges.get(edgeId);
      if (!edge || edge.blockedByObjectIds.length || excludedRouteObjectIds.has(edge.objectId)) continue;
      const neighborId = edge.startNodeId === currentId ? edge.endNodeId : edge.startNodeId;
      if (!queue.has(neighborId)) continue;
      const candidate = currentDistance + edge.lengthM;
      if (candidate < (distances.get(neighborId) ?? Number.POSITIVE_INFINITY)) {
        distances.set(neighborId, candidate);
        previous.set(neighborId, { nodeId: currentId, edgeId });
      }
    }
  }
  return null;
};

const pathSet = (path: { exitObjectId?: string | null; routeObjectIds?: readonly string[] } | undefined) =>
  `${path?.exitObjectId ?? "none"}:${(path?.routeObjectIds ?? []).join("|")}`;

const evaluateDegradedScenario = (
  plan: VenuePlan,
  emergencyPlan: EmergencyPlan,
  spatialEvidence: SpatialEvidence,
  definition: EmergencyScenarioDefinition,
) => {
  const objects = new Map(plan.objects.map((object) => [object.id, object]));
  const graph = { nodes: spatialEvidence.circulation.graphNodes, edges: spatialEvidence.circulation.graphEdges };
  const exits = plan.objects.filter(isExitObject);
  const occupiedZones = plan.objects.filter(
    (object) => object.kind === "seating_section" && (object.capacity ?? 0) > 0,
  );
  const unavailable = new Set(definition.unavailableObjectIds);
  const availableExits = exits.filter((exit) => !unavailable.has(exit.id));
  const exitNodes = new Map(
    availableExits.map((exit) => [
      exit.id,
      graph.nodes.filter((node) => pointTouchesFootprint(node.point, exit.footprint)).map((node) => node.id),
    ]),
  );
  const allExitNodeIds = [...exitNodes.values()].flat();
  const exitForNode = (nodeId: string) =>
    availableExits.find((exit) => (exitNodes.get(exit.id) ?? []).includes(nodeId))?.id ?? null;
  const pathsFor = (excluded: ReadonlySet<string> = new Set()) =>
    occupiedZones.map((zone) => {
      const sourceNodeIds = graph.nodes
        .filter((node) => pointTouchesFootprint(node.point, zone.footprint))
        .map((node) => node.id);
      const path = shortestPath(graph, sourceNodeIds, allExitNodeIds, excluded);
      return {
        zoneObjectId: zone.id,
        sourceNodeIds,
        ...(path
          ? { ...path, exitObjectId: exitForNode(path.targetNodeId), status: "available" }
          : { targetNodeId: null, exitObjectId: null, distanceM: null, routeObjectIds: [], status: "unavailable" }),
      };
    });
  const baselineExitNodes = new Map(
    exits.map((exit) => [
      exit.id,
      graph.nodes.filter((node) => pointTouchesFootprint(node.point, exit.footprint)).map((node) => node.id),
    ]),
  );
  const baselineTargets = [...baselineExitNodes.values()].flat();
  const baselineExitForNode = (nodeId: string) =>
    exits.find((exit) => (baselineExitNodes.get(exit.id) ?? []).includes(nodeId))?.id ?? null;
  const baselinePaths = occupiedZones.map((zone) => {
    const sources = graph.nodes
      .filter((node) => pointTouchesFootprint(node.point, zone.footprint))
      .map((node) => node.id);
    const path = shortestPath(graph, sources, baselineTargets);
    return {
      zoneObjectId: zone.id,
      ...(path
        ? { ...path, exitObjectId: baselineExitForNode(path.targetNodeId), status: "available" }
        : { exitObjectId: null, routeObjectIds: [], status: "unavailable" }),
    };
  });
  const excludedRoutes = new Set(
    definition.unavailableObjectIds.filter((id) => graph.edges.some((edge) => edge.objectId === id)),
  );
  const scenarioPaths = pathsFor(excludedRoutes);
  const affectedZoneObjectIds = scenarioPaths
    .filter((path) => pathSet(path) !== pathSet(baselinePaths.find((item) => item.zoneObjectId === path.zoneObjectId)))
    .map((path) => path.zoneObjectId)
    .sort();
  const alternativeRoutes = scenarioPaths
    .filter((path) => affectedZoneObjectIds.includes(path.zoneObjectId) && path.status === "available")
    .map((path) => ({
      zoneObjectId: path.zoneObjectId,
      exitObjectId: path.exitObjectId,
      routeObjectIds: path.routeObjectIds,
      distanceM: path.distanceM,
    }));
  const unreachableZoneObjectIds = scenarioPaths
    .filter((path) => path.status === "unavailable")
    .map((path) => path.zoneObjectId)
    .sort();
  const reachableExitObjectIds = [
    ...new Set(scenarioPaths.flatMap((path) => (path.exitObjectId ? [path.exitObjectId] : []))),
  ].sort();
  const baselineExitCapacityPersons = exits.reduce((sum, exit) => sum + exit.exit.capacityPersons, 0);
  const availableExitCapacityPersons = reachableExitObjectIds.reduce(
    (sum, id) => sum + (objects.get(id)?.exit?.capacityPersons ?? 0),
    0,
  );
  const operationalLoadPersons = spatialEvidence.capacity.operationalLoad;
  const powerFailures = plan.objects
    .flatMap((object) => {
      const emergency = object.emergency;
      return emergency?.powerSourceCircuitId &&
        definition.unavailableCircuitIds.includes(emergency.powerSourceCircuitId) &&
        Number(emergency.backupPowerMinutes ?? 0) < definition.durationMinutes
        ? [
            {
              objectId: object.id,
              circuitId: emergency.powerSourceCircuitId,
              backupPowerMinutes: Number(emergency.backupPowerMinutes ?? 0),
              requiredMinutes: definition.durationMinutes,
            },
          ]
        : [];
    })
    .sort((left, right) => left.objectId.localeCompare(right.objectId));
  const hardFailures = [
    ...(unreachableZoneObjectIds.length
      ? [{ code: "UNREACHABLE_ZONES", affectedObjectIds: unreachableZoneObjectIds }]
      : []),
    ...(availableExitCapacityPersons < operationalLoadPersons
      ? [
          {
            code: "EXIT_CAPACITY_SHORTFALL",
            affectedObjectIds: reachableExitObjectIds,
            actual: availableExitCapacityPersons,
            required: operationalLoadPersons,
          },
        ]
      : []),
    ...powerFailures.map((failure) => ({
      code: "BACKUP_POWER_SHORTFALL",
      affectedObjectIds: [failure.objectId],
      actual: failure.backupPowerMinutes,
      required: failure.requiredMinutes,
    })),
  ];
  const result = {
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
    capacityImpact: {
      baselineExitCapacityPersons,
      availableExitCapacityPersons,
      deltaPersons: availableExitCapacityPersons - baselineExitCapacityPersons,
      operationalLoadPersons,
      shortfallPersons: Math.max(0, operationalLoadPersons - availableExitCapacityPersons),
    },
    powerFailures,
    hardFailures,
    unresolvedHardFailures: hardFailures.length,
    status: hardFailures.length ? "fail" : "pass",
    evidenceFingerprint: "",
  };
  result.evidenceFingerprint = stableFingerprint("emergency-scenario", result);
  return result;
};

export function analyzeEmergencyPlan(plan: VenuePlan) {
  const emergencyPlan = normalizeEmergencyPlan(plan.emergencyPlan);
  const spatialEvidence = analyzeSpatialPlan({ plan }).evidence;
  const exits = plan.objects.filter(isExitObject).sort((left, right) => left.id.localeCompare(right.id));
  const assemblyPoints = plan.objects
    .filter((object): object is EmergencyObject => object.kind === "assembly_point" && hasEmergencyMetadata(object))
    .sort((left, right) => left.id.localeCompare(right.id));
  const accessLanes = plan.objects.filter(isEmergencyLane).sort((left, right) => left.id.localeCompare(right.id));
  const fireEquipment = plan.objects
    .filter((object): object is EmergencyObject => object.kind === "fire_equipment" && hasEmergencyMetadata(object))
    .sort((left, right) => left.id.localeCompare(right.id));
  const firstAidPosts = plan.objects
    .filter((object) => object.kind === "first_aid")
    .sort((left, right) => left.id.localeCompare(right.id));
  const commandPosts = plan.objects
    .filter((object) => object.kind === "command_post")
    .sort((left, right) => left.id.localeCompare(right.id));
  const operationalLoadPersons = spatialEvidence.capacity.operationalLoad;
  const totalExitCapacityPersons = exits.reduce((sum, exit) => sum + exit.exit.capacityPersons, 0);
  const totalAssemblyCapacityPersons = assemblyPoints.reduce(
    (sum, point) => sum + (point.emergency.capacityPersons ?? 0),
    0,
  );
  const laneBlockers = plan.objects.filter(
    (object) =>
      object.occupancy?.excludesUsableArea &&
      !["emergency_access_lane", "fire_equipment", "first_aid", "command_post"].includes(object.kind),
  );
  const accessLaneChecks = accessLanes.map((lane) => {
    const obstructingObjectIds = laneBlockers
      .filter((object) => footprintsIntersect(lane.footprint, object.footprint))
      .map((object) => object.id)
      .sort();
    return {
      laneObjectId: lane.id,
      clearWidthM: lane.footprint.width,
      minimumClearWidthM: emergencyPlan.minimumEmergencyAccessWidthM,
      obstructingObjectIds,
      status:
        lane.footprint.width >= emergencyPlan.minimumEmergencyAccessWidthM && obstructingObjectIds.length === 0
          ? "pass"
          : "fail",
    };
  });
  const occupiedZones = plan.objects.filter(
    (object) => object.kind === "seating_section" && (object.capacity ?? 0) > 0,
  );
  const fireCoverage = occupiedZones.map((zone) => {
    const coveringEquipmentObjectIds = fireEquipment
      .filter(
        (equipment) =>
          distance(centerOf(zone.footprint), centerOf(equipment.footprint)) <=
          Number(equipment.emergency.coverageRadiusM ?? 0),
      )
      .map((equipment) => equipment.id)
      .sort();
    return {
      zoneObjectId: zone.id,
      coveringEquipmentObjectIds,
      status: coveringEquipmentObjectIds.length ? "covered" : "gap",
    };
  });
  const fireEquipmentCoverageRatio = fireCoverage.length
    ? round(fireCoverage.filter((item) => item.status === "covered").length / fireCoverage.length)
    : 0;
  const assemblyChecks = assemblyPoints.map((point) => ({
    assemblyPointObjectId: point.id,
    capacityPersons: point.emergency.capacityPersons,
    designatedExitObjectIds: uniqueStrings(point.emergency.designatedExitObjectIds),
    missingExitObjectIds: uniqueStrings(point.emergency.designatedExitObjectIds).filter(
      (id) => !exits.some((exit) => exit.id === id),
    ),
    status:
      uniqueStrings(point.emergency.designatedExitObjectIds).length > 0 &&
      uniqueStrings(point.emergency.designatedExitObjectIds).every((id) => exits.some((exit) => exit.id === id))
        ? "pass"
        : "fail",
  }));
  const degradedScenarios = emergencyPlan.scenarioDefinitions.map((definition) =>
    evaluateDegradedScenario(plan, emergencyPlan, spatialEvidence, definition),
  );
  const structuralFailures = [
    ...(exits.length < emergencyPlan.minimumExitCount
      ? [{ code: "EXIT_COUNT", affectedObjectIds: exits.map((exit) => exit.id) }]
      : []),
    ...(totalExitCapacityPersons < emergencyPlan.minimumExitCapacityPersons ||
    totalExitCapacityPersons < operationalLoadPersons
      ? [{ code: "EXIT_CAPACITY", affectedObjectIds: exits.map((exit) => exit.id) }]
      : []),
    ...(totalAssemblyCapacityPersons < emergencyPlan.minimumAssemblyCapacityPersons ||
    assemblyChecks.some((check) => check.status === "fail")
      ? [{ code: "ASSEMBLY_CAPACITY", affectedObjectIds: assemblyPoints.map((point) => point.id) }]
      : []),
    ...accessLaneChecks
      .filter((check) => check.status === "fail")
      .map((check) => ({
        code: "EMERGENCY_ACCESS",
        affectedObjectIds: [check.laneObjectId, ...check.obstructingObjectIds],
      })),
    ...(fireEquipmentCoverageRatio < emergencyPlan.minimumFireEquipmentCoverageRatio
      ? [
          {
            code: "FIRE_COVERAGE",
            affectedObjectIds: [
              ...fireEquipment.map((item) => item.id),
              ...fireCoverage.filter((item) => item.status === "gap").map((item) => item.zoneObjectId),
            ],
          },
        ]
      : []),
    ...(firstAidPosts.length < emergencyPlan.requiredFirstAidPosts
      ? [{ code: "FIRST_AID", affectedObjectIds: firstAidPosts.map((item) => item.id) }]
      : []),
    ...(commandPosts.length < emergencyPlan.requiredCommandPosts
      ? [{ code: "COMMAND_POST", affectedObjectIds: commandPosts.map((item) => item.id) }]
      : []),
  ];
  const result = {
    schemaVersion: 1,
    kind: "emergency-planning-result",
    planId: plan.id,
    planVersion: plan.version,
    geometryFingerprint: plan.spatial.fingerprint,
    emergencyPlan,
    operationalLoadPersons,
    exitObjectIds: exits.map((exit) => exit.id),
    totalExitCapacityPersons,
    assemblyPointObjectIds: assemblyPoints.map((point) => point.id),
    totalAssemblyCapacityPersons,
    accessLaneChecks,
    fireEquipmentObjectIds: fireEquipment.map((item) => item.id),
    fireCoverage,
    fireEquipmentCoverageRatio,
    firstAidPostObjectIds: firstAidPosts.map((item) => item.id),
    commandPostObjectIds: commandPosts.map((item) => item.id),
    assemblyChecks,
    structuralFailures,
    degradedScenarios,
    summary: {
      status: structuralFailures.length ? "fail" : "pass",
      structuralFailures: structuralFailures.length,
      degradedScenarioFailures: degradedScenarios.filter((scenario) => scenario.status === "fail").length,
      exitCount: exits.length,
      totalExitCapacityPersons,
      totalAssemblyCapacityPersons,
      accessibleEmergencyRoutes: spatialEvidence.accessibility.connected,
    },
    evidenceFingerprint: "",
  };
  result.evidenceFingerprint = stableFingerprint("emergency-planning", result);
  return result;
}

export const emergencyChangeObjectIds = (plan: VenuePlan, changes: readonly PlanningChange[] = []): string[] => {
  const emergencyKinds = new Set([
    "fire_exit",
    "assembly_point",
    "emergency_access_lane",
    "fire_equipment",
    "first_aid",
    "command_post",
  ]);
  const objects = new Map(plan.objects.map((object) => [object.id, object]));
  const changedEmergencyIds = (changes ?? []).flatMap((change) => {
    const existingIds = (change.targetObjectIds ?? []).filter((id) => {
      const object = objects.get(id);
      return object && (emergencyKinds.has(object.kind) || object.emergency);
    });
    const addedObjects = (change.spatialEffects ?? [])
      .flatMap((effect) => (effect.operation === "add_object" && effect.object ? [effect.object] : []))
      .filter((object) => emergencyKinds.has(object.kind) || object.emergency)
      .map((object) => object.id);
    return [...existingIds, ...addedObjects];
  });
  return [...new Set(changedEmergencyIds)].sort();
};
