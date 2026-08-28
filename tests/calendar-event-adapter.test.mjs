import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fingerprintEventBrief, fingerprintPlan, replayActivityLedger, sealActivityLedger } from "../src/domain/activity-ledger.js";
import { normalizeEventBrief } from "../src/domain/event-brief.js";
import { normalizeEventSchedule } from "../src/domain/event-schedule.js";
import { normalizePlanningEffect } from "../src/domain/planning-effects.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createVenuePlanner, validateVenueState } from "../src/domain/venue-planner.js";
import { calendarEventAdapter } from "../src/integrations/adapters/calendar-event-adapter.js";
import { createAdapterRuntime } from "../src/integrations/runtime.js";
import { createMemoryProcessedBatchStore } from "../src/integrations/processed-batch-store.js";
import { createMemorySecretStore } from "../src/integrations/secret-store.js";
import { assertStagingBatchIntegrity, loadAdapterProposalForReview } from "../src/integrations/staging.js";
import { createMemoryWebhookEventStore } from "../src/integrations/webhook-event-store.js";

const readFixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const attendanceFixture = await readFixture("adapter-calendar-event-attendance-v1.json");
const scheduleFixture = await readFixture("adapter-calendar-event-schedule-v1.json");
const metadataFixture = await readFixture("adapter-calendar-event-metadata-v1.json");
const webhookFixture = await readFixture("adapter-calendar-event-webhook-v1.json");
const clock = () => Date.parse("2026-08-28T12:00:00.000Z");
const secretStore = createMemorySecretStore({ "calendar-events/api-token": "fixture-token" });
const authorization = { grantedScopes: ["calendar:event:read"], secretStore, secretReferences: ["calendar-events/api-token"] };

const planningEffectBindingsFor = (fixture) => ({
  set_attendance_target: { targetRequirementId: fixture.requirementIds.attendance, category: "seating", affectedConstraintIds: [...fixture.attendanceConstraintIds].sort() },
  set_event_schedule: { targetRequirementId: fixture.requirementIds.schedule, category: "staffing", affectedConstraintIds: [] },
});

const planFor = (fixture) => {
  const plan = structuredClone(summitForwardPlan);
  plan.brief.schedule = structuredClone(fixture.currentPlanningState.schedule);
  const canonicalRequirements = [
    { id: fixture.requirementIds.attendance, category: "seating", label: `Attendance target ${fixture.currentPlanningState.attendeeTarget}`, priority: "high", owner: null, status: "confirmed", measurable: true, constraintIds: [...fixture.attendanceConstraintIds].sort(), evidenceRefs: [] },
    { id: fixture.requirementIds.schedule, category: "staffing", label: "Calendar event schedule", priority: "high", owner: null, status: "confirmed", measurable: false, constraintIds: [], evidenceRefs: [] },
  ];
  const ids = new Set(canonicalRequirements.map((requirement) => requirement.id));
  plan.brief.requirements = [...plan.brief.requirements.filter((requirement) => !ids.has(requirement.id)), ...canonicalRequirements];
  return plan;
};

const projectContextFor = (fixture) => {
  const plan = planFor(fixture);
  return { projectId: fixture.projectId, brief: plan.brief, constraints: plan.constraints, planningEffectBindings: planningEffectBindingsFor(fixture) };
};

const runtimeFor = (fixture, options = {}) => createAdapterRuntime({ clock, projectContext: projectContextFor(fixture), ...options });

const plannerFor = (fixture) => {
  const planner = createVenuePlanner(planFor(fixture), { projectId: fixture.projectId, adapterPlanningBindings: planningEffectBindingsFor(fixture) });
  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "accept-calendar-test-baseline" });
  return planner;
};

test("Calendar Event import retains complete sanitized source evidence and maps the external Event to a stable Project", async () => {
  const result = await runtimeFor(attendanceFixture).execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  assert.equal(result.status, "succeeded");
  assert.equal(result.output.sourceSystem, "calendar-production");
  assert.equal(result.output.sourceVersion, "calendar-revision-18");
  assert.equal(result.output.synchronizedAt, "2026-08-28T12:00:00.000Z");
  assert.equal(result.output.mappings.length, 1);
  assert.equal(result.output.mappings[0].venueEntityType, "project");
  assert.equal(result.output.mappings[0].venueObjectId, attendanceFixture.projectId);
  assert.notEqual(result.output.mappings[0].venueObjectId, attendanceFixture.event.externalId);
  assert.equal(result.output.sourceRecords[0].descriptive.title, attendanceFixture.event.title);
  assert.deepEqual(result.output.sourceRecords[0].descriptive.location, attendanceFixture.event.location);
  assert.deepEqual(result.output.sourceRecords[0].descriptive.organizer, attendanceFixture.event.organizer);
  assert.equal(result.output.sourceRecords[0].external.checksum, result.output.mappings[0].checksum);
});

test("staging reload recomputes nested integrity and verifies checksum-derived IDs", async () => {
  const result = await runtimeFor(attendanceFixture).execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  assert.equal(Object.isFrozen(result.output), false, "runtime returns a trusted detached reload");
  assert.equal(await assertStagingBatchIntegrity(result.output), true);
  const mappingTamper = structuredClone(result.output);
  mappingTamper.mappings[0].external.sourceVersion = "attacker-revision";
  await assert.rejects(() => assertStagingBatchIntegrity(mappingTamper), (error) => error.code === "ADAPTER_STAGING_INTEGRITY_FAILED");
  const idTamper = structuredClone(result.output);
  idTamper.id = "adapter-batch-0000000000000000";
  await assert.rejects(() => loadAdapterProposalForReview(plannerFor(attendanceFixture), idTamper), (error) => error.code === "ADAPTER_STAGING_INTEGRITY_FAILED");
  const extensionTamper = structuredClone(result.output);
  extensionTamper.uncheckedEvidence = { trusted: true };
  await assert.rejects(() => assertStagingBatchIntegrity(extensionTamper), (error) => error.code === "ADAPTER_STAGING_INTEGRITY_FAILED");
});

test("attendance updates become one canonical reviewable Planning Change and invalidate only capacity and flow evidence", async () => {
  const planner = plannerFor(attendanceFixture);
  const before = planner.getSnapshot();
  const acceptedValidation = validateVenueState({ ...before, proposal: null });
  const acceptedPlanFingerprint = fingerprintPlan(before.plan);
  const acceptedBriefFingerprint = fingerprintEventBrief(before.brief);
  const result = await runtimeFor(attendanceFixture).execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  const [change] = result.output.proposal.changes;

  assert.equal(change.targetObjectIds.length, 0);
  assert.deepEqual(change.targetRequirementIds, ["req-calendar-attendance"]);
  assert.deepEqual(change.spatialEffects, []);
  assert.equal(change.planningEffects[0].operation, "set_attendance_target");
  assert.deepEqual(change.planningEffects[0].affectedConstraintIds, ["constraint-capacity", "constraint-peak-congestion"]);
  assert.deepEqual(change.planningEffects[0].evidenceFamilies, ["capacity", "flow"]);

  await loadAdapterProposalForReview(planner, result.output);
  assert.equal(fingerprintPlan(planner.getSnapshot().plan), acceptedPlanFingerprint);
  assert.equal(fingerprintEventBrief(planner.getSnapshot().brief), acceptedBriefFingerprint);
  assert.equal(validateVenueState({ ...planner.getSnapshot(), proposal: null }).inputFingerprint, acceptedValidation.inputFingerprint);
  assert.equal(planner.execute({ type: "get_project_brief" }).attendeeTarget, 390);
  const candidateValidation = planner.execute({ type: "validate_layout" });
  assert.deepEqual(candidateValidation.planningEvidenceInvalidations, { affectedConstraintIds: ["constraint-capacity", "constraint-peak-congestion"], evidenceFamilies: ["capacity", "flow"] });
  const changedEvidenceFamilies = Object.keys(candidateValidation.evidenceFamilyFingerprints).filter((key) => candidateValidation.evidenceFamilyFingerprints[key] !== acceptedValidation.evidenceFamilyFingerprints[key]).sort();
  assert.deepEqual(changedEvidenceFamilies, ["capacity", "flow"]);

  const proposal = planner.getSnapshot().proposal;
  const approval = planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "approve-calendar-attendance" });
  assert.equal(approval.status, "approved");
  assert.equal(planner.getSnapshot().brief.attendeeTarget, 390);
  assert.equal(planner.getSnapshot().brief.requirements.find((item) => item.id === "req-calendar-attendance").status, "confirmed");
  const ledgerText = JSON.stringify(planner.getSnapshot().ledger.at(-1));
  assert.match(ledgerText, new RegExp(change.id));
  assert.doesNotMatch(ledgerText, /External calendar heading|Grand Hall|Summit Operations|Forward Events/);
  assert.equal(replayActivityLedger(planner.getSnapshot().ledger, planner.getSnapshot().plan, planner.getSnapshot().brief).status, "pass");

  planner.execute({ type: "undo", actor: "human", idempotencyKey: "undo-calendar-attendance" });
  assert.equal(planner.getSnapshot().brief.attendeeTarget, 400);
  planner.execute({ type: "redo", actor: "human", idempotencyKey: "redo-calendar-attendance" });
  assert.equal(planner.getSnapshot().brief.attendeeTarget, 390);
});

test("schedule changes use the typed Planning Effect and preserve the stable Requirement ID", async () => {
  const result = await runtimeFor(scheduleFixture).execute(calendarEventAdapter, "synchronize", structuredClone(scheduleFixture), authorization);
  assert.equal(result.status, "succeeded");
  assert.equal(result.output.proposal.changes.length, 1);
  const [effect] = result.output.proposal.changes[0].planningEffects;
  assert.equal(effect.operation, "set_event_schedule");
  assert.equal(effect.targetRequirementId, "req-calendar-schedule");
  assert.deepEqual(effect.evidenceFamilies, ["operations"]);
  const planner = plannerFor(scheduleFixture);
  await loadAdapterProposalForReview(planner, result.output);
  assert.deepEqual(planner.execute({ type: "get_project_brief" }).schedule, { startAt: "2026-09-18T10:00:00+06:00", endAt: "2026-09-18T18:00:00+06:00", timezone: "Asia/Dhaka" });
  assert.deepEqual(planner.getSnapshot().brief.schedule, scheduleFixture.currentPlanningState.schedule);
});

test("ordinary Event Brief edits also round-trip through Activity Ledger replay", () => {
  const planner = plannerFor(metadataFixture);
  const brief = planner.getSnapshot().brief;
  planner.execute({ type: "update_event_brief", brief: { ...brief, attendeeTarget: 395 }, actor: "human", idempotencyKey: "brief-replay-after-calendar-foundation" });
  const snapshot = planner.getSnapshot();
  assert.equal(replayActivityLedger(snapshot.ledger, snapshot.plan, snapshot.brief).status, "pass");
  assert.equal(snapshot.ledger.at(-1).details.briefFingerprint, fingerprintEventBrief(snapshot.brief));
});

test("descriptive-only calendar updates create no planning Change and alter no validation evidence", async () => {
  const planner = plannerFor(metadataFixture);
  const before = planner.execute({ type: "validate_layout" });
  const ledgerLength = planner.getSnapshot().ledger.length;
  const result = await runtimeFor(metadataFixture).execute(calendarEventAdapter, "import", structuredClone(metadataFixture), authorization);
  const after = planner.execute({ type: "validate_layout" });
  assert.equal(result.status, "succeeded");
  assert.equal(result.output.status, "no-changes");
  assert.equal(result.output.proposal, null);
  await assert.rejects(() => loadAdapterProposalForReview(planner, result.output), (error) => error.code === "ADAPTER_REVIEW_BYPASS");
  assert.deepEqual(after.evidenceFamilyFingerprints, before.evidenceFamilyFingerprints);
  assert.equal(result.output.sourceRecords[0].descriptive.title, "Summit Forward — doors open");
  assert.equal(planner.getSnapshot().ledger.length, ledgerLength);
});

test("adapter review rejects caller-controlled cross-Project mappings", async () => {
  const result = await runtimeFor(attendanceFixture).execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  const wrongProjectFixture = { ...attendanceFixture, projectId: "project-server-owned-other" };
  const wrongProjectPlanner = plannerFor(wrongProjectFixture);
  await assert.rejects(() => loadAdapterProposalForReview(wrongProjectPlanner, result.output), (error) => error.code === "ADAPTER_PROJECT_BINDING_MISMATCH" && error.details.expectedProjectId === "project-server-owned-other");
  const unboundPlan = structuredClone(summitForwardPlan);
  unboundPlan.brief.schedule = structuredClone(attendanceFixture.currentPlanningState.schedule);
  const unboundPlanner = createVenuePlanner(unboundPlan);
  const initial = unboundPlanner.getSnapshot().proposal;
  unboundPlanner.execute({ type: "approve_proposal", proposalId: initial.id, baseVersion: initial.baseVersion, actor: "human", idempotencyKey: "accept-unbound-baseline" });
  await assert.rejects(() => loadAdapterProposalForReview(unboundPlanner, result.output), (error) => error.code === "ADAPTER_PROJECT_BINDING_REQUIRED");
});

test("server-owned Planning Effect bindings reject Requirement and Constraint substitution", async () => {
  const attack = structuredClone(attendanceFixture);
  attack.requirementIds.attendance = "req-accessible-route";
  attack.attendanceConstraintIds = ["constraint-sightlines"];
  await assert.rejects(() => runtimeFor(attendanceFixture).execute(calendarEventAdapter, "import", attack, authorization), (error) => error.code === "ADAPTER_PLANNING_BINDING_MISMATCH");
});

test("metadata-only batches require trusted Project binding before idempotency persistence", async () => {
  const processedBatchStore = createMemoryProcessedBatchStore();
  const runtime = createAdapterRuntime({ clock, processedBatchStore });
  await assert.rejects(() => runtime.execute(calendarEventAdapter, "import", structuredClone(metadataFixture), authorization), (error) => error.code === "ADAPTER_PROJECT_BINDING_REQUIRED");
  assert.equal(processedBatchStore.list().length, 0);
});

test("empty adapter Proposals cannot enter review or advance accepted Plan truth", async () => {
  const planner = plannerFor(metadataFixture);
  const planVersion = planner.getSnapshot().plan.version;
  const result = await runtimeFor(metadataFixture).execute(calendarEventAdapter, "import", structuredClone(metadataFixture), authorization);
  assert.equal(result.output.status, "no-changes");
  await assert.rejects(() => loadAdapterProposalForReview(planner, result.output), (error) => error.code === "ADAPTER_REVIEW_BYPASS");
  const snapshot = structuredClone(planner.getSnapshot());
  const emptyProposal = { id: "proposal-adapter-empty", revision: snapshot.proposal.revision + 1, baseVersion: snapshot.plan.version, status: "review", goal: "No planning delta", changes: [], validation: null, waivers: [] };
  snapshot.proposal = emptyProposal;
  snapshot.branches = snapshot.branches.map((branch) => branch.id === snapshot.activeBranchId ? { ...branch, proposal: emptyProposal } : branch);
  planner.execute({ type: "restore_snapshot", snapshot });
  assert.throws(() => planner.execute({ type: "approve_proposal", proposalId: emptyProposal.id, baseVersion: emptyProposal.baseVersion, actor: "human", idempotencyKey: "reject-empty-adapter-proposal" }), (error) => error.code === "PROPOSAL_EMPTY");
  assert.equal(planner.getSnapshot().plan.version, planVersion);
});

test("Activity Ledger replay rejects accepted Brief tampering at command and restore boundaries", () => {
  const planner = plannerFor(metadataFixture);
  planner.getSnapshot().brief.attendeeTarget = 399;
  const replay = planner.execute({ type: "replay_history" });
  assert.equal(replay.status, "fail");
  assert.notEqual(replay.replayedBriefFingerprint, replay.currentBriefFingerprint);

  const source = plannerFor(metadataFixture);
  const snapshot = structuredClone(source.getSnapshot());
  snapshot.brief.attendeeTarget = 399;
  assert.throws(() => plannerFor(metadataFixture).execute({ type: "restore_snapshot", snapshot }), (error) => error.code === "LEDGER_INTEGRITY_FAILED" && error.details.replay.replayedBriefFingerprint !== error.details.replay.currentBriefFingerprint);
});

test("resealed legacy ledgers without accepted Brief proof fail closed", () => {
  const source = plannerFor(metadataFixture);
  const snapshot = structuredClone(source.getSnapshot());
  snapshot.ledger = sealActivityLedger(snapshot.ledger.map((entry) => {
    const details = structuredClone(entry.details);
    delete details.acceptedBrief;
    delete details.briefFingerprint;
    delete details.briefMigrationProof;
    return { ...entry, details };
  }));
  snapshot.brief.attendeeTarget = 399;
  assert.throws(() => plannerFor(metadataFixture).execute({ type: "restore_snapshot", snapshot }), (error) => error.code === "LEDGER_INTEGRITY_FAILED" && error.details.replay?.status === "fail");
});

test("unsealed legacy migration pins the exact trusted initial Brief", () => {
  const source = plannerFor(metadataFixture);
  const snapshot = structuredClone(source.getSnapshot());
  snapshot.ledger = snapshot.ledger.map((entry) => {
    const details = structuredClone(entry.details);
    delete details.acceptedBrief;
    delete details.briefFingerprint;
    const { hash: _hash, previousHash: _previousHash, schemaVersion: _schemaVersion, ...legacy } = entry;
    return { ...legacy, details };
  });
  const restored = plannerFor(metadataFixture);
  restored.execute({ type: "restore_snapshot", snapshot });
  const proof = restored.getSnapshot().ledger.filter((entry) => entry.details?.acceptedPlan).at(-1).details.briefMigrationProof;
  assert.deepEqual(proof, { source: "trusted-initial-brief", briefFingerprint: fingerprintEventBrief(restored.getSnapshot().brief) });
});

test("restore normalizes active and historical Planning Effects with one stable error", async () => {
  const result = await runtimeFor(attendanceFixture).execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  const activePlanner = plannerFor(attendanceFixture);
  await loadAdapterProposalForReview(activePlanner, result.output);
  const activeSnapshot = structuredClone(activePlanner.getSnapshot());
  activeSnapshot.proposal.changes[0].planningEffects[0].operation = "replace_brief";
  activeSnapshot.branches.find((branch) => branch.id === activeSnapshot.activeBranchId).proposal = structuredClone(activeSnapshot.proposal);
  assert.throws(() => plannerFor(attendanceFixture).execute({ type: "restore_snapshot", snapshot: activeSnapshot }), (error) => error.code === "PLANNING_EFFECT_INVALID" && /unsupported operation/.test(error.details.cause));

  const historyPlanner = plannerFor(attendanceFixture);
  await loadAdapterProposalForReview(historyPlanner, result.output);
  const historySnapshot = structuredClone(historyPlanner.getSnapshot());
  const maliciousRevision = structuredClone(historySnapshot.proposal);
  maliciousRevision.id = "proposal-malicious-history";
  maliciousRevision.changes[0].planningEffects[0].affectedConstraintIds = ["constraint-sightlines"];
  historySnapshot.branches.find((branch) => branch.id === historySnapshot.activeBranchId).revisions.push(maliciousRevision);
  assert.throws(() => plannerFor(attendanceFixture).execute({ type: "restore_snapshot", snapshot: historySnapshot }), (error) => error.code === "PLANNING_EFFECT_INVALID");
});

test("legacy Event Briefs without schedule remain schema-compatible", () => {
  const legacy = structuredClone(summitForwardPlan.brief);
  delete legacy.schedule;
  assert.equal(normalizeEventBrief(legacy).schedule, null);
});

test("every schedule seam requires canonical RFC3339 offsets and honors DST", async () => {
  const dstSchedule = { startAt: "2026-11-01T01:30:00-04:00", endAt: "2026-11-01T01:30:00-05:00", timezone: "America/New_York" };
  assert.deepEqual(normalizeEventSchedule(dstSchedule), dstSchedule);
  const validInput = structuredClone(attendanceFixture);
  validInput.currentPlanningState.schedule = structuredClone(dstSchedule);
  Object.assign(validInput.event, dstSchedule);
  assert.equal((await runtimeFor(validInput).execute(calendarEventAdapter, "import", validInput, authorization)).status, "succeeded");

  const validResult = await runtimeFor(attendanceFixture).execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  const validEffect = validResult.output.proposal.changes[0].planningEffects[0];
  for (const invalidStartAt of ["2026-09-18", "09/18/2026 09:00", "2026-09-18T09:00:00", "2026-09-18T09:00:00+05:00", "2026-02-30T09:00:00+06:00"]) {
    assert.throws(() => normalizeEventSchedule({ ...attendanceFixture.currentPlanningState.schedule, startAt: invalidStartAt }), /RFC3339|offset|valid/i, invalidStartAt);
    assert.throws(() => normalizeEventBrief({ ...summitForwardPlan.brief, schedule: { ...attendanceFixture.currentPlanningState.schedule, startAt: invalidStartAt } }), /RFC3339|offset|valid/i, invalidStartAt);
    assert.throws(() => normalizePlanningEffect({ ...validEffect, operation: "set_event_schedule", targetRequirementId: "req-calendar-schedule", before: null, after: { ...attendanceFixture.currentPlanningState.schedule, startAt: invalidStartAt }, requirement: { ...validEffect.requirement, id: "req-calendar-schedule", category: "staffing", constraintIds: [] }, affectedConstraintIds: [], evidenceFamilies: ["operations"] }), /Planning Effect invalid/i, invalidStartAt);
    const invalidInput = structuredClone(attendanceFixture);
    invalidInput.event.startAt = invalidStartAt;
    const result = await runtimeFor(attendanceFixture).execute(calendarEventAdapter, "import", invalidInput, authorization);
    assert.equal(result.status, "dead-lettered", invalidStartAt);
    assert.equal(result.deadLetter.terminalCode, "ADAPTER_SOURCE_INVALID", invalidStartAt);
  }
});

test("calendar imports are idempotent and deterministic", async () => {
  const runtime = runtimeFor(attendanceFixture);
  const first = await runtime.execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  const second = await runtime.execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "duplicate");
  assert.equal(second.output.id, first.output.id);
  assert.equal(second.output.proposal.changes[0].id, first.output.proposal.changes[0].id);
});

test("calendar webhook fixtures normalize deterministically without contact PII", async () => {
  const runtime = createAdapterRuntime({ clock, webhookEventStore: createMemoryWebhookEventStore() });
  const webhookAuthorization = { grantedScopes: ["calendar:event:webhook"], secretStore, secretReferences: [] };
  const first = await runtime.acceptWebhook(calendarEventAdapter, structuredClone(webhookFixture), webhookAuthorization);
  const second = await runtime.acceptWebhook(calendarEventAdapter, structuredClone(webhookFixture), webhookAuthorization);
  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "duplicate");
  assert.equal(first.output.payload.timezone, "Asia/Dhaka");
  assert.deepEqual(first.output.payload.organizer, webhookFixture.event.organizer);
  assert.match(first.output.checksum, /^[0-9a-f]{64}$/);
});

test("calendar webhook deduplication survives restart, concurrency, and source collisions", async () => {
  const webhookEventStore = createMemoryWebhookEventStore();
  const webhookAuthorization = { grantedScopes: ["calendar:event:webhook"], secretStore, secretReferences: [] };
  const firstRuntime = createAdapterRuntime({ clock, webhookEventStore });
  const concurrentRuntime = createAdapterRuntime({ clock, webhookEventStore });
  const results = await Promise.all([
    firstRuntime.acceptWebhook(calendarEventAdapter, structuredClone(webhookFixture), webhookAuthorization),
    concurrentRuntime.acceptWebhook(calendarEventAdapter, structuredClone(webhookFixture), webhookAuthorization),
  ]);
  assert.deepEqual(results.map((result) => result.status).sort(), ["duplicate", "succeeded"]);
  const restarted = createAdapterRuntime({ clock, webhookEventStore });
  assert.equal((await restarted.acceptWebhook(calendarEventAdapter, structuredClone(webhookFixture), webhookAuthorization)).status, "duplicate");
  const otherSource = { ...structuredClone(webhookFixture), sourceSystem: "calendar-secondary" };
  assert.equal((await restarted.acceptWebhook(calendarEventAdapter, otherSource, webhookAuthorization)).status, "succeeded");
  assert.equal(webhookEventStore.list().length, 2);
  assert.match(webhookEventStore.list()[0].key, /^calendar-events@1\.0\.0\u0000calendar-production\u0000webhook-calendar-019$/);
});

test("calendar webhooks enforce the exact published event-type enum", async () => {
  const webhookEventStore = createMemoryWebhookEventStore();
  const webhookAuthorization = { grantedScopes: ["calendar:event:webhook"], secretStore, secretReferences: [] };
  const result = await createAdapterRuntime({ clock, webhookEventStore }).acceptWebhook(calendarEventAdapter, { ...structuredClone(webhookFixture), type: "event.owner-promoted" }, webhookAuthorization);
  assert.equal(result.status, "dead-lettered");
  assert.equal(result.deadLetter.terminalCode, "ADAPTER_SOURCE_INVALID");
});

test("invalid calendar timezones fail closed", async () => {
  const input = structuredClone(attendanceFixture);
  input.event.timezone = "Mars/Olympus";
  const result = await runtimeFor(attendanceFixture).execute(calendarEventAdapter, "import", input, authorization);
  assert.equal(result.status, "dead-lettered");
  assert.equal(result.deadLetter.terminalCode, "ADAPTER_SOURCE_INVALID");
});
