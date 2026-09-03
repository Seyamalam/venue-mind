import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DATABASE_SCHEMA_VERSION } from "../db/generated-migrations.ts";
import { VENUE_RATE_LIMITS, VENUE_RATE_LIMIT_WINDOW_SECONDS } from "../src/security/resource-limits.ts";
import { applyDatabaseMigrations, inspectDatabaseIntegrity } from "../worker/database-migrations.ts";
import {
  createD1RateLimitRepository,
  createMemoryRateLimitRepository,
} from "../worker/rate-limit-repository.ts";
import {
  createRateLimitService,
  mutationEndpointFamily,
  opaqueRateLimitScope,
} from "../worker/rate-limit-service.ts";

class SqliteStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) {
    return new SqliteStatement(this.database, this.sql, values);
  }
  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }
  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }
  async run() {
    return this.database.prepare(this.sql).run(...this.values);
  }
}

class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys=ON");
  }
  prepare(sql) {
    return new SqliteStatement(this.database, sql);
  }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.database.close();
  }
}

test("migration 12 installs opaque bounded API rate windows and integrity coverage", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  const migrated = await applyDatabaseMigrations(db);
  assert.equal(DATABASE_SCHEMA_VERSION, 12);
  assert.equal(migrated.currentVersion, 13);
  const columns = await db.prepare("PRAGMA table_info(api_rate_limit_windows)").all();
  assert.deepEqual(
    columns.results.map((column) => column.name),
    ["scope_type", "scope_hash", "endpoint_family", "window_started_at", "request_count", "expires_at"],
  );
  assert.equal((await inspectDatabaseIntegrity(db)).status, "pass");
});

test("D1 rate repository atomically caps a bucket and stores only opaque scope state", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  const repository = createD1RateLimitRepository(db);
  const scopeHash = await opaqueRateLimitScope("identity", "session-private-value");
  const input = {
    scopeType: "identity",
    scopeHash,
    endpointFamily: "project-writes",
    windowStartedAt: 1_788_739_200_000,
    expiresAt: 1_788_739_260_000,
    maximum: 2,
  };
  assert.deepEqual(await repository.consume(input), {
    allowed: true,
    count: 1,
    maximum: 2,
    expiresAt: input.expiresAt,
  });
  assert.equal((await repository.consume(input)).allowed, true);
  assert.deepEqual(await repository.consume(input), {
    allowed: false,
    count: 2,
    maximum: 2,
    expiresAt: input.expiresAt,
  });
  const rows = await db.prepare("SELECT * FROM api_rate_limit_windows").all();
  assert.equal(rows.results.length, 1);
  assert.equal(rows.results[0].scope_hash, scopeHash);
  assert.equal(JSON.stringify(rows.results).includes("session-private-value"), false);
  assert.deepEqual(Object.keys(rows.results[0]).sort(), [
    "endpoint_family",
    "expires_at",
    "request_count",
    "scope_hash",
    "scope_type",
    "window_started_at",
  ]);
});

test("rate service applies exact identity and organization budgets in bounded 60-second windows", async () => {
  let now = "2026-09-03T12:00:30.000Z";
  const service = createRateLimitService({
    repository: createMemoryRateLimitRepository(),
    clock: () => now,
  });
  const base = { organizationId: "org-private", endpointFamily: "project-writes" };
  for (let count = 0; count < VENUE_RATE_LIMITS["project-writes"].identity; count += 1)
    assert.equal((await service.consume({ ...base, sessionId: "session-alpha" })).allowed, true);
  const identityLimited = await service.consume({ ...base, sessionId: "session-alpha" });
  assert.equal(identityLimited.allowed, false);
  assert.equal(identityLimited.limitedScope, "identity");
  assert.equal(identityLimited.retryAfterSeconds, 30);

  const organizationService = createRateLimitService({
    repository: createMemoryRateLimitRepository(),
    clock: () => now,
  });
  const identityBudget = VENUE_RATE_LIMITS["project-writes"].identity;
  const organizationBudget = VENUE_RATE_LIMITS["project-writes"].organization;
  for (let count = 0; count < organizationBudget; count += 1) {
    const session = `session-${Math.floor(count / identityBudget)}`;
    assert.equal((await organizationService.consume({ ...base, sessionId: session })).allowed, true);
  }
  const organizationLimited = await organizationService.consume({ ...base, sessionId: "session-overflow" });
  assert.equal(organizationLimited.allowed, false);
  assert.equal(organizationLimited.limitedScope, "organization");

  now = "2026-09-03T12:01:00.000Z";
  const reset = await service.consume({ ...base, sessionId: "session-alpha" });
  assert.equal(reset.allowed, true);
  assert.equal(reset.retryAfterSeconds, 0);
  assert.equal(VENUE_RATE_LIMIT_WINDOW_SECONDS, 60);
});

test("mutation endpoint families are exact and exclude read-only traffic", () => {
  assert.equal(mutationEndpointFamily("PUT", "/api/projects/project-a"), "project-writes");
  assert.equal(
    mutationEndpointFamily("POST", "/api/projects/project-a/runbooks/runbook-a/transitions:sync"),
    "operational-command-sync",
  );
  assert.equal(
    mutationEndpointFamily("POST", "/api/projects/project-a/share-links"),
    "sharing-membership-mutations",
  );
  assert.equal(mutationEndpointFamily("POST", "/api/webhooks/provider-a"), "adapter-webhook-mutation");
  assert.equal(mutationEndpointFamily("GET", "/api/health"), null);
  assert.equal(mutationEndpointFamily("GET", "/api/projects/project-a"), null);
});
