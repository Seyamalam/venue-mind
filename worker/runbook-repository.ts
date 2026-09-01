import { stableFingerprint } from "../src/domain/activity-ledger.js";
import { applyDatabaseMigrations } from "./database-migrations.ts";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (sql: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown>;
};

export type EventDayRunbookTaskInput = {
  id: string;
  phaseId: string;
  ownerRole?: string | null;
  status: string;
  definition: Record<string, unknown>;
};

export type RunbookEvidenceReference = {
  code: string;
  ref: string;
};

export type EventDayRunbookInput = {
  id: string;
  schemaVersion?: 1;
  sourcePlanId: string;
  sourcePlanVersion: string;
  sourcePlanFingerprint: string;
  sourceValidationId?: string | null;
  sourceValidationFingerprint?: string | null;
  sourceActivityLedgerHeadHash: string;
  definition: Record<string, unknown>;
  frozenBy: string;
  frozenAt: string;
  tasks: EventDayRunbookTaskInput[];
};

export type RunbookTransitionInput = {
  id: string;
  taskId: string;
  expectedTaskRevision: number;
  fromStatus: string;
  toStatus: string;
  actorType: "human" | "agent" | "system";
  actorId: string;
  source: "studio" | "webmcp" | "mcp" | "system" | "agent-tool";
  sessionId: string;
  deviceId?: string | null;
  deviceOccurredAt?: string | null;
  evidence?: RunbookEvidenceReference[];
  idempotencyKey: string;
  correlationId?: string | null;
};

type RunbookRow = Record<string, unknown>;

const initialized = new WeakSet<object>();
const clone = <Value>(value: Value): Value => structuredClone(value);
const text = (value: unknown, field: string) => {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new TypeError(`Runbook ${field} is required`);
  return normalized;
};
const object = (value: unknown, field: string) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`Runbook ${field} must be an object`);
  return clone(value as Record<string, unknown>);
};
const evidence = (value: unknown): RunbookEvidenceReference[] => {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new TypeError("Runbook transition evidence must be an array");
  const normalized = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError(`Runbook transition evidence ${index} must be an object`);
    const record = item as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== "code" && key !== "ref")) throw new TypeError(`Runbook transition evidence ${index} contains unsupported fields`);
    return { code: text(record.code, `transition evidence ${index} code`), ref: text(record.ref, `transition evidence ${index} ref`) };
  }).sort((left, right) => left.code.localeCompare(right.code) || left.ref.localeCompare(right.ref));
  return [...new Map(normalized.map((item) => [`${item.code}\u0000${item.ref}`, item])).values()];
};
const json = (value: unknown) => JSON.stringify(value);
const parse = (value: unknown) => JSON.parse(String(value));

async function ready(db: D1Database) {
  if (initialized.has(db as object)) return;
  await applyDatabaseMigrations(db as never);
  initialized.add(db as object);
}

class RunbookRepositoryError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "RunbookRepositoryError";
    this.code = code;
    this.details = details;
  }
}

export class RunbookIdempotencyConflict extends RunbookRepositoryError {
  constructor(details: Record<string, unknown>) {
    super("RUNBOOK_IDEMPOTENCY_CONFLICT", "Runbook idempotency key was reused with different input", details);
    this.name = "RunbookIdempotencyConflict";
  }
}

export class RunbookTransitionConflict extends RunbookRepositoryError {
  constructor(details: Record<string, unknown>) {
    super("RUNBOOK_TASK_REVISION_CONFLICT", "Runbook task changed before this transition could be applied", details);
    this.name = "RunbookTransitionConflict";
  }
}

const mapRunbook = (row: RunbookRow) => ({
  id: String(row.id),
  organizationId: String(row.organization_id),
  projectId: String(row.project_id),
  schemaVersion: Number(row.schema_version),
  sourcePlanId: String(row.source_plan_id),
  sourcePlanVersion: String(row.source_plan_version),
  sourcePlanFingerprint: String(row.source_plan_fingerprint),
  sourceValidationId: row.source_validation_id == null ? null : String(row.source_validation_id),
  sourceValidationFingerprint: row.source_validation_fingerprint == null ? null : String(row.source_validation_fingerprint),
  sourceActivityLedgerHeadHash: String(row.source_activity_ledger_head_hash),
  definition: parse(row.definition_json),
  frozenBy: String(row.frozen_by),
  frozenAt: String(row.frozen_at),
  updatedAt: String(row.updated_at),
  sequence: Number(row.sequence),
  ledgerHeadHash: String(row.ledger_head_hash),
});

const mapTask = (row: RunbookRow) => ({
  id: String(row.id),
  runbookId: String(row.runbook_id),
  phaseId: String(row.phase_id),
  ownerRole: row.owner_role == null ? null : String(row.owner_role),
  definition: parse(row.definition_json),
  status: String(row.status),
  taskRevision: Number(row.task_revision),
  lastTransitionId: row.last_transition_id == null ? null : String(row.last_transition_id),
  updatedAt: String(row.updated_at),
});

const mapTransition = (row: RunbookRow) => ({
  id: String(row.id),
  runbookId: String(row.runbook_id),
  taskId: String(row.task_id),
  runbookSequence: Number(row.runbook_sequence),
  expectedTaskRevision: Number(row.expected_task_revision),
  taskRevision: Number(row.task_revision),
  fromStatus: String(row.from_status),
  toStatus: String(row.to_status),
  actorType: String(row.actor_type),
  actorId: String(row.actor_id),
  source: String(row.source),
  sessionId: String(row.session_id),
  deviceId: row.device_id == null ? null : String(row.device_id),
  deviceOccurredAt: row.device_occurred_at == null ? null : String(row.device_occurred_at),
  acceptedAt: String(row.accepted_at),
  evidence: parse(row.evidence_json),
  idempotencyKey: String(row.idempotency_key),
  inputFingerprint: String(row.input_fingerprint),
  correlationId: String(row.correlation_id),
});

const mapLedgerEntry = (row: RunbookRow) => ({
  id: String(row.id),
  schemaVersion: Number(row.schema_version),
  runbookId: String(row.runbook_id),
  transitionId: String(row.transition_id),
  sequence: Number(row.sequence),
  type: String(row.event_type),
  actorType: String(row.actor_type),
  actorId: String(row.actor_id),
  source: String(row.source),
  sessionId: String(row.session_id),
  occurredAt: String(row.occurred_at),
  details: parse(row.details_json),
  previousHash: String(row.previous_hash),
  hash: String(row.hash),
});

const mapReceipt = (row: RunbookRow) => ({
  id: String(row.id),
  runbookId: String(row.runbook_id),
  transitionId: String(row.transition_id),
  idempotencyKey: String(row.idempotency_key),
  inputFingerprint: String(row.input_fingerprint),
  correlationId: String(row.correlation_id),
  result: parse(row.result_json),
  occurredAt: String(row.occurred_at),
});

const normalizeRunbook = (input: EventDayRunbookInput) => {
  if (input.schemaVersion !== undefined && input.schemaVersion !== 1) throw new TypeError("Runbook schemaVersion must be 1");
  if (!Array.isArray(input.tasks) || input.tasks.length === 0) throw new TypeError("Runbook tasks are required");
  const taskIds = new Set<string>();
  const tasks = input.tasks.map((task) => {
    const id = text(task.id, "task ID");
    if (taskIds.has(id)) throw new TypeError(`Runbook task ID is duplicated: ${id}`);
    taskIds.add(id);
    return {
      id,
      phaseId: text(task.phaseId, `task ${id} phase ID`),
      ownerRole: task.ownerRole == null ? null : text(task.ownerRole, `task ${id} owner role`),
      status: text(task.status, `task ${id} status`),
      definition: object(task.definition, `task ${id} definition`),
    };
  });
  return {
    id: text(input.id, "ID"),
    schemaVersion: 1,
    sourcePlanId: text(input.sourcePlanId, "source Plan ID"),
    sourcePlanVersion: text(input.sourcePlanVersion, "source Plan Version"),
    sourcePlanFingerprint: text(input.sourcePlanFingerprint, "source Plan fingerprint"),
    sourceValidationId: input.sourceValidationId == null ? null : text(input.sourceValidationId, "source Validation ID"),
    sourceValidationFingerprint: input.sourceValidationFingerprint == null ? null : text(input.sourceValidationFingerprint, "source Validation fingerprint"),
    sourceActivityLedgerHeadHash: text(input.sourceActivityLedgerHeadHash, "source Activity Ledger head hash"),
    definition: object(input.definition, "definition"),
    frozenBy: text(input.frozenBy, "freezing actor"),
    frozenAt: text(input.frozenAt, "frozen time"),
    tasks,
  };
};

const normalizeTransition = (input: RunbookTransitionInput) => {
  if (!Number.isSafeInteger(input.expectedTaskRevision) || input.expectedTaskRevision < 0) throw new TypeError("Runbook transition expectedTaskRevision must be a non-negative integer");
  if (!["human", "agent", "system"].includes(input.actorType)) throw new TypeError("Runbook transition actorType is invalid");
  if (!["studio", "webmcp", "mcp", "system", "agent-tool"].includes(input.source)) throw new TypeError("Runbook transition source is invalid");
  return {
    id: text(input.id, "transition ID"),
    taskId: text(input.taskId, "transition task ID"),
    expectedTaskRevision: input.expectedTaskRevision,
    fromStatus: text(input.fromStatus, "transition from status"),
    toStatus: text(input.toStatus, "transition to status"),
    actorType: input.actorType,
    actorId: text(input.actorId, "transition actor ID"),
    source: input.source,
    sessionId: text(input.sessionId, "transition session ID"),
    deviceId: input.deviceId == null ? null : text(input.deviceId, "transition device ID"),
    deviceOccurredAt: input.deviceOccurredAt == null ? null : text(input.deviceOccurredAt, "transition device time"),
    evidence: evidence(input.evidence),
    idempotencyKey: text(input.idempotencyKey, "transition idempotency key"),
    correlationId: input.correlationId == null ? null : text(input.correlationId, "transition correlation ID"),
  };
};

const transitionFingerprint = (input: ReturnType<typeof normalizeTransition>) => stableFingerprint("runbook-command", {
  id: input.id,
  taskId: input.taskId,
  expectedTaskRevision: input.expectedTaskRevision,
  fromStatus: input.fromStatus,
  toStatus: input.toStatus,
  actorType: input.actorType,
  actorId: input.actorId,
  source: input.source,
  sessionId: input.sessionId,
  deviceId: input.deviceId,
  deviceOccurredAt: input.deviceOccurredAt,
  evidence: input.evidence,
});

export function createD1RunbookRepository(db: D1Database, { clock = () => new Date().toISOString(), maximumBatchSize = 100 } = {}) {
  const getRunbook = async (organizationId: string, projectId: string, runbookId: string) => {
    await ready(db);
    const row = await db.prepare("SELECT * FROM event_day_runbooks WHERE id=? AND organization_id=? AND project_id=?").bind(runbookId, organizationId, projectId).first<RunbookRow>();
    if (!row) return null;
    const [tasks, transitions, ledger, receipts] = await Promise.all([
      db.prepare("SELECT * FROM event_day_runbook_tasks WHERE runbook_id=? AND organization_id=? AND project_id=? ORDER BY id").bind(runbookId, organizationId, projectId).all<RunbookRow>(),
      db.prepare("SELECT * FROM event_day_runbook_transitions WHERE runbook_id=? AND organization_id=? AND project_id=? ORDER BY runbook_sequence").bind(runbookId, organizationId, projectId).all<RunbookRow>(),
      db.prepare("SELECT * FROM event_day_runbook_ledger WHERE runbook_id=? AND organization_id=? AND project_id=? ORDER BY sequence").bind(runbookId, organizationId, projectId).all<RunbookRow>(),
      db.prepare("SELECT * FROM event_day_runbook_receipts WHERE runbook_id=? AND organization_id=? AND project_id=? ORDER BY occurred_at,id").bind(runbookId, organizationId, projectId).all<RunbookRow>(),
    ]);
    return {
      ...mapRunbook(row),
      tasks: tasks.results.map(mapTask),
      transitions: transitions.results.map(mapTransition),
      ledger: ledger.results.map(mapLedgerEntry),
      receipts: receipts.results.map(mapReceipt),
    };
  };

  return Object.freeze({
    async createRunbook(organizationId: string, projectId: string, input: EventDayRunbookInput) {
      await ready(db);
      const tenantId = text(organizationId, "Organization ID");
      const ownerProjectId = text(projectId, "Project ID");
      const value = normalizeRunbook(input);
      const project = await db.prepare("SELECT id FROM projects WHERE id=? AND organization_id=?").bind(ownerProjectId, tenantId).first<{ id: string }>();
      if (!project) throw new RunbookRepositoryError("RUNBOOK_PROJECT_SCOPE_INVALID", "Runbook Project is unavailable in this Organization", { projectId: ownerProjectId });
      const existing = await db.prepare("SELECT id FROM event_day_runbooks WHERE id=?").bind(value.id).first<{ id: string }>();
      if (existing) throw new RunbookRepositoryError("RUNBOOK_ID_CONFLICT", "Runbook ID already exists", { runbookId: value.id });
      const statements = [
        db.prepare("INSERT INTO event_day_runbooks (id,organization_id,project_id,schema_version,source_plan_id,source_plan_version,source_plan_fingerprint,source_validation_id,source_validation_fingerprint,source_activity_ledger_head_hash,definition_json,frozen_by,frozen_at,updated_at,sequence,ledger_head_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)")
          .bind(value.id, tenantId, ownerProjectId, value.schemaVersion, value.sourcePlanId, value.sourcePlanVersion, value.sourcePlanFingerprint, value.sourceValidationId, value.sourceValidationFingerprint, value.sourceActivityLedgerHeadHash, json(value.definition), value.frozenBy, value.frozenAt, value.frozenAt, value.sourceActivityLedgerHeadHash),
        ...value.tasks.map((task) => db.prepare("INSERT INTO event_day_runbook_tasks (runbook_id,id,organization_id,project_id,phase_id,owner_role,definition_json,status,task_revision,last_transition_id,updated_at) VALUES (?,?,?,?,?,?,?,?,0,NULL,?)")
          .bind(value.id, task.id, tenantId, ownerProjectId, task.phaseId, task.ownerRole, json(task.definition), task.status, value.frozenAt)),
      ];
      await db.batch(statements);
      return await getRunbook(tenantId, ownerProjectId, value.id);
    },

    getRunbook,

    async applyTransitionBatch(organizationId: string, projectId: string, runbookId: string, inputs: RunbookTransitionInput[]) {
      await ready(db);
      const tenantId = text(organizationId, "Organization ID");
      const ownerProjectId = text(projectId, "Project ID");
      const id = text(runbookId, "ID");
      if (!Array.isArray(inputs)) throw new TypeError("Runbook transition batch must be an array");
      if (inputs.length > maximumBatchSize) throw new RangeError(`Runbook transition batch exceeds ${maximumBatchSize} commands`);
      const current = await getRunbook(tenantId, ownerProjectId, id);
      if (!current) throw new RunbookRepositoryError("RUNBOOK_NOT_FOUND", "Runbook not found", { runbookId: id });
      if (inputs.length === 0) return { results: [], runbook: current };

      const normalized = inputs.map(normalizeTransition);
      const projections = new Map(current.tasks.map((task) => [task.id, { status: task.status, taskRevision: task.taskRevision }]));
      const existingReceipts = new Map(current.receipts.map((receipt) => [receipt.idempotencyKey, receipt]));
      const commandsByKey = new Map<string, { inputFingerprint: string; result: Record<string, unknown> }>();
      const results: Record<string, unknown>[] = [];
      const statements: D1Statement[] = [];
      let sequence = current.sequence;
      let previousHash = current.ledgerHeadHash;

      for (const command of normalized) {
        const inputFingerprint = transitionFingerprint(command);
        const existingReceipt = existingReceipts.get(command.idempotencyKey);
        if (existingReceipt) {
          if (existingReceipt.inputFingerprint !== inputFingerprint) throw new RunbookIdempotencyConflict({ runbookId: id, idempotencyKey: command.idempotencyKey });
          results.push(clone(existingReceipt.result));
          continue;
        }
        const duplicate = commandsByKey.get(command.idempotencyKey);
        if (duplicate) {
          if (duplicate.inputFingerprint !== inputFingerprint) throw new RunbookIdempotencyConflict({ runbookId: id, idempotencyKey: command.idempotencyKey });
          results.push(clone(duplicate.result));
          continue;
        }
        const task = projections.get(command.taskId);
        if (!task || task.taskRevision !== command.expectedTaskRevision || task.status !== command.fromStatus) {
          throw new RunbookTransitionConflict({
            runbookId: id,
            taskId: command.taskId,
            expectedTaskRevision: command.expectedTaskRevision,
            currentTaskRevision: task?.taskRevision ?? null,
            expectedStatus: command.fromStatus,
            currentStatus: task?.status ?? null,
          });
        }

        sequence += 1;
        const taskRevision = task.taskRevision + 1;
        const acceptedAt = clock();
        const correlationId = command.correlationId ?? `corr-${inputFingerprint.slice(-8)}`;
        const ledgerEntryId = `${id}-ledger-${String(sequence).padStart(6, "0")}`;
        const receiptId = `${id}-receipt-${command.id}`;
        const details = {
          runbookId: id,
          taskId: command.taskId,
          transitionId: command.id,
          fromStatus: command.fromStatus,
          toStatus: command.toStatus,
          taskRevision,
          deviceId: command.deviceId,
          deviceOccurredAt: command.deviceOccurredAt,
          evidence: command.evidence,
          correlationId,
          idempotencyKey: command.idempotencyKey,
          inputFingerprint,
        };
        const ledgerPayload = {
          id: ledgerEntryId,
          schemaVersion: 1,
          runbookId: id,
          transitionId: command.id,
          sequence,
          type: "runbook.task_transitioned",
          actorType: command.actorType,
          actorId: command.actorId,
          source: command.source,
          sessionId: command.sessionId,
          occurredAt: acceptedAt,
          details,
          previousHash,
        };
        const hash = stableFingerprint("runbook-ledger", ledgerPayload);
        const result = {
          status: "applied",
          runbookId: id,
          taskId: command.taskId,
          transitionId: command.id,
          taskRevision,
          runbookSequence: sequence,
          ledgerEntryId,
          receiptId,
          acceptedAt,
        };

        statements.push(
          db.prepare("INSERT INTO event_day_runbook_transitions (id,runbook_id,task_id,organization_id,project_id,runbook_sequence,expected_task_revision,task_revision,from_status,to_status,actor_type,actor_id,source,session_id,device_id,device_occurred_at,accepted_at,evidence_json,idempotency_key,input_fingerprint,correlation_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
            .bind(command.id, id, command.taskId, tenantId, ownerProjectId, sequence, command.expectedTaskRevision, taskRevision, command.fromStatus, command.toStatus, command.actorType, command.actorId, command.source, command.sessionId, command.deviceId, command.deviceOccurredAt, acceptedAt, json(command.evidence), command.idempotencyKey, inputFingerprint, correlationId),
          db.prepare("INSERT INTO event_day_runbook_ledger (id,runbook_id,transition_id,organization_id,project_id,schema_version,sequence,event_type,actor_type,actor_id,source,session_id,occurred_at,details_json,previous_hash,hash) VALUES (?,?,?,?,?,1,?,'runbook.task_transitioned',?,?,?,?,?,?,?,?)")
            .bind(ledgerEntryId, id, command.id, tenantId, ownerProjectId, sequence, command.actorType, command.actorId, command.source, command.sessionId, acceptedAt, json(details), previousHash, hash),
          db.prepare("UPDATE event_day_runbook_tasks SET status=?,task_revision=?,last_transition_id=?,updated_at=? WHERE runbook_id=? AND id=? AND organization_id=? AND project_id=? AND task_revision=? AND status=?")
            .bind(command.toStatus, taskRevision, command.id, acceptedAt, id, command.taskId, tenantId, ownerProjectId, command.expectedTaskRevision, command.fromStatus),
          db.prepare("INSERT INTO event_day_runbook_receipts (id,runbook_id,transition_id,organization_id,project_id,idempotency_key,input_fingerprint,correlation_id,result_json,occurred_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
            .bind(receiptId, id, command.id, tenantId, ownerProjectId, command.idempotencyKey, inputFingerprint, correlationId, json(result), acceptedAt),
          db.prepare("UPDATE event_day_runbooks SET sequence=?,ledger_head_hash=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND sequence=? AND ledger_head_hash=?")
            .bind(sequence, hash, acceptedAt, id, tenantId, ownerProjectId, sequence - 1, previousHash),
        );
        projections.set(command.taskId, { status: command.toStatus, taskRevision });
        commandsByKey.set(command.idempotencyKey, { inputFingerprint, result });
        results.push(clone(result));
        previousHash = hash;
      }

      if (statements.length) {
        try {
          await db.batch(statements);
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          if (/RUNBOOK_(?:TASK_REVISION|SEQUENCE)_CONFLICT/.test(message)) throw new RunbookTransitionConflict({ runbookId: id, reason: "concurrent-transition" });
          if (/UNIQUE constraint failed: event_day_runbook_(?:transitions|receipts)\.runbook_id, event_day_runbook_(?:transitions|receipts)\.idempotency_key/.test(message)) {
            throw new RunbookIdempotencyConflict({ runbookId: id, reason: "concurrent-idempotency-key" });
          }
          throw cause;
        }
      }
      return { results, runbook: await getRunbook(tenantId, ownerProjectId, id) };
    },
  });
}
