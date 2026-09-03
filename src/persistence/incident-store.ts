import { stableFingerprint } from "../domain/activity-ledger.ts";
import { venueError } from "../domain/errors.ts";
import type {
  ActorType,
  IncidentCommand,
  IncidentHandoff,
  IncidentRegister,
  OperationalIncident,
  OperationalSource,
} from "../domain/operational-types.ts";

type IncidentMutationCommand = Exclude<
  IncidentCommand,
  { readonly type: "create_incident_register" | "inspect_incident" | "inspect_incidents" | "export_incident_record" }
>;
export type IncidentOutboxCommand = IncidentMutationCommand &
  Readonly<{
    operationId: string;
    correlationId: string;
    clientId: string;
    clientSequence: number;
    clientOccurredAt: string;
    deviceOccurredAt?: string;
    deviceId?: string;
    expectedRevision?: number;
    projectId?: string;
    actorType: ActorType;
    actorId: string;
    source: OperationalSource;
    sessionId: string;
  }>;
export type IncidentAcknowledgementStatus = "applied" | "already-applied" | "conflict" | "rejected";
export interface IncidentAcknowledgement {
  readonly idempotencyKey: string;
  readonly operationId: string | null;
  readonly status: IncidentAcknowledgementStatus;
  readonly code?: string;
  readonly message?: string;
  readonly details?: object;
}
interface IncidentHandoffCache extends IncidentHandoff {
  readonly incidentId: string;
}
export type IncidentCacheState = IncidentRegister &
  Readonly<{ organizationId: string; handoffs: readonly IncidentHandoffCache[] }>;
interface StoredIncidentState extends IncidentCacheState {
  readonly scopeKey: string;
}
export interface IncidentOutboxEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly scopeKey: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly idempotencyKey: string;
  readonly inputFingerprint: string;
  readonly command: IncidentOutboxCommand;
  readonly syncStatus: "pending" | "conflict" | "rejected";
  readonly attempts: number;
  readonly enqueuedAt: string;
  readonly lastAttemptAt: string | null;
  readonly lastResult: IncidentAcknowledgement | null;
}
interface IncidentRecoveryEntry {
  readonly id: string;
  readonly scopeKey: string;
  readonly schemaVersion: 1;
  readonly code: "INCIDENT_CACHE_INVALID";
  readonly quarantinedAt: string;
  readonly state: StoredIncidentState;
}
export interface IncidentPersistenceAdapter {
  readonly kind?: string;
  getState(key: string): Promise<StoredIncidentState | null>;
  putState(value: StoredIncidentState): Promise<StoredIncidentState>;
  deleteState(key: string): Promise<void>;
  listOutbox(key: string): Promise<IncidentOutboxEntry[]>;
  putOutboxIfAbsent(
    entry: IncidentOutboxEntry,
  ): Promise<{ inserted: boolean; entry?: IncidentOutboxEntry; sequenceConflict?: IncidentOutboxEntry }>;
  putOutbox(entry: IncidentOutboxEntry): Promise<IncidentOutboxEntry>;
  deleteOutbox(id: string): Promise<void>;
  putRecovery(entry: IncidentRecoveryEntry): Promise<IncidentRecoveryEntry>;
  listRecovery(key: string): Promise<IncidentRecoveryEntry[]>;
  clear(key: string): Promise<void>;
}
interface MemoryIncidentAdapterInitial {
  readonly states?: readonly StoredIncidentState[];
  readonly outbox?: readonly IncidentOutboxEntry[];
  readonly recovery?: readonly IncidentRecoveryEntry[];
}
interface IndexedDbIncidentAdapterOptions {
  readonly indexedDB?: IDBFactory;
  readonly databaseName?: string;
}
interface IncidentStoreOptions extends IndexedDbIncidentAdapterOptions {
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly adapter?: IncidentPersistenceAdapter;
  readonly clock?: () => string;
}

const clone = <T>(value: T): T => (value === undefined ? value : structuredClone(value));
const REMOVABLE_ACK_STATUSES: ReadonlySet<IncidentAcknowledgementStatus> = new Set(["applied", "already-applied"]);
const RETAINED_ACK_STATUSES: ReadonlySet<IncidentAcknowledgementStatus | IncidentOutboxEntry["syncStatus"]> = new Set([
  "conflict",
  "rejected",
]);
const DEFAULT_DATABASE_NAME = "venuemind-incidents";
const DATABASE_VERSION = 1;
const STATE_STORE = "incident-state";
const OUTBOX_STORE = "incident-outbox";
const RECOVERY_STORE = "incident-recovery";
const scopeKey = (organizationId: string, projectId: string) =>
  `${encodeURIComponent(organizationId)}::${encodeURIComponent(projectId)}`;
const outboxId = (scope: string, idempotencyKey: string) => `${scope}::${encodeURIComponent(idempotencyKey)}`;
const commandFingerprint = (command: IncidentOutboxCommand) =>
  stableFingerprint(
    "incident-outbox-command",
    Object.fromEntries(Object.entries(command).filter(([key]) => !["correlationId", "idempotencyKey"].includes(key))),
  );
const compareOutboxEntries = (left: IncidentOutboxEntry, right: IncidentOutboxEntry) =>
  left.command.clientId.localeCompare(right.command.clientId) ||
  left.command.clientSequence - right.command.clientSequence ||
  left.idempotencyKey.localeCompare(right.idempotencyKey);

const assertCommand = (command: IncidentOutboxCommand, projectId: string) => {
  const required = {
    type: command.type,
    operationId: command.operationId,
    idempotencyKey: command.idempotencyKey,
    clientId: command.clientId,
  };
  for (const [field, value] of Object.entries(required))
    if (!value.trim()) throw venueError("COMMAND_INVALID", { reason: "incident-command-field-required", field });
  if (command.projectId !== undefined && command.projectId !== projectId)
    throw venueError("COMMAND_INVALID", { reason: "incident-command-project-mismatch" });
  if (!Number.isSafeInteger(command.clientSequence) || command.clientSequence < 1)
    throw venueError("COMMAND_INVALID", { reason: "incident-client-sequence-invalid" });
};
const assertState = (state: IncidentCacheState, organizationId: string, projectId: string) => {
  if (state.schemaVersion !== 1 || state.organizationId !== organizationId || state.projectId !== projectId)
    throw venueError("COMMAND_INVALID", { reason: "incident-cache-scope-invalid" });
  if (!Array.isArray(state.incidents) || !Array.isArray(state.handoffs))
    throw venueError("COMMAND_INVALID", { reason: "incident-cache-shape-invalid" });
  if (!Number.isSafeInteger(state.revision) || state.revision < 0)
    throw venueError("COMMAND_INVALID", { reason: "incident-cache-revision-invalid" });
};

export function createMemoryIncidentPersistenceAdapter(
  initial: MemoryIncidentAdapterInitial = {},
): IncidentPersistenceAdapter {
  const states = new Map<string, StoredIncidentState>(
    (initial.states ?? []).map((state) => [state.scopeKey, clone(state)]),
  );
  const outbox = new Map<string, IncidentOutboxEntry>((initial.outbox ?? []).map((entry) => [entry.id, clone(entry)]));
  const recovery = new Map<string, IncidentRecoveryEntry>(
    (initial.recovery ?? []).map((entry) => [entry.id, clone(entry)]),
  );
  return Object.freeze({
    kind: "memory",
    async getState(key: string) {
      return clone(states.get(key) ?? null);
    },
    async putState(value: StoredIncidentState) {
      states.set(value.scopeKey, clone(value));
      return clone(value);
    },
    async deleteState(key: string) {
      states.delete(key);
    },
    async listOutbox(key: string) {
      return [...outbox.values()].filter((entry) => entry.scopeKey === key).map(clone);
    },
    async putOutboxIfAbsent(entry: IncidentOutboxEntry) {
      const existing = outbox.get(entry.id);
      if (existing) return { inserted: false, entry: clone(existing) };
      const sequenceConflict = [...outbox.values()].find(
        (candidate) =>
          candidate.scopeKey === entry.scopeKey &&
          candidate.command.clientId === entry.command.clientId &&
          candidate.command.clientSequence === entry.command.clientSequence,
      );
      if (sequenceConflict) return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      outbox.set(entry.id, clone(entry));
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry: IncidentOutboxEntry) {
      outbox.set(entry.id, clone(entry));
      return clone(entry);
    },
    async deleteOutbox(id: string) {
      outbox.delete(id);
    },
    async putRecovery(entry: IncidentRecoveryEntry) {
      recovery.set(entry.id, clone(entry));
      return clone(entry);
    },
    async listRecovery(key: string) {
      return [...recovery.values()].filter((entry) => entry.scopeKey === key).map(clone);
    },
    async clear(key: string) {
      states.delete(key);
      for (const [id, entry] of outbox) if (entry.scopeKey === key) outbox.delete(id);
    },
  });
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isStoredIncidentState = (value: unknown): value is StoredIncidentState =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["scopeKey"] === "string" &&
  typeof value["organizationId"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["revision"] === "number" &&
  Array.isArray(value["incidents"]) &&
  Array.isArray(value["handoffs"]);
const isIncidentOutboxEntry = (value: unknown): value is IncidentOutboxEntry =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["scopeKey"] === "string" &&
  typeof value["organizationId"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["idempotencyKey"] === "string" &&
  typeof value["inputFingerprint"] === "string" &&
  isRecord(value["command"]) &&
  typeof value["command"]["type"] === "string" &&
  typeof value["command"]["clientId"] === "string" &&
  typeof value["command"]["clientSequence"] === "number" &&
  (value["syncStatus"] === "pending" || value["syncStatus"] === "conflict" || value["syncStatus"] === "rejected") &&
  typeof value["attempts"] === "number" &&
  typeof value["enqueuedAt"] === "string" &&
  (value["lastAttemptAt"] === null || typeof value["lastAttemptAt"] === "string") &&
  (value["lastResult"] === null || isRecord(value["lastResult"]));
const isIncidentRecoveryEntry = (value: unknown): value is IncidentRecoveryEntry =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["scopeKey"] === "string" &&
  value["code"] === "INCIDENT_CACHE_INVALID" &&
  typeof value["quarantinedAt"] === "string" &&
  isStoredIncidentState(value["state"]);
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

export function createIndexedDbIncidentPersistenceAdapter({
  indexedDB: indexedDBImpl = globalThis.indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
}: IndexedDbIncidentAdapterOptions = {}): IncidentPersistenceAdapter {
  if (!indexedDBImpl?.open) throw new TypeError("IndexedDB is unavailable");
  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDBImpl.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE, { keyPath: "scopeKey" });
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
          store.createIndex("clientSequence", ["scopeKey", "command.clientId", "command.clientSequence"], {
            unique: true,
          });
        }
        if (!db.objectStoreNames.contains(RECOVERY_STORE)) {
          const store = db.createObjectStore(RECOVERY_STORE, { keyPath: "id" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
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
    async getState(key: string) {
      const transaction = (await database()).transaction(STATE_STORE, "readonly");
      return clone(
        (await readOptional(transaction.objectStore(STATE_STORE).get(key), isStoredIncidentState, "incident-state")) ??
          null,
      );
    },
    async putState(value: StoredIncidentState) {
      const transaction = (await database()).transaction(STATE_STORE, "readwrite");
      transaction.objectStore(STATE_STORE).put(clone(value));
      await transactionDone(transaction);
      return clone(value);
    },
    async deleteState(key: string) {
      const transaction = (await database()).transaction(STATE_STORE, "readwrite");
      transaction.objectStore(STATE_STORE).delete(key);
      await transactionDone(transaction);
    },
    async listOutbox(key: string) {
      const transaction = (await database()).transaction(OUTBOX_STORE, "readonly");
      return clone(
        await readArray(
          transaction.objectStore(OUTBOX_STORE).index("scopeKey").getAll(key),
          isIncidentOutboxEntry,
          "incident-outbox",
        ),
      );
    },
    async putOutboxIfAbsent(entry: IncidentOutboxEntry) {
      const transaction = (await database()).transaction(OUTBOX_STORE, "readwrite");
      const store = transaction.objectStore(OUTBOX_STORE);
      const existing = await readOptional(store.get(entry.id), isIncidentOutboxEntry, "incident-outbox-entry");
      if (existing) return { inserted: false, entry: clone(existing) };
      const sequenceConflict = await readOptional(
        store.index("clientSequence").get([entry.scopeKey, entry.command.clientId, entry.command.clientSequence]),
        isIncidentOutboxEntry,
        "incident-outbox-entry",
      );
      if (sequenceConflict) return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      store.add(clone(entry));
      await transactionDone(transaction);
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry: IncidentOutboxEntry) {
      const transaction = (await database()).transaction(OUTBOX_STORE, "readwrite");
      transaction.objectStore(OUTBOX_STORE).put(clone(entry));
      await transactionDone(transaction);
      return clone(entry);
    },
    async deleteOutbox(id: string) {
      const transaction = (await database()).transaction(OUTBOX_STORE, "readwrite");
      transaction.objectStore(OUTBOX_STORE).delete(id);
      await transactionDone(transaction);
    },
    async putRecovery(entry: IncidentRecoveryEntry) {
      const transaction = (await database()).transaction(RECOVERY_STORE, "readwrite");
      transaction.objectStore(RECOVERY_STORE).put(clone(entry));
      await transactionDone(transaction);
      return clone(entry);
    },
    async listRecovery(key: string) {
      const transaction = (await database()).transaction(RECOVERY_STORE, "readonly");
      return clone(
        await readArray(
          transaction.objectStore(RECOVERY_STORE).index("scopeKey").getAll(key),
          isIncidentRecoveryEntry,
          "incident-recovery",
        ),
      );
    },
    async clear(key: string) {
      const transaction = (await database()).transaction([STATE_STORE, OUTBOX_STORE], "readwrite");
      transaction.objectStore(STATE_STORE).delete(key);
      const outboxStore = transaction.objectStore(OUTBOX_STORE);
      const entries = await readArray(
        outboxStore.index("scopeKey").getAll(key),
        isIncidentOutboxEntry,
        "incident-outbox",
      );
      for (const entry of entries) outboxStore.delete(entry.id);
      await transactionDone(transaction);
    },
  });
}

const defaultAdapter = (options: IndexedDbIncidentAdapterOptions): IncidentPersistenceAdapter => {
  try {
    return createIndexedDbIncidentPersistenceAdapter(options);
  } catch {
    return createMemoryIncidentPersistenceAdapter();
  }
};

export function createIncidentStore({
  organizationId,
  projectId,
  adapter,
  indexedDB,
  databaseName,
  clock = () => new Date().toISOString(),
}: IncidentStoreOptions = {}) {
  if (
    typeof organizationId !== "string" ||
    !organizationId.trim() ||
    typeof projectId !== "string" ||
    !projectId.trim()
  )
    throw new TypeError("Incident store requires Organization and Project IDs");
  const persistence =
    adapter ?? defaultAdapter({ ...(indexedDB ? { indexedDB } : {}), ...(databaseName ? { databaseName } : {}) });
  const key = scopeKey(organizationId, projectId);
  const listOutbox = async () => (await persistence.listOutbox(key)).sort(compareOutboxEntries);
  const saveState = async (state: IncidentCacheState): Promise<IncidentCacheState> => {
    assertState(state, organizationId, projectId);
    const current = await persistence.getState(key);
    if (current && current.revision > state.revision) {
      const { scopeKey: _scopeKey, ...retained } = current;
      return clone(retained);
    }
    await persistence.putState({ ...clone(state), scopeKey: key });
    return clone(state);
  };
  return Object.freeze({
    persistenceKind: persistence.kind ?? "custom",
    async hydrate() {
      const [stored, outbox] = await Promise.all([persistence.getState(key), listOutbox()]);
      if (!stored)
        return {
          source: "local" as const,
          state: null,
          register: null,
          incidents: [],
          handoffs: [],
          outbox,
          recovery: null,
        };
      const { scopeKey: _scopeKey, ...state } = stored;
      try {
        assertState(state, organizationId, projectId);
      } catch {
        const quarantinedAt = clock();
        const recovery: IncidentRecoveryEntry = {
          id: `${key}::${encodeURIComponent(quarantinedAt)}`,
          scopeKey: key,
          schemaVersion: 1,
          code: "INCIDENT_CACHE_INVALID",
          quarantinedAt,
          state: clone(stored),
        };
        await persistence.putRecovery(recovery);
        await persistence.deleteState(key);
        return {
          source: "local" as const,
          state: null,
          register: null,
          incidents: [],
          handoffs: [],
          outbox,
          recovery: { id: recovery.id, code: recovery.code, quarantinedAt },
        };
      }
      const { organizationId: _organizationId, handoffs, ...register } = state;
      return {
        source: "local" as const,
        state: clone(state),
        register: clone(register),
        incidents: clone(state.incidents),
        handoffs: clone(handoffs),
        outbox,
        recovery: null,
      };
    },
    saveState,
    async saveRegister(register: IncidentRegister) {
      if (register.schemaVersion !== 1 || register.projectId !== projectId || !Array.isArray(register.incidents))
        throw venueError("COMMAND_INVALID", { reason: "incident-register-cache-invalid" });
      const handoffs = register.incidents.flatMap((incident: OperationalIncident) =>
        incident.handoffs.map((handoff: IncidentHandoff) => ({ ...handoff, incidentId: incident.id })),
      );
      await saveState({ ...clone(register), organizationId, handoffs });
      return clone(register);
    },
    async enqueue(command: IncidentOutboxCommand) {
      assertCommand(command, projectId);
      const normalized = clone(command);
      const inputFingerprint = commandFingerprint(normalized);
      const entry: IncidentOutboxEntry = {
        id: outboxId(key, normalized.idempotencyKey),
        schemaVersion: 1,
        scopeKey: key,
        organizationId,
        projectId,
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
          reason: "incident-client-sequence-conflict",
          clientId: normalized.clientId,
          clientSequence: normalized.clientSequence,
          existingIdempotencyKey: stored.sequenceConflict.idempotencyKey,
        });
      if (!stored.inserted && stored.entry) {
        if (stored.entry.inputFingerprint !== inputFingerprint)
          throw venueError("IDEMPOTENCY_KEY_CONFLICT", {
            idempotencyKey: normalized.idempotencyKey,
            commandType: normalized.type,
          });
        return clone(stored.entry);
      }
      return clone(entry);
    },
    async listOutbox() {
      return listOutbox();
    },
    async markAttempted(idempotencyKeys: readonly string[]) {
      const keys = new Set(idempotencyKeys);
      const attemptedAt = clock();
      const updated: IncidentOutboxEntry[] = [];
      for (const entry of await listOutbox())
        if (keys.has(entry.idempotencyKey)) {
          const next = { ...entry, attempts: entry.attempts + 1, lastAttemptAt: attemptedAt };
          await persistence.putOutbox(next);
          updated.push(clone(next));
        }
      return updated;
    },
    async acknowledge(
      acknowledgements: readonly IncidentAcknowledgement[],
      { state = null }: { readonly state?: IncidentCacheState | null } = {},
    ) {
      const entries = await listOutbox();
      const byKey = new Map(entries.map((entry) => [entry.idempotencyKey, entry]));
      const summary: { removed: string[]; retained: string[]; ignored: (string | null)[] } = {
        removed: [],
        retained: [],
        ignored: [],
      };
      for (const acknowledgement of acknowledgements) {
        const entry = byKey.get(acknowledgement.idempotencyKey);
        if (!entry) {
          summary.ignored.push(acknowledgement.idempotencyKey || null);
          continue;
        }
        if (REMOVABLE_ACK_STATUSES.has(acknowledgement.status)) {
          await persistence.deleteOutbox(entry.id);
          summary.removed.push(entry.idempotencyKey);
          continue;
        }
        if (acknowledgement.status !== "conflict" && acknowledgement.status !== "rejected") {
          summary.ignored.push(entry.idempotencyKey);
          continue;
        }
        await persistence.putOutbox({
          ...entry,
          syncStatus: acknowledgement.status,
          lastResult: clone(acknowledgement),
        });
        summary.retained.push(entry.idempotencyKey);
      }
      if (state) await saveState(state);
      return summary;
    },
    async discardConflicts() {
      const removed: string[] = [];
      for (const entry of await listOutbox())
        if (RETAINED_ACK_STATUSES.has(entry.syncStatus)) {
          await persistence.deleteOutbox(entry.id);
          removed.push(entry.idempotencyKey);
        }
      return removed;
    },
    async clear() {
      await persistence.clear(key);
    },
  });
}

export type IncidentStore = ReturnType<typeof createIncidentStore>;
