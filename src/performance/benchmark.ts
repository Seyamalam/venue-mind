import { performance } from "node:perf_hooks";
import { createValidationEngine } from "../domain/constraint-engine.ts";
import { createVenuePlanner, type VenuePlanner } from "../domain/venue-planner.ts";
import { createBenchmarkPlan, createBenchmarkSnapshot } from "./benchmark-fixtures.ts";
import {
  PERFORMANCE_OPERATIONS,
  PLAN_PERFORMANCE_TARGETS,
  type PerformanceOperation,
  type PlanTargetName,
} from "./performance-targets.ts";

export interface BenchmarkMeasurement {
  readonly operation: PerformanceOperation;
  readonly medianMs: number;
  readonly budgetMs: number;
  readonly passed: boolean;
}
export interface BenchmarkReport {
  readonly target: PlanTargetName;
  readonly iterations: number;
  readonly measurements: readonly BenchmarkMeasurement[];
  readonly passed: boolean;
}

const median = (values: readonly number[]): number => {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const value = ordered[middle];
  if (value === undefined) throw new Error("Benchmark requires at least one sample");
  return Number(value.toFixed(3));
};

const plannerFromSnapshot = (snapshot: ReturnType<typeof createBenchmarkSnapshot>): VenuePlanner => {
  const targetName = snapshot.plan.id.endsWith("large")
    ? "large"
    : snapshot.plan.id.endsWith("medium")
      ? "medium"
      : "small";
  const planner = createVenuePlanner(createBenchmarkPlan(PLAN_PERFORMANCE_TARGETS[targetName]));
  void planner.execute({ type: "restore_snapshot", snapshot: structuredClone(snapshot) });
  return planner;
};

const setupOperation = (
  targetName: PlanTargetName,
  operation: PerformanceOperation,
): { readonly planner: VenuePlanner; readonly run: () => void } => {
  const target = PLAN_PERFORMANCE_TARGETS[targetName];
  const snapshot = createBenchmarkSnapshot(target);
  if (operation === "load") {
    const planner = createVenuePlanner(createBenchmarkPlan(target));
    return { planner, run: () => void planner.execute({ type: "restore_snapshot", snapshot: structuredClone(snapshot) }) };
  }
  const planner = plannerFromSnapshot(snapshot);
  if (operation === "branch-switch") {
    const targetBranchId = snapshot.branches.at(-1)?.id;
    if (!targetBranchId) throw new Error("Branch benchmark requires a target branch");
    return {
      planner,
      run: () =>
        void planner.execute({
          type: "switch_branch",
          branchId: targetBranchId,
          actor: "human",
          idempotencyKey: `benchmark-branch-switch-${targetName}`,
        }),
    };
  }
  if (operation === "approval") {
    const state = planner.getSnapshot();
    return {
      planner,
      run: () =>
        void planner.execute({
          type: "approve_proposal",
          actor: "human",
          actorId: "benchmark",
          proposalId: state.proposal.id,
          baseVersion: state.plan.version,
          idempotencyKey: `benchmark-approval-${targetName}`,
        }),
    };
  }
  const operations: Record<Exclude<PerformanceOperation, "approval" | "branch-switch" | "load">, () => void> = {
    inspection: () => void planner.execute({ type: "inspect_layout" }),
    preview: () =>
      void planner.execute({
        type: "preview_revision",
        goal: "B",
        actor: "agent",
        idempotencyKey: `benchmark-preview-${targetName}`,
      }),
    validation: () => void createValidationEngine().validate(planner.getSnapshot()),
    replay: () => void planner.execute({ type: "replay_history" }),
    export: () => void planner.execute({ type: "export_plan", format: "json" }),
  };
  return { planner, run: operations[operation] };
};

export function runPerformanceBenchmarks({
  targetName = "large",
  iterations = 3,
}: {
  readonly targetName?: PlanTargetName;
  readonly iterations?: number;
} = {}): BenchmarkReport {
  if (!Number.isInteger(iterations) || iterations < 1) throw new Error("Benchmark iterations must be positive");
  const target = PLAN_PERFORMANCE_TARGETS[targetName];
  const measurements = PERFORMANCE_OPERATIONS.map((operation): BenchmarkMeasurement => {
    const samples = Array.from({ length: iterations }, () => {
      const benchmark = setupOperation(targetName, operation);
      const startedAt = performance.now();
      benchmark.run();
      return performance.now() - startedAt;
    });
    const medianMs = median(samples);
    const budgetMs = target.budgetsMs[operation];
    return { operation, medianMs, budgetMs, passed: medianMs <= budgetMs };
  });
  return Object.freeze({
    target: targetName,
    iterations,
    measurements,
    passed: measurements.every((measurement) => measurement.passed),
  });
}
