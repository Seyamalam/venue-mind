import { normalizePlanGeometry } from "./geometry.ts";
import { venueError } from "./errors.ts";
import { assertNoLockConflicts } from "./locks.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const round: any = (value: any, precision: any = 3) => Number(value.toFixed(precision));
const FEET_PER_METRE: any = 3.280839895;
const JOIN_TOLERANCE_M: any = 0.05;

const stableStringify: any = (value: any) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key: any) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

const fingerprint: any = (prefix: any, value: any) => {
  const input: any = stableStringify(value);
  let result: any = 0x811c9dc5;
  for (let index: any = 0; index < input.length; index += 1) {
    result ^= input.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return `${prefix}-${(result >>> 0).toString(16).padStart(8, "0")}`;
};

const distance: any = (left: any, right: any) => Math.hypot(left.x - right.x, left.y - right.y);
const pointKey: any = (point: any) => `${round(point.x)}:${round(point.y)}`;

const footprintCenter: any = (footprint: any) => {
  if (footprint.center) return footprint.center;
  if (footprint.kind === "line") return { x: (footprint.start.x + footprint.end.x) / 2, y: (footprint.start.y + footprint.end.y) / 2 };
  if (footprint.kind === "polygon") return {
    x: footprint.points.reduce((sum: any, point: any) => sum + point.x, 0) / footprint.points.length,
    y: footprint.points.reduce((sum: any, point: any) => sum + point.y, 0) / footprint.points.length,
  };
  return { x: 0, y: 0 };
};

const pointInAxisAlignedRectangle: any = (point: any, footprint: any) => Math.abs(point.x - footprint.center.x) <= footprint.width / 2 + JOIN_TOLERANCE_M
  && Math.abs(point.y - footprint.center.y) <= footprint.depth / 2 + JOIN_TOLERANCE_M;

const pointTouchesFootprint: any = (point: any, footprint: any) => {
  if (footprint.kind === "rectangle" && footprint.rotationDegrees === 0) return pointInAxisAlignedRectangle(point, footprint);
  if (footprint.kind === "circle") return distance(point, footprint.center) <= footprint.radius + JOIN_TOLERANCE_M;
  if (footprint.kind === "line") {
    const length: any = distance(footprint.start, footprint.end);
    return Math.abs(distance(point, footprint.start) + distance(point, footprint.end) - length) <= JOIN_TOLERANCE_M + footprint.width / 2;
  }
  return distance(point, footprintCenter(footprint)) <= 1;
};

const rotatePoint: any = (point: any, center: any, clockwiseDegrees: any) => {
  const radians: any = (-clockwiseDegrees * Math.PI) / 180;
  const dx: any = point.x - center.x;
  const dy: any = point.y - center.y;
  return { x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians), y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians) };
};

const footprintPolygon: any = (footprint: any) => {
  if (footprint.kind === "rectangle") {
    const halfWidth: any = footprint.width / 2;
    const halfDepth: any = footprint.depth / 2;
    return [
      { x: footprint.center.x - halfWidth, y: footprint.center.y - halfDepth },
      { x: footprint.center.x + halfWidth, y: footprint.center.y - halfDepth },
      { x: footprint.center.x + halfWidth, y: footprint.center.y + halfDepth },
      { x: footprint.center.x - halfWidth, y: footprint.center.y + halfDepth },
    ].map((point: any) => rotatePoint(point, footprint.center, footprint.rotationDegrees));
  }
  if (footprint.kind === "line") {
    const dx: any = footprint.end.x - footprint.start.x;
    const dy: any = footprint.end.y - footprint.start.y;
    const length: any = Math.hypot(dx, dy);
    if (length === 0) return [];
    const offsetX: any = (-dy / length) * footprint.width / 2;
    const offsetY: any = (dx / length) * footprint.width / 2;
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

const orientation: any = (a: any, b: any, c: any) => {
  const value: any = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
};

const segmentsIntersect: any = (a: any, b: any, c: any, d: any) => orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b);

const pointInPolygon: any = (point: any, polygon: any) => {
  let inside: any = false;
  for (let current: any = 0, previous: any = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const a: any = polygon[current];
    const b: any = polygon[previous];
    if (((a.y > point.y) !== (b.y > point.y)) && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
};

const polygonIntersectsFootprint: any = (polygon: any, footprint: any) => {
  if (footprint.kind === "circle") {
    if (pointInPolygon(footprint.center, polygon)) return true;
    return polygon.some((point: any, index: any) => distancePointToSegment(footprint.center, point, polygon[(index + 1) % polygon.length]) <= footprint.radius);
  }
  const other: any = footprintPolygon(footprint);
  if (!other.length) return false;
  return polygon.some((point: any, index: any) => other.some((otherPoint: any, otherIndex: any) => segmentsIntersect(point, polygon[(index + 1) % polygon.length], otherPoint, other[(otherIndex + 1) % other.length])))
    || pointInPolygon(polygon[0], other)
    || pointInPolygon(other[0], polygon);
};

export const footprintsIntersect = (left: any, right: any) => {
  if (left.kind === "circle" && right.kind === "circle") return distance(left.center, right.center) <= left.radius + right.radius;
  if (left.kind === "circle") return polygonIntersectsFootprint(footprintPolygon(right), left);
  return polygonIntersectsFootprint(footprintPolygon(left), right);
};

const distancePointToSegment: any = (point: any, start: any, end: any) => {
  const lengthSquared: any = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) return distance(point, start);
  const projection: any = Math.max(0, Math.min(1, ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared));
  return distance(point, { x: start.x + projection * (end.x - start.x), y: start.y + projection * (end.y - start.y) });
};

const segmentIntersectsFootprint: any = (start: any, end: any, footprint: any) => {
  if (footprint.kind === "circle") return distancePointToSegment(footprint.center, start, end) <= footprint.radius;
  const polygon: any = footprintPolygon(footprint);
  return polygon.some((point: any, index: any) => segmentsIntersect(start, end, point, polygon[(index + 1) % polygon.length]));
};

export function materializeSpatialPlan(plan: any, changes: any = [], { projectLocks = [], allowLockConflicts = false }: any = {}) {
  if (!allowLockConflicts) assertNoLockConflicts(plan, changes, projectLocks);
  const objects: any = clone(plan.objects);
  let spatial: any = clone(plan.spatial);
  const byId: any = new Map(objects.map((object: any) => [object.id, object]));
  for (const change of changes) {
    for (const effect of change.spatialEffects ?? []) {
      if (effect.operation === "update_room_boundary") {
        spatial = { ...spatial, roomBoundary: clone(effect.roomBoundary) };
        continue;
      }
      if (effect.operation === "add_object") {
        if (!effect.object?.id || byId.has(effect.object.id)) throw venueError("SPATIAL_CHANGE_TARGET_EXISTS", { objectId: effect.object?.id ?? null, changeId: change.id });
        const added: any = clone(effect.object);
        objects.push(added);
        byId.set(added.id, added);
        continue;
      }
      const object: any = byId.get(effect.objectId);
      if (!object) throw venueError("SPATIAL_CHANGE_TARGET_MISSING", { objectId: effect.objectId, changeId: change.id }, `Spatial Change targets missing object: ${effect.objectId}`);
      if (effect.operation === "update_footprint") object.footprint = { ...object.footprint, ...clone(effect.footprint) };
      else if (effect.operation === "update_metadata") Object.assign(object, clone(effect.values));
      else if (effect.operation === "delete_object") {
        objects.splice(objects.findIndex((item: any) => item.id === effect.objectId), 1);
        byId.delete(effect.objectId);
      }
      else throw venueError("SPATIAL_CHANGE_UNSUPPORTED", { operation: effect.operation, objectId: effect.objectId, changeId: change.id }, `Unsupported spatial Change operation: ${effect.operation}`);
    }
  }
  return normalizePlanGeometry({ ...plan, spatial, objects }, plan);
}

const buildRouteGraph: any = (objects: any) => {
  const routeObjects: any = objects.filter((object: any) => ["accessible_route", "aisle", "corridor", "service_lane"].includes(object.kind) && object.footprint.kind === "line" && object.route?.staffOnly !== true);
  const blockers: any = objects.filter((object: any) => object.circulation?.blocksPath === true);
  const nodes: any = new Map();
  const edges: any[] = [];
  const nodeFor: any = (point: any) => {
    const existing: any = [...nodes.values()].find((node: any) => distance(node.point, point) <= JOIN_TOLERANCE_M);
    if (existing) return existing;
    const node: any = { id: `node-${pointKey(point)}`, point: { x: round(point.x), y: round(point.y) }, edgeIds: [] };
    nodes.set(node.id, node);
    return node;
  };
  for (const object of routeObjects) {
    const start: any = nodeFor(object.footprint.start);
    const end: any = nodeFor(object.footprint.end);
    const edge: any = {
      id: `edge-${object.id}`,
      objectId: object.id,
      startNodeId: start.id,
      endNodeId: end.id,
      widthM: object.footprint.width,
      lengthM: round(distance(object.footprint.start, object.footprint.end)),
      blockedByObjectIds: blockers.filter((blocker: any) => blocker.id !== object.id && segmentIntersectsFootprint(object.footprint.start, object.footprint.end, blocker.footprint)).map((blocker: any) => blocker.id).sort(),
    };
    edges.push(edge);
    start.edgeIds.push(edge.id);
    end.edgeIds.push(edge.id);
  }
  const sortedNodes: any = [...nodes.values()].map((node: any) => ({ ...node, edgeIds: node.edgeIds.sort() })).sort((a: any, b: any) => a.id.localeCompare(b.id));
  const sortedEdges: any = edges.sort((a: any, b: any) => a.id.localeCompare(b.id));
  return { nodes: sortedNodes, edges: sortedEdges, routeObjects };
};

const ringArea: any = (points: any) => Math.abs(points.reduce((sum: any, point: any, index: any) => {
  const next: any = points[(index + 1) % points.length];
  return sum + point.x * next.y - next.x * point.y;
}, 0) / 2);

const footprintArea: any = (footprint: any) => {
  if (footprint.kind === "rectangle") return footprint.width * footprint.depth;
  if (footprint.kind === "circle") return Math.PI * footprint.radius ** 2;
  if (footprint.kind === "line") return distance(footprint.start, footprint.end) * footprint.width;
  if (footprint.kind === "polygon") return ringArea(footprint.points);
  return 0;
};

const reachableNodeIds: any = (graph: any, seedNodeIds: any) => {
  const edges: any = new Map(graph.edges.map((edge: any) => [edge.id, edge]));
  const nodes: any = new Map(graph.nodes.map((node: any) => [node.id, node]));
  const reached: any = new Set(seedNodeIds);
  const queue: any = [...seedNodeIds];
  while (queue.length) {
    const node: any = nodes.get(queue.shift());
    for (const edgeId of node?.edgeIds ?? []) {
      const edge: any = edges.get(edgeId);
      if (edge.blockedByObjectIds.length > 0) continue;
      const next: any = edge.startNodeId === node.id ? edge.endNodeId : edge.startNodeId;
      if (!reached.has(next)) {
        reached.add(next);
        queue.push(next);
      }
    }
  }
  return reached;
};

const doorClearancePolygon: any = (door: any, side: any) => {
  const { start, end } = door.footprint;
  const length: any = distance(start, end);
  const tangent: any = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const normal: any = side === "left" ? { x: -tangent.y, y: tangent.x } : { x: tangent.y, y: -tangent.x };
  const latch: any = door.door.clearance.latchSideM;
  const depth: any = door.door.clearance.depthM;
  const first: any = { x: round(start.x - tangent.x * latch), y: round(start.y - tangent.y * latch) };
  const second: any = { x: round(end.x + tangent.x * latch), y: round(end.y + tangent.y * latch) };
  return [first, second, { x: round(second.x + normal.x * depth), y: round(second.y + normal.y * depth) }, { x: round(first.x + normal.x * depth), y: round(first.y + normal.y * depth) }];
};

const exitApproachPolygon: any = (exit: any, roomBoundary: any, depthM: any) => {
  const { start, end } = exit.footprint;
  const length: any = distance(start, end);
  const tangent: any = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const normals: any = [{ x: -tangent.y, y: tangent.x }, { x: tangent.y, y: -tangent.x }];
  const roomCenter: any = {
    x: roomBoundary.outer.reduce((sum: any, point: any) => sum + point.x, 0) / roomBoundary.outer.length,
    y: roomBoundary.outer.reduce((sum: any, point: any) => sum + point.y, 0) / roomBoundary.outer.length,
  };
  const midpoint: any = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  const inward: any = normals.sort((left: any, right: any) => ((right.x * (roomCenter.x - midpoint.x)) + (right.y * (roomCenter.y - midpoint.y))) - ((left.x * (roomCenter.x - midpoint.x)) + (left.y * (roomCenter.y - midpoint.y))))[0];
  return [
    { x: round(start.x), y: round(start.y) },
    { x: round(end.x), y: round(end.y) },
    { x: round(end.x + inward.x * depthM), y: round(end.y + inward.y * depthM) },
    { x: round(start.x + inward.x * depthM), y: round(start.y + inward.y * depthM) },
  ];
};

const accessibilityEvidence: any = (plan: any, sightlines: any) => {
  const graph: any = buildRouteGraph(plan.objects);
  const entrances: any = plan.objects.filter((object: any) => object.kind === "accessible_entrance");
  const destinations: any = plan.objects.filter((object: any) => object.accessibility?.destination === true);
  const nodesTouching: any = (object: any) => {
    const nodeIds: any = new Set(graph.nodes.filter((node: any) => pointTouchesFootprint(node.point, object.footprint)).map((node: any) => node.id));
    for (const edge of graph.edges) {
      const route: any = graph.routeObjects.find((item: any) => item.id === edge.objectId);
      if (route && segmentIntersectsFootprint(route.footprint.start, route.footprint.end, object.footprint)) {
        nodeIds.add(edge.startNodeId);
        nodeIds.add(edge.endNodeId);
      }
    }
    return [...nodeIds];
  };
  const entranceNodeIds: any = entrances.flatMap(nodesTouching);
  const reachedNodes: any = reachableNodeIds(graph, entranceNodeIds);
  const reachableDestinationIds: any = destinations.filter((object: any) => nodesTouching(object).some((nodeId: any) => reachedNodes.has(nodeId))).map((object: any) => object.id).sort();
  const unreachableDestinationIds: any = destinations.map((object: any) => object.id).filter((id: any) => !reachableDestinationIds.includes(id)).sort();
  const junctions: any = graph.nodes.filter((node: any) => node.edgeIds.length >= 3);
  const edgeById: any = new Map(graph.edges.map((edge: any) => [edge.id, edge]));
  const turningClearanceM: any = junctions.length === 0 ? 0 : Math.min(...junctions.map((node: any) => Math.min(...node.edgeIds.map((id: any) => edgeById.get(id).widthM))));
  const minimumClearWidthM: any = graph.edges.length === 0 ? 0 : Math.min(...graph.edges.map((edge: any) => edge.widthM));
  const connected: any = entranceNodeIds.length > 0 && graph.nodes.length > 0 && graph.nodes.every((node: any) => reachedNodes.has(node.id)) && unreachableDestinationIds.length === 0;
  const policy: any = plan.accessibilityPolicy ?? {};
  const accessibleSeatingSections: any = plan.objects.filter((object: any) => object.kind === "seating_section" && object.accessibility?.accessibleSeats > 0).map((object: any) => ({
    objectId: object.id,
    accessibleSeats: object.accessibility.accessibleSeats,
    companionSeats: object.accessibility.companionSeats ?? 0,
  })).sort((a: any, b: any) => a.objectId.localeCompare(b.objectId));
  const accessibleSeats: any = accessibleSeatingSections.reduce((sum: any, section: any) => sum + section.accessibleSeats, 0);
  const companionSeats: any = accessibleSeatingSections.reduce((sum: any, section: any) => sum + section.companionSeats, 0);
  const accessibleSeatSightlineSections: any = accessibleSeatingSections.map((section: any) => {
    const object: any = plan.objects.find((item: any) => item.id === section.objectId);
    const sampleIds: any = [...new Set(object.accessibility?.accessibleSeatSampleIds ?? [])].sort();
    const rays: any = sightlines.rays.filter((ray: any) => sampleIds.includes(ray.sampleId));
    const blockedSampleIds: any = rays.filter((ray: any) => ray.status === "blocked").map((ray: any) => ray.sampleId);
    return {
      objectId: section.objectId,
      sampleIds,
      blockedSampleIds,
      coverageRatio: rays.length ? round((rays.length - blockedSampleIds.length) / rays.length, 3) : 0,
      evidenceRayIds: rays.map((ray: any) => ray.id),
    };
  });
  const accessibleSeatSampleIds: any = accessibleSeatSightlineSections.flatMap((section: any) => section.sampleIds).sort();
  const blockedAccessibleSeatSampleIds: any = accessibleSeatSightlineSections.flatMap((section: any) => section.blockedSampleIds).sort();
  const missingAccessibleSeatSampleSectionIds: any = accessibleSeatSightlineSections.filter((section: any) => section.sampleIds.length === 0).map((section: any) => section.objectId);
  const accessibleSeatSightlineCoverageRatio: any = accessibleSeatSampleIds.length ? round((accessibleSeatSampleIds.length - blockedAccessibleSeatSampleIds.length) / accessibleSeatSampleIds.length, 3) : 0;
  const accessibleDoors: any = plan.objects.filter((object: any) => object.kind === "door" && object.door?.accessible);
  const clearanceExemptKinds: any = new Set(["door", "fire_exit", "accessible_entrance", "accessible_route", "corridor", "aisle", "service_lane", "temporary_ramp"]);
  const doorClearanceZones: any = accessibleDoors.flatMap((door: any) => {
    if (!door.door.clearance) return [{ id: `door-clearance-${door.id}-missing`, doorObjectId: door.id, side: null, points: [], obstructingObjectIds: [], status: "missing" }];
    const sides: any = door.door.clearance.side === "both" ? ["left", "right"] : [door.door.clearance.side];
    return sides.map((side: any) => {
      const points: any = doorClearancePolygon(door, side);
      const obstructingObjectIds: any = plan.objects.filter((object: any) => object.id !== door.id && !clearanceExemptKinds.has(object.kind) && object.accessibility?.clearanceExempt !== true && polygonIntersectsFootprint(points, object.footprint)).map((object: any) => object.id).sort();
      return { id: `door-clearance-${door.id}-${side}`, doorObjectId: door.id, side, points, depthM: door.door.clearance.depthM, latchSideM: door.door.clearance.latchSideM, obstructingObjectIds, status: obstructingObjectIds.length ? "blocked" : "clear" };
    });
  }).sort((left: any, right: any) => left.id.localeCompare(right.id));
  const minimumDoorClearWidthM: any = accessibleDoors.length ? Math.min(...accessibleDoors.map((door: any) => door.door.clearWidthM)) : 0;
  const obstructedDoorObjectIds: any = [...new Set(doorClearanceZones.filter((zone: any) => zone.status !== "clear").map((zone: any) => zone.doorObjectId))].sort();
  const ramps: any = plan.objects.filter((object: any) => object.kind === "temporary_ramp").map((object: any) => {
    const slopeRatio: any = round(object.ramp.runM / object.ramp.riseM, 2);
    const failures: any = [
      ...(slopeRatio < (policy.minimumRampSlopeRatio ?? 12) ? ["slope"] : []),
      ...(object.ramp.clearWidthM < (policy.minimumRampClearWidthM ?? 0.915) ? ["width"] : []),
      ...(object.ramp.landingLengthM < (policy.minimumRampLandingLengthM ?? 1.525) ? ["landing"] : []),
      ...(object.ramp.edgeProtectionHeightM < (policy.minimumRampEdgeProtectionHeightM ?? 0.1) ? ["edge-protection"] : []),
      ...((policy.requireRampHandrails ?? true) && !object.ramp.handrails ? ["handrails"] : []),
    ];
    return { objectId: object.id, slopeRatio, riseM: object.ramp.riseM, runM: object.ramp.runM, clearWidthM: object.ramp.clearWidthM, landingLengthM: object.ramp.landingLengthM, edgeProtectionHeightM: object.ramp.edgeProtectionHeightM, handrails: object.ramp.handrails, failures, status: failures.length ? "fail" : "pass" };
  }).sort((left: any, right: any) => left.objectId.localeCompare(right.objectId));
  return {
    source: "canonical-geometry",
    graphFingerprint: fingerprint("graph", { nodes: graph.nodes, edges: graph.edges }),
    connected,
    entranceObjectIds: entrances.map((object: any) => object.id).sort(),
    routeObjectIds: graph.routeObjects.map((object: any) => object.id).sort(),
    reachableDestinationIds,
    unreachableDestinationIds,
    minimumClearWidthM: round(minimumClearWidthM),
    turningClearanceM: round(turningClearanceM),
    minimumTurningClearanceM: policy.minimumTurningClearanceM ?? 1.5,
    accessibleSeatingSections,
    accessibleSeats,
    companionSeats,
    minimumAccessibleSeats: policy.minimumAccessibleSeats ?? 0,
    seatingDistributed: accessibleSeatingSections.length >= (policy.minimumAccessibleSeatingSections ?? 1),
    companionAdjacencySatisfied: accessibleSeatingSections.every((section: any) => section.companionSeats >= section.accessibleSeats),
    accessibleSeatSampleIds,
    blockedAccessibleSeatSampleIds,
    accessibleSeatSightlineCoverageRatio,
    accessibleSeatSightlineSections,
    missingAccessibleSeatSampleSectionIds,
    doorClearanceZones,
    accessibleDoorObjectIds: accessibleDoors.map((door: any) => door.id).sort(),
    minimumDoorClearWidthM: round(minimumDoorClearWidthM),
    obstructedDoorObjectIds,
    ramps,
    rampPolicy: {
      minimumSlopeRatio: policy.minimumRampSlopeRatio ?? 12,
      minimumClearWidthM: policy.minimumRampClearWidthM ?? 0.915,
      minimumLandingLengthM: policy.minimumRampLandingLengthM ?? 1.525,
      minimumEdgeProtectionHeightM: policy.minimumRampEdgeProtectionHeightM ?? 0.1,
      requireHandrails: policy.requireRampHandrails ?? true,
    },
    policy: {
      jurisdiction: policy.jurisdiction ?? "venue-policy",
      source: policy.source ?? "Venue accessibility policy",
      effectiveDate: policy.effectiveDate ?? null,
    },
    nodes: graph.nodes,
    edges: graph.edges,
  };
};

const DENSITY_M2_PER_ATTENDEE: any = { theater: 0.8, classroom: 1.8, banquet: 1.4, standing: 0.5, mixed: 1, custom: 1 };

const capacityBand: any = (capacity: any, minimumCapacity: any, maximumCapacity: any) => {
  if (Number.isFinite(minimumCapacity) && capacity < minimumCapacity) return "under-target";
  if (Number.isFinite(maximumCapacity) && capacity > maximumCapacity) return "over-capacity";
  return "within-limit";
};

const assertCapacityRange: any = (scopeKind: any, scopeId: any, minimumCapacity: any, maximumCapacity: any) => {
  if (!Number.isInteger(minimumCapacity) || minimumCapacity < 0 || !Number.isInteger(maximumCapacity) || maximumCapacity < minimumCapacity) {
    throw venueError("CONSTRAINT_EVIDENCE_INVALID", { scopeKind, scopeId, minimumCapacity, maximumCapacity }, `Invalid capacity range for ${scopeKind} ${scopeId}`);
  }
};

const capacitySnapshot: any = (plan: any, brief: any) => {
  const roomAreaM2: any = ringArea(plan.spatial.roomBoundary.outer) - plan.spatial.roomBoundary.holes.reduce((sum: any, hole: any) => sum + ringArea(hole), 0);
  const excludedObjects: any = plan.objects.filter((object: any) => object.occupancy?.excludesUsableArea === true);
  const excludedAreaM2: any = excludedObjects.reduce((sum: any, object: any) => sum + footprintArea(object.footprint), 0);
  const usableRoomAreaM2: any = roomAreaM2 - excludedAreaM2;
  const seating: any = plan.objects.filter((object: any) => object.kind === "seating_section" && Number.isInteger(object.capacity) && object.capacity >= 0);
  const seatingIds: any = new Set(seating.map((object: any) => object.id));
  const zoneIds: any = new Set();
  for (const zone of plan.occupancy?.zones ?? []) {
    if (!zone.id || zoneIds.has(zone.id) || !Array.isArray(zone.sectionObjectIds) || zone.sectionObjectIds.some((objectId: any) => !seatingIds.has(objectId))) {
      throw venueError("CONSTRAINT_EVIDENCE_INVALID", { scopeKind: "zone", scopeId: zone.id ?? null }, `Invalid Occupancy Zone: ${zone.id ?? "missing-id"}`);
    }
    zoneIds.add(zone.id);
    assertCapacityRange("zone", zone.id, zone.minimumCapacity ?? 0, zone.maximumCapacity ?? Number.MAX_SAFE_INTEGER);
  }
  const sectionPolicyIds: any = new Set();
  for (const section of plan.occupancy?.sections ?? []) {
    if (!section.objectId || sectionPolicyIds.has(section.objectId) || !seatingIds.has(section.objectId) || (section.zoneId != null && !zoneIds.has(section.zoneId))) {
      throw venueError("CONSTRAINT_EVIDENCE_INVALID", { scopeKind: "section", scopeId: section.objectId ?? null }, `Invalid Seating Section capacity policy: ${section.objectId ?? "missing-id"}`);
    }
    sectionPolicyIds.add(section.objectId);
    assertCapacityRange("section", section.objectId, section.minimumCapacity ?? 0, section.maximumCapacity ?? Number.MAX_SAFE_INTEGER);
  }
  const sectionPolicies: any = new Map((plan.occupancy?.sections ?? []).map((section: any) => [section.objectId, section]));
  const sectionCapacities: any = seating.map((object: any) => {
    const sectionPolicy: any = sectionPolicies.get(object.id) ?? object.occupancy ?? {};
    const minimumCapacity: any = sectionPolicy.minimumCapacity ?? 0;
    const maximumCapacity: any = sectionPolicy.maximumCapacity ?? Number.MAX_SAFE_INTEGER;
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
  }).sort((a: any, b: any) => a.objectId.localeCompare(b.objectId));
  const placedCapacity: any = sectionCapacities.reduce((sum: any, section: any) => sum + section.capacity, 0);
  const sectionsById: any = new Map(sectionCapacities.map((section: any) => [section.objectId, section]));
  const zoneCapacities: any = (plan.occupancy?.zones ?? []).map((zone: any) => {
    const sectionObjectIds: any = [...zone.sectionObjectIds].sort();
    const capacity: any = sectionObjectIds.reduce((sum: any, objectId: any) => sum + (sectionsById.get(objectId)?.capacity ?? 0), 0);
    const minimumCapacity: any = zone.minimumCapacity ?? 0;
    const maximumCapacity: any = zone.maximumCapacity ?? Number.MAX_SAFE_INTEGER;
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
  }).sort((a: any, b: any) => a.zoneId.localeCompare(b.zoneId));
  const densityM2PerAttendee: any = plan.occupancy?.densityM2PerAttendee ?? DENSITY_M2_PER_ATTENDEE[brief?.occupancyMode ?? "custom"];
  const densityCapacity: any = Math.floor(usableRoomAreaM2 / densityM2PerAttendee);
  const venueMaximum: any = plan.occupancy?.venueMaximum ?? Number.MAX_SAFE_INTEGER;
  const operationalCounts: any = {
    staff: plan.occupancy?.staff ?? 0,
    performers: plan.occupancy?.performers ?? 0,
    vendors: plan.occupancy?.vendors ?? 0,
  };
  const nonAttendeeLoad: any = Object.values(operationalCounts).reduce((sum: any, count: any) => sum + count, 0);
  const attendeeTarget: any = brief?.attendeeTarget ?? plan.event.attendeeTarget ?? 0;
  const operationalLoad: any = attendeeTarget + nonAttendeeLoad;
  const attendeeVenueLimit: any = Math.max(0, venueMaximum - nonAttendeeLoad);
  const effectiveCapacity: any = Math.min(placedCapacity, densityCapacity, attendeeVenueLimit);
  const explanations: any = [
    ...sectionCapacities.filter((section: any) => section.status !== "within-limit").map((section: any) => ({
      code: section.status === "under-target" ? "SECTION_UNDER_TARGET" : "SECTION_OVER_CAPACITY",
      scopeKind: "section",
      scopeId: section.objectId,
      actual: section.capacity,
      target: section.status === "under-target" ? section.minimumCapacity : section.maximumCapacity,
      delta: section.status === "under-target" ? section.capacity - section.minimumCapacity : section.capacity - section.maximumCapacity,
    })),
    ...zoneCapacities.filter((zone: any) => zone.status !== "within-limit").map((zone: any) => ({
      code: zone.status === "under-target" ? "ZONE_UNDER_TARGET" : "ZONE_OVER_CAPACITY",
      scopeKind: "zone",
      scopeId: zone.zoneId,
      actual: zone.capacity,
      target: zone.status === "under-target" ? zone.minimumCapacity : zone.maximumCapacity,
      delta: zone.status === "under-target" ? zone.capacity - zone.minimumCapacity : zone.capacity - zone.maximumCapacity,
    })),
    ...(effectiveCapacity < attendeeTarget ? [{ code: "PLAN_UNDER_TARGET", scopeKind: "plan", scopeId: plan.id, actual: effectiveCapacity, target: attendeeTarget, delta: effectiveCapacity - attendeeTarget }] : []),
    ...(operationalLoad > venueMaximum ? [{ code: "VENUE_OVER_CAPACITY", scopeKind: "venue", scopeId: plan.venue.id, actual: operationalLoad, target: venueMaximum, delta: operationalLoad - venueMaximum }] : []),
    ...(placedCapacity > densityCapacity ? [{ code: "DENSITY_OVER_CAPACITY", scopeKind: "plan", scopeId: plan.id, actual: placedCapacity, target: densityCapacity, delta: placedCapacity - densityCapacity }] : []),
  ];
  return {
    source: "canonical-geometry",
    roomAreaM2: round(roomAreaM2),
    excludedAreaM2: round(excludedAreaM2),
    excludedObjectIds: excludedObjects.map((object: any) => object.id).sort(),
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

const capacityDelta: any = (baseline: any, candidate: any, changeId: any) => ({
  changeId,
  placedCapacityDelta: candidate.placedCapacity - baseline.placedCapacity,
  effectiveCapacityDelta: candidate.effectiveCapacity - baseline.effectiveCapacity,
  operationalLoadDelta: candidate.operationalLoad - baseline.operationalLoad,
  sectionDeltas: candidate.sectionCapacities.map((section: any) => {
    const before: any = baseline.sectionCapacities.find((item: any) => item.objectId === section.objectId)?.capacity ?? 0;
    return { objectId: section.objectId, before, after: section.capacity, delta: section.capacity - before };
  }).filter((item: any) => item.delta !== 0),
  zoneDeltas: candidate.zoneCapacities.map((zone: any) => {
    const before: any = baseline.zoneCapacities.find((item: any) => item.zoneId === zone.zoneId)?.capacity ?? 0;
    return { zoneId: zone.zoneId, before, after: zone.capacity, delta: zone.capacity - before };
  }).filter((item: any) => item.delta !== 0),
});

const capacityEvidence: any = (basePlan: any, candidatePlan: any, changes: any, brief: any, projectLocks: any) => {
  const baseline: any = capacitySnapshot(basePlan, brief);
  const candidate: any = capacitySnapshot(candidatePlan, brief);
  return {
    ...candidate,
    changeDeltas: changes.map((change: any) => capacityDelta(
      baseline,
      capacitySnapshot(materializeSpatialPlan(basePlan, [change], { projectLocks, allowLockConflicts: true }), brief),
      change.id,
    )),
  };
};

const shortestPath: any = (graph: any, sourceNodeIds: any, targetNodeIds: any, excludedEdgeIds: any = new Set()) => {
  const targetSet: any = new Set(targetNodeIds);
  const nodes: any = new Map(graph.nodes.map((node: any) => [node.id, node]));
  const edges: any = new Map(graph.edges.map((edge: any) => [edge.id, edge]));
  const distances: any = new Map(graph.nodes.map((node: any) => [node.id, Number.POSITIVE_INFINITY]));
  const previous: any = new Map();
  const queue: any = new Set(graph.nodes.map((node: any) => node.id));
  for (const nodeId of sourceNodeIds) distances.set(nodeId, 0);
  while (queue.size) {
    const currentId: any = [...queue].sort((left: any, right: any) => distances.get(left) - distances.get(right) || left.localeCompare(right))[0];
    queue.delete(currentId);
    if (!Number.isFinite(distances.get(currentId))) break;
    if (targetSet.has(currentId)) {
      const routeObjectIds: any[] = [];
      let cursor: any = currentId;
      while (previous.has(cursor)) {
        const step: any = previous.get(cursor);
        routeObjectIds.push(edges.get(step.edgeId).objectId);
        cursor = step.nodeId;
      }
      return { targetNodeId: currentId, distanceM: round(distances.get(currentId)), routeObjectIds: routeObjectIds.sort() };
    }
    const node: any = nodes.get(currentId);
    for (const edgeId of node.edgeIds) {
      const edge: any = edges.get(edgeId);
      if (excludedEdgeIds.has(edgeId) || edge.blockedByObjectIds.length > 0) continue;
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

const circulationSnapshot: any = (plan: any, graph: any, capacity: any) => {
  const occupiedObjects: any = plan.objects.filter((object: any) => object.kind === "seating_section" && object.capacity > 0);
  const exits: any = plan.objects.filter((object: any) => object.kind === "fire_exit");
  const nodesTouching: any = (object: any) => graph.nodes.filter((node: any) => pointTouchesFootprint(node.point, object.footprint)).map((node: any) => node.id);
  const exitNodeEntries: any = exits.flatMap((exit: any) => nodesTouching(exit).map((nodeId: any) => [nodeId, exit.id]));
  const exitNodes: any = exitNodeEntries.map(([nodeId]: any) => nodeId);
  const exitByNodeId: any = new Map(exitNodeEntries);
  const shortestExitPaths: any[] = [];
  const disconnectedOccupiedObjectIds: any[] = [];
  for (const occupied of occupiedObjects) {
    const path: any = shortestPath(graph, nodesTouching(occupied), exitNodes);
    if (!path) disconnectedOccupiedObjectIds.push(occupied.id);
    else shortestExitPaths.push({ occupiedObjectId: occupied.id, exitObjectId: exitByNodeId.get(path.targetNodeId) ?? null, distanceM: path.distanceM, routeObjectIds: path.routeObjectIds });
  }
  shortestExitPaths.sort((a: any, b: any) => a.occupiedObjectId.localeCompare(b.occupiedObjectId));
  const exitApproachDepthM: any = plan.circulationPolicy?.exitApproachDepthM ?? 1.2;
  const approachBlockers: any = plan.objects.filter((object: any) => !["fire_exit", "door", "accessible_route", "aisle", "corridor", "service_lane"].includes(object.kind) && object.circulation?.blocksExitApproach !== false);
  const exitApproachZones: any = exits.map((exit: any) => {
    const points: any = exitApproachPolygon(exit, plan.spatial.roomBoundary, exitApproachDepthM);
    const obstructingObjectIds: any = approachBlockers.filter((object: any) => polygonIntersectsFootprint(points, object.footprint)).map((object: any) => object.id).sort();
    return { id: `exit-approach-${exit.id}`, exitObjectId: exit.id, depthM: exitApproachDepthM, points, status: obstructingObjectIds.length ? "blocked" : "clear", obstructingObjectIds };
  }).sort((left: any, right: any) => left.id.localeCompare(right.id));
  const obstructedExitObjectIds: any = exitApproachZones.filter((zone: any) => zone.status === "blocked").map((zone: any) => zone.exitObjectId);
  const blockedEdges: any = graph.edges.filter((edge: any) => edge.blockedByObjectIds.length > 0);
  const traversableEdges: any = graph.edges.filter((edge: any) => edge.blockedByObjectIds.length === 0);
  const bottleneckWidthM: any = traversableEdges.length ? Math.min(...traversableEdges.map((edge: any) => edge.widthM)) : 0;
  const hardBlock: any = blockedEdges.length > 0 || disconnectedOccupiedObjectIds.length > 0 || obstructedExitObjectIds.length > 0;
  const congestionIndex: any = (demand: any) => hardBlock ? 1000 : bottleneckWidthM > 0 ? round(demand / (bottleneckWidthM * 3.6), 1) : 1000;
  const phaseProfiles: any = [
    { phase: "ingress", demand: Math.round(capacity.attendeeTarget * 0.75) },
    { phase: "interval", demand: Math.round(capacity.attendeeTarget * 0.35) },
    { phase: "egress", demand: capacity.operationalLoad },
    { phase: "emergency", demand: capacity.operationalLoad },
  ].map((profile: any) => ({ ...profile, congestionIndex: congestionIndex(profile.demand) }));
  const criticalRouteEdges: any = traversableEdges.map((edge: any) => {
    const impactedOccupiedObjectIds: any = occupiedObjects.filter((occupied: any) => {
      const baseline: any = shortestExitPaths.some((path: any) => path.occupiedObjectId === occupied.id);
      return baseline && !shortestPath(graph, nodesTouching(occupied), exitNodes, new Set([edge.id]));
    }).map((object: any) => object.id).sort();
    return { edgeId: edge.id, routeObjectId: edge.objectId, impactedOccupiedObjectIds };
  }).filter((edge: any) => edge.impactedOccupiedObjectIds.length > 0).sort((left: any, right: any) => left.edgeId.localeCompare(right.edgeId));
  const capacityByObjectId: any = new Map(capacity.sectionCapacities.map((section: any) => [section.objectId, section.capacity]));
  const routeLoads: any = traversableEdges.map((edge: any) => {
    const demand: any = shortestExitPaths.filter((path: any) => path.routeObjectIds.includes(edge.objectId)).reduce((sum: any, path: any) => sum + (capacityByObjectId.get(path.occupiedObjectId) ?? 0), 0);
    const ratedDemand: any = round(edge.widthM * 3.6, 1);
    return { id: `bottleneck-route-${edge.objectId}`, kind: "route", objectId: edge.objectId, demand, ratedDemand, loadIndex: ratedDemand > 0 ? round(demand / ratedDemand, 1) : 1000 };
  });
  const assignedCapacityByExit: any = new Map(exits.map((exit: any) => [exit.id, shortestExitPaths
    .filter((path: any) => path.exitObjectId === exit.id)
    .reduce((sum: any, path: any) => sum + (capacityByObjectId.get(path.occupiedObjectId) ?? 0), 0)]));
  const assignedCapacityTotal: any = [...assignedCapacityByExit.values()].reduce((sum: any, value: any) => sum + value, 0);
  const exitLoads: any = exits.map((exit: any) => {
    const assignedCapacity: any = assignedCapacityByExit.get(exit.id) ?? 0;
    const demand: any = assignedCapacityTotal > 0 ? round(capacity.operationalLoad * assignedCapacity / assignedCapacityTotal, 1) : 0;
    return { id: `bottleneck-exit-${exit.id}`, kind: "exit", objectId: exit.id, demand, ratedDemand: exit.exit.capacityPersons, loadIndex: round((demand / exit.exit.capacityPersons) * 100, 1) };
  });
  const junctionLoads: any = graph.nodes.filter((node: any) => node.edgeIds.length >= 3).map((node: any) => {
    const demand: any = shortestExitPaths.filter((path: any) => path.routeObjectIds.some((objectId: any) => node.edgeIds.some((edgeId: any) => graph.edges.find((edge: any) => edge.id === edgeId)?.objectId === objectId))).reduce((sum: any, path: any) => sum + (capacityByObjectId.get(path.occupiedObjectId) ?? 0), 0);
    const widthM: any = Math.min(...node.edgeIds.map((edgeId: any) => graph.edges.find((edge: any) => edge.id === edgeId)?.widthM ?? Number.MAX_SAFE_INTEGER));
    const ratedDemand: any = round(widthM * 3.6, 1);
    return { id: `bottleneck-junction-${node.id}`, kind: "aisle-intersection", nodeId: node.id, demand, ratedDemand, loadIndex: ratedDemand > 0 ? round(demand / ratedDemand, 1) : 1000 };
  });
  const controlLoads: any = plan.objects.filter((object: any) => ["queue", "checkpoint"].includes(object.circulation?.role)).map((object: any) => {
    const demand: any = object.circulation.demandPersons ?? capacity.operationalLoad;
    const ratedDemand: any = object.circulation.capacityPersons ?? 0;
    return { id: `bottleneck-${object.circulation.role}-${object.id}`, kind: object.circulation.role, objectId: object.id, demand, ratedDemand, loadIndex: ratedDemand > 0 ? round((demand / ratedDemand) * 100, 1) : 1000 };
  });
  const bottleneckLoads: any = [...routeLoads, ...exitLoads, ...junctionLoads, ...controlLoads].sort((left: any, right: any) => right.loadIndex - left.loadIndex || left.id.localeCompare(right.id));
  return {
    source: "canonical-geometry",
    graphFingerprint: fingerprint("graph", { nodes: graph.nodes, edges: graph.edges }),
    connected: graph.edges.length > 0 && disconnectedOccupiedObjectIds.length === 0 && exits.length > 0 && blockedEdges.length === 0 && obstructedExitObjectIds.length === 0,
    routeObjectIds: graph.routeObjects.map((object: any) => object.id).sort(),
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
    exitObjectIds: exits.map((object: any) => object.id).sort(),
    occupiedObjectIds: occupiedObjects.map((object: any) => object.id).sort(),
    disconnectedOccupiedObjectIds: disconnectedOccupiedObjectIds.sort(),
    blockedRouteObjectIds: blockedEdges.map((edge: any) => edge.objectId).sort(),
    blockingObjectIds: [...new Set(blockedEdges.flatMap((edge: any) => edge.blockedByObjectIds))].sort(),
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

const circulationDelta: any = (baseline: any, candidate: any, changeId: any) => {
  const baselinePaths: any = new Map(baseline.shortestExitPaths.map((path: any) => [path.occupiedObjectId, path.routeObjectIds]));
  const candidatePaths: any = new Map(candidate.shortestExitPaths.map((path: any) => [path.occupiedObjectId, path.routeObjectIds]));
  const changedPathObjectIds: any = [...new Set([...baselinePaths.keys(), ...candidatePaths.keys()])].filter((objectId: any) => stableStringify(baselinePaths.get(objectId) ?? null) !== stableStringify(candidatePaths.get(objectId) ?? null)).sort();
  return {
    changeId,
    peakCongestionIndexDelta: round(candidate.peakCongestionIndex - baseline.peakCongestionIndex, 1),
    changedPathObjectIds,
    newlyDisconnectedOccupiedObjectIds: candidate.disconnectedOccupiedObjectIds.filter((id: any) => !baseline.disconnectedOccupiedObjectIds.includes(id)),
    resolvedDisconnectedOccupiedObjectIds: baseline.disconnectedOccupiedObjectIds.filter((id: any) => !candidate.disconnectedOccupiedObjectIds.includes(id)),
    blockedRouteObjectIds: candidate.blockedRouteObjectIds,
  };
};

const circulationEvidence: any = (basePlan: any, candidatePlan: any, candidateGraph: any, capacity: any, changes: any, brief: any, projectLocks: any) => {
  const baseline: any = circulationSnapshot(basePlan, buildRouteGraph(basePlan.objects), capacitySnapshot(basePlan, brief));
  const candidate: any = circulationSnapshot(candidatePlan, candidateGraph, capacity);
  return {
    ...candidate,
    changeDeltas: changes.map((change: any) => {
      const isolatedPlan: any = materializeSpatialPlan(basePlan, [change], { projectLocks, allowLockConflicts: true });
      return circulationDelta(baseline, circulationSnapshot(isolatedPlan, buildRouteGraph(isolatedPlan.objects), capacitySnapshot(isolatedPlan, brief)), change.id);
    }),
  };
};

const sightlineEvidence: any = (plan: any) => {
  const focalPoints: any = plan.objects.flatMap((object: any) => (object.sightline?.focalPoints ?? []).map((focal: any) => ({ ...focal, objectId: object.id })));
  const focal: any = focalPoints.find((item: any) => item.priority === "primary") ?? focalPoints[0] ?? null;
  const samples: any = plan.objects.flatMap((object: any) => (object.sightline?.samples ?? []).map((sample: any) => ({ ...sample, seatingObjectId: object.id })));
  const obstructions: any = plan.objects.filter((object: any) => (object.sightline?.opacity ?? 0) > 0);
  if (!focal) {
    return { source: "canonical-geometry", focalPointId: null, sampledSeatIds: [], blockedSampleIds: [], coverageRatio: 0, maximumViewingDistanceM: 0, obstructionObjectIds: [], sectionSummaries: [], rays: [], evidenceFingerprint: fingerprint("sightlines", []) };
  }
  const rays: any = samples.map((sample: any) => {
    const viewingDistanceM: any = distance(sample.point, focal.point);
    const blockers: any = obstructions.filter((object: any) => object.id !== sample.seatingObjectId
      && (object.sightline.heightM ?? object.elevationM) > Math.min(sample.eyeHeightM, focal.elevationM)
      && segmentIntersectsFootprint(sample.point, focal.point, object.footprint));
    const horizontalAngleDegrees: any = round((Math.atan2(focal.point.y - sample.point.y, focal.point.x - sample.point.x) * 180) / Math.PI, 1);
    const verticalAngleDegrees: any = round((Math.atan2(focal.elevationM - sample.eyeHeightM, viewingDistanceM) * 180) / Math.PI, 1);
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
      blockedByObjectIds: blockers.map((object: any) => object.id).sort(),
    };
  }).sort((a: any, b: any) => a.sampleId.localeCompare(b.sampleId));
  const blockedSampleIds: any = rays.filter((ray: any) => ray.status === "blocked").map((ray: any) => ray.sampleId);
  const sectionSummaries: any = plan.objects.filter((object: any) => object.kind === "seating_section").map((object: any) => {
    const sectionRays: any = rays.filter((ray: any) => ray.seatingObjectId === object.id);
    const blockedSectionSampleIds: any = sectionRays.filter((ray: any) => ray.status === "blocked").map((ray: any) => ray.sampleId);
    return { objectId: object.id, sampledSeatIds: sectionRays.map((ray: any) => ray.sampleId), blockedSampleIds: blockedSectionSampleIds, blockedRatio: sectionRays.length ? round(blockedSectionSampleIds.length / sectionRays.length, 3) : 0, coverageRatio: sectionRays.length ? round((sectionRays.length - blockedSectionSampleIds.length) / sectionRays.length, 3) : 0 };
  }).sort((left: any, right: any) => left.objectId.localeCompare(right.objectId));
  const evidence: any = {
    source: "canonical-geometry",
    focalPointId: focal.id,
    focalObjectId: focal.objectId,
    sampledSeatIds: rays.map((ray: any) => ray.sampleId),
    blockedSampleIds,
    coverageRatio: rays.length ? round((rays.length - blockedSampleIds.length) / rays.length, 3) : 0,
    maximumViewingDistanceM: rays.length ? Math.max(...rays.map((ray: any) => ray.viewingDistanceM)) : 0,
    obstructionObjectIds: [...new Set(rays.flatMap((ray: any) => ray.blockedByObjectIds))].sort(),
    sectionSummaries,
    rays,
  };
  return { ...evidence, evidenceFingerprint: fingerprint("sightlines", evidence) };
};

export function analyzeSpatialPlan({ plan, changes = [], brief = null, projectLocks = [] }: any) {
  const candidatePlan: any = materializeSpatialPlan(plan, changes, { projectLocks, allowLockConflicts: true });
  const sightlines: any = sightlineEvidence(candidatePlan);
  const accessibility: any = accessibilityEvidence(candidatePlan, sightlines);
  const capacity: any = capacityEvidence(plan, candidatePlan, changes, brief, projectLocks);
  const routeGraph: any = buildRouteGraph(candidatePlan.objects);
  const circulation: any = circulationEvidence(plan, candidatePlan, routeGraph, capacity, changes, brief, projectLocks);
  const metrics: Record<string, any> = {};
  if (accessibility.routeObjectIds.length > 0) metrics.accessibleRouteWidthFt = round(accessibility.minimumClearWidthM * FEET_PER_METRE, 2);
  if (capacity.sectionCapacities.length > 0) metrics.attendeeCapacity = capacity.effectiveCapacity;
  if (circulation.routeObjectIds.length > 0) metrics.peakCongestionIndex = circulation.peakCongestionIndex;
  if (sightlines.sampledSeatIds.length > 0) metrics.sightlineCoverage = sightlines.coverageRatio;
  return {
    candidatePlan,
    metrics,
    evidence: { accessibility, capacity, circulation, sightlines },
  };
}
