import assert from "node:assert/strict";
import test from "node:test";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.js";
import { createOccupancyCommandBus } from "../src/domain/occupancy-command-bus.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";

const runbook = createEventDayRunbook({
  projectId: "project-summit-forward",
  plan: summitForwardPlan,
  validation: { validationId: "validation-occupancy-bus", inputFingerprint: "validation-input-occupancy-bus", status: "pass" },
  sourceLedgerHeadHash: "activity-ledger-occupancy-bus",
  approvalLedgerEntryId: "approval-occupancy-bus",
  frozenAt: "2026-09-12T10:00:00.000Z",
  frozenBy: "user-ops",
});

test("one occupancy command bus creates, ingests, inspects, acknowledges, refreshes, and exports", () => {
  const events = [];
  const bus = createOccupancyCommandBus({ onChange: (_monitor, event) => events.push(event.type) });
  const created = bus.execute({ type: "create_occupancy_monitor", projectId: "project-summit-forward", runbook, createdAt: "2026-09-12T11:00:00.000Z", createdBy: "user-ops" });
  const ingested = bus.execute({
    type: "ingest_occupancy_signal",
    expectedRevision: created.monitor.revision,
    signal: { sourceId: "sensor-east", sourceType: "sensor", sourceVersion: "sensor-east-001", kind: "zone-occupancy", observedAt: "2026-09-12T12:00:00.000Z", confidence: "high", readings: [{ scopeId: "zone-keynote-floor", count: 420 }] },
    idempotencyKey: "bus-ingest-001",
    actorType: "human",
    actorId: "user-ops",
    source: "studio",
    sessionId: "session-event-day",
    committedAt: "2026-09-12T12:00:05.000Z",
  });
  const inspected = bus.execute({ type: "inspect_live_occupancy", evaluatedAt: "2026-09-12T12:00:05.000Z" });
  assert.equal(inspected.projection.overallStatus, "exceeded");
  const alert = ingested.monitor.activeAlerts[0];
  bus.execute({ type: "acknowledge_occupancy_alert", alertId: alert.id, reasonCode: "ops-team-dispatched", expectedRevision: ingested.monitor.revision, idempotencyKey: "bus-ack-001", actorType: "human", actorId: "user-ops", source: "studio", sessionId: "session-event-day", committedAt: "2026-09-12T12:00:10.000Z" });
  const exported = bus.execute({ type: "export_live_occupancy", exportedAt: "2026-09-12T12:00:11.000Z" });
  assert.match(exported.filename, /\.audit\.json$/);
  assert.deepEqual(events, ["occupancy.monitor.created", "occupancy.signal.ingested", "occupancy.alert.acknowledged"]);
});
