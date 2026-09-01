import test from "node:test";
import assert from "node:assert/strict";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createEventDayRunbook, deriveRunbookHandoff, taskReadiness, transitionRunbookTask, validateRunbookDefinition, verifyRunbookLedger } from "../src/domain/event-day-runbook.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const schedule = { startAt: "2026-09-12T08:00:00-04:00", endAt: "2026-09-12T16:00:00-04:00", timezone: "America/New_York" };
const makeRunbook = () => createEventDayRunbook({
  projectId: "project-summit-forward",
  plan: summitForwardPlan,
  brief: { ...summitForwardPlan.brief, schedule },
  validation: { validationId: "validation-approved", inputFingerprint: "input-approved", status: "pass" },
  sourceLedgerHeadHash: "ledger-source-head",
  approvalLedgerEntryId: "ledger-approval",
  frozenAt: "2026-09-11T20:00:00.000Z",
  frozenBy: "user-ops",
});

const commandFor = (runbook, taskId, toStatus, overrides = {}) => ({
  runbookVersionId: runbook.versionId,
  taskId,
  expectedTaskRevision: runbook.tasks.find((task) => task.id === taskId).revision,
  toStatus,
  evidence: [],
  operationId: `operation-${taskId}-${toStatus}`,
  idempotencyKey: `idem-${taskId}-${toStatus}`,
  correlationId: `corr-${taskId}-${toStatus}`,
  clientId: "client-ops-tablet",
  clientSequence: 1,
  clientOccurredAt: "2026-09-12T12:00:00.000Z",
  actorType: "human",
  actorId: "user-ops",
  source: "studio",
  sessionId: "session-event-day",
  ...overrides,
});

test("Runbook Version freezes accepted Plan evidence with deterministic phases and stable task IDs", () => {
  const first = makeRunbook();
  const second = makeRunbook();
  assert.equal(first.versionId, second.versionId);
  assert.equal(first.definitionFingerprint, second.definitionFingerprint);
  assert.deepEqual(first.phases.map((phase) => phase.kind), ["setup", "doors", "live-event", "interval", "egress", "breakdown"]);
  assert.deepEqual(first.tasks.map((task) => task.id), second.tasks.map((task) => task.id));
  assert.equal(first.source.planVersion, summitForwardPlan.version);
  assert.equal(first.baseline.acceptedPlan.id, summitForwardPlan.id);
  assert.ok(Object.isFrozen(first.baseline.acceptedPlan));
  assert.equal(verifyRunbookLedger(first).status, "pass");
});

test("Runbook creation rejects absent schedule, failed validation, missing references, and dependency cycles", () => {
  const briefWithoutSchedule = clone(summitForwardPlan.brief);
  delete briefWithoutSchedule.schedule;
  const options = {
    projectId: "project-summit-forward",
    plan: summitForwardPlan,
    brief: briefWithoutSchedule,
    validation: { validationId: "validation-approved", inputFingerprint: "input-approved", status: "pass" },
    sourceLedgerHeadHash: "ledger-source-head",
    approvalLedgerEntryId: "ledger-approval",
    frozenBy: "user-ops",
  };
  assert.throws(() => createEventDayRunbook(options), (error) => error.code === "RUNBOOK_SCHEDULE_REQUIRED");
  assert.throws(() => createEventDayRunbook({ ...options, brief: { ...options.brief, schedule }, validation: { ...options.validation, status: "fail" } }), (error) => error.code === "RUNBOOK_DEFINITION_INVALID");
  const runbook = makeRunbook();
  const missing = clone(runbook.tasks);
  missing[0].planObjectIds = ["obj-missing"];
  assert.throws(() => validateRunbookDefinition({ plan: summitForwardPlan, phases: runbook.phases, tasks: missing }), (error) => error.code === "RUNBOOK_DEFINITION_INVALID");
  const cyclic = clone(runbook.tasks);
  cyclic[0].dependencyTaskIds = [cyclic.at(-1).id];
  assert.throws(() => validateRunbookDefinition({ plan: summitForwardPlan, phases: runbook.phases, tasks: cyclic }), (error) => error.details.reason === "task-dependency-cycle");
});

test("task transitions enforce dependencies, revisions, structured evidence, and Plan immutability", () => {
  let runbook = makeRunbook();
  const acceptedPlan = clone(runbook.baseline.acceptedPlan);
  const site = runbook.tasks.find((task) => task.key === "site-release");
  const av = runbook.tasks.find((task) => task.key === "av-line-check");
  assert.equal(taskReadiness(runbook, av.id).ready, false);
  assert.throws(() => transitionRunbookTask(runbook, commandFor(runbook, av.id, "in-progress")), (error) => error.code === "RUNBOOK_DEPENDENCIES_INCOMPLETE");
  ({ runbook } = transitionRunbookTask(runbook, commandFor(runbook, site.id, "in-progress"), { committedAt: "2026-09-12T11:00:00.000Z" }));
  assert.throws(() => transitionRunbookTask(runbook, commandFor(runbook, site.id, "completed", { expectedTaskRevision: 0 })), (error) => error.code === "RUNBOOK_TASK_REVISION_CONFLICT");
  assert.throws(() => transitionRunbookTask(runbook, commandFor(runbook, site.id, "completed")), (error) => error.code === "RUNBOOK_EVIDENCE_REQUIRED");
  ({ runbook } = transitionRunbookTask(runbook, commandFor(runbook, site.id, "completed", { evidence: [{ code: "SITE_RELEASE_CHECK", ref: "evidence-site-001" }] }), { committedAt: "2026-09-12T11:05:00.000Z" }));
  assert.equal(taskReadiness(runbook, av.id).ready, true);
  assert.deepEqual(runbook.baseline.acceptedPlan, acceptedPlan);
  assert.equal(runbook.tasks.find((task) => task.id === site.id).revision, 2);
  assert.equal(verifyRunbookLedger(runbook).status, "pass");
});

test("exact retry returns one receipt while key reuse and stale clients fail explicitly", () => {
  const initial = makeRunbook();
  const site = initial.tasks.find((task) => task.key === "site-release");
  const command = commandFor(initial, site.id, "in-progress");
  const first = transitionRunbookTask(initial, command, { committedAt: "2026-09-12T11:00:00.000Z" });
  const retry = transitionRunbookTask(first.runbook, command, { committedAt: "2026-09-12T11:01:00.000Z" });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.runbook.transitions.length, 1);
  assert.equal(retry.runbook.receipts.length, 1);
  assert.equal(retry.receipt.id, first.receipt.id);
  assert.throws(() => transitionRunbookTask(first.runbook, { ...command, toStatus: "blocked" }), (error) => error.code === "IDEMPOTENCY_KEY_CONFLICT");
});

test("handoff is a deterministic structured projection anchored to the Runbook Ledger", () => {
  const runbook = makeRunbook();
  const first = deriveRunbookHandoff(runbook, { at: "2026-09-12T16:00:00.000Z", outgoingAssignmentId: "shift-a", incomingAssignmentId: "shift-b", roleId: "role-security" });
  const second = deriveRunbookHandoff(runbook, { at: "2026-09-12T16:00:00.000Z", outgoingAssignmentId: "shift-a", incomingAssignmentId: "shift-b", roleId: "role-security" });
  assert.deepEqual(first, second);
  assert.equal(first.ledgerHeadHash, runbook.ledger.at(-1).hash);
  assert.deepEqual(first.taskIds.pending, ["runbook-task-egress-posts", "runbook-task-exit-posts"]);
  assert.ok(first.taskIds.overdue.length > 0);
});

test("tampering or reordering Runbook Ledger entries breaks integrity", () => {
  let runbook = makeRunbook();
  const site = runbook.tasks.find((task) => task.key === "site-release");
  ({ runbook } = transitionRunbookTask(runbook, commandFor(runbook, site.id, "in-progress")));
  const tampered = clone(runbook);
  tampered.ledger[1].details.toStatus = "completed";
  assert.equal(verifyRunbookLedger(tampered).status, "fail");
  const reordered = clone(runbook);
  reordered.ledger.reverse();
  assert.equal(verifyRunbookLedger(reordered).status, "fail");
});
