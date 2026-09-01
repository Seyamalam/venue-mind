import test from "node:test";
import assert from "node:assert/strict";
import { createRunbookCommandBus } from "../src/domain/runbook-command-bus.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";

const createCommand = {
  type: "create_runbook_version",
  projectId: "project-summit-forward",
  plan: summitForwardPlan,
  validation: { validationId: "validation-approved", inputFingerprint: "input-approved", status: "pass" },
  sourceLedgerHeadHash: "ledger-source-head",
  approvalLedgerEntryId: "ledger-approval",
  frozenAt: "2026-09-11T20:00:00.000Z",
  frozenBy: "user-ops",
};

test("one Runbook command bus serves creation, inspection, filtered tasks, transitions, handoffs, and exports", () => {
  const changes = [];
  const bus = createRunbookCommandBus({ onChange: (_runbook, event) => changes.push(event) });
  const created = bus.execute(createCommand);
  assert.equal(created.status, "created");
  assert.equal(created.runbook.status, "active");
  const site = bus.execute({ type: "list_runbook_tasks", phaseId: "runbook-phase-setup" }).find((task) => task.key === "site-release");
  assert.equal(site.readiness.ready, true);
  const transitioned = bus.execute({
    type: "transition_runbook_task",
    runbookVersionId: created.runbook.versionId,
    taskId: site.id,
    expectedTaskRevision: 0,
    toStatus: "in-progress",
    idempotencyKey: "idem-site-start",
    operationId: "operation-site-start",
    correlationId: "corr-site-start",
    clientId: "tablet-a",
    clientSequence: 1,
    clientOccurredAt: "2026-09-12T12:00:00.000Z",
    committedAt: "2026-09-12T12:00:01.000Z",
    actorType: "human",
    actorId: "user-ops",
    source: "studio",
    sessionId: "session-event-day",
  });
  assert.equal(transitioned.status, "applied");
  assert.equal(transitioned.task.status, "in-progress");
  assert.equal(bus.execute({ type: "inspect_runbook" }).revision, 1);
  assert.equal(bus.execute({ type: "generate_shift_handoff", at: "2026-09-12T12:05:00.000Z", outgoingAssignmentId: "shift-a", incomingAssignmentId: "shift-b" }).taskIds.active.length, 1);
  assert.equal(bus.execute({ type: "export_runbook", format: "audit", exportedAt: "2026-09-12T12:05:00.000Z", handoffAt: "2026-09-12T12:05:00.000Z" }).mimeType, "application/json");
  assert.deepEqual(changes.map((event) => event.type), ["runbook.created", "runbook.task_transitioned"]);
});

test("exact retries do not republish a Runbook transition", () => {
  let publications = 0;
  const bus = createRunbookCommandBus({ onChange: () => { publications += 1; } });
  const runbook = bus.execute(createCommand).runbook;
  const task = runbook.tasks.find((candidate) => candidate.key === "site-release");
  const command = {
    type: "transition_runbook_task",
    runbookVersionId: runbook.versionId,
    taskId: task.id,
    expectedTaskRevision: 0,
    toStatus: "in-progress",
    idempotencyKey: "idem-site-start",
    clientId: "tablet-a",
    clientSequence: 1,
    clientOccurredAt: "2026-09-12T12:00:00.000Z",
    actorType: "human",
    actorId: "user-ops",
    source: "studio",
    sessionId: "session-event-day",
  };
  assert.equal(bus.execute(command).status, "applied");
  assert.equal(bus.execute(command).status, "already-applied");
  assert.equal(publications, 2);
});
