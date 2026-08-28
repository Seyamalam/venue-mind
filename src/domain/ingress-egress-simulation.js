import { stableFingerprint } from "./activity-ledger.js";
import { analyzeSpatialPlan } from "./spatial-analysis.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value, precision = 3) => Number(Number(value).toFixed(precision));
const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const percentile = (values, ratio) => {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
};

const positive = (value, label) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero`);
  return value;
};

const footprintCenter = (footprint) => {
  if (footprint?.center) return clone(footprint.center);
  if (footprint?.kind === "line") return { x: round((footprint.start.x + footprint.end.x) / 2), y: round((footprint.start.y + footprint.end.y) / 2) };
  if (footprint?.kind === "polygon") return {
    x: round(mean(footprint.points.map((point) => point.x))),
    y: round(mean(footprint.points.map((point) => point.y))),
  };
  return { x: 0, y: 0 };
};

const footprintArea = (footprint) => {
  if (footprint?.kind === "rectangle") return footprint.width * footprint.depth;
  if (footprint?.kind === "circle") return Math.PI * footprint.radius ** 2;
  if (footprint?.kind === "line") return Math.hypot(footprint.end.x - footprint.start.x, footprint.end.y - footprint.start.y) * footprint.width;
  if (footprint?.kind === "polygon") return Math.abs(footprint.points.reduce((sum, point, index) => {
    const next = footprint.points[(index + 1) % footprint.points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2);
  return 1;
};

const normalizeCurve = (source, label, horizonSeconds, fallback) => {
  const values = source?.length ? source : fallback;
  const points = values.map((point, index) => ({
    second: round(Number(point.second)),
    cumulativeShare: round(Number(point.cumulativeShare), 6),
    _index: index,
  })).sort((left, right) => left.second - right.second || left._index - right._index);
  if (points.some((point) => !Number.isFinite(point.second) || !Number.isFinite(point.cumulativeShare))) throw new Error(`${label} curve values must be finite`);
  if (points.some((point) => point.second < 0 || point.second > horizonSeconds || point.cumulativeShare < 0 || point.cumulativeShare > 1)) throw new Error(`${label} curve must fit inside the Scenario horizon`);
  const withEnds = [
    ...(points[0]?.second === 0 ? [] : [{ second: 0, cumulativeShare: 0, _index: -1 }]),
    ...points,
    ...(points.at(-1)?.second === horizonSeconds ? [] : [{ second: horizonSeconds, cumulativeShare: 1, _index: points.length }]),
  ];
  let previousShare = -1;
  let previousSecond = -1;
  for (const point of withEnds) {
    if (point.second === previousSecond) throw new Error(`${label} curve requires unique time points`);
    if (point.cumulativeShare < previousShare) throw new Error(`${label} curve must be monotonic`);
    previousShare = point.cumulativeShare;
    previousSecond = point.second;
  }
  const finalShare = withEnds.at(-1)?.cumulativeShare ?? 0;
  if (finalShare <= 0) throw new Error(`${label} curve must end above zero`);
  return withEnds.map(({ _index, ...point }) => ({ ...point, cumulativeShare: round(point.cumulativeShare / finalShare, 6) }));
};

const timeAtShare = (curve, share) => {
  const target = clamp(share, 0, 1);
  for (let index = 1; index < curve.length; index += 1) {
    const left = curve[index - 1];
    const right = curve[index];
    if (right.cumulativeShare < target) continue;
    const shareSpan = right.cumulativeShare - left.cumulativeShare;
    if (shareSpan <= 0) return right.second;
    return left.second + ((target - left.cumulativeShare) / shareSpan) * (right.second - left.second);
  }
  return curve.at(-1)?.second ?? 0;
};

const peakCurveRate = (curve, population) => curve.slice(1).reduce((peak, point, index) => {
  const previous = curve[index];
  const seconds = point.second - previous.second;
  return seconds > 0 ? Math.max(peak, ((point.cumulativeShare - previous.cumulativeShare) * population * 60) / seconds) : peak;
}, 0);

const normalizeMobilityProfiles = (source) => {
  const profiles = source?.length ? source : [
    { id: "profile-standard", label: "Standard", share: 0.9, speedFactor: 1, accessibleRouteRequired: false },
    { id: "profile-access", label: "Access", share: 0.08, speedFactor: 0.68, accessibleRouteRequired: true },
    { id: "profile-fast", label: "Fast", share: 0.02, speedFactor: 1.12, accessibleRouteRequired: false },
  ];
  const ids = new Set();
  const normalized = profiles.map((profile, index) => {
    const id = String(profile.id ?? `profile-${index + 1}`).trim();
    if (!id || ids.has(id)) throw new Error("Mobility profiles require unique stable IDs");
    ids.add(id);
    return {
      id,
      label: String(profile.label ?? id),
      share: positive(Number(profile.share), `${id}.share`),
      speedFactor: positive(Number(profile.speedFactor ?? 1), `${id}.speedFactor`),
      accessibleRouteRequired: Boolean(profile.accessibleRouteRequired),
    };
  });
  const total = normalized.reduce((sum, profile) => sum + profile.share, 0);
  return normalized.map((profile) => ({ ...profile, share: round(profile.share / total, 6), speedFactor: round(profile.speedFactor, 4) }));
};

export function normalizeIngressEgressInputs(value, horizonSeconds) {
  const arrivalFallback = [
    { second: 0, cumulativeShare: 0 },
    { second: horizonSeconds * 0.15, cumulativeShare: 0.28 },
    { second: horizonSeconds * 0.5, cumulativeShare: 0.84 },
    { second: horizonSeconds, cumulativeShare: 1 },
  ];
  const departureFallback = [
    { second: 0, cumulativeShare: 0 },
    { second: horizonSeconds * 0.05, cumulativeShare: 0.18 },
    { second: horizonSeconds * 0.25, cumulativeShare: 0.86 },
    { second: horizonSeconds * 0.5, cumulativeShare: 1 },
    { second: horizonSeconds, cumulativeShare: 1 },
  ];
  const mode = value?.mode ?? "normal";
  if (!["normal", "emergency"].includes(mode)) throw new Error("Ingress/egress mode must be normal or emergency");
  return {
    mode,
    curves: {
      arrival: normalizeCurve(value?.curves?.arrival, "Arrival", horizonSeconds, arrivalFallback),
      departure: normalizeCurve(value?.curves?.departure, "Departure", horizonSeconds, departureFallback),
    },
    mobilityProfiles: normalizeMobilityProfiles(value?.mobilityProfiles),
    assumptions: {
      normal: {
        responseDelaySeconds: Math.max(0, Number(value?.assumptions?.normal?.responseDelaySeconds ?? 0)),
        flowFactor: positive(Number(value?.assumptions?.normal?.flowFactor ?? 1), "normal.flowFactor"),
        elevatorsAvailable: value?.assumptions?.normal?.elevatorsAvailable !== false,
      },
      emergency: {
        responseDelaySeconds: Math.max(0, Number(value?.assumptions?.emergency?.responseDelaySeconds ?? 45)),
        flowFactor: positive(Number(value?.assumptions?.emergency?.flowFactor ?? 0.92), "emergency.flowFactor"),
        elevatorsAvailable: Boolean(value?.assumptions?.emergency?.elevatorsAvailable),
      },
    },
  };
}

const infrastructureSnapshot = (plan) => {
  const analysis = analyzeSpatialPlan({ plan });
  const objects = new Map(plan.objects.map((object) => [object.id, object]));
  const capacitySections = new Map(analysis.evidence.capacity.sectionCapacities.map((section) => [section.objectId, section]));
  const sectionPolicies = new Map((plan.occupancy?.sections ?? []).map((section) => [section.objectId, section]));
  const routes = analysis.evidence.circulation.graphEdges.map((edge) => {
    const object = objects.get(edge.objectId);
    return { id: edge.objectId, kind: object?.kind ?? "corridor", label: object?.label ?? edge.objectId, widthM: round(edge.widthM), lengthM: round(edge.lengthM), accessible: object?.route?.accessible === true, blockedByObjectIds: clone(edge.blockedByObjectIds), point: footprintCenter(object?.footprint) };
  });
  const typed = (predicate, map) => plan.objects.filter(predicate).map(map).sort((left, right) => left.id.localeCompare(right.id));
  const entrances = typed((object) => ["entrance", "accessible_entrance"].includes(object.kind), (object) => ({ id: object.id, kind: object.kind, label: object.label, clearWidthM: object.entrance?.clearWidthM ?? object.footprint.width ?? 1.2, accessible: object.kind === "accessible_entrance" || object.accessibility?.accessible === true, point: footprintCenter(object.footprint) }));
  const exits = typed((object) => object.kind === "fire_exit", (object) => ({ id: object.id, kind: object.kind, label: object.label, clearWidthM: object.exit?.clearWidthM ?? object.footprint.width, ratedCapacityPersons: object.exit?.capacityPersons ?? null, emergency: object.exit?.emergency === true, point: footprintCenter(object.footprint) }));
  const doors = typed((object) => object.kind === "door", (object) => ({ id: object.id, kind: object.kind, label: object.label, clearWidthM: object.door?.clearWidthM ?? object.footprint.width, accessible: object.door?.accessible === true, point: footprintCenter(object.footprint) }));
  const checkpoints = typed((object) => object.kind === "checkpoint" || object.circulation?.role === "checkpoint", (object) => ({ id: object.id, kind: "checkpoint", label: object.label, capacityPersonsPerMinute: object.circulation?.capacityPersonsPerMinute ?? object.circulation?.capacityPersons ?? 30, servesZoneIds: clone(object.circulation?.servesZoneIds ?? []), point: footprintCenter(object.footprint) }));
  const stairs = typed((object) => ["stair", "stairs"].includes(object.kind), (object) => ({ id: object.id, kind: "stairs", label: object.label, clearWidthM: object.circulation?.clearWidthM ?? object.footprint.width ?? 1, accessible: false, servesZoneIds: clone(object.circulation?.servesZoneIds ?? []), point: footprintCenter(object.footprint) }));
  const elevators = typed((object) => object.kind === "elevator", (object) => ({ id: object.id, kind: "elevator", label: object.label, carCapacityPersons: object.circulation?.carCapacityPersons ?? 12, cycleSeconds: object.circulation?.cycleSeconds ?? 60, accessible: object.accessibility?.accessible !== false, servesZoneIds: clone(object.circulation?.servesZoneIds ?? []), point: footprintCenter(object.footprint) }));
  const sections = plan.objects.filter((object) => object.kind === "seating_section" && (capacitySections.get(object.id)?.capacity ?? object.capacity ?? 0) > 0).map((object) => {
    const path = analysis.evidence.circulation.shortestExitPaths.find((item) => item.occupiedObjectId === object.id) ?? null;
    const routeObjects = (path?.routeObjectIds ?? []).map((id) => routes.find((route) => route.id === id)).filter(Boolean);
    return {
      objectId: object.id,
      label: object.label,
      zoneId: sectionPolicies.get(object.id)?.zoneId ?? `zone-${object.id}`,
      capacity: capacitySections.get(object.id)?.capacity ?? object.capacity,
      accessibleSeats: object.accessibility?.accessibleSeats ?? 0,
      footprint: clone(object.footprint),
      point: footprintCenter(object.footprint),
      pathDistanceM: path?.distanceM ?? null,
      routeObjectIds: path?.routeObjectIds ?? [],
      pathAccessible: routeObjects.length > 0 && routeObjects.every((route) => route.accessible),
      disconnected: !path,
    };
  }).sort((left, right) => left.objectId.localeCompare(right.objectId));
  const snapshot = { entrances, exits, checkpoints, doors, stairs, elevators, corridors: routes, sections, graphFingerprint: analysis.evidence.circulation.graphFingerprint };
  return { ...snapshot, fingerprint: stableFingerprint("simulation-infrastructure", snapshot) };
};

const pathCapacity = (section, infrastructure, mode, assumptions) => {
  const routeById = new Map(infrastructure.corridors.map((route) => [route.id, route]));
  const components = section.routeObjectIds.map((id) => routeById.get(id)).filter(Boolean).map((route) => ({ id: route.id, kind: route.kind, accessible: route.accessible, capacityPersonsPerSecond: route.blockedByObjectIds.length ? 0 : route.widthM * 1.3 }));
  components.push(...infrastructure.exits.filter((exit) => mode !== "emergency" || exit.emergency).map((exit) => ({ id: exit.id, kind: "exit", accessible: true, capacityPersonsPerSecond: Math.min(exit.clearWidthM * 1.3, exit.ratedCapacityPersons ? exit.ratedCapacityPersons / 180 : Number.MAX_SAFE_INTEGER) })));
  if (mode === "normal") components.push(...infrastructure.doors.map((door) => ({ id: door.id, kind: "door", accessible: door.accessible, capacityPersonsPerSecond: door.clearWidthM * 1.3 })));
  const servesSection = (item) => !item.servesZoneIds?.length || item.servesZoneIds.includes(section.zoneId);
  const stairs = infrastructure.stairs.filter(servesSection);
  const elevators = assumptions.elevatorsAvailable ? infrastructure.elevators.filter(servesSection) : [];
  const vertical = [
    ...stairs.map((item) => ({ id: item.id, capacityPersonsPerSecond: item.clearWidthM * 0.9, accessible: false })),
    ...elevators.map((item) => ({ id: item.id, capacityPersonsPerSecond: item.carCapacityPersons / item.cycleSeconds, accessible: item.accessible })),
  ];
  if (vertical.length) {
    const accessible = vertical.some((item) => item.accessible);
    const primary = vertical.find((item) => item.accessible) ?? vertical[0];
    components.push({ id: primary.id, kind: "vertical", accessible, memberObjectIds: vertical.map((item) => item.id).sort(), capacityPersonsPerSecond: vertical.reduce((sum, item) => sum + item.capacityPersonsPerSecond, 0) });
  }
  if (mode === "normal") components.push(...infrastructure.checkpoints.filter(servesSection).map((checkpoint) => ({ id: checkpoint.id, kind: "checkpoint", accessible: true, capacityPersonsPerSecond: checkpoint.capacityPersonsPerMinute / 60 })));
  const traversable = components.filter((component) => component.capacityPersonsPerSecond > 0).sort((left, right) => left.capacityPersonsPerSecond - right.capacityPersonsPerSecond || left.id.localeCompare(right.id));
  return { components, bottleneck: traversable[0] ?? { id: "unavailable", kind: "route", accessible: false, capacityPersonsPerSecond: 0 } };
};

const simulateAssumption = ({ scenario, infrastructure, mode, random, sampleCount }) => {
  const assumptions = scenario.ingressEgress.assumptions[mode];
  const population = scenario.inputs.population;
  const totalSectionCapacity = infrastructure.sections.reduce((sum, section) => sum + section.capacity, 0) || 1;
  const release95Seconds = mode === "emergency" ? 0 : timeAtShare(scenario.ingressEgress.curves.departure, 0.95);
  const weightedSpeedFactor = scenario.ingressEgress.mobilityProfiles.reduce((sum, profile) => sum + profile.share * profile.speedFactor, 0);
  const accessibleProfileShare = scenario.ingressEgress.mobilityProfiles.filter((profile) => profile.accessibleRouteRequired).reduce((sum, profile) => sum + profile.share, 0);
  const sampleOutputs = [];
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const flowVariation = 0.9 + random() * 0.2;
    const speedVariation = 0.91 + random() * 0.18;
    const responseVariation = mode === "emergency" ? 0.88 + random() * 0.24 : 1;
    const zones = infrastructure.sections.map((section) => {
      const demandPersons = population * (section.capacity / totalSectionCapacity);
      const path = pathCapacity(section, infrastructure, mode, assumptions);
      const flowCapacity = path.bottleneck.capacityPersonsPerSecond * assumptions.flowFactor * flowVariation;
      const travelSeconds = section.pathDistanceM == null ? scenario.horizonSeconds : section.pathDistanceM / Math.max(0.2, 1.25 * weightedSpeedFactor * speedVariation);
      const queueSeconds = flowCapacity > 0 ? demandPersons / flowCapacity : scenario.horizonSeconds;
      const clearanceSeconds = Math.min(scenario.horizonSeconds * 2, assumptions.responseDelaySeconds * responseVariation + release95Seconds + travelSeconds + queueSeconds);
      const accessibleDemand = Math.max(section.accessibleSeats, demandPersons * accessibleProfileShare);
      const accessibleAvailable = section.pathAccessible && path.components.filter((component) => component.kind !== "stairs").every((component) => component.accessible !== false);
      const accessibleFlow = accessibleAvailable ? Math.max(0.01, flowCapacity * 0.72) : 0;
      const accessibleClearanceSeconds = accessibleAvailable ? assumptions.responseDelaySeconds * responseVariation + release95Seconds + (section.pathDistanceM ?? 0) / Math.max(0.2, 1.25 * 0.68 * speedVariation) + accessibleDemand / accessibleFlow : scenario.horizonSeconds * 2;
      return { section, demandPersons, path, travelSeconds, queueSeconds, clearanceSeconds, accessibleDemand, accessibleAvailable, accessibleClearanceSeconds };
    });
    sampleOutputs.push({ zones, totalClearanceSeconds: Math.max(0, ...zones.map((zone) => zone.clearanceSeconds)), accessibleClearanceSeconds: Math.max(0, ...zones.map((zone) => zone.accessibleClearanceSeconds)) });
  }
  const zoneResults = infrastructure.sections.map((section) => {
    const values = sampleOutputs.map((sample) => sample.zones.find((zone) => zone.section.objectId === section.objectId));
    return {
      zoneId: section.zoneId,
      objectId: section.objectId,
      label: section.label,
      occupancyPersons: round(mean(values.map((value) => value.demandPersons)), 1),
      meanClearanceSeconds: round(mean(values.map((value) => value.clearanceSeconds)), 1),
      p95ClearanceSeconds: round(percentile(values.map((value) => value.clearanceSeconds), 0.95), 1),
      meanAccessibleClearanceSeconds: round(mean(values.map((value) => value.accessibleClearanceSeconds)), 1),
      routeObjectIds: clone(section.routeObjectIds),
      status: section.disconnected ? "disconnected" : "served",
    };
  });
  const bottleneckCandidates = infrastructure.sections.map((section) => {
    const path = pathCapacity(section, infrastructure, mode, assumptions);
    const affected = population * (section.capacity / totalSectionCapacity);
    const zone = zoneResults.find((item) => item.objectId === section.objectId);
    const durationSeconds = Math.max(0, (zone?.p95ClearanceSeconds ?? 0) - (assumptions.responseDelaySeconds + release95Seconds));
    return { objectId: path.bottleneck.id, kind: path.bottleneck.kind, durationSeconds: round(durationSeconds, 1), affectedOccupancyPersons: round(affected, 1), capacityPersonsPerSecond: round(path.bottleneck.capacityPersonsPerSecond * assumptions.flowFactor, 3), loadRatio: round(affected / Math.max(1, path.bottleneck.capacityPersonsPerSecond * assumptions.flowFactor * Math.max(1, durationSeconds)), 3) };
  }).sort((left, right) => right.durationSeconds - left.durationSeconds || right.affectedOccupancyPersons - left.affectedOccupancyPersons || left.objectId.localeCompare(right.objectId));
  const accessibleRouteIds = [...new Set(infrastructure.sections.flatMap((section) => section.pathAccessible ? section.routeObjectIds : []))].sort();
  const accessibleAvailable = infrastructure.sections.every((section) => section.pathAccessible) && infrastructure.sections.length > 0;
  return {
    mode,
    sampleCount,
    totalClearanceSeconds: round(mean(sampleOutputs.map((sample) => sample.totalClearanceSeconds)), 1),
    p95ClearanceSeconds: round(percentile(sampleOutputs.map((sample) => sample.totalClearanceSeconds), 0.95), 1),
    zones: zoneResults,
    worstBottleneck: bottleneckCandidates[0] ?? null,
    bottlenecks: bottleneckCandidates,
    accessibleRoutePerformance: {
      status: accessibleAvailable ? "served" : "unavailable",
      servedPersons: round(population * accessibleProfileShare, 1),
      meanClearanceSeconds: round(mean(sampleOutputs.map((sample) => sample.accessibleClearanceSeconds)), 1),
      p95ClearanceSeconds: round(percentile(sampleOutputs.map((sample) => sample.accessibleClearanceSeconds), 0.95), 1),
      relativeDelayPercent: round(((mean(sampleOutputs.map((sample) => sample.accessibleClearanceSeconds)) / Math.max(1, mean(sampleOutputs.map((sample) => sample.totalClearanceSeconds))) - 1) * 100), 1),
      routeObjectIds: accessibleRouteIds,
    },
  };
};

const densityLevel = (density) => density >= 3 ? "critical" : density >= 1.5 ? "high" : density >= 0.5 ? "medium" : "low";

const densityFrames = (scenario, infrastructure, result) => {
  const clearance = Math.ceil(Math.max(1, result.p95ClearanceSeconds, ...result.zones.map((zone) => zone.p95ClearanceSeconds)));
  const seconds = [...new Set([0, .125, .25, .375, .5, .625, .75, .875, 1].map((ratio) => Math.round(clearance * ratio)))];
  return seconds.map((second, index) => {
    const progress = clamp(second / clearance, 0, 1);
    const sectionCells = infrastructure.sections.map((section) => {
      const zone = result.zones.find((item) => item.objectId === section.objectId);
      const remaining = Math.max(0, (zone?.occupancyPersons ?? 0) * (1 - clamp(second / Math.max(1, zone?.p95ClearanceSeconds ?? clearance), 0, 1)));
      const density = remaining / Math.max(1, footprintArea(section.footprint));
      return { id: `density-${section.objectId}`, objectId: section.objectId, kind: "zone", point: section.point, occupancyPersons: round(remaining, 1), densityPersonsPerM2: round(density, 3), level: densityLevel(density) };
    });
    const routeCells = infrastructure.corridors.map((route) => {
      const affected = result.bottlenecks.filter((bottleneck) => bottleneck.objectId === route.id).reduce((sum, bottleneck) => sum + bottleneck.affectedOccupancyPersons, 0);
      const activeShare = Math.sin(Math.PI * progress);
      const occupancy = (affected || scenario.inputs.population / Math.max(1, infrastructure.corridors.length)) * activeShare * 0.08;
      const density = occupancy / Math.max(1, route.widthM * route.lengthM);
      return { id: `density-${route.id}`, objectId: route.id, kind: "route", point: route.point, occupancyPersons: round(occupancy, 1), densityPersonsPerM2: round(density, 3), level: densityLevel(density) };
    });
    const cells = [...sectionCells, ...routeCells].sort((left, right) => left.id.localeCompare(right.id));
    return { id: `density-frame-${index + 1}`, second, progress: round(progress, 3), cells, peakDensityPersonsPerM2: round(Math.max(0, ...cells.map((cell) => cell.densityPersonsPerM2)), 3) };
  });
};

const simulateIngress = (scenario, infrastructure) => {
  const components = [
    ...infrastructure.entrances.map((entrance) => ({ objectId: entrance.id, kind: "entrance", capacityPersonsPerSecond: (entrance.clearWidthM ?? 1.2) * 1.3 })),
    ...infrastructure.doors.map((door) => ({ objectId: door.id, kind: "door", capacityPersonsPerSecond: door.clearWidthM * 1.3 })),
    ...infrastructure.checkpoints.map((checkpoint) => ({ objectId: checkpoint.id, kind: "checkpoint", capacityPersonsPerSecond: checkpoint.capacityPersonsPerMinute / 60 })),
    ...infrastructure.corridors.filter((route) => route.kind === "corridor" || route.id.includes("main")).map((route) => ({ objectId: route.id, kind: route.kind, capacityPersonsPerSecond: route.blockedByObjectIds.length ? 0 : route.widthM * 1.3 })),
  ].sort((left, right) => left.capacityPersonsPerSecond - right.capacityPersonsPerSecond || left.objectId.localeCompare(right.objectId));
  const bottleneck = components.find((component) => component.capacityPersonsPerSecond > 0) ?? { objectId: "unavailable", kind: "entrance", capacityPersonsPerSecond: 0 };
  const capacityPersonsPerSecond = bottleneck.capacityPersonsPerSecond;
  let backlogPersons = 0;
  let peakBacklogPersons = 0;
  let previous = scenario.ingressEgress.curves.arrival[0];
  for (const point of scenario.ingressEgress.curves.arrival.slice(1)) {
    const durationSeconds = point.second - previous.second;
    const arrivals = (point.cumulativeShare - previous.cumulativeShare) * scenario.inputs.population;
    backlogPersons = Math.max(0, backlogPersons + arrivals - capacityPersonsPerSecond * durationSeconds);
    peakBacklogPersons = Math.max(peakBacklogPersons, backlogPersons);
    previous = point;
  }
  const curveEndSecond = timeAtShare(scenario.ingressEgress.curves.arrival, 1);
  const totalAdmissionSeconds = capacityPersonsPerSecond > 0 ? curveEndSecond + backlogPersons / capacityPersonsPerSecond : scenario.horizonSeconds * 2;
  return {
    peakArrivalRatePerMinute: round(peakCurveRate(scenario.ingressEgress.curves.arrival, scenario.inputs.population), 1),
    p95ArrivalSecond: round(timeAtShare(scenario.ingressEgress.curves.arrival, 0.95), 1),
    totalAdmissionSeconds: round(totalAdmissionSeconds, 1),
    p95AdmissionSeconds: round(Math.max(timeAtShare(scenario.ingressEgress.curves.arrival, 0.95), totalAdmissionSeconds - (scenario.inputs.population * .05) / Math.max(.01, capacityPersonsPerSecond)), 1),
    peakBacklogPersons: round(peakBacklogPersons, 1),
    worstBottleneck: { ...bottleneck, capacityPersonsPerMinute: round(capacityPersonsPerSecond * 60, 1) },
    entranceObjectIds: infrastructure.entrances.map((entrance) => entrance.id),
    checkpointObjectIds: infrastructure.checkpoints.map((checkpoint) => checkpoint.id),
  };
};

export function simulateIngressEgress({ scenario, plan, branchId = null, inputFingerprint, scenarioFingerprint, engineVersion, random, sampleCount = scenario.sampleCount }) {
  const infrastructure = infrastructureSnapshot(plan);
  const normal = simulateAssumption({ scenario, infrastructure, mode: "normal", random, sampleCount });
  const emergency = simulateAssumption({ scenario, infrastructure, mode: "emergency", random, sampleCount });
  const active = scenario.ingressEgress.mode === "emergency" ? emergency : normal;
  const result = {
    schemaVersion: 1,
    kind: "simulation-result",
    model: "ingress-egress",
    engineVersion,
    inputFingerprint,
    scenarioFingerprint,
    scenarioId: scenario.id,
    planId: plan.id,
    planVersion: plan.version,
    geometryFingerprint: plan.spatial.fingerprint,
    branchId,
    seed: scenario.seed,
    horizonSeconds: scenario.horizonSeconds,
    sampleCount: scenario.sampleCount,
    completedSamples: sampleCount,
    confidence: clone(scenario.confidence),
    phases: clone(scenario.phases),
    infrastructure,
    ingress: simulateIngress(scenario, infrastructure),
    egress: active,
    assumptions: { normal, emergency },
    assumptionComparison: {
      emergencyMinusNormalClearanceSeconds: round(emergency.p95ClearanceSeconds - normal.p95ClearanceSeconds, 1),
      emergencyMinusNormalAccessibleSeconds: round(emergency.accessibleRoutePerformance.p95ClearanceSeconds - normal.accessibleRoutePerformance.p95ClearanceSeconds, 1),
    },
    densityFrames: densityFrames(scenario, infrastructure, active),
    summary: {
      totalClearanceSeconds: active.totalClearanceSeconds,
      p95ClearanceSeconds: active.p95ClearanceSeconds,
      worstBottleneckDurationSeconds: active.worstBottleneck?.durationSeconds ?? 0,
      worstBottleneckObjectId: active.worstBottleneck?.objectId ?? null,
      affectedOccupancyPersons: active.worstBottleneck?.affectedOccupancyPersons ?? 0,
      accessibleRouteClearanceSeconds: active.accessibleRoutePerformance.p95ClearanceSeconds,
      accessibleRouteStatus: active.accessibleRoutePerformance.status,
      meanProcessedPersons: scenario.inputs.population,
      maximumP95BacklogPersons: round(Math.max(0, active.worstBottleneck?.affectedOccupancyPersons ?? 0), 1),
      maximumP95Utilization: round(active.worstBottleneck?.loadRatio ?? 0, 3),
    },
  };
  return result;
}

export const INGRESS_EGRESS_BENCHMARKS = Object.freeze([
  {
    id: "benchmark-summit-normal",
    label: "Summit normal",
    scenario: { model: "ingress-egress", id: "benchmark-summit-normal", name: "Summit normal", seed: 73421, horizonSeconds: 1800, sampleCount: 128, inputs: { population: 400, arrivalRatePerMinute: 40, serviceRatePerMinute: 30, servers: 2, mobilityFactor: 1 }, ingressEgress: { mode: "normal" } },
    expected: { p95ClearanceSeconds: { minimum: 200, maximum: 1500 }, accessibleRouteStatus: "served" },
  },
  {
    id: "benchmark-summit-emergency",
    label: "Summit emergency",
    scenario: { model: "ingress-egress", id: "benchmark-summit-emergency", name: "Summit emergency", seed: 73421, horizonSeconds: 1800, sampleCount: 128, inputs: { population: 400, arrivalRatePerMinute: 40, serviceRatePerMinute: 30, servers: 2, mobilityFactor: 1 }, ingressEgress: { mode: "emergency" } },
    expected: { p95ClearanceSeconds: { minimum: 150, maximum: 1200 }, accessibleRouteStatus: "served" },
  },
]);
