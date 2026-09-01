import { deriveRunbookHandoff, verifyRunbookLedger } from "../domain/event-day-runbook.ts";

const clone = (value: any) => JSON.parse(JSON.stringify(value));

const taskSummary = (tasks: any) => Object.fromEntries(["pending", "in-progress", "blocked", "completed", "skipped"].map((status: any) => [status, tasks.filter((task: any) => task.status === status).length]));

export function createRunbookAuditPackage(runbook: any, { exportedAt = new Date().toISOString(), handoffAt = exportedAt }: any = {}) {
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
    definition: { phases: clone(runbook.phases), tasks: clone(runbook.tasks.map(({ evidence: _evidence, status: _status, revision: _revision, ...task }: any) => task)) },
    projection: { tasks: clone(runbook.tasks), summary: taskSummary(runbook.tasks) },
    transitions: clone(runbook.transitions),
    receipts: clone(runbook.receipts),
    handoff: clone(deriveRunbookHandoff(runbook, { at: handoffAt, outgoingAssignmentId: null, incomingAssignmentId: null })),
    integrity,
    ledger: clone(runbook.ledger),
  };
}

export function exportEventDayRunbook(runbook: any, { format = "json", exportedAt, handoffAt }: any = {}) {
  if (!["json", "audit"].includes(format)) throw new Error(`Unsupported Runbook export format: ${format}`);
  const artifact = format === "audit" ? createRunbookAuditPackage(runbook, { exportedAt, handoffAt }) : clone(runbook);
  return {
    filename: `${runbook.id}-${runbook.versionId}.${format === "audit" ? "audit." : ""}json`,
    mimeType: "application/json",
    content: JSON.stringify(artifact, null, 2),
  };
}
