import { stableFingerprint } from "./activity-ledger.ts";
import { venueError } from "./errors.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const freeze: any = (value: any) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

export const OCCUPANCY_SIGNAL_KINDS = Object.freeze(["check-in", "zone-occupancy"]);
export const OCCUPANCY_SOURCE_TYPES = Object.freeze(["registration", "sensor", "manual-counter"]);
export const OCCUPANCY_CONFIDENCE_LEVELS = Object.freeze(["low", "medium", "high"]);
export const OCCUPANCY_ALERT_CODES = Object.freeze(["STALE_SOURCE", "CONFLICTING_FEEDS", "THRESHOLD_WARNING", "CAPACITY_EXCEEDED"]);

const DEFAULT_POLICY: any = Object.freeze({ freshAfterSeconds: 30, staleAfterSeconds: 120, warningRatio: 0.85, conflictTolerancePersons: 10, conflictToleranceRatio: 0.05 });
const PROHIBITED_KEY: any = /(name|email|phone|address|barcode|ticket|order|payment|device|attendee|person|user|contact|token|medical|diagnosis|note|scan)/i;
const ALLOWED_SIGNAL_KEYS: any = new Set(["sourceId", "sourceType", "sourceVersion", "kind", "observedAt", "confidence", "readings"]);
const ALLOWED_READING_KEYS: any = new Set(["scopeId", "count"]);
const confidenceRank: any = Object.freeze({ low: 0, medium: 1, high: 2 });
const rankConfidence: any = Object.freeze(["low", "medium", "high"]);

const invalid: any = (reason: any, details: any = {}) => {
  throw venueError("OCCUPANCY_SIGNAL_INVALID", { reason, ...details });
};

const assertAggregateOnly: any = (value: any, path: any = []) => {
  if (Array.isArray(value)) return value.forEach((item: any, index: any) => assertAggregateOnly(item, [...path, String(index)]));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (PROHIBITED_KEY.test(key)) throw venueError("OCCUPANCY_PRIVACY_REJECTED", { field: key, path: [...path, key].join(".") });
    assertAggregateOnly(item, [...path, key]);
  }
};

const iso: any = (value: any, field: any) => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(`${field}-invalid`);
  return value;
};

const text: any = (value: any, field: any) => {
  if (typeof value !== "string" || !value.trim() || value.length > 160) invalid(`${field}-invalid`);
  return value.trim();
};

const normalizePolicy: any = (input: any = {}) => {
  const policy: any = { ...DEFAULT_POLICY, ...input };
  if (!Number.isInteger(policy.freshAfterSeconds) || policy.freshAfterSeconds < 1 || !Number.isInteger(policy.staleAfterSeconds) || policy.staleAfterSeconds <= policy.freshAfterSeconds) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "freshness-policy-invalid" });
  if (![policy.warningRatio, policy.conflictToleranceRatio].every((value: any) => Number.isFinite(value) && value >= 0 && value <= 1) || !Number.isInteger(policy.conflictTolerancePersons) || policy.conflictTolerancePersons < 0) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "threshold-policy-invalid" });
  return policy;
};

const normalizeSimulation: any = (simulation: any, scopeIds: any, planFingerprint: any) => {
  if (simulation == null) return null;
  if (!simulation.runId || simulation.planFingerprint !== planFingerprint || !Array.isArray(simulation.expectedPeakByScope)) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "simulation-assumptions-invalid" });
  const expectedPeakByScope: any = simulation.expectedPeakByScope.map((item: any) => {
    if (!scopeIds.has(item.scopeId) || !Number.isInteger(item.count) || item.count < 0) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "simulation-scope-invalid", scopeId: item.scopeId ?? null });
    return { scopeId: item.scopeId, count: item.count };
  }).sort((left: any, right: any) => left.scopeId.localeCompare(right.scopeId));
  if (new Set(expectedPeakByScope.map((item: any) => item.scopeId)).size !== expectedPeakByScope.length) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "simulation-scope-duplicate" });
  return { runId: text(simulation.runId, "simulation-run-id"), planFingerprint, expectedPeakByScope };
};

const appendLedger: any = (monitor: any, type: any, details: any, metadata: any, committedAt: any) => {
  const sequence: any = monitor.ledger.length + 1;
  const previousHash: any = monitor.ledger.at(-1)?.hash ?? monitor.source.runbookLedgerHeadHash;
  const entry: any = { id: `occupancy-ledger-${String(sequence).padStart(6, "0")}`, schemaVersion: 1, sequence, type, actorType: metadata.actorType, actorId: metadata.actorId, source: metadata.source, sessionId: metadata.sessionId, committedAt, details: clone(details), previousHash };
  return { ...entry, hash: stableFingerprint("occupancy-ledger", entry) };
};

export function createLiveOccupancyMonitor({ projectId, runbook, plan = runbook?.baseline?.acceptedPlan, simulation = null, policy: policyInput, createdAt, createdBy }: any) {
  if (!projectId || !runbook?.versionId || runbook.status !== "active" || !plan?.id || plan.version === undefined || !plan.occupancy || !runbook.baseline?.acceptedBrief) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "runbook-plan-required" });
  const zones: any = (plan.occupancy.zones ?? []).map((zone: any) => {
    if (!zone.id || !Number.isInteger(zone.maximumCapacity) || zone.maximumCapacity < 1) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "zone-capacity-invalid", zoneId: zone.id ?? null });
    return { scopeId: zone.id, kind: "zone", label: zone.label ?? zone.id, target: zone.minimumCapacity ?? 0, capacity: zone.maximumCapacity };
  }).sort((left: any, right: any) => left.scopeId.localeCompare(right.scopeId));
  const venueCapacity: any = plan.occupancy.venueMaximum;
  const attendeeTarget: any = runbook.baseline.acceptedBrief.attendeeTarget;
  if (!Number.isInteger(venueCapacity) || venueCapacity < 1 || !Number.isInteger(attendeeTarget) || attendeeTarget < 0 || new Set(zones.map((zone: any) => zone.scopeId)).size !== zones.length) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "capacity-invalid" });
  const scopes: any = [{ scopeId: "check-in", kind: "check-in", label: "CHECK-IN", target: attendeeTarget, capacity: attendeeTarget }, { scopeId: "venue", kind: "venue", label: "VENUE", target: attendeeTarget, capacity: venueCapacity }, ...zones];
  const planFingerprint: any = runbook.source.planFingerprint;
  const baseline: any = { planId: plan.id, planVersion: plan.version, planFingerprint, attendeeTarget, scopes, simulation: normalizeSimulation(simulation, new Set(scopes.map((scope: any) => scope.scopeId)), planFingerprint) };
  baseline.fingerprint = stableFingerprint("occupancy-baseline", baseline);
  const now: any = iso(createdAt ?? new Date().toISOString(), "created-at");
  const id: any = `occupancy-${runbook.versionId}`;
  const monitor: any = { schemaVersion: 1, id, projectId, runbookVersionId: runbook.versionId, source: { planId: plan.id, planVersion: plan.version, planFingerprint, runbookDefinitionFingerprint: runbook.definitionFingerprint, runbookLedgerHeadHash: runbook.ledger.at(-1)?.hash ?? runbook.source.sourceLedgerHeadHash }, baseline, policy: normalizePolicy(policyInput), feeds: [], observations: [], activeAlerts: [], receipts: [], ledger: [], revision: 0, createdAt: now, updatedAt: now };
  monitor.ledger.push(appendLedger(monitor, "occupancy.monitor.created", { monitorId: id, baselineFingerprint: baseline.fingerprint, runbookVersionId: runbook.versionId }, { actorType: "human", actorId: text(createdBy, "created-by"), source: "studio", sessionId: "occupancy-create" }, now));
  return freeze(monitor);
}

const normalizeSignal: any = (monitor: any, input: any) => {
  assertAggregateOnly(input);
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key: any) => !ALLOWED_SIGNAL_KEYS.has(key))) invalid("signal-shape-invalid");
  const signal: any = {
    sourceId: text(input.sourceId, "source-id"),
    sourceType: input.sourceType,
    sourceVersion: text(input.sourceVersion, "source-version"),
    kind: input.kind,
    observedAt: iso(input.observedAt, "observed-at"),
    confidence: input.confidence,
    readings: Array.isArray(input.readings) ? input.readings.map((reading: any) => {
      if (!reading || typeof reading !== "object" || Array.isArray(reading) || Object.keys(reading).some((key: any) => !ALLOWED_READING_KEYS.has(key))) invalid("reading-shape-invalid");
      return { scopeId: text(reading.scopeId, "scope-id"), count: reading.count };
    }).sort((left: any, right: any) => left.scopeId.localeCompare(right.scopeId)) : invalid("readings-invalid"),
  };
  if (!OCCUPANCY_SOURCE_TYPES.includes(signal.sourceType) || !OCCUPANCY_SIGNAL_KINDS.includes(signal.kind) || !OCCUPANCY_CONFIDENCE_LEVELS.includes(signal.confidence)) invalid("signal-enum-invalid");
  if (signal.readings.length < 1 || signal.readings.length > 100 || new Set(signal.readings.map((reading: any) => reading.scopeId)).size !== signal.readings.length || signal.readings.some((reading: any) => !Number.isInteger(reading.count) || reading.count < 0 || reading.count > 1_000_000)) invalid("reading-count-invalid");
  const scopes: any = new Set(monitor.baseline.scopes.map((scope: any) => scope.scopeId));
  if (signal.readings.some((reading: any) => !scopes.has(reading.scopeId))) invalid("scope-not-found");
  if (signal.kind === "check-in" && (signal.sourceType !== "registration" || signal.readings.length !== 1 || signal.readings[0].scopeId !== "check-in")) invalid("check-in-scope-invalid");
  if (signal.kind === "zone-occupancy" && signal.readings.some((reading: any) => reading.scopeId === "check-in")) invalid("occupancy-scope-invalid");
  return signal;
};

const sourceKey: any = (signal: any) => `${signal.sourceId}\u0000${signal.kind}`;
const freshnessFor: any = (feed: any, at: any, policy: any) => {
  const ageSeconds: any = Math.max(0, (Date.parse(at) - Date.parse(feed.observedAt)) / 1000);
  return { ageSeconds, status: ageSeconds > policy.staleAfterSeconds ? "stale" : ageSeconds > policy.freshAfterSeconds ? "aging" : "fresh" };
};

const degradedConfidence: any = (confidence: any, freshness: any) => rankConfidence[Math.max(0, confidenceRank[confidence] - (freshness === "aging" ? 1 : 0))];

export function evaluateLiveOccupancy(monitor: any, { at }: any) {
  const evaluatedAt: any = iso(at, "evaluated-at");
  const sources: any = monitor.feeds.map((feed: any) => ({ sourceId: feed.sourceId, sourceType: feed.sourceType, sourceVersion: feed.sourceVersion, kind: feed.kind, observedAt: feed.observedAt, confidence: feed.confidence, ...freshnessFor(feed, evaluatedAt, monitor.policy) })).sort((left: any, right: any) => left.sourceId.localeCompare(right.sourceId) || left.kind.localeCompare(right.kind));
  const freshnessByKey: any = new Map(sources.map((source: any) => [`${source.sourceId}\u0000${source.kind}`, source]));
  const expected: any = new Map((monitor.baseline.simulation?.expectedPeakByScope ?? []).map((item: any) => [item.scopeId, item.count]));
  const alerts: any = sources.filter((source: any) => source.status === "stale").map((source: any) => ({ key: `STALE_SOURCE:${source.sourceId}:${source.kind}`, code: "STALE_SOURCE", severity: "warning", scopeId: null, sourceIds: [source.sourceId], actual: source.ageSeconds, threshold: monitor.policy.staleAfterSeconds, unit: "seconds" }));
  const scopes: any = monitor.baseline.scopes.map((scope: any) => {
    const candidates: any = monitor.feeds.flatMap((feed: any) => {
      const source: any = freshnessByKey.get(sourceKey(feed));
      const reading: any = feed.readings.find((item: any) => item.scopeId === scope.scopeId);
      return reading ? [{ ...reading, sourceId: feed.sourceId, signalKind: feed.kind, confidence: degradedConfidence(feed.confidence, source.status), freshness: source.status, observedAt: feed.observedAt }] : [];
    });
    const fresh: any = candidates.filter((item: any) => item.freshness !== "stale");
    const usable: any = fresh.length ? fresh : candidates;
    const counts: any = usable.map((item: any) => item.count);
    const count: any = counts.length ? Math.max(...counts) : null;
    const tolerance: any = Math.max(monitor.policy.conflictTolerancePersons, Math.ceil(scope.capacity * monitor.policy.conflictToleranceRatio));
    const conflict: any = fresh.length > 1 && Math.max(...fresh.map((item: any) => item.count)) - Math.min(...fresh.map((item: any) => item.count)) > tolerance;
    const stale: any = fresh.length === 0 && candidates.length > 0;
    const utilization: any = count == null || scope.capacity === 0 ? null : count / scope.capacity;
    let status: any = count == null ? "unavailable" : stale ? "stale" : conflict ? "conflicting" : count > scope.capacity ? "exceeded" : utilization >= monitor.policy.warningRatio ? "warning" : "nominal";
    if (conflict) alerts.push({ key: `CONFLICTING_FEEDS:${scope.scopeId}`, code: "CONFLICTING_FEEDS", severity: "warning", scopeId: scope.scopeId, sourceIds: fresh.map((item: any) => item.sourceId).sort(), actual: Math.max(...fresh.map((item: any) => item.count)) - Math.min(...fresh.map((item: any) => item.count)), threshold: tolerance, unit: "persons" });
    if (!stale && !conflict && count != null && count > scope.capacity) alerts.push({ key: `CAPACITY_EXCEEDED:${scope.scopeId}`, code: "CAPACITY_EXCEEDED", severity: "critical", scopeId: scope.scopeId, sourceIds: fresh.map((item: any) => item.sourceId).sort(), actual: count, threshold: scope.capacity, unit: "persons" });
    else if (!stale && !conflict && count != null && utilization >= monitor.policy.warningRatio) alerts.push({ key: `THRESHOLD_WARNING:${scope.scopeId}`, code: "THRESHOLD_WARNING", severity: "warning", scopeId: scope.scopeId, sourceIds: fresh.map((item: any) => item.sourceId).sort(), actual: count, threshold: Math.ceil(scope.capacity * monitor.policy.warningRatio), unit: "persons" });
    const confidence: any = conflict || stale || !usable.length ? "low" : rankConfidence[Math.min(...usable.map((item: any) => confidenceRank[item.confidence]))];
    const expectedPeak: any = expected.get(scope.scopeId) ?? null;
    return { ...scope, status, count, utilization, confidence, sourceIds: usable.map((item: any) => item.sourceId).sort(), freshness: usable.length ? (stale ? "stale" : usable.some((item: any) => item.freshness === "aging") ? "aging" : "fresh") : "missing", expectedPeak, simulationDelta: count == null || expectedPeak == null ? null : count - expectedPeak };
  });
  const priority: any = ["exceeded", "conflicting", "stale", "warning", "nominal", "unavailable"];
  const overallStatus: any = priority.find((candidate: any) => scopes.some((scope: any) => scope.status === candidate)) ?? "unavailable";
  return freeze({ monitorId: monitor.id, runbookVersionId: monitor.runbookVersionId, evaluatedAt, overallStatus, sources, scopes, alerts: alerts.sort((left: any, right: any) => left.code.localeCompare(right.code) || String(left.scopeId).localeCompare(String(right.scopeId)) || left.key.localeCompare(right.key)), privacy: { mode: "aggregate-only", personRecordsStored: false, individualEventsStored: false } });
}

const metadata: any = (command: any) => ({ actorType: command.actorType ?? "human", actorId: text(command.actorId, "actor-id"), source: command.source ?? "studio", sessionId: text(command.sessionId, "session-id") });
const receiptFingerprint: any = (kind: any, command: any) => {
  const input: any = kind === "ingest"
    ? { signal: command.signal, expectedRevision: command.expectedRevision }
    : kind === "refresh"
      ? { evaluatedAt: command.evaluatedAt, expectedRevision: command.expectedRevision }
      : { alertId: command.alertId, reasonCode: command.reasonCode, expectedRevision: command.expectedRevision };
  return stableFingerprint(`occupancy-${kind}`, input);
};

const retryReceipt: any = (monitor: any, command: any, fingerprint: any) => {
  const existing: any = monitor.receipts.find((receipt: any) => receipt.idempotencyKey === command.idempotencyKey);
  if (!existing) return null;
  if (existing.inputFingerprint !== fingerprint) throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
  return { monitor, projection: evaluateLiveOccupancy(monitor, { at: existing.acceptedAt }), receipt: existing, duplicate: true };
};

const reconcileAlerts: any = (next: any, projection: any, commandMetadata: any, committedAt: any) => {
  const previous: any = new Map(next.activeAlerts.map((alert: any) => [alert.key, alert]));
  const desired: any = new Map(projection.alerts.map((alert: any) => [alert.key, alert]));
  const activeAlerts: any[] = [];
  for (const descriptor of projection.alerts) {
    const current: any = previous.get(descriptor.key);
    if (current) activeAlerts.push(current);
    else {
      const alert: any = { id: stableFingerprint("occupancy-alert", { monitorId: next.id, key: descriptor.key, openedAt: committedAt }), ...clone(descriptor), status: "open", openedAt: committedAt };
      activeAlerts.push(alert);
      next.ledger.push(appendLedger(next, "occupancy.alert.opened", alert, commandMetadata, committedAt));
    }
  }
  for (const alert of previous.values()) if (!desired.has(alert.key)) next.ledger.push(appendLedger(next, "occupancy.alert.resolved", { ...alert, status: "resolved", resolvedAt: committedAt }, commandMetadata, committedAt));
  next.activeAlerts = activeAlerts.sort((left: any, right: any) => left.key.localeCompare(right.key));
};

const finalize: any = (monitor: any, command: any, kind: any, committedAt: any, mutate: any) => {
  if (!command.idempotencyKey) throw venueError("IDEMPOTENCY_KEY_REQUIRED");
  const fingerprint: any = receiptFingerprint(kind, command);
  const duplicate: any = retryReceipt(monitor, command, fingerprint);
  if (duplicate) return duplicate;
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision !== monitor.revision) throw venueError("OCCUPANCY_REVISION_CONFLICT", { expectedRevision: command.expectedRevision, currentRevision: monitor.revision });
  const next: any = clone(monitor);
  const commandMetadata: any = metadata(command);
  mutate(next, commandMetadata);
  next.revision += 1;
  next.updatedAt = committedAt;
  const projection: any = evaluateLiveOccupancy(next, { at: committedAt });
  reconcileAlerts(next, projection, commandMetadata, committedAt);
  const receipt: any = { id: stableFingerprint("occupancy-receipt", { monitorId: next.id, idempotencyKey: command.idempotencyKey, inputFingerprint: fingerprint }), idempotencyKey: command.idempotencyKey, inputFingerprint: fingerprint, operation: kind, revision: next.revision, acceptedAt: committedAt };
  next.receipts.push(receipt);
  return { monitor: freeze(next), projection: evaluateLiveOccupancy(next, { at: committedAt }), receipt: freeze(receipt), duplicate: false };
};

export function ingestOccupancySignal(monitor: any, command: any, { acceptedAt = new Date().toISOString() }: any = {}) {
  const committedAt: any = iso(acceptedAt, "accepted-at");
  const normalizedSignal: any = normalizeSignal(monitor, command.signal);
  const normalizedCommand: any = { ...command, signal: normalizedSignal };
  return finalize(monitor, normalizedCommand, "ingest", committedAt, (next: any, commandMetadata: any) => {
    if (Date.parse(normalizedSignal.observedAt) > Date.parse(committedAt)) invalid("observed-at-in-future");
    const key: any = sourceKey(normalizedSignal);
    const existing: any = next.feeds.find((feed: any) => sourceKey(feed) === key);
    if (existing && Date.parse(normalizedSignal.observedAt) <= Date.parse(existing.observedAt)) throw venueError("OCCUPANCY_SIGNAL_OUT_OF_ORDER", { sourceId: normalizedSignal.sourceId, kind: normalizedSignal.kind, currentObservedAt: existing.observedAt, receivedObservedAt: normalizedSignal.observedAt });
    next.feeds = [...next.feeds.filter((feed: any) => sourceKey(feed) !== key), { ...normalizedSignal, acceptedAt: committedAt, signalFingerprint: stableFingerprint("occupancy-signal", normalizedSignal) }].sort((left: any, right: any) => sourceKey(left).localeCompare(sourceKey(right)));
    const observation: any = { id: stableFingerprint("occupancy-observation", { monitorId: next.id, signal: normalizedSignal }), ...normalizedSignal, acceptedAt: committedAt };
    next.observations.push(observation);
    next.ledger.push(appendLedger(next, "occupancy.signal.accepted", { observationId: observation.id, sourceId: observation.sourceId, sourceType: observation.sourceType, sourceVersion: observation.sourceVersion, kind: observation.kind, observedAt: observation.observedAt, confidence: observation.confidence, readings: observation.readings }, commandMetadata, committedAt));
  });
}

export function refreshLiveOccupancy(monitor: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  const at: any = iso(command.evaluatedAt ?? committedAt, "evaluated-at");
  if (at !== committedAt) invalid("evaluation-commit-time-mismatch");
  return finalize(monitor, { ...command, evaluatedAt: at }, "refresh", at, (next: any, commandMetadata: any) => {
    next.ledger.push(appendLedger(next, "occupancy.monitor.refreshed", { evaluatedAt: at }, commandMetadata, at));
  });
}

export function acknowledgeOccupancyAlert(monitor: any, command: any, { acknowledgedAt = new Date().toISOString() }: any = {}) {
  const committedAt: any = iso(acknowledgedAt, "acknowledged-at");
  if (command.actorType !== "human") throw venueError("OCCUPANCY_ACKNOWLEDGEMENT_INVALID", { reason: "human-required" });
  const alertId: any = text(command.alertId, "alert-id");
  const reasonCode: any = text(command.reasonCode, "reason-code");
  return finalize(monitor, { ...command, alertId, reasonCode }, "acknowledge", committedAt, (next: any, commandMetadata: any) => {
    const alert: any = next.activeAlerts.find((candidate: any) => candidate.id === alertId);
    if (!alert) throw venueError("OCCUPANCY_ALERT_NOT_FOUND", { alertId });
    if (alert.status === "acknowledged") throw venueError("OCCUPANCY_ACKNOWLEDGEMENT_INVALID", { reason: "already-acknowledged", alertId });
    Object.assign(alert, { status: "acknowledged", acknowledgedAt: committedAt, acknowledgedBy: commandMetadata.actorId, reasonCode });
    next.ledger.push(appendLedger(next, "occupancy.alert.acknowledged", { alertId, alertKey: alert.key, code: alert.code, scopeId: alert.scopeId, acknowledgedBy: commandMetadata.actorId, reasonCode }, commandMetadata, committedAt));
  });
}

export function verifyOccupancyLedger(monitor: any) {
  let previousHash: any = monitor.source.runbookLedgerHeadHash;
  for (let index: any = 0; index < monitor.ledger.length; index += 1) {
    const entry: any = monitor.ledger[index];
    const { hash, ...unsigned } = entry;
    if (entry.sequence !== index + 1 || entry.previousHash !== previousHash || hash !== stableFingerprint("occupancy-ledger", unsigned)) return { status: "fail", sequence: entry.sequence };
    previousHash = hash;
  }
  return { status: "pass", entries: monitor.ledger.length, headHash: previousHash };
}

export function exportLiveOccupancyAudit(monitor: any, { exportedAt = new Date().toISOString() }: any = {}) {
  const at: any = iso(exportedAt, "exported-at");
  const integrity: any = verifyOccupancyLedger(monitor);
  if (integrity.status !== "pass") throw venueError("OCCUPANCY_LEDGER_INTEGRITY_FAILED", { sequence: integrity.sequence ?? null });
  const projection: any = evaluateLiveOccupancy(monitor, { at });
  const artifact: any = {
    schemaVersion: 1,
    kind: "venuemind-live-occupancy-audit",
    exportedAt: at,
    monitor: { id: monitor.id, projectId: monitor.projectId, runbookVersionId: monitor.runbookVersionId, schemaVersion: monitor.schemaVersion, revision: monitor.revision, createdAt: monitor.createdAt, updatedAt: monitor.updatedAt },
    source: clone(monitor.source),
    baseline: clone(monitor.baseline),
    policy: clone(monitor.policy),
    projection: clone(projection),
    feeds: clone(monitor.feeds),
    observations: clone(monitor.observations),
    activeAlerts: clone(monitor.activeAlerts),
    receipts: clone(monitor.receipts),
    integrity,
    ledger: clone(monitor.ledger),
    privacy: clone(projection.privacy),
  };
  return { filename: `${monitor.id}.audit.json`, mimeType: "application/json", content: JSON.stringify(artifact, null, 2) };
}

export function signalFromRegistrationSnapshot(snapshot: any) {
  if (!snapshot?.privacy || snapshot.privacy.mode !== "aggregate-only" || snapshot.privacy.individualCheckInStored !== false || !snapshot.checkIn) invalid("registration-snapshot-invalid");
  return normalizeRegistrationSignal(snapshot);
}

const normalizeRegistrationSignal: any = (snapshot: any) => ({ sourceId: snapshot.sourceSystem, sourceType: "registration", sourceVersion: snapshot.sourceVersion, kind: "check-in", observedAt: snapshot.checkIn.asOf, confidence: snapshot.status === "reconciled" ? "high" : "medium", readings: [{ scopeId: "check-in", count: snapshot.checkIn.total }] });
