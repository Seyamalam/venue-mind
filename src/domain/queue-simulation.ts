import { stableFingerprint } from "./activity-ledger.ts";
import { validateConstraints } from "./constraint-engine.ts";
import { analyzeSpatialPlan } from "./spatial-analysis.ts";

export const QUEUE_CATEGORIES = Object.freeze(["registration", "security", "cloakroom", "food", "beverage", "restroom", "merchandise", "transport"]);

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const round: any = (value: any, precision: any = 3) => Number(Number(value).toFixed(precision));
const clamp: any = (value: any, minimum: any, maximum: any) => Math.min(maximum, Math.max(minimum, value));
const mean: any = (values: any) => values.reduce((sum: any, value: any) => sum + value, 0) / Math.max(1, values.length);
const percentile: any = (values: any, ratio: any) => {
  const sorted: any = values.slice().sort((left: any, right: any) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
};
const positive: any = (value: any, label: any) => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero`);
  return value;
};

export function normalizeQueueInputs(value: any, inputs: any) {
  const category: any = value?.category ?? "registration";
  if (!QUEUE_CATEGORIES.includes(category)) throw new Error("Unsupported queue category");
  const priorityLanes: any = (value?.priorityLanes ?? []).map((lane: any, index: any) => ({
    id: String(lane.id ?? `priority-${index + 1}`).trim(),
    label: String(lane.label ?? lane.id ?? `Priority ${index + 1}`),
    arrivalShare: round(positive(Number(lane.arrivalShare ?? .1), `priority-${index + 1}.arrivalShare`), 6),
    servers: Math.trunc(positive(Number(lane.servers ?? 1), `priority-${index + 1}.servers`)),
    serviceRatePerServerMinute: round(positive(Number(lane.serviceRatePerServerMinute ?? inputs.serviceRatePerMinute), `priority-${index + 1}.serviceRatePerServerMinute`), 6),
  }));
  if (new Set(priorityLanes.map((lane: any) => lane.id)).size !== priorityLanes.length) throw new Error("Priority lanes require unique stable IDs");
  const totalPriorityShare: any = priorityLanes.reduce((sum: any, lane: any) => sum + lane.arrivalShare, 0);
  if (totalPriorityShare >= 1) throw new Error("Priority lane arrival shares must total less than one");
  return {
    category,
    arrivalRatePerMinute: round(positive(Number(value?.arrivalRatePerMinute ?? inputs.arrivalRatePerMinute), "queue.arrivalRatePerMinute"), 6),
    serviceRatePerServerMinute: round(positive(Number(value?.serviceRatePerServerMinute ?? inputs.serviceRatePerMinute), "queue.serviceRatePerServerMinute"), 6),
    servers: Math.trunc(positive(Number(value?.servers ?? inputs.servers), "queue.servers")),
    abandonment: {
      enabled: value?.abandonment?.enabled !== false,
      meanPatienceSeconds: round(positive(Number(value?.abandonment?.meanPatienceSeconds ?? 480), "queue.meanPatienceSeconds"), 3),
    },
    priorityLanes,
    queueObjectId: value?.queueObjectId ? String(value.queueObjectId) : null,
    bufferAreaM2: Math.max(0, round(Number(value?.bufferAreaM2 ?? 0), 3)),
    personAreaM2: round(positive(Number(value?.personAreaM2 ?? .55), "queue.personAreaM2"), 3),
  };
}

const footprintCenter: any = (footprint: any) => {
  if (footprint?.center) return clone(footprint.center);
  if (footprint?.kind === "line") return { x: round((footprint.start.x + footprint.end.x) / 2), y: round((footprint.start.y + footprint.end.y) / 2) };
  return { x: 0, y: 0 };
};

const footprintArea: any = (footprint: any) => {
  if (footprint?.kind === "rectangle") return footprint.width * footprint.depth;
  if (footprint?.kind === "circle") return Math.PI * footprint.radius ** 2;
  if (footprint?.kind === "line") return Math.hypot(footprint.end.x - footprint.start.x, footprint.end.y - footprint.start.y) * footprint.width;
  return 0;
};

const footprintBounds: any = (footprint: any) => {
  if (footprint?.kind === "rectangle") return { minX: footprint.center.x - footprint.width / 2, maxX: footprint.center.x + footprint.width / 2, minY: footprint.center.y - footprint.depth / 2, maxY: footprint.center.y + footprint.depth / 2 };
  if (footprint?.kind === "circle") return { minX: footprint.center.x - footprint.radius, maxX: footprint.center.x + footprint.radius, minY: footprint.center.y - footprint.radius, maxY: footprint.center.y + footprint.radius };
  if (footprint?.kind === "line") return { minX: Math.min(footprint.start.x, footprint.end.x) - footprint.width / 2, maxX: Math.max(footprint.start.x, footprint.end.x) + footprint.width / 2, minY: Math.min(footprint.start.y, footprint.end.y) - footprint.width / 2, maxY: Math.max(footprint.start.y, footprint.end.y) + footprint.width / 2 };
  if (footprint?.kind === "polygon") return { minX: Math.min(...footprint.points.map((point: any) => point.x)), maxX: Math.max(...footprint.points.map((point: any) => point.x)), minY: Math.min(...footprint.points.map((point: any) => point.y)), maxY: Math.max(...footprint.points.map((point: any) => point.y)) };
  return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
};

const boundsOverlap: any = (left: any, right: any, margin: any = .12) => left.minX < right.maxX + margin && left.maxX > right.minX - margin && left.minY < right.maxY + margin && left.maxY > right.minY - margin;

const serviceObjectFor: any = (plan: any, queue: any) => {
  const explicit: any = plan.objects.find((object: any) => object.id === queue.queueObjectId);
  if (explicit) return explicit;
  const queueObject: any = plan.objects.find((object: any) => object.kind === "queue" && (!object.queue?.category || object.queue.category === queue.category));
  if (queueObject) return queueObject;
  const preferredKinds: any = ({
    food: ["refreshment"], beverage: ["refreshment"], restroom: ["accessible_restroom"], security: ["checkpoint"], registration: ["checkpoint", "table"], cloakroom: ["table"], merchandise: ["table"], transport: ["entrance", "accessible_entrance"],
  } as Record<string, string[]>)[queue.category] ?? [];
  return plan.objects.find((object: any) => preferredKinds.includes(object.kind)) ?? plan.objects.find((object: any) => object.kind === "refreshment") ?? plan.objects[0];
};

const spatialContext: any = (plan: any, queue: any) => {
  const analysis: any = analyzeSpatialPlan({ plan });
  const serviceObject: any = serviceObjectFor(plan, queue);
  const queueObjects: any = plan.objects.filter((object: any) => object.kind === "queue" || object.circulation?.role === "queue");
  const availableBufferAreaM2: any = queue.bufferAreaM2 || queueObjects.reduce((sum: any, object: any) => sum + footprintArea(object.footprint), 0);
  const servicePoint: any = footprintCenter(serviceObject.footprint);
  const routesByDistance: any = plan.objects.filter((object: any) => ["accessible_route", "corridor", "aisle", "service_lane"].includes(object.kind)).map((object: any) => ({ objectId: object.id, distanceM: round(Math.hypot(footprintCenter(object.footprint).x - servicePoint.x, footprintCenter(object.footprint).y - servicePoint.y), 2) })).sort((left: any, right: any) => left.distanceM - right.distanceM || left.objectId.localeCompare(right.objectId));
  const exitsByDistance: any = plan.objects.filter((object: any) => object.kind === "fire_exit").map((object: any) => ({ objectId: object.id, distanceM: round(Math.hypot(footprintCenter(object.footprint).x - servicePoint.x, footprintCenter(object.footprint).y - servicePoint.y), 2) })).sort((left: any, right: any) => left.distanceM - right.distanceM || left.objectId.localeCompare(right.objectId));
  return { analysis, serviceObject, servicePoint, queueObjectIds: queueObjects.map((object: any) => object.id).sort(), availableBufferAreaM2: round(availableBufferAreaM2, 3), routesByDistance, exitsByDistance };
};

const arrivalCount: any = (ratePerMinute: any, seconds: any, random: any) => {
  const expected: any = ratePerMinute * seconds / 60;
  const whole: any = Math.floor(expected);
  return whole + (random() < expected - whole ? 1 : 0);
};

const simulateSample: any = (scenario: any, queue: any, random: any) => {
  const stepSeconds: any = 5;
  const standardShare: any = 1 - queue.priorityLanes.reduce((sum: any, lane: any) => sum + lane.arrivalShare, 0);
  const lanes: any = [
    { id: "standard", arrivalShare: standardShare, servers: queue.servers, serviceRate: queue.serviceRatePerServerMinute, length: 0, served: 0, abandoned: 0, waitSamples: [], maxLength: 0 },
    ...queue.priorityLanes.map((lane: any) => ({ id: lane.id, arrivalShare: lane.arrivalShare, servers: lane.servers, serviceRate: lane.serviceRatePerServerMinute, length: 0, served: 0, abandoned: 0, waitSamples: [], maxLength: 0 })),
  ];
  const timeline: any[] = [];
  for (let second: any = 0; second <= scenario.horizonSeconds; second += stepSeconds) {
    let totalLength: any = 0;
    for (const lane of lanes) {
      lane.length += arrivalCount(queue.arrivalRatePerMinute * lane.arrivalShare * (0.88 + random() * .24), stepSeconds, random);
      const capacity: any = lane.serviceRate * lane.servers * stepSeconds / 60 * (0.9 + random() * .2);
      const served: any = Math.min(lane.length, capacity);
      const waitSeconds: any = lane.length / Math.max(.01, lane.serviceRate * lane.servers / 60);
      if (served > 0) lane.waitSamples.push(waitSeconds);
      lane.length -= served;
      lane.served += served;
      if (queue.abandonment.enabled && lane.length > 0) {
        const abandoned: any = lane.length * clamp(stepSeconds / queue.abandonment.meanPatienceSeconds, 0, .25);
        lane.length -= abandoned;
        lane.abandoned += abandoned;
      }
      lane.maxLength = Math.max(lane.maxLength, lane.length);
      totalLength += lane.length;
    }
    if (second % 30 === 0) timeline.push({ second, queueLength: round(totalLength, 1) });
  }
  const waits: any = lanes.flatMap((lane: any) => lane.waitSamples);
  return {
    averageWaitSeconds: mean(waits),
    p50WaitSeconds: percentile(waits, .5),
    p95WaitSeconds: percentile(waits, .95),
    maximumQueueLength: Math.max(0, ...lanes.map((lane: any) => lane.maxLength)),
    totalServed: lanes.reduce((sum: any, lane: any) => sum + lane.served, 0),
    totalAbandoned: lanes.reduce((sum: any, lane: any) => sum + lane.abandoned, 0),
    lanes,
    timeline,
  };
};

const suggestionFor: any = (scenario: any, plan: any, queue: any, spatial: any, summary: any, inputFingerprint: any) => {
  const targetWaitSeconds: any = 300;
  const requiredServers: any = Math.max(queue.servers, Math.ceil(queue.arrivalRatePerMinute / Math.max(.01, queue.serviceRatePerServerMinute * .82)));
  const recommendedServers: any = summary.p95WaitSeconds > targetWaitSeconds || summary.overflowRisk !== "low" ? Math.max(queue.servers + 1, requiredServers) : queue.servers;
  const recommendedBufferAreaM2: any = round(Math.max(spatial.availableBufferAreaM2, summary.maximumQueueLength * queue.personAreaM2 * (queue.servers / recommendedServers) * 1.2), 1);
  const boundary: any = plan.spatial.roomBoundary.outer;
  const minX: any = Math.min(...boundary.map((point: any) => point.x));
  const maxX: any = Math.max(...boundary.map((point: any) => point.x));
  const minY: any = Math.min(...boundary.map((point: any) => point.y));
  const maxY: any = Math.max(...boundary.map((point: any) => point.y));
  const width: any = clamp(Math.sqrt(Math.max(4, recommendedBufferAreaM2) * 2), 2, Math.max(2, maxX - minX - 1));
  const depth: any = clamp(Math.max(4, recommendedBufferAreaM2) / width, 1.5, Math.max(1.5, maxY - minY - 1));
  const occupied: any = plan.objects.map((object: any) => ({ id: object.id, bounds: footprintBounds(object.footprint) }));
  const candidateCenters: any[] = [];
  for (let y: any = minY + depth / 2 + .15; y <= maxY - depth / 2 - .15; y += .5) for (let x: any = minX + width / 2 + .15; x <= maxX - width / 2 - .15; x += .5) candidateCenters.push({ x: round(x), y: round(y) });
  candidateCenters.sort((left: any, right: any) => Math.hypot(left.x - spatial.servicePoint.x, left.y - spatial.servicePoint.y) - Math.hypot(right.x - spatial.servicePoint.x, right.y - spatial.servicePoint.y) || right.y - left.y || left.x - right.x);
  const unobstructedCandidates: any = candidateCenters.filter((candidate: any) => {
    const bounds: any = { minX: candidate.x - width / 2, maxX: candidate.x + width / 2, minY: candidate.y - depth / 2, maxY: candidate.y + depth / 2 };
    return occupied.every((object: any) => !boundsOverlap(bounds, object.bounds));
  });
  const fallbackCenter: any = { x: round(clamp(spatial.servicePoint.x, minX + width / 2 + .1, maxX - width / 2 - .1)), y: round(clamp(spatial.servicePoint.y, minY + depth / 2 + .1, maxY - depth / 2 - .1)) };
  const object: any = {
    id: `obj-queue-buffer-${inputFingerprint.slice(-8)}`,
    kind: "queue",
    label: `${queue.category} queue`,
    layer: "access",
    elevationM: 0,
    locked: false,
    circulation: { role: "queue", demandPersons: Math.ceil(summary.maximumQueueLength), capacityPersons: Math.max(1, Math.floor(recommendedBufferAreaM2 / queue.personAreaM2)) },
    queue: { category: queue.category, servers: recommendedServers, serviceRatePerServerMinute: queue.serviceRatePerServerMinute, priorityLaneCount: queue.priorityLanes.length },
    footprint: { kind: "rectangle", center: clone(unobstructedCandidates[0] ?? fallbackCenter), width: round(width), depth: round(depth), rotationDegrees: 0 },
  };
  const change: any = { id: `chg-queue-option-${inputFingerprint.slice(-8)}`, number: 1, title: `Add ${round(recommendedBufferAreaM2, 1)} m² queue buffer`, shortTitle: `Queue ${recommendedServers} S`, targetObjectIds: [], spatialEffects: [{ operation: "add_object", object }], metrics: [["Servers", `${queue.servers} → ${recommendedServers}`], ["Buffer", `${round(recommendedBufferAreaM2, 1)} m²`]] };
  const evaluateCandidate: any = () => {
    const candidateBounds: any = footprintBounds(object.footprint);
    const spatialOverlapObjectIds: any = occupied.filter((item: any) => boundsOverlap(candidateBounds, item.bounds)).map((item: any) => item.id).sort();
    try {
      const validation: any = validateConstraints({
        plan,
        brief: null,
        projectLocks: [],
        proposal: { id: `preflight-${change.id}`, revision: 1, status: "review", changes: [change], waivers: [] },
      });
      const evidence: any = validation.spatialEvidence;
      const routeRegressions: any = evidence.circulation.blockedRouteObjectIds.length + evidence.circulation.obstructedExitObjectIds.length + evidence.circulation.disconnectedOccupiedObjectIds.length;
      const blockingCheckIds: any = validation.checks.filter((check: any) => check.status === "fail" && check.severity === "error").map((check: any) => check.id).sort();
      return {
        status: validation.status === "pass" && spatialOverlapObjectIds.length === 0 ? "spatially-valid" : "blocked",
        validationId: validation.validationId,
        routeRegressions,
        spatialOverlapObjectIds,
        accessibleRouteConnected: evidence.accessibility.connected,
        obstructedDoorObjectIds: clone(evidence.accessibility.obstructedDoorObjectIds),
        blockingCheckIds,
        geometryFingerprint: evidence.circulation.graphFingerprint,
      };
    } catch (error: any) {
      return { status: "blocked", routeRegressions: 1, spatialOverlapObjectIds, accessibleRouteConnected: false, blockingCheckIds: [], error: error.message };
    }
  };
  let preflight: any = evaluateCandidate();
  for (const candidate of unobstructedCandidates.slice(1)) {
    if (preflight.status === "spatially-valid") break;
    object.footprint.center = clone(candidate);
    preflight = evaluateCandidate();
  }
  return { id: `queue-option-${inputFingerprint.slice(-8)}`, kind: "proposal-option", recommendedServers, recommendedBufferAreaM2, targetP95WaitSeconds: targetWaitSeconds, expectedP95WaitSeconds: round(summary.p95WaitSeconds * queue.servers / recommendedServers, 1), change, preflight, requiresHumanAction: true };
};

export function simulateQueue({ scenario, plan, branchId = null, inputFingerprint, scenarioFingerprint, engineVersion, random, sampleCount = scenario.sampleCount }: any) {
  const queue: any = scenario.queue;
  const spatial: any = spatialContext(plan, queue);
  const samples: any = Array.from({ length: sampleCount }, () => simulateSample(scenario, queue, random));
  const maximumQueueLength: any = round(percentile(samples.map((sample: any) => sample.maximumQueueLength), .95), 1);
  const requiredAreaM2: any = round(maximumQueueLength * queue.personAreaM2, 1);
  const overflowRatio: any = requiredAreaM2 / Math.max(1, spatial.availableBufferAreaM2);
  const overflowRisk: any = spatial.availableBufferAreaM2 <= 0 || overflowRatio >= 1.5 ? "critical" : overflowRatio >= 1 ? "high" : overflowRatio >= .75 ? "medium" : "low";
  const totalServed: any = mean(samples.map((sample: any) => sample.totalServed));
  const totalAbandoned: any = mean(samples.map((sample: any) => sample.totalAbandoned));
  const summary: any = {
    averageWaitSeconds: round(mean(samples.map((sample: any) => sample.averageWaitSeconds)), 1),
    p50WaitSeconds: round(percentile(samples.map((sample: any) => sample.p50WaitSeconds), .5), 1),
    p95WaitSeconds: round(percentile(samples.map((sample: any) => sample.p95WaitSeconds), .95), 1),
    maximumQueueLength,
    overflowRisk,
    overflowRatio: round(overflowRatio, 3),
    requiredBufferAreaM2: requiredAreaM2,
    availableBufferAreaM2: spatial.availableBufferAreaM2,
    abandonmentRate: round(totalAbandoned / Math.max(1, totalServed + totalAbandoned), 4),
    meanProcessedPersons: round(totalServed, 1),
    maximumP95BacklogPersons: maximumQueueLength,
    maximumP95Utilization: round(queue.arrivalRatePerMinute / Math.max(.01, queue.serviceRatePerServerMinute * queue.servers), 3),
  };
  const spill: any = overflowRisk === "low" ? { status: "contained", routeObjectIds: [], exitObjectIds: [] } : { status: "spill-risk", routeObjectIds: spatial.routesByDistance.slice(0, 2).map((item: any) => item.objectId), exitObjectIds: overflowRatio >= 1.5 ? spatial.exitsByDistance.slice(0, 1).map((item: any) => item.objectId) : [] };
  const laneIds: any = ["standard", ...queue.priorityLanes.map((lane: any) => lane.id)];
  const lanes: any = laneIds.map((laneId: any) => ({
    laneId,
    meanWaitSeconds: round(mean(samples.map((sample: any) => mean(sample.lanes.find((lane: any) => lane.id === laneId)?.waitSamples ?? []))), 1),
    p95WaitSeconds: round(percentile(samples.map((sample: any) => percentile(sample.lanes.find((lane: any) => lane.id === laneId)?.waitSamples ?? [], .95)), .95), 1),
    maximumQueueLength: round(percentile(samples.map((sample: any) => sample.lanes.find((lane: any) => lane.id === laneId)?.maxLength ?? 0), .95), 1),
  }));
  const timeline: any = samples[0]?.timeline.map((point: any, index: any) => ({ second: point.second, meanQueueLength: round(mean(samples.map((sample: any) => sample.timeline[index]?.queueLength ?? 0)), 1) })) ?? [];
  const result: any = {
    schemaVersion: 1,
    kind: "simulation-result",
    model: "queue",
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
    queue: { ...clone(queue), serviceObjectId: spatial.serviceObject.id, queueObjectIds: spatial.queueObjectIds },
    lanes,
    timeline,
    spill,
    summary,
  };
  result.suggestion = suggestionFor(scenario, plan, queue, spatial, summary, inputFingerprint);
  result.evidenceFingerprint = stableFingerprint("queue-evidence", { queue: result.queue, lanes, spill, summary, suggestion: result.suggestion });
  return result;
}

export const QUEUE_BENCHMARKS = Object.freeze(QUEUE_CATEGORIES.map((category: any, index: any) => ({
  id: `benchmark-queue-${category}`,
  scenario: { model: "queue", id: `benchmark-queue-${category}`, name: `${category} queue`, seed: 8100 + index, horizonSeconds: 900, sampleCount: 64, inputs: { population: 400, arrivalRatePerMinute: 18, serviceRatePerMinute: 7, servers: 3, mobilityFactor: 1 }, queue: { category, bufferAreaM2: 18, abandonment: { enabled: true, meanPatienceSeconds: 420 } } },
  expected: { p95WaitSeconds: { minimum: 0, maximum: 900 }, maximumQueueLength: { minimum: 0, maximum: 120 } },
})));
