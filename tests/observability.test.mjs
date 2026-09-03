import assert from "node:assert/strict";
import test from "node:test";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { createProjectStore } from "../src/persistence/project-store.ts";
import { createVenueToolService } from "../src/tools/venue-tool-service.ts";
import { createMemoryTelemetry, createTelemetryEvent, startTelemetrySpan } from "../src/observability/telemetry.ts";

const NOW = "2026-09-03T05:00:00.000Z";
const clock = () => NOW;

test("telemetry events are exact, bounded, and contain no arbitrary payload surface", () => {
  const telemetry = createMemoryTelemetry({ limit: 5, clock });
  for (let index = 0; index < 7; index += 1)
    telemetry.emit(
      createTelemetryEvent({
        component: "planner",
        operation: "command",
        outcome: index < 2 ? "failed" : "ok",
        correlationId: `corr-${index}`,
        action: "preview_revision",
        errorCode: index < 2 ? "COMMAND_FAILED" : undefined,
        occurredAt: NOW,
        eventId: `event-${index}`,
      }),
    );

  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.samples, 5);
  assert.equal(snapshot.failures, 0);
  assert.deepEqual(Object.keys(telemetry.trace("corr-6")[0]).sort(), [
    "action",
    "component",
    "correlationId",
    "durationMs",
    "errorCode",
    "eventId",
    "level",
    "occurredAt",
    "operation",
    "outcome",
    "schemaVersion",
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /payload|geometry|email|token|secret|identity/i);
});

test("health alerts use deterministic minimum samples and integrity thresholds", () => {
  const telemetry = createMemoryTelemetry({ clock });
  for (let index = 0; index < 5; index += 1)
    telemetry.emit(
      createTelemetryEvent({
        component: "api",
        operation: "request",
        outcome: index === 0 ? "failed" : "ok",
        correlationId: `corr-rate-${index}`,
        occurredAt: NOW,
      }),
    );
  telemetry.emit(
    createTelemetryEvent({
      component: "repository",
      operation: "integrity",
      outcome: "failed",
      correlationId: "corr-integrity",
      errorCode: "LEDGER_INTEGRITY_FAILED",
      occurredAt: NOW,
    }),
  );

  assert.deepEqual(
    telemetry.snapshot().alerts.map((alert) => alert.code),
    ["FAILURE_RATE_HIGH", "INTEGRITY_FAILURE"],
  );
  assert.equal(telemetry.snapshot().status, "error");
});

test("Approval correlation spans client, policy, Validation, ledger, and persistence failure", async () => {
  const telemetry = createMemoryTelemetry({ clock });
  let milliseconds = 0;
  const telemetryClock = { iso: clock, milliseconds: () => ++milliseconds };
  const correlationId = "corr-approval-persist-001";
  const client = startTelemetrySpan(
    telemetry,
    { component: "client", operation: "approval", correlationId, action: "approve_proposal" },
    telemetryClock,
  );
  const planner = createVenuePlanner(structuredClone(summitForwardPlan), { observability: telemetry, telemetryClock });
  const proposal = planner.getSnapshot().proposal;
  planner.execute({
    type: "approve_proposal",
    proposalId: proposal.id,
    baseVersion: proposal.baseVersion,
    actor: "human",
    idempotencyKey: "approval-observability-001",
    correlationId,
  });
  const store = createProjectStore({
    observability: telemetry,
    telemetryClock,
    clock,
    storage: {
      length: 0,
      getItem: () => null,
      key: () => null,
      setItem: () => undefined,
    },
    fetchImpl: async () => {
      throw new Error("network unavailable for test");
    },
  });
  const snapshot = planner.getSnapshot();
  const saved = await store.save({
    id: "project-observability",
    name: "Fixture",
    activePlanId: snapshot.plan.id,
    snapshot,
    createdAt: NOW,
  });
  client.end(
    saved.source === "remote" ? "approved" : "rejected",
    saved.source === "remote" ? undefined : "PERSISTENCE_FAILED",
  );

  const trace = telemetry.trace(correlationId);
  assert.equal(saved.source, "local");
  assert.deepEqual([...new Set(trace.map((event) => event.component))].sort(), ["client", "planner", "repository"]);
  for (const operation of ["policy", "validation", "approval", "ledger", "persistence"])
    assert.ok(
      trace.some((event) => event.operation === operation),
      `${operation} span missing`,
    );
  assert.ok(trace.some((event) => event.operation === "persistence" && event.outcome === "failed"));
  assert.equal(snapshot.receipts.at(-1).correlationId, correlationId);
});

test("tool adapter spans retain correlation without retaining tool input", async () => {
  const telemetry = createMemoryTelemetry({ clock });
  const planner = createVenuePlanner(structuredClone(summitForwardPlan));
  const service = createVenueToolService({
    observability: telemetry,
    executeCommand: (command) => planner.execute(command),
  });
  await service.execute("venue.inspect_layout", { correlationId: "corr-adapter-001" });
  const trace = telemetry.trace("corr-adapter-001");
  assert.ok(trace.some((event) => event.component === "adapter" && event.operation === "external-adapter"));
  assert.doesNotMatch(JSON.stringify(trace), /spatialObjects|roomBoundary|proposal/);
});
