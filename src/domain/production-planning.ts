import { stableFingerprint } from "./activity-ledger.ts";
import { footprintsIntersect } from "./spatial-analysis.ts";
import { evaluateInventoryAvailability } from "./venue-templates.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const round: any = (value: any, precision: any = 3) => Number(Number(value).toFixed(precision));
const csv: any = (value: any) => {
  const text: any = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
const centerOf: any = (footprint: any) => {
  if (footprint?.center) return clone(footprint.center);
  if (footprint?.start && footprint?.end) return { x: round((footprint.start.x + footprint.end.x) / 2), y: round((footprint.start.y + footprint.end.y) / 2) };
  const points: any = footprint?.points ?? [];
  return points.length ? { x: round(points.reduce((sum: any, point: any) => sum + point.x, 0) / points.length), y: round(points.reduce((sum: any, point: any) => sum + point.y, 0) / points.length) } : { x: 0, y: 0 };
};
const distance: any = (left: any, right: any) => Math.hypot(right.x - left.x, right.y - left.y);
const angleBetween: any = (origin: any, aim: any, point: any) => {
  const a: any = Math.atan2(aim.y - origin.y, aim.x - origin.x);
  const b: any = Math.atan2(point.y - origin.y, point.x - origin.x);
  return Math.abs((((b - a) * 180 / Math.PI) + 540) % 360 - 180);
};
const rayFootprint: any = (start: any, end: any) => ({ kind: "line", start, end, width: .01 });

export const PRODUCTION_EQUIPMENT_TYPES = Object.freeze(["screen", "projector", "speaker", "camera", "control-desk", "cable-route", "power-distribution", "rigged-equipment"]);

export function normalizeProductionPolicy(value: any = {}) {
  const number: any = (field: any, fallback: any, minimum: any = 0, maximum: any = Number.MAX_SAFE_INTEGER) => {
    const normalized: any = Number(value[field] ?? fallback);
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

const blockersForRay: any = (plan: any, sourceObjectId: any, targetObjectId: any, start: any, end: any) => plan.objects
  .filter((object: any) => object.id !== sourceObjectId && object.id !== targetObjectId && Number(object.sightline?.opacity ?? 0) > 0)
  .filter((object: any) => footprintsIntersect(rayFootprint(start, end), object.footprint))
  .map((object: any) => object.id)
  .sort();

export function analyzeProductionPlan(plan: any) {
  const policy: any = normalizeProductionPolicy(plan.productionPolicy);
  const byId: any = new Map(plan.objects.map((object: any) => [object.id, object]));
  const equipment: any = plan.objects.filter((object: any) => object.production?.equipmentType).sort((left: any, right: any) => left.id.localeCompare(right.id));
  const screens: any = equipment.filter((object: any) => object.production.equipmentType === "screen");
  const projectors: any = equipment.filter((object: any) => object.production.equipmentType === "projector");
  const speakers: any = equipment.filter((object: any) => object.production.equipmentType === "speaker");
  const cameras: any = equipment.filter((object: any) => object.production.equipmentType === "camera");
  const controls: any = equipment.filter((object: any) => object.production.equipmentType === "control-desk");
  const cables: any = equipment.filter((object: any) => object.production.equipmentType === "cable-route");
  const seating: any = plan.objects.filter((object: any) => object.kind === "seating_section");

  const throwDistanceChecks: any = projectors.map((projector: any) => {
    const target: any = byId.get(projector.production.targetObjectId);
    const widthM: any = target?.production?.viewableWidthM;
    const throwDistanceM: any = target ? round(distance(centerOf(projector.footprint), centerOf(target.footprint))) : null;
    const throwRatio: any = widthM > 0 && throwDistanceM != null ? round(throwDistanceM / widthM) : null;
    const minimum: any = projector.production.throwRatioMin;
    const maximum: any = projector.production.throwRatioMax;
    const status: any = target && Number.isFinite(minimum) && Number.isFinite(maximum) && throwRatio >= minimum && throwRatio <= maximum ? "pass" : "fail";
    return { projectorObjectId: projector.id, screenObjectId: target?.id ?? projector.production.targetObjectId ?? null, throwDistanceM, viewableWidthM: widthM ?? null, throwRatio, minimumThrowRatio: minimum ?? null, maximumThrowRatio: maximum ?? null, status };
  });

  const screenVisibility: any = screens.map((screen: any) => {
    const target: any = centerOf(screen.footprint);
    const rays: any = seating.flatMap((section: any) => (section.sightline?.samples ?? []).map((sample: any) => {
      const blockedByObjectIds: any = blockersForRay(plan, section.id, screen.id, sample.point, target);
      return { id: `production-ray-${sample.id}-${screen.id}`, sampleId: sample.id, seatingObjectId: section.id, screenObjectId: screen.id, viewingDistanceM: round(distance(sample.point, target), 2), blockedByObjectIds, status: blockedByObjectIds.length ? "blocked" : "clear" };
    }));
    const coverageRatio: any = rays.length ? round(rays.filter((ray: any) => ray.status === "clear").length / rays.length) : 0;
    return { screenObjectId: screen.id, sampledSeats: rays.length, coverageRatio, minimumCoverageRatio: policy.minimumScreenVisibilityRatio, status: coverageRatio >= policy.minimumScreenVisibilityRatio ? "pass" : "fail", rays };
  });

  const speakerCoverage: any = seating.map((section: any) => {
    const samples: any = section.sightline?.samples ?? [];
    const sampleResults: any = samples.map((sample: any) => {
      const coveringSpeakerObjectIds: any = speakers.filter((speaker: any) => {
        const origin: any = centerOf(speaker.footprint);
        const aim: any = speaker.production.aimPoint;
        return (speaker.production.targetZoneObjectIds ?? []).includes(section.id)
          && distance(origin, sample.point) <= speaker.production.coverageRangeM
          && angleBetween(origin, aim, sample.point) <= speaker.production.coverageAngleDegrees / 2;
      }).map((speaker: any) => speaker.id).sort();
      return { sampleId: sample.id, coveringSpeakerObjectIds, status: coveringSpeakerObjectIds.length ? "covered" : "gap" };
    });
    const coverageRatio: any = sampleResults.length ? round(sampleResults.filter((sample: any) => sample.status === "covered").length / sampleResults.length) : 0;
    return { seatingObjectId: section.id, coverageRatio, minimumCoverageRatio: policy.minimumSpeakerCoverageRatio, status: coverageRatio >= policy.minimumSpeakerCoverageRatio ? "pass" : "fail", samples: sampleResults };
  });

  const cameraChecks: any = cameras.map((camera: any) => {
    const target: any = byId.get(camera.production.targetObjectId);
    const cameraDistanceM: any = target ? round(distance(centerOf(camera.footprint), centerOf(target.footprint))) : null;
    const blockers: any = target ? blockersForRay(plan, camera.id, target.id, centerOf(camera.footprint), centerOf(target.footprint)) : [];
    const status: any = target && cameraDistanceM >= camera.production.minimumDistanceM && cameraDistanceM <= camera.production.maximumDistanceM && blockers.length === 0 ? "pass" : "fail";
    return { cameraObjectId: camera.id, targetObjectId: target?.id ?? camera.production.targetObjectId ?? null, distanceM: cameraDistanceM, minimumDistanceM: camera.production.minimumDistanceM, maximumDistanceM: camera.production.maximumDistanceM, blockedByObjectIds: blockers, status };
  });

  const controlSightlines: any = controls.flatMap((control: any) => (control.production.targetObjectIds ?? []).map((targetObjectId: any) => {
    const target: any = byId.get(targetObjectId);
    const blockers: any = target ? blockersForRay(plan, control.id, target.id, centerOf(control.footprint), centerOf(target.footprint)) : [];
    return { controlObjectId: control.id, targetObjectId, viewingDistanceM: target ? round(distance(centerOf(control.footprint), centerOf(target.footprint)), 2) : null, blockedByObjectIds: blockers, status: target && blockers.length === 0 ? "pass" : "fail" };
  }));
  const controlSightlineRatio: any = controlSightlines.length ? round(controlSightlines.filter((check: any) => check.status === "pass").length / controlSightlines.length) : 0;

  const accessibleRoutes: any = plan.objects.filter((object: any) => ["accessible_route", "corridor", "aisle", "service_lane"].includes(object.kind) && object.route?.accessible === true);
  const cableCrossings: any = cables.flatMap((cable: any) => accessibleRoutes.filter((route: any) => footprintsIntersect(cable.footprint, route.footprint)).map((route: any) => {
    const treatment: any = cable.production.crossingTreatment ?? "none";
    return { cableObjectId: cable.id, routeObjectId: route.id, treatment, status: policy.allowedAccessibleCrossingTreatments.includes(treatment) ? "pass" : "fail" };
  })).sort((left: any, right: any) => left.cableObjectId.localeCompare(right.cableObjectId) || left.routeObjectId.localeCompare(right.routeObjectId));

  const poweredEquipment: any = equipment.filter((object: any) => Number(object.production.powerWatts ?? 0) > 0);
  const circuits: any = plan.objects.filter((object: any) => object.kind === "utility_point" && object.utility?.type === "power").map((utility: any) => {
    const connected: any = poweredEquipment.filter((object: any) => object.production.circuitId === utility.utility.circuitId);
    const demandWatts: any = connected.reduce((sum: any, object: any) => sum + object.production.powerWatts * (object.inventoryCount ?? 1), 0);
    const capacityWatts: any = utility.utility.maxWatts ?? (utility.utility.powerKw ?? 0) * 1000;
    return { circuitId: utility.utility.circuitId, utilityObjectId: utility.id, capacityWatts, demandWatts, spareWatts: capacityWatts - demandWatts, connectedObjectIds: connected.map((object: any) => object.id).sort(), status: demandWatts <= capacityWatts ? "pass" : "fail" };
  }).sort((left: any, right: any) => left.circuitId.localeCompare(right.circuitId));
  const knownCircuitIds: any = new Set(circuits.map((circuit: any) => circuit.circuitId));
  const unpoweredObjectIds: any = poweredEquipment.filter((object: any) => !knownCircuitIds.has(object.production.circuitId)).map((object: any) => object.id).sort();

  const rigging: any = plan.objects.filter((object: any) => object.kind === "rigging_point").map((point: any) => {
    const suspended: any = equipment.filter((object: any) => object.production.riggingPointId === point.id);
    const demandKg: any = round(suspended.reduce((sum: any, object: any) => sum + (object.production.weightKg ?? 0) * (object.inventoryCount ?? 1), 0), 2);
    const capacityKg: any = point.rigging?.safeWorkingLoadKg ?? 0;
    return { riggingPointObjectId: point.id, capacityKg, demandKg, spareKg: round(capacityKg - demandKg, 2), suspendedObjectIds: suspended.map((object: any) => object.id).sort(), status: demandKg <= capacityKg ? "pass" : "fail" };
  }).sort((left: any, right: any) => left.riggingPointObjectId.localeCompare(right.riggingPointObjectId));
  const riggingPointIds: any = new Set(rigging.map((item: any) => item.riggingPointObjectId));
  const unresolvedRiggingObjectIds: any = equipment.filter((object: any) => object.production.requiresRigging === true && !riggingPointIds.has(object.production.riggingPointId)).map((object: any) => object.id).sort();

  const inventory: any = evaluateInventoryAvailability(plan).filter((item: any) => {
    const template: any = plan.objects.find((object: any) => object.templateRef?.templateId === item.templateId);
    return template?.layer === "production";
  });
  const inventoryShortages: any = inventory.filter((item: any) => item.status === "warning").map((item: any) => item.templateId).sort();
  const checkStatuses: any = [
    ...throwDistanceChecks.map((item: any) => item.status),
    ...screenVisibility.map((item: any) => item.status),
    ...speakerCoverage.map((item: any) => item.status),
    ...cameraChecks.map((item: any) => item.status),
    controlSightlineRatio >= policy.minimumControlSightlineRatio ? "pass" : "fail",
    ...cableCrossings.map((item: any) => item.status),
    ...circuits.map((item: any) => item.status),
    unpoweredObjectIds.length ? "fail" : "pass",
    ...rigging.map((item: any) => item.status),
    unresolvedRiggingObjectIds.length ? "fail" : "pass",
    inventoryShortages.length ? "fail" : "pass",
  ];
  const result: any = {
    schemaVersion: 1,
    kind: "production-planning-result",
    planId: plan.id,
    planVersion: plan.version,
    geometryFingerprint: plan.spatial.fingerprint,
    policy,
    equipmentObjectIds: equipment.map((object: any) => object.id),
    productionLayerObjectIds: plan.objects.filter((object: any) => object.layer === "production").map((object: any) => object.id).sort(),
    backstageZoneObjectIds: plan.objects.filter((object: any) => object.kind === "backstage_zone").map((object: any) => object.id).sort(),
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
      status: checkStatuses.every((status: any) => status === "pass") ? "pass" : "fail",
      equipmentCount: equipment.length,
      failedChecks: checkStatuses.filter((status: any) => status === "fail").length,
      untreatedCableCrossings: cableCrossings.filter((item: any) => item.status === "fail").length,
      overloadedCircuits: circuits.filter((item: any) => item.status === "fail").length,
      overloadedRiggingPoints: rigging.filter((item: any) => item.status === "fail").length,
      inventoryShortages: inventoryShortages.length,
    },
  };
  result.evidenceFingerprint = stableFingerprint("production-planning", result);
  return result;
}

export function createProductionScheduleCsv(plan: any, result: any = analyzeProductionPlan(plan)) {
  const inventory: any = new Map(result.inventory.map((item: any) => [`${item.templateId}@${item.version}`, item]));
  const rows: any = plan.objects.filter((object: any) => object.production?.equipmentType).sort((left: any, right: any) => left.id.localeCompare(right.id)).map((object: any) => {
    const templateKey: any = object.templateRef ? `${object.templateRef.templateId}@${object.templateRef.version}` : null;
    return [object.id, object.label, object.kind, object.production.equipmentType, object.inventoryCount ?? 1, object.production.targetObjectId ?? object.production.targetObjectIds?.join("|") ?? "", object.production.circuitId ?? "", object.production.powerWatts ?? 0, object.production.riggingPointId ?? "", object.production.weightKg ?? 0, object.production.crossingTreatment ?? "", object.templateRef?.templateId ?? "", inventory.get(templateKey)?.status ?? "unmeasured"];
  });
  const header: any = ["object_id", "label", "kind", "equipment_type", "count", "target_object_ids", "circuit_id", "watts_each", "rigging_point_object_id", "weight_kg_each", "crossing_treatment", "template_id", "inventory_status"];
  return `${[header, ...rows].map((row: any) => row.map(csv).join(",")).join("\r\n")}\r\n`;
}

export function createProductionMapSvg(plan: any, result: any = analyzeProductionPlan(plan)) {
  const boundary: any = plan.spatial.roomBoundary.outer;
  const minX: any = Math.min(...boundary.map((point: any) => point.x));
  const maxX: any = Math.max(...boundary.map((point: any) => point.x));
  const minY: any = Math.min(...boundary.map((point: any) => point.y));
  const maxY: any = Math.max(...boundary.map((point: any) => point.y));
  const scale: any = Math.min(900 / (maxX - minX), 540 / (maxY - minY));
  const point: any = ({ x, y }: any) => ({ x: 60 + (x - minX) * scale, y: 590 - (y - minY) * scale });
  const room: any = boundary.map((item: any) => { const p: any = point(item); return `${round(p.x)},${round(p.y)}`; }).join(" ");
  const objects: any = plan.objects.filter((object: any) => object.layer === "production" || object.production?.equipmentType === "cable-route").sort((left: any, right: any) => left.id.localeCompare(right.id)).map((object: any, index: any) => {
    const center: any = point(centerOf(object.footprint));
    if (object.footprint.kind === "line") {
      const start: any = point(object.footprint.start);
      const end: any = point(object.footprint.end);
      return `<g data-object-id="${object.id}"><line x1="${round(start.x)}" y1="${round(start.y)}" x2="${round(end.x)}" y2="${round(end.y)}" stroke="#6f4ee8" stroke-width="4" stroke-dasharray="7 5"/><text x="${round(center.x + 8)}" y="${round(center.y - 7)}" font-size="10">${object.label}</text></g>`;
    }
    return `<g data-object-id="${object.id}"><circle cx="${round(center.x)}" cy="${round(center.y)}" r="10" fill="#6f4ee8"/><text x="${round(center.x)}" y="${round(center.y + 4)}" text-anchor="middle" fill="#fff" font-size="9" font-weight="700">${index + 1}</text><text x="${round(center.x + 14)}" y="${round(center.y + 4)}" font-size="10">${object.label}</text></g>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="1020" height="640" viewBox="0 0 1020 640" role="img" aria-label="Production plan"><rect width="1020" height="640" fill="#f8f7f3"/><text x="60" y="34" font-family="Inter,Arial" font-size="22" font-weight="700">${plan.event.name} · PRODUCTION</text><text x="960" y="34" text-anchor="end" font-family="Inter,Arial" font-size="11">${result.summary.status.toUpperCase()} · ${result.evidenceFingerprint}</text><polygon points="${room}" fill="#fff" stroke="#34352f" stroke-width="3"/>${objects}</svg>\n`;
}
