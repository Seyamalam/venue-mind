import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fingerprintEventBrief, fingerprintPlan, replayActivityLedger } from "../src/domain/activity-ledger.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createVenuePlanner, validateVenueState } from "../src/domain/venue-planner.js";
import { calendarEventAdapter } from "../src/integrations/adapters/calendar-event-adapter.js";
import { createAdapterRuntime } from "../src/integrations/runtime.js";
import { createMemorySecretStore } from "../src/integrations/secret-store.js";
import { loadAdapterProposalForReview } from "../src/integrations/staging.js";

const readFixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
const attendanceFixture = await readFixture("adapter-calendar-event-attendance-v1.json");
const scheduleFixture = await readFixture("adapter-calendar-event-schedule-v1.json");
const metadataFixture = await readFixture("adapter-calendar-event-metadata-v1.json");
const webhookFixture = await readFixture("adapter-calendar-event-webhook-v1.json");
const clock = () => Date.parse("2026-08-28T12:00:00.000Z");
const secretStore = createMemorySecretStore({ "calendar-events/api-token": "fixture-token" });
const authorization = { grantedScopes: ["calendar:event:read"], secretStore, secretReferences: ["calendar-events/api-token"] };

const plannerFor = (fixture) => {
  const plan = structuredClone(summitForwardPlan);
  plan.brief.schedule = structuredClone(fixture.currentPlanningState.schedule);
  const planner = createVenuePlanner(plan, { projectId: fixture.projectId });
  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "accept-calendar-test-baseline" });
  return planner;
};

test("Calendar Event import retains complete sanitized source evidence and maps the external Event to a stable Project", async () => {
  const result = await createAdapterRuntime({ clock }).execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
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

test("attendance updates become one canonical reviewable Planning Change and invalidate only capacity and flow evidence", async () => {
  const planner = plannerFor(attendanceFixture);
  const before = planner.getSnapshot();
  const acceptedValidation = validateVenueState({ ...before, proposal: null });
  const acceptedPlanFingerprint = fingerprintPlan(before.plan);
  const acceptedBriefFingerprint = fingerprintEventBrief(before.brief);
  const result = await createAdapterRuntime({ clock }).execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  const [change] = result.output.proposal.changes;

  assert.equal(change.targetObjectIds.length, 0);
  assert.deepEqual(change.targetRequirementIds, ["req-calendar-attendance"]);
  assert.deepEqual(change.spatialEffects, []);
  assert.equal(change.planningEffects[0].operation, "set_attendance_target");
  assert.deepEqual(change.planningEffects[0].affectedConstraintIds, ["constraint-capacity", "constraint-peak-congestion"]);
  assert.deepEqual(change.planningEffects[0].evidenceFamilies, ["capacity", "flow"]);

  loadAdapterProposalForReview(planner, result.output);
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
  const result = await createAdapterRuntime({ clock }).execute(calendarEventAdapter, "synchronize", structuredClone(scheduleFixture), authorization);
  assert.equal(result.status, "succeeded");
  assert.equal(result.output.proposal.changes.length, 1);
  const [effect] = result.output.proposal.changes[0].planningEffects;
  assert.equal(effect.operation, "set_event_schedule");
  assert.equal(effect.targetRequirementId, "req-calendar-schedule");
  assert.deepEqual(effect.evidenceFamilies, ["operations"]);
  const planner = plannerFor(scheduleFixture);
  loadAdapterProposalForReview(planner, result.output);
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
  const result = await createAdapterRuntime({ clock }).execute(calendarEventAdapter, "import", structuredClone(metadataFixture), authorization);
  const after = planner.execute({ type: "validate_layout" });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.output.proposal.changes, []);
  assert.deepEqual(after.evidenceFamilyFingerprints, before.evidenceFamilyFingerprints);
  assert.equal(result.output.sourceRecords[0].descriptive.title, "Summit Forward — doors open");
  assert.equal(planner.getSnapshot().ledger.length, ledgerLength);
});

test("calendar imports are idempotent and deterministic", async () => {
  const runtime = createAdapterRuntime({ clock });
  const first = await runtime.execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  const second = await runtime.execute(calendarEventAdapter, "import", structuredClone(attendanceFixture), authorization);
  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "duplicate");
  assert.equal(second.output.id, first.output.id);
  assert.equal(second.output.proposal.changes[0].id, first.output.proposal.changes[0].id);
});

test("calendar webhook fixtures normalize deterministically without contact PII", async () => {
  const runtime = createAdapterRuntime({ clock });
  const webhookAuthorization = { grantedScopes: ["calendar:event:webhook"], secretStore, secretReferences: [] };
  const first = await runtime.acceptWebhook(calendarEventAdapter, structuredClone(webhookFixture), webhookAuthorization);
  const second = await runtime.acceptWebhook(calendarEventAdapter, structuredClone(webhookFixture), webhookAuthorization);
  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "duplicate");
  assert.equal(first.output.payload.timezone, "Asia/Dhaka");
  assert.deepEqual(first.output.payload.organizer, webhookFixture.event.organizer);
  assert.match(first.output.checksum, /^[0-9a-f]{64}$/);
});

test("invalid calendar timezones fail closed", async () => {
  const input = structuredClone(attendanceFixture);
  input.event.timezone = "Mars/Olympus";
  const result = await createAdapterRuntime({ clock }).execute(calendarEventAdapter, "import", input, authorization);
  assert.equal(result.status, "dead-lettered");
  assert.equal(result.deadLetter.terminalCode, "ADAPTER_SOURCE_INVALID");
});
