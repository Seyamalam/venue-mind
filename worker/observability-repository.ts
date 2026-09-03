import {
  TELEMETRY_SCHEMA_VERSION,
  TELEMETRY_WINDOW_MS,
  isTelemetryEvent,
  summarizeTelemetry,
  type ObservabilitySnapshot,
  type TelemetryComponent,
  type TelemetryEvent,
  type TelemetryLevel,
  type TelemetryOperation,
  type TelemetryOutcome,
} from "../src/observability/telemetry.ts";
import { applyDatabaseMigrations } from "./database-migrations.ts";

const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const QUERY_LIMIT = 2_048;

interface TelemetryRow {
  event_id: string;
  occurred_at: string;
  correlation_id: string;
  component: TelemetryComponent;
  operation: TelemetryOperation;
  outcome: TelemetryOutcome;
  level: TelemetryLevel;
  duration_ms: number | null;
  action: string | null;
  error_code: string | null;
}

export interface ObservabilityRepository {
  readonly record: (event: TelemetryEvent) => Promise<void>;
  readonly snapshot: (generatedAt?: string) => Promise<ObservabilitySnapshot>;
  readonly trace: (correlationId: string) => Promise<readonly TelemetryEvent[]>;
}

const DEFAULT_SCOPE_HASH = "0".repeat(64);
const initialization = new WeakMap<object, Promise<void>>();

const eventFromRow = (row: TelemetryRow): TelemetryEvent => {
  const event: TelemetryEvent = Object.freeze({
    schemaVersion: TELEMETRY_SCHEMA_VERSION,
    eventId: row.event_id,
    occurredAt: row.occurred_at,
    correlationId: row.correlation_id,
    component: row.component,
    operation: row.operation,
    outcome: row.outcome,
    level: row.level,
    durationMs: row.duration_ms,
    action: row.action,
    errorCode: row.error_code,
  });
  if (!isTelemetryEvent(event)) throw new Error("OBSERVABILITY_EVENT_INVALID");
  return event;
};

async function ready(db: D1Database): Promise<void> {
  const pending = initialization.get(db);
  if (pending) return pending;
  const next = applyDatabaseMigrations(db).then(() => undefined);
  initialization.set(db, next);
  try {
    await next;
  } catch (error) {
    initialization.delete(db);
    throw error;
  }
}

export function createD1ObservabilityRepository(
  db: D1Database,
  scopeHash = DEFAULT_SCOPE_HASH,
): ObservabilityRepository {
  if (!/^[0-9a-f]{64}$/.test(scopeHash)) throw new TypeError("Observability scope hash is invalid");
  return Object.freeze({
    async record(event: TelemetryEvent): Promise<void> {
      if (!isTelemetryEvent(event)) throw new TypeError("Telemetry event is invalid");
      await ready(db);
      const retentionBoundary = new Date(Date.parse(event.occurredAt) - RETENTION_MS).toISOString();
      await db.prepare("DELETE FROM observability_events WHERE occurred_at<?").bind(retentionBoundary).run();
      await db
        .prepare(
          "INSERT OR IGNORE INTO observability_events (event_id,scope_hash,occurred_at,correlation_id,component,operation,outcome,level,duration_ms,action,error_code) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .bind(
          event.eventId,
          scopeHash,
          event.occurredAt,
          event.correlationId,
          event.component,
          event.operation,
          event.outcome,
          event.level,
          event.durationMs,
          event.action,
          event.errorCode,
        )
        .run();
    },
    async snapshot(generatedAt = new Date().toISOString()): Promise<ObservabilitySnapshot> {
      await ready(db);
      const boundary = new Date(Date.parse(generatedAt) - TELEMETRY_WINDOW_MS).toISOString();
      const { results } = await db
        .prepare(
          "SELECT event_id,occurred_at,correlation_id,component,operation,outcome,level,duration_ms,action,error_code FROM observability_events WHERE scope_hash=? AND occurred_at>=? ORDER BY occurred_at DESC LIMIT ?",
        )
        .bind(scopeHash, boundary, QUERY_LIMIT)
        .all<TelemetryRow>();
      return summarizeTelemetry(results.map(eventFromRow), generatedAt);
    },
    async trace(correlationId: string): Promise<readonly TelemetryEvent[]> {
      await ready(db);
      const { results } = await db
        .prepare(
          "SELECT event_id,occurred_at,correlation_id,component,operation,outcome,level,duration_ms,action,error_code FROM observability_events WHERE scope_hash=? AND correlation_id=? ORDER BY occurred_at,event_id LIMIT 100",
        )
        .bind(scopeHash, correlationId)
        .all<TelemetryRow>();
      return Object.freeze(results.map(eventFromRow));
    },
  });
}

export function createMemoryObservabilityRepository({
  clock = () => new Date().toISOString(),
}: Readonly<{ clock?: () => string }> = {}): ObservabilityRepository {
  const events: TelemetryEvent[] = [];
  return Object.freeze({
    async record(event: TelemetryEvent): Promise<void> {
      if (!isTelemetryEvent(event)) throw new TypeError("Telemetry event is invalid");
      events.push(Object.freeze({ ...event }));
      if (events.length > QUERY_LIMIT) events.splice(0, events.length - QUERY_LIMIT);
    },
    async snapshot(generatedAt = clock()): Promise<ObservabilitySnapshot> {
      return summarizeTelemetry(events, generatedAt);
    },
    async trace(correlationId: string): Promise<readonly TelemetryEvent[]> {
      return Object.freeze(events.filter((event) => event.correlationId === correlationId));
    },
  });
}
