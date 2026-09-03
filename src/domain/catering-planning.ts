import { stableFingerprint } from "./activity-ledger.ts";
import { footprintsIntersect } from "./spatial-analysis.ts";
import { evaluateInventoryAvailability, getInventoryTemplate } from "./venue-templates.ts";
import type { CateringPolicy, Footprint, LineFootprint, Point, VenueObject, VenuePlan } from "./geometry.ts";

const clone = <T>(value: T): T => structuredClone(value);
const round = (value: number, precision = 3): number => Number(value.toFixed(precision));
type CsvValue = string | number | boolean | null | undefined;
const csv = (value: CsvValue): string => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const centerOf = (footprint: Footprint): Point => {
  if (footprint.kind === "rectangle" || footprint.kind === "circle") return clone(footprint.center);
  if (footprint.kind === "line")
    return { x: round((footprint.start.x + footprint.end.x) / 2), y: round((footprint.start.y + footprint.end.y) / 2) };
  const points = footprint.points;
  return {
    x: round(points.reduce((sum, point) => sum + point.x, 0) / points.length),
    y: round(points.reduce((sum, point) => sum + point.y, 0) / points.length),
  };
};

const extentRadius = (footprint: Footprint): number => {
  if (footprint.kind === "circle") return footprint.radius;
  if (footprint.kind === "rectangle") return Math.hypot(footprint.width / 2, footprint.depth / 2);
  if (footprint.kind === "line")
    return (
      Math.hypot(footprint.end.x - footprint.start.x, footprint.end.y - footprint.start.y) / 2 + footprint.width / 2
    );
  if (footprint.kind === "polygon") {
    const center = centerOf(footprint);
    return Math.max(0, ...footprint.points.map((point) => Math.hypot(point.x - center.x, point.y - center.y)));
  }
  return 0;
};

const pointToSegmentDistance = (point: Point, start: Point, end: Point): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
};
const boundaryPoints = (footprint: Footprint): Point[] => {
  if (footprint.kind === "rectangle")
    return [
      { x: footprint.center.x - footprint.width / 2, y: footprint.center.y - footprint.depth / 2 },
      { x: footprint.center.x + footprint.width / 2, y: footprint.center.y - footprint.depth / 2 },
      { x: footprint.center.x + footprint.width / 2, y: footprint.center.y + footprint.depth / 2 },
      { x: footprint.center.x - footprint.width / 2, y: footprint.center.y + footprint.depth / 2 },
    ];
  if (footprint.kind === "polygon") return footprint.points;
  if (footprint.kind === "circle") return [footprint.center];
  if (footprint.kind === "line") return [footprint.start, footprint.end];
  return [centerOf(footprint)];
};
const lineDistance = (line: LineFootprint, other: Footprint): number =>
  Math.max(
    0,
    Math.min(...boundaryPoints(other).map((point) => pointToSegmentDistance(point, line.start, line.end))) -
      line.width / 2 -
      (other.kind === "circle" ? other.radius : 0),
  );
const edgeDistance = (left: Footprint, right: Footprint): number => {
  if (footprintsIntersect(left, right)) return 0;
  if (left.kind === "line") return round(lineDistance(left, right));
  if (right.kind === "line") return round(lineDistance(right, left));
  return round(
    Math.max(
      0,
      Math.hypot(centerOf(left).x - centerOf(right).x, centerOf(left).y - centerOf(right).y) -
        extentRadius(left) -
        extentRadius(right),
    ),
  );
};
const uniqueStrings = (values: readonly string[] = []): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();

export const CATERING_STATION_TYPES = Object.freeze(["bar", "buffet", "service-counter"]);
export const CATERING_SUPPORT_TYPES = Object.freeze([
  "kitchen",
  "prep",
  "waste",
  "water",
  "queue-zone",
  "replenishment-route",
]);

export function normalizeCateringPolicy(value: Partial<CateringPolicy> = {}): CateringPolicy {
  const phases = (
    value.phases ?? [
      { id: "phase-arrival", label: "Arrival", durationMinutes: 45, demandRatio: 0.25 },
      { id: "phase-break", label: "Break", durationMinutes: 30, demandRatio: 0.75 },
      { id: "phase-lunch", label: "Lunch", durationMinutes: 60, demandRatio: 1 },
    ]
  ).map((phase) => ({
    id: String(phase.id),
    label: String(phase.label ?? phase.id),
    durationMinutes: Number(phase.durationMinutes),
    demandRatio: Number(phase.demandRatio),
  }));
  if (
    !phases.length ||
    new Set(phases.map((phase) => phase.id)).size !== phases.length ||
    phases.some(
      (phase) =>
        !phase.id ||
        !Number.isFinite(phase.durationMinutes) ||
        phase.durationMinutes <= 0 ||
        !Number.isFinite(phase.demandRatio) ||
        phase.demandRatio < 0 ||
        phase.demandRatio > 1,
    )
  )
    throw new Error("Catering phases require unique IDs, positive durations, and demand ratios from zero to one");
  const minimumSeparationFromProductionM = Number(value.minimumSeparationFromProductionM ?? 0.5);
  const minimumSeparationFromEmergencyM = Number(value.minimumSeparationFromEmergencyM ?? 1);
  const maximumAccessibleServiceHeightM = Number(value.maximumAccessibleServiceHeightM ?? 0.915);
  const minimumAccessibleServicePoints = Math.trunc(Number(value.minimumAccessibleServicePoints ?? 1));
  const queueHorizonMinutes = Number(value.queueHorizonMinutes ?? 10);
  if (
    ![
      minimumSeparationFromProductionM,
      minimumSeparationFromEmergencyM,
      maximumAccessibleServiceHeightM,
      queueHorizonMinutes,
    ].every((item) => Number.isFinite(item) && item > 0) ||
    !Number.isInteger(minimumAccessibleServicePoints) ||
    minimumAccessibleServicePoints < 1
  )
    throw new Error("Catering policy thresholds must be positive");
  return {
    schemaVersion: 1,
    phases,
    minimumSeparationFromProductionM: round(minimumSeparationFromProductionM),
    minimumSeparationFromEmergencyM: round(minimumSeparationFromEmergencyM),
    maximumAccessibleServiceHeightM: round(maximumAccessibleServiceHeightM),
    minimumAccessibleServicePoints,
    queueHorizonMinutes: round(queueHorizonMinutes),
    allowedReplenishmentCrossingControls: uniqueStrings(
      value.allowedReplenishmentCrossingControls ?? ["timed-crossing", "marshal"],
    ),
  };
}

const normalizeStation = (object: VenueObject) => {
  const catering = object.catering;
  if (!catering || !CATERING_STATION_TYPES.includes(catering.type))
    throw new Error(`Catering station ${object.id} requires a supported type`);
  const servers = Math.trunc(Number(catering.servers));
  const serviceRatePerServerMinute = Number(catering.serviceRatePerServerMinute);
  const demandShare = Number(catering.demandShare);
  const queueBufferPersons = Math.trunc(Number(catering.queueBufferPersons));
  if (
    !Number.isInteger(servers) ||
    servers < 1 ||
    !Number.isFinite(serviceRatePerServerMinute) ||
    serviceRatePerServerMinute <= 0 ||
    !Number.isFinite(demandShare) ||
    demandShare <= 0 ||
    demandShare > 1 ||
    !Number.isInteger(queueBufferPersons) ||
    queueBufferPersons < 0
  )
    throw new Error(
      `Catering station ${object.id} requires servers, service rate, demand share, and queue buffer capacity`,
    );
  return {
    objectId: object.id,
    label: object.label,
    type: catering.type,
    servers,
    serviceRatePerServerMinute: round(serviceRatePerServerMinute),
    demandShare: round(demandShare),
    queueBufferPersons,
    queueZoneObjectId: catering.queueZoneObjectId ?? null,
    accessibleServicePoint: catering.accessibleServicePoint === true,
    serviceHeightM: Number(catering.serviceHeightM),
    dietaryOptions: uniqueStrings(catering.dietaryOptions),
    allergenLabels: uniqueStrings(catering.allergenLabels),
    replenishmentSourceObjectId: catering.replenishmentSourceObjectId ?? null,
    waterSourceObjectId: catering.waterSourceObjectId ?? null,
  };
};

export function analyzeCateringPlan(plan: VenuePlan) {
  const policy = normalizeCateringPolicy(plan.cateringPolicy);
  const byId = new Map(plan.objects.map((object) => [object.id, object]));
  const stationObjects = plan.objects.filter(
    (object) => ["bar", "buffet", "refreshment"].includes(object.kind) && object.catering?.type,
  );
  const stations = stationObjects
    .map(normalizeStation)
    .sort((left, right) => left.objectId.localeCompare(right.objectId));
  const targetAttendance = Number(plan.event.attendeeTarget ?? 0);
  const demandShareTotal = round(stations.reduce((sum, station) => sum + station.demandShare, 0));
  const demandSharesBalanced = Math.abs(demandShareTotal - 1) <= 0.001;

  const phaseCapacity = policy.phases.map((phase) => {
    const requiredPersons = Math.ceil(targetAttendance * phase.demandRatio);
    const stationResults = stations.map((station) => {
      const allocatedDemandPersons = Math.ceil(requiredPersons * station.demandShare);
      const serviceCapacityPersons = Math.floor(
        station.servers * station.serviceRatePerServerMinute * phase.durationMinutes,
      );
      const demandRatePerMinute = round(allocatedDemandPersons / phase.durationMinutes);
      const serviceRatePerMinute = round(station.servers * station.serviceRatePerServerMinute);
      const utilizationRatio = round(demandRatePerMinute / serviceRatePerMinute);
      const estimatedPeakQueuePersons = Math.ceil(
        Math.max(0, demandRatePerMinute - serviceRatePerMinute) * policy.queueHorizonMinutes,
      );
      return {
        stationObjectId: station.objectId,
        allocatedDemandPersons,
        serviceCapacityPersons,
        demandRatePerMinute,
        serviceRatePerMinute,
        utilizationRatio,
        estimatedPeakQueuePersons,
        queueBufferPersons: station.queueBufferPersons,
        status:
          serviceCapacityPersons >= allocatedDemandPersons && estimatedPeakQueuePersons <= station.queueBufferPersons
            ? "pass"
            : "fail",
      };
    });
    return {
      phaseId: phase.id,
      label: phase.label,
      durationMinutes: phase.durationMinutes,
      demandRatio: phase.demandRatio,
      requiredPersons,
      serviceCapacityPersons: stationResults.reduce((sum, item) => sum + item.serviceCapacityPersons, 0),
      status: demandSharesBalanced && stationResults.every((item) => item.status === "pass") ? "pass" : "fail",
      stations: stationResults,
    };
  });

  const publicRoutes = plan.objects.filter(
    (object) =>
      ["accessible_route", "corridor", "aisle", "service_lane"].includes(object.kind) &&
      object.route?.staffOnly !== true,
  );
  const exits = plan.objects.filter((object) => object.kind === "fire_exit");
  const queueZones = stations.map((station) => ({
    station,
    object: station.queueZoneObjectId ? byId.get(station.queueZoneObjectId) : undefined,
  }));
  const queueConflicts: Array<{
    stationObjectId: string;
    queueZoneObjectId: string | null;
    conflictObjectId: string | null;
    conflictType: string;
    status: "fail";
  }> = [];
  for (const { station, object } of queueZones) {
    if (!object)
      queueConflicts.push({
        stationObjectId: station.objectId,
        queueZoneObjectId: station.queueZoneObjectId,
        conflictObjectId: null,
        conflictType: "missing-queue-zone",
        status: "fail",
      });
    else
      for (const other of [...publicRoutes, ...exits])
        if (footprintsIntersect(object.footprint, other.footprint))
          queueConflicts.push({
            stationObjectId: station.objectId,
            queueZoneObjectId: object.id,
            conflictObjectId: other.id,
            conflictType: other.kind === "fire_exit" ? "emergency-exit" : "public-circulation",
            status: "fail",
          });
  }
  queueConflicts.sort(
    (left, right) =>
      left.stationObjectId.localeCompare(right.stationObjectId) ||
      String(left.conflictObjectId).localeCompare(String(right.conflictObjectId)),
  );

  const serviceObjects = plan.objects.filter((object) =>
    ["bar", "buffet", "refreshment", "kitchen", "prep_zone", "waste_point"].includes(object.kind),
  );
  const productionObjects = plan.objects.filter(
    (object) => object.layer === "production" && object.kind !== "rigging_point",
  );
  const emergencyObjects = plan.objects.filter((object) => object.kind === "fire_exit" || object.emergency?.type);
  const separationChecks = serviceObjects
    .flatMap((serviceObject) => [
      ...productionObjects.map((other) => ({
        serviceObjectId: serviceObject.id,
        otherObjectId: other.id,
        separationType: "production",
        distanceM: edgeDistance(serviceObject.footprint, other.footprint),
        minimumDistanceM: policy.minimumSeparationFromProductionM,
      })),
      ...emergencyObjects.map((other) => ({
        serviceObjectId: serviceObject.id,
        otherObjectId: other.id,
        separationType: "emergency",
        distanceM: edgeDistance(serviceObject.footprint, other.footprint),
        minimumDistanceM: policy.minimumSeparationFromEmergencyM,
      })),
    ])
    .map((check) => ({ ...check, status: check.distanceM >= check.minimumDistanceM ? "pass" : "fail" }))
    .sort(
      (left, right) =>
        left.serviceObjectId.localeCompare(right.serviceObjectId) ||
        left.otherObjectId.localeCompare(right.otherObjectId),
    );

  const accessibleServicePoints = stations.map((station) => ({
    stationObjectId: station.objectId,
    accessibleServicePoint: station.accessibleServicePoint,
    serviceHeightM: Number.isFinite(station.serviceHeightM) ? round(station.serviceHeightM) : null,
    maximumServiceHeightM: policy.maximumAccessibleServiceHeightM,
    status:
      station.accessibleServicePoint &&
      Number.isFinite(station.serviceHeightM) &&
      station.serviceHeightM <= policy.maximumAccessibleServiceHeightM
        ? "pass"
        : "fail",
  }));
  const passingAccessibleServicePoints = accessibleServicePoints.filter((item) => item.status === "pass").length;

  const replenishmentRoutes = plan.objects
    .filter((object) => object.kind === "replenishment_route" || object.catering?.type === "replenishment-route")
    .map((route) => {
      const sourceObjectId = route.catering?.sourceObjectId ?? null;
      const targetObjectIds = uniqueStrings(route.catering?.targetObjectIds);
      const crossingControl = route.catering?.crossingControl ?? "none";
      const crossingObjectIds = publicRoutes
        .filter((other) => other.id !== route.id && footprintsIntersect(route.footprint, other.footprint))
        .map((other) => other.id)
        .sort();
      const missingEndpointIds = [sourceObjectId, ...targetObjectIds].filter((id) => !id || !byId.has(id));
      const controlled =
        crossingObjectIds.length === 0 || policy.allowedReplenishmentCrossingControls.includes(crossingControl);
      return {
        routeObjectId: route.id,
        sourceObjectId,
        targetObjectIds,
        crossingControl,
        crossingObjectIds,
        missingEndpointIds,
        status: missingEndpointIds.length === 0 && controlled ? "pass" : "fail",
      };
    })
    .sort((left, right) => left.routeObjectId.localeCompare(right.routeObjectId));

  const requiredSupport = ["kitchen", "prep_zone", "waste_point", "water_point"];
  const missingSupportKinds = requiredSupport.filter((kind) => !plan.objects.some((object) => object.kind === kind));
  const invalidStationReferences = stations
    .flatMap((station) =>
      [station.replenishmentSourceObjectId, station.waterSourceObjectId].filter((id) => !id || !byId.has(id)),
    )
    .sort();
  const cateringTemplateIds = new Set(
    plan.objects.flatMap((object) =>
      object.layer === "catering" && object.templateRef?.kind === "inventory-item-template"
        ? [object.templateRef.templateId]
        : [],
    ),
  );
  const inventory = evaluateInventoryAvailability(plan)
    .filter((item) => cateringTemplateIds.has(item.templateId))
    .map((item) => ({
      ...item,
      itemName: getInventoryTemplate(item.templateId, item.version).name,
      placedObjectIds: plan.objects
        .filter(
          (object) =>
            object.templateRef?.templateId === item.templateId && object.templateRef?.version === item.version,
        )
        .map((object) => object.id)
        .sort(),
    }));
  const inventoryShortages = inventory
    .filter((item) => item.status === "warning")
    .map((item) => item.templateId)
    .sort();
  const failedCapacityChecks = phaseCapacity.flatMap((phase) =>
    phase.stations.filter((item) => item.status === "fail"),
  );
  const failedSeparations = separationChecks.filter((item) => item.status === "fail");
  const result = {
    schemaVersion: 1,
    kind: "catering-planning-result",
    planId: plan.id,
    planVersion: plan.version,
    geometryFingerprint: plan.spatial.fingerprint,
    policy,
    targetAttendance,
    demandShareTotal,
    stations,
    phaseCapacity,
    queueConflicts,
    separationChecks,
    accessibleServicePoints,
    replenishmentRoutes,
    supportObjectIds: plan.objects
      .filter((object) => requiredSupport.includes(object.kind))
      .map((object) => object.id)
      .sort(),
    missingSupportKinds,
    invalidStationReferences,
    inventory,
    inventoryShortages,
    summary: {
      status:
        stations.length > 0 &&
        demandSharesBalanced &&
        failedCapacityChecks.length === 0 &&
        queueConflicts.length === 0 &&
        failedSeparations.length === 0 &&
        passingAccessibleServicePoints >= policy.minimumAccessibleServicePoints &&
        replenishmentRoutes.length > 0 &&
        replenishmentRoutes.every((route) => route.status === "pass") &&
        missingSupportKinds.length === 0 &&
        invalidStationReferences.length === 0 &&
        inventoryShortages.length === 0
          ? "pass"
          : "fail",
      stationCount: stations.length,
      minimumPhaseServiceCapacityPersons: phaseCapacity.length
        ? Math.min(...phaseCapacity.map((phase) => phase.serviceCapacityPersons))
        : 0,
      queueRiskCount: failedCapacityChecks.length,
      circulationConflictCount:
        queueConflicts.length + replenishmentRoutes.reduce((sum, route) => sum + route.crossingObjectIds.length, 0),
      uncontrolledCirculationConflictCount:
        queueConflicts.length +
        replenishmentRoutes
          .filter((route) => route.status === "fail")
          .reduce((sum, route) => sum + route.crossingObjectIds.length, 0),
      separationFailures: failedSeparations.length,
      accessibleServicePoints: passingAccessibleServicePoints,
      missingSupportObjects: missingSupportKinds.length,
      inventoryShortages: inventoryShortages.length,
    },
    evidenceFingerprint: "",
  };
  result.evidenceFingerprint = stableFingerprint("catering-planning", result);
  return result;
}

export function createServiceStationScheduleCsv(
  plan: VenuePlan,
  result: ReturnType<typeof analyzeCateringPlan> = analyzeCateringPlan(plan),
): string {
  const phaseByStation = new Map(
    result.stations.map((station) => [
      station.objectId,
      result.phaseCapacity.map((phase) => phase.stations.find((item) => item.stationObjectId === station.objectId)),
    ]),
  );
  const rows = result.stations.map((station) => [
    station.objectId,
    station.label,
    station.type,
    station.servers,
    station.serviceRatePerServerMinute,
    station.demandShare,
    station.queueZoneObjectId,
    station.queueBufferPersons,
    station.accessibleServicePoint,
    station.serviceHeightM,
    station.dietaryOptions.join("|"),
    station.allergenLabels.join("|"),
    station.replenishmentSourceObjectId,
    station.waterSourceObjectId,
    ...(phaseByStation.get(station.objectId) ?? []).flatMap((item) =>
      item ? [item.serviceCapacityPersons, item.estimatedPeakQueuePersons, item.status] : ["", "", ""],
    ),
  ]);
  const phaseHeader = result.phaseCapacity.flatMap((phase) => [
    `${phase.phaseId}_capacity`,
    `${phase.phaseId}_peak_queue`,
    `${phase.phaseId}_status`,
  ]);
  return (
    [
      [
        "station_object_id",
        "label",
        "type",
        "servers",
        "service_rate_per_server_minute",
        "demand_share",
        "queue_zone_object_id",
        "queue_buffer_persons",
        "accessible_service_point",
        "service_height_m",
        "dietary_options",
        "allergen_labels",
        "replenishment_source_object_id",
        "water_source_object_id",
        ...phaseHeader,
      ],
      ...rows,
    ]
      .map((row) => row.map(csv).join(","))
      .join("\r\n") + "\r\n"
  );
}

export function createReplenishmentScheduleCsv(
  plan: VenuePlan,
  result: ReturnType<typeof analyzeCateringPlan> = analyzeCateringPlan(plan),
): string {
  const rows = result.replenishmentRoutes.map((route) => [
    route.routeObjectId,
    route.sourceObjectId,
    route.targetObjectIds.join("|"),
    route.crossingControl,
    route.crossingObjectIds.join("|"),
    route.status,
  ]);
  return (
    [
      ["route_object_id", "source_object_id", "target_object_ids", "crossing_control", "crossing_object_ids", "status"],
      ...rows,
    ]
      .map((row) => row.map(csv).join(","))
      .join("\r\n") + "\r\n"
  );
}
