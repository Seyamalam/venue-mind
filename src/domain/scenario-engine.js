import { stableFingerprint } from "./activity-ledger.js";
import { normalizeIngressEgressInputs, simulateIngressEgress } from "./ingress-egress-simulation.js";
import { normalizeQueueInputs, simulateQueue } from "./queue-simulation.js";

export const SIMULATION_ENGINE_VERSION = "1.2.1";
export const SIMULATION_STATUSES = Object.freeze(["queued", "running", "completed", "cancelled", "failed"]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const round = (value, precision = 3) => Number(Number(value).toFixed(precision));
const finite = (value, label) => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};
const positive = (value, label) => {
  const result = finite(value, label);
  if (result <= 0) throw new Error(`${label} must be greater than zero`);
  return result;
};

const normalizePhases = (phases, horizonSeconds) => {
  const source = phases?.length ? phases : [{ id: "phase-full", label: "Full horizon", startSecond: 0, endSecond: horizonSeconds, demandShare: 1 }];
  const ids = new Set();
  const normalized = source.map((phase, index) => {
    const id = String(phase.id ?? `phase-${index + 1}`).trim();
    if (!id || ids.has(id)) throw new Error("Scenario phases require unique stable IDs");
    ids.add(id);
    const startSecond = finite(phase.startSecond, `${id}.startSecond`);
    const endSecond = finite(phase.endSecond, `${id}.endSecond`);
    if (startSecond < 0 || endSecond <= startSecond || endSecond > horizonSeconds) throw new Error(`${id} must fit inside the Scenario horizon`);
    return { id, label: String(phase.label ?? id), startSecond: round(startSecond), endSecond: round(endSecond), demandShare: round(positive(phase.demandShare ?? 1 / source.length, `${id}.demandShare`), 6) };
  }).sort((left, right) => left.startSecond - right.startSecond || left.id.localeCompare(right.id));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index].startSecond < normalized[index - 1].endSecond) throw new Error("Scenario phases cannot overlap");
  }
  const totalShare = normalized.reduce((sum, phase) => sum + phase.demandShare, 0);
  return normalized.map((phase) => ({ ...phase, demandShare: round(phase.demandShare / totalShare, 6) }));
};

export function normalizeScenarioDefinition(value) {
  const horizonSeconds = positive(value?.horizonSeconds ?? 3600, "horizonSeconds");
  const sampleCount = Math.trunc(positive(value?.sampleCount ?? 256, "sampleCount"));
  if (sampleCount > 10_000) throw new Error("sampleCount cannot exceed 10000");
  const seed = Math.trunc(finite(value?.seed ?? 1, "seed")) >>> 0;
  const inputs = {
    population: Math.trunc(positive(value?.inputs?.population ?? 1, "inputs.population")),
    arrivalRatePerMinute: positive(value?.inputs?.arrivalRatePerMinute ?? 10, "inputs.arrivalRatePerMinute"),
    serviceRatePerMinute: positive(value?.inputs?.serviceRatePerMinute ?? 10, "inputs.serviceRatePerMinute"),
    servers: Math.trunc(positive(value?.inputs?.servers ?? 1, "inputs.servers")),
    mobilityFactor: positive(value?.inputs?.mobilityFactor ?? 1, "inputs.mobilityFactor"),
  };
  const model = value?.model ?? "operations";
  if (!["operations", "ingress-egress", "queue"].includes(model)) throw new Error("Unsupported Scenario model");
  return {
    schemaVersion: 1,
    model,
    id: String(value?.id ?? "scenario-default").trim() || "scenario-default",
    name: String(value?.name ?? "Operational scenario").trim() || "Operational scenario",
    seed,
    horizonSeconds: round(horizonSeconds),
    sampleCount,
    phases: normalizePhases(value?.phases, horizonSeconds),
    inputs: Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, round(input, 6)])),
    ...(model === "ingress-egress" ? { ingressEgress: normalizeIngressEgressInputs(value?.ingressEgress, horizonSeconds) } : {}),
    ...(model === "queue" ? { queue: normalizeQueueInputs(value?.queue, inputs) } : {}),
    confidence: {
      method: "seeded-percentile-sampling",
      level: 0.95,
      uncertaintyDrivers: ["arrival-variation", "service-variation", "mobility-variation"],
    },
  };
}

const mulberry32 = (seed) => () => {
  let value = seed += 0x6d2b79f5;
  value = Math.imul(value ^ value >>> 15, value | 1);
  value ^= value + Math.imul(value ^ value >>> 7, value | 61);
  return ((value ^ value >>> 14) >>> 0) / 4294967296;
};

const percentile = (values, ratio) => values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))];

const geometryFactors = (plan) => {
  const routes = plan.objects.filter((object) => ["accessible_route", "corridor", "aisle", "service_lane"].includes(object.kind));
  const exits = plan.objects.filter((object) => object.kind === "fire_exit");
  const minimumRouteWidthM = routes.length ? Math.min(...routes.map((route) => route.footprint.width)) : 0.1;
  const exitCapacity = exits.reduce((sum, exit) => sum + (exit.exit?.capacityPersons ?? 0), 0) || 1;
  return { routeCount: routes.length, exitCount: exits.length, minimumRouteWidthM: round(minimumRouteWidthM), exitCapacity };
};

const simulatePhase = (scenario, phase, plan, random) => {
  const durationMinutes = (phase.endSecond - phase.startSecond) / 60;
  const demand = scenario.inputs.population * phase.demandShare;
  const geometry = geometryFactors(plan);
  const samples = Array.from({ length: scenario.sampleCount }, () => {
    const arrivalVariation = 0.84 + random() * 0.32;
    const serviceVariation = 0.88 + random() * 0.24;
    const mobilityVariation = (0.92 + random() * 0.16) * scenario.inputs.mobilityFactor;
    const arrivals = Math.min(demand * arrivalVariation, scenario.inputs.arrivalRatePerMinute * durationMinutes * arrivalVariation);
    const serviceCapacity = scenario.inputs.serviceRatePerMinute * scenario.inputs.servers * durationMinutes * serviceVariation;
    const routeCapacity = geometry.minimumRouteWidthM * 55 * durationMinutes / mobilityVariation;
    const exitCapacity = geometry.exitCapacity * Math.max(1, durationMinutes / 10);
    const processed = Math.min(arrivals, serviceCapacity, routeCapacity, exitCapacity);
    const backlog = Math.max(0, demand - processed);
    const utilization = demand / Math.max(1, Math.min(serviceCapacity, routeCapacity, exitCapacity));
    return { processed, backlog, utilization };
  });
  const sortedBacklog = samples.map((sample) => sample.backlog).sort((left, right) => left - right);
  const sortedUtilization = samples.map((sample) => sample.utilization).sort((left, right) => left - right);
  const mean = (key) => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
  return {
    phaseId: phase.id,
    demandPersons: round(demand, 1),
    meanProcessedPersons: round(mean("processed"), 1),
    meanBacklogPersons: round(mean("backlog"), 1),
    p95BacklogPersons: round(percentile(sortedBacklog, 0.95), 1),
    meanUtilization: round(mean("utilization"), 3),
    p95Utilization: round(percentile(sortedUtilization, 0.95), 3),
  };
};

export function scenarioDefinitionFingerprint(scenario) {
  return stableFingerprint("scenario-definition", normalizeScenarioDefinition(scenario));
}

const normalizeResult = ({ scenario, plan, branchId, inputFingerprint, phaseResults }) => ({
  schemaVersion: 1,
  kind: "simulation-result",
  model: "operations",
  engineVersion: SIMULATION_ENGINE_VERSION,
  inputFingerprint,
  scenarioFingerprint: scenarioDefinitionFingerprint(scenario),
  scenarioId: scenario.id,
  planId: plan.id,
  planVersion: plan.version,
  geometryFingerprint: plan.spatial.fingerprint,
  branchId: branchId ?? null,
  seed: scenario.seed,
  horizonSeconds: scenario.horizonSeconds,
  sampleCount: scenario.sampleCount,
  confidence: clone(scenario.confidence),
  phases: phaseResults,
  summary: {
    meanProcessedPersons: round(phaseResults.reduce((sum, phase) => sum + phase.meanProcessedPersons, 0), 1),
    maximumP95BacklogPersons: round(Math.max(...phaseResults.map((phase) => phase.p95BacklogPersons)), 1),
    maximumP95Utilization: round(Math.max(...phaseResults.map((phase) => phase.p95Utilization)), 3),
  },
});

export function scenarioInputFingerprint(scenario, plan, branchId = null, engineVersion = SIMULATION_ENGINE_VERSION) {
  return stableFingerprint("simulation-input", { engineVersion, scenario: normalizeScenarioDefinition(scenario), planId: plan.id, planVersion: plan.version, geometryFingerprint: plan.spatial.fingerprint, branchId });
}

export function createScenarioRunner({ engineVersion = SIMULATION_ENGINE_VERSION, scheduler = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {}) {
  if (engineVersion !== SIMULATION_ENGINE_VERSION) throw new Error(`Unsupported simulation engine version: ${engineVersion}`);
  const cache = new Map();
  let active = null;

  const cancelActive = (reason = "superseded") => {
    if (!active) return false;
    active.controller.abort(reason);
    return true;
  };

  const run = ({ scenario: sourceScenario, plan, branchId = null }, { onProgress = () => {} } = {}) => {
    const scenario = normalizeScenarioDefinition(sourceScenario);
    const inputFingerprint = scenarioInputFingerprint(scenario, plan, branchId, engineVersion);
    if (cache.has(inputFingerprint)) return Promise.resolve({ status: "completed", cacheHit: true, runId: `simulation-${inputFingerprint.slice(-8)}`, result: clone(cache.get(inputFingerprint)) });
    if (active?.inputFingerprint === inputFingerprint) return active.promise;
    cancelActive("obsolete-input");
    const controller = new AbortController();
    const runId = `simulation-${inputFingerprint.slice(-8)}`;
    const phaseResults = [];
    const promise = (async () => {
      onProgress({ runId, status: "running", progress: 0, completedPhaseIds: [], partialResult: null });
      if (["ingress-egress", "queue"].includes(scenario.model)) {
        const stages = scenario.model === "ingress-egress" ? ["infrastructure", "normal-egress", "emergency-egress"] : ["arrivals", "service", "spatial-preflight"];
        let partialResult = null;
        for (let index = 0; index < stages.length; index += 1) {
          await scheduler();
          if (controller.signal.aborted) return { status: "cancelled", cacheHit: false, runId, reason: controller.signal.reason ?? "cancelled", partialResult };
          const simulate = scenario.model === "ingress-egress" ? simulateIngressEgress : simulateQueue;
          partialResult = simulate({
            scenario,
            plan,
            branchId,
            inputFingerprint,
            scenarioFingerprint: scenarioDefinitionFingerprint(scenario),
            engineVersion,
            random: mulberry32(scenario.seed),
            sampleCount: Math.max(1, Math.ceil(scenario.sampleCount * ((index + 1) / stages.length))),
          });
          onProgress({ runId, status: "running", progress: round((index + 1) / stages.length, 3), completedPhaseIds: stages.slice(0, index + 1), partialResult: clone(partialResult) });
        }
        cache.set(inputFingerprint, clone(partialResult));
        return { status: "completed", cacheHit: false, runId, result: partialResult };
      }
      const random = mulberry32(scenario.seed);
      for (let index = 0; index < scenario.phases.length; index += 1) {
        await scheduler();
        if (controller.signal.aborted) {
          const partialResult = phaseResults.length ? normalizeResult({ scenario, plan, branchId, inputFingerprint, phaseResults }) : null;
          return { status: "cancelled", cacheHit: false, runId, reason: controller.signal.reason ?? "cancelled", partialResult };
        }
        phaseResults.push(simulatePhase(scenario, scenario.phases[index], plan, random));
        onProgress({ runId, status: "running", progress: round((index + 1) / scenario.phases.length, 3), completedPhaseIds: phaseResults.map((phase) => phase.phaseId), partialResult: normalizeResult({ scenario, plan, branchId, inputFingerprint, phaseResults }) });
      }
      const result = normalizeResult({ scenario, plan, branchId, inputFingerprint, phaseResults });
      cache.set(inputFingerprint, clone(result));
      return { status: "completed", cacheHit: false, runId, result };
    })().finally(() => {
      if (active?.runId === runId) active = null;
    });
    active = { runId, inputFingerprint, controller, promise };
    return promise;
  };

  return Object.freeze({ run, cancelActive, getActive: () => active ? { runId: active.runId, inputFingerprint: active.inputFingerprint } : null, cacheSize: () => cache.size, clearCache: () => cache.clear() });
}

export function compareSimulationResults(left, right) {
  if (left.kind !== "simulation-result" || right.kind !== "simulation-result") throw new Error("Simulation comparison requires completed results");
  if (left.engineVersion !== right.engineVersion || left.scenarioFingerprint !== right.scenarioFingerprint || left.model !== right.model) throw new Error("Simulation results are not comparable");
  const modelDeltas = left.model === "ingress-egress" ? {
    totalClearanceSeconds: round(right.summary.totalClearanceSeconds - left.summary.totalClearanceSeconds, 1),
    p95ClearanceSeconds: round(right.summary.p95ClearanceSeconds - left.summary.p95ClearanceSeconds, 1),
    worstBottleneckDurationSeconds: round(right.summary.worstBottleneckDurationSeconds - left.summary.worstBottleneckDurationSeconds, 1),
    affectedOccupancyPersons: round(right.summary.affectedOccupancyPersons - left.summary.affectedOccupancyPersons, 1),
    accessibleRouteClearanceSeconds: round(right.summary.accessibleRouteClearanceSeconds - left.summary.accessibleRouteClearanceSeconds, 1),
  } : left.model === "queue" ? {
    averageWaitSeconds: round(right.summary.averageWaitSeconds - left.summary.averageWaitSeconds, 1),
    p95WaitSeconds: round(right.summary.p95WaitSeconds - left.summary.p95WaitSeconds, 1),
    maximumQueueLength: round(right.summary.maximumQueueLength - left.summary.maximumQueueLength, 1),
    abandonmentRate: round(right.summary.abandonmentRate - left.summary.abandonmentRate, 4),
    requiredBufferAreaM2: round(right.summary.requiredBufferAreaM2 - left.summary.requiredBufferAreaM2, 1),
  } : {};
  return {
    id: stableFingerprint("simulation-comparison", { left: left.inputFingerprint, right: right.inputFingerprint }),
    scenarioId: left.scenarioId,
    engineVersion: left.engineVersion,
    left: { inputFingerprint: left.inputFingerprint, branchId: left.branchId, planVersion: left.planVersion },
    right: { inputFingerprint: right.inputFingerprint, branchId: right.branchId, planVersion: right.planVersion },
    deltas: {
      meanProcessedPersons: round(right.summary.meanProcessedPersons - left.summary.meanProcessedPersons, 1),
      maximumP95BacklogPersons: round(right.summary.maximumP95BacklogPersons - left.summary.maximumP95BacklogPersons, 1),
      maximumP95Utilization: round(right.summary.maximumP95Utilization - left.summary.maximumP95Utilization, 3),
      ...modelDeltas,
    },
  };
}

export function exportSimulationRun(scenario, runResult) {
  if (runResult?.status !== "completed" || !runResult.result) throw new Error("Only a completed Simulation Run can be exported");
  const payload = { format: "venuemind-simulation", formatVersion: 1, scenario: normalizeScenarioDefinition(scenario), result: clone(runResult.result) };
  return { filename: `${scenario.id}-${runResult.runId}.simulation.json`, mimeType: "application/json", encoding: "utf8", content: `${JSON.stringify(payload, null, 2)}\n` };
}
