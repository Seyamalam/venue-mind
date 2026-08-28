import { stableFingerprint } from "./activity-ledger.js";
import { footprintsIntersect } from "./spatial-analysis.js";
import { evaluateInventoryAvailability } from "./venue-templates.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value, precision = 3) => Number(Number(value).toFixed(precision));
const csv = (value) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const centerOf = (footprint) => {
  if (footprint?.center) return clone(footprint.center);
  if (footprint?.start && footprint?.end) return { x: round((footprint.start.x + footprint.end.x) / 2), y: round((footprint.start.y + footprint.end.y) / 2) };
  const points = footprint?.points ?? [];
  return points.length ? { x: round(points.reduce((sum, point) => sum + point.x, 0) / points.length), y: round(points.reduce((sum, point) => sum + point.y, 0) / points.length) } : { x: 0, y: 0 };
};
const distance = (left, right) => Math.hypot(right.x - left.x, right.y - left.y);
const angleBetween = (origin, aim, point) => {
  const a = Math.atan2(aim.y - origin.y, aim.x - origin.x);
  const b = Math.atan2(point.y - origin.y, point.x - origin.x);
  return Math.abs((((b - a) * 180 / Math.PI) + 540) % 360 - 180);
};
const rayFootprint = (start, end) => ({ kind: "line", start, end, width: .01 });

export const PRODUCTION_EQUIPMENT_TYPES = Object.freeze(["screen", "projector", "speaker", "camera", "control-desk", "cable-route", "power-distribution", "rigged-equipment"]);

export function normalizeProductionPolicy(value = {}) {
  const number = (field, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
    const normalized = Number(value[field] ?? fallback);
    if (!Number.isFinite(normalized) || normalized < minimum || normalized > maximum) throw new Error(`Production policy ${field} is invalid`);
    return normalized;
  };
  return {
    schemaVersion: 1,
    minimumScreenVisibilityRatio: round(number("minimumScreenVisibilityRatio", .7, 0, 1)),
    minimumSpeakerCoverageRatio: round(number("minimumSpeakerCoverageRatio", .95, 0, 1)),
    minimumControlSightlineRatio: round(number("minimumControlSightlineRatio", 1, 0, 1)),
    allowedAccessibleCrossingTreatments: [...new Set((value.allowedAccessibleCrossingTreatments ?? ["overhead", "cable-ramp"]).map(String))].sort(),
  };
}

const blockersForRay = (plan, sourceObjectId, targetObjectId, start, end) => plan.objects
  .filter((object) => object.id !== sourceObjectId && object.id !== targetObjectId && Number(object.sightline?.opacity ?? 0) > 0)
  .filter((object) => footprintsIntersect(rayFootprint(start, end), object.footprint))
  .map((object) => object.id)
  .sort();

export function analyzeProductionPlan(plan) {
  const policy = normalizeProductionPolicy(plan.productionPolicy);
  const byId = new Map(plan.objects.map((object) => [object.id, object]));
  const equipment = plan.objects.filter((object) => object.production?.equipmentType).sort((left, right) => left.id.localeCompare(right.id));
  const screens = equipment.filter((object) => object.production.equipmentType === "screen");
  const projectors = equipment.filter((object) => object.production.equipmentType === "projector");
  const speakers = equipment.filter((object) => object.production.equipmentType === "speaker");
  const cameras = equipment.filter((object) => object.production.equipmentType === "camera");
  const controls = equipment.filter((object) => object.production.equipmentType === "control-desk");
  const cables = equipment.filter((object) => object.production.equipmentType === "cable-route");
  const seating = plan.objects.filter((object) => object.kind === "seating_section");

  const throwDistanceChecks = projectors.map((projector) => {
    const target = byId.get(projector.production.targetObjectId);
    const widthM = target?.production?.viewableWidthM;
    const throwDistanceM = target ? round(distance(centerOf(projector.footprint), centerOf(target.footprint))) : null;
    const throwRatio = widthM > 0 && throwDistanceM != null ? round(throwDistanceM / widthM) : null;
    const minimum = projector.production.throwRatioMin;
    const maximum = projector.production.throwRatioMax;
    const status = target && Number.isFinite(minimum) && Number.isFinite(maximum) && throwRatio >= minimum && throwRatio <= maximum ? "pass" : "fail";
    return { projectorObjectId: projector.id, screenObjectId: target?.id ?? projector.production.targetObjectId ?? null, throwDistanceM, viewableWidthM: widthM ?? null, throwRatio, minimumThrowRatio: minimum ?? null, maximumThrowRatio: maximum ?? null, status };
  });

  const screenVisibility = screens.map((screen) => {
    const target = centerOf(screen.footprint);
    const rays = seating.flatMap((section) => (section.sightline?.samples ?? []).map((sample) => {
      const blockedByObjectIds = blockersForRay(plan, section.id, screen.id, sample.point, target);
      return { id: `production-ray-${sample.id}-${screen.id}`, sampleId: sample.id, seatingObjectId: section.id, screenObjectId: screen.id, viewingDistanceM: round(distance(sample.point, target), 2), blockedByObjectIds, status: blockedByObjectIds.length ? "blocked" : "clear" };
    }));
    const coverageRatio = rays.length ? round(rays.filter((ray) => ray.status === "clear").length / rays.length) : 0;
    return { screenObjectId: screen.id, sampledSeats: rays.length, coverageRatio, minimumCoverageRatio: policy.minimumScreenVisibilityRatio, status: coverageRatio >= policy.minimumScreenVisibilityRatio ? "pass" : "fail", rays };
  });

  const speakerCoverage = seating.map((section) => {
    const samples = section.sightline?.samples ?? [];
    const sampleResults = samples.map((sample) => {
      const coveringSpeakerObjectIds = speakers.filter((speaker) => {
        const origin = centerOf(speaker.footprint);
        const aim = speaker.production.aimPoint;
        return (speaker.production.targetZoneObjectIds ?? []).includes(section.id)
          && distance(origin, sample.point) <= speaker.production.coverageRangeM
          && angleBetween(origin, aim, sample.point) <= speaker.production.coverageAngleDegrees / 2;
      }).map((speaker) => speaker.id).sort();
      return { sampleId: sample.id, coveringSpeakerObjectIds, status: coveringSpeakerObjectIds.length ? "covered" : "gap" };
    });
    const coverageRatio = sampleResults.length ? round(sampleResults.filter((sample) => sample.status === "covered").length / sampleResults.length) : 0;
    return { seatingObjectId: section.id, coverageRatio, minimumCoverageRatio: policy.minimumSpeakerCoverageRatio, status: coverageRatio >= policy.minimumSpeakerCoverageRatio ? "pass" : "fail", samples: sampleResults };
  });

  const cameraChecks = cameras.map((camera) => {
    const target = byId.get(camera.production.targetObjectId);
    const cameraDistanceM = target ? round(distance(centerOf(camera.footprint), centerOf(target.footprint))) : null;
    const blockers = target ? blockersForRay(plan, camera.id, target.id, centerOf(camera.footprint), centerOf(target.footprint)) : [];
    const status = target && cameraDistanceM >= camera.production.minimumDistanceM && cameraDistanceM <= camera.production.maximumDistanceM && blockers.length === 0 ? "pass" : "fail";
    return { cameraObjectId: camera.id, targetObjectId: target?.id ?? camera.production.targetObjectId ?? null, distanceM: cameraDistanceM, minimumDistanceM: camera.production.minimumDistanceM, maximumDistanceM: camera.production.maximumDistanceM, blockedByObjectIds: blockers, status };
  });

  const controlSightlines = controls.flatMap((control) => (control.production.targetObjectIds ?? []).map((targetObjectId) => {
    const target = byId.get(targetObjectId);
    const blockers = target ? blockersForRay(plan, control.id, target.id, centerOf(control.footprint), centerOf(target.footprint)) : [];
    return { controlObjectId: control.id, targetObjectId, viewingDistanceM: target ? round(distance(centerOf(control.footprint), centerOf(target.footprint)), 2) : null, blockedByObjectIds: blockers, status: target && blockers.length === 0 ? "pass" : "fail" };
  }));
  const controlSightlineRatio = controlSightlines.length ? round(controlSightlines.filter((check) => check.status === "pass").length / controlSightlines.length) : 0;

  const accessibleRoutes = plan.objects.filter((object) => ["accessible_route", "corridor", "aisle", "service_lane"].includes(object.kind) && object.route?.accessible === true);
  const cableCrossings = cables.flatMap((cable) => accessibleRoutes.filter((route) => footprintsIntersect(cable.footprint, route.footprint)).map((route) => {
    const treatment = cable.production.crossingTreatment ?? "none";
    return { cableObjectId: cable.id, routeObjectId: route.id, treatment, status: policy.allowedAccessibleCrossingTreatments.includes(treatment) ? "pass" : "fail" };
  })).sort((left, right) => left.cableObjectId.localeCompare(right.cableObjectId) || left.routeObjectId.localeCompare(right.routeObjectId));

  const poweredEquipment = equipment.filter((object) => Number(object.production.powerWatts ?? 0) > 0);
  const circuits = plan.objects.filter((object) => object.kind === "utility_point" && object.utility?.type === "power").map((utility) => {
    const connected = poweredEquipment.filter((object) => object.production.circuitId === utility.utility.circuitId);
    const demandWatts = connected.reduce((sum, object) => sum + object.production.powerWatts * (object.inventoryCount ?? 1), 0);
    const capacityWatts = utility.utility.maxWatts ?? (utility.utility.powerKw ?? 0) * 1000;
    return { circuitId: utility.utility.circuitId, utilityObjectId: utility.id, capacityWatts, demandWatts, spareWatts: capacityWatts - demandWatts, connectedObjectIds: connected.map((object) => object.id).sort(), status: demandWatts <= capacityWatts ? "pass" : "fail" };
  }).sort((left, right) => left.circuitId.localeCompare(right.circuitId));
  const knownCircuitIds = new Set(circuits.map((circuit) => circuit.circuitId));
  const unpoweredObjectIds = poweredEquipment.filter((object) => !knownCircuitIds.has(object.production.circuitId)).map((object) => object.id).sort();

  const rigging = plan.objects.filter((object) => object.kind === "rigging_point").map((point) => {
    const suspended = equipment.filter((object) => object.production.riggingPointId === point.id);
    const demandKg = round(suspended.reduce((sum, object) => sum + (object.production.weightKg ?? 0) * (object.inventoryCount ?? 1), 0), 2);
    const capacityKg = point.rigging?.safeWorkingLoadKg ?? 0;
    return { riggingPointObjectId: point.id, capacityKg, demandKg, spareKg: round(capacityKg - demandKg, 2), suspendedObjectIds: suspended.map((object) => object.id).sort(), status: demandKg <= capacityKg ? "pass" : "fail" };
  }).sort((left, right) => left.riggingPointObjectId.localeCompare(right.riggingPointObjectId));
  const riggingPointIds = new Set(rigging.map((item) => item.riggingPointObjectId));
  const unresolvedRiggingObjectIds = equipment.filter((object) => object.production.requiresRigging === true && !riggingPointIds.has(object.production.riggingPointId)).map((object) => object.id).sort();

  const inventory = evaluateInventoryAvailability(plan).filter((item) => {
    const template = plan.objects.find((object) => object.templateRef?.templateId === item.templateId);
    return template?.layer === "production";
  });
  const inventoryShortages = inventory.filter((item) => item.status === "warning").map((item) => item.templateId).sort();
  const checkStatuses = [
    ...throwDistanceChecks.map((item) => item.status),
    ...screenVisibility.map((item) => item.status),
    ...speakerCoverage.map((item) => item.status),
    ...cameraChecks.map((item) => item.status),
    controlSightlineRatio >= policy.minimumControlSightlineRatio ? "pass" : "fail",
    ...cableCrossings.map((item) => item.status),
    ...circuits.map((item) => item.status),
    unpoweredObjectIds.length ? "fail" : "pass",
    ...rigging.map((item) => item.status),
    unresolvedRiggingObjectIds.length ? "fail" : "pass",
    inventoryShortages.length ? "fail" : "pass",
  ];
  const result = {
    schemaVersion: 1,
    kind: "production-planning-result",
    planId: plan.id,
    planVersion: plan.version,
    geometryFingerprint: plan.spatial.fingerprint,
    policy,
    equipmentObjectIds: equipment.map((object) => object.id),
    productionLayerObjectIds: plan.objects.filter((object) => object.layer === "production").map((object) => object.id).sort(),
    backstageZoneObjectIds: plan.objects.filter((object) => object.kind === "backstage_zone").map((object) => object.id).sort(),
    throwDistanceChecks,
    screenVisibility,
    speakerCoverage,
    cameraChecks,
    controlSightlines,
    controlSightlineRatio,
    cableCrossings,
    circuits,
    unpoweredObjectIds,
    rigging,
    unresolvedRiggingObjectIds,
    inventory,
    inventoryShortages,
    summary: {
      status: checkStatuses.every((status) => status === "pass") ? "pass" : "fail",
      equipmentCount: equipment.length,
      failedChecks: checkStatuses.filter((status) => status === "fail").length,
      untreatedCableCrossings: cableCrossings.filter((item) => item.status === "fail").length,
      overloadedCircuits: circuits.filter((item) => item.status === "fail").length,
      overloadedRiggingPoints: rigging.filter((item) => item.status === "fail").length,
      inventoryShortages: inventoryShortages.length,
    },
  };
  result.evidenceFingerprint = stableFingerprint("production-planning", result);
  return result;
}

export function createProductionScheduleCsv(plan, result = analyzeProductionPlan(plan)) {
  const inventory = new Map(result.inventory.map((item) => [`${item.templateId}@${item.version}`, item]));
  const rows = plan.objects.filter((object) => object.production?.equipmentType).sort((left, right) => left.id.localeCompare(right.id)).map((object) => {
    const templateKey = object.templateRef ? `${object.templateRef.templateId}@${object.templateRef.version}` : null;
    return [object.id, object.label, object.kind, object.production.equipmentType, object.inventoryCount ?? 1, object.production.targetObjectId ?? object.production.targetObjectIds?.join("|") ?? "", object.production.circuitId ?? "", object.production.powerWatts ?? 0, object.production.riggingPointId ?? "", object.production.weightKg ?? 0, object.production.crossingTreatment ?? "", object.templateRef?.templateId ?? "", inventory.get(templateKey)?.status ?? "unmeasured"];
  });
  const header = ["object_id", "label", "kind", "equipment_type", "count", "target_object_ids", "circuit_id", "watts_each", "rigging_point_object_id", "weight_kg_each", "crossing_treatment", "template_id", "inventory_status"];
  return `${[header, ...rows].map((row) => row.map(csv).join(",")).join("\r\n")}\r\n`;
}

export function createProductionMapSvg(plan, result = analyzeProductionPlan(plan)) {
  const boundary = plan.spatial.roomBoundary.outer;
  const minX = Math.min(...boundary.map((point) => point.x));
  const maxX = Math.max(...boundary.map((point) => point.x));
  const minY = Math.min(...boundary.map((point) => point.y));
  const maxY = Math.max(...boundary.map((point) => point.y));
  const scale = Math.min(900 / (maxX - minX), 540 / (maxY - minY));
  const point = ({ x, y }) => ({ x: 60 + (x - minX) * scale, y: 590 - (y - minY) * scale });
  const room = boundary.map((item) => { const p = point(item); return `${round(p.x)},${round(p.y)}`; }).join(" ");
  const objects = plan.objects.filter((object) => object.layer === "production" || object.production?.equipmentType === "cable-route").sort((left, right) => left.id.localeCompare(right.id)).map((object, index) => {
    const center = point(centerOf(object.footprint));
    if (object.footprint.kind === "line") {
      const start = point(object.footprint.start);
      const end = point(object.footprint.end);
      return `<g data-object-id="${object.id}"><line x1="${round(start.x)}" y1="${round(start.y)}" x2="${round(end.x)}" y2="${round(end.y)}" stroke="#6f4ee8" stroke-width="4" stroke-dasharray="7 5"/><text x="${round(center.x + 8)}" y="${round(center.y - 7)}" font-size="10">${object.label}</text></g>`;
    }
    return `<g data-object-id="${object.id}"><circle cx="${round(center.x)}" cy="${round(center.y)}" r="10" fill="#6f4ee8"/><text x="${round(center.x)}" y="${round(center.y + 4)}" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">${index + 1}</text><text x="${round(center.x + 14)}" y="${round(center.y + 4)}" font-size="10">${object.label}</text></g>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="640" viewBox="0 0 1020 640" role="img" aria-label="Production plan"><rect width="1020" height="640" fill="#f8f7f3"/><text x="60" y="34" font-family="Inter,Arial" font-size="22" font-weight="700">${plan.event.name} · PRODUCTION</text><text x="960" y="34" text-anchor="end" font-family="Inter,Arial" font-size="11">${result.summary.status.toUpperCase()} · ${result.evidenceFingerprint}</text><polygon points="${room}" fill="#fff" stroke="#34352f" stroke-width="3"/>${objects}</svg>\n`;
}
