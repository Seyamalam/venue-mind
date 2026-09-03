import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { DATABASE_SCHEMA_VERSION } from "../db/generated-migrations.ts";
import { applyDatabaseMigrations, inspectDatabaseIntegrity } from "../worker/database-migrations.ts";

const NOW = "2026-09-12T12:00:00.000Z";

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

test("database migration 11 installs tenant-scoped live deviation registers", async (t) => {
  const db = new SqliteD1();
  t.after(() => db.close());
  const migrated = await applyDatabaseMigrations(db);
  assert.equal(DATABASE_SCHEMA_VERSION, 12);
  assert.equal(migrated.currentVersion, 12);
  const columns = await db.prepare("PRAGMA table_info(event_day_deviation_registers)").all();
  assert.deepEqual(
    columns.results.map((column) => column.name),
    [
      "id",
      "organization_id",
      "project_id",
      "runbook_id",
      "schema_version",
      "baseline_fingerprint",
      "baseline_json",
      "register_json",
      "revision",
      "ledger_head_hash",
      "created_at",
      "updated_at",
    ],
  );

  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind("user-owner", "test", "owner", "owner@example.test", "active", NOW, NOW),
    db
      .prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind("org-alpha", "ALPHA", "alpha", "user-owner", NOW, NOW),
    db
      .prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind("org-bravo", "BRAVO", "bravo", "user-owner", NOW, NOW),
    db
      .prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind("project-alpha", "org-alpha", "ALPHA", "plan-alpha", NOW, NOW),
    db
      .prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)")
      .bind("project-alpha", 10, "{}", NOW),
    db
      .prepare(
        "INSERT INTO event_day_runbooks (id,organization_id,project_id,schema_version,source_plan_id,source_plan_version,source_plan_fingerprint,source_activity_ledger_head_hash,definition_json,frozen_by,frozen_at,updated_at,sequence,ledger_head_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .bind(
        "runbook-alpha",
        "org-alpha",
        "project-alpha",
        1,
        "plan-alpha",
        "3.3",
        "plan-alpha-fingerprint",
        "activity-ledger-alpha",
        "{}",
        "user-owner",
        NOW,
        NOW,
        0,
        "activity-ledger-alpha",
      ),
  ]);
  db.database.exec("PRAGMA foreign_keys=OFF");
  await db
    .prepare(
      "INSERT INTO event_day_deviation_registers (id,organization_id,project_id,runbook_id,schema_version,baseline_fingerprint,baseline_json,register_json,revision,ledger_head_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      "deviation-corrupt",
      "org-bravo",
      "project-alpha",
      "runbook-alpha",
      1,
      "baseline-alpha",
      "{}",
      "{}",
      0,
      "ledger-alpha",
      NOW,
      NOW,
    )
    .run();

  const integrity = await inspectDatabaseIntegrity(db);
  assert.equal(integrity.status, "fail");
  assert.equal(integrity.checks.find((check) => check.id === "deviation-register-organization-mismatch")?.count, 1);
  assert.equal(integrity.checks.find((check) => check.id === "deviation-register-runbook-scope-mismatch")?.count, 1);
});
