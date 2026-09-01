import test from "node:test";
import assert from "node:assert/strict";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { compareSimulationResults, createScenarioRunner, exportSimulationRun, normalizeScenarioDefinition, SIMULATION_ENGINE_VERSION } from "../src/domain/scenario-engine.ts";
import { exportProjectPackage, previewProjectImport } from "../src/interchange/venue-package.ts";

const scenario = {
  id: "scenario-summit-day",
  name: "Summit day",
  seed: 73421,
  horizonSeconds: 3600,
  sampleCount: 128,
  phases: [
    { id: "phase-ingress", label: "Ingress", startSecond: 0, endSecond: 1200, demandShare: 0.65 },
    { id: "phase-program", label: "Program", startSecond: 1200, endSecond: 2400, demandShare: 0.1 },
    { id: "phase-egress", label: "Egress", startSecond: 2400, endSecond: 3600, demandShare: 0.25 },
  ],
  inputs: { population: 400, arrivalRatePerMinute: 28, serviceRatePerMinute: 9, servers: 3, mobilityFactor: 1.05 },
};

const activePlan = () => createVenuePlanner(summitForwardPlan).getSnapshot().plan;

test("Scenario normalization fixes phases, seed, horizon, inputs, and confidence metadata", () => {
  const normalized = normalizeScenarioDefinition(scenario);
  assert.equal(normalized.schemaVersion, 1);
  assert.equal(normalized.seed, 73421);
  assert.equal(normalized.phases.reduce((sum, phase) => sum + phase.demandShare, 0), 1);
  assert.equal(normalized.confidence.level, 0.95);
  assert.throws(() => normalizeScenarioDefinition({ ...scenario, phases: [{ id: "a", startSecond: 0, endSecond: 2000 }, { id: "b", startSecond: 1000, endSecond: 3000 }] }), /cannot overlap/);
});

test("same seed, engine version, Scenario, and geometry produce matching normalized outputs", async () => {
  const left = await createScenarioRunner().run({ scenario, plan: activePlan(), branchId: "branch-balanced" });
  const right = await createScenarioRunner().run({ scenario, plan: activePlan(), branchId: "branch-balanced" });

  assert.equal(left.status, "completed");
  assert.deepEqual(left.result, right.result);
  assert.equal(left.result.engineVersion, SIMULATION_ENGINE_VERSION);
  assert.equal(left.result.kind, "simulation-result");
  assert.equal("checks" in left.result, false);
  assert.equal("status" in left.result, false);
});

test("simulation cache is keyed by immutable input fingerprint", async () => {
  const runner = createScenarioRunner();
  const first = await runner.run({ scenario, plan: activePlan(), branchId: "branch-balanced" });
  const cached = await runner.run({ scenario, plan: activePlan(), branchId: "branch-balanced" });
  const changed = await runner.run({ scenario: { ...scenario, seed: scenario.seed + 1 }, plan: activePlan(), branchId: "branch-balanced" });

  assert.equal(first.cacheHit, false);
  assert.equal(cached.cacheHit, true);
  assert.deepEqual(cached.result, first.result);
  assert.notEqual(changed.result.inputFingerprint, first.result.inputFingerprint);
  assert.equal(runner.cacheSize(), 2);
});

test("a new input cancels the obsolete run and preserves an explicit partial result", async () => {
  const gates = [];
  const runner = createScenarioRunner({ scheduler: () => new Promise((resolve) => gates.push(resolve)) });
  const releaseNext = async () => {
    while (!gates.length) await Promise.resolve();
    gates.shift()();
    await Promise.resolve();
    await Promise.resolve();
  };
  const progress = [];
  const obsoletePromise = runner.run({ scenario, plan: activePlan(), branchId: "branch-balanced" }, { onProgress: (update) => progress.push(update) });
  await releaseNext();
  const replacementPromise = runner.run({ scenario: { ...scenario, seed: scenario.seed + 2 }, plan: activePlan(), branchId: "branch-balanced" });
  await releaseNext();
  const obsolete = await obsoletePromise;

  assert.equal(obsolete.status, "cancelled");
  assert.equal(obsolete.reason, "obsolete-input");
  assert.ok(progress.some((update) => update.progress > 0 && update.partialResult));

  while (runner.getActive()) await releaseNext();
  assert.equal((await replacementPromise).status, "completed");
});

test("completed results compare across branches and export with parameters", async () => {
  const runner = createScenarioRunner();
  const plan = activePlan();
  const left = await runner.run({ scenario, plan, branchId: "branch-left" });
  const narrowed = structuredClone(plan);
  const route = narrowed.objects.find((object) => object.id === "obj-route-exit-east");
  route.footprint.width = 0.95;
  narrowed.spatial.fingerprint = "geom-narrowed";
  const right = await runner.run({ scenario, plan: narrowed, branchId: "branch-right" });
  const comparison = compareSimulationResults(left.result, right.result);
  const exported = exportSimulationRun(scenario, right);
  const payload = JSON.parse(exported.content);

  assert.match(comparison.id, /^simulation-comparison-/);
  assert.equal(comparison.right.branchId, "branch-right");
  assert.ok(comparison.deltas.maximumP95BacklogPersons >= 0);
  assert.equal(payload.format, "venuemind-simulation");
  assert.equal(payload.scenario.seed, scenario.seed);
  assert.equal(payload.result.inputFingerprint, right.result.inputFingerprint);
});

test("planner stores progress, results, receipts, ledger evidence, comparison, and export", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const statuses = [];
  const unsubscribe = planner.subscribe(() => {
    const run = planner.getSnapshot().scenarioRuns.at(-1);
    if (run) statuses.push(`${run.status}:${run.progress}`);
  });
  const first = await planner.execute({ type: "run_scenario", scenario, branchId: "branch-balanced", actor: "agent", idempotencyKey: "scenario-run-001", correlationId: "scenario-corr-001" });
  const retry = await planner.execute({ type: "run_scenario", scenario, branchId: "branch-balanced", actor: "agent", idempotencyKey: "scenario-run-001", correlationId: "scenario-corr-001" });
  const runs = planner.execute({ type: "list_scenario_runs" });
  const comparison = planner.execute({ type: "compare_simulations", leftRunId: first.runId, rightRunId: first.runId });
  const exported = planner.execute({ type: "export_simulation", runId: first.runId });
  unsubscribe();

  assert.equal(first.status, "completed");
  assert.equal(retry.runId, first.runId);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].result.kind, "simulation-result");
  assert.ok(statuses.some((status) => status.startsWith("running:")));
  assert.equal(planner.getSnapshot().ledger.some((entry) => entry.type === "simulation.started"), true);
  assert.equal(planner.getSnapshot().ledger.some((entry) => entry.type === "simulation.completed"), true);
  assert.equal(planner.execute({ type: "replay_history" }).status, "pass");
  assert.equal(comparison.deltas.meanProcessedPersons, 0);
  assert.equal(JSON.parse(exported.content).result.inputFingerprint, first.inputFingerprint);
});

test("planner cancels an obsolete Simulation Run when Proposal input changes", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const running = planner.execute({ type: "run_scenario", scenario, actor: "agent", idempotencyKey: "scenario-obsolete-001" });
  planner.execute({ type: "preview_revision", goal: "Change the Proposal while simulation is active", actor: "agent", idempotencyKey: "scenario-proposal-change-001" });
  const outcome = await running;
  const stored = planner.execute({ type: "list_scenario_runs" }).find((run) => run.id === outcome.runId);

  assert.equal(outcome.status, "cancelled");
  assert.equal(outcome.reason, "proposal-changed");
  assert.equal(stored.status, "cancelled");
  assert.equal(stored.cancellationReason, "proposal-changed");
});

test("schema-v10 Interchange preserves completed Scenario definitions and Run results", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const run = await planner.execute({ type: "run_scenario", scenario, actor: "agent", idempotencyKey: "scenario-package-001" });
  const exported = await exportProjectPackage({ id: "project-scenario", name: "Scenario project", activePlanId: summitForwardPlan.id, schemaVersion: 10, snapshot: planner.getSnapshot(), createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" }, { clock: () => "2026-08-27T00:00:00.000Z" });
  const preview = await previewProjectImport(exported.content, { clock: () => "2026-08-27T00:00:00.000Z" });

  assert.equal(preview.record.schemaVersion, 10);
  assert.equal(preview.record.snapshot.scenarios[0].id, scenario.id);
  assert.equal(preview.record.snapshot.scenarioRuns[0].id, run.runId);
  assert.deepEqual(preview.record.snapshot.scenarioRuns[0].result, planner.getSnapshot().scenarioRuns[0].result);
});
