import type { VenueRateEndpointFamily } from "../src/security/resource-limits.ts";
import { applyDatabaseMigrations } from "./database-migrations.ts";

export type RateLimitScopeType = "identity" | "organization";
export interface RateLimitBucketInput {
  readonly scopeType: RateLimitScopeType;
  readonly scopeHash: string;
  readonly endpointFamily: VenueRateEndpointFamily;
  readonly windowStartedAt: number;
  readonly expiresAt: number;
  readonly maximum: number;
}
export interface RateLimitBucketResult {
  readonly allowed: boolean;
  readonly count: number;
  readonly maximum: number;
  readonly expiresAt: number;
}
export interface RateLimitRepository {
  consume(input: RateLimitBucketInput): Promise<RateLimitBucketResult>;
}

const initialized = new WeakSet<object>();
const HASH = /^[0-9a-f]{64}$/;
const positiveInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
  return value;
};
const assertInput = (input: RateLimitBucketInput): void => {
  if (input.scopeType !== "identity" && input.scopeType !== "organization")
    throw new TypeError("Rate-limit scope type is invalid");
  if (!HASH.test(input.scopeHash)) throw new TypeError("Rate-limit scope hash is invalid");
  positiveInteger(input.windowStartedAt, "Rate-limit window start");
  positiveInteger(input.expiresAt, "Rate-limit expiry");
  positiveInteger(input.maximum, "Rate-limit maximum");
  if (input.expiresAt <= input.windowStartedAt) throw new TypeError("Rate-limit expiry is invalid");
};

async function ready(db: D1Database): Promise<void> {
  if (initialized.has(db)) return;
  await applyDatabaseMigrations(db);
  initialized.add(db);
}

export function createD1RateLimitRepository(db: D1Database): RateLimitRepository {
  return Object.freeze({
    async consume(input: RateLimitBucketInput): Promise<RateLimitBucketResult> {
      assertInput(input);
      await ready(db);
      await db
        .prepare("DELETE FROM api_rate_limit_windows WHERE expires_at<=?")
        .bind(input.windowStartedAt)
        .run();
      const row = await db
        .prepare(
          `INSERT INTO api_rate_limit_windows (scope_type,scope_hash,endpoint_family,window_started_at,request_count,expires_at)
           VALUES (?,?,?,?,1,?)
           ON CONFLICT(scope_type,scope_hash,endpoint_family,window_started_at)
           DO UPDATE SET request_count=api_rate_limit_windows.request_count+1,expires_at=excluded.expires_at
           WHERE api_rate_limit_windows.request_count<?
           RETURNING request_count`,
        )
        .bind(
          input.scopeType,
          input.scopeHash,
          input.endpointFamily,
          input.windowStartedAt,
          input.expiresAt,
          input.maximum,
        )
        .first<{ request_count: number }>();
      if (row)
        return Object.freeze({
          allowed: true,
          count: Number(row.request_count),
          maximum: input.maximum,
          expiresAt: input.expiresAt,
        });
      const current = await db
        .prepare(
          "SELECT request_count FROM api_rate_limit_windows WHERE scope_type=? AND scope_hash=? AND endpoint_family=? AND window_started_at=?",
        )
        .bind(input.scopeType, input.scopeHash, input.endpointFamily, input.windowStartedAt)
        .first<{ request_count: number }>();
      return Object.freeze({
        allowed: false,
        count: Number(current?.request_count ?? input.maximum),
        maximum: input.maximum,
        expiresAt: input.expiresAt,
      });
    },
  });
}

export function createMemoryRateLimitRepository(): RateLimitRepository {
  const windows = new Map<string, { count: number; expiresAt: number }>();
  return Object.freeze({
    async consume(input: RateLimitBucketInput): Promise<RateLimitBucketResult> {
      assertInput(input);
      const prefix = `${input.scopeType}:${input.scopeHash}:${input.endpointFamily}:`;
      for (const [key, value] of windows)
        if (value.expiresAt <= input.windowStartedAt) windows.delete(key);
      const key = `${prefix}${input.windowStartedAt}`;
      const current = windows.get(key);
      const count = current?.count ?? 0;
      if (count >= input.maximum)
        return Object.freeze({ allowed: false, count, maximum: input.maximum, expiresAt: input.expiresAt });
      const next = count + 1;
      windows.set(key, { count: next, expiresAt: input.expiresAt });
      return Object.freeze({ allowed: true, count: next, maximum: input.maximum, expiresAt: input.expiresAt });
    },
  });
}
