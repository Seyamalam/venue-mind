import { stableFingerprint } from "../domain/activity-ledger.ts";
import { venueError } from "../domain/errors.ts";
import type {
  ActorType,
  EventDayRunbook,
  OperationalSource,
  RunbookEvidence,
  RunbookTaskStatus,
} from "../domain/operational-types.ts";

export interface RunbookOutboxCommand {
  readonly type: "transition_runbook_task";
  readonly runbookVersionId: string;
  readonly taskId: string;
  readonly expectedTaskRevision: number;
  readonly fromStatus: RunbookTaskStatus;
  readonly toStatus: RunbookTaskStatus;
  readonly reasonCode?: string;
  readonly evidence: readonly RunbookEvidence[];
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly clientId: string;
  readonly clientSequence: number;
  readonly clientOccurredAt: string;
  readonly deviceOccurredAt: string;
  readonly committedAt: string;
  readonly deviceId: string;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly source: OperationalSource;
  readonly sessionId: string;
}

export type RunbookAcknowledgementStatus = "applied" | "already-applied" | "conflict" | "rejected";
export interface RunbookAcknowledgement {
  readonly idempotencyKey: string;
  readonly status: RunbookAcknowledgementStatus;
  readonly [field: string]: string | number | boolean | null | undefined;
}
export interface RunbookOutboxEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly runbookVersionId: string;
  readonly idempotencyKey: string;
  readonly inputFingerprint: string;
  readonly command: RunbookOutboxCommand;
  readonly syncStatus: "pending" | "conflict" | "rejected";
  readonly attempts: number;
  readonly enqueuedAt: string;
  readonly lastAttemptAt: string | null;
  readonly lastResult: RunbookAcknowledgement | null;
}
export interface RunbookPersistenceAdapter {
  readonly kind?: string;
  getRunbook(runbookVersionId: string): Promise<EventDayRunbook | null>;
  listRunbooks(projectId: string): Promise<EventDayRunbook[]>;
  putRunbook(runbook: EventDayRunbook): Promise<EventDayRunbook>;
  listOutbox(runbookVersionId: string): Promise<RunbookOutboxEntry[]>;
  putOutboxIfAbsent(
    entry: RunbookOutboxEntry,
  ): Promise<{ inserted: boolean; entry?: RunbookOutboxEntry; sequenceConflict?: RunbookOutboxEntry }>;
  putOutbox(entry: RunbookOutboxEntry): Promise<RunbookOutboxEntry>;
  deleteOutbox(id: string): Promise<void>;
}
interface MemoryRunbookAdapterInitial {
  readonly runbooks?: readonly EventDayRunbook[];
  readonly outbox?: readonly RunbookOutboxEntry[];
}
interface IndexedDbRunbookAdapterOptions {
  readonly indexedDB?: IDBFactory;
  readonly databaseName?: string;
}
interface RunbookStoreOptions extends IndexedDbRunbookAdapterOptions {
  readonly adapter?: RunbookPersistenceAdapter;
  readonly clock?: () => string;
}

const DEFAULT_DATABASE_NAME = "venuemind-runbooks";
const DATABASE_VERSION = 1;
const RUNBOOK_STORE = "runbooks";
const OUTBOX_STORE = "outbox";
const REMOVABLE_ACK_STATUSES: ReadonlySet<RunbookAcknowledgementStatus> = new Set(["applied", "already-applied"]);
const RETAINED_ACK_STATUSES: ReadonlySet<RunbookAcknowledgementStatus> = new Set(["conflict", "rejected"]);

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));

const outboxId = (runbookVersionId: string, idempotencyKey: string) =>
  `${encodeURIComponent(runbookVersionId)}::${encodeURIComponent(idempotencyKey)}`;

const commandFingerprint = (command: RunbookOutboxCommand) => {
  const semantic = Object.fromEntries(
    Object.entries(command).filter(([key]) => !["correlationId", "idempotencyKey"].includes(key)),
  );
  return stableFingerprint("runbook-outbox-command", semantic);
};

const compareOutboxEntries = (left: RunbookOutboxEntry, right: RunbookOutboxEntry) =>
  left.command.clientId.localeCompare(right.command.clientId) ||
  left.command.clientSequence - right.command.clientSequence ||
  left.command.idempotencyKey.localeCompare(right.command.idempotencyKey);

const assertCommand = (command: RunbookOutboxCommand) => {
  const requiredFields = {
    runbookVersionId: command.runbookVersionId,
    idempotencyKey: command.idempotencyKey,
    operationId: command.operationId,
    clientId: command.clientId,
  };
  for (const [field, value] of Object.entries(requiredFields)) {
    if (!value.trim()) throw venueError("COMMAND_INVALID", { reason: "runbook-command-field-required", field });
  }
  if (!Number.isSafeInteger(command.clientSequence) || command.clientSequence < 1)
    throw venueError("COMMAND_INVALID", {
      reason: "runbook-client-sequence-invalid",
      clientSequence: command.clientSequence ?? null,
    });
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isEventDayRunbook = (value: unknown): value is EventDayRunbook =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["versionId"] === "string" &&
  typeof value["version"] === "number" &&
  isRecord(value["source"]) &&
  typeof value["source"]["projectId"] === "string" &&
  isRecord(value["baseline"]) &&
  (value["status"] === "active" || value["status"] === "archived") &&
  Array.isArray(value["phases"]) &&
  Array.isArray(value["tasks"]) &&
  Array.isArray(value["transitions"]) &&
  Array.isArray(value["receipts"]) &&
  Array.isArray(value["ledger"]) &&
  typeof value["revision"] === "number" &&
  typeof value["frozenAt"] === "string" &&
  typeof value["frozenBy"] === "string";
const isRunbookOutboxEntry = (value: unknown): value is RunbookOutboxEntry =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["runbookVersionId"] === "string" &&
  typeof value["idempotencyKey"] === "string" &&
  typeof value["inputFingerprint"] === "string" &&
  isRecord(value["command"]) &&
  value["command"]["type"] === "transition_runbook_task" &&
  typeof value["command"]["clientId"] === "string" &&
  typeof value["command"]["clientSequence"] === "number" &&
  (value["syncStatus"] === "pending" || value["syncStatus"] === "conflict" || value["syncStatus"] === "rejected") &&
  typeof value["attempts"] === "number" &&
  typeof value["enqueuedAt"] === "string" &&
  (value["lastAttemptAt"] === null || typeof value["lastAttemptAt"] === "string") &&
  (value["lastResult"] === null || isRecord(value["lastResult"]));

const requestUnknown = (request: IDBRequest): Promise<unknown> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed"));
    };
  });

const readOptional = async <Value>(
  request: IDBRequest,
  isValue: (value: unknown) => value is Value,
  label: string,
): Promise<Value | undefined> => {
  const value = await requestUnknown(request);
  if (value === undefined) return undefined;
  if (!isValue(value)) throw venueError("COMMAND_INVALID", { reason: `${label}-invalid` });
  return value;
};

const readArray = async <Value>(
  request: IDBRequest,
  isValue: (value: unknown) => value is Value,
  label: string,
): Promise<Value[]> => {
  const value = await requestUnknown(request);
  if (!Array.isArray(value) || !value.every(isValue))
    throw venueError("COMMAND_INVALID", { reason: `${label}-invalid` });
  return value;
};

const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    };
  });

export function createMemoryRunbookPersistenceAdapter(
  initial: MemoryRunbookAdapterInitial = {},
): RunbookPersistenceAdapter {
  const runbooks = new Map<string, EventDayRunbook>(
    (initial.runbooks ?? []).map((runbook) => [runbook.versionId, clone(runbook)]),
  );
  const outbox = new Map<string, RunbookOutboxEntry>((initial.outbox ?? []).map((entry) => [entry.id, clone(entry)]));

  return Object.freeze({
    kind: "memory",
    async getRunbook(runbookVersionId: string) {
      return clone(runbooks.get(runbookVersionId) ?? null);
    },
    async listRunbooks(projectId: string) {
      return [...runbooks.values()].filter((runbook) => runbook.source?.projectId === projectId).map(clone);
    },
    async putRunbook(runbook: EventDayRunbook) {
      runbooks.set(runbook.versionId, clone(runbook));
      return clone(runbook);
    },
    async listOutbox(runbookVersionId: string) {
      return [...outbox.values()].filter((entry) => entry.runbookVersionId === runbookVersionId).map(clone);
    },
    async putOutboxIfAbsent(entry: RunbookOutboxEntry) {
      const existing = outbox.get(entry.id);
      if (existing) return { inserted: false, entry: clone(existing) };
      const sequenceConflict = [...outbox.values()].find(
        (candidate) =>
          candidate.runbookVersionId === entry.runbookVersionId &&
          candidate.command.clientId === entry.command.clientId &&
          candidate.command.clientSequence === entry.command.clientSequence,
      );
      if (sequenceConflict) return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      outbox.set(entry.id, clone(entry));
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry: RunbookOutboxEntry) {
      outbox.set(entry.id, clone(entry));
      return clone(entry);
    },
    async deleteOutbox(id: string) {
      outbox.delete(id);
    },
  });
}

export function createIndexedDbRunbookPersistenceAdapter({
  indexedDB: indexedDBImpl = globalThis.indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
}: IndexedDbRunbookAdapterOptions = {}): RunbookPersistenceAdapter {
  if (!indexedDBImpl?.open) throw new TypeError("IndexedDB is unavailable");
  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDBImpl.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RUNBOOK_STORE)) db.createObjectStore(RUNBOOK_STORE, { keyPath: "versionId" });
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
          store.createIndex("runbookVersionId", "runbookVersionId", { unique: false });
          store.createIndex("clientSequence", ["runbookVersionId", "command.clientId", "command.clientSequence"], {
            unique: true,
          });
        }
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        reject(request.error ?? new Error("IndexedDB open failed"));
      };
      request.onblocked = () => {
        reject(new Error("IndexedDB upgrade blocked"));
      };
    });
    return databasePromise;
  };

  return Object.freeze({
    kind: "indexeddb",
    async getRunbook(runbookVersionId: string) {
      const db = await database();
      const transaction = db.transaction(RUNBOOK_STORE, "readonly");
      return clone(
        (await readOptional(
          transaction.objectStore(RUNBOOK_STORE).get(runbookVersionId),
          isEventDayRunbook,
          "runbook",
        )) ?? null,
      );
    },
    async listRunbooks(projectId: string) {
      const db = await database();
      const transaction = db.transaction(RUNBOOK_STORE, "readonly");
      const values = await readArray(transaction.objectStore(RUNBOOK_STORE).getAll(), isEventDayRunbook, "runbooks");
      return values.filter((runbook) => runbook.source?.projectId === projectId).map(clone);
    },
    async putRunbook(runbook: EventDayRunbook) {
      const db = await database();
      const transaction = db.transaction(RUNBOOK_STORE, "readwrite");
      transaction.objectStore(RUNBOOK_STORE).put(clone(runbook));
      await transactionDone(transaction);
      return clone(runbook);
    },
    async listOutbox(runbookVersionId: string) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readonly");
      const values = await readArray(
        transaction.objectStore(OUTBOX_STORE).getAll(),
        isRunbookOutboxEntry,
        "runbook-outbox",
      );
      return values.filter((entry) => entry.runbookVersionId === runbookVersionId).map(clone);
    },
    async putOutboxIfAbsent(entry: RunbookOutboxEntry) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readwrite");
      const store = transaction.objectStore(OUTBOX_STORE);
      const existing = await readOptional(store.get(entry.id), isRunbookOutboxEntry, "runbook-outbox-entry");
      if (existing) return { inserted: false, entry: clone(existing) };
      const sequenceConflict = await readOptional(
        store
          .index("clientSequence")
          .get([entry.runbookVersionId, entry.command.clientId, entry.command.clientSequence]),
        isRunbookOutboxEntry,
        "runbook-outbox-entry",
      );
      if (sequenceConflict) return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      store.add(clone(entry));
      await transactionDone(transaction);
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry: RunbookOutboxEntry) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readwrite");
      transaction.objectStore(OUTBOX_STORE).put(clone(entry));
      await transactionDone(transaction);
      return clone(entry);
    },
    async deleteOutbox(id: string) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readwrite");
      transaction.objectStore(OUTBOX_STORE).delete(id);
      await transactionDone(transaction);
    },
  });
}

const defaultAdapter = (options: IndexedDbRunbookAdapterOptions): RunbookPersistenceAdapter => {
  try {
    return createIndexedDbRunbookPersistenceAdapter(options);
  } catch {
    return createMemoryRunbookPersistenceAdapter();
  }
};

export function createRunbookStore({
  adapter,
  indexedDB,
  databaseName,
  clock = () => new Date().toISOString(),
}: RunbookStoreOptions = {}) {
  const persistence =
    adapter ?? defaultAdapter({ ...(indexedDB ? { indexedDB } : {}), ...(databaseName ? { databaseName } : {}) });

  const listOutbox = async (runbookVersionId: string) =>
    (await persistence.listOutbox(runbookVersionId)).sort(compareOutboxEntries);

  return Object.freeze({
    persistenceKind: persistence.kind ?? "custom",

    async hydrate(runbookVersionId: string) {
      if (typeof runbookVersionId !== "string" || !runbookVersionId.trim())
        throw venueError("COMMAND_INVALID", { reason: "runbook-version-required" });
      const [runbook, outbox] = await Promise.all([
        persistence.getRunbook(runbookVersionId),
        listOutbox(runbookVersionId),
      ]);
      return { source: "local", runbook, outbox };
    },

    async hydrateProject(projectId: string) {
      if (typeof projectId !== "string" || !projectId.trim())
        throw venueError("COMMAND_INVALID", { reason: "runbook-project-required" });
      const runbooks = (await persistence.listRunbooks(projectId)).sort(
        (left, right) => String(right.frozenAt).localeCompare(String(left.frozenAt)) || right.version - left.version,
      );
      const runbook = runbooks[0] ?? null;
      return runbook
        ? { source: "local", runbook, outbox: await listOutbox(runbook.versionId) }
        : { source: "local", runbook: null, outbox: [] };
    },

    async saveRunbook(runbook: EventDayRunbook) {
      if (!runbook?.versionId || !Number.isSafeInteger(runbook.revision) || runbook.revision < 0)
        throw venueError("COMMAND_INVALID", { reason: "runbook-cache-invalid" });
      const existing = await persistence.getRunbook(runbook.versionId);
      if (existing && existing.revision > runbook.revision) return clone(existing);
      return persistence.putRunbook(clone(runbook));
    },

    async enqueue(command: RunbookOutboxCommand) {
      assertCommand(command);
      const normalized = clone(command);
      const inputFingerprint = commandFingerprint(normalized);
      const entry: RunbookOutboxEntry = {
        id: outboxId(normalized.runbookVersionId, normalized.idempotencyKey),
        schemaVersion: 1,
        runbookVersionId: normalized.runbookVersionId,
        idempotencyKey: normalized.idempotencyKey,
        inputFingerprint,
        command: normalized,
        syncStatus: "pending",
        attempts: 0,
        enqueuedAt: clock(),
        lastAttemptAt: null,
        lastResult: null,
      };
      const stored = await persistence.putOutboxIfAbsent(entry);
      if (stored.sequenceConflict)
        throw venueError("COMMAND_INVALID", {
          reason: "runbook-client-sequence-conflict",
          clientId: normalized.clientId,
          clientSequence: normalized.clientSequence,
          existingIdempotencyKey: stored.sequenceConflict.idempotencyKey,
        });
      if (!stored.inserted && stored.entry) {
        if (stored.entry.inputFingerprint !== inputFingerprint)
          throw venueError("IDEMPOTENCY_KEY_CONFLICT", {
            idempotencyKey: normalized.idempotencyKey,
            commandType: normalized.type ?? "runbook-command",
          });
        return clone(stored.entry);
      }
      if (!stored.inserted) throw venueError("COMMAND_INVALID", { reason: "runbook-outbox-result-invalid" });
      return clone(entry);
    },

    async listOutbox(runbookVersionId: string) {
      return listOutbox(runbookVersionId);
    },

    async markAttempted(runbookVersionId: string, idempotencyKeys: readonly string[]) {
      const keys = new Set(idempotencyKeys);
      const attemptedAt = clock();
      const entries = await listOutbox(runbookVersionId);
      const updated: RunbookOutboxEntry[] = [];
      for (const entry of entries) {
        if (!keys.has(entry.idempotencyKey)) continue;
        const next: RunbookOutboxEntry = { ...entry, attempts: entry.attempts + 1, lastAttemptAt: attemptedAt };
        await persistence.putOutbox(next);
        updated.push(clone(next));
      }
      return updated;
    },

    async acknowledge(
      runbookVersionId: string,
      acknowledgements: readonly RunbookAcknowledgement[],
      { runbook = null }: { runbook?: EventDayRunbook | null } = {},
    ) {
      const entries = await listOutbox(runbookVersionId);
      const byKey = new Map(entries.map((entry) => [entry.idempotencyKey, entry]));
      const summary: { removed: string[]; retained: string[]; ignored: Array<string | null> } = {
        removed: [],
        retained: [],
        ignored: [],
      };
      for (const acknowledgement of acknowledgements) {
        const idempotencyKey = acknowledgement?.idempotencyKey;
        const entry = byKey.get(idempotencyKey);
        if (!entry) {
          summary.ignored.push(idempotencyKey ?? null);
          continue;
        }
        if (REMOVABLE_ACK_STATUSES.has(acknowledgement.status)) {
          await persistence.deleteOutbox(entry.id);
          summary.removed.push(idempotencyKey);
          byKey.delete(idempotencyKey);
          continue;
        }
        if (!RETAINED_ACK_STATUSES.has(acknowledgement.status)) {
          summary.ignored.push(idempotencyKey);
          continue;
        }
        const next: RunbookOutboxEntry = {
          ...entry,
          syncStatus: acknowledgement.status === "conflict" ? "conflict" : "rejected",
          lastResult: clone(acknowledgement),
        };
        await persistence.putOutbox(next);
        byKey.set(idempotencyKey, next);
        summary.retained.push(idempotencyKey);
      }
      if (runbook) await this.saveRunbook(runbook);
      return { ...summary, outbox: await listOutbox(runbookVersionId) };
    },
  });
}
