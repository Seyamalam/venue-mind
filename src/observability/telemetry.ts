export const TELEMETRY_SCHEMA_VERSION = 1 as const;
export const TELEMETRY_EVENT_LIMIT = 256;
export const TELEMETRY_WINDOW_MS = 15 * 60 * 1_000;

export const telemetryComponents = ["client", "api", "repository", "planner", "adapter"] as const;
export type TelemetryComponent = (typeof telemetryComponents)[number];

export const telemetryOperations = [
  "request",
  "command",
  "policy",
  "validation",
  "simulation",
  "persistence",
  "conflict",
  "approval",
  "ledger",
  "integrity",
  "external-adapter",
] as const;
export type TelemetryOperation = (typeof telemetryOperations)[number];

export const telemetryOutcomes = [
  "started",
  "ok",
  "failed",
  "conflict",
  "approved",
  "rejected",
  "cancelled",
  "degraded",
] as const;
export type TelemetryOutcome = (typeof telemetryOutcomes)[number];

export const telemetryLevels = ["info", "warn", "error"] as const;
export type TelemetryLevel = (typeof telemetryLevels)[number];
const telemetryComponentSet = new Set<string>(telemetryComponents);
const telemetryOperationSet = new Set<string>(telemetryOperations);
const telemetryOutcomeSet = new Set<string>(telemetryOutcomes);
const telemetryLevelSet = new Set<string>(telemetryLevels);

export interface TelemetryEvent {
  readonly schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  readonly eventId: string;
  readonly occurredAt: string;
  readonly component: TelemetryComponent;
  readonly operation: TelemetryOperation;
  readonly outcome: TelemetryOutcome;
  readonly level: TelemetryLevel;
  readonly correlationId: string;
  readonly durationMs: number | null;
  readonly action: string | null;
  readonly errorCode: string | null;
}

export interface TelemetryAlert {
  readonly code: "FAILURE_RATE_HIGH" | "INTEGRITY_FAILURE";
  readonly level: "warn" | "error";
  readonly operation: TelemetryOperation | "all";
  readonly observed: number;
  readonly threshold: number;
}

export interface OperationMetric {
  readonly operation: TelemetryOperation;
  readonly samples: number;
  readonly failures: number;
  readonly conflicts: number;
  readonly totalDurationMs: number;
  readonly averageDurationMs: number;
  readonly maximumDurationMs: number;
}

export interface ObservabilitySnapshot {
  readonly schemaVersion: typeof TELEMETRY_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly windowMs: typeof TELEMETRY_WINDOW_MS;
  readonly status: "ok" | "warn" | "error";
  readonly samples: number;
  readonly failures: number;
  readonly failureRate: number;
  readonly integrityFailures: number;
  readonly approvals: Readonly<{ approved: number; rejected: number }>;
  readonly conflicts: number;
  readonly metrics: readonly OperationMetric[];
  readonly alerts: readonly TelemetryAlert[];
  readonly recentCorrelationIds: readonly string[];
}

export interface TelemetrySink {
  emit(event: TelemetryEvent): void | Promise<void>;
}

export interface TelemetryRecorder extends TelemetrySink {
  readonly snapshot: () => ObservabilitySnapshot;
  readonly trace: (correlationId: string) => readonly TelemetryEvent[];
  readonly subscribe: (listener: () => void) => () => void;
}

export interface TelemetryEventInput {
  readonly component: TelemetryComponent;
  readonly operation: TelemetryOperation;
  readonly outcome: TelemetryOutcome;
  readonly correlationId: string;
  readonly durationMs?: number;
  readonly action?: string;
  readonly errorCode?: string;
  readonly occurredAt?: string;
  readonly eventId?: string;
}

export interface TelemetryClock {
  readonly iso: () => string;
  readonly milliseconds: () => number;
}

const TOKEN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;
const CODE = /^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const ACTION = /^[a-z0-9][a-z0-9._:-]{0,79}$/;

export const isSafeCorrelationId = (value: string): boolean => TOKEN.test(value);

export const safeCorrelationId = (value: string | null | undefined, fallback: () => string): string => {
  const normalized = value?.trim() ?? "";
  if (TOKEN.test(normalized)) return normalized;
  const generated = fallback().trim();
  return TOKEN.test(generated) ? generated : "corr-generated";
};

const safeAction = (value: string | undefined): string | null => {
  const normalized = value?.trim().toLowerCase() ?? "";
  return ACTION.test(normalized) ? normalized : null;
};

const safeErrorCode = (value: string | undefined): string | null => {
  const normalized = value?.trim().toUpperCase() ?? "";
  return CODE.test(normalized) ? normalized : null;
};

const boundedDuration = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(3_600_000, Math.max(0, Math.round(value * 100) / 100))
    : null;

const levelFor = (outcome: TelemetryOutcome): TelemetryLevel =>
  outcome === "failed" ? "error" : ["conflict", "rejected", "degraded"].includes(outcome) ? "warn" : "info";

export const createTelemetryEvent = (
  input: TelemetryEventInput,
  {
    iso = () => new Date().toISOString(),
    id = () => `evt-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
  }: Readonly<{ iso?: () => string; id?: () => string }> = {},
): TelemetryEvent =>
  Object.freeze({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: safeCorrelationId(input.eventId, id),
    occurredAt: input.occurredAt ?? iso(),
    component: input.component,
    operation: input.operation,
    outcome: input.outcome,
    level: levelFor(input.outcome),
    correlationId: safeCorrelationId(input.correlationId, () => "corr-generated"),
    durationMs: boundedDuration(input.durationMs),
    action: safeAction(input.action),
    errorCode: safeErrorCode(input.errorCode),
  });

export const isTelemetryEvent = (value: object): value is TelemetryEvent => {
  const candidate = value as Partial<TelemetryEvent>;
  return (
    candidate.schemaVersion === TELEMETRY_SCHEMA_VERSION &&
    typeof candidate.eventId === "string" &&
    TOKEN.test(candidate.eventId) &&
    typeof candidate.occurredAt === "string" &&
    typeof candidate.component === "string" &&
    telemetryComponentSet.has(candidate.component) &&
    typeof candidate.operation === "string" &&
    telemetryOperationSet.has(candidate.operation) &&
    typeof candidate.outcome === "string" &&
    telemetryOutcomeSet.has(candidate.outcome) &&
    typeof candidate.level === "string" &&
    telemetryLevelSet.has(candidate.level) &&
    typeof candidate.correlationId === "string" &&
    TOKEN.test(candidate.correlationId) &&
    (candidate.durationMs === null ||
      (typeof candidate.durationMs === "number" && candidate.durationMs >= 0 && candidate.durationMs <= 3_600_000)) &&
    (candidate.action === null || (typeof candidate.action === "string" && ACTION.test(candidate.action))) &&
    (candidate.errorCode === null || (typeof candidate.errorCode === "string" && CODE.test(candidate.errorCode)))
  );
};

const completed = (event: TelemetryEvent): boolean => event.outcome !== "started";
const failed = (event: TelemetryEvent): boolean => event.outcome === "failed";

export const summarizeTelemetry = (
  events: readonly TelemetryEvent[],
  generatedAt = new Date().toISOString(),
): ObservabilitySnapshot => {
  const threshold = Date.parse(generatedAt) - TELEMETRY_WINDOW_MS;
  const windowEvents = events.filter((event) => completed(event) && Date.parse(event.occurredAt) >= threshold);
  const metrics = telemetryOperations.map((operation): OperationMetric => {
    const samples = windowEvents.filter((event) => event.operation === operation);
    const durations = samples.flatMap((event) => (event.durationMs === null ? [] : [event.durationMs]));
    const totalDurationMs = Math.round(durations.reduce((sum, value) => sum + value, 0) * 100) / 100;
    return Object.freeze({
      operation,
      samples: samples.length,
      failures: samples.filter(failed).length,
      conflicts: samples.filter((event) => event.outcome === "conflict").length,
      totalDurationMs,
      averageDurationMs: durations.length ? Math.round((totalDurationMs / durations.length) * 100) / 100 : 0,
      maximumDurationMs: durations.length ? Math.max(...durations) : 0,
    });
  });
  const failures = windowEvents.filter(failed).length;
  const failureRate = windowEvents.length ? Math.round((failures / windowEvents.length) * 10_000) / 10_000 : 0;
  const integrityFailures = windowEvents.filter(
    (event) => event.operation === "integrity" && event.outcome === "failed",
  ).length;
  const alerts: TelemetryAlert[] = [];
  if (windowEvents.length >= 5 && failureRate >= 0.2)
    alerts.push({ code: "FAILURE_RATE_HIGH", level: "warn", operation: "all", observed: failureRate, threshold: 0.2 });
  if (integrityFailures > 0)
    alerts.push({
      code: "INTEGRITY_FAILURE",
      level: "error",
      operation: "integrity",
      observed: integrityFailures,
      threshold: 0,
    });
  const recentCorrelationIds = [...new Set(windowEvents.map((event) => event.correlationId))].slice(-12).reverse();
  return Object.freeze({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    generatedAt,
    windowMs: TELEMETRY_WINDOW_MS,
    status: alerts.some((alert) => alert.level === "error") ? "error" : alerts.length ? "warn" : "ok",
    samples: windowEvents.length,
    failures,
    failureRate,
    integrityFailures,
    approvals: Object.freeze({
      approved: windowEvents.filter((event) => event.operation === "approval" && event.outcome === "approved").length,
      rejected: windowEvents.filter((event) => event.operation === "approval" && event.outcome === "rejected").length,
    }),
    conflicts: windowEvents.filter((event) => event.operation === "conflict").length,
    metrics: Object.freeze(metrics),
    alerts: Object.freeze(alerts),
    recentCorrelationIds: Object.freeze(recentCorrelationIds),
  });
};

export function createMemoryTelemetry({
  limit = TELEMETRY_EVENT_LIMIT,
  clock = () => new Date().toISOString(),
}: Readonly<{ limit?: number; clock?: () => string }> = {}): TelemetryRecorder {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2_048) throw new TypeError("Telemetry limit is invalid");
  const events: TelemetryEvent[] = [];
  const listeners = new Set<() => void>();
  return Object.freeze({
    emit(event: TelemetryEvent): void {
      if (!isTelemetryEvent(event)) throw new TypeError("Telemetry event is invalid");
      events.push(Object.freeze({ ...event }));
      if (events.length > limit) events.splice(0, events.length - limit);
      listeners.forEach((listener) => listener());
    },
    snapshot: (): ObservabilitySnapshot => summarizeTelemetry(events, clock()),
    trace: (correlationId: string): readonly TelemetryEvent[] =>
      Object.freeze(
        events.filter((event) => event.correlationId === correlationId).map((event) => Object.freeze({ ...event })),
      ),
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

export interface TelemetrySpan {
  readonly end: (outcome?: Exclude<TelemetryOutcome, "started">, errorCode?: string) => TelemetryEvent;
}

export const startTelemetrySpan = (
  sink: TelemetrySink | undefined,
  input: Omit<TelemetryEventInput, "outcome" | "durationMs">,
  clock: TelemetryClock = {
    iso: () => new Date().toISOString(),
    milliseconds: () => globalThis.performance?.now?.() ?? Date.now(),
  },
): TelemetrySpan => {
  const startedAt = clock.milliseconds();
  const emit = (event: TelemetryEvent): void => {
    try {
      const emitted = sink?.emit(event);
      if (emitted instanceof Promise) void emitted.catch(() => undefined);
    } catch {
      // Telemetry is isolated from the product operation it observes.
    }
  };
  emit(createTelemetryEvent({ ...input, outcome: "started", occurredAt: clock.iso() }));
  let terminal: TelemetryEvent | null = null;
  return Object.freeze({
    end(outcome: Exclude<TelemetryOutcome, "started"> = "ok", errorCode?: string): TelemetryEvent {
      if (terminal) return terminal;
      terminal = createTelemetryEvent({
        ...input,
        outcome,
        ...(errorCode ? { errorCode } : {}),
        durationMs: clock.milliseconds() - startedAt,
        occurredAt: clock.iso(),
      });
      emit(terminal);
      return terminal;
    },
  });
};

export const telemetryErrorCode = (error: Error): string => {
  const candidate = "code" in error && typeof error.code === "string" ? error.code : error.name;
  return safeErrorCode(candidate) ?? "OPERATION_FAILED";
};

export const createStructuredLogSink = (write: (line: string) => void = (line) => console.info(line)): TelemetrySink =>
  Object.freeze({
    emit(event: TelemetryEvent): void {
      if (!isTelemetryEvent(event)) throw new TypeError("Telemetry event is invalid");
      write(JSON.stringify(event));
    },
  });

export const createTelemetryFanout = (...sinks: readonly TelemetrySink[]): TelemetrySink =>
  Object.freeze({
    async emit(event: TelemetryEvent): Promise<void> {
      await Promise.all(sinks.map(async (sink) => sink.emit(event)));
    },
  });
