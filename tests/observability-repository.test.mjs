import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createTelemetryEvent } from "../src/observability/telemetry.ts";
import { createD1ObservabilityRepository, hashObservabilityScope } from "../worker/observability-repository.ts";

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

test("D1 observability keeps exact events isolated by opaque organization scope", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  const scopeA = "a".repeat(64);
  const scopeB = "b".repeat(64);
  const repositoryA = createD1ObservabilityRepository(db, scopeA);
  const repositoryB = createD1ObservabilityRepository(db, scopeB);
  await repositoryA.record(
    createTelemetryEvent({
      eventId: "event-d1-a",
      occurredAt: "2026-09-03T05:00:00.000Z",
      component: "repository",
      operation: "persistence",
      outcome: "failed",
      correlationId: "corr-d1-a",
      action: "project.put",
      errorCode: "PERSISTENCE_FAILED",
    }),
  );
  await repositoryB.record(
    createTelemetryEvent({
      eventId: "event-d1-b",
      occurredAt: "2026-09-03T05:00:01.000Z",
      component: "api",
      operation: "request",
      outcome: "ok",
      correlationId: "corr-d1-b",
      action: "projects.read",
    }),
  );

  assert.equal((await repositoryA.snapshot("2026-09-03T05:01:00.000Z")).samples, 1);
  assert.equal((await repositoryB.trace("corr-d1-a")).length, 0);
  assert.equal((await repositoryA.trace("corr-d1-a")).length, 1);
  const rows = await db.prepare("SELECT * FROM observability_events ORDER BY event_id").all();
  assert.deepEqual(rows.results.map((row) => row.scope_hash), [scopeA, scopeB]);
  assert.doesNotMatch(JSON.stringify(rows.results), /payload|geometry|identity|secret@example/i);
});

test("organization observability scopes are stable opaque SHA-256 values", async () => {
  const first = await hashObservabilityScope("org-alpha");
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(await hashObservabilityScope("org-alpha"), first);
  assert.notEqual(await hashObservabilityScope("org-beta"), first);
  await assert.rejects(() => hashObservabilityScope("unsafe organization"), /scope is invalid/);
});
