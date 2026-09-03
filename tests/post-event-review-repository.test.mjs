import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fingerprintPlan } from "../src/domain/activity-ledger.ts";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { createIncidentRegister } from "../src/domain/incidents.ts";
import { createLivePlanDeviationRegister } from "../src/domain/live-plan-deviations.ts";
import { createLiveOccupancyMonitor, evaluateLiveOccupancy } from "../src/domain/live-occupancy.ts";
import { createPostEventReview, recordPostEventObservation } from "../src/domain/post-event-review.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import { createD1PostEventReviewRepository, PostEventReviewConflict } from "../worker/post-event-review-repository.ts";

const NOW = "2026-09-12T18:00:00.000Z";
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
    try { const results = []; for (const statement of statements) results.push(await statement.run()); this.database.exec("COMMIT"); return results; }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  close() { this.database.close(); }
}

const projectId = "project-alpha";
const runbook = createEventDayRunbook({ projectId, plan: summitForwardPlan, validation: { validationId: "validation", inputFingerprint: "validation-input", status: "pass" }, sourceLedgerHeadHash: "activity-head", approvalLedgerEntryId: "approval", frozenAt: "2026-09-12T08:00:00.000Z", frozenBy: "user-owner" });
const monitor = createLiveOccupancyMonitor({ projectId, runbook, createdAt: "2026-09-12T08:05:00.000Z", createdBy: "user-owner" });
const incidents = createIncidentRegister({ type: "create_incident_register", projectId, runbook, createdAt: "2026-09-12T08:05:00.000Z", createdBy: "user-owner" });
const deviations = createLivePlanDeviationRegister({ type: "create_deviation_register", projectId, runbook, createdAt: "2026-09-12T08:05:00.000Z", createdBy: "user-owner" });
const makeReview = () => createPostEventReview({
  type: "create_post_event_review", projectId, runbook, occupancyMonitor: monitor,
  occupancyProjection: evaluateLiveOccupancy(monitor, { at: NOW }), incidentRegister: incidents,
  deviationRegister: deviations, scenarioRuns: [], createdAt: NOW, createdBy: "user-owner",
  predictions: [{ key: "incidents:incident-count:venue:venue", family: "incidents", metric: "incident-count", scope: { kind: "venue", id: "venue" }, value: 0, unit: "incidents", betterWhen: "lower", tolerance: { absolute: 0, relative: 0 }, evidenceRefs: [{ kind: "accepted-plan", id: summitForwardPlan.id, fingerprint: fingerprintPlan(summitForwardPlan) }] }],
});

async function harness() {
  const db = new SqliteD1();
  await applyDatabaseMigrations(db);
  await db.batch([
    db.prepare("INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind("user-owner", "test", "owner", "owner@example.test", "active", NOW, NOW),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-alpha", "ALPHA", "alpha", "user-owner", NOW, NOW),
    db.prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind("org-bravo", "BRAVO", "bravo", "user-owner", NOW, NOW),
    db.prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(projectId, "org-alpha", "ALPHA", summitForwardPlan.id, NOW, NOW),
    db.prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)").bind(projectId, 10, "{}", NOW),
    db.prepare("INSERT INTO event_day_runbooks (id,organization_id,project_id,schema_version,source_plan_id,source_plan_version,source_plan_fingerprint,source_activity_ledger_head_hash,definition_json,frozen_by,frozen_at,updated_at,sequence,ledger_head_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(runbook.versionId, "org-alpha", projectId, 1, runbook.source.planId, String(runbook.source.planVersion), runbook.source.planFingerprint, runbook.source.sourceLedgerHeadHash, "{}", "user-owner", NOW, NOW, 0, runbook.source.sourceLedgerHeadHash),
  ]);
  return { db, repository: createD1PostEventReviewRepository(db) };
}

test("Post-event Review repository persists and isolates one immutable Runbook definition", async (t) => {
  const { db, repository } = await harness(); t.after(() => db.close());
  const review = makeReview();
  assert.deepEqual(await repository.create("org-alpha", projectId, review), review);
  assert.deepEqual(await repository.get("org-alpha", projectId, review.id), review);
  assert.deepEqual(await repository.getByRunbook("org-alpha", projectId, runbook.versionId), review);
  assert.equal(await repository.get("org-bravo", projectId, review.id), null);
  assert.deepEqual(await repository.create("org-alpha", projectId, structuredClone(review)), review);
});

test("repository conditionally advances one verified revision and rejects stale or changed baselines", async (t) => {
  const { db, repository } = await harness(); t.after(() => db.close());
  const review = makeReview(); await repository.create("org-alpha", projectId, review);
  const next = recordPostEventObservation(review, { type: "record_post_event_observation", observationId: "observation-incidents", predictionKey: "incidents:incident-count:venue:venue", value: 0, confidence: "measured", evidenceRefs: review.predictions[0].evidenceRefs, idempotencyKey: "observe", expectedRevision: 0, actorType: "human", actorId: "user-owner", source: "studio", sessionId: "session", committedAt: "2026-09-12T18:01:00.000Z" }).review;
  await repository.put("org-alpha", projectId, next, 0);
  await assert.rejects(() => repository.put("org-alpha", projectId, next, 0), (error) => error instanceof PostEventReviewConflict && error.code === "POST_EVENT_REVIEW_REVISION_CONFLICT");
  const forged = structuredClone(next); forged.baseline.runbook.versionId = "forged"; forged.revision = 2;
  await assert.rejects(() => repository.put("org-alpha", projectId, forged, 1), (error) => error instanceof PostEventReviewConflict && error.code === "POST_EVENT_REVIEW_BASELINE_IMMUTABLE");
  assert.deepEqual(await repository.get("org-alpha", projectId, review.id), next);
});

test("repository reads fail closed on stored state tampering", async (t) => {
  const { db, repository } = await harness(); t.after(() => db.close());
  const review = makeReview(); await repository.create("org-alpha", projectId, review);
  const stored = await db.prepare("SELECT review_json FROM post_event_reviews WHERE id=?").bind(review.id).first();
  const forged = JSON.parse(stored.review_json); forged.predictions[0].value = 99;
  db.database.exec("DROP TRIGGER validate_post_event_review_update");
  await db.prepare("UPDATE post_event_reviews SET review_json=? WHERE id=?").bind(JSON.stringify(forged), review.id).run();
  await assert.rejects(() => repository.get("org-alpha", projectId, review.id), (error) => error instanceof PostEventReviewConflict && error.code === "POST_EVENT_REVIEW_INTEGRITY_FAILED");
});
