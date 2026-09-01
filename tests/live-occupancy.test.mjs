import test from "node:test";
import assert from "node:assert/strict";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.js";
import { acknowledgeOccupancyAlert, createLiveOccupancyMonitor, evaluateLiveOccupancy, exportLiveOccupancyAudit, ingestOccupancySignal, refreshLiveOccupancy, signalFromRegistrationSnapshot, verifyOccupancyLedger } from "../src/domain/live-occupancy.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const makeRunbook = () => createEventDayRunbook({
  projectId: "project-summit-forward",
  plan: summitForwardPlan,
  brief: summitForwardPlan.brief,
  validation: { validationId: "validation-approved", inputFingerprint: "input-approved", status: "pass" },
  sourceLedgerHeadHash: "ledger-source-head",
  approvalLedgerEntryId: "ledger-approval",
  frozenAt: "2026-09-11T20:00:00.000Z",
  frozenBy: "user-ops",
});
const makeMonitor = (overrides = {}) => createLiveOccupancyMonitor({
  projectId: "project-summit-forward",
  runbook: makeRunbook(),
  createdAt: "2026-09-12T11:00:00.000Z",
  createdBy: "user-ops",
  simulation: { runId: "scenario-run-approved", planFingerprint: makeRunbook().source.planFingerprint, expectedPeakByScope: [{ scopeId: "zone-keynote-floor", count: 360 }] },
  ...overrides,
});
const command = (monitor, signal, suffix = signal.sourceId) => ({
  signal,
  expectedRevision: monitor.revision,
  idempotencyKey: `occupancy-${suffix}-${signal.sourceVersion}`,
  actorType: "human",
  actorId: "user-ops",
  source: "studio",
  sessionId: "session-event-day",
});
const zoneSignal = (sourceId, count, overrides = {}) => ({
  sourceId,
  sourceType: "sensor",
  sourceVersion: `${sourceId}-001`,
  kind: "zone-occupancy",
  observedAt: "2026-09-12T12:00:00.000Z",
  confidence: "high",
  readings: [{ scopeId: "zone-keynote-floor", count }],
  ...overrides,
});

test("Live Occupancy Monitor freezes Runbook, Plan capacity, and simulation assumptions", () => {
  const monitor = makeMonitor();
  assert.equal(monitor.runbookVersionId, makeRunbook().versionId);
  assert.equal(monitor.baseline.scopes.find((scope) => scope.scopeId === "zone-keynote-floor").capacity, 410);
  assert.equal(monitor.baseline.simulation.expectedPeakByScope[0].count, 360);
  assert.equal(evaluateLiveOccupancy(monitor, { at: "2026-09-12T12:00:00.000Z" }).overallStatus, "unavailable");
  assert.equal(verifyOccupancyLedger(monitor).status, "pass");
  assert.ok(Object.isFrozen(monitor.baseline));
});

test("aggregate check-in and zone signals expose freshness, confidence, thresholds, and simulation deltas", () => {
  let monitor = makeMonitor();
  const registration = { sourceId: "registration-prod", sourceType: "registration", sourceVersion: "reg-001", kind: "check-in", observedAt: "2026-09-12T11:59:55.000Z", confidence: "high", readings: [{ scopeId: "check-in", count: 320 }] };
  ({ monitor } = ingestOccupancySignal(monitor, command(monitor, registration), { acceptedAt: "2026-09-12T12:00:00.000Z" }));
  const result = ingestOccupancySignal(monitor, command(monitor, zoneSignal("sensor-east", 350)), { acceptedAt: "2026-09-12T12:00:05.000Z" });
  const zone = result.projection.scopes.find((scope) => scope.scopeId === "zone-keynote-floor");
  assert.equal(zone.status, "warning");
  assert.equal(zone.freshness, "fresh");
  assert.equal(zone.confidence, "high");
  assert.equal(zone.simulationDelta, -10);
  assert.equal(result.projection.scopes.find((scope) => scope.scopeId === "check-in").count, 320);
  assert.ok(result.monitor.activeAlerts.some((alert) => alert.code === "THRESHOLD_WARNING" && alert.scopeId === "zone-keynote-floor"));
});

test("over-capacity, conflicting, and stale feeds are distinct auditable states", () => {
  let monitor = makeMonitor();
  ({ monitor } = ingestOccupancySignal(monitor, command(monitor, zoneSignal("sensor-east", 420)), { acceptedAt: "2026-09-12T12:00:05.000Z" }));
  assert.equal(evaluateLiveOccupancy(monitor, { at: "2026-09-12T12:00:05.000Z" }).scopes.find((scope) => scope.scopeId === "zone-keynote-floor").status, "exceeded");
  assert.ok(monitor.ledger.some((entry) => entry.type === "occupancy.alert.opened" && entry.details.code === "CAPACITY_EXCEEDED"));

  ({ monitor } = ingestOccupancySignal(monitor, command(monitor, zoneSignal("sensor-west", 360)), { acceptedAt: "2026-09-12T12:00:06.000Z" }));
  const conflicting = evaluateLiveOccupancy(monitor, { at: "2026-09-12T12:00:06.000Z" });
  assert.equal(conflicting.scopes.find((scope) => scope.scopeId === "zone-keynote-floor").status, "conflicting");
  assert.ok(conflicting.alerts.some((alert) => alert.code === "CONFLICTING_FEEDS"));
  assert.ok(monitor.ledger.some((entry) => entry.type === "occupancy.alert.resolved" && entry.details.code === "CAPACITY_EXCEEDED"));

  const refreshed = refreshLiveOccupancy(monitor, { expectedRevision: monitor.revision, evaluatedAt: "2026-09-12T12:03:00.000Z", idempotencyKey: "refresh-1203", actorId: "user-ops", source: "studio", sessionId: "session-event-day" }, { committedAt: "2026-09-12T12:03:00.000Z" });
  assert.equal(refreshed.projection.scopes.find((scope) => scope.scopeId === "zone-keynote-floor").status, "stale");
  assert.equal(refreshed.projection.sources.every((source) => source.status === "stale"), true);
  assert.ok(refreshed.monitor.ledger.some((entry) => entry.type === "occupancy.alert.opened" && entry.details.code === "STALE_SOURCE"));
  assert.equal(verifyOccupancyLedger(refreshed.monitor).status, "pass");
});

test("privacy screening rejects person-level fields before signal storage", () => {
  const monitor = makeMonitor();
  const unsafe = { ...zoneSignal("sensor-east", 100), readings: [{ scopeId: "zone-keynote-floor", count: 100, attendeeName: "private" }] };
  assert.throws(() => ingestOccupancySignal(monitor, command(monitor, unsafe), { acceptedAt: "2026-09-12T12:00:05.000Z" }), (error) => error.code === "OCCUPANCY_PRIVACY_REJECTED" && error.details.field === "attendeeName");
  assert.equal(monitor.observations.length, 0);
});

test("exact retries are duplicate-safe while stale revisions and source rollback fail", () => {
  const initial = makeMonitor();
  const signal = zoneSignal("sensor-east", 100);
  const input = command(initial, signal);
  const first = ingestOccupancySignal(initial, input, { acceptedAt: "2026-09-12T12:00:05.000Z" });
  const retry = ingestOccupancySignal(first.monitor, input, { acceptedAt: "2026-09-12T12:00:10.000Z" });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.monitor.observations.length, 1);
  assert.equal(retry.monitor.receipts.length, 1);
  assert.throws(() => ingestOccupancySignal(first.monitor, { ...command(first.monitor, zoneSignal("sensor-west", 90)), expectedRevision: 0 }, { acceptedAt: "2026-09-12T12:00:10.000Z" }), (error) => error.code === "OCCUPANCY_REVISION_CONFLICT");
  const older = zoneSignal("sensor-east", 95, { sourceVersion: "sensor-east-000", observedAt: "2026-09-12T11:59:59.000Z" });
  assert.throws(() => ingestOccupancySignal(first.monitor, command(first.monitor, older), { acceptedAt: "2026-09-12T12:00:10.000Z" }), (error) => error.code === "OCCUPANCY_SIGNAL_OUT_OF_ORDER");
});

test("Registration Snapshot bridge retains only canonical aggregate check-in evidence", () => {
  const signal = signalFromRegistrationSnapshot({ sourceSystem: "registration-prod", sourceVersion: "reg-001", status: "reconciled", checkIn: { asOf: "2026-09-12T11:59:55.000Z", total: 200, byTicketClass: [{ ticketClassId: "registration-prod:general", count: 200 }] }, privacy: { mode: "aggregate-only", attendeeIdentityStored: false, individualCheckInStored: false, freeFormAccessibilityStored: false } });
  assert.deepEqual(signal, { sourceId: "registration-prod", sourceType: "registration", sourceVersion: "reg-001", kind: "check-in", observedAt: "2026-09-12T11:59:55.000Z", confidence: "high", readings: [{ scopeId: "check-in", count: 200 }] });
});

test("Occupancy Incident Ledger rejects tampering", () => {
  let monitor = makeMonitor();
  ({ monitor } = ingestOccupancySignal(monitor, command(monitor, zoneSignal("sensor-east", 420)), { acceptedAt: "2026-09-12T12:00:05.000Z" }));
  const tampered = clone(monitor);
  tampered.ledger.at(-1).details.actual = 1;
  assert.equal(verifyOccupancyLedger(tampered).status, "fail");
});

test("human acknowledgement retains the active operational state and appends one auditable transition", () => {
  let monitor = makeMonitor();
  ({ monitor } = ingestOccupancySignal(monitor, command(monitor, zoneSignal("sensor-east", 420)), { acceptedAt: "2026-09-12T12:00:05.000Z" }));
  const alert = monitor.activeAlerts.find((candidate) => candidate.code === "CAPACITY_EXCEEDED");
  const acknowledgement = {
    alertId: alert.id,
    reasonCode: "ops-team-dispatched",
    expectedRevision: monitor.revision,
    idempotencyKey: "occupancy-ack-capacity-001",
    actorType: "human",
    actorId: "user-ops",
    source: "studio",
    sessionId: "session-event-day",
  };
  const result = acknowledgeOccupancyAlert(monitor, acknowledgement, { acknowledgedAt: "2026-09-12T12:00:10.000Z" });
  assert.equal(result.projection.overallStatus, "exceeded");
  assert.deepEqual(
    result.monitor.activeAlerts.find((candidate) => candidate.id === alert.id),
    { ...alert, status: "acknowledged", acknowledgedAt: "2026-09-12T12:00:10.000Z", acknowledgedBy: "user-ops", reasonCode: "ops-team-dispatched" },
  );
  assert.ok(result.monitor.ledger.some((entry) => entry.type === "occupancy.alert.acknowledged" && entry.details.alertId === alert.id));
  assert.equal(verifyOccupancyLedger(result.monitor).status, "pass");
  const retry = acknowledgeOccupancyAlert(result.monitor, acknowledgement, { acknowledgedAt: "2026-09-12T12:00:20.000Z" });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.monitor.ledger.length, result.monitor.ledger.length);
});

test("Live Occupancy audit export binds baseline, projection, receipts, and verified incident evidence", () => {
  let monitor = makeMonitor();
  ({ monitor } = ingestOccupancySignal(monitor, command(monitor, zoneSignal("sensor-east", 350)), { acceptedAt: "2026-09-12T12:00:05.000Z" }));
  const artifact = exportLiveOccupancyAudit(monitor, { exportedAt: "2026-09-12T12:00:10.000Z" });
  const body = JSON.parse(artifact.content);
  assert.equal(artifact.filename, `${monitor.id}.audit.json`);
  assert.equal(body.kind, "venuemind-live-occupancy-audit");
  assert.equal(body.monitor.id, monitor.id);
  assert.equal(body.projection.scopes.find((scope) => scope.scopeId === "zone-keynote-floor").count, 350);
  assert.deepEqual(body.integrity, verifyOccupancyLedger(monitor));
  assert.equal(body.receipts.length, 1);
  assert.equal(body.privacy.mode, "aggregate-only");
});
