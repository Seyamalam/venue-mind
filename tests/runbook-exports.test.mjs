import test from "node:test";
import assert from "node:assert/strict";
import { createEventDayRunbook, transitionRunbookTask } from "../src/domain/event-day-runbook.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createRunbookAuditPackage, exportEventDayRunbook } from "../src/interchange/runbook-exports.js";

const makeRunbook = () => createEventDayRunbook({
  projectId: "project-summit-forward",
  plan: summitForwardPlan,
  validation: { validationId: "validation-approved", inputFingerprint: "input-approved", status: "pass" },
  sourceLedgerHeadHash: "ledger-source-head",
  approvalLedgerEntryId: "ledger-approval",
  frozenAt: "2026-09-11T20:00:00.000Z",
  frozenBy: "user-ops",
});

test("Runbook audit export binds source truth, projection, receipts, handoff, and ledger integrity", () => {
  let runbook = makeRunbook();
  const task = runbook.tasks.find((candidate) => candidate.key === "site-release");
  ({ runbook } = transitionRunbookTask(runbook, {
    runbookVersionId: runbook.versionId,
    taskId: task.id,
    expectedTaskRevision: 0,
    toStatus: "in-progress",
    idempotencyKey: "runbook-start-site",
    operationId: "operation-start-site",
    correlationId: "corr-start-site",
    clientId: "tablet-a",
    clientSequence: 1,
    clientOccurredAt: "2026-09-12T12:00:00.000Z",
    actorType: "human",
    actorId: "user-ops",
    source: "studio",
    sessionId: "session-event-day",
  }, { committedAt: "2026-09-12T12:00:01.000Z" }));
  const audit = createRunbookAuditPackage(runbook, { exportedAt: "2026-09-12T12:01:00.000Z", handoffAt: "2026-09-12T12:01:00.000Z" });
  assert.equal(audit.kind, "venuemind-event-day-runbook-audit");
  assert.equal(audit.source.planFingerprint, runbook.source.planFingerprint);
  assert.equal(audit.projection.summary["in-progress"], 1);
  assert.equal(audit.transitions.length, 1);
  assert.equal(audit.receipts.length, 1);
  assert.equal(audit.handoff.ledgerHeadHash, audit.integrity.headHash);
  assert.equal(audit.integrity.status, "pass");
});

test("Runbook JSON and audit exports are explicit read-only artifacts", () => {
  const runbook = makeRunbook();
  const json = exportEventDayRunbook(runbook, { format: "json" });
  const audit = exportEventDayRunbook(runbook, { format: "audit", exportedAt: "2026-09-12T12:00:00.000Z", handoffAt: "2026-09-12T12:00:00.000Z" });
  assert.equal(json.mimeType, "application/json");
  assert.match(json.filename, /\.json$/);
  assert.match(audit.filename, /\.audit\.json$/);
  assert.equal(JSON.parse(json.content).versionId, runbook.versionId);
  assert.equal(JSON.parse(audit.content).integrity.status, "pass");
  assert.equal(runbook.transitions.length, 0);
});

test("audit export rejects a tampered ledger", () => {
  const runbook = JSON.parse(JSON.stringify(makeRunbook()));
  runbook.ledger[0].details.sourcePlanVersion = "tampered";
  assert.throws(() => createRunbookAuditPackage(runbook), /RUNBOOK_LEDGER_INTEGRITY_FAILED/);
});
