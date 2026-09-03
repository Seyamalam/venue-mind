import type {
  createD1RunbookRepository,
  EventDayRunbookInput,
  RunbookEvidenceReference,
  RunbookTransitionInput,
} from "./runbook-repository.ts";
import type { EventDayRunbook, RunbookTaskStatus } from "../src/domain/operational-types.ts";

type JsonObject = Record<string, unknown>;
type RepositoryRunbook = Awaited<ReturnType<ReturnType<typeof createD1RunbookRepository>["getRunbook"]>>;

const clone = <Value>(value: Value): Value => structuredClone(value);
const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isRunbookStatus = (value: unknown): value is EventDayRunbook["tasks"][number]["status"] =>
  value === "pending" || value === "in-progress" || value === "blocked" || value === "completed" || value === "skipped";
const isActorType = (value: unknown): value is EventDayRunbook["ledger"][number]["actorType"] =>
  value === "human" || value === "agent" || value === "system";
const isOperationalSource = (value: unknown): value is EventDayRunbook["ledger"][number]["source"] =>
  value === "studio" || value === "webmcp" || value === "mcp" || value === "system" || value === "agent-tool";
const isEvidence = (value: unknown): boolean =>
  isRecord(value) && typeof value.code === "string" && typeof value.ref === "string";
const isEventDayRunbook = (value: unknown): value is EventDayRunbook =>
  isRecord(value) &&
  value.schemaVersion === 1 &&
  typeof value.id === "string" &&
  typeof value.versionId === "string" &&
  typeof value.version === "number" &&
  isRecord(value.source) &&
  typeof value.source.projectId === "string" &&
  typeof value.source.planId === "string" &&
  (typeof value.source.planVersion === "string" || typeof value.source.planVersion === "number") &&
  typeof value.source.planFingerprint === "string" &&
  typeof value.source.briefFingerprint === "string" &&
  typeof value.source.validationId === "string" &&
  typeof value.source.validationInputFingerprint === "string" &&
  typeof value.source.approvalLedgerEntryId === "string" &&
  typeof value.source.sourceLedgerHeadHash === "string" &&
  isRecord(value.baseline) &&
  isRecord(value.baseline.acceptedPlan) &&
  isRecord(value.baseline.acceptedBrief) &&
  isRecord(value.baseline.staffingEvidence) &&
  typeof value.baseline.fingerprint === "string" &&
  typeof value.definitionFingerprint === "string" &&
  (value.status === "active" || value.status === "archived") &&
  Array.isArray(value.phases) &&
  value.phases.every(
    (phase) =>
      isRecord(phase) &&
      typeof phase.id === "string" &&
      typeof phase.kind === "string" &&
      typeof phase.order === "number" &&
      typeof phase.startAt === "string" &&
      typeof phase.endAt === "string",
  ) &&
  Array.isArray(value.tasks) &&
  value.tasks.every(
    (task) =>
      isRecord(task) &&
      typeof task.id === "string" &&
      typeof task.key === "string" &&
      typeof task.phaseId === "string" &&
      typeof task.order === "number" &&
      typeof task.code === "string" &&
      typeof task.workstream === "string" &&
      isRecord(task.owner) &&
      Array.isArray(task.dependencyTaskIds) &&
      Array.isArray(task.planObjectIds) &&
      Array.isArray(task.requiredEvidenceCodes) &&
      typeof task.required === "boolean" &&
      isRunbookStatus(task.status) &&
      typeof task.revision === "number" &&
      Array.isArray(task.evidence) &&
      task.evidence.every(isEvidence),
  ) &&
  Array.isArray(value.transitions) &&
  value.transitions.every(
    (transition) =>
      isRecord(transition) &&
      typeof transition.id === "string" &&
      typeof transition.sequence === "number" &&
      typeof transition.taskId === "string" &&
      isRunbookStatus(transition.fromStatus) &&
      isRunbookStatus(transition.toStatus) &&
      typeof transition.fromTaskRevision === "number" &&
      typeof transition.toTaskRevision === "number" &&
      Array.isArray(transition.evidence) &&
      transition.evidence.every(isEvidence) &&
      typeof transition.committedAt === "string",
  ) &&
  Array.isArray(value.receipts) &&
  value.receipts.every(
    (receipt) =>
      isRecord(receipt) &&
      typeof receipt.id === "string" &&
      typeof receipt.taskId === "string" &&
      typeof receipt.taskRevision === "number" &&
      typeof receipt.transitionId === "string" &&
      typeof receipt.committedAt === "string",
  ) &&
  Array.isArray(value.ledger) &&
  value.ledger.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.id === "string" &&
      entry.schemaVersion === 1 &&
      typeof entry.sequence === "number" &&
      typeof entry.type === "string" &&
      isActorType(entry.actorType) &&
      typeof entry.actorId === "string" &&
      isOperationalSource(entry.source) &&
      typeof entry.sessionId === "string" &&
      typeof entry.committedAt === "string" &&
      isRecord(entry.details) &&
      typeof entry.previousHash === "string" &&
      typeof entry.hash === "string",
  ) &&
  typeof value.revision === "number" &&
  typeof value.frozenAt === "string" &&
  typeof value.frozenBy === "string";
const object = (value: unknown, field: string): JsonObject => {
  if (!isRecord(value)) throw new TypeError(`${field} must be an object`);
  return value;
};
const string = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
};
const runbookStatus = (value: unknown, field: string): RunbookTaskStatus => {
  if (!isRunbookStatus(value)) throw new TypeError(`${field} is invalid`);
  return value;
};
const integer = (value: unknown, field: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError(`${field} must be a positive integer`);
  return Number(value);
};
const nonNegativeInteger = (value: unknown, field: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${field} must be a non-negative integer`);
  return Number(value);
};
const evidence = (value: unknown): RunbookEvidenceReference[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError("Runbook transition evidence must be an array");
  return value.map((item, index) => {
    const entry = object(item, `Runbook transition evidence ${index}`);
    return {
      code: string(entry.code, `Runbook transition evidence ${index} code`),
      ref: string(entry.ref, `Runbook transition evidence ${index} ref`),
    };
  });
};

export function browserRunbookToPersistenceInput(value: unknown, authenticatedUserId: string): EventDayRunbookInput {
  const runbook = object(value, "Runbook");
  const source = object(runbook.source, "Runbook source");
  if (!Array.isArray(runbook.tasks) || runbook.tasks.length === 0) throw new TypeError("Runbook tasks are required");
  const {
    tasks: _tasks,
    transitions: _transitions,
    receipts: _receipts,
    ledger: _ledger,
    revision: _revision,
    frozenAt: _frozenAt,
    frozenBy: _frozenBy,
    ...immutableRunbook
  } = runbook;
  return {
    id: string(runbook.versionId, "Runbook versionId"),
    schemaVersion: 1,
    sourcePlanId: string(source.planId, "Runbook source planId"),
    sourcePlanVersion:
      typeof source.planVersion === "number"
        ? String(source.planVersion)
        : string(source.planVersion, "Runbook source planVersion"),
    sourcePlanFingerprint: string(source.planFingerprint, "Runbook source planFingerprint"),
    sourceValidationId: source.validationId == null ? null : string(source.validationId, "Runbook source validationId"),
    sourceValidationFingerprint:
      source.validationInputFingerprint == null
        ? null
        : string(source.validationInputFingerprint, "Runbook source validationInputFingerprint"),
    sourceActivityLedgerHeadHash: string(source.sourceLedgerHeadHash, "Runbook source ledger head hash"),
    definition: { kind: "browser-event-day-runbook", runbook: clone(immutableRunbook) },
    frozenBy: string(authenticatedUserId, "Authenticated Runbook creator"),
    frozenAt: string(runbook.frozenAt, "Runbook frozenAt"),
    tasks: runbook.tasks.map((candidate, index) => {
      const task = object(candidate, `Runbook task ${index}`);
      const owner = task.owner == null ? null : object(task.owner, `Runbook task ${index} owner`);
      const { status: _status, revision: _taskRevision, evidence: _evidence, ...definition } = task;
      return {
        id: string(task.id, `Runbook task ${index} ID`),
        phaseId: string(task.phaseId, `Runbook task ${index} phaseId`),
        ownerRole: owner?.roleId == null ? null : string(owner.roleId, `Runbook task ${index} owner roleId`),
        status: "pending",
        definition: clone(definition),
      };
    }),
  };
}

export function repositoryRunbookToBrowserSnapshot(value: NonNullable<RepositoryRunbook>): EventDayRunbook {
  const definition = object(value.definition, "Stored Runbook definition");
  const immutable = object(definition.runbook, "Stored browser Runbook definition");
  const latestEvidence = new Map<string, unknown[]>();
  for (const transition of value.transitions) latestEvidence.set(transition.taskId, clone(transition.evidence));
  const transitionById = new Map(value.transitions.map((transition) => [transition.id, transition]));
  const snapshot = {
    ...clone(immutable),
    schemaVersion: 1,
    versionId: value.id,
    frozenAt: value.frozenAt,
    frozenBy: value.frozenBy,
    tasks: value.tasks.map((task) => ({
      ...clone(task.definition),
      id: task.id,
      phaseId: task.phaseId,
      status: task.status,
      revision: task.taskRevision,
      evidence: latestEvidence.get(task.id) ?? [],
    })),
    transitions: value.transitions.map((transition) => ({
      id: transition.id,
      sequence: transition.runbookSequence,
      taskId: transition.taskId,
      fromStatus: transition.fromStatus,
      toStatus: transition.toStatus,
      fromTaskRevision: transition.expectedTaskRevision,
      toTaskRevision: transition.taskRevision,
      reasonCode: transition.reasonCode,
      evidence: clone(transition.evidence),
      clientId: transition.clientId,
      clientSequence: transition.clientSequence,
      clientOccurredAt: transition.clientOccurredAt,
      committedAt: transition.acceptedAt,
    })),
    receipts: value.receipts.map((receipt) => {
      const transition = transitionById.get(receipt.transitionId);
      if (!transition) throw new TypeError("Stored Runbook receipt transition is unavailable");
      return {
        id: receipt.id,
        idempotencyKey: receipt.idempotencyKey,
        inputFingerprint: receipt.inputFingerprint,
        correlationId: receipt.correlationId,
        runbookVersionId: value.id,
        taskId: transition.taskId,
        taskRevision: transition.taskRevision,
        transitionId: receipt.transitionId,
        committedAt: receipt.occurredAt,
      };
    }),
    ledger: value.ledger.map((entry) => ({
      id: entry.id,
      schemaVersion: entry.schemaVersion,
      sequence: entry.sequence,
      type: entry.type,
      actorType: entry.actorType,
      actorId: entry.actorId,
      source: entry.source,
      sessionId: entry.sessionId,
      committedAt: entry.occurredAt,
      details: clone(entry.details),
      previousHash: entry.previousHash,
      hash: entry.hash,
    })),
    revision: value.sequence,
  };
  if (!isEventDayRunbook(snapshot)) throw new TypeError("Stored Runbook is invalid");
  return snapshot;
}

export function browserCommandToPersistenceInput(
  value: unknown,
  runbook: NonNullable<RepositoryRunbook>,
  authenticatedUserId: string,
  authenticatedSessionId: string,
): RunbookTransitionInput {
  const command = object(value, "Runbook transition command");
  const runbookVersionId = string(command.runbookVersionId, "Runbook transition runbookVersionId");
  if (runbookVersionId !== runbook.id) throw new TypeError("Runbook transition version does not match the route");
  const taskId = string(command.taskId, "Runbook transition taskId");
  const task = runbook.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new TypeError("Runbook transition task is unavailable");
  return {
    id: string(command.operationId, "Runbook transition operationId"),
    taskId,
    expectedTaskRevision: nonNegativeInteger(command.expectedTaskRevision, "Runbook transition expectedTaskRevision"),
    fromStatus: runbookStatus(task.status, "Runbook transition current status"),
    toStatus: runbookStatus(command.toStatus, "Runbook transition toStatus"),
    actorType: "human",
    actorId: string(authenticatedUserId, "Authenticated Runbook actor"),
    source: "studio",
    sessionId: string(authenticatedSessionId, "Authenticated Runbook session"),
    reasonCode: command.reasonCode == null ? null : string(command.reasonCode, "Runbook transition reasonCode"),
    clientId: string(command.clientId, "Runbook transition clientId"),
    clientSequence: integer(command.clientSequence, "Runbook transition clientSequence"),
    clientOccurredAt: string(command.clientOccurredAt, "Runbook transition clientOccurredAt"),
    evidence: evidence(command.evidence),
    idempotencyKey: string(command.idempotencyKey, "Runbook transition idempotencyKey"),
    correlationId:
      command.correlationId == null ? null : string(command.correlationId, "Runbook transition correlationId"),
  };
}
