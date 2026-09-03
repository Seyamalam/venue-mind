import { stableFingerprint } from "./activity-ledger.ts";
import { normalizeIngressEgressInputs, simulateIngressEgress } from "./ingress-egress-simulation.ts";
import { normalizeQueueInputs, simulateQueue, type ScenarioInputs } from "./queue-simulation.ts";
import type { VenuePlan } from "./geometry.ts";

export const SIMULATION_ENGINE_VERSION = "1.2.1";
export const SIMULATION_STATUSES = Object.freeze(["queued", "running", "completed", "cancelled", "failed"]);

export type ScenarioModel = "operations" | "ingress-egress" | "queue";
export interface ScenarioPhase {
  id: string;
  label: string;
  startSecond: number;
  endSecond: number;
  demandShare: number;
}
export interface ScenarioDefinition {
  schemaVersion: 1;
  model: ScenarioModel;
  id: string;
  name: string;
  seed: number;
  horizonSeconds: number;
  sampleCount: number;
  phases: ScenarioPhase[];
  inputs: ScenarioInputs;
  confidence: { method: string; level: number; uncertaintyDrivers: string[] };
  ingressEgress?: ReturnType<typeof normalizeIngressEgressInputs>;
  queue?: ReturnType<typeof normalizeQueueInputs>;
}
export interface ScenarioOutcome {
  status: "completed" | "cancelled";
  cacheHit: boolean;
  runId: string;
  result?: object;
  partialResult?: object | null;
  reason?: string;
}
interface RawScenarioPhase {
  id?: unknown;
  label?: unknown;
  startSecond?: unknown;
  endSecond?: unknown;
  demandShare?: unknown;
}
interface RawScenario extends Record<string, unknown> {
  model?: unknown;
  id?: unknown;
  name?: unknown;
  seed?: unknown;
  horizonSeconds?: unknown;
  sampleCount?: unknown;
  phases?: unknown;
  inputs?: unknown;
  ingressEgress?: unknown;
  queue?: unknown;
}
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rawScenario = (value: unknown): RawScenario => (isRecord(value) ? value : {});
const rawPhase = (value: unknown): RawScenarioPhase => (isRecord(value) ? value : {});
const clone = <T>(value: T): T => structuredClone(value);
const scalarText = (value: unknown, fallback: string): string =>
  typeof value === "string"
    ? value
    : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
      ? String(value)
      : fallback;
const round = (value: number, precision = 3): number => Number(value.toFixed(precision));
const finite = (value: number, label: string): number => {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
};
const positive = (value: number, label: string): number => {
  const result = finite(value, label);
  if (result <= 0) throw new Error(`${label} must be greater than zero`);
  return result;
};

const normalizePhases = (phases: unknown, horizonSeconds: number): ScenarioPhase[] => {
  const source: unknown[] =
    Array.isArray(phases) && phases.length
      ? phases
      : [{ id: "phase-full", label: "Full horizon", startSecond: 0, endSecond: horizonSeconds, demandShare: 1 }];
  const ids = new Set<string>();
  const normalized = source
    .map((value, index) => {
      const phase = rawPhase(value);
      const id = scalarText(phase.id, `phase-${index + 1}`).trim();
      if (!id || ids.has(id)) throw new Error("Scenario phases require unique stable IDs");
      ids.add(id);
      const startSecond = finite(Number(phase.startSecond), `${id}.startSecond`);
      const endSecond = finite(Number(phase.endSecond), `${id}.endSecond`);
      if (startSecond < 0 || endSecond <= startSecond || endSecond > horizonSeconds)
        throw new Error(`${id} must fit inside the Scenario horizon`);
      return {
        id,
        label: scalarText(phase.label, id),
        startSecond: round(startSecond),
        endSecond: round(endSecond),
        demandShare: round(positive(Number(phase.demandShare ?? 1 / source.length), `${id}.demandShare`), 6),
      };
    })
    .sort((left, right) => left.startSecond - right.startSecond || left.id.localeCompare(right.id));
  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index];
    const previous = normalized[index - 1];
    if (current && previous && current.startSecond < previous.endSecond)
      throw new Error("Scenario phases cannot overlap");
  }
  const totalShare = normalized.reduce((sum, phase) => sum + phase.demandShare, 0);
  return normalized.map((phase) => ({ ...phase, demandShare: round(phase.demandShare / totalShare, 6) }));
};

export function normalizeScenarioDefinition(input: unknown): ScenarioDefinition {
  const value = rawScenario(input);
  const horizonSeconds = positive(Number(value.horizonSeconds ?? 3600), "horizonSeconds");
  const sampleCount = Math.trunc(positive(Number(value.sampleCount ?? 256), "sampleCount"));
  if (sampleCount > 10_000) throw new Error("sampleCount cannot exceed 10000");
  const seed = Math.trunc(finite(Number(value.seed ?? 1), "seed")) >>> 0;
  const rawInputs = isRecord(value.inputs) ? value.inputs : {};
  const inputs = {
    population: Math.trunc(positive(Number(rawInputs.population ?? 1), "inputs.population")),
    arrivalRatePerMinute: positive(Number(rawInputs.arrivalRatePerMinute ?? 10), "inputs.arrivalRatePerMinute"),
    serviceRatePerMinute: positive(Number(rawInputs.serviceRatePerMinute ?? 10), "inputs.serviceRatePerMinute"),
    servers: Math.trunc(positive(Number(rawInputs.servers ?? 1), "inputs.servers")),
    mobilityFactor: positive(Number(rawInputs.mobilityFactor ?? 1), "inputs.mobilityFactor"),
  };
  const rawModel = value.model ?? "operations";
  if (rawModel !== "operations" && rawModel !== "ingress-egress" && rawModel !== "queue")
    throw new Error("Unsupported Scenario model");
  const model: ScenarioModel = rawModel;
  return {
    schemaVersion: 1,
    model,
    id: scalarText(value.id, "scenario-default").trim() || "scenario-default",
    name: scalarText(value.name, "Operational scenario").trim() || "Operational scenario",
    seed,
    horizonSeconds: round(horizonSeconds),
    sampleCount,
    phases: normalizePhases(value.phases, horizonSeconds),
    inputs: {
      population: Math.round(inputs.population),
      arrivalRatePerMinute: round(inputs.arrivalRatePerMinute, 6),
      serviceRatePerMinute: round(inputs.serviceRatePerMinute, 6),
      servers: Math.round(inputs.servers),
      mobilityFactor: round(inputs.mobilityFactor, 6),
    },
    ...(model === "ingress-egress"
      ? { ingressEgress: normalizeIngressEgressInputs(value.ingressEgress, horizonSeconds) }
      : {}),
    ...(model === "queue" ? { queue: normalizeQueueInputs(value.queue, inputs) } : {}),
    confidence: {
      method: "seeded-percentile-sampling",
      level: 0.95,
      uncertaintyDrivers: ["arrival-variation", "service-variation", "mobility-variation"],
    },
  };
}

const mulberry32 =
  (seed: number): (() => number) =>
  () => {
    let value = (seed += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

const percentile = (values: readonly number[], ratio: number): number =>
  values[Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1))] ?? 0;

const geometryFactors = (plan: VenuePlan) => {
  const routes = plan.objects.filter((object) =>
    ["accessible_route", "corridor", "aisle", "service_lane"].includes(object.kind),
  );
  const exits = plan.objects.filter((object) => object.kind === "fire_exit");
  const minimumRouteWidthM = routes.length
    ? Math.min(
        ...routes.map((route) =>
          route.footprint.kind === "line" || route.footprint.kind === "rectangle"
            ? route.footprint.width
            : route.footprint.kind === "circle"
              ? route.footprint.radius * 2
              : 0.1,
        ),
      )
    : 0.1;
  const exitCapacity = exits.reduce((sum, exit) => sum + (exit.exit?.capacityPersons ?? 0), 0) || 1;
  return {
    routeCount: routes.length,
    exitCount: exits.length,
    minimumRouteWidthM: round(minimumRouteWidthM),
    exitCapacity,
  };
};

interface OperationSample {
  processed: number;
  backlog: number;
  utilization: number;
}
const simulatePhase = (scenario: ScenarioDefinition, phase: ScenarioPhase, plan: VenuePlan, random: () => number) => {
  const durationMinutes = (phase.endSecond - phase.startSecond) / 60;
  const demand = scenario.inputs.population * phase.demandShare;
  const geometry = geometryFactors(plan);
  const samples = Array.from({ length: scenario.sampleCount }, () => {
    const arrivalVariation = 0.84 + random() * 0.32;
    const serviceVariation = 0.88 + random() * 0.24;
    const mobilityVariation = (0.92 + random() * 0.16) * scenario.inputs.mobilityFactor;
    const arrivals = Math.min(
      demand * arrivalVariation,
      scenario.inputs.arrivalRatePerMinute * durationMinutes * arrivalVariation,
    );
    const serviceCapacity =
      scenario.inputs.serviceRatePerMinute * scenario.inputs.servers * durationMinutes * serviceVariation;
    const routeCapacity = (geometry.minimumRouteWidthM * 55 * durationMinutes) / mobilityVariation;
    const exitCapacity = geometry.exitCapacity * Math.max(1, durationMinutes / 10);
    const processed = Math.min(arrivals, serviceCapacity, routeCapacity, exitCapacity);
    const backlog = Math.max(0, demand - processed);
    const utilization = demand / Math.max(1, Math.min(serviceCapacity, routeCapacity, exitCapacity));
    return { processed, backlog, utilization };
  });
  const sortedBacklog = samples.map((sample) => sample.backlog).sort((left, right) => left - right);
  const sortedUtilization = samples.map((sample) => sample.utilization).sort((left, right) => left - right);
  const mean = (key: keyof OperationSample) => samples.reduce((sum, sample) => sum + sample[key], 0) / samples.length;
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

export function scenarioDefinitionFingerprint(scenario: unknown): string {
  return stableFingerprint("scenario-definition", normalizeScenarioDefinition(scenario));
}

type OperationPhaseResult = ReturnType<typeof simulatePhase>;
interface NormalizeResultInput {
  scenario: ScenarioDefinition;
  plan: VenuePlan;
  branchId: string | null;
  inputFingerprint: string;
  phaseResults: OperationPhaseResult[];
}
const normalizeResult = ({ scenario, plan, branchId, inputFingerprint, phaseResults }: NormalizeResultInput) => ({
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
    meanProcessedPersons: round(
      phaseResults.reduce((sum, phase) => sum + phase.meanProcessedPersons, 0),
      1,
    ),
    maximumP95BacklogPersons: round(Math.max(...phaseResults.map((phase) => phase.p95BacklogPersons)), 1),
    maximumP95Utilization: round(Math.max(...phaseResults.map((phase) => phase.p95Utilization)), 3),
  },
});

export function scenarioInputFingerprint(
  scenario: unknown,
  plan: VenuePlan,
  branchId: string | null = null,
  engineVersion = SIMULATION_ENGINE_VERSION,
): string {
  return stableFingerprint("simulation-input", {
    engineVersion,
    scenario: normalizeScenarioDefinition(scenario),
    planId: plan.id,
    planVersion: plan.version,
    geometryFingerprint: plan.spatial.fingerprint,
    branchId,
  });
}

interface ScenarioRunnerOptions {
  engineVersion?: string;
  scheduler?: () => Promise<void>;
}
interface ScenarioProgress {
  runId: string;
  status: "running";
  progress: number;
  completedPhaseIds: string[];
  partialResult: object | null;
}
interface ScenarioRunInput {
  scenario: unknown;
  plan: VenuePlan;
  branchId?: string | null;
}
interface ScenarioRunOptions {
  onProgress?: (update: ScenarioProgress) => void;
}
export function createScenarioRunner({
  engineVersion = SIMULATION_ENGINE_VERSION,
  scheduler = () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
}: ScenarioRunnerOptions = {}) {
  if (engineVersion !== SIMULATION_ENGINE_VERSION)
    throw new Error(`Unsupported simulation engine version: ${engineVersion}`);
  const cache = new Map<string, object>();
  let active: {
    runId: string;
    inputFingerprint: string;
    controller: AbortController;
    promise: Promise<ScenarioOutcome>;
  } | null = null;

  const cancelActive = (reason = "superseded"): boolean => {
    if (!active) return false;
    active.controller.abort(reason);
    return true;
  };

  const run = (
    { scenario: sourceScenario, plan, branchId = null }: ScenarioRunInput,
    { onProgress = () => {} }: ScenarioRunOptions = {},
  ): Promise<ScenarioOutcome> => {
    const scenario = normalizeScenarioDefinition(sourceScenario);
    const inputFingerprint = scenarioInputFingerprint(scenario, plan, branchId, engineVersion);
    const cached = cache.get(inputFingerprint);
    if (cached)
      return Promise.resolve({
        status: "completed",
        cacheHit: true,
        runId: `simulation-${inputFingerprint.slice(-8)}`,
        result: clone(cached),
      });
    if (active?.inputFingerprint === inputFingerprint) return active.promise;
    cancelActive("obsolete-input");
    const controller = new AbortController();
    const runId = `simulation-${inputFingerprint.slice(-8)}`;
    const phaseResults: OperationPhaseResult[] = [];
    const promise: Promise<ScenarioOutcome> = (async (): Promise<ScenarioOutcome> => {
      onProgress({ runId, status: "running", progress: 0, completedPhaseIds: [], partialResult: null });
      if (["ingress-egress", "queue"].includes(scenario.model)) {
        const stages =
          scenario.model === "ingress-egress"
            ? ["infrastructure", "normal-egress", "emergency-egress"]
            : ["arrivals", "service", "spatial-preflight"];
        let partialResult = null;
        for (let index = 0; index < stages.length; index += 1) {
          await scheduler();
          if (controller.signal.aborted)
            return {
              status: "cancelled",
              cacheHit: false,
              runId,
              reason: String(controller.signal.reason ?? "cancelled"),
              partialResult,
            };
          const scenarioFingerprint = scenarioDefinitionFingerprint(scenario);
          partialResult =
            scenario.model === "ingress-egress" && scenario.ingressEgress
              ? simulateIngressEgress({
                  scenario: { ...scenario, ingressEgress: scenario.ingressEgress },
                  plan,
                  branchId,
                  inputFingerprint,
                  scenarioFingerprint,
                  engineVersion,
                  random: mulberry32(scenario.seed),
                  sampleCount: Math.max(1, Math.ceil(scenario.sampleCount * ((index + 1) / stages.length))),
                })
              : scenario.model === "queue" && scenario.queue
                ? simulateQueue({
                    scenario: { ...scenario, queue: scenario.queue },
                    plan,
                    branchId,
                    inputFingerprint,
                    scenarioFingerprint,
                    engineVersion,
                    random: mulberry32(scenario.seed),
                    sampleCount: Math.max(1, Math.ceil(scenario.sampleCount * ((index + 1) / stages.length))),
                  })
                : null;
          onProgress({
            runId,
            status: "running",
            progress: round((index + 1) / stages.length, 3),
            completedPhaseIds: stages.slice(0, index + 1),
            partialResult: clone(partialResult),
          });
        }
        if (!partialResult) throw new Error("Scenario model configuration is missing");
        cache.set(inputFingerprint, clone(partialResult));
        return { status: "completed", cacheHit: false, runId, result: partialResult };
      }
      const random = mulberry32(scenario.seed);
      for (let index = 0; index < scenario.phases.length; index += 1) {
        await scheduler();
        if (controller.signal.aborted) {
          const partialResult = phaseResults.length
            ? normalizeResult({ scenario, plan, branchId, inputFingerprint, phaseResults })
            : null;
          return {
            status: "cancelled",
            cacheHit: false,
            runId,
            reason: String(controller.signal.reason ?? "cancelled"),
            partialResult,
          };
        }
        const phase = scenario.phases[index];
        if (!phase) continue;
        phaseResults.push(simulatePhase(scenario, phase, plan, random));
        onProgress({
          runId,
          status: "running",
          progress: round((index + 1) / scenario.phases.length, 3),
          completedPhaseIds: phaseResults.map((phase) => phase.phaseId),
          partialResult: normalizeResult({ scenario, plan, branchId, inputFingerprint, phaseResults }),
        });
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

  return Object.freeze({
    run,
    cancelActive,
    getActive: () => (active ? { runId: active.runId, inputFingerprint: active.inputFingerprint } : null),
    cacheSize: () => cache.size,
    clearCache: () => cache.clear(),
  });
}

interface SimulationComparable {
  kind: "simulation-result";
  model: ScenarioModel;
  engineVersion: string;
  scenarioFingerprint: string;
  scenarioId: string;
  inputFingerprint: string;
  branchId: string | null;
  planVersion: string;
  summary: Record<string, number | string | null> & {
    meanProcessedPersons: number;
    maximumP95BacklogPersons: number;
    maximumP95Utilization: number;
  };
}
const comparableResult = (value: unknown): value is SimulationComparable => {
  if (
    !isRecord(value) ||
    value.kind !== "simulation-result" ||
    (value.model !== "operations" && value.model !== "ingress-egress" && value.model !== "queue")
  )
    return false;
  if (
    typeof value.engineVersion !== "string" ||
    typeof value.scenarioFingerprint !== "string" ||
    typeof value.scenarioId !== "string" ||
    typeof value.inputFingerprint !== "string" ||
    typeof value.planVersion !== "string"
  )
    return false;
  if (!isRecord(value.summary)) return false;
  return (
    typeof value.summary.meanProcessedPersons === "number" &&
    typeof value.summary.maximumP95BacklogPersons === "number" &&
    typeof value.summary.maximumP95Utilization === "number"
  );
};
const summaryNumber = (result: SimulationComparable, key: string): number =>
  typeof result.summary[key] === "number" ? result.summary[key] : 0;
export function compareSimulationResults(leftInput: unknown, rightInput: unknown) {
  if (!comparableResult(leftInput) || !comparableResult(rightInput))
    throw new Error("Simulation comparison requires completed results");
  const left = leftInput;
  const right = rightInput;
  if (left.kind !== "simulation-result" || right.kind !== "simulation-result")
    throw new Error("Simulation comparison requires completed results");
  if (
    left.engineVersion !== right.engineVersion ||
    left.scenarioFingerprint !== right.scenarioFingerprint ||
    left.model !== right.model
  )
    throw new Error("Simulation results are not comparable");
  const modelDeltas =
    left.model === "ingress-egress"
      ? {
          totalClearanceSeconds: round(
            summaryNumber(right, "totalClearanceSeconds") - summaryNumber(left, "totalClearanceSeconds"),
            1,
          ),
          p95ClearanceSeconds: round(
            summaryNumber(right, "p95ClearanceSeconds") - summaryNumber(left, "p95ClearanceSeconds"),
            1,
          ),
          worstBottleneckDurationSeconds: round(
            summaryNumber(right, "worstBottleneckDurationSeconds") -
              summaryNumber(left, "worstBottleneckDurationSeconds"),
            1,
          ),
          affectedOccupancyPersons: round(
            summaryNumber(right, "affectedOccupancyPersons") - summaryNumber(left, "affectedOccupancyPersons"),
            1,
          ),
          accessibleRouteClearanceSeconds: round(
            summaryNumber(right, "accessibleRouteClearanceSeconds") -
              summaryNumber(left, "accessibleRouteClearanceSeconds"),
            1,
          ),
        }
      : left.model === "queue"
        ? {
            averageWaitSeconds: round(
              summaryNumber(right, "averageWaitSeconds") - summaryNumber(left, "averageWaitSeconds"),
              1,
            ),
            p95WaitSeconds: round(summaryNumber(right, "p95WaitSeconds") - summaryNumber(left, "p95WaitSeconds"), 1),
            maximumQueueLength: round(
              summaryNumber(right, "maximumQueueLength") - summaryNumber(left, "maximumQueueLength"),
              1,
            ),
            abandonmentRate: round(summaryNumber(right, "abandonmentRate") - summaryNumber(left, "abandonmentRate"), 4),
            requiredBufferAreaM2: round(
              summaryNumber(right, "requiredBufferAreaM2") - summaryNumber(left, "requiredBufferAreaM2"),
              1,
            ),
          }
        : {};
  return {
    id: stableFingerprint("simulation-comparison", { left: left.inputFingerprint, right: right.inputFingerprint }),
    scenarioId: left.scenarioId,
    engineVersion: left.engineVersion,
    left: { inputFingerprint: left.inputFingerprint, branchId: left.branchId, planVersion: left.planVersion },
    right: { inputFingerprint: right.inputFingerprint, branchId: right.branchId, planVersion: right.planVersion },
    deltas: {
      meanProcessedPersons: round(right.summary.meanProcessedPersons - left.summary.meanProcessedPersons, 1),
      maximumP95BacklogPersons: round(
        right.summary.maximumP95BacklogPersons - left.summary.maximumP95BacklogPersons,
        1,
      ),
      maximumP95Utilization: round(right.summary.maximumP95Utilization - left.summary.maximumP95Utilization, 3),
      ...modelDeltas,
    },
  };
}

export function exportSimulationRun(
  scenarioInput: unknown,
  runResult: { status: string; runId: string; result: object | null },
) {
  if (runResult.status !== "completed" || !runResult.result)
    throw new Error("Only a completed Simulation Run can be exported");
  const scenario = normalizeScenarioDefinition(scenarioInput);
  const payload = { format: "venuemind-simulation", formatVersion: 1, scenario, result: clone(runResult.result) };
  return {
    filename: `${scenario.id}-${runResult.runId}.simulation.json`,
    mimeType: "application/json",
    encoding: "utf8",
    content: `${JSON.stringify(payload, null, 2)}\n`,
  };
}
