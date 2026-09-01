import { normalizeObjectLocks } from "./locks.ts";

const DISTANCE_PRECISION: any = 3;
const ANGLE_PRECISION: any = 1;
const EPSILON: any = 1e-9;
const SPATIAL_LAYERS: any = ["architecture", "furniture", "access", "production", "catering", "safety", "annotations"];

const round: any = (value: any, precision: any) => Number(Number(value).toFixed(precision));

const finiteNumber: any = (value: any, label: any) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be a finite number`);
  return value;
};

const positiveNumber: any = (value: any, label: any) => {
  const number: any = finiteNumber(value, label);
  if (number <= 0) throw new Error(`${label} must be greater than zero`);
  return round(number, DISTANCE_PRECISION);
};

const normalizePoint: any = (point: any, label: any) => ({
  x: round(finiteNumber(point?.x, `${label}.x`), DISTANCE_PRECISION),
  y: round(finiteNumber(point?.y, `${label}.y`), DISTANCE_PRECISION),
});

const samePoint: any = (left: any, right: any) => Math.abs(left.x - right.x) < EPSILON && Math.abs(left.y - right.y) < EPSILON;

const orientation: any = (a: any, b: any, c: any) => {
  const value: any = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) < EPSILON) return 0;
  return value > 0 ? 1 : 2;
};

const pointOnSegment: any = (point: any, start: any, end: any) => (
  point.x <= Math.max(start.x, end.x) + EPSILON
  && point.x + EPSILON >= Math.min(start.x, end.x)
  && point.y <= Math.max(start.y, end.y) + EPSILON
  && point.y + EPSILON >= Math.min(start.y, end.y)
  && orientation(start, point, end) === 0
);

const segmentsIntersect: any = (a1: any, a2: any, b1: any, b2: any) => {
  const o1: any = orientation(a1, a2, b1);
  const o2: any = orientation(a1, a2, b2);
  const o3: any = orientation(b1, b2, a1);
  const o4: any = orientation(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && pointOnSegment(b1, a1, a2))
    || (o2 === 0 && pointOnSegment(b2, a1, a2))
    || (o3 === 0 && pointOnSegment(a1, b1, b2))
    || (o4 === 0 && pointOnSegment(a2, b1, b2));
};

const signedArea: any = (ring: any) => ring.reduce((sum: any, point: any, index: any) => {
  const next: any = ring[(index + 1) % ring.length];
  return sum + (point.x * next.y) - (next.x * point.y);
}, 0) / 2;

const assertSimpleRing: any = (ring: any, label: any) => {
  for (let first: any = 0; first < ring.length; first += 1) {
    const firstNext: any = (first + 1) % ring.length;
    for (let second: any = first + 1; second < ring.length; second += 1) {
      const secondNext: any = (second + 1) % ring.length;
      const adjacent: any = first === second
        || firstNext === second
        || secondNext === first;
      if (adjacent) continue;
      if (segmentsIntersect(ring[first], ring[firstNext], ring[second], ring[secondNext])) {
        throw new Error(`Self-intersecting ${label}`);
      }
    }
  }
};

const normalizeRing: any = (points: any, label: any, clockwise: any) => {
  if (!Array.isArray(points)) throw new Error(`${label} must be an array of points`);
  const normalized: any = points.map((point: any, index: any) => normalizePoint(point, `${label}[${index}]`));
  if (normalized.length > 1 && samePoint(normalized[0], normalized.at(-1))) normalized.pop();
  if (normalized.length < 3) throw new Error(`${label} requires at least three points`);
  assertSimpleRing(normalized, label);
  const area: any = signedArea(normalized);
  if (Math.abs(area) < EPSILON) throw new Error(`${label} must enclose an area`);
  const isClockwise: any = area < 0;
  return isClockwise === clockwise ? normalized : normalized.toReversed();
};

const pointInRing: any = (point: any, ring: any) => {
  let inside: any = false;
  for (let current: any = 0, previous: any = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const a: any = ring[current];
    const b: any = ring[previous];
    if (pointOnSegment(point, a, b)) return true;
    const crosses: any = ((a.y > point.y) !== (b.y > point.y))
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

const pointInRoom: any = (point: any, roomBoundary: any) => pointInRing(point, roomBoundary.outer)
  && !roomBoundary.holes.some((hole: any) => pointInRing(point, hole));

const normalizeAngle: any = (value: any = 0) => {
  const angle: any = finiteNumber(value, "rotationDegrees");
  return round(((angle % 360) + 360) % 360, ANGLE_PRECISION);
};

const rotatePoint: any = (point: any, center: any, clockwiseDegrees: any) => {
  const radians: any = (-clockwiseDegrees * Math.PI) / 180;
  const dx: any = point.x - center.x;
  const dy: any = point.y - center.y;
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
};

const rectangleCorners: any = (footprint: any) => {
  const halfWidth: any = footprint.width / 2;
  const halfDepth: any = footprint.depth / 2;
  return [
    { x: footprint.center.x - halfWidth, y: footprint.center.y - halfDepth },
    { x: footprint.center.x + halfWidth, y: footprint.center.y - halfDepth },
    { x: footprint.center.x + halfWidth, y: footprint.center.y + halfDepth },
    { x: footprint.center.x - halfWidth, y: footprint.center.y + halfDepth },
  ].map((point: any) => rotatePoint(point, footprint.center, footprint.rotationDegrees));
};

const lineCorners: any = (footprint: any) => {
  const dx: any = footprint.end.x - footprint.start.x;
  const dy: any = footprint.end.y - footprint.start.y;
  const length: any = Math.hypot(dx, dy);
  if (length < EPSILON) throw new Error("Line footprint requires distinct start and end points");
  const offsetX: any = (-dy / length) * footprint.width / 2;
  const offsetY: any = (dx / length) * footprint.width / 2;
  return [
    { x: footprint.start.x + offsetX, y: footprint.start.y + offsetY },
    { x: footprint.end.x + offsetX, y: footprint.end.y + offsetY },
    { x: footprint.end.x - offsetX, y: footprint.end.y - offsetY },
    { x: footprint.start.x - offsetX, y: footprint.start.y - offsetY },
  ];
};

const normalizeFootprint: any = (footprint: any, objectId: any) => {
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
  throw new Error(`Unsupported footprint kind for object ${objectId}: ${footprint.kind}`);
};

const operationalMetadata: any = (object: any, fallback: any, footprint: any) => {
  const inherited: any = (key: any) => object[key] ?? fallback?.[key];
  if (object.kind === "door") {
    if (footprint.kind !== "line") throw new Error(`Door ${object.id} requires a line footprint`);
    const door: any = { ...(fallback?.door ?? {}), ...(object.door ?? {}) };
    if (!door || !Number.isFinite(door.clearWidthM) || door.clearWidthM <= 0 || !["inward", "outward", "sliding", "revolving"].includes(door.swing) || typeof door.accessible !== "boolean") throw new Error(`Door ${object.id} requires clear width, swing, and accessibility metadata`);
    const clearance: any = door.clearance ? {
      side: ["left", "right", "both"].includes(door.clearance.side) ? door.clearance.side : (() => { throw new Error(`Door ${object.id} requires a valid clearance side`); })(),
      depthM: positiveNumber(door.clearance.depthM, `${object.id}.door.clearance.depthM`),
      latchSideM: positiveNumber(door.clearance.latchSideM, `${object.id}.door.clearance.latchSideM`),
    } : null;
    return { door: { clearWidthM: positiveNumber(door.clearWidthM, `${object.id}.door.clearWidthM`), swing: door.swing, accessible: door.accessible, ...(clearance ? { clearance } : {}) } };
  }
  if (object.kind === "fire_exit") {
    if (footprint.kind !== "line") throw new Error(`Exit ${object.id} requires a line footprint`);
    const exit: any = inherited("exit");
    if (!exit || !Number.isFinite(exit.clearWidthM) || exit.clearWidthM <= 0 || typeof exit.emergency !== "boolean" || !Number.isInteger(exit.capacityPersons) || exit.capacityPersons <= 0) throw new Error(`Exit ${object.id} requires clear width, emergency, and capacity metadata`);
    return { exit: { clearWidthM: positiveNumber(exit.clearWidthM, `${object.id}.exit.clearWidthM`), emergency: exit.emergency, capacityPersons: exit.capacityPersons } };
  }
  if (["accessible_route", "corridor", "aisle", "service_lane"].includes(object.kind)) {
    if (footprint.kind !== "line") throw new Error(`Route ${object.id} requires a line footprint`);
    const route: any = inherited("route");
    if (!route || !["one-way", "bidirectional"].includes(route.direction) || typeof route.accessible !== "boolean" || !route.purpose) throw new Error(`Route ${object.id} requires direction, accessibility, and purpose metadata`);
    return { route: { direction: route.direction, accessible: route.accessible, purpose: String(route.purpose), ...(route.staffOnly === true ? { staffOnly: true } : {}) } };
  }
  if (object.kind === "restricted_zone") {
    if (!["rectangle", "polygon"].includes(footprint.kind)) throw new Error(`Restricted zone ${object.id} requires a rectangle or polygon footprint`);
    const restriction: any = inherited("restriction");
    if (!restriction || !["prohibited", "staff-only", "conditional"].includes(restriction.access) || !restriction.reasonCode || typeof restriction.blocksPlacement !== "boolean") throw new Error(`Restricted zone ${object.id} requires access, reason, and placement metadata`);
    return { restriction: { access: restriction.access, reasonCode: String(restriction.reasonCode), blocksPlacement: restriction.blocksPlacement } };
  }
  if (object.kind === "temporary_ramp") {
    if (footprint.kind !== "line") throw new Error(`Temporary ramp ${object.id} requires a line footprint`);
    const ramp: any = { ...(fallback?.ramp ?? {}), ...(object.ramp ?? {}) };
    if (!Number.isFinite(ramp.riseM) || ramp.riseM <= 0 || !Number.isFinite(ramp.runM) || ramp.runM <= 0
      || !Number.isFinite(ramp.clearWidthM) || ramp.clearWidthM <= 0 || !Number.isFinite(ramp.landingLengthM) || ramp.landingLengthM <= 0
      || !Number.isFinite(ramp.edgeProtectionHeightM) || ramp.edgeProtectionHeightM < 0 || typeof ramp.handrails !== "boolean") {
      throw new Error(`Temporary ramp ${object.id} requires rise, run, width, landing, edge protection, and handrail metadata`);
    }
    return { ramp: {
      riseM: positiveNumber(ramp.riseM, `${object.id}.ramp.riseM`),
      runM: positiveNumber(ramp.runM, `${object.id}.ramp.runM`),
      clearWidthM: positiveNumber(ramp.clearWidthM, `${object.id}.ramp.clearWidthM`),
      landingLengthM: positiveNumber(ramp.landingLengthM, `${object.id}.ramp.landingLengthM`),
      edgeProtectionHeightM: round(finiteNumber(ramp.edgeProtectionHeightM, `${object.id}.ramp.edgeProtectionHeightM`), DISTANCE_PRECISION),
      handrails: ramp.handrails,
    } };
  }
  return {};
};

const footprintTestPoints: any = (footprint: any) => {
  if (footprint.kind === "rectangle") return rectangleCorners(footprint);
  if (footprint.kind === "line") return lineCorners(footprint);
  if (footprint.kind === "polygon") return footprint.points;
  if (footprint.kind === "circle") {
    return Array.from({ length: 24 }, (_: any, index: any) => {
      const radians: any = (index / 24) * Math.PI * 2;
      return {
        x: footprint.center.x + Math.cos(radians) * footprint.radius,
        y: footprint.center.y + Math.sin(radians) * footprint.radius,
      };
    });
  }
  return [];
};

const stableStringify: any = (value: any) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key: any) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};

const fingerprint: any = (value: any) => {
  const input: any = stableStringify(value);
  let hash: any = 0x811c9dc5;
  for (let index: any = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `geom-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const normalizeSpatial: any = (spatial: any) => {
  if (!spatial) throw new Error("Plan requires canonical spatial geometry");
  if (spatial.unit !== "m") throw new Error("Canonical spatial geometry must use metres");
  const roomBoundary: any = {
    outer: normalizeRing(spatial.roomBoundary?.outer, "room boundary", false),
    holes: (spatial.roomBoundary?.holes ?? []).map((hole: any, index: any) => normalizeRing(hole, `room boundary hole ${index + 1}`, true)),
  };
  for (const [index, hole] of roomBoundary.holes.entries()) {
    if (!hole.every((point: any) => pointInRing(point, roomBoundary.outer))) {
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

export function normalizePlanGeometry(plan: any, fallbackPlan: any = null) {
  const fallbackObjects: any = new Map((fallbackPlan?.objects ?? []).map((object: any) => [object.id, object]));
  const spatial: any = normalizeSpatial(plan.spatial ?? fallbackPlan?.spatial);
  const objects: any = plan.objects.map((object: any) => {
    const fallback: any = fallbackObjects.get(object.id);
    const footprint: any = normalizeFootprint(object.footprint ?? fallback?.footprint, object.id);
    const elevationM: any = round(finiteNumber(object.elevationM ?? fallback?.elevationM ?? 0, `${object.id}.elevationM`), DISTANCE_PRECISION);
    if (elevationM < 0) throw new Error(`${object.id}.elevationM cannot be negative`);
    const layer: any = object.layer ?? fallback?.layer ?? "furniture";
    if (!SPATIAL_LAYERS.includes(layer)) throw new Error(`Object ${object.id} uses unsupported spatial layer: ${layer}`);
    if (object.kind === "seating_section" && (!Number.isInteger(object.capacity) || object.capacity < 0)) throw new Error(`Seating Section ${object.id} requires a non-negative integer capacity`);
    if (object.placement && object.placement.collisionMode !== "solid") throw new Error(`Object ${object.id} uses unsupported collision metadata`);
    if (object.circulation?.role && !["queue", "checkpoint"].includes(object.circulation.role)) throw new Error(`Object ${object.id} uses unsupported circulation role metadata`);
    for (const field of ["capacityPersonsPerMinute", "clearWidthM", "carCapacityPersons", "cycleSeconds"]) {
      if (object.circulation?.[field] != null && (!Number.isFinite(object.circulation[field]) || object.circulation[field] <= 0)) throw new Error(`Object ${object.id} requires positive ${field} circulation metadata`);
    }
    if (object.circulation?.servesZoneIds && (!Array.isArray(object.circulation.servesZoneIds) || new Set(object.circulation.servesZoneIds).size !== object.circulation.servesZoneIds.length || object.circulation.servesZoneIds.some((id: any) => typeof id !== "string" || !id.trim()))) throw new Error(`Object ${object.id} requires unique servesZoneIds circulation metadata`);
    if (object.queue) {
      if (!["registration", "security", "cloakroom", "food", "beverage", "restroom", "merchandise", "transport"].includes(object.queue.category)) throw new Error(`Queue ${object.id} uses an unsupported category`);
      if (!Number.isInteger(object.queue.servers) || object.queue.servers < 1 || !Number.isFinite(object.queue.serviceRatePerServerMinute) || object.queue.serviceRatePerServerMinute <= 0 || !Number.isInteger(object.queue.priorityLaneCount) || object.queue.priorityLaneCount < 0) throw new Error(`Queue ${object.id} requires servers, service rate, and priority lane count`);
    }
    if (object.kind === "staff_post") {
      if (!object.staffPost || !Array.isArray(object.staffPost.coverageZoneObjectIds) || !Array.isArray(object.staffPost.assignments) || object.staffPost.assignments.length === 0) throw new Error(`Staff post ${object.id} requires coverage zones and assignments`);
      if (new Set(object.staffPost.coverageZoneObjectIds).size !== object.staffPost.coverageZoneObjectIds.length || object.staffPost.coverageZoneObjectIds.some((id: any) => typeof id !== "string" || !id.trim())) throw new Error(`Staff post ${object.id} requires unique coverage zone IDs`);
      if (object.staffPost.assignments.some((assignment: any) => !assignment.shiftId || !assignment.roleId || !Number.isInteger(assignment.count) || assignment.count < 1)) throw new Error(`Staff post ${object.id} requires valid shift assignments`);
    }
    if (object.kind === "utility_point") {
      if (!object.utility || object.utility.type !== "power" || !object.utility.circuitId || !Number.isFinite(object.utility.voltage) || object.utility.voltage <= 0 || !Number.isFinite(object.utility.maxWatts) || object.utility.maxWatts <= 0) throw new Error(`Power utility ${object.id} requires circuit, voltage, and watt capacity metadata`);
    }
    if (object.kind === "rigging_point") {
      if (!object.rigging || !Number.isFinite(object.rigging.safeWorkingLoadKg) || object.rigging.safeWorkingLoadKg <= 0) throw new Error(`Rigging point ${object.id} requires a safe working load`);
    }
    if (object.kind === "backstage_zone" && (!object.productionZone || !["crew-only", "performer-only", "mixed"].includes(object.productionZone.access))) throw new Error(`Backstage zone ${object.id} requires production access metadata`);
    if (object.resourceBinding) {
      const binding: any = object.resourceBinding;
      const allowed: any = ["schemaVersion", "resourceId", "kind", "quantity"];
      if (Object.keys(binding).some((key: any) => !allowed.includes(key)) || binding.schemaVersion !== 1 || !/^resource-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(binding.resourceId ?? "") || !["inventory", "av", "power", "catering", "staffing"].includes(binding.kind) || !Number.isInteger(binding.quantity) || binding.quantity < 1) throw new Error(`Resource Binding ${object.id} is invalid`);
      if (binding.kind === "av" && !object.production) throw new Error(`AV Resource Binding ${object.id} requires production metadata`);
      if (binding.kind === "power" && object.utility?.type !== "power") throw new Error(`Power Resource Binding ${object.id} requires a power utility point`);
      if (binding.kind === "catering" && !object.catering) throw new Error(`Catering Resource Binding ${object.id} requires catering metadata`);
      if (binding.kind === "staffing" && object.kind !== "staff_post") throw new Error(`Staffing Resource Binding ${object.id} requires a staff post`);
    }
    if (object.production) {
      if (!["screen", "projector", "speaker", "camera", "control-desk", "cable-route", "power-distribution", "rigged-equipment"].includes(object.production.equipmentType)) throw new Error(`Production object ${object.id} uses an unsupported equipment type`);
      if (object.production.equipmentType === "cable-route" && footprint.kind !== "line") throw new Error(`Cable route ${object.id} requires a line footprint`);
      if (object.production.powerWatts != null && (!Number.isFinite(object.production.powerWatts) || object.production.powerWatts < 0)) throw new Error(`Production object ${object.id} requires non-negative power demand`);
      if (object.production.weightKg != null && (!Number.isFinite(object.production.weightKg) || object.production.weightKg < 0)) throw new Error(`Production object ${object.id} requires non-negative weight`);
      if (object.production.requiresRigging === true && !object.production.riggingPointId) throw new Error(`Production object ${object.id} requires a rigging point ID`);
    }
    if (["bar", "buffet", "kitchen", "prep_zone", "waste_point", "water_point"].includes(object.kind) && !object.catering) throw new Error(`Catering object ${object.id} requires catering metadata`);
    if (object.catering) {
      if (!["bar", "buffet", "service-counter", "kitchen", "prep", "waste", "water", "queue-zone", "replenishment-route"].includes(object.catering.type)) throw new Error(`Catering object ${object.id} uses an unsupported type`);
      if (object.catering.attendeeRecords != null || object.catering.attendeeHealthRecords != null) throw new Error(`Catering object ${object.id} cannot store attendee health records`);
      if (["bar", "buffet", "service-counter"].includes(object.catering.type)) {
        if (!Number.isInteger(object.catering.servers) || object.catering.servers < 1 || !Number.isFinite(object.catering.serviceRatePerServerMinute) || object.catering.serviceRatePerServerMinute <= 0 || !Number.isFinite(object.catering.demandShare) || object.catering.demandShare <= 0 || object.catering.demandShare > 1 || !Number.isInteger(object.catering.queueBufferPersons) || object.catering.queueBufferPersons < 0 || !object.catering.queueZoneObjectId || !object.catering.replenishmentSourceObjectId || !object.catering.waterSourceObjectId) throw new Error(`Catering station ${object.id} requires service, queue, replenishment, and water metadata`);
        if (!Number.isFinite(object.catering.serviceHeightM) || object.catering.serviceHeightM <= 0 || typeof object.catering.accessibleServicePoint !== "boolean") throw new Error(`Catering station ${object.id} requires accessible service metadata`);
        for (const field of ["dietaryOptions", "allergenLabels"]) if (!Array.isArray(object.catering[field]) || new Set(object.catering[field]).size !== object.catering[field].length || object.catering[field].some((item: any) => typeof item !== "string" || !item.trim())) throw new Error(`Catering station ${object.id} requires unique ${field}`);
      }
      if (object.catering.type === "replenishment-route") {
        if (footprint.kind !== "line" || !object.catering.sourceObjectId || !Array.isArray(object.catering.targetObjectIds) || object.catering.targetObjectIds.length === 0 || new Set(object.catering.targetObjectIds).size !== object.catering.targetObjectIds.length || !object.catering.crossingControl) throw new Error(`Replenishment route ${object.id} requires a line, endpoints, and crossing control`);
      }
    }
    const emergencyKinds: any = ["assembly_point", "emergency_access_lane", "fire_equipment", "first_aid", "command_post"];
    if (emergencyKinds.includes(object.kind) && !object.emergency) throw new Error(`Emergency object ${object.id} requires emergency metadata`);
    if (object.emergency) {
      if (!["assembly-point", "emergency-access-lane", "fire-equipment", "first-aid", "command-post"].includes(object.emergency.type)) throw new Error(`Emergency object ${object.id} uses an unsupported type`);
      if (object.kind === "assembly_point" && (!Number.isInteger(object.emergency.capacityPersons) || object.emergency.capacityPersons < 1 || !Array.isArray(object.emergency.designatedExitObjectIds) || object.emergency.designatedExitObjectIds.length === 0 || new Set(object.emergency.designatedExitObjectIds).size !== object.emergency.designatedExitObjectIds.length)) throw new Error(`Assembly point ${object.id} requires capacity and unique designated exit IDs`);
      if (object.kind === "emergency_access_lane" && (footprint.kind !== "line" || object.emergency.responderOnly !== true)) throw new Error(`Emergency access lane ${object.id} requires a responder-only line footprint`);
      if (object.kind === "fire_equipment" && (!object.emergency.equipmentClass || !Number.isFinite(object.emergency.coverageRadiusM) || object.emergency.coverageRadiusM <= 0 || !Number.isFinite(object.emergency.clearanceM) || object.emergency.clearanceM <= 0)) throw new Error(`Fire equipment ${object.id} requires class, coverage, and clearance metadata`);
      if (["first_aid", "command_post"].includes(object.kind) && typeof object.emergency.accessible !== "boolean") throw new Error(`Emergency post ${object.id} requires accessibility metadata`);
      if (object.emergency.backupPowerMinutes != null && (!Number.isFinite(object.emergency.backupPowerMinutes) || object.emergency.backupPowerMinutes < 0)) throw new Error(`Emergency object ${object.id} requires non-negative backup power`);
    }
    if (object.kind !== "assembly_point" && !footprintTestPoints(footprint).every((point: any) => pointInRoom(point, spatial.roomBoundary))) {
      throw new Error(`Object ${object.id} footprint is outside the room boundary`);
    }
    return normalizeObjectLocks({ ...object, ...operationalMetadata(object, fallback, footprint), layer, elevationM, footprint }, fallback);
  });
  const geometryValue: any = {
    ...spatial,
    objects: objects.map(({ id, layer, elevationM, footprint }: any) => ({ id, layer, elevationM, footprint })),
  };
  return {
    ...plan,
    spatial: { ...spatial, fingerprint: fingerprint(geometryValue) },
    objects,
  };
}
