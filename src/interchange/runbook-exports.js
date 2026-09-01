import { deriveRunbookHandoff, verifyRunbookLedger } from "../domain/event-day-runbook.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const taskSummary = (tasks) => Object.fromEntries(["pending", "in-progress", "blocked", "completed", "skipped"].map((status) => [status, tasks.filter((task) => task.status === status).length]));

export function createRunbookAuditPackage(runbook, { exportedAt = new Date().toISOString(), handoffAt = exportedAt } = {}) {
  const integrity = verifyRunbookLedger(runbook);
  if (integrity.status !== "pass") throw new Error("RUNBOOK_LEDGER_INTEGRITY_FAILED");
  return {
    schemaVersion: 1,
    kind: "venuemind-event-day-runbook-audit",
    exportedAt,
    runbook: {
      id: runbook.id,
      versionId: runbook.versionId,
      version: runbook.version,
      status: runbook.status,
      revision: runbook.revision,
      definitionFingerprint: runbook.definitionFingerprint,
      frozenAt: runbook.frozenAt,
      frozenBy: runbook.frozenBy,
    },
    source: clone(runbook.source),
    baseline: clone(runbook.baseline),
    definition: { phases: clone(runbook.phases), tasks: clone(runbook.tasks.map(({ evidence: _evidence, status: _status, revision: _revision, ...task }) => task)) },
    projection: { tasks: clone(runbook.tasks), summary: taskSummary(runbook.tasks) },
    transitions: clone(runbook.transitions),
    receipts: clone(runbook.receipts),
    handoff: clone(deriveRunbookHandoff(runbook, { at: handoffAt, outgoingAssignmentId: null, incomingAssignmentId: null })),
    integrity,
    ledger: clone(runbook.ledger),
  };
}

export function exportEventDayRunbook(runbook, { format = "json", exportedAt, handoffAt } = {}) {
  if (!["json", "audit"].includes(format)) throw new Error(`Unsupported Runbook export format: ${format}`);
  const artifact = format === "audit" ? createRunbookAuditPackage(runbook, { exportedAt, handoffAt }) : clone(runbook);
  return {
    filename: `${runbook.id}-${runbook.versionId}.${format === "audit" ? "audit." : ""}json`,
    mimeType: "application/json",
    content: JSON.stringify(artifact, null, 2),
  };
}
