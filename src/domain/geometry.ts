import { normalizeObjectLocks } from "./locks.ts";
import type { ObjectLock } from "./locks.ts";
import type { EventBrief } from "./event-brief.ts";
import type { PlanningChange } from "./planning-effects.ts";

export interface Point {
  x: number;
  y: number;
}
export interface RectangleFootprint {
  kind: "rectangle";
  center: Point;
  width: number;
  depth: number;
  rotationDegrees: number;
}
export interface CircleFootprint {
  kind: "circle";
  center: Point;
  radius: number;
}
export interface LineFootprint {
  kind: "line";
  start: Point;
  end: Point;
  width: number;
}
export interface PolygonFootprint {
  kind: "polygon";
  points: Point[];
  rotationDegrees: number;
}
export type Footprint = RectangleFootprint | CircleFootprint | LineFootprint | PolygonFootprint;
export type SpatialLayer =
  "architecture" | "furniture" | "access" | "production" | "catering" | "safety" | "annotations";
export interface RoomBoundary {
  outer: Point[];
  holes: Point[][];
}
export interface SpatialGeometry {
  schemaVersion: 1;
  unit: "m";
  units: { length: "m"; area: "m2"; angle: "deg"; time: "s" };
  layers: SpatialLayer[];
  coordinateSystem: { origin: "southwest"; xAxis: "east"; yAxis: "north"; rotationDirection: "clockwise" };
  precision: { distance: number; angle: number };
  roomBoundary: RoomBoundary;
  fingerprint?: string;
}
export interface DoorMetadata {
  clearWidthM: number;
  swing: "inward" | "outward" | "sliding" | "revolving";
  accessible: boolean;
  clearance?: { side: "left" | "right" | "both"; depthM: number; latchSideM: number };
}
export interface ExitMetadata {
  clearWidthM: number;
  emergency: boolean;
  capacityPersons: number;
}
export interface RouteMetadata {
  direction: "one-way" | "bidirectional";
  accessible: boolean;
  purpose: string;
  staffOnly?: boolean;
}
export interface RestrictionMetadata {
  access: "prohibited" | "staff-only" | "conditional";
  reasonCode: string;
  blocksPlacement: boolean;
}
export interface RampMetadata {
  riseM: number;
  runM: number;
  clearWidthM: number;
  landingLengthM: number;
  edgeProtectionHeightM: number;
  handrails: boolean;
}
export interface CirculationMetadata {
  role?: "queue" | "checkpoint";
  capacityPersonsPerMinute?: number;
  capacityPersons?: number;
  demandPersons?: number;
  clearWidthM?: number;
  carCapacityPersons?: number;
  cycleSeconds?: number;
  servesZoneIds?: string[];
  blocksPath?: boolean;
  blocksExitApproach?: boolean;
}
export interface QueueMetadata {
  category: string;
  servers: number;
  serviceRatePerServerMinute: number;
  priorityLaneCount: number;
}
export interface StaffPostMetadata {
  coverageZoneObjectIds: string[];
  assignments: Array<{ shiftId: string; roleId: string; count: number }>;
}
export interface UtilityMetadata {
  type: string;
  circuitId: string;
  voltage: number;
  maxWatts: number;
  rating?: string;
  powerKw?: number;
}
export interface RiggingMetadata {
  safeWorkingLoadKg: number;
}
export interface ProductionMetadata {
  equipmentType: string;
  powerWatts?: number;
  weightKg?: number;
  requiresRigging?: boolean;
  riggingPointId?: string;
  targetObjectId?: string;
  targetObjectIds?: string[];
  targetZoneObjectIds?: string[];
  viewableWidthM?: number;
  throwRatioMin?: number;
  throwRatioMax?: number;
  aimPoint?: Point;
  coverageRangeM?: number;
  coverageAngleDegrees?: number;
  minimumDistanceM?: number;
  maximumDistanceM?: number;
  crossingTreatment?: string;
  circuitId?: string;
  [key: string]: string | number | boolean | string[] | Point | undefined;
}
export interface CateringMetadata {
  type: string;
  servers?: number;
  serviceRatePerServerMinute?: number;
  demandShare?: number;
  queueBufferPersons?: number;
  queueZoneObjectId?: string;
  replenishmentSourceObjectId?: string;
  waterSourceObjectId?: string;
  serviceHeightM?: number;
  accessibleServicePoint?: boolean;
  dietaryOptions?: string[];
  allergenLabels?: string[];
  sourceObjectId?: string;
  targetObjectIds?: string[];
  crossingControl?: string;
  attendeeRecords?: null;
  attendeeHealthRecords?: null;
}
export interface EmergencyMetadata {
  type: string;
  capacityPersons?: number;
  designatedExitObjectIds?: string[];
  responderOnly?: boolean;
  equipmentClass?: string;
  coverageRadiusM?: number;
  clearanceM?: number;
  accessible?: boolean;
  backupPowerMinutes?: number;
  powerSourceCircuitId?: string;
}
export interface ObjectOccupancyMetadata {
  expected?: number;
  maximum?: number;
  minimumCapacity?: number;
  maximumCapacity?: number;
  zoneId?: string | null;
  excludesUsableArea?: boolean;
}
interface ObjectAccessibilityMetadata {
  accessible?: boolean;
  destination?: boolean;
  accessibleSeats?: number;
  companionSeats?: number;
  accessibleSeatSampleIds?: string[];
  clearanceExempt?: boolean;
}
interface SightlineFocalPoint {
  id: string;
  point: Point;
  elevationM: number;
  priority?: "primary" | "secondary";
}
interface SightlineSample {
  id: string;
  point: Point;
  eyeHeightM: number;
}
interface ObjectSightlineMetadata {
  focalPoints?: SightlineFocalPoint[];
  samples?: SightlineSample[];
  opacity?: number;
  heightM?: number;
}
export interface VenueObject {
  id: string;
  kind: string;
  label?: string;
  layer?: SpatialLayer;
  elevationM?: number;
  footprint: Footprint;
  capacity?: number;
  placement?: { collisionMode: "solid" };
  circulation?: CirculationMetadata;
  queue?: QueueMetadata;
  staffPost?: StaffPostMetadata;
  utility?: UtilityMetadata;
  rigging?: RiggingMetadata;
  productionZone?: { access: "crew-only" | "performer-only" | "mixed" };
  resourceBinding?: {
    schemaVersion: 1;
    resourceId: string;
    kind: "inventory" | "av" | "power" | "catering" | "staffing";
    quantity: number;
  };
  production?: ProductionMetadata;
  catering?: CateringMetadata;
  emergency?: EmergencyMetadata;
  entrance?: { clearWidthM?: number; accessible?: boolean };
  door?: DoorMetadata;
  exit?: ExitMetadata;
  route?: RouteMetadata;
  restriction?: RestrictionMetadata;
  ramp?: RampMetadata;
  locks?: ObjectLock[];
  locked?: boolean;
  occupancy?: ObjectOccupancyMetadata;
  accessibility?: ObjectAccessibilityMetadata;
  sightline?: ObjectSightlineMetadata;
  templateRef?: { kind?: string; templateId: string; templateObjectId?: string; version?: string };
  templateOverrides?: string[];
  specification?: {
    cost?: { amount: number; currency?: string };
    [key: string]: object | string | number | boolean | undefined;
  };
  inventoryCount?: number;
  groupId?: string | null;
}
export interface VenueConstraint {
  id: string;
  checkId: string;
  label: string;
  category: string;
  evaluator: string;
  severity: "error" | "warning";
  enabled?: boolean;
  waivable?: boolean;
  scope?: { kind: string; objectIds?: string[] };
  parameters: {
    metric?: string;
    comparator?: "gte" | "lte";
    threshold?: number;
    unit?: string;
    objectIds?: string[];
    minimumWidthM?: number;
    minimumDiameterM?: number;
    minimumSeats?: number;
    requireCompanionAdjacency?: boolean;
    minimumCoverageRatio?: number;
    minimumSectionCoverageRatio?: number;
    minimumClearWidthM?: number;
    minimumSlopeRatio?: number;
    minimumAttendeeCapacity?: number;
    maximumOperationalLoad?: number;
    maximumCongestionIndex?: number;
    maximumViewingDistanceM?: number;
    maximumBlockedSectionRatio?: number;
    requireConnected?: boolean;
    minimumSections?: number;
    minimumLandingLengthM?: number;
    minimumEdgeProtectionHeightM?: number;
    requireHandrails?: boolean;
    maximumFailedChecks?: number;
    maximumStructuralFailures?: number;
  };
  policy?: { jurisdiction: string; source: string; effectiveDate: string };
  remediation: string;
}
export interface ConstraintWaiver {
  id?: string;
  constraintId: string;
  proposalId?: string;
  baseVersion?: string;
  validationInputFingerprint?: string;
  acceptedPlanVersion?: string;
  reason?: string;
  reasonCode?: string;
  authorId?: string;
  createdAt?: string;
}
export interface RoomTemplateUpdateMetadata {
  kind: "room-template";
  templateId: string;
  fromVersion: string;
  toVersion: string;
  actor: string;
  skipped: Array<{ templateObjectId: string; reason: string }>;
  preservedOverrides: Array<{ projectObjectId: string; templateObjectId: string; path: string }>;
}
export interface VenueProposal {
  id: string;
  baseVersion: string;
  revision: number;
  status: string;
  goal: string;
  changes: PlanningChange[];
  waivers: ConstraintWaiver[];
  validation: object | null;
  adjustment?: string | undefined;
  previousBaseVersion?: string | undefined;
  templateUpdate?: RoomTemplateUpdateMetadata | null | undefined;
  lineage?: object[] | undefined;
}
export type VenueProposalTemplate = Pick<VenueProposal, "id" | "changes"> &
  Partial<Omit<VenueProposal, "id" | "changes">>;
export interface OccupancyPolicy {
  venueMaximum: number;
  staff: number;
  performers: number;
  vendors: number;
  densityM2PerAttendee?: number;
  sections: Array<{ objectId: string; zoneId: string; minimumCapacity: number; maximumCapacity: number }>;
  zones: Array<{
    id: string;
    label: string;
    sectionObjectIds: string[];
    minimumCapacity: number;
    maximumCapacity: number;
  }>;
}
export interface StaffingPlan {
  schemaVersion: 1;
  roles: Array<{ id: string; label: string; headcount: number; skills: string[] }>;
  shifts: Array<{ id: string; label: string; startMinute: number; endMinute: number }>;
  coverageRequirements: Array<{
    id: string;
    zoneObjectId: string;
    roleId: string;
    minimumCount: number;
    shiftIds: string[];
  }>;
  minimumHandoffOverlapMinutes: number;
  maximumWalkingDistanceM: number;
}
export interface ProductionPolicy {
  schemaVersion: 1;
  minimumScreenVisibilityRatio: number;
  minimumSpeakerCoverageRatio: number;
  minimumControlSightlineRatio: number;
  allowedAccessibleCrossingTreatments: string[];
}
export interface CateringPolicy {
  schemaVersion: 1;
  phases: Array<{ id: string; label: string; durationMinutes: number; demandRatio: number }>;
  minimumSeparationFromProductionM: number;
  minimumSeparationFromEmergencyM: number;
  maximumAccessibleServiceHeightM: number;
  minimumAccessibleServicePoints: number;
  queueHorizonMinutes: number;
  allowedReplenishmentCrossingControls: string[];
}
export interface EmergencyScenarioDefinition {
  id: string;
  label: string;
  type: "blocked-exit" | "unavailable-corridor" | "power-loss";
  unavailableObjectIds: string[];
  unavailableCircuitIds: string[];
  durationMinutes: number;
  assumptions: string[];
}
export interface EmergencyPlan {
  schemaVersion: 1;
  minimumExitCount: number;
  minimumExitCapacityPersons: number;
  minimumAssemblyCapacityPersons: number;
  minimumEmergencyAccessWidthM: number;
  minimumFireEquipmentCoverageRatio: number;
  requiredFirstAidPosts: number;
  requiredCommandPosts: number;
  authorizedReviewerRoles: string[];
  assumptions: string[];
  scenarioDefinitions: EmergencyScenarioDefinition[];
}
export interface EmergencyReview {
  id: string;
  proposalId: string;
  reviewerId: string;
  reviewerRole: string;
  reviewedAt: string;
  acceptedAssumptionCodes?: string[] | undefined;
  planVersion?: string | undefined;
  basePlanVersion?: string | undefined;
  acceptedPlanVersion?: string | undefined;
  validationInputFingerprint?: string | undefined;
  emergencyEvidenceFingerprint?: string | undefined;
  changedObjectIds?: string[] | undefined;
  assumptionsAccepted?: boolean | undefined;
  assumptions?: string[] | undefined;
  note?: string | undefined;
}
export interface AccessibilityPolicy {
  minimumRouteWidthM: number;
  minimumTurningClearanceM: number;
  minimumAccessibleSeats: number;
  minimumAccessibleSeatingSections: number;
  minimumAccessibleSightlineCoverageRatio: number;
  minimumDoorClearWidthM: number;
  minimumRampSlopeRatio: number;
  minimumRampClearWidthM: number;
  minimumRampLandingLengthM: number;
  minimumRampEdgeProtectionHeightM: number;
  requireRampHandrails: boolean;
  jurisdiction: string;
  source: string;
  effectiveDate: string;
}
export interface CirculationPolicy {
  exitApproachDepthM?: number;
}
export interface VenuePlan {
  id: string;
  version: string;
  event: { id: string; name: string; program?: string; attendeeTarget: number; date: string | null };
  venue: { id: string; name: string; room: string };
  spatial: SpatialGeometry;
  objects: VenueObject[];
  constraints: VenueConstraint[];
  metrics: Record<string, number | boolean>;
  waivers?: ConstraintWaiver[];
  templateBindings?: {
    venue?: { templateId: string; version: string };
    room?: { templateId: string; version: string; roomInstanceId?: string };
  };
  occupancy?: OccupancyPolicy;
  staffing?: StaffingPlan;
  productionPolicy?: ProductionPolicy;
  cateringPolicy?: CateringPolicy;
  emergencyPlan?: EmergencyPlan;
  emergencyReviews?: EmergencyReview[];
  accessibilityPolicy?: AccessibilityPolicy;
  circulationPolicy?: CirculationPolicy;
}
export type VenuePlanDocument = VenuePlan & { brief: EventBrief; proposal: VenueProposalTemplate };

type PartialFootprint =
  | ({ kind: "rectangle" } & Partial<Omit<RectangleFootprint, "kind">>)
  | ({ kind: "circle" } & Partial<Omit<CircleFootprint, "kind">>)
  | ({ kind: "line" } & Partial<Omit<LineFootprint, "kind">>)
  | ({ kind: "polygon" } & Partial<Omit<PolygonFootprint, "kind">>);
type GeometryInputObject = Omit<VenueObject, "footprint"> & { footprint: Footprint | PartialFootprint };
type GeometryInputPlan = Omit<VenuePlan, "objects" | "spatial"> & {
  objects: GeometryInputObject[];
  spatial: SpatialGeometry;
};

const DISTANCE_PRECISION = 3;
const ANGLE_PRECISION = 1;
const EPSILON = 1e-9;
const SPATIAL_LAYERS: readonly SpatialLayer[] = [
  "architecture",
  "furniture",
  "access",
  "production",
  "catering",
  "safety",
  "annotations",
];

const round = (value: number, precision: number): number => Number(value.toFixed(precision));

const finiteNumber = (value: number | undefined, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
};

const positiveNumber = (value: number | undefined, label: string): number => {
  const number = finiteNumber(value, label);
  if (number <= 0) throw new Error(`${label} must be greater than zero`);
  return round(number, DISTANCE_PRECISION);
};

const normalizePoint = (point: Point | undefined, label: string): Point => ({
  x: round(finiteNumber(point?.x, `${label}.x`), DISTANCE_PRECISION),
  y: round(finiteNumber(point?.y, `${label}.y`), DISTANCE_PRECISION),
});

const samePoint = (left: Point, right: Point | undefined): boolean =>
  right !== undefined && Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON;

const orientation = (a: Point, b: Point, c: Point): 0 | 1 | 2 => {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < EPSILON) return 0;
  return value > 0 ? 1 : 2;
};

const pointOnSegment = (point: Point, start: Point, end: Point): boolean =>
  point.x <= Math.max(start.x, end.x) + EPSILON &&
  point.x + EPSILON >= Math.min(start.x, end.x) &&
  point.y <= Math.max(start.y, end.y) + EPSILON &&
  point.y + EPSILON >= Math.min(start.y, end.y) &&
  orientation(start, point, end) === 0;

const segmentsIntersect = (a1: Point, a2: Point, b1: Point, b2: Point): boolean => {
  const o1 = orientation(a1, a2, b1);
  const o2 = orientation(a1, a2, b2);
  const o3 = orientation(b1, b2, a1);
  const o4 = orientation(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (
    (o1 === 0 && pointOnSegment(b1, a1, a2)) ||
    (o2 === 0 && pointOnSegment(b2, a1, a2)) ||
    (o3 === 0 && pointOnSegment(a1, b1, b2)) ||
    (o4 === 0 && pointOnSegment(a2, b1, b2))
  );
};

const signedArea = (ring: readonly Point[]): number =>
  ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return next ? sum + point.x * next.y - next.x * point.y : sum;
  }, 0) / 2;

const assertSimpleRing = (ring: readonly Point[], label: string): void => {
  for (let first = 0; first < ring.length; first += 1) {
    const firstNext = (first + 1) % ring.length;
    for (let second = first + 1; second < ring.length; second += 1) {
      const secondNext = (second + 1) % ring.length;
      const adjacent = first === second || firstNext === second || secondNext === first;
      if (adjacent) continue;
      const firstPoint = ring[first];
      const firstNextPoint = ring[firstNext];
      const secondPoint = ring[second];
      const secondNextPoint = ring[secondNext];
      if (
        firstPoint &&
        firstNextPoint &&
        secondPoint &&
        secondNextPoint &&
        segmentsIntersect(firstPoint, firstNextPoint, secondPoint, secondNextPoint)
      ) {
        throw new Error(`Self-intersecting ${label}`);
      }
    }
  }
};

const normalizeRing = (points: readonly Point[] | undefined, label: string, clockwise: boolean): Point[] => {
  if (!points) throw new Error(`${label} must be an array of points`);
  const normalized = points.map((point, index) => normalizePoint(point, `${label}[${index}]`));
  const first = normalized[0];
  if (first && normalized.length > 1 && samePoint(first, normalized.at(-1))) normalized.pop();
  if (normalized.length < 3) throw new Error(`${label} requires at least three points`);
  assertSimpleRing(normalized, label);
  const area = signedArea(normalized);
  if (Math.abs(area) < EPSILON) throw new Error(`${label} must enclose an area`);
  const isClockwise = area < 0;
  return isClockwise === clockwise ? normalized : normalized.toReversed();
};

const pointInRing = (point: Point, ring: readonly Point[]): boolean => {
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const a = ring[current];
    const b = ring[previous];
    if (!a || !b) continue;
    if (pointOnSegment(point, a, b)) return true;
    const crosses = a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

const pointInRoom = (point: Point, roomBoundary: RoomBoundary): boolean =>
  pointInRing(point, roomBoundary.outer) && !roomBoundary.holes.some((hole) => pointInRing(point, hole));

const normalizeAngle = (value = 0): number => {
  const angle = finiteNumber(value, "rotationDegrees");
  return round(((angle % 360) + 360) % 360, ANGLE_PRECISION);
};

const rotatePoint = (point: Point, center: Point, clockwiseDegrees: number): Point => {
  const radians = (-clockwiseDegrees * Math.PI) / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
};

const rectangleCorners = (footprint: RectangleFootprint): Point[] => {
  const halfWidth = footprint.width / 2;
  const halfDepth = footprint.depth / 2;
  return [
    { x: footprint.center.x - halfWidth, y: footprint.center.y - halfDepth },
    { x: footprint.center.x + halfWidth, y: footprint.center.y - halfDepth },
    { x: footprint.center.x + halfWidth, y: footprint.center.y + halfDepth },
    { x: footprint.center.x - halfWidth, y: footprint.center.y + halfDepth },
  ].map((point) => rotatePoint(point, footprint.center, footprint.rotationDegrees));
};

const lineCorners = (footprint: LineFootprint): Point[] => {
  const dx = footprint.end.x - footprint.start.x;
  const dy = footprint.end.y - footprint.start.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) throw new Error("Line footprint requires distinct start and end points");
  const offsetX = ((-dy / length) * footprint.width) / 2;
  const offsetY = ((dx / length) * footprint.width) / 2;
  return [
    { x: footprint.start.x + offsetX, y: footprint.start.y + offsetY },
    { x: footprint.end.x + offsetX, y: footprint.end.y + offsetY },
    { x: footprint.end.x - offsetX, y: footprint.end.y - offsetY },
    { x: footprint.start.x - offsetX, y: footprint.start.y - offsetY },
  ];
};

const normalizeFootprint = (footprint: Footprint | PartialFootprint | undefined, objectId: string): Footprint => {
  if (!footprint?.kind) throw new Error(`Object ${objectId} requires a footprint`);
  if (footprint.kind === "rectangle") {
    return {
      kind: "rectangle",
      center: normalizePoint(footprint.center, `${objectId}.footprint.center`),
      width: positiveNumber(footprint.width, `${objectId}.footprint.width`),
      depth: positiveNumber(footprint.depth, `${objectId}.footprint.depth`),
      rotationDegrees: normalizeAngle(footprint.rotationDegrees),
    };
  }
  if (footprint.kind === "circle") {
    return {
      kind: "circle",
      center: normalizePoint(footprint.center, `${objectId}.footprint.center`),
      radius: positiveNumber(footprint.radius, `${objectId}.footprint.radius`),
    };
  }
  if (footprint.kind === "line") {
    return {
      kind: "line",
      start: normalizePoint(footprint.start, `${objectId}.footprint.start`),
      end: normalizePoint(footprint.end, `${objectId}.footprint.end`),
      width: positiveNumber(footprint.width, `${objectId}.footprint.width`),
    };
  }
  if (footprint.kind === "polygon") {
    return {
      kind: "polygon",
      points: normalizeRing(footprint.points, `${objectId} polygon footprint`, false),
      rotationDegrees: normalizeAngle(footprint.rotationDegrees),
    };
  }
  throw new Error(`Unsupported footprint kind for object ${objectId}`);
};

const isDoorSwing = (value: unknown): value is DoorMetadata["swing"] =>
  value === "inward" || value === "outward" || value === "sliding" || value === "revolving";

const operationalMetadata = (
  object: GeometryInputObject,
  fallback: GeometryInputObject | undefined,
  footprint: Footprint,
): Partial<VenueObject> => {
  if (object.kind === "door") {
    if (footprint.kind !== "line") throw new Error(`Door ${object.id} requires a line footprint`);
    const door = { ...(fallback?.door ?? {}), ...(object.door ?? {}) };
    if (
      typeof door.clearWidthM !== "number" ||
      !Number.isFinite(door.clearWidthM) ||
      door.clearWidthM <= 0 ||
      !isDoorSwing(door.swing) ||
      typeof door.accessible !== "boolean"
    )
      throw new Error(`Door ${object.id} requires clear width, swing, and accessibility metadata`);
    const clearance = door.clearance
      ? {
          side: ["left", "right", "both"].includes(door.clearance.side)
            ? door.clearance.side
            : (() => {
                throw new Error(`Door ${object.id} requires a valid clearance side`);
              })(),
          depthM: positiveNumber(door.clearance.depthM, `${object.id}.door.clearance.depthM`),
          latchSideM: positiveNumber(door.clearance.latchSideM, `${object.id}.door.clearance.latchSideM`),
        }
      : null;
    return {
      door: {
        clearWidthM: positiveNumber(door.clearWidthM, `${object.id}.door.clearWidthM`),
        swing: door.swing,
        accessible: door.accessible,
        ...(clearance ? { clearance } : {}),
      },
    };
  }
  if (object.kind === "fire_exit") {
    if (footprint.kind !== "line") throw new Error(`Exit ${object.id} requires a line footprint`);
    const exit = object.exit ?? fallback?.exit;
    if (
      !exit ||
      !Number.isFinite(exit.clearWidthM) ||
      exit.clearWidthM <= 0 ||
      typeof exit.emergency !== "boolean" ||
      !Number.isInteger(exit.capacityPersons) ||
      exit.capacityPersons <= 0
    )
      throw new Error(`Exit ${object.id} requires clear width, emergency, and capacity metadata`);
    return {
      exit: {
        clearWidthM: positiveNumber(exit.clearWidthM, `${object.id}.exit.clearWidthM`),
        emergency: exit.emergency,
        capacityPersons: exit.capacityPersons,
      },
    };
  }
  if (["accessible_route", "corridor", "aisle", "service_lane"].includes(object.kind)) {
    if (footprint.kind !== "line") throw new Error(`Route ${object.id} requires a line footprint`);
    const route = object.route ?? fallback?.route;
    if (
      !route ||
      !["one-way", "bidirectional"].includes(route.direction) ||
      typeof route.accessible !== "boolean" ||
      !route.purpose
    )
      throw new Error(`Route ${object.id} requires direction, accessibility, and purpose metadata`);
    return {
      route: {
        direction: route.direction,
        accessible: route.accessible,
        purpose: String(route.purpose),
        ...(route.staffOnly === true ? { staffOnly: true } : {}),
      },
    };
  }
  if (object.kind === "restricted_zone") {
    if (!["rectangle", "polygon"].includes(footprint.kind))
      throw new Error(`Restricted zone ${object.id} requires a rectangle or polygon footprint`);
    const restriction = object.restriction ?? fallback?.restriction;
    if (
      !restriction ||
      !["prohibited", "staff-only", "conditional"].includes(restriction.access) ||
      !restriction.reasonCode ||
      typeof restriction.blocksPlacement !== "boolean"
    )
      throw new Error(`Restricted zone ${object.id} requires access, reason, and placement metadata`);
    return {
      restriction: {
        access: restriction.access,
        reasonCode: String(restriction.reasonCode),
        blocksPlacement: restriction.blocksPlacement,
      },
    };
  }
  if (object.kind === "temporary_ramp") {
    if (footprint.kind !== "line") throw new Error(`Temporary ramp ${object.id} requires a line footprint`);
    const ramp = { ...(fallback?.ramp ?? {}), ...(object.ramp ?? {}) };
    if (
      typeof ramp.riseM !== "number" ||
      !Number.isFinite(ramp.riseM) ||
      ramp.riseM <= 0 ||
      typeof ramp.runM !== "number" ||
      !Number.isFinite(ramp.runM) ||
      ramp.runM <= 0 ||
      typeof ramp.clearWidthM !== "number" ||
      !Number.isFinite(ramp.clearWidthM) ||
      ramp.clearWidthM <= 0 ||
      typeof ramp.landingLengthM !== "number" ||
      !Number.isFinite(ramp.landingLengthM) ||
      ramp.landingLengthM <= 0 ||
      typeof ramp.edgeProtectionHeightM !== "number" ||
      !Number.isFinite(ramp.edgeProtectionHeightM) ||
      ramp.edgeProtectionHeightM < 0 ||
      typeof ramp.handrails !== "boolean"
    ) {
      throw new Error(
        `Temporary ramp ${object.id} requires rise, run, width, landing, edge protection, and handrail metadata`,
      );
    }
    return {
      ramp: {
        riseM: positiveNumber(ramp.riseM, `${object.id}.ramp.riseM`),
        runM: positiveNumber(ramp.runM, `${object.id}.ramp.runM`),
        clearWidthM: positiveNumber(ramp.clearWidthM, `${object.id}.ramp.clearWidthM`),
        landingLengthM: positiveNumber(ramp.landingLengthM, `${object.id}.ramp.landingLengthM`),
        edgeProtectionHeightM: round(
          finiteNumber(ramp.edgeProtectionHeightM, `${object.id}.ramp.edgeProtectionHeightM`),
          DISTANCE_PRECISION,
        ),
        handrails: ramp.handrails,
      },
    };
  }
  return {};
};

const footprintTestPoints = (footprint: Footprint): Point[] => {
  if (footprint.kind === "rectangle") return rectangleCorners(footprint);
  if (footprint.kind === "line") return lineCorners(footprint);
  if (footprint.kind === "polygon") return footprint.points;
  if (footprint.kind === "circle") {
    return Array.from({ length: 24 }, (_, index) => {
      const radians = (index / 24) * Math.PI * 2;
      return {
        x: footprint.center.x + Math.cos(radians) * footprint.radius,
        y: footprint.center.y + Math.sin(radians) * footprint.radius,
      };
    });
  }
  return [];
};

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const fingerprint = (value: object): string => {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `geom-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const normalizeSpatial = (spatial: SpatialGeometry | undefined): SpatialGeometry => {
  if (!spatial) throw new Error("Plan requires canonical spatial geometry");
  if (spatial.unit !== "m") throw new Error("Canonical spatial geometry must use metres");
  const roomBoundary = {
    outer: normalizeRing(spatial.roomBoundary?.outer, "room boundary", false),
    holes: (spatial.roomBoundary?.holes ?? []).map((hole, index) =>
      normalizeRing(hole, `room boundary hole ${index + 1}`, true),
    ),
  };
  for (const [index, hole] of roomBoundary.holes.entries()) {
    if (!hole.every((point) => pointInRing(point, roomBoundary.outer))) {
      throw new Error(`Room boundary hole ${index + 1} must be inside the outer boundary`);
    }
  }
  return {
    schemaVersion: 1,
    unit: "m",
    units: { length: "m", area: "m2", angle: "deg", time: "s" },
    layers: [...SPATIAL_LAYERS],
    coordinateSystem: {
      origin: "southwest",
      xAxis: "east",
      yAxis: "north",
      rotationDirection: "clockwise",
    },
    precision: { distance: DISTANCE_PRECISION, angle: ANGLE_PRECISION },
    roomBoundary,
  };
};

export function normalizePlanGeometry<T extends GeometryInputPlan>(
  plan: T,
  fallbackPlan: GeometryInputPlan | null = null,
): T & { spatial: SpatialGeometry; objects: VenueObject[] } {
  const fallbackObjects = new Map((fallbackPlan?.objects ?? []).map((object) => [object.id, object]));
  const spatial = normalizeSpatial(plan.spatial ?? fallbackPlan?.spatial);
  const objects = plan.objects.map((object) => {
    const fallback = fallbackObjects.get(object.id);
    const footprint = normalizeFootprint(object.footprint ?? fallback?.footprint, object.id);
    const elevationM = round(
      finiteNumber(object.elevationM ?? fallback?.elevationM ?? 0, `${object.id}.elevationM`),
      DISTANCE_PRECISION,
    );
    if (elevationM < 0) throw new Error(`${object.id}.elevationM cannot be negative`);
    const layer = object.layer ?? fallback?.layer ?? "furniture";
    if (!SPATIAL_LAYERS.includes(layer))
      throw new Error(`Object ${object.id} uses unsupported spatial layer: ${layer}`);
    if (
      object.kind === "seating_section" &&
      (typeof object.capacity !== "number" || !Number.isInteger(object.capacity) || object.capacity < 0)
    )
      throw new Error(`Seating Section ${object.id} requires a non-negative integer capacity`);
    if (object.placement && object.placement.collisionMode !== "solid")
      throw new Error(`Object ${object.id} uses unsupported collision metadata`);
    if (object.circulation?.role && !["queue", "checkpoint"].includes(object.circulation.role))
      throw new Error(`Object ${object.id} uses unsupported circulation role metadata`);
    const circulationNumberFields: Array<
      keyof Pick<
        CirculationMetadata,
        "capacityPersonsPerMinute" | "clearWidthM" | "carCapacityPersons" | "cycleSeconds"
      >
    > = ["capacityPersonsPerMinute", "clearWidthM", "carCapacityPersons", "cycleSeconds"];
    for (const field of circulationNumberFields) {
      if (
        object.circulation?.[field] != null &&
        (!Number.isFinite(object.circulation[field]) || object.circulation[field] <= 0)
      )
        throw new Error(`Object ${object.id} requires positive ${field} circulation metadata`);
    }
    if (
      object.circulation?.servesZoneIds &&
      (!Array.isArray(object.circulation.servesZoneIds) ||
        new Set(object.circulation.servesZoneIds).size !== object.circulation.servesZoneIds.length ||
        object.circulation.servesZoneIds.some((id) => typeof id !== "string" || !id.trim()))
    )
      throw new Error(`Object ${object.id} requires unique servesZoneIds circulation metadata`);
    if (object.queue) {
      if (
        !["registration", "security", "cloakroom", "food", "beverage", "restroom", "merchandise", "transport"].includes(
          object.queue.category,
        )
      )
        throw new Error(`Queue ${object.id} uses an unsupported category`);
      if (
        !Number.isInteger(object.queue.servers) ||
        object.queue.servers < 1 ||
        !Number.isFinite(object.queue.serviceRatePerServerMinute) ||
        object.queue.serviceRatePerServerMinute <= 0 ||
        !Number.isInteger(object.queue.priorityLaneCount) ||
        object.queue.priorityLaneCount < 0
      )
        throw new Error(`Queue ${object.id} requires servers, service rate, and priority lane count`);
    }
    if (object.kind === "staff_post") {
      if (
        !object.staffPost ||
        !Array.isArray(object.staffPost.coverageZoneObjectIds) ||
        !Array.isArray(object.staffPost.assignments) ||
        object.staffPost.assignments.length === 0
      )
        throw new Error(`Staff post ${object.id} requires coverage zones and assignments`);
      if (
        new Set(object.staffPost.coverageZoneObjectIds).size !== object.staffPost.coverageZoneObjectIds.length ||
        object.staffPost.coverageZoneObjectIds.some((id) => typeof id !== "string" || !id.trim())
      )
        throw new Error(`Staff post ${object.id} requires unique coverage zone IDs`);
      if (
        object.staffPost.assignments.some(
          (assignment) =>
            !assignment.shiftId || !assignment.roleId || !Number.isInteger(assignment.count) || assignment.count < 1,
        )
      )
        throw new Error(`Staff post ${object.id} requires valid shift assignments`);
    }
    if (object.kind === "utility_point") {
      if (
        !object.utility ||
        object.utility.type !== "power" ||
        !object.utility.circuitId ||
        !Number.isFinite(object.utility.voltage) ||
        object.utility.voltage <= 0 ||
        !Number.isFinite(object.utility.maxWatts) ||
        object.utility.maxWatts <= 0
      )
        throw new Error(`Power utility ${object.id} requires circuit, voltage, and watt capacity metadata`);
    }
    if (object.kind === "rigging_point") {
      if (
        !object.rigging ||
        !Number.isFinite(object.rigging.safeWorkingLoadKg) ||
        object.rigging.safeWorkingLoadKg <= 0
      )
        throw new Error(`Rigging point ${object.id} requires a safe working load`);
    }
    if (
      object.kind === "backstage_zone" &&
      (!object.productionZone || !["crew-only", "performer-only", "mixed"].includes(object.productionZone.access))
    )
      throw new Error(`Backstage zone ${object.id} requires production access metadata`);
    if (object.resourceBinding) {
      const binding = object.resourceBinding;
      const allowed = ["schemaVersion", "resourceId", "kind", "quantity"];
      if (
        Object.keys(binding).some((key) => !allowed.includes(key)) ||
        binding.schemaVersion !== 1 ||
        !/^resource-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(binding.resourceId ?? "") ||
        !["inventory", "av", "power", "catering", "staffing"].includes(binding.kind) ||
        !Number.isInteger(binding.quantity) ||
        binding.quantity < 1
      )
        throw new Error(`Resource Binding ${object.id} is invalid`);
      if (binding.kind === "av" && !object.production)
        throw new Error(`AV Resource Binding ${object.id} requires production metadata`);
      if (binding.kind === "power" && object.utility?.type !== "power")
        throw new Error(`Power Resource Binding ${object.id} requires a power utility point`);
      if (binding.kind === "catering" && !object.catering)
        throw new Error(`Catering Resource Binding ${object.id} requires catering metadata`);
      if (binding.kind === "staffing" && object.kind !== "staff_post")
        throw new Error(`Staffing Resource Binding ${object.id} requires a staff post`);
    }
    if (object.production) {
      if (
        ![
          "screen",
          "projector",
          "speaker",
          "camera",
          "control-desk",
          "cable-route",
          "power-distribution",
          "rigged-equipment",
        ].includes(object.production.equipmentType)
      )
        throw new Error(`Production object ${object.id} uses an unsupported equipment type`);
      if (object.production.equipmentType === "cable-route" && footprint.kind !== "line")
        throw new Error(`Cable route ${object.id} requires a line footprint`);
      if (
        object.production.powerWatts != null &&
        (!Number.isFinite(object.production.powerWatts) || object.production.powerWatts < 0)
      )
        throw new Error(`Production object ${object.id} requires non-negative power demand`);
      if (
        object.production.weightKg != null &&
        (!Number.isFinite(object.production.weightKg) || object.production.weightKg < 0)
      )
        throw new Error(`Production object ${object.id} requires non-negative weight`);
      if (object.production.requiresRigging === true && !object.production.riggingPointId)
        throw new Error(`Production object ${object.id} requires a rigging point ID`);
    }
    if (
      ["bar", "buffet", "kitchen", "prep_zone", "waste_point", "water_point"].includes(object.kind) &&
      !object.catering
    )
      throw new Error(`Catering object ${object.id} requires catering metadata`);
    if (object.catering) {
      if (
        ![
          "bar",
          "buffet",
          "service-counter",
          "kitchen",
          "prep",
          "waste",
          "water",
          "queue-zone",
          "replenishment-route",
        ].includes(object.catering.type)
      )
        throw new Error(`Catering object ${object.id} uses an unsupported type`);
      if (object.catering.attendeeRecords != null || object.catering.attendeeHealthRecords != null)
        throw new Error(`Catering object ${object.id} cannot store attendee health records`);
      if (["bar", "buffet", "service-counter"].includes(object.catering.type)) {
        if (
          typeof object.catering.servers !== "number" ||
          !Number.isInteger(object.catering.servers) ||
          object.catering.servers < 1 ||
          typeof object.catering.serviceRatePerServerMinute !== "number" ||
          !Number.isFinite(object.catering.serviceRatePerServerMinute) ||
          object.catering.serviceRatePerServerMinute <= 0 ||
          typeof object.catering.demandShare !== "number" ||
          !Number.isFinite(object.catering.demandShare) ||
          object.catering.demandShare <= 0 ||
          object.catering.demandShare > 1 ||
          typeof object.catering.queueBufferPersons !== "number" ||
          !Number.isInteger(object.catering.queueBufferPersons) ||
          object.catering.queueBufferPersons < 0 ||
          !object.catering.queueZoneObjectId ||
          !object.catering.replenishmentSourceObjectId ||
          !object.catering.waterSourceObjectId
        )
          throw new Error(`Catering station ${object.id} requires service, queue, replenishment, and water metadata`);
        if (
          typeof object.catering.serviceHeightM !== "number" ||
          !Number.isFinite(object.catering.serviceHeightM) ||
          object.catering.serviceHeightM <= 0 ||
          typeof object.catering.accessibleServicePoint !== "boolean"
        )
          throw new Error(`Catering station ${object.id} requires accessible service metadata`);
        const cateringListFields: Array<keyof Pick<CateringMetadata, "dietaryOptions" | "allergenLabels">> = [
          "dietaryOptions",
          "allergenLabels",
        ];
        for (const field of cateringListFields) {
          const items = object.catering[field];
          if (!Array.isArray(items) || new Set(items).size !== items.length || items.some((item) => !item.trim()))
            throw new Error(`Catering station ${object.id} requires unique ${field}`);
        }
      }
      if (object.catering.type === "replenishment-route") {
        if (
          footprint.kind !== "line" ||
          !object.catering.sourceObjectId ||
          !Array.isArray(object.catering.targetObjectIds) ||
          object.catering.targetObjectIds.length === 0 ||
          new Set(object.catering.targetObjectIds).size !== object.catering.targetObjectIds.length ||
          !object.catering.crossingControl
        )
          throw new Error(`Replenishment route ${object.id} requires a line, endpoints, and crossing control`);
      }
    }
    const emergencyKinds = ["assembly_point", "emergency_access_lane", "fire_equipment", "first_aid", "command_post"];
    if (emergencyKinds.includes(object.kind) && !object.emergency)
      throw new Error(`Emergency object ${object.id} requires emergency metadata`);
    if (object.emergency) {
      if (
        !["assembly-point", "emergency-access-lane", "fire-equipment", "first-aid", "command-post"].includes(
          object.emergency.type,
        )
      )
        throw new Error(`Emergency object ${object.id} uses an unsupported type`);
      if (
        object.kind === "assembly_point" &&
        (typeof object.emergency.capacityPersons !== "number" ||
          !Number.isInteger(object.emergency.capacityPersons) ||
          object.emergency.capacityPersons < 1 ||
          !Array.isArray(object.emergency.designatedExitObjectIds) ||
          object.emergency.designatedExitObjectIds.length === 0 ||
          new Set(object.emergency.designatedExitObjectIds).size !== object.emergency.designatedExitObjectIds.length)
      )
        throw new Error(`Assembly point ${object.id} requires capacity and unique designated exit IDs`);
      if (
        object.kind === "emergency_access_lane" &&
        (footprint.kind !== "line" || object.emergency.responderOnly !== true)
      )
        throw new Error(`Emergency access lane ${object.id} requires a responder-only line footprint`);
      if (
        object.kind === "fire_equipment" &&
        (!object.emergency.equipmentClass ||
          typeof object.emergency.coverageRadiusM !== "number" ||
          !Number.isFinite(object.emergency.coverageRadiusM) ||
          object.emergency.coverageRadiusM <= 0 ||
          typeof object.emergency.clearanceM !== "number" ||
          !Number.isFinite(object.emergency.clearanceM) ||
          object.emergency.clearanceM <= 0)
      )
        throw new Error(`Fire equipment ${object.id} requires class, coverage, and clearance metadata`);
      if (["first_aid", "command_post"].includes(object.kind) && typeof object.emergency.accessible !== "boolean")
        throw new Error(`Emergency post ${object.id} requires accessibility metadata`);
      if (
        object.emergency.backupPowerMinutes != null &&
        (!Number.isFinite(object.emergency.backupPowerMinutes) || object.emergency.backupPowerMinutes < 0)
      )
        throw new Error(`Emergency object ${object.id} requires non-negative backup power`);
    }
    if (
      object.kind !== "assembly_point" &&
      !footprintTestPoints(footprint).every((point) => pointInRoom(point, spatial.roomBoundary))
    ) {
      throw new Error(`Object ${object.id} footprint is outside the room boundary`);
    }
    return normalizeObjectLocks(
      { ...object, ...operationalMetadata(object, fallback, footprint), layer, elevationM, footprint },
      fallback,
    );
  });
  const geometryValue = {
    ...spatial,
    objects: objects.map(({ id, layer, elevationM, footprint }) => ({ id, layer, elevationM, footprint })),
  };
  return {
    ...plan,
    spatial: { ...spatial, fingerprint: fingerprint(geometryValue) },
    objects,
  };
}
