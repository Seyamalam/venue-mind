import { stableFingerprint } from "./activity-ledger.ts";
import { venueError } from "./errors.ts";
import type {
  AcknowledgeOccupancyAlertCommand,
  ActorType,
  AggregateOccupancySignal,
  CreateOccupancyMonitorCommand,
  ExportLiveOccupancyCommand,
  IngestOccupancySignalCommand,
  LiveOccupancyMonitor,
  OccupancyAlert,
  OccupancyAlertDescriptor,
  OccupancyAuditArtifact,
  OccupancyConfidence,
  OccupancyFeed,
  OccupancyLedgerEntry,
  OccupancyMutationCommand,
  OccupancyMutationResult,
  OccupancyPolicy,
  OccupancyProjection,
  OccupancyReceipt,
  OccupancyScopeBaseline,
  OccupancyScopeProjection,
  OccupancyScopeStatus,
  OccupancySimulationBaseline,
  OccupancySourceProjection,
  OperationalSource,
  RefreshLiveOccupancyCommand,
} from "./operational-types.ts";

const clone = <T>(value: T): T => structuredClone(value);
const freeze = <T>(value: T): Readonly<T> => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

export const OCCUPANCY_SIGNAL_KINDS = Object.freeze(["check-in", "zone-occupancy"] as const);
export const OCCUPANCY_SOURCE_TYPES = Object.freeze(["registration", "sensor", "manual-counter"] as const);
export const OCCUPANCY_CONFIDENCE_LEVELS = Object.freeze([
  "low",
  "medium",
  "high",
] as const satisfies readonly OccupancyConfidence[]);
export const OCCUPANCY_ALERT_CODES = Object.freeze([
  "STALE_SOURCE",
  "CONFLICTING_FEEDS",
  "THRESHOLD_WARNING",
  "CAPACITY_EXCEEDED",
] as const);

const DEFAULT_POLICY = Object.freeze({
  freshAfterSeconds: 30,
  staleAfterSeconds: 120,
  warningRatio: 0.85,
  conflictTolerancePersons: 10,
  conflictToleranceRatio: 0.05,
});
const PROHIBITED_KEY =
  /(name|email|phone|address|barcode|ticket|order|payment|device|attendee|person|user|contact|token|medical|diagnosis|note|scan)/i;
const ALLOWED_SIGNAL_KEYS = new Set([
  "sourceId",
  "sourceType",
  "sourceVersion",
  "kind",
  "observedAt",
  "confidence",
  "readings",
]);
const ALLOWED_READING_KEYS = new Set(["scopeId", "count"]);
const confidenceRank: Readonly<Record<OccupancyConfidence, number>> = Object.freeze({ low: 0, medium: 1, high: 2 });
const rankConfidence: readonly OccupancyConfidence[] = Object.freeze(["low", "medium", "high"]);

function invalid(reason: string, details: object = {}): never {
  throw venueError("OCCUPANCY_SIGNAL_INVALID", { reason, ...details });
}

const assertAggregateOnly = (value: unknown, path: string[] = []): void => {
  if (Array.isArray(value)) return value.forEach((item, index) => assertAggregateOnly(item, [...path, String(index)]));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (PROHIBITED_KEY.test(key))
      throw venueError("OCCUPANCY_PRIVACY_REJECTED", { field: key, path: [...path, key].join(".") });
    assertAggregateOnly(item, [...path, key]);
  }
};

const iso = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) invalid(`${field}-invalid`);
  return value;
};

const text = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 160) invalid(`${field}-invalid`);
  return value.trim();
};
const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

const normalizePolicy = (input: Partial<OccupancyPolicy> = {}): OccupancyPolicy => {
  const policy = { ...DEFAULT_POLICY, ...input };
  if (
    !Number.isInteger(policy.freshAfterSeconds) ||
    policy.freshAfterSeconds < 1 ||
    !Number.isInteger(policy.staleAfterSeconds) ||
    policy.staleAfterSeconds <= policy.freshAfterSeconds
  )
    throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "freshness-policy-invalid" });
  if (
    ![policy.warningRatio, policy.conflictToleranceRatio].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) ||
    !Number.isInteger(policy.conflictTolerancePersons) ||
    policy.conflictTolerancePersons < 0
  )
    throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "threshold-policy-invalid" });
  return policy;
};

const normalizeSimulation = (
  simulation: OccupancySimulationBaseline | null,
  scopeIds: ReadonlySet<string>,
  planFingerprint: string,
): OccupancySimulationBaseline | null => {
  if (simulation == null) return null;
  if (
    !simulation.runId ||
    simulation.planFingerprint !== planFingerprint ||
    !isUnknownArray(simulation.expectedPeakByScope)
  )
    throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "simulation-assumptions-invalid" });
  const expectedPeakByScope = simulation.expectedPeakByScope
    .map((item) => {
      if (!scopeIds.has(item.scopeId) || !Number.isInteger(item.count) || item.count < 0)
        throw venueError("OCCUPANCY_BASELINE_INVALID", {
          reason: "simulation-scope-invalid",
          scopeId: item.scopeId ?? null,
        });
      return { scopeId: item.scopeId, count: item.count };
    })
    .sort((left, right) => left.scopeId.localeCompare(right.scopeId));
  if (new Set(expectedPeakByScope.map((item) => item.scopeId)).size !== expectedPeakByScope.length)
    throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "simulation-scope-duplicate" });
  return { runId: text(simulation.runId, "simulation-run-id"), planFingerprint, expectedPeakByScope };
};

interface CommandMetadata {
  actorType: ActorType;
  actorId: string;
  source: OperationalSource;
  sessionId: string;
}
const appendLedger = (
  monitor: LiveOccupancyMonitor,
  type: string,
  details: object,
  metadata: CommandMetadata,
  committedAt: string,
): OccupancyLedgerEntry => {
  const sequence = monitor.ledger.length + 1;
  const previousHash = monitor.ledger.at(-1)?.hash ?? monitor.source.runbookLedgerHeadHash;
  const entry: Omit<OccupancyLedgerEntry, "hash"> = {
    id: `occupancy-ledger-${String(sequence).padStart(6, "0")}`,
    schemaVersion: 1,
    sequence,
    type,
    actorType: metadata.actorType,
    actorId: metadata.actorId,
    source: metadata.source,
    sessionId: metadata.sessionId,
    committedAt,
    details: clone(details),
    previousHash,
  };
  return { ...entry, hash: stableFingerprint("occupancy-ledger", entry) };
};

export function createLiveOccupancyMonitor({
  projectId,
  runbook,
  plan = runbook.baseline.acceptedPlan,
  simulation = null,
  policy: policyInput,
  createdAt,
  createdBy,
}: CreateOccupancyMonitorCommand): Readonly<LiveOccupancyMonitor> {
  if (
    !projectId ||
    !runbook?.versionId ||
    runbook.status !== "active" ||
    !plan?.id ||
    plan.version === undefined ||
    !plan.occupancy ||
    !runbook.baseline?.acceptedBrief
  )
    throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "runbook-plan-required" });
  const zones: OccupancyScopeBaseline[] = (plan.occupancy.zones ?? [])
    .map((zone): OccupancyScopeBaseline => {
      if (!zone.id || !Number.isInteger(zone.maximumCapacity) || zone.maximumCapacity < 1)
        throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "zone-capacity-invalid", zoneId: zone.id ?? null });
      return {
        scopeId: zone.id,
        kind: "zone",
        label: zone.label ?? zone.id,
        target: zone.minimumCapacity ?? 0,
        capacity: zone.maximumCapacity,
      };
    })
    .sort((left, right) => left.scopeId.localeCompare(right.scopeId));
  const venueCapacity = plan.occupancy.venueMaximum;
  const attendeeTarget = runbook.baseline.acceptedBrief.attendeeTarget;
  if (
    !Number.isInteger(venueCapacity) ||
    venueCapacity < 1 ||
    !Number.isInteger(attendeeTarget) ||
    attendeeTarget < 0 ||
    new Set(zones.map((zone) => zone.scopeId)).size !== zones.length
  )
    throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "capacity-invalid" });
  const scopes: LiveOccupancyMonitor["baseline"]["scopes"] = [
    { scopeId: "check-in", kind: "check-in", label: "CHECK-IN", target: attendeeTarget, capacity: attendeeTarget },
    { scopeId: "venue", kind: "venue", label: "VENUE", target: attendeeTarget, capacity: venueCapacity },
    ...zones,
  ];
  const planFingerprint = runbook.source.planFingerprint;
  const baselineSeed = {
    planId: plan.id,
    planVersion: plan.version,
    planFingerprint,
    attendeeTarget,
    scopes,
    simulation: normalizeSimulation(simulation, new Set(scopes.map((scope) => scope.scopeId)), planFingerprint),
  };
  const baseline: LiveOccupancyMonitor["baseline"] = {
    ...baselineSeed,
    fingerprint: stableFingerprint("occupancy-baseline", baselineSeed),
  };
  const now = iso(createdAt ?? new Date().toISOString(), "created-at");
  const id = `occupancy-${runbook.versionId}`;
  const monitor: LiveOccupancyMonitor = {
    schemaVersion: 1,
    id,
    projectId,
    runbookVersionId: runbook.versionId,
    source: {
      planId: plan.id,
      planVersion: plan.version,
      planFingerprint,
      runbookDefinitionFingerprint: runbook.definitionFingerprint,
      runbookLedgerHeadHash: runbook.ledger.at(-1)?.hash ?? runbook.source.sourceLedgerHeadHash,
    },
    baseline,
    policy: normalizePolicy(policyInput),
    feeds: [],
    observations: [],
    activeAlerts: [],
    receipts: [],
    ledger: [],
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
  monitor.ledger.push(
    appendLedger(
      monitor,
      "occupancy.monitor.created",
      { monitorId: id, baselineFingerprint: baseline.fingerprint, runbookVersionId: runbook.versionId },
      { actorType: "human", actorId: text(createdBy, "created-by"), source: "studio", sessionId: "occupancy-create" },
      now,
    ),
  );
  return freeze(monitor);
}

const normalizeSignal = (monitor: LiveOccupancyMonitor, input: AggregateOccupancySignal): AggregateOccupancySignal => {
  assertAggregateOnly(input);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !ALLOWED_SIGNAL_KEYS.has(key))
  )
    invalid("signal-shape-invalid");
  const signal = {
    sourceId: text(input.sourceId, "source-id"),
    sourceType: input.sourceType,
    sourceVersion: text(input.sourceVersion, "source-version"),
    kind: input.kind,
    observedAt: iso(input.observedAt, "observed-at"),
    confidence: input.confidence,
    readings: isUnknownArray(input.readings)
      ? input.readings
          .map((reading) => {
            if (
              !reading ||
              typeof reading !== "object" ||
              Array.isArray(reading) ||
              Object.keys(reading).some((key) => !ALLOWED_READING_KEYS.has(key))
            )
              invalid("reading-shape-invalid");
            return { scopeId: text(reading.scopeId, "scope-id"), count: reading.count };
          })
          .sort((left, right) => left.scopeId.localeCompare(right.scopeId))
      : invalid("readings-invalid"),
  };
  if (
    !OCCUPANCY_SOURCE_TYPES.includes(signal.sourceType) ||
    !OCCUPANCY_SIGNAL_KINDS.includes(signal.kind) ||
    !OCCUPANCY_CONFIDENCE_LEVELS.includes(signal.confidence)
  )
    invalid("signal-enum-invalid");
  if (
    signal.readings.length < 1 ||
    signal.readings.length > 100 ||
    new Set(signal.readings.map((reading) => reading.scopeId)).size !== signal.readings.length ||
    signal.readings.some(
      (reading) => !Number.isInteger(reading.count) || reading.count < 0 || reading.count > 1_000_000,
    )
  )
    invalid("reading-count-invalid");
  const scopes = new Set(monitor.baseline.scopes.map((scope) => scope.scopeId));
  if (signal.readings.some((reading) => !scopes.has(reading.scopeId))) invalid("scope-not-found");
  if (
    signal.kind === "check-in" &&
    (signal.sourceType !== "registration" || signal.readings.length !== 1 || signal.readings[0]?.scopeId !== "check-in")
  )
    invalid("check-in-scope-invalid");
  if (signal.kind === "zone-occupancy" && signal.readings.some((reading) => reading.scopeId === "check-in"))
    invalid("occupancy-scope-invalid");
  return signal;
};

const sourceKey = (signal: AggregateOccupancySignal): string => `${signal.sourceId}\u0000${signal.kind}`;
const freshnessFor = (
  feed: OccupancyFeed,
  at: string,
  policy: OccupancyPolicy,
): { ageSeconds: number; status: OccupancySourceProjection["status"] } => {
  const ageSeconds = Math.max(0, (Date.parse(at) - Date.parse(feed.observedAt)) / 1000);
  return {
    ageSeconds,
    status: ageSeconds > policy.staleAfterSeconds ? "stale" : ageSeconds > policy.freshAfterSeconds ? "aging" : "fresh",
  };
};

const degradedConfidence = (
  confidence: OccupancyConfidence,
  freshness: OccupancySourceProjection["status"],
): OccupancyConfidence =>
  rankConfidence[Math.max(0, confidenceRank[confidence] - (freshness === "aging" ? 1 : 0))] ?? "low";

export function evaluateLiveOccupancy(
  monitor: LiveOccupancyMonitor,
  { at }: { at: string },
): Readonly<OccupancyProjection> {
  const evaluatedAt = iso(at, "evaluated-at");
  const sources = monitor.feeds
    .map((feed) => ({
      sourceId: feed.sourceId,
      sourceType: feed.sourceType,
      sourceVersion: feed.sourceVersion,
      kind: feed.kind,
      observedAt: feed.observedAt,
      confidence: feed.confidence,
      ...freshnessFor(feed, evaluatedAt, monitor.policy),
    }))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId) || left.kind.localeCompare(right.kind));
  const freshnessByKey = new Map(sources.map((source) => [`${source.sourceId}\u0000${source.kind}`, source]));
  const expected = new Map(
    (monitor.baseline.simulation?.expectedPeakByScope ?? []).map((item) => [item.scopeId, item.count]),
  );
  const alerts: OccupancyAlertDescriptor[] = sources
    .filter((source) => source.status === "stale")
    .map((source) => ({
      key: `STALE_SOURCE:${source.sourceId}:${source.kind}`,
      code: "STALE_SOURCE",
      severity: "warning",
      scopeId: null,
      sourceIds: [source.sourceId],
      actual: source.ageSeconds,
      threshold: monitor.policy.staleAfterSeconds,
      unit: "seconds",
    }));
  const scopes: OccupancyScopeProjection[] = monitor.baseline.scopes.map((scope) => {
    const candidates = monitor.feeds.flatMap((feed) => {
      const source = freshnessByKey.get(sourceKey(feed));
      if (!source) return [];
      const reading = feed.readings.find((item) => item.scopeId === scope.scopeId);
      return reading
        ? [
            {
              ...reading,
              sourceId: feed.sourceId,
              signalKind: feed.kind,
              confidence: degradedConfidence(feed.confidence, source.status),
              freshness: source.status,
              observedAt: feed.observedAt,
            },
          ]
        : [];
    });
    const fresh = candidates.filter((item) => item.freshness !== "stale");
    const usable = fresh.length ? fresh : candidates;
    const counts = usable.map((item) => item.count);
    const count = counts.length ? Math.max(...counts) : null;
    const tolerance = Math.max(
      monitor.policy.conflictTolerancePersons,
      Math.ceil(scope.capacity * monitor.policy.conflictToleranceRatio),
    );
    const conflict =
      fresh.length > 1 &&
      Math.max(...fresh.map((item) => item.count)) - Math.min(...fresh.map((item) => item.count)) > tolerance;
    const stale = fresh.length === 0 && candidates.length > 0;
    const utilization = count == null || scope.capacity === 0 ? null : count / scope.capacity;
    const status: OccupancyScopeStatus =
      count == null
        ? "unavailable"
        : stale
          ? "stale"
          : conflict
            ? "conflicting"
            : count > scope.capacity
              ? "exceeded"
              : utilization !== null && utilization >= monitor.policy.warningRatio
                ? "warning"
                : "nominal";
    if (conflict)
      alerts.push({
        key: `CONFLICTING_FEEDS:${scope.scopeId}`,
        code: "CONFLICTING_FEEDS",
        severity: "warning",
        scopeId: scope.scopeId,
        sourceIds: fresh.map((item) => item.sourceId).sort(),
        actual: Math.max(...fresh.map((item) => item.count)) - Math.min(...fresh.map((item) => item.count)),
        threshold: tolerance,
        unit: "persons",
      });
    if (!stale && !conflict && count != null && count > scope.capacity)
      alerts.push({
        key: `CAPACITY_EXCEEDED:${scope.scopeId}`,
        code: "CAPACITY_EXCEEDED",
        severity: "critical",
        scopeId: scope.scopeId,
        sourceIds: fresh.map((item) => item.sourceId).sort(),
        actual: count,
        threshold: scope.capacity,
        unit: "persons",
      });
    else if (!stale && !conflict && count != null && utilization !== null && utilization >= monitor.policy.warningRatio)
      alerts.push({
        key: `THRESHOLD_WARNING:${scope.scopeId}`,
        code: "THRESHOLD_WARNING",
        severity: "warning",
        scopeId: scope.scopeId,
        sourceIds: fresh.map((item) => item.sourceId).sort(),
        actual: count,
        threshold: Math.ceil(scope.capacity * monitor.policy.warningRatio),
        unit: "persons",
      });
    const confidence: OccupancyConfidence =
      conflict || stale || !usable.length
        ? "low"
        : (rankConfidence[Math.min(...usable.map((item) => confidenceRank[item.confidence]))] ?? "low");
    const expectedPeak = expected.get(scope.scopeId) ?? null;
    return {
      ...scope,
      status,
      count,
      utilization,
      confidence,
      sourceIds: usable.map((item) => item.sourceId).sort(),
      freshness: usable.length
        ? stale
          ? "stale"
          : usable.some((item) => item.freshness === "aging")
            ? "aging"
            : "fresh"
        : "missing",
      expectedPeak,
      simulationDelta: count == null || expectedPeak == null ? null : count - expectedPeak,
    };
  });
  const priority: readonly OccupancyScopeStatus[] = [
    "exceeded",
    "conflicting",
    "stale",
    "warning",
    "nominal",
    "unavailable",
  ];
  const overallStatus: OccupancyScopeStatus =
    priority.find((candidate) => scopes.some((scope) => scope.status === candidate)) ?? "unavailable";
  return freeze({
    monitorId: monitor.id,
    runbookVersionId: monitor.runbookVersionId,
    evaluatedAt,
    overallStatus,
    sources,
    scopes,
    alerts: alerts.sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        String(left.scopeId).localeCompare(String(right.scopeId)) ||
        left.key.localeCompare(right.key),
    ),
    privacy: { mode: "aggregate-only", personRecordsStored: false, individualEventsStored: false },
  });
}

const metadata = (command: OccupancyMutationCommand): CommandMetadata => ({
  actorType: command.actorType ?? "human",
  actorId: text(command.actorId, "actor-id"),
  source: command.source ?? "studio",
  sessionId: text(command.sessionId, "session-id"),
});
const receiptFingerprint = (kind: OccupancyReceipt["operation"], command: OccupancyMutationCommand): string => {
  const input =
    "signal" in command
      ? { signal: command.signal, expectedRevision: command.expectedRevision }
      : "alertId" in command
        ? { alertId: command.alertId, reasonCode: command.reasonCode, expectedRevision: command.expectedRevision }
        : { evaluatedAt: command.evaluatedAt, expectedRevision: command.expectedRevision };
  return stableFingerprint(`occupancy-${kind}`, input);
};

const retryReceipt = (
  monitor: LiveOccupancyMonitor,
  command: OccupancyMutationCommand,
  fingerprint: string,
): OccupancyMutationResult | null => {
  const existing = monitor.receipts.find((receipt) => receipt.idempotencyKey === command.idempotencyKey);
  if (!existing) return null;
  if (existing.inputFingerprint !== fingerprint)
    throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
  return {
    monitor,
    projection: evaluateLiveOccupancy(monitor, { at: existing.acceptedAt }),
    receipt: existing,
    duplicate: true,
  };
};

const reconcileAlerts = (
  next: LiveOccupancyMonitor,
  projection: OccupancyProjection,
  commandMetadata: CommandMetadata,
  committedAt: string,
): void => {
  const previous = new Map(next.activeAlerts.map((alert) => [alert.key, alert]));
  const desired = new Map(projection.alerts.map((alert) => [alert.key, alert]));
  const activeAlerts: OccupancyAlert[] = [];
  for (const descriptor of projection.alerts) {
    const current = previous.get(descriptor.key);
    if (current) activeAlerts.push(current);
    else {
      const alert: OccupancyAlert = {
        id: stableFingerprint("occupancy-alert", { monitorId: next.id, key: descriptor.key, openedAt: committedAt }),
        ...clone(descriptor),
        status: "open",
        openedAt: committedAt,
      };
      activeAlerts.push(alert);
      next.ledger.push(appendLedger(next, "occupancy.alert.opened", alert, commandMetadata, committedAt));
    }
  }
  for (const alert of previous.values())
    if (!desired.has(alert.key))
      next.ledger.push(
        appendLedger(
          next,
          "occupancy.alert.resolved",
          { ...alert, status: "resolved", resolvedAt: committedAt },
          commandMetadata,
          committedAt,
        ),
      );
  next.activeAlerts = activeAlerts.sort((left, right) => left.key.localeCompare(right.key));
};

const finalize = (
  monitor: LiveOccupancyMonitor,
  command: OccupancyMutationCommand,
  kind: OccupancyReceipt["operation"],
  committedAt: string,
  mutate: (monitor: LiveOccupancyMonitor, metadata: CommandMetadata) => void,
): OccupancyMutationResult => {
  if (!command.idempotencyKey) throw venueError("IDEMPOTENCY_KEY_REQUIRED");
  const fingerprint = receiptFingerprint(kind, command);
  const duplicate = retryReceipt(monitor, command, fingerprint);
  if (duplicate) return duplicate;
  if (!Number.isInteger(command.expectedRevision) || command.expectedRevision !== monitor.revision)
    throw venueError("OCCUPANCY_REVISION_CONFLICT", {
      expectedRevision: command.expectedRevision,
      currentRevision: monitor.revision,
    });
  const next = clone(monitor);
  const commandMetadata = metadata(command);
  mutate(next, commandMetadata);
  next.revision += 1;
  next.updatedAt = committedAt;
  const projection = evaluateLiveOccupancy(next, { at: committedAt });
  reconcileAlerts(next, projection, commandMetadata, committedAt);
  const receipt: OccupancyReceipt = {
    id: stableFingerprint("occupancy-receipt", {
      monitorId: next.id,
      idempotencyKey: command.idempotencyKey,
      inputFingerprint: fingerprint,
    }),
    idempotencyKey: command.idempotencyKey,
    inputFingerprint: fingerprint,
    operation: kind,
    revision: next.revision,
    acceptedAt: committedAt,
  };
  next.receipts.push(receipt);
  return {
    monitor: freeze(next),
    projection: evaluateLiveOccupancy(next, { at: committedAt }),
    receipt: freeze(receipt),
    duplicate: false,
  };
};

export function ingestOccupancySignal(
  monitor: LiveOccupancyMonitor,
  command: IngestOccupancySignalCommand,
  { acceptedAt = new Date().toISOString() }: { acceptedAt?: string } = {},
): OccupancyMutationResult {
  const committedAt = iso(acceptedAt, "accepted-at");
  const normalizedSignal = normalizeSignal(monitor, command.signal);
  const normalizedCommand = { ...command, signal: normalizedSignal };
  return finalize(monitor, normalizedCommand, "ingest", committedAt, (next, commandMetadata) => {
    if (Date.parse(normalizedSignal.observedAt) > Date.parse(committedAt)) invalid("observed-at-in-future");
    const key = sourceKey(normalizedSignal);
    const existing = next.feeds.find((feed) => sourceKey(feed) === key);
    if (existing && Date.parse(normalizedSignal.observedAt) <= Date.parse(existing.observedAt))
      throw venueError("OCCUPANCY_SIGNAL_OUT_OF_ORDER", {
        sourceId: normalizedSignal.sourceId,
        kind: normalizedSignal.kind,
        currentObservedAt: existing.observedAt,
        receivedObservedAt: normalizedSignal.observedAt,
      });
    next.feeds = [
      ...next.feeds.filter((feed) => sourceKey(feed) !== key),
      {
        ...normalizedSignal,
        acceptedAt: committedAt,
        signalFingerprint: stableFingerprint("occupancy-signal", normalizedSignal),
      },
    ].sort((left, right) => sourceKey(left).localeCompare(sourceKey(right)));
    const observation = {
      id: stableFingerprint("occupancy-observation", { monitorId: next.id, signal: normalizedSignal }),
      ...normalizedSignal,
      acceptedAt: committedAt,
    };
    next.observations.push(observation);
    next.ledger.push(
      appendLedger(
        next,
        "occupancy.signal.accepted",
        {
          observationId: observation.id,
          sourceId: observation.sourceId,
          sourceType: observation.sourceType,
          sourceVersion: observation.sourceVersion,
          kind: observation.kind,
          observedAt: observation.observedAt,
          confidence: observation.confidence,
          readings: observation.readings,
        },
        commandMetadata,
        committedAt,
      ),
    );
  });
}

export function refreshLiveOccupancy(
  monitor: LiveOccupancyMonitor,
  command: RefreshLiveOccupancyCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): OccupancyMutationResult {
  const at = iso(command.evaluatedAt ?? committedAt, "evaluated-at");
  if (at !== committedAt) invalid("evaluation-commit-time-mismatch");
  return finalize(monitor, { ...command, evaluatedAt: at }, "refresh", at, (next, commandMetadata) => {
    next.ledger.push(appendLedger(next, "occupancy.monitor.refreshed", { evaluatedAt: at }, commandMetadata, at));
  });
}

export function acknowledgeOccupancyAlert(
  monitor: LiveOccupancyMonitor,
  command: AcknowledgeOccupancyAlertCommand,
  { acknowledgedAt = new Date().toISOString() }: { acknowledgedAt?: string } = {},
): OccupancyMutationResult {
  const committedAt = iso(acknowledgedAt, "acknowledged-at");
  if (command.actorType !== "human")
    throw venueError("OCCUPANCY_ACKNOWLEDGEMENT_INVALID", { reason: "human-required" });
  const alertId = text(command.alertId, "alert-id");
  const reasonCode = text(command.reasonCode, "reason-code");
  return finalize(monitor, { ...command, alertId, reasonCode }, "acknowledge", committedAt, (next, commandMetadata) => {
    const alert = next.activeAlerts.find((candidate) => candidate.id === alertId);
    if (!alert) throw venueError("OCCUPANCY_ALERT_NOT_FOUND", { alertId });
    if (alert.status === "acknowledged")
      throw venueError("OCCUPANCY_ACKNOWLEDGEMENT_INVALID", { reason: "already-acknowledged", alertId });
    Object.assign(alert, {
      status: "acknowledged",
      acknowledgedAt: committedAt,
      acknowledgedBy: commandMetadata.actorId,
      reasonCode,
    });
    next.ledger.push(
      appendLedger(
        next,
        "occupancy.alert.acknowledged",
        {
          alertId,
          alertKey: alert.key,
          code: alert.code,
          scopeId: alert.scopeId,
          acknowledgedBy: commandMetadata.actorId,
          reasonCode,
        },
        commandMetadata,
        committedAt,
      ),
    );
  });
}

export function verifyOccupancyLedger(monitor: LiveOccupancyMonitor) {
  let previousHash = monitor.source.runbookLedgerHeadHash;
  for (let index = 0; index < monitor.ledger.length; index += 1) {
    const entry = monitor.ledger[index];
    if (!entry) return { status: "fail", sequence: index + 1 };
    const { hash, ...unsigned } = entry;
    if (
      entry.sequence !== index + 1 ||
      entry.previousHash !== previousHash ||
      hash !== stableFingerprint("occupancy-ledger", unsigned)
    )
      return { status: "fail", sequence: entry.sequence };
    previousHash = hash;
  }
  return { status: "pass", entries: monitor.ledger.length, headHash: previousHash };
}

export function exportLiveOccupancyAudit(
  monitor: LiveOccupancyMonitor,
  { exportedAt = new Date().toISOString() }: Partial<ExportLiveOccupancyCommand> = {},
): OccupancyAuditArtifact {
  const at = iso(exportedAt, "exported-at");
  const integrity = verifyOccupancyLedger(monitor);
  if (integrity.status !== "pass")
    throw venueError("OCCUPANCY_LEDGER_INTEGRITY_FAILED", { sequence: integrity.sequence ?? null });
  const projection = evaluateLiveOccupancy(monitor, { at });
  const artifact = {
    schemaVersion: 1,
    kind: "venuemind-live-occupancy-audit",
    exportedAt: at,
    monitor: {
      id: monitor.id,
      projectId: monitor.projectId,
      runbookVersionId: monitor.runbookVersionId,
      schemaVersion: monitor.schemaVersion,
      revision: monitor.revision,
      createdAt: monitor.createdAt,
      updatedAt: monitor.updatedAt,
    },
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
  return {
    filename: `${monitor.id}.audit.json`,
    mimeType: "application/json",
    content: JSON.stringify(artifact, null, 2),
  };
}

interface RegistrationSnapshot {
  privacy: { mode: "aggregate-only"; individualCheckInStored: false };
  sourceSystem: string;
  sourceVersion: string;
  status: string;
  checkIn: { asOf: string; total: number };
}

export function signalFromRegistrationSnapshot(snapshot: RegistrationSnapshot): AggregateOccupancySignal {
  if (
    !snapshot?.privacy ||
    snapshot.privacy.mode !== "aggregate-only" ||
    snapshot.privacy.individualCheckInStored ||
    !snapshot.checkIn
  )
    invalid("registration-snapshot-invalid");
  return normalizeRegistrationSignal(snapshot);
}

const normalizeRegistrationSignal = (snapshot: RegistrationSnapshot): AggregateOccupancySignal => ({
  sourceId: snapshot.sourceSystem,
  sourceType: "registration",
  sourceVersion: snapshot.sourceVersion,
  kind: "check-in",
  observedAt: snapshot.checkIn.asOf,
  confidence: snapshot.status === "reconciled" ? "high" : "medium",
  readings: [{ scopeId: "check-in", count: snapshot.checkIn.total }],
});
