import { stableFingerprint } from "./activity-ledger.ts";
import { validateConstraints } from "./constraint-engine.ts";
import { analyzeSpatialPlan } from "./spatial-analysis.ts";
import type { Footprint, Point, VenueObject, VenuePlan } from "./geometry.ts";
import type { PlanningChange } from "./planning-effects.ts";

export const QUEUE_CATEGORIES = Object.freeze([
  "registration",
  "security",
  "cloakroom",
  "food",
  "beverage",
  "restroom",
  "merchandise",
  "transport",
] as const);
export type QueueCategory = (typeof QUEUE_CATEGORIES)[number];
export interface ScenarioInputs {
  population: number;
  arrivalRatePerMinute: number;
  serviceRatePerMinute: number;
  servers: number;
  mobilityFactor: number;
}
interface PriorityLaneInput {
  id?: string;
  label?: string;
  arrivalShare?: number;
  servers?: number;
  serviceRatePerServerMinute?: number;
}
export interface QueueInput {
  category?: QueueCategory;
  priorityLanes?: PriorityLaneInput[];
  arrivalRatePerMinute?: number;
  serviceRatePerServerMinute?: number;
  servers?: number;
  abandonment?: { enabled?: boolean; meanPatienceSeconds?: number };
  queueObjectId?: string;
  bufferAreaM2?: number;
  personAreaM2?: number;
}
const isQueueInput = (value: unknown): value is QueueInput | null | undefined =>
  value == null || (typeof value === "object" && !Array.isArray(value));

const clone = <T>(value: T): T => structuredClone(value);
const round = (value: number, precision = 3): number => Number(value.toFixed(precision));
const clamp = (value: number, minimum: number, maximum: number): number => Math.min(maximum, Math.max(minimum, value));
const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
const percentile = (values: readonly number[], ratio: number): number => {
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))] ?? 0;
};
const positive = (value: number, label: string): number => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be greater than zero`);
  return value;
};

export function normalizeQueueInputs(input: unknown, inputs: ScenarioInputs) {
  if (!isQueueInput(input)) throw new Error("Queue input must be an object");
  const value = input;
  const category = value?.category ?? "registration";
  if (!QUEUE_CATEGORIES.includes(category)) throw new Error("Unsupported queue category");
  const priorityLanes = (value?.priorityLanes ?? []).map((lane, index) => ({
    id: String(lane.id ?? `priority-${index + 1}`).trim(),
    label: String(lane.label ?? lane.id ?? `Priority ${index + 1}`),
    arrivalShare: round(positive(Number(lane.arrivalShare ?? 0.1), `priority-${index + 1}.arrivalShare`), 6),
    servers: Math.trunc(positive(Number(lane.servers ?? 1), `priority-${index + 1}.servers`)),
    serviceRatePerServerMinute: round(
      positive(
        Number(lane.serviceRatePerServerMinute ?? inputs.serviceRatePerMinute),
        `priority-${index + 1}.serviceRatePerServerMinute`,
      ),
      6,
    ),
  }));
  if (new Set(priorityLanes.map((lane) => lane.id)).size !== priorityLanes.length)
    throw new Error("Priority lanes require unique stable IDs");
  const totalPriorityShare = priorityLanes.reduce((sum, lane) => sum + lane.arrivalShare, 0);
  if (totalPriorityShare >= 1) throw new Error("Priority lane arrival shares must total less than one");
  return {
    category,
    arrivalRatePerMinute: round(
      positive(Number(value?.arrivalRatePerMinute ?? inputs.arrivalRatePerMinute), "queue.arrivalRatePerMinute"),
      6,
    ),
    serviceRatePerServerMinute: round(
      positive(
        Number(value?.serviceRatePerServerMinute ?? inputs.serviceRatePerMinute),
        "queue.serviceRatePerServerMinute",
      ),
      6,
    ),
    servers: Math.trunc(positive(Number(value?.servers ?? inputs.servers), "queue.servers")),
    abandonment: {
      enabled: value?.abandonment?.enabled !== false,
      meanPatienceSeconds: round(
        positive(Number(value?.abandonment?.meanPatienceSeconds ?? 480), "queue.meanPatienceSeconds"),
        3,
      ),
    },
    priorityLanes,
    queueObjectId: value?.queueObjectId ? String(value.queueObjectId) : null,
    bufferAreaM2: Math.max(0, round(Number(value?.bufferAreaM2 ?? 0), 3)),
    personAreaM2: round(positive(Number(value?.personAreaM2 ?? 0.55), "queue.personAreaM2"), 3),
  };
}

const footprintCenter = (footprint: Footprint): Point => {
  if (footprint.kind === "rectangle" || footprint.kind === "circle") return clone(footprint.center);
  if (footprint.kind === "line")
    return { x: round((footprint.start.x + footprint.end.x) / 2), y: round((footprint.start.y + footprint.end.y) / 2) };
  return { x: 0, y: 0 };
};

const footprintArea = (footprint: Footprint): number => {
  if (footprint?.kind === "rectangle") return footprint.width * footprint.depth;
  if (footprint?.kind === "circle") return Math.PI * footprint.radius ** 2;
  if (footprint?.kind === "line")
    return Math.hypot(footprint.end.x - footprint.start.x, footprint.end.y - footprint.start.y) * footprint.width;
  return 0;
};

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
const footprintBounds = (footprint: Footprint): Bounds => {
  if (footprint?.kind === "rectangle")
    return {
      minX: footprint.center.x - footprint.width / 2,
      maxX: footprint.center.x + footprint.width / 2,
      minY: footprint.center.y - footprint.depth / 2,
      maxY: footprint.center.y + footprint.depth / 2,
    };
  if (footprint?.kind === "circle")
    return {
      minX: footprint.center.x - footprint.radius,
      maxX: footprint.center.x + footprint.radius,
      minY: footprint.center.y - footprint.radius,
      maxY: footprint.center.y + footprint.radius,
    };
  if (footprint?.kind === "line")
    return {
      minX: Math.min(footprint.start.x, footprint.end.x) - footprint.width / 2,
      maxX: Math.max(footprint.start.x, footprint.end.x) + footprint.width / 2,
      minY: Math.min(footprint.start.y, footprint.end.y) - footprint.width / 2,
      maxY: Math.max(footprint.start.y, footprint.end.y) + footprint.width / 2,
    };
  if (footprint?.kind === "polygon")
    return {
      minX: Math.min(...footprint.points.map((point) => point.x)),
      maxX: Math.max(...footprint.points.map((point) => point.x)),
      minY: Math.min(...footprint.points.map((point) => point.y)),
      maxY: Math.max(...footprint.points.map((point) => point.y)),
    };
  return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
};

const boundsOverlap = (left: Bounds, right: Bounds, margin = 0.12): boolean =>
  left.minX < right.maxX + margin &&
  left.maxX > right.minX - margin &&
  left.minY < right.maxY + margin &&
  left.maxY > right.minY - margin;

type QueueConfiguration = ReturnType<typeof normalizeQueueInputs>;
const serviceObjectFor = (plan: VenuePlan, queue: QueueConfiguration): VenueObject => {
  const explicit = plan.objects.find((object) => object.id === queue.queueObjectId);
  if (explicit) return explicit;
  const queueObject = plan.objects.find(
    (object) => object.kind === "queue" && (!object.queue?.category || object.queue.category === queue.category),
  );
  if (queueObject) return queueObject;
  const preferredKindsByCategory: Record<string, string[]> = {
    food: ["refreshment"],
    beverage: ["refreshment"],
    restroom: ["accessible_restroom"],
    security: ["checkpoint"],
    registration: ["checkpoint", "table"],
    cloakroom: ["table"],
    merchandise: ["table"],
    transport: ["entrance", "accessible_entrance"],
  };
  const preferredKinds = preferredKindsByCategory[queue.category] ?? [];
  const fallback =
    plan.objects.find((object) => preferredKinds.includes(object.kind)) ??
    plan.objects.find((object) => object.kind === "refreshment") ??
    plan.objects[0];
  if (!fallback) throw new Error("Queue simulation requires a service object");
  return fallback;
};

const spatialContext = (plan: VenuePlan, queue: QueueConfiguration) => {
  const analysis = analyzeSpatialPlan({ plan });
  const serviceObject = serviceObjectFor(plan, queue);
  const queueObjects = plan.objects.filter((object) => object.kind === "queue" || object.circulation?.role === "queue");
  const availableBufferAreaM2 =
    queue.bufferAreaM2 || queueObjects.reduce((sum, object) => sum + footprintArea(object.footprint), 0);
  const servicePoint = footprintCenter(serviceObject.footprint);
  const routesByDistance = plan.objects
    .filter((object) => ["accessible_route", "corridor", "aisle", "service_lane"].includes(object.kind))
    .map((object) => ({
      objectId: object.id,
      distanceM: round(
        Math.hypot(
          footprintCenter(object.footprint).x - servicePoint.x,
          footprintCenter(object.footprint).y - servicePoint.y,
        ),
        2,
      ),
    }))
    .sort((left, right) => left.distanceM - right.distanceM || left.objectId.localeCompare(right.objectId));
  const exitsByDistance = plan.objects
    .filter((object) => object.kind === "fire_exit")
    .map((object) => ({
      objectId: object.id,
      distanceM: round(
        Math.hypot(
          footprintCenter(object.footprint).x - servicePoint.x,
          footprintCenter(object.footprint).y - servicePoint.y,
        ),
        2,
      ),
    }))
    .sort((left, right) => left.distanceM - right.distanceM || left.objectId.localeCompare(right.objectId));
  return {
    analysis,
    serviceObject,
    servicePoint,
    queueObjectIds: queueObjects.map((object) => object.id).sort(),
    availableBufferAreaM2: round(availableBufferAreaM2, 3),
    routesByDistance,
    exitsByDistance,
  };
};

const arrivalCount = (ratePerMinute: number, seconds: number, random: () => number): number => {
  const expected = (ratePerMinute * seconds) / 60;
  const whole = Math.floor(expected);
  return whole + (random() < expected - whole ? 1 : 0);
};

interface QueueScenario {
  id: string;
  seed: number;
  horizonSeconds: number;
  sampleCount: number;
  inputs: ScenarioInputs;
  confidence: object;
  phases: object[];
  queue: QueueConfiguration;
}
const simulateSample = (scenario: QueueScenario, queue: QueueConfiguration, random: () => number) => {
  const stepSeconds = 5;
  const standardShare = 1 - queue.priorityLanes.reduce((sum, lane) => sum + lane.arrivalShare, 0);
  const lanes: Array<{
    id: string;
    arrivalShare: number;
    servers: number;
    serviceRate: number;
    length: number;
    served: number;
    abandoned: number;
    waitSamples: number[];
    maxLength: number;
  }> = [
    {
      id: "standard",
      arrivalShare: standardShare,
      servers: queue.servers,
      serviceRate: queue.serviceRatePerServerMinute,
      length: 0,
      served: 0,
      abandoned: 0,
      waitSamples: [],
      maxLength: 0,
    },
    ...queue.priorityLanes.map((lane) => ({
      id: lane.id,
      arrivalShare: lane.arrivalShare,
      servers: lane.servers,
      serviceRate: lane.serviceRatePerServerMinute,
      length: 0,
      served: 0,
      abandoned: 0,
      waitSamples: [],
      maxLength: 0,
    })),
  ];
  const timeline = [];
  for (let second = 0; second <= scenario.horizonSeconds; second += stepSeconds) {
    let totalLength = 0;
    for (const lane of lanes) {
      lane.length += arrivalCount(
        queue.arrivalRatePerMinute * lane.arrivalShare * (0.88 + random() * 0.24),
        stepSeconds,
        random,
      );
      const capacity = ((lane.serviceRate * lane.servers * stepSeconds) / 60) * (0.9 + random() * 0.2);
      const served = Math.min(lane.length, capacity);
      const waitSeconds = lane.length / Math.max(0.01, (lane.serviceRate * lane.servers) / 60);
      if (served > 0) lane.waitSamples.push(waitSeconds);
      lane.length -= served;
      lane.served += served;
      if (queue.abandonment.enabled && lane.length > 0) {
        const abandoned = lane.length * clamp(stepSeconds / queue.abandonment.meanPatienceSeconds, 0, 0.25);
        lane.length -= abandoned;
        lane.abandoned += abandoned;
      }
      lane.maxLength = Math.max(lane.maxLength, lane.length);
      totalLength += lane.length;
    }
    if (second % 30 === 0) timeline.push({ second, queueLength: round(totalLength, 1) });
  }
  const waits = lanes.flatMap((lane) => lane.waitSamples);
  return {
    averageWaitSeconds: mean(waits),
    p50WaitSeconds: percentile(waits, 0.5),
    p95WaitSeconds: percentile(waits, 0.95),
    maximumQueueLength: Math.max(0, ...lanes.map((lane) => lane.maxLength)),
    totalServed: lanes.reduce((sum, lane) => sum + lane.served, 0),
    totalAbandoned: lanes.reduce((sum, lane) => sum + lane.abandoned, 0),
    lanes,
    timeline,
  };
};

interface QueueSummary {
  p95WaitSeconds: number;
  overflowRisk: string;
  maximumQueueLength: number;
}
const suggestionFor = (
  _scenario: QueueScenario,
  plan: VenuePlan,
  queue: QueueConfiguration,
  spatial: ReturnType<typeof spatialContext>,
  summary: QueueSummary,
  inputFingerprint: string,
) => {
  const targetWaitSeconds = 300;
  const requiredServers = Math.max(
    queue.servers,
    Math.ceil(queue.arrivalRatePerMinute / Math.max(0.01, queue.serviceRatePerServerMinute * 0.82)),
  );
  const recommendedServers =
    summary.p95WaitSeconds > targetWaitSeconds || summary.overflowRisk !== "low"
      ? Math.max(queue.servers + 1, requiredServers)
      : queue.servers;
  const recommendedBufferAreaM2 = round(
    Math.max(
      spatial.availableBufferAreaM2,
      summary.maximumQueueLength * queue.personAreaM2 * (queue.servers / recommendedServers) * 1.2,
    ),
    1,
  );
  const boundary = plan.spatial.roomBoundary.outer;
  const minX = Math.min(...boundary.map((point) => point.x));
  const maxX = Math.max(...boundary.map((point) => point.x));
  const minY = Math.min(...boundary.map((point) => point.y));
  const maxY = Math.max(...boundary.map((point) => point.y));
  const width = clamp(Math.sqrt(Math.max(4, recommendedBufferAreaM2) * 2), 2, Math.max(2, maxX - minX - 1));
  const depth = clamp(Math.max(4, recommendedBufferAreaM2) / width, 1.5, Math.max(1.5, maxY - minY - 1));
  const occupied = plan.objects.map((object) => ({ id: object.id, bounds: footprintBounds(object.footprint) }));
  const candidateCenters = [];
  for (let y = minY + depth / 2 + 0.15; y <= maxY - depth / 2 - 0.15; y += 0.5)
    for (let x = minX + width / 2 + 0.15; x <= maxX - width / 2 - 0.15; x += 0.5)
      candidateCenters.push({ x: round(x), y: round(y) });
  candidateCenters.sort(
    (left, right) =>
      Math.hypot(left.x - spatial.servicePoint.x, left.y - spatial.servicePoint.y) -
        Math.hypot(right.x - spatial.servicePoint.x, right.y - spatial.servicePoint.y) ||
      right.y - left.y ||
      left.x - right.x,
  );
  const unobstructedCandidates = candidateCenters.filter((candidate) => {
    const bounds = {
      minX: candidate.x - width / 2,
      maxX: candidate.x + width / 2,
      minY: candidate.y - depth / 2,
      maxY: candidate.y + depth / 2,
    };
    return occupied.every((object) => !boundsOverlap(bounds, object.bounds));
  });
  const fallbackCenter = {
    x: round(clamp(spatial.servicePoint.x, minX + width / 2 + 0.1, maxX - width / 2 - 0.1)),
    y: round(clamp(spatial.servicePoint.y, minY + depth / 2 + 0.1, maxY - depth / 2 - 0.1)),
  };
  const object: VenueObject = {
    id: `obj-queue-buffer-${inputFingerprint.slice(-8)}`,
    kind: "queue",
    label: `${queue.category} queue`,
    layer: "access",
    elevationM: 0,
    locked: false,
    circulation: {
      role: "queue",
      demandPersons: Math.ceil(summary.maximumQueueLength),
      capacityPersons: Math.max(1, Math.floor(recommendedBufferAreaM2 / queue.personAreaM2)),
    },
    queue: {
      category: queue.category,
      servers: recommendedServers,
      serviceRatePerServerMinute: queue.serviceRatePerServerMinute,
      priorityLaneCount: queue.priorityLanes.length,
    },
    footprint: {
      kind: "rectangle",
      center: clone(unobstructedCandidates[0] ?? fallbackCenter),
      width: round(width),
      depth: round(depth),
      rotationDegrees: 0,
    },
  };
  const change: PlanningChange = {
    id: `chg-queue-option-${inputFingerprint.slice(-8)}`,
    number: 1,
    title: `Add ${round(recommendedBufferAreaM2, 1)} m² queue buffer`,
    shortTitle: `Queue ${recommendedServers} S`,
    targetObjectIds: [],
    spatialEffects: [{ operation: "add_object", object }],
    metrics: [
      ["Servers", `${queue.servers} → ${recommendedServers}`],
      ["Buffer", `${round(recommendedBufferAreaM2, 1)} m²`],
    ],
  };
  const evaluateCandidate = () => {
    const candidateBounds = footprintBounds(object.footprint);
    const spatialOverlapObjectIds = occupied
      .filter((item) => boundsOverlap(candidateBounds, item.bounds))
      .map((item) => item.id)
      .sort();
    try {
      const validation = validateConstraints({
        plan,
        brief: null,
        projectLocks: [],
        proposal: {
          id: `preflight-${change.id}`,
          baseVersion: plan.version,
          revision: 1,
          status: "review",
          goal: "Queue preflight",
          changes: [change],
          validation: null,
          waivers: [],
        },
      });
      const evidence = validation.spatialEvidence;
      const routeRegressions =
        evidence.circulation.blockedRouteObjectIds.length +
        evidence.circulation.obstructedExitObjectIds.length +
        evidence.circulation.disconnectedOccupiedObjectIds.length;
      const blockingCheckIds = validation.checks
        .filter((check) => check.status === "fail" && check.severity === "error")
        .map((check) => check.id)
        .sort();
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
    } catch (error) {
      return {
        status: "blocked",
        routeRegressions: 1,
        spatialOverlapObjectIds,
        accessibleRouteConnected: false,
        blockingCheckIds: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  };
  let preflight = evaluateCandidate();
  for (const candidate of unobstructedCandidates.slice(1)) {
    if (preflight.status === "spatially-valid") break;
    if (object.footprint.kind === "rectangle") object.footprint.center = clone(candidate);
    preflight = evaluateCandidate();
  }
  return {
    id: `queue-option-${inputFingerprint.slice(-8)}`,
    kind: "proposal-option",
    recommendedServers,
    recommendedBufferAreaM2,
    targetP95WaitSeconds: targetWaitSeconds,
    expectedP95WaitSeconds: round((summary.p95WaitSeconds * queue.servers) / recommendedServers, 1),
    change,
    preflight,
    requiresHumanAction: true,
  };
};

interface QueueSimulationInput {
  scenario: QueueScenario;
  plan: VenuePlan;
  branchId?: string | null;
  inputFingerprint: string;
  scenarioFingerprint: string;
  engineVersion: string;
  random: () => number;
  sampleCount?: number;
}
export function simulateQueue({
  scenario,
  plan,
  branchId = null,
  inputFingerprint,
  scenarioFingerprint,
  engineVersion,
  random,
  sampleCount = scenario.sampleCount,
}: QueueSimulationInput) {
  const queue = scenario.queue;
  const spatial = spatialContext(plan, queue);
  const samples = Array.from({ length: sampleCount }, () => simulateSample(scenario, queue, random));
  const maximumQueueLength = round(
    percentile(
      samples.map((sample) => sample.maximumQueueLength),
      0.95,
    ),
    1,
  );
  const requiredAreaM2 = round(maximumQueueLength * queue.personAreaM2, 1);
  const overflowRatio = requiredAreaM2 / Math.max(1, spatial.availableBufferAreaM2);
  const overflowRisk =
    spatial.availableBufferAreaM2 <= 0 || overflowRatio >= 1.5
      ? "critical"
      : overflowRatio >= 1
        ? "high"
        : overflowRatio >= 0.75
          ? "medium"
          : "low";
  const totalServed = mean(samples.map((sample) => sample.totalServed));
  const totalAbandoned = mean(samples.map((sample) => sample.totalAbandoned));
  const summary = {
    averageWaitSeconds: round(mean(samples.map((sample) => sample.averageWaitSeconds)), 1),
    p50WaitSeconds: round(
      percentile(
        samples.map((sample) => sample.p50WaitSeconds),
        0.5,
      ),
      1,
    ),
    p95WaitSeconds: round(
      percentile(
        samples.map((sample) => sample.p95WaitSeconds),
        0.95,
      ),
      1,
    ),
    maximumQueueLength,
    overflowRisk,
    overflowRatio: round(overflowRatio, 3),
    requiredBufferAreaM2: requiredAreaM2,
    availableBufferAreaM2: spatial.availableBufferAreaM2,
    abandonmentRate: round(totalAbandoned / Math.max(1, totalServed + totalAbandoned), 4),
    meanProcessedPersons: round(totalServed, 1),
    maximumP95BacklogPersons: maximumQueueLength,
    maximumP95Utilization: round(
      queue.arrivalRatePerMinute / Math.max(0.01, queue.serviceRatePerServerMinute * queue.servers),
      3,
    ),
  };
  const spill =
    overflowRisk === "low"
      ? { status: "contained", routeObjectIds: [], exitObjectIds: [] }
      : {
          status: "spill-risk",
          routeObjectIds: spatial.routesByDistance.slice(0, 2).map((item) => item.objectId),
          exitObjectIds: overflowRatio >= 1.5 ? spatial.exitsByDistance.slice(0, 1).map((item) => item.objectId) : [],
        };
  const laneIds = ["standard", ...queue.priorityLanes.map((lane) => lane.id)];
  const lanes = laneIds.map((laneId) => ({
    laneId,
    meanWaitSeconds: round(
      mean(samples.map((sample) => mean(sample.lanes.find((lane) => lane.id === laneId)?.waitSamples ?? []))),
      1,
    ),
    p95WaitSeconds: round(
      percentile(
        samples.map((sample) => percentile(sample.lanes.find((lane) => lane.id === laneId)?.waitSamples ?? [], 0.95)),
        0.95,
      ),
      1,
    ),
    maximumQueueLength: round(
      percentile(
        samples.map((sample) => sample.lanes.find((lane) => lane.id === laneId)?.maxLength ?? 0),
        0.95,
      ),
      1,
    ),
  }));
  const timeline =
    samples[0]?.timeline.map((point, index) => ({
      second: point.second,
      meanQueueLength: round(mean(samples.map((sample) => sample.timeline[index]?.queueLength ?? 0)), 1),
    })) ?? [];
  const suggestion = suggestionFor(scenario, plan, queue, spatial, summary, inputFingerprint);
  const result = {
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
    suggestion,
    evidenceFingerprint: stableFingerprint("queue-evidence", {
      queue: { ...clone(queue), serviceObjectId: spatial.serviceObject.id, queueObjectIds: spatial.queueObjectIds },
      lanes,
      spill,
      summary,
      suggestion,
    }),
  };
  return result;
}

export const QUEUE_BENCHMARKS = Object.freeze(
  QUEUE_CATEGORIES.map((category, index) => ({
    id: `benchmark-queue-${category}`,
    scenario: {
      model: "queue",
      id: `benchmark-queue-${category}`,
      name: `${category} queue`,
      seed: 8100 + index,
      horizonSeconds: 900,
      sampleCount: 64,
      inputs: { population: 400, arrivalRatePerMinute: 18, serviceRatePerMinute: 7, servers: 3, mobilityFactor: 1 },
      queue: { category, bufferAreaM2: 18, abandonment: { enabled: true, meanPatienceSeconds: 420 } },
    },
    expected: { p95WaitSeconds: { minimum: 0, maximum: 900 }, maximumQueueLength: { minimum: 0, maximum: 120 } },
  })),
);
