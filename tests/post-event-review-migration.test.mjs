import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DATABASE_SCHEMA_VERSION } from "../db/generated-migrations.ts";
import { applyDatabaseMigrations, inspectDatabaseIntegrity } from "../worker/database-migrations.ts";

class Statement {
  constructor(database, sql, values = []) { this.database = database; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.database, this.sql, values); }
  async first() { return this.database.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.database.prepare(this.sql).all(...this.values) }; }
  async run() { return this.database.prepare(this.sql).run(...this.values); }
}
class SqliteD1 {
  constructor() { this.database = new DatabaseSync(":memory:"); this.database.exec("PRAGMA foreign_keys=ON"); }
  prepare(sql) { return new Statement(this.database, sql); }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  close() { this.database.close(); }
}

test("migration 12 installs tenant-scoped immutable Post-event Reviews", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  const migrated = await applyDatabaseMigrations(db);
  assert.equal(DATABASE_SCHEMA_VERSION, 14);
  assert.equal(migrated.currentVersion, 14);
  const columns = await db.prepare("PRAGMA table_info(post_event_reviews)").all();
  assert.deepEqual(columns.results.map(({ name }) => name), [
    "id", "organization_id", "project_id", "runbook_id", "schema_version", "baseline_fingerprint",
    "definition_fingerprint", "baseline_json", "review_json", "revision", "ledger_head_hash", "created_at", "updated_at",
  ]);
  const trigger = await db.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='validate_post_event_review_update'").first();
  assert.match(trigger.sql, /POST_EVENT_REVIEW_BASELINE_IMMUTABLE/);
  assert.match(trigger.sql, /POST_EVENT_REVIEW_REVISION_INVALID/);
  assert.equal((await inspectDatabaseIntegrity(db)).status, "pass");
});
