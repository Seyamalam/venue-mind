import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { decodeProductAnalyticsEvent } from "../src/analytics/product-analytics.ts";
import { applyDatabaseMigrations, inspectDatabaseIntegrity } from "../worker/database-migrations.ts";
import { createD1ProductAnalyticsRepository } from "../worker/product-analytics-repository.ts";

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

const completion = decodeProductAnalyticsEvent({
  schemaVersion: 1,
  eventName: "golden-loop.completed",
  outcome: "completed",
  stage: "approve",
  errorCategory: null,
});

test("migration 16 installs an aggregate-only product analytics table", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  assert.equal((await applyDatabaseMigrations(db)).currentVersion, 16);
  const columns = await db.prepare("PRAGMA table_info(product_analytics_daily)").all();
  assert.deepEqual(columns.results.map(({ name }) => name), [
    "scope_hash",
    "metric_day",
    "event_name",
    "outcome",
    "stage",
    "error_category",
    "event_count",
    "updated_at",
  ]);
  assert.equal((await inspectDatabaseIntegrity(db)).status, "pass");
});

test("D1 product analytics aggregates exact dimensions without identity or content", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  const scopeA = "a".repeat(64);
  const scopeB = "b".repeat(64);
  const alpha = createD1ProductAnalyticsRepository(db, scopeA);
  const bravo = createD1ProductAnalyticsRepository(db, scopeB);
  await alpha.increment(completion, "2026-09-03T10:00:00.000Z");
  await alpha.increment(completion, "2026-09-03T11:00:00.000Z");
  await bravo.increment(completion, "2026-09-03T12:00:00.000Z");

  const metrics = await alpha.metrics(30, "2026-09-03T13:00:00.000Z");
  assert.equal(metrics.totals.length, 1);
  assert.equal(metrics.totals[0].count, 2);
  assert.equal(Object.hasOwn(metrics, "scopeHash"), false);
  const rows = await db.prepare("SELECT * FROM product_analytics_daily ORDER BY scope_hash").all();
  assert.equal(rows.results.length, 2);
  assert.deepEqual(rows.results.map(({ scope_hash }) => scope_hash), [scopeA, scopeB]);
  assert.doesNotMatch(
    JSON.stringify(rows.results),
    /projectId|userId|objectId|url|geometry|comment|content|credential/i,
  );
});

test("product analytics retention prunes daily aggregates after 180 days", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  const repository = createD1ProductAnalyticsRepository(db, "c".repeat(64));
  await repository.increment(completion, "2026-01-01T00:00:00.000Z");
  await repository.prune("2026-09-03T00:00:00.000Z");
  assert.equal((await db.prepare("SELECT COUNT(*) count FROM product_analytics_daily").first()).count, 0);
});
