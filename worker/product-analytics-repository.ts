import {
  PRODUCT_ANALYTICS_MAX_WINDOW_DAYS,
  PRODUCT_ANALYTICS_RETENTION_DAYS,
  PRODUCT_ANALYTICS_SCHEMA_VERSION,
  decodeProductAnalyticsEvent,
  productAnalyticsInterpretation,
  type ProductAnalyticsEvent,
  type ProductAnalyticsMetric,
  type ProductAnalyticsMetrics,
} from "../src/analytics/product-analytics.ts";
import { applyDatabaseMigrations } from "./database-migrations.ts";

const MAX_METRICS = 256;
const MAX_COUNT = 2_147_483_647;
const DEFAULT_SCOPE_HASH = "0".repeat(64);
const initialization = new WeakMap<object, Promise<void>>();

interface MetricRow {
  event_name: string;
  outcome: string;
  stage: string;
  error_category: string;
  event_count: number;
}

export interface ProductAnalyticsRepository {
  readonly increment: (event: ProductAnalyticsEvent, occurredAt?: string) => Promise<void>;
  readonly metrics: (windowDays?: number, generatedAt?: string) => Promise<ProductAnalyticsMetrics>;
  readonly prune: (at?: string) => Promise<number>;
}

const instant = (value: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new TypeError("PRODUCT_ANALYTICS_TIME_INVALID");
  return new Date(parsed).toISOString();
};
const day = (value: string): string => instant(value).slice(0, 10);
const daysBefore = (value: string, days: number): string =>
  new Date(Date.parse(instant(value)) - days * 24 * 60 * 60 * 1_000).toISOString().slice(0, 10);
const boundedWindow = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1 || value > PRODUCT_ANALYTICS_MAX_WINDOW_DAYS)
    throw new TypeError("PRODUCT_ANALYTICS_WINDOW_INVALID");
  return value;
};
const assertScopeHash = (scopeHash: string): void => {
  if (!/^[0-9a-f]{64}$/.test(scopeHash)) throw new TypeError("PRODUCT_ANALYTICS_SCOPE_INVALID");
};
const metricFromRow = (row: MetricRow): ProductAnalyticsMetric => {
  const event = decodeProductAnalyticsEvent({
    schemaVersion: PRODUCT_ANALYTICS_SCHEMA_VERSION,
    eventName: row.event_name,
    outcome: row.outcome,
    stage: row.stage,
    errorCategory: row.error_category === "none" ? null : row.error_category,
  });
  if (!Number.isSafeInteger(row.event_count) || row.event_count < 1 || row.event_count > MAX_COUNT)
    throw new Error("PRODUCT_ANALYTICS_COUNT_INVALID");
  return Object.freeze({ ...event, count: row.event_count });
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

const metricsResult = (
  rows: readonly MetricRow[],
  windowDays: number,
  generatedAt: string,
): ProductAnalyticsMetrics => {
  const throughDay = day(generatedAt);
  return Object.freeze({
    schemaVersion: PRODUCT_ANALYTICS_SCHEMA_VERSION,
    windowDays,
    fromDay: daysBefore(generatedAt, windowDays - 1),
    throughDay,
    totals: Object.freeze(rows.map(metricFromRow)),
    interpretation: productAnalyticsInterpretation,
  });
};

export function createD1ProductAnalyticsRepository(
  db: D1Database,
  scopeHash = DEFAULT_SCOPE_HASH,
): ProductAnalyticsRepository {
  assertScopeHash(scopeHash);
  const prune = async (at = new Date().toISOString()): Promise<number> => {
    await ready(db);
    const result = await db
      .prepare("DELETE FROM product_analytics_daily WHERE metric_day<?")
      .bind(daysBefore(at, PRODUCT_ANALYTICS_RETENTION_DAYS))
      .run();
    return Number(result.meta?.changes ?? 0);
  };
  return Object.freeze({
    async increment(event: ProductAnalyticsEvent, occurredAt = new Date().toISOString()): Promise<void> {
      const exact = decodeProductAnalyticsEvent(event);
      await ready(db);
      await db
        .prepare(
          "INSERT INTO product_analytics_daily (scope_hash,metric_day,event_name,outcome,stage,error_category,event_count,updated_at) VALUES (?,?,?,?,?,?,1,?) ON CONFLICT(scope_hash,metric_day,event_name,outcome,stage,error_category) DO UPDATE SET event_count=MIN(product_analytics_daily.event_count+1,2147483647),updated_at=excluded.updated_at",
        )
        .bind(
          scopeHash,
          day(occurredAt),
          exact.eventName,
          exact.outcome,
          exact.stage,
          exact.errorCategory ?? "none",
          instant(occurredAt),
        )
        .run();
    },
    async metrics(windowDays = 30, generatedAt = new Date().toISOString()): Promise<ProductAnalyticsMetrics> {
      const bounded = boundedWindow(windowDays);
      await ready(db);
      const { results } = await db
        .prepare(
          "SELECT event_name,outcome,stage,error_category,SUM(event_count) event_count FROM product_analytics_daily WHERE scope_hash=? AND metric_day>=? AND metric_day<=? GROUP BY event_name,outcome,stage,error_category ORDER BY event_name,outcome,stage,error_category LIMIT ?",
        )
        .bind(scopeHash, daysBefore(generatedAt, bounded - 1), day(generatedAt), MAX_METRICS)
        .all<MetricRow>();
      return metricsResult(results, bounded, generatedAt);
    },
    prune,
  });
}

export function createMemoryProductAnalyticsRepository({
  clock = () => new Date().toISOString(),
}: Readonly<{ clock?: () => string }> = {}): ProductAnalyticsRepository {
  const counts = new Map<string, { event: ProductAnalyticsEvent; metricDay: string; count: number }>();
  return Object.freeze({
    async increment(event: ProductAnalyticsEvent, occurredAt = clock()): Promise<void> {
      const exact = decodeProductAnalyticsEvent(event);
      const metricDay = day(occurredAt);
      const key = [metricDay, exact.eventName, exact.outcome, exact.stage, exact.errorCategory ?? "none"].join("|");
      const current = counts.get(key);
      counts.set(key, { event: exact, metricDay, count: Math.min(MAX_COUNT, (current?.count ?? 0) + 1) });
    },
    async metrics(windowDays = 30, generatedAt = clock()): Promise<ProductAnalyticsMetrics> {
      const bounded = boundedWindow(windowDays);
      const fromDay = daysBefore(generatedAt, bounded - 1);
      const throughDay = day(generatedAt);
      const rows = [...counts.values()]
        .filter((entry) => entry.metricDay >= fromDay && entry.metricDay <= throughDay)
        .sort((left, right) => JSON.stringify(left.event).localeCompare(JSON.stringify(right.event)))
        .map((entry) => ({
          event_name: entry.event.eventName,
          outcome: entry.event.outcome,
          stage: entry.event.stage,
          error_category: entry.event.errorCategory ?? "none",
          event_count: entry.count,
        }));
      return metricsResult(rows, bounded, generatedAt);
    },
    async prune(at = clock()): Promise<number> {
      const boundary = daysBefore(at, PRODUCT_ANALYTICS_RETENTION_DAYS);
      let deleted = 0;
      for (const [key, entry] of counts) {
        if (entry.metricDay >= boundary) continue;
        counts.delete(key);
        deleted += 1;
      }
      return deleted;
    },
  });
}
