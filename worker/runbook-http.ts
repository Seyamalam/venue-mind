import type { createD1RunbookRepository, EventDayRunbookInput, RunbookTransitionInput } from "./runbook-repository.ts";

type JsonObject = Record<string, unknown>;
type RepositoryRunbook = Awaited<ReturnType<ReturnType<typeof createD1RunbookRepository>["getRunbook"]>>;

const clone = <Value>(value: Value): Value => structuredClone(value);
const object = (value: unknown, field: string): JsonObject => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${field} must be an object`);
  return value as JsonObject;
};
const string = (value: unknown, field: string) => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${field} is required`);
  return value.trim();
};
const integer = (value: unknown, field: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError(`${field} must be a positive integer`);
  return Number(value);
};
const nonNegativeInteger = (value: unknown, field: string) => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new TypeError(`${field} must be a non-negative integer`);
  return Number(value);
};

export function browserRunbookToPersistenceInput(value: unknown, authenticatedUserId: string): EventDayRunbookInput {
  const runbook = object(value, "Runbook");
  const source = object(runbook.source, "Runbook source");
  if (!Array.isArray(runbook.tasks) || runbook.tasks.length === 0) throw new TypeError("Runbook tasks are required");
  const { tasks: _tasks, transitions: _transitions, receipts: _receipts, ledger: _ledger, revision: _revision, frozenAt: _frozenAt, frozenBy: _frozenBy, ...immutableRunbook } = runbook;
  return {
    id: string(runbook.versionId, "Runbook versionId"),
    schemaVersion: 1,
    sourcePlanId: string(source.planId, "Runbook source planId"),
    sourcePlanVersion: String(source.planVersion ?? ""),
    sourcePlanFingerprint: string(source.planFingerprint, "Runbook source planFingerprint"),
    sourceValidationId: source.validationId == null ? null : string(source.validationId, "Runbook source validationId"),
    sourceValidationFingerprint: source.validationInputFingerprint == null ? null : string(source.validationInputFingerprint, "Runbook source validationInputFingerprint"),
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

export function repositoryRunbookToBrowserSnapshot(value: NonNullable<RepositoryRunbook>) {
  const definition = object(value.definition, "Stored Runbook definition");
  const immutable = object(definition.runbook, "Stored browser Runbook definition");
  const latestEvidence = new Map<string, unknown[]>();
  for (const transition of value.transitions) latestEvidence.set(transition.taskId, clone(transition.evidence));
  const transitionById = new Map(value.transitions.map((transition) => [transition.id, transition]));
  return {
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
      return {
        id: receipt.id,
        idempotencyKey: receipt.idempotencyKey,
        inputFingerprint: receipt.inputFingerprint,
        correlationId: receipt.correlationId,
        runbookVersionId: value.id,
        taskId: transition?.taskId ?? null,
        taskRevision: transition?.taskRevision ?? null,
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
}

export function browserCommandToPersistenceInput(value: unknown, runbook: NonNullable<RepositoryRunbook>, authenticatedUserId: string, authenticatedSessionId: string): RunbookTransitionInput {
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
    fromStatus: task.status,
    toStatus: string(command.toStatus, "Runbook transition toStatus"),
    actorType: "human",
    actorId: string(authenticatedUserId, "Authenticated Runbook actor"),
    source: "studio",
    sessionId: string(authenticatedSessionId, "Authenticated Runbook session"),
    reasonCode: command.reasonCode == null ? null : string(command.reasonCode, "Runbook transition reasonCode"),
    clientId: string(command.clientId, "Runbook transition clientId"),
    clientSequence: integer(command.clientSequence, "Runbook transition clientSequence"),
    clientOccurredAt: string(command.clientOccurredAt, "Runbook transition clientOccurredAt"),
    evidence: command.evidence as RunbookTransitionInput["evidence"],
    idempotencyKey: string(command.idempotencyKey, "Runbook transition idempotencyKey"),
    correlationId: command.correlationId == null ? null : string(command.correlationId, "Runbook transition correlationId"),
  };
}
