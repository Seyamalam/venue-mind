import {
  normalizePlanGeometry,
  type DoorMetadata,
  type Footprint,
  type LineFootprint,
  type Point,
  type RampMetadata,
  type RectangleFootprint,
  type RoomBoundary,
  type VenueObject,
  type VenuePlan,
} from "./geometry.ts";
import { venueError } from "./errors.ts";
import { assertNoLockConflicts } from "./locks.ts";
import type { ObjectLock } from "./locks.ts";
import type { PlanningChange } from "./planning-effects.ts";
import type { FootprintPatch } from "./locks.ts";
import type { EventBrief } from "./event-brief.ts";

export interface RouteNode {
  id: string;
  point: Point;
  edgeIds: string[];
}
export interface RouteEdge {
  id: string;
  objectId: string;
  startNodeId: string;
  endNodeId: string;
  widthM: number;
  lengthM: number;
  blockedByObjectIds: string[];
}
type LineRouteObject = VenueObject & { footprint: LineFootprint };
interface RouteGraph {
  nodes: RouteNode[];
  edges: RouteEdge[];
  routeObjects: LineRouteObject[];
}
type DoorObject = VenueObject & { footprint: LineFootprint; door: DoorMetadata };
type ExitObject = VenueObject & { footprint: LineFootprint; exit: NonNullable<VenueObject["exit"]> };
type RampObject = VenueObject & { ramp: RampMetadata };
type OccupiedObject = VenueObject & { capacity: number };
export interface DoorClearanceZone {
  id: string;
  doorObjectId: string;
  side: "left" | "right" | null;
  points: Point[];
  depthM?: number;
  latchSideM?: number;
  obstructingObjectIds: string[];
  status: "missing" | "blocked" | "clear";
}
const isDoorObject = (object: VenueObject): object is DoorObject =>
  object.footprint.kind === "line" && object.door !== undefined;
const isExitObject = (object: VenueObject): object is ExitObject =>
  object.footprint.kind === "line" && object.exit !== undefined;
const isRampObject = (object: VenueObject): object is RampObject => object.ramp !== undefined;
const hasPositiveCapacity = (object: VenueObject): object is OccupiedObject =>
  typeof object.capacity === "number" && object.capacity > 0;

const clone = <T>(value: T): T => structuredClone(value);

const mergeFootprint = (current: Footprint, patch: FootprintPatch): Footprint => {
  switch (current.kind) {
    case "rectangle":
      return {
        kind: "rectangle",
        center: "center" in patch && patch.center ? clone(patch.center) : current.center,
        width: "width" in patch && typeof patch.width === "number" ? patch.width : current.width,
        depth: "depth" in patch && typeof patch.depth === "number" ? patch.depth : current.depth,
        rotationDegrees:
          "rotationDegrees" in patch && typeof patch.rotationDegrees === "number"
            ? patch.rotationDegrees
            : current.rotationDegrees,
      };
    case "circle":
      return {
        kind: "circle",
        center: "center" in patch && patch.center ? clone(patch.center) : current.center,
        radius: "radius" in patch && typeof patch.radius === "number" ? patch.radius : current.radius,
      };
    case "line":
      return {
        kind: "line",
        start: "start" in patch && patch.start ? clone(patch.start) : current.start,
        end: "end" in patch && patch.end ? clone(patch.end) : current.end,
        width: "width" in patch && typeof patch.width === "number" ? patch.width : current.width,
      };
    case "polygon":
      return {
        kind: "polygon",
        points: "points" in patch && patch.points ? clone(patch.points) : current.points,
        rotationDegrees:
          "rotationDegrees" in patch && typeof patch.rotationDegrees === "number"
            ? patch.rotationDegrees
            : current.rotationDegrees,
      };
  }
};
const round = (value: number, precision = 3): number => Number(value.toFixed(precision));
const FEET_PER_METRE = 3.280839895;
const JOIN_TOLERANCE_M = 0.05;

const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

const fingerprint = (prefix: string, value: unknown): string => {
  const input = stableStringify(value);
  let result = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    result ^= input.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return `${prefix}-${(result >>> 0).toString(16).padStart(8, "0")}`;
};

const distance = (left: Point, right: Point): number => Math.hypot(left.x - right.x, left.y - right.y);
const pointKey = (point: Point): string => `${round(point.x)}:${round(point.y)}`;

const footprintCenter = (footprint: Footprint): Point => {
  if (footprint.kind === "rectangle" || footprint.kind === "circle") return footprint.center;
  if (footprint.kind === "line")
    return { x: (footprint.start.x + footprint.end.x) / 2, y: (footprint.start.y + footprint.end.y) / 2 };
  if (footprint.kind === "polygon")
    return {
      x: footprint.points.reduce((sum, point) => sum + point.x, 0) / footprint.points.length,
      y: footprint.points.reduce((sum, point) => sum + point.y, 0) / footprint.points.length,
    };
  return { x: 0, y: 0 };
};

const pointInAxisAlignedRectangle = (point: Point, footprint: RectangleFootprint): boolean =>
  Math.abs(point.x - footprint.center.x) <= footprint.width / 2 + JOIN_TOLERANCE_M &&
  Math.abs(point.y - footprint.center.y) <= footprint.depth / 2 + JOIN_TOLERANCE_M;

const pointTouchesFootprint = (point: Point, footprint: Footprint): boolean => {
  if (footprint.kind === "rectangle" && footprint.rotationDegrees === 0)
    return pointInAxisAlignedRectangle(point, footprint);
  if (footprint.kind === "circle") return distance(point, footprint.center) <= footprint.radius + JOIN_TOLERANCE_M;
  if (footprint.kind === "line") {
    const length = distance(footprint.start, footprint.end);
    return (
      Math.abs(distance(point, footprint.start) + distance(point, footprint.end) - length) <=
      JOIN_TOLERANCE_M + footprint.width / 2
    );
  }
  return distance(point, footprintCenter(footprint)) <= 1;
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

const footprintPolygon = (footprint: Footprint): Point[] => {
  if (footprint.kind === "rectangle") {
    const halfWidth = footprint.width / 2;
    const halfDepth = footprint.depth / 2;
    return [
      { x: footprint.center.x - halfWidth, y: footprint.center.y - halfDepth },
      { x: footprint.center.x + halfWidth, y: footprint.center.y - halfDepth },
      { x: footprint.center.x + halfWidth, y: footprint.center.y + halfDepth },
      { x: footprint.center.x - halfWidth, y: footprint.center.y + halfDepth },
    ].map((point) => rotatePoint(point, footprint.center, footprint.rotationDegrees));
  }
  if (footprint.kind === "line") {
    const dx = footprint.end.x - footprint.start.x;
    const dy = footprint.end.y - footprint.start.y;
    const length = Math.hypot(dx, dy);
    if (length === 0) return [];
    const offsetX = ((-dy / length) * footprint.width) / 2;
    const offsetY = ((dx / length) * footprint.width) / 2;
    return [
      { x: footprint.start.x + offsetX, y: footprint.start.y + offsetY },
      { x: footprint.end.x + offsetX, y: footprint.end.y + offsetY },
      { x: footprint.end.x - offsetX, y: footprint.end.y - offsetY },
      { x: footprint.start.x - offsetX, y: footprint.start.y - offsetY },
    ];
  }
  if (footprint.kind === "polygon") return footprint.points;
  return [];
};

const orientation = (a: Point, b: Point, c: Point): 0 | 1 | 2 => {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
};

const segmentsIntersect = (a: Point, b: Point, c: Point, d: Point): boolean =>
  orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);

const pointInPolygon = (point: Point, polygon: readonly Point[]): boolean => {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a = polygon[current];
    const b = polygon[previous];
    if (!a || !b) continue;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x)
      inside = !inside;
  }
  return inside;
};

const polygonIntersectsFootprint = (polygon: readonly Point[], footprint: Footprint): boolean => {
  if (footprint.kind === "circle") {
    if (pointInPolygon(footprint.center, polygon)) return true;
    return polygon.some((point, index) => {
      const next = polygon[(index + 1) % polygon.length];
      return next ? distancePointToSegment(footprint.center, point, next) <= footprint.radius : false;
    });
  }
  const other = footprintPolygon(footprint);
  if (!other.length) return false;
  const intersects = polygon.some((point, index) =>
    other.some((otherPoint, otherIndex) => {
      const next = polygon[(index + 1) % polygon.length];
      const otherNext = other[(otherIndex + 1) % other.length];
      return Boolean(next && otherNext && segmentsIntersect(point, next, otherPoint, otherNext));
    }),
  );
  const first = polygon[0];
  const otherFirst = other[0];
  return (
    intersects ||
    Boolean(first && pointInPolygon(first, other)) ||
    Boolean(otherFirst && pointInPolygon(otherFirst, polygon))
  );
};

export const footprintsIntersect = (left: Footprint, right: Footprint): boolean => {
  if (left.kind === "circle" && right.kind === "circle")
    return distance(left.center, right.center) <= left.radius + right.radius;
  if (left.kind === "circle") return polygonIntersectsFootprint(footprintPolygon(right), left);
  return polygonIntersectsFootprint(footprintPolygon(left), right);
};

const distancePointToSegment = (point: Point, start: Point, end: Point): number => {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) return distance(point, start);
  const projection = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared),
  );
  return distance(point, { x: start.x + projection * (end.x - start.x), y: start.y + projection * (end.y - start.y) });
};

const segmentIntersectsFootprint = (start: Point, end: Point, footprint: Footprint): boolean => {
  if (footprint.kind === "circle") return distancePointToSegment(footprint.center, start, end) <= footprint.radius;
  const polygon = footprintPolygon(footprint);
  return polygon.some((point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return next ? segmentsIntersect(start, end, point, next) : false;
  });
};

export function materializeSpatialPlan(
  plan: VenuePlan,
  changes: readonly PlanningChange[] = [],
  {
    projectLocks = [],
    allowLockConflicts = false,
  }: { projectLocks?: readonly ObjectLock[]; allowLockConflicts?: boolean } = {},
): VenuePlan {
  if (!allowLockConflicts) assertNoLockConflicts(plan, changes, projectLocks);
  const objects = clone(plan.objects);
  let spatial = clone(plan.spatial);
  const byId = new Map(objects.map((object) => [object.id, object]));
  for (const change of changes) {
    for (const effect of change.spatialEffects ?? []) {
      if (effect.operation === "update_room_boundary") {
        if (!effect.roomBoundary)
          throw venueError("CONSTRAINT_EVIDENCE_INVALID", { changeId: change.id, operation: effect.operation });
        spatial = { ...spatial, roomBoundary: clone(effect.roomBoundary) };
        continue;
      }
      if (effect.operation === "add_object") {
        if (!effect.object?.id || byId.has(effect.object.id))
          throw venueError("SPATIAL_CHANGE_TARGET_EXISTS", {
            objectId: effect.object?.id ?? null,
            changeId: change.id,
          });
        const added = clone(effect.object);
        objects.push(added);
        byId.set(added.id, added);
        continue;
      }
      if (!effect.objectId) throw venueError("SPATIAL_CHANGE_TARGET_MISSING", { objectId: null, changeId: change.id });
      const object = byId.get(effect.objectId);
      if (!object)
        throw venueError(
          "SPATIAL_CHANGE_TARGET_MISSING",
          { objectId: effect.objectId, changeId: change.id },
          `Spatial Change targets missing object: ${effect.objectId}`,
        );
      if (effect.operation === "update_footprint") {
        if (
          !effect.footprint ||
          (effect.footprint.kind !== undefined && effect.footprint.kind !== object.footprint.kind)
        )
          throw venueError("CONSTRAINT_EVIDENCE_INVALID", { changeId: change.id, objectId: object.id });
        object.footprint = mergeFootprint(object.footprint, clone(effect.footprint));
      } else if (effect.operation === "update_metadata") Object.assign(object, clone(effect.values));
      else if (effect.operation === "delete_object") {
        objects.splice(
          objects.findIndex((item) => item.id === effect.objectId),
          1,
        );
        byId.delete(effect.objectId);
      } else
        throw venueError(
          "SPATIAL_CHANGE_UNSUPPORTED",
          { operation: effect.operation, objectId: effect.objectId, changeId: change.id },
          `Unsupported spatial Change operation: ${effect.operation}`,
        );
    }
  }
  return normalizePlanGeometry({ ...plan, spatial, objects }, plan);
}

const buildRouteGraph = (objects: readonly VenueObject[]): RouteGraph => {
  const routeObjects = objects.filter(
    (object): object is LineRouteObject =>
      ["accessible_route", "aisle", "corridor", "service_lane"].includes(object.kind) &&
      object.footprint.kind === "line" &&
      object.route?.staffOnly !== true,
  );
  const blockers = objects.filter((object) => object.circulation?.blocksPath === true);
  const nodes = new Map<string, RouteNode>();
  const edges: RouteEdge[] = [];
  const nodeFor = (point: Point): RouteNode => {
    const existing = [...nodes.values()].find((node) => distance(node.point, point) <= JOIN_TOLERANCE_M);
    if (existing) return existing;
    const node: RouteNode = {
      id: `node-${pointKey(point)}`,
      point: { x: round(point.x), y: round(point.y) },
      edgeIds: [],
    };
    nodes.set(node.id, node);
    return node;
  };
  for (const object of routeObjects) {
    const start = nodeFor(object.footprint.start);
    const end = nodeFor(object.footprint.end);
    const edge = {
      id: `edge-${object.id}`,
      objectId: object.id,
      startNodeId: start.id,
      endNodeId: end.id,
      widthM: object.footprint.width,
      lengthM: round(distance(object.footprint.start, object.footprint.end)),
      blockedByObjectIds: blockers
        .filter(
          (blocker) =>
            blocker.id !== object.id &&
            segmentIntersectsFootprint(object.footprint.start, object.footprint.end, blocker.footprint),
        )
        .map((blocker) => blocker.id)
        .sort(),
    };
    edges.push(edge);
    start.edgeIds.push(edge.id);
    end.edgeIds.push(edge.id);
  }
  const sortedNodes = [...nodes.values()]
    .map((node) => ({ ...node, edgeIds: node.edgeIds.sort() }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const sortedEdges = edges.sort((a, b) => a.id.localeCompare(b.id));
  return { nodes: sortedNodes, edges: sortedEdges, routeObjects };
};

const ringArea = (points: readonly Point[]): number =>
  Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return next ? sum + point.x * next.y - next.x * point.y : sum;
    }, 0) / 2,
  );

const footprintArea = (footprint: Footprint): number => {
  if (footprint.kind === "rectangle") return footprint.width * footprint.depth;
  if (footprint.kind === "circle") return Math.PI * footprint.radius ** 2;
  if (footprint.kind === "line") return distance(footprint.start, footprint.end) * footprint.width;
  if (footprint.kind === "polygon") return ringArea(footprint.points);
  return 0;
};

const reachableNodeIds = (graph: RouteGraph, seedNodeIds: readonly string[]): Set<string> => {
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const reached = new Set(seedNodeIds);
  const queue = [...seedNodeIds];
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) continue;
    const node = nodes.get(currentId);
    if (!node) continue;
    for (const edgeId of node?.edgeIds ?? []) {
      const edge = edges.get(edgeId);
      if (!edge) continue;
      if (edge.blockedByObjectIds.length > 0) continue;
      const next = edge.startNodeId === node.id ? edge.endNodeId : edge.startNodeId;
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
};

const doorClearancePolygon = (
  door: DoorObject & { door: DoorMetadata & { clearance: NonNullable<DoorMetadata["clearance"]> } },
  side: "left" | "right",
): Point[] => {
  const { start, end } = door.footprint;
  const length = distance(start, end);
  const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const normal = side === "left" ? { x: -tangent.y, y: tangent.x } : { x: tangent.y, y: -tangent.x };
  const latch = door.door.clearance.latchSideM;
  const depth = door.door.clearance.depthM;
  const first = { x: round(start.x - tangent.x * latch), y: round(start.y - tangent.y * latch) };
  const second = { x: round(end.x + tangent.x * latch), y: round(end.y + tangent.y * latch) };
  return [
    first,
    second,
    { x: round(second.x + normal.x * depth), y: round(second.y + normal.y * depth) },
    { x: round(first.x + normal.x * depth), y: round(first.y + normal.y * depth) },
  ];
};

const exitApproachPolygon = (exit: ExitObject, roomBoundary: RoomBoundary, depthM: number): Point[] => {
  const { start, end } = exit.footprint;
  const length = distance(start, end);
  const tangent = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const normals: readonly [Point, Point] = [
    { x: -tangent.y, y: tangent.x },
    { x: tangent.y, y: -tangent.x },
  ];
  const roomCenter = {
    x: roomBoundary.outer.reduce((sum, point) => sum + point.x, 0) / roomBoundary.outer.length,
    y: roomBoundary.outer.reduce((sum, point) => sum + point.y, 0) / roomBoundary.outer.length,
  };
  const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const score = (normal: Point): number =>
    normal.x * (roomCenter.x - midpoint.x) + normal.y * (roomCenter.y - midpoint.y);
  const inward = score(normals[0]) >= score(normals[1]) ? normals[0] : normals[1];
  return [
    { x: round(start.x), y: round(start.y) },
    { x: round(end.x), y: round(end.y) },
    { x: round(end.x + inward.x * depthM), y: round(end.y + inward.y * depthM) },
    { x: round(start.x + inward.x * depthM), y: round(start.y + inward.y * depthM) },
  ];
};

const accessibilityEvidence = (plan: VenuePlan, sightlines: ReturnType<typeof sightlineEvidence>) => {
  const graph = buildRouteGraph(plan.objects);
  const entrances = plan.objects.filter((object) => object.kind === "accessible_entrance");
  const destinations = plan.objects.filter((object) => object.accessibility?.destination === true);
  const nodesTouching = (object: VenueObject): string[] => {
    const nodeIds = new Set(
      graph.nodes.filter((node) => pointTouchesFootprint(node.point, object.footprint)).map((node) => node.id),
    );
    for (const edge of graph.edges) {
      const route = graph.routeObjects.find((item) => item.id === edge.objectId);
      if (route && segmentIntersectsFootprint(route.footprint.start, route.footprint.end, object.footprint)) {
        nodeIds.add(edge.startNodeId);
        nodeIds.add(edge.endNodeId);
      }
    }
    return [...nodeIds];
  };
  const entranceNodeIds = entrances.flatMap(nodesTouching);
  const reachedNodes = reachableNodeIds(graph, entranceNodeIds);
  const reachableDestinationIds = destinations
    .filter((object) => nodesTouching(object).some((nodeId) => reachedNodes.has(nodeId)))
    .map((object) => object.id)
    .sort();
  const unreachableDestinationIds = destinations
    .map((object) => object.id)
    .filter((id) => !reachableDestinationIds.includes(id))
    .sort();
  const junctions = graph.nodes.filter((node) => node.edgeIds.length >= 3);
  const edgeById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const turningClearanceM =
    junctions.length === 0
      ? 0
      : Math.min(...junctions.map((node) => Math.min(...node.edgeIds.map((id) => edgeById.get(id)?.widthM ?? 0))));
  const minimumClearWidthM = graph.edges.length === 0 ? 0 : Math.min(...graph.edges.map((edge) => edge.widthM));
  const connected =
    entranceNodeIds.length > 0 &&
    graph.nodes.length > 0 &&
    graph.nodes.every((node) => reachedNodes.has(node.id)) &&
    unreachableDestinationIds.length === 0;
  const policy = plan.accessibilityPolicy;
  const accessibleSeatingSections = plan.objects
    .filter((object) => object.kind === "seating_section" && (object.accessibility?.accessibleSeats ?? 0) > 0)
    .map((object) => ({
      objectId: object.id,
      accessibleSeats: object.accessibility?.accessibleSeats ?? 0,
      companionSeats: object.accessibility?.companionSeats ?? 0,
    }))
    .sort((a, b) => a.objectId.localeCompare(b.objectId));
  const accessibleSeats = accessibleSeatingSections.reduce((sum, section) => sum + section.accessibleSeats, 0);
  const companionSeats = accessibleSeatingSections.reduce((sum, section) => sum + section.companionSeats, 0);
  const accessibleSeatSightlineSections = accessibleSeatingSections.map((section) => {
    const object = plan.objects.find((item) => item.id === section.objectId);
    const sampleIds = [...new Set(object?.accessibility?.accessibleSeatSampleIds ?? [])].sort();
    const rays = sightlines.rays.filter((ray) => sampleIds.includes(ray.sampleId));
    const blockedSampleIds = rays.filter((ray) => ray.status === "blocked").map((ray) => ray.sampleId);
    return {
      objectId: section.objectId,
      sampleIds,
      blockedSampleIds,
      coverageRatio: rays.length ? round((rays.length - blockedSampleIds.length) / rays.length, 3) : 0,
      evidenceRayIds: rays.map((ray) => ray.id),
    };
  });
  const accessibleSeatSampleIds = accessibleSeatSightlineSections.flatMap((section) => section.sampleIds).sort();
  const blockedAccessibleSeatSampleIds = accessibleSeatSightlineSections
    .flatMap((section) => section.blockedSampleIds)
    .sort();
  const missingAccessibleSeatSampleSectionIds = accessibleSeatSightlineSections
    .filter((section) => section.sampleIds.length === 0)
    .map((section) => section.objectId);
  const accessibleSeatSightlineCoverageRatio = accessibleSeatSampleIds.length
    ? round(
        (accessibleSeatSampleIds.length - blockedAccessibleSeatSampleIds.length) / accessibleSeatSampleIds.length,
        3,
      )
    : 0;
  const accessibleDoors = plan.objects.filter(
    (object): object is DoorObject => object.kind === "door" && isDoorObject(object) && object.door.accessible,
  );
  const clearanceExemptKinds = new Set([
    "door",
    "fire_exit",
    "accessible_entrance",
    "accessible_route",
    "corridor",
    "aisle",
    "service_lane",
    "temporary_ramp",
  ]);
  const doorClearanceZones = accessibleDoors
    .flatMap<DoorClearanceZone>((door) => {
      const clearance = door.door.clearance;
      if (!clearance)
        return [
          {
            id: `door-clearance-${door.id}-missing`,
            doorObjectId: door.id,
            side: null,
            points: [] as Point[],
            obstructingObjectIds: [] as string[],
            status: "missing" as const,
          },
        ];
      const clearedDoor = { ...door, door: { ...door.door, clearance } };
      const sides: Array<"left" | "right"> = clearance.side === "both" ? ["left", "right"] : [clearance.side];
      return sides.map((side) => {
        const points = doorClearancePolygon(clearedDoor, side);
        const obstructingObjectIds = plan.objects
          .filter(
            (object) =>
              object.id !== door.id &&
              !clearanceExemptKinds.has(object.kind) &&
              object.accessibility?.clearanceExempt !== true &&
              polygonIntersectsFootprint(points, object.footprint),
          )
          .map((object) => object.id)
          .sort();
        return {
          id: `door-clearance-${door.id}-${side}`,
          doorObjectId: door.id,
          side,
          points,
          depthM: clearance.depthM,
          latchSideM: clearance.latchSideM,
          obstructingObjectIds,
          status: obstructingObjectIds.length ? ("blocked" as const) : ("clear" as const),
        };
      });
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const minimumDoorClearWidthM = accessibleDoors.length
    ? Math.min(...accessibleDoors.map((door) => door.door.clearWidthM))
    : 0;
  const obstructedDoorObjectIds = [
    ...new Set(doorClearanceZones.filter((zone) => zone.status !== "clear").map((zone) => zone.doorObjectId)),
  ].sort();
  const ramps = plan.objects
    .filter((object): object is RampObject => object.kind === "temporary_ramp" && isRampObject(object))
    .map((object) => {
      const slopeRatio = round(object.ramp.runM / object.ramp.riseM, 2);
      const failures = [
        ...(slopeRatio < (policy?.minimumRampSlopeRatio ?? 12) ? ["slope"] : []),
        ...(object.ramp.clearWidthM < (policy?.minimumRampClearWidthM ?? 0.915) ? ["width"] : []),
        ...(object.ramp.landingLengthM < (policy?.minimumRampLandingLengthM ?? 1.525) ? ["landing"] : []),
        ...(object.ramp.edgeProtectionHeightM < (policy?.minimumRampEdgeProtectionHeightM ?? 0.1)
          ? ["edge-protection"]
          : []),
        ...((policy?.requireRampHandrails ?? true) && !object.ramp.handrails ? ["handrails"] : []),
      ];
      return {
        objectId: object.id,
        slopeRatio,
        riseM: object.ramp.riseM,
        runM: object.ramp.runM,
        clearWidthM: object.ramp.clearWidthM,
        landingLengthM: object.ramp.landingLengthM,
        edgeProtectionHeightM: object.ramp.edgeProtectionHeightM,
        handrails: object.ramp.handrails,
        failures,
        status: failures.length ? "fail" : "pass",
      };
    })
    .sort((left, right) => left.objectId.localeCompare(right.objectId));
  return {
    source: "canonical-geometry",
    graphFingerprint: fingerprint("graph", { nodes: graph.nodes, edges: graph.edges }),
    connected,
    entranceObjectIds: entrances.map((object) => object.id).sort(),
    routeObjectIds: graph.routeObjects.map((object) => object.id).sort(),
    reachableDestinationIds,
    unreachableDestinationIds,
    minimumClearWidthM: round(minimumClearWidthM),
    turningClearanceM: round(turningClearanceM),
    minimumTurningClearanceM: policy?.minimumTurningClearanceM ?? 1.5,
    accessibleSeatingSections,
    accessibleSeats,
    companionSeats,
    minimumAccessibleSeats: policy?.minimumAccessibleSeats ?? 0,
    seatingDistributed: accessibleSeatingSections.length >= (policy?.minimumAccessibleSeatingSections ?? 1),
    companionAdjacencySatisfied: accessibleSeatingSections.every(
      (section) => section.companionSeats >= section.accessibleSeats,
    ),
    accessibleSeatSampleIds,
    blockedAccessibleSeatSampleIds,
    accessibleSeatSightlineCoverageRatio,
    accessibleSeatSightlineSections,
    missingAccessibleSeatSampleSectionIds,
    doorClearanceZones,
    accessibleDoorObjectIds: accessibleDoors.map((door) => door.id).sort(),
    minimumDoorClearWidthM: round(minimumDoorClearWidthM),
    obstructedDoorObjectIds,
    ramps,
    rampPolicy: {
      minimumSlopeRatio: policy?.minimumRampSlopeRatio ?? 12,
      minimumClearWidthM: policy?.minimumRampClearWidthM ?? 0.915,
      minimumLandingLengthM: policy?.minimumRampLandingLengthM ?? 1.525,
      minimumEdgeProtectionHeightM: policy?.minimumRampEdgeProtectionHeightM ?? 0.1,
      requireHandrails: policy?.requireRampHandrails ?? true,
    },
    policy: {
      jurisdiction: policy?.jurisdiction ?? "venue-policy",
      source: policy?.source ?? "Venue accessibility policy",
      effectiveDate: policy?.effectiveDate ?? null,
    },
    nodes: graph.nodes,
    edges: graph.edges,
  };
};

const DENSITY_M2_PER_ATTENDEE = { theater: 0.8, classroom: 1.8, banquet: 1.4, standing: 0.5, mixed: 1, custom: 1 };

const capacityBand = (capacity: number, minimumCapacity: number, maximumCapacity: number): string => {
  if (Number.isFinite(minimumCapacity) && capacity < minimumCapacity) return "under-target";
  if (Number.isFinite(maximumCapacity) && capacity > maximumCapacity) return "over-capacity";
  return "within-limit";
};

const assertCapacityRange = (
  scopeKind: string,
  scopeId: string,
  minimumCapacity: number,
  maximumCapacity: number,
): void => {
  if (
    !Number.isInteger(minimumCapacity) ||
    minimumCapacity < 0 ||
    !Number.isInteger(maximumCapacity) ||
    maximumCapacity < minimumCapacity
  ) {
    throw venueError(
      "CONSTRAINT_EVIDENCE_INVALID",
      { scopeKind, scopeId, minimumCapacity, maximumCapacity },
      `Invalid capacity range for ${scopeKind} ${scopeId}`,
    );
  }
};

const capacitySnapshot = (plan: VenuePlan, brief: EventBrief | null) => {
  const roomAreaM2 =
    ringArea(plan.spatial.roomBoundary.outer) -
    plan.spatial.roomBoundary.holes.reduce((sum, hole) => sum + ringArea(hole), 0);
  const excludedObjects = plan.objects.filter((object) => object.occupancy?.excludesUsableArea === true);
  const excludedAreaM2 = excludedObjects.reduce((sum, object) => sum + footprintArea(object.footprint), 0);
  const usableRoomAreaM2 = roomAreaM2 - excludedAreaM2;
  const seating = plan.objects.filter(
    (object): object is OccupiedObject =>
      object.kind === "seating_section" &&
      typeof object.capacity === "number" &&
      Number.isInteger(object.capacity) &&
      object.capacity >= 0,
  );
  const seatingIds = new Set(seating.map((object) => object.id));
  const zoneIds = new Set();
  for (const zone of plan.occupancy?.zones ?? []) {
    if (
      !zone.id ||
      zoneIds.has(zone.id) ||
      !Array.isArray(zone.sectionObjectIds) ||
      zone.sectionObjectIds.some((objectId) => !seatingIds.has(objectId))
    ) {
      throw venueError(
        "CONSTRAINT_EVIDENCE_INVALID",
        { scopeKind: "zone", scopeId: zone.id ?? null },
        `Invalid Occupancy Zone: ${zone.id ?? "missing-id"}`,
      );
    }
    zoneIds.add(zone.id);
    assertCapacityRange("zone", zone.id, zone.minimumCapacity ?? 0, zone.maximumCapacity ?? Number.MAX_SAFE_INTEGER);
  }
  const sectionPolicyIds = new Set();
  for (const section of plan.occupancy?.sections ?? []) {
    if (
      !section.objectId ||
      sectionPolicyIds.has(section.objectId) ||
      !seatingIds.has(section.objectId) ||
      (section.zoneId != null && !zoneIds.has(section.zoneId))
    ) {
      throw venueError(
        "CONSTRAINT_EVIDENCE_INVALID",
        { scopeKind: "section", scopeId: section.objectId ?? null },
        `Invalid Seating Section capacity policy: ${section.objectId ?? "missing-id"}`,
      );
    }
    sectionPolicyIds.add(section.objectId);
    assertCapacityRange(
      "section",
      section.objectId,
      section.minimumCapacity ?? 0,
      section.maximumCapacity ?? Number.MAX_SAFE_INTEGER,
    );
  }
  const sectionPolicies = new Map((plan.occupancy?.sections ?? []).map((section) => [section.objectId, section]));
  const sectionCapacities = seating
    .map((object) => {
      const sectionPolicy = sectionPolicies.get(object.id) ?? object.occupancy ?? {};
      const minimumCapacity = sectionPolicy.minimumCapacity ?? 0;
      const maximumCapacity = sectionPolicy.maximumCapacity ?? Number.MAX_SAFE_INTEGER;
      assertCapacityRange("section", object.id, minimumCapacity, maximumCapacity);
      return {
        objectId: object.id,
        label: object.label,
        zoneId: sectionPolicy.zoneId ?? null,
        capacity: object.capacity,
        minimumCapacity,
        maximumCapacity,
        status: capacityBand(object.capacity, minimumCapacity, maximumCapacity),
        deltaFromMinimum: object.capacity - minimumCapacity,
        headroom: maximumCapacity - object.capacity,
      };
    })
    .sort((a, b) => a.objectId.localeCompare(b.objectId));
  const placedCapacity = sectionCapacities.reduce((sum, section) => sum + section.capacity, 0);
  const sectionsById = new Map(sectionCapacities.map((section) => [section.objectId, section]));
  const zoneCapacities = (plan.occupancy?.zones ?? [])
    .map((zone) => {
      const sectionObjectIds = [...zone.sectionObjectIds].sort();
      const capacity = sectionObjectIds.reduce((sum, objectId) => sum + (sectionsById.get(objectId)?.capacity ?? 0), 0);
      const minimumCapacity = zone.minimumCapacity ?? 0;
      const maximumCapacity = zone.maximumCapacity ?? Number.MAX_SAFE_INTEGER;
      return {
        zoneId: zone.id,
        label: zone.label,
        sectionObjectIds,
        capacity,
        minimumCapacity,
        maximumCapacity,
        status: capacityBand(capacity, minimumCapacity, maximumCapacity),
        deltaFromMinimum: capacity - minimumCapacity,
        headroom: maximumCapacity - capacity,
      };
    })
    .sort((a, b) => a.zoneId.localeCompare(b.zoneId));
  const densityM2PerAttendee =
    plan.occupancy?.densityM2PerAttendee ?? DENSITY_M2_PER_ATTENDEE[brief?.occupancyMode ?? "custom"];
  const densityCapacity = Math.floor(usableRoomAreaM2 / densityM2PerAttendee);
  const venueMaximum = plan.occupancy?.venueMaximum ?? Number.MAX_SAFE_INTEGER;
  const operationalCounts = {
    staff: plan.occupancy?.staff ?? 0,
    performers: plan.occupancy?.performers ?? 0,
    vendors: plan.occupancy?.vendors ?? 0,
  };
  const nonAttendeeLoad = Object.values(operationalCounts).reduce((sum, count) => sum + count, 0);
  const attendeeTarget = brief?.attendeeTarget ?? plan.event.attendeeTarget ?? 0;
  const operationalLoad = attendeeTarget + nonAttendeeLoad;
  const attendeeVenueLimit = Math.max(0, venueMaximum - nonAttendeeLoad);
  const effectiveCapacity = Math.min(placedCapacity, densityCapacity, attendeeVenueLimit);
  const explanations = [
    ...sectionCapacities
      .filter((section) => section.status !== "within-limit")
      .map((section) => ({
        code: section.status === "under-target" ? "SECTION_UNDER_TARGET" : "SECTION_OVER_CAPACITY",
        scopeKind: "section",
        scopeId: section.objectId,
        actual: section.capacity,
        target: section.status === "under-target" ? section.minimumCapacity : section.maximumCapacity,
        delta:
          section.status === "under-target"
            ? section.capacity - section.minimumCapacity
            : section.capacity - section.maximumCapacity,
      })),
    ...zoneCapacities
      .filter((zone) => zone.status !== "within-limit")
      .map((zone) => ({
        code: zone.status === "under-target" ? "ZONE_UNDER_TARGET" : "ZONE_OVER_CAPACITY",
        scopeKind: "zone",
        scopeId: zone.zoneId,
        actual: zone.capacity,
        target: zone.status === "under-target" ? zone.minimumCapacity : zone.maximumCapacity,
        delta:
          zone.status === "under-target" ? zone.capacity - zone.minimumCapacity : zone.capacity - zone.maximumCapacity,
      })),
    ...(effectiveCapacity < attendeeTarget
      ? [
          {
            code: "PLAN_UNDER_TARGET",
            scopeKind: "plan",
            scopeId: plan.id,
            actual: effectiveCapacity,
            target: attendeeTarget,
            delta: effectiveCapacity - attendeeTarget,
          },
        ]
      : []),
    ...(operationalLoad > venueMaximum
      ? [
          {
            code: "VENUE_OVER_CAPACITY",
            scopeKind: "venue",
            scopeId: plan.venue.id,
            actual: operationalLoad,
            target: venueMaximum,
            delta: operationalLoad - venueMaximum,
          },
        ]
      : []),
    ...(placedCapacity > densityCapacity
      ? [
          {
            code: "DENSITY_OVER_CAPACITY",
            scopeKind: "plan",
            scopeId: plan.id,
            actual: placedCapacity,
            target: densityCapacity,
            delta: placedCapacity - densityCapacity,
          },
        ]
      : []),
  ];
  return {
    source: "canonical-geometry",
    roomAreaM2: round(roomAreaM2),
    excludedAreaM2: round(excludedAreaM2),
    excludedObjectIds: excludedObjects.map((object) => object.id).sort(),
    usableRoomAreaM2: round(usableRoomAreaM2),
    occupancyMode: brief?.occupancyMode ?? "custom",
    densityM2PerAttendee,
    densityCapacity,
    sectionCapacities,
    zoneCapacities,
    placedCapacity,
    venueMaximum,
    operationalCounts,
    nonAttendeeLoad,
    attendeeTarget,
    operationalLoad,
    effectiveCapacity,
    explanations,
  };
};

const capacityDelta = (
  baseline: ReturnType<typeof capacitySnapshot>,
  candidate: ReturnType<typeof capacitySnapshot>,
  changeId: string,
) => ({
  changeId,
  placedCapacityDelta: candidate.placedCapacity - baseline.placedCapacity,
  effectiveCapacityDelta: candidate.effectiveCapacity - baseline.effectiveCapacity,
  operationalLoadDelta: candidate.operationalLoad - baseline.operationalLoad,
  sectionDeltas: candidate.sectionCapacities
    .map((section) => {
      const before = baseline.sectionCapacities.find((item) => item.objectId === section.objectId)?.capacity ?? 0;
      return { objectId: section.objectId, before, after: section.capacity, delta: section.capacity - before };
    })
    .filter((item) => item.delta !== 0),
  zoneDeltas: candidate.zoneCapacities
    .map((zone) => {
      const before = baseline.zoneCapacities.find((item) => item.zoneId === zone.zoneId)?.capacity ?? 0;
      return { zoneId: zone.zoneId, before, after: zone.capacity, delta: zone.capacity - before };
    })
    .filter((item) => item.delta !== 0),
});

const capacityEvidence = (
  basePlan: VenuePlan,
  candidatePlan: VenuePlan,
  changes: readonly PlanningChange[],
  brief: EventBrief | null,
  projectLocks: readonly ObjectLock[],
) => {
  const baseline = capacitySnapshot(basePlan, brief);
  const candidate = capacitySnapshot(candidatePlan, brief);
  return {
    ...candidate,
    changeDeltas: changes.map((change) =>
      capacityDelta(
        baseline,
        capacitySnapshot(materializeSpatialPlan(basePlan, [change], { projectLocks, allowLockConflicts: true }), brief),
        change.id,
      ),
    ),
  };
};

const shortestPath = (
  graph: RouteGraph,
  sourceNodeIds: readonly string[],
  targetNodeIds: readonly string[],
  excludedEdgeIds: ReadonlySet<string> = new Set(),
) => {
  const targetSet = new Set(targetNodeIds);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const distances = new Map(graph.nodes.map((node) => [node.id, Number.POSITIVE_INFINITY]));
  const previous = new Map<string, { nodeId: string; edgeId: string }>();
  const queue = new Set(graph.nodes.map((node) => node.id));
  for (const nodeId of sourceNodeIds) distances.set(nodeId, 0);
  while (queue.size) {
    const currentId = [...queue].sort(
      (left, right) =>
        (distances.get(left) ?? Infinity) - (distances.get(right) ?? Infinity) || left.localeCompare(right),
    )[0];
    if (!currentId) break;
    queue.delete(currentId);
    const currentDistance = distances.get(currentId);
    if (currentDistance === undefined || !Number.isFinite(currentDistance)) break;
    if (targetSet.has(currentId)) {
      const routeObjectIds = [];
      let cursor = currentId;
      while (previous.has(cursor)) {
        const step = previous.get(cursor);
        if (!step) break;
        const routeEdge = edges.get(step.edgeId);
        if (!routeEdge) break;
        routeObjectIds.push(routeEdge.objectId);
        cursor = step.nodeId;
      }
      return { targetNodeId: currentId, distanceM: round(currentDistance), routeObjectIds: routeObjectIds.sort() };
    }
    const node = nodes.get(currentId);
    if (!node) continue;
    for (const edgeId of node.edgeIds) {
      const edge = edges.get(edgeId);
      if (!edge) continue;
      if (excludedEdgeIds.has(edgeId) || edge.blockedByObjectIds.length > 0) continue;
      const neighborId = edge.startNodeId === currentId ? edge.endNodeId : edge.startNodeId;
      if (!queue.has(neighborId)) continue;
      const candidate = currentDistance + edge.lengthM;
      const neighborDistance = distances.get(neighborId) ?? Infinity;
      if (candidate < neighborDistance) {
        distances.set(neighborId, candidate);
        previous.set(neighborId, { nodeId: currentId, edgeId });
      }
    }
  }
  return null;
};

const circulationSnapshot = (plan: VenuePlan, graph: RouteGraph, capacity: ReturnType<typeof capacitySnapshot>) => {
  const occupiedObjects = plan.objects.filter(
    (object): object is OccupiedObject => object.kind === "seating_section" && hasPositiveCapacity(object),
  );
  const exits = plan.objects.filter(
    (object): object is ExitObject => object.kind === "fire_exit" && isExitObject(object),
  );
  const nodesTouching = (object: VenueObject): string[] =>
    graph.nodes.filter((node) => pointTouchesFootprint(node.point, object.footprint)).map((node) => node.id);
  const exitNodeEntries: Array<readonly [string, string]> = exits.flatMap((exit) =>
    nodesTouching(exit).map((nodeId) => [nodeId, exit.id] as const),
  );
  const exitNodes = exitNodeEntries.map(([nodeId]) => nodeId);
  const exitByNodeId = new Map(exitNodeEntries);
  const shortestExitPaths: Array<{
    occupiedObjectId: string;
    exitObjectId: string | null;
    distanceM: number;
    routeObjectIds: string[];
  }> = [];
  const disconnectedOccupiedObjectIds: string[] = [];
  for (const occupied of occupiedObjects) {
    const path = shortestPath(graph, nodesTouching(occupied), exitNodes);
    if (!path) disconnectedOccupiedObjectIds.push(occupied.id);
    else
      shortestExitPaths.push({
        occupiedObjectId: occupied.id,
        exitObjectId: exitByNodeId.get(path.targetNodeId) ?? null,
        distanceM: path.distanceM,
        routeObjectIds: path.routeObjectIds,
      });
  }
  shortestExitPaths.sort((a, b) => a.occupiedObjectId.localeCompare(b.occupiedObjectId));
  const exitApproachDepthM = plan.circulationPolicy?.exitApproachDepthM ?? 1.2;
  const approachBlockers = plan.objects.filter(
    (object) =>
      !["fire_exit", "door", "accessible_route", "aisle", "corridor", "service_lane"].includes(object.kind) &&
      object.circulation?.blocksExitApproach !== false,
  );
  const exitApproachZones = exits
    .map((exit) => {
      const points = exitApproachPolygon(exit, plan.spatial.roomBoundary, exitApproachDepthM);
      const obstructingObjectIds = approachBlockers
        .filter((object) => polygonIntersectsFootprint(points, object.footprint))
        .map((object) => object.id)
        .sort();
      return {
        id: `exit-approach-${exit.id}`,
        exitObjectId: exit.id,
        depthM: exitApproachDepthM,
        points,
        status: obstructingObjectIds.length ? "blocked" : "clear",
        obstructingObjectIds,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
  const obstructedExitObjectIds = exitApproachZones
    .filter((zone) => zone.status === "blocked")
    .map((zone) => zone.exitObjectId);
  const blockedEdges = graph.edges.filter((edge) => edge.blockedByObjectIds.length > 0);
  const traversableEdges = graph.edges.filter((edge) => edge.blockedByObjectIds.length === 0);
  const bottleneckWidthM = traversableEdges.length ? Math.min(...traversableEdges.map((edge) => edge.widthM)) : 0;
  const hardBlock =
    blockedEdges.length > 0 || disconnectedOccupiedObjectIds.length > 0 || obstructedExitObjectIds.length > 0;
  const congestionIndex = (demand: number): number =>
    hardBlock ? 1000 : bottleneckWidthM > 0 ? round(demand / (bottleneckWidthM * 3.6), 1) : 1000;
  const phaseProfiles = [
    { phase: "ingress", demand: Math.round(capacity.attendeeTarget * 0.75) },
    { phase: "interval", demand: Math.round(capacity.attendeeTarget * 0.35) },
    { phase: "egress", demand: capacity.operationalLoad },
    { phase: "emergency", demand: capacity.operationalLoad },
  ].map((profile) => ({ ...profile, congestionIndex: congestionIndex(profile.demand) }));
  const criticalRouteEdges = traversableEdges
    .map((edge) => {
      const impactedOccupiedObjectIds = occupiedObjects
        .filter((occupied) => {
          const baseline = shortestExitPaths.some((path) => path.occupiedObjectId === occupied.id);
          return baseline && !shortestPath(graph, nodesTouching(occupied), exitNodes, new Set([edge.id]));
        })
        .map((object) => object.id)
        .sort();
      return { edgeId: edge.id, routeObjectId: edge.objectId, impactedOccupiedObjectIds };
    })
    .filter((edge) => edge.impactedOccupiedObjectIds.length > 0)
    .sort((left, right) => left.edgeId.localeCompare(right.edgeId));
  const capacityByObjectId = new Map(capacity.sectionCapacities.map((section) => [section.objectId, section.capacity]));
  const routeLoads = traversableEdges.map((edge) => {
    const demand = shortestExitPaths
      .filter((path) => path.routeObjectIds.includes(edge.objectId))
      .reduce((sum, path) => sum + (capacityByObjectId.get(path.occupiedObjectId) ?? 0), 0);
    const ratedDemand = round(edge.widthM * 3.6, 1);
    return {
      id: `bottleneck-route-${edge.objectId}`,
      kind: "route",
      objectId: edge.objectId,
      demand,
      ratedDemand,
      loadIndex: ratedDemand > 0 ? round(demand / ratedDemand, 1) : 1000,
    };
  });
  const assignedCapacityByExit = new Map(
    exits.map((exit) => [
      exit.id,
      shortestExitPaths
        .filter((path) => path.exitObjectId === exit.id)
        .reduce((sum, path) => sum + (capacityByObjectId.get(path.occupiedObjectId) ?? 0), 0),
    ]),
  );
  const assignedCapacityTotal = [...assignedCapacityByExit.values()].reduce((sum, value) => sum + value, 0);
  const exitLoads = exits.map((exit) => {
    const assignedCapacity = assignedCapacityByExit.get(exit.id) ?? 0;
    const demand =
      assignedCapacityTotal > 0 ? round((capacity.operationalLoad * assignedCapacity) / assignedCapacityTotal, 1) : 0;
    return {
      id: `bottleneck-exit-${exit.id}`,
      kind: "exit",
      objectId: exit.id,
      demand,
      ratedDemand: exit.exit.capacityPersons,
      loadIndex: round((demand / exit.exit.capacityPersons) * 100, 1),
    };
  });
  const junctionLoads = graph.nodes
    .filter((node) => node.edgeIds.length >= 3)
    .map((node) => {
      const demand = shortestExitPaths
        .filter((path) =>
          path.routeObjectIds.some((objectId) =>
            node.edgeIds.some((edgeId) => graph.edges.find((edge) => edge.id === edgeId)?.objectId === objectId),
          ),
        )
        .reduce((sum, path) => sum + (capacityByObjectId.get(path.occupiedObjectId) ?? 0), 0);
      const widthM = Math.min(
        ...node.edgeIds.map(
          (edgeId) => graph.edges.find((edge) => edge.id === edgeId)?.widthM ?? Number.MAX_SAFE_INTEGER,
        ),
      );
      const ratedDemand = round(widthM * 3.6, 1);
      return {
        id: `bottleneck-junction-${node.id}`,
        kind: "aisle-intersection",
        nodeId: node.id,
        demand,
        ratedDemand,
        loadIndex: ratedDemand > 0 ? round(demand / ratedDemand, 1) : 1000,
      };
    });
  const controlLoads = plan.objects
    .filter(
      (object): object is VenueObject & { circulation: NonNullable<VenueObject["circulation"]> } =>
        object.circulation?.role === "queue" || object.circulation?.role === "checkpoint",
    )
    .map((object) => {
      const demand = object.circulation.demandPersons ?? capacity.operationalLoad;
      const ratedDemand = object.circulation.capacityPersons ?? 0;
      return {
        id: `bottleneck-${object.circulation.role}-${object.id}`,
        kind: object.circulation.role,
        objectId: object.id,
        demand,
        ratedDemand,
        loadIndex: ratedDemand > 0 ? round((demand / ratedDemand) * 100, 1) : 1000,
      };
    });
  const bottleneckLoads = [...routeLoads, ...exitLoads, ...junctionLoads, ...controlLoads].sort(
    (left, right) => right.loadIndex - left.loadIndex || left.id.localeCompare(right.id),
  );
  return {
    source: "canonical-geometry",
    graphFingerprint: fingerprint("graph", { nodes: graph.nodes, edges: graph.edges }),
    connected:
      graph.edges.length > 0 &&
      disconnectedOccupiedObjectIds.length === 0 &&
      exits.length > 0 &&
      blockedEdges.length === 0 &&
      obstructedExitObjectIds.length === 0,
    routeObjectIds: graph.routeObjects.map((object) => object.id).sort(),
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
    exitObjectIds: exits.map((object) => object.id).sort(),
    occupiedObjectIds: occupiedObjects.map((object) => object.id).sort(),
    disconnectedOccupiedObjectIds: disconnectedOccupiedObjectIds.sort(),
    blockedRouteObjectIds: blockedEdges.map((edge) => edge.objectId).sort(),
    blockingObjectIds: [...new Set(blockedEdges.flatMap((edge) => edge.blockedByObjectIds))].sort(),
    exitApproachZones,
    obstructedExitObjectIds,
    criticalRouteEdges,
    bottleneckLoads,
    bottleneckWidthM: round(bottleneckWidthM),
    peakCongestionIndex: congestionIndex(capacity.operationalLoad),
    shortestExitPaths,
    phaseProfiles,
  };
};

const circulationDelta = (
  baseline: ReturnType<typeof circulationSnapshot>,
  candidate: ReturnType<typeof circulationSnapshot>,
  changeId: string,
) => {
  const baselinePaths = new Map(baseline.shortestExitPaths.map((path) => [path.occupiedObjectId, path.routeObjectIds]));
  const candidatePaths = new Map(
    candidate.shortestExitPaths.map((path) => [path.occupiedObjectId, path.routeObjectIds]),
  );
  const changedPathObjectIds = [...new Set([...baselinePaths.keys(), ...candidatePaths.keys()])]
    .filter(
      (objectId) =>
        stableStringify(baselinePaths.get(objectId) ?? null) !== stableStringify(candidatePaths.get(objectId) ?? null),
    )
    .sort();
  return {
    changeId,
    peakCongestionIndexDelta: round(candidate.peakCongestionIndex - baseline.peakCongestionIndex, 1),
    changedPathObjectIds,
    newlyDisconnectedOccupiedObjectIds: candidate.disconnectedOccupiedObjectIds.filter(
      (id) => !baseline.disconnectedOccupiedObjectIds.includes(id),
    ),
    resolvedDisconnectedOccupiedObjectIds: baseline.disconnectedOccupiedObjectIds.filter(
      (id) => !candidate.disconnectedOccupiedObjectIds.includes(id),
    ),
    blockedRouteObjectIds: candidate.blockedRouteObjectIds,
  };
};

const circulationEvidence = (
  basePlan: VenuePlan,
  candidatePlan: VenuePlan,
  candidateGraph: RouteGraph,
  capacity: ReturnType<typeof capacityEvidence>,
  changes: readonly PlanningChange[],
  brief: EventBrief | null,
  projectLocks: readonly ObjectLock[],
) => {
  const baseline = circulationSnapshot(basePlan, buildRouteGraph(basePlan.objects), capacitySnapshot(basePlan, brief));
  const candidate = circulationSnapshot(candidatePlan, candidateGraph, capacity);
  return {
    ...candidate,
    changeDeltas: changes.map((change) => {
      const isolatedPlan = materializeSpatialPlan(basePlan, [change], { projectLocks, allowLockConflicts: true });
      return circulationDelta(
        baseline,
        circulationSnapshot(isolatedPlan, buildRouteGraph(isolatedPlan.objects), capacitySnapshot(isolatedPlan, brief)),
        change.id,
      );
    }),
  };
};

const sightlineEvidence = (plan: VenuePlan) => {
  const focalPoints = plan.objects.flatMap((object) =>
    (object.sightline?.focalPoints ?? []).map((focal) => ({ ...focal, objectId: object.id })),
  );
  const focal = focalPoints.find((item) => item.priority === "primary") ?? focalPoints[0] ?? null;
  const samples = plan.objects.flatMap((object) =>
    (object.sightline?.samples ?? []).map((sample) => ({ ...sample, seatingObjectId: object.id })),
  );
  const obstructions = plan.objects.filter((object) => (object.sightline?.opacity ?? 0) > 0);
  if (!focal) {
    return {
      source: "canonical-geometry",
      focalPointId: null,
      sampledSeatIds: [],
      blockedSampleIds: [],
      coverageRatio: 0,
      maximumViewingDistanceM: 0,
      obstructionObjectIds: [],
      sectionSummaries: [],
      rays: [],
      evidenceFingerprint: fingerprint("sightlines", []),
    };
  }
  const rays = samples
    .map((sample) => {
      const viewingDistanceM = distance(sample.point, focal.point);
      const blockers = obstructions.filter(
        (object) =>
          object.id !== sample.seatingObjectId &&
          (object.sightline?.heightM ?? object.elevationM ?? 0) > Math.min(sample.eyeHeightM, focal.elevationM) &&
          segmentIntersectsFootprint(sample.point, focal.point, object.footprint),
      );
      const horizontalAngleDegrees = round(
        (Math.atan2(focal.point.y - sample.point.y, focal.point.x - sample.point.x) * 180) / Math.PI,
        1,
      );
      const verticalAngleDegrees = round(
        (Math.atan2(focal.elevationM - sample.eyeHeightM, viewingDistanceM) * 180) / Math.PI,
        1,
      );
      return {
        id: `ray-${sample.id}-${focal.id}`,
        sampleId: sample.id,
        seatingObjectId: sample.seatingObjectId,
        focalPointId: focal.id,
        start: sample.point,
        end: focal.point,
        eyeHeightM: sample.eyeHeightM,
        viewingDistanceM: round(viewingDistanceM, 2),
        horizontalAngleDegrees,
        verticalAngleDegrees,
        status: blockers.length ? "blocked" : "clear",
        blockedByObjectIds: blockers.map((object) => object.id).sort(),
      };
    })
    .sort((a, b) => a.sampleId.localeCompare(b.sampleId));
  const blockedSampleIds = rays.filter((ray) => ray.status === "blocked").map((ray) => ray.sampleId);
  const sectionSummaries = plan.objects
    .filter((object) => object.kind === "seating_section")
    .map((object) => {
      const sectionRays = rays.filter((ray) => ray.seatingObjectId === object.id);
      const blockedSectionSampleIds = sectionRays.filter((ray) => ray.status === "blocked").map((ray) => ray.sampleId);
      return {
        objectId: object.id,
        sampledSeatIds: sectionRays.map((ray) => ray.sampleId),
        blockedSampleIds: blockedSectionSampleIds,
        blockedRatio: sectionRays.length ? round(blockedSectionSampleIds.length / sectionRays.length, 3) : 0,
        coverageRatio: sectionRays.length
          ? round((sectionRays.length - blockedSectionSampleIds.length) / sectionRays.length, 3)
          : 0,
      };
    })
    .sort((left, right) => left.objectId.localeCompare(right.objectId));
  const evidence = {
    source: "canonical-geometry",
    focalPointId: focal.id,
    focalObjectId: focal.objectId,
    sampledSeatIds: rays.map((ray) => ray.sampleId),
    blockedSampleIds,
    coverageRatio: rays.length ? round((rays.length - blockedSampleIds.length) / rays.length, 3) : 0,
    maximumViewingDistanceM: rays.length ? Math.max(...rays.map((ray) => ray.viewingDistanceM)) : 0,
    obstructionObjectIds: [...new Set(rays.flatMap((ray) => ray.blockedByObjectIds))].sort(),
    sectionSummaries,
    rays,
  };
  return { ...evidence, evidenceFingerprint: fingerprint("sightlines", evidence) };
};

export function analyzeSpatialPlan({
  plan,
  changes = [],
  brief = null,
  projectLocks = [],
}: {
  plan: VenuePlan;
  changes?: readonly PlanningChange[];
  brief?: EventBrief | null;
  projectLocks?: readonly ObjectLock[];
}) {
  const candidatePlan = materializeSpatialPlan(plan, changes, { projectLocks, allowLockConflicts: true });
  const sightlines = sightlineEvidence(candidatePlan);
  const accessibility = accessibilityEvidence(candidatePlan, sightlines);
  const capacity = capacityEvidence(plan, candidatePlan, changes, brief, projectLocks);
  const routeGraph = buildRouteGraph(candidatePlan.objects);
  const circulation = circulationEvidence(plan, candidatePlan, routeGraph, capacity, changes, brief, projectLocks);
  const metrics: Record<string, number | boolean> = {};
  if (accessibility.routeObjectIds.length > 0)
    metrics["accessibleRouteWidthFt"] = round(accessibility.minimumClearWidthM * FEET_PER_METRE, 2);
  if (capacity.sectionCapacities.length > 0) metrics["attendeeCapacity"] = capacity.effectiveCapacity;
  if (circulation.routeObjectIds.length > 0) metrics["peakCongestionIndex"] = circulation.peakCongestionIndex;
  if (sightlines.sampledSeatIds.length > 0) metrics["sightlineCoverage"] = sightlines.coverageRatio;
  return {
    candidatePlan,
    metrics,
    evidence: { accessibility, capacity, circulation, sightlines },
  };
}
