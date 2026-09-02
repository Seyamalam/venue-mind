import { deriveRunbookHandoff, verifyRunbookLedger } from "../domain/event-day-runbook.ts";
import type { EventDayRunbook, RunbookTask, RunbookTaskStatus } from "../domain/operational-types.ts";

const clone = <Value>(value: Value): Value => structuredClone(value);

const taskSummary = (tasks: readonly RunbookTask[]): Record<RunbookTaskStatus, number> => ({
  pending: tasks.filter((task) => task.status === "pending").length,
  "in-progress": tasks.filter((task) => task.status === "in-progress").length,
  blocked: tasks.filter((task) => task.status === "blocked").length,
  completed: tasks.filter((task) => task.status === "completed").length,
  skipped: tasks.filter((task) => task.status === "skipped").length,
});

const taskDefinition = (task: RunbookTask) => ({
  id: task.id,
  key: task.key,
  phaseId: task.phaseId,
  order: task.order,
  code: task.code,
  workstream: task.workstream,
  owner: clone(task.owner),
  dependencyTaskIds: clone(task.dependencyTaskIds),
  planObjectIds: clone(task.planObjectIds),
  requiredEvidenceCodes: clone(task.requiredEvidenceCodes),
  required: task.required,
});

export interface RunbookExportOptions {
  readonly format?: "json" | "audit";
  readonly exportedAt?: string;
  readonly handoffAt?: string;
}
export interface RunbookExportArtifact {
  readonly filename: string;
  readonly mimeType: "application/json";
  readonly content: string;
}

export function createRunbookAuditPackage(
  runbook: EventDayRunbook,
  { exportedAt = new Date().toISOString(), handoffAt = exportedAt }: Omit<RunbookExportOptions, "format"> = {},
) {
  const integrity = verifyRunbookLedger(runbook);
  if (integrity.status !== "pass") throw new Error("RUNBOOK_LEDGER_INTEGRITY_FAILED");
  const handoff: unknown = deriveRunbookHandoff(runbook, {
    at: handoffAt,
    outgoingAssignmentId: null,
    incomingAssignmentId: null,
    roleId: null,
  });
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
    definition: { phases: clone(runbook.phases), tasks: runbook.tasks.map(taskDefinition) },
    projection: { tasks: clone(runbook.tasks), summary: taskSummary(runbook.tasks) },
    transitions: clone(runbook.transitions),
    receipts: clone(runbook.receipts),
    handoff: clone(handoff),
    integrity,
    ledger: clone(runbook.ledger),
  };
}

export function exportEventDayRunbook(
  runbook: EventDayRunbook,
  { format = "json", exportedAt, handoffAt }: RunbookExportOptions = {},
): RunbookExportArtifact {
  if (!["json", "audit"].includes(format)) throw new Error(`Unsupported Runbook export format: ${format}`);
  const auditOptions: Omit<RunbookExportOptions, "format"> = {
    ...(exportedAt ? { exportedAt } : {}),
    ...(handoffAt ? { handoffAt } : {}),
  };
  const artifact = format === "audit" ? createRunbookAuditPackage(runbook, auditOptions) : clone(runbook);
  return {
    filename: `${runbook.id}-${runbook.versionId}.${format === "audit" ? "audit." : ""}json`,
    mimeType: "application/json",
    content: JSON.stringify(artifact, null, 2),
  };
}
