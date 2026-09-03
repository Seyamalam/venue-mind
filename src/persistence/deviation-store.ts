import { stableFingerprint } from "../domain/activity-ledger.ts";
import { venueError } from "../domain/errors.ts";
import type {
  CreatePostEventDeviationProposalCommand,
  EndLivePlanDeviationCommand,
  LivePlanDeviationRegister,
  RecordLivePlanDeviationCommand,
} from "../domain/operational-types.ts";

type DeviationMutationCommand =
  | RecordLivePlanDeviationCommand
  | EndLivePlanDeviationCommand
  | CreatePostEventDeviationProposalCommand;

export type DeviationOutboxCommand = DeviationMutationCommand &
  Readonly<{
    operationId: string;
    correlationId: string;
    clientId: string;
    clientSequence: number;
    clientOccurredAt: string;
    deviceOccurredAt?: string;
    deviceId?: string;
    projectId?: string;
  }>;

export type DeviationAcknowledgementStatus = "applied" | "already-applied" | "conflict" | "rejected";
export interface DeviationAcknowledgement {
  readonly idempotencyKey: string;
  readonly operationId: string | null;
  readonly status: DeviationAcknowledgementStatus;
  readonly code?: string;
  readonly message?: string;
  readonly details?: object;
}
export interface DeviationOutboxEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly scopeKey: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly registerId: string;
  readonly idempotencyKey: string;
  readonly inputFingerprint: string;
  readonly command: DeviationOutboxCommand;
  readonly syncStatus: "pending" | "conflict" | "rejected";
  readonly attempts: number;
  readonly enqueuedAt: string;
  readonly lastAttemptAt: string | null;
  readonly lastResult: DeviationAcknowledgement | null;
}

interface StoredDeviationRegister extends LivePlanDeviationRegister {
  readonly scopeKey: string;
  readonly organizationId: string;
}
interface DeviationRecoveryEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly scopeKey: string;
  readonly code: "DEVIATION_CACHE_INVALID";
  readonly quarantinedAt: string;
  readonly register: StoredDeviationRegister;
}
export interface DeviationPersistenceAdapter {
  readonly kind?: string;
  getRegister(scopeKey: string): Promise<StoredDeviationRegister | null>;
  putRegister(register: StoredDeviationRegister): Promise<StoredDeviationRegister>;
  deleteRegister(scopeKey: string): Promise<void>;
  listOutbox(scopeKey: string): Promise<DeviationOutboxEntry[]>;
  putOutboxIfAbsent(
    entry: DeviationOutboxEntry,
  ): Promise<{ inserted: boolean; entry?: DeviationOutboxEntry; sequenceConflict?: DeviationOutboxEntry }>;
  putOutbox(entry: DeviationOutboxEntry): Promise<DeviationOutboxEntry>;
  deleteOutbox(id: string): Promise<void>;
  putRecovery(entry: DeviationRecoveryEntry): Promise<DeviationRecoveryEntry>;
  listRecovery(scopeKey: string): Promise<DeviationRecoveryEntry[]>;
  clear(scopeKey: string): Promise<void>;
}
interface MemoryDeviationAdapterInitial {
  readonly registers?: readonly StoredDeviationRegister[];
  readonly outbox?: readonly DeviationOutboxEntry[];
  readonly recovery?: readonly DeviationRecoveryEntry[];
}
interface IndexedDbDeviationAdapterOptions {
  readonly indexedDB?: IDBFactory | null;
  readonly databaseName?: string;
}
interface DeviationStoreOptions extends IndexedDbDeviationAdapterOptions {
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly registerId?: string;
  readonly adapter?: DeviationPersistenceAdapter;
  readonly clock?: () => string;
}

const clone = <Value>(value: Value): Value => (value == null ? value : structuredClone(value));
const DEFAULT_DATABASE_NAME = "venuemind-live-plan-deviations";
const DATABASE_VERSION = 1;
const REGISTER_STORE = "deviation-registers";
const OUTBOX_STORE = "deviation-outbox";
const RECOVERY_STORE = "deviation-recovery";
const REMOVABLE_STATUSES: ReadonlySet<DeviationAcknowledgementStatus> = new Set(["applied", "already-applied"]);
const RETAINED_STATUSES: ReadonlySet<DeviationOutboxEntry["syncStatus"]> = new Set(["conflict", "rejected"]);
const scopeKey = (organizationId: string, projectId: string, registerId: string): string =>
  [organizationId, projectId, registerId].map(encodeURIComponent).join("::");
const outboxId = (scope: string, idempotencyKey: string): string =>
  `${scope}::${encodeURIComponent(idempotencyKey)}`;
const commandFingerprint = (command: DeviationOutboxCommand): string =>
  stableFingerprint(
    "deviation-outbox-command",
    Object.fromEntries(Object.entries(command).filter(([key]) => !["correlationId", "idempotencyKey"].includes(key))),
  );
const compareOutbox = (left: DeviationOutboxEntry, right: DeviationOutboxEntry): number =>
  left.command.clientId.localeCompare(right.command.clientId) ||
  left.command.clientSequence - right.command.clientSequence ||
  left.idempotencyKey.localeCompare(right.idempotencyKey);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isNonNegativeInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;
const isPositiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isNonEmptyString);
const isActorType = (value: unknown): value is "human" | "agent" | "system" =>
  value === "human" || value === "agent" || value === "system";
const isOperationalSource = (value: unknown): boolean =>
  value === "studio" || value === "webmcp" || value === "mcp" || value === "system" || value === "agent-tool";
const isLocation = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (value["kind"] === "plan-object") return isNonEmptyString(value["planObjectId"]);
  return (
    value["kind"] === "coordinate" &&
    isRecord(value["point"]) &&
    typeof value["point"]["x"] === "number" &&
    Number.isFinite(value["point"]["x"]) &&
    typeof value["point"]["y"] === "number" &&
    Number.isFinite(value["point"]["y"])
  );
};
const isAcknowledgement = (value: unknown): value is DeviationAcknowledgement =>
  isRecord(value) &&
  isNonEmptyString(value["idempotencyKey"]) &&
  (value["operationId"] === null || isNonEmptyString(value["operationId"])) &&
  (value["status"] === "applied" ||
    value["status"] === "already-applied" ||
    value["status"] === "conflict" ||
    value["status"] === "rejected") &&
  (value["code"] === undefined || typeof value["code"] === "string") &&
  (value["message"] === undefined || typeof value["message"] === "string") &&
  (value["details"] === undefined || isRecord(value["details"]));
const isCommand = (value: unknown): value is DeviationOutboxCommand => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value["operationId"]) ||
    !isNonEmptyString(value["correlationId"]) ||
    !isNonEmptyString(value["clientId"]) ||
    !isPositiveInteger(value["clientSequence"]) ||
    !isNonEmptyString(value["clientOccurredAt"]) ||
    !isNonEmptyString(value["idempotencyKey"]) ||
    !isNonNegativeInteger(value["expectedRevision"]) ||
    !isActorType(value["actorType"]) ||
    !isNonEmptyString(value["actorId"]) ||
    !isOperationalSource(value["source"]) ||
    !isNonEmptyString(value["sessionId"])
  )
    return false;
  if (value["type"] === "record_live_plan_deviation")
    return (
      isNonEmptyString(value["deviationId"]) &&
      (value["disposition"] === "temporary" || value["disposition"] === "revision-candidate") &&
      isNonEmptyString(value["reasonCode"]) &&
      isLocation(value["location"]) &&
      isStringArray(value["affectedObjectIds"]) &&
      isStringArray(value["availableConstraintIds"]) &&
      isRecord(value["change"])
    );
  if (value["type"] === "end_live_plan_deviation")
    return (
      isNonEmptyString(value["deviationId"]) &&
      isNonNegativeInteger(value["expectedDeviationRevision"]) &&
      isNonEmptyString(value["reasonCode"])
    );
  return (
    value["type"] === "create_post_event_deviation_proposal" &&
    isNonEmptyString(value["proposalId"]) &&
    isNonEmptyString(value["goal"]) &&
    isStringArray(value["deviationIds"]) &&
    value["deviationIds"].length > 0
  );
};
const isDeviation = (value: unknown): boolean =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isPositiveInteger(value["sequence"]) &&
  isPositiveInteger(value["revision"]) &&
  (value["status"] === "active" || value["status"] === "ended") &&
  (value["disposition"] === "temporary" || value["disposition"] === "revision-candidate") &&
  isRecord(value["validation"]) &&
  isStringArray(value["affectedObjectIds"]) &&
  Array.isArray(value["objectLineage"]);
export const isLivePlanDeviationRegister = (value: unknown): value is LivePlanDeviationRegister =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["projectId"]) &&
  isNonEmptyString(value["runbookVersionId"]) &&
  isRecord(value["source"]) &&
  isNonEmptyString(value["source"]["runbookVersionId"]) &&
  isNonEmptyString(value["source"]["planId"]) &&
  isNonEmptyString(value["source"]["planFingerprint"]) &&
  isRecord(value["baseline"]) &&
  isRecord(value["baseline"]["acceptedPlan"]) &&
  isRecord(value["baseline"]["acceptedBrief"]) &&
  isNonEmptyString(value["baseline"]["fingerprint"]) &&
  Array.isArray(value["deviations"]) &&
  value["deviations"].every(isDeviation) &&
  Array.isArray(value["recommendations"]) &&
  value["recommendations"].every(isRecord) &&
  Array.isArray(value["transitions"]) &&
  value["transitions"].every(isRecord) &&
  Array.isArray(value["receipts"]) &&
  value["receipts"].every(isRecord) &&
  Array.isArray(value["ledger"]) &&
  value["ledger"].every(isRecord) &&
  isNonNegativeInteger(value["revision"]) &&
  isNonEmptyString(value["createdAt"]) &&
  isNonEmptyString(value["createdBy"]) &&
  isNonEmptyString(value["updatedAt"]);
const isStoredRegister = (value: unknown): value is StoredDeviationRegister =>
  isRecord(value) &&
  isLivePlanDeviationRegister(value) &&
  isNonEmptyString(value["scopeKey"]) &&
  isNonEmptyString(value["organizationId"]);
const isOutboxEntry = (value: unknown): value is DeviationOutboxEntry =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["scopeKey"]) &&
  isNonEmptyString(value["organizationId"]) &&
  isNonEmptyString(value["projectId"]) &&
  isNonEmptyString(value["registerId"]) &&
  isNonEmptyString(value["idempotencyKey"]) &&
  isNonEmptyString(value["inputFingerprint"]) &&
  isCommand(value["command"]) &&
  (value["syncStatus"] === "pending" || value["syncStatus"] === "conflict" || value["syncStatus"] === "rejected") &&
  isNonNegativeInteger(value["attempts"]) &&
  isNonEmptyString(value["enqueuedAt"]) &&
  (value["lastAttemptAt"] === null || isNonEmptyString(value["lastAttemptAt"])) &&
  (value["lastResult"] === null || isAcknowledgement(value["lastResult"]));
const isRecovery = (value: unknown): value is DeviationRecoveryEntry =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["scopeKey"]) &&
  value["code"] === "DEVIATION_CACHE_INVALID" &&
  isNonEmptyString(value["quarantinedAt"]) &&
  isStoredRegister(value["register"]);

const assertCommand = (command: DeviationOutboxCommand, projectId: string): void => {
  if (!isCommand(command)) throw venueError("COMMAND_INVALID", { reason: "deviation-outbox-command-invalid" });
  if (command.projectId !== undefined && command.projectId !== projectId)
    throw venueError("COMMAND_INVALID", { reason: "deviation-command-project-mismatch" });
};
const assertRegister = (
  register: LivePlanDeviationRegister,
  organizationId: string,
  projectId: string,
  registerId: string,
): void => {
  if (!isLivePlanDeviationRegister(register))
    throw venueError("COMMAND_INVALID", { reason: "deviation-cache-shape-invalid" });
  if (register.projectId !== projectId || register.id !== registerId)
    throw venueError("COMMAND_INVALID", { reason: "deviation-cache-scope-invalid", organizationId });
};

export function createMemoryDeviationPersistenceAdapter(
  initial: MemoryDeviationAdapterInitial = {},
): DeviationPersistenceAdapter {
  const registers = new Map((initial.registers ?? []).map((register) => [register.scopeKey, clone(register)]));
  const outbox = new Map((initial.outbox ?? []).map((entry) => [entry.id, clone(entry)]));
  const recovery = new Map((initial.recovery ?? []).map((entry) => [entry.id, clone(entry)]));
  return Object.freeze({
    kind: "memory",
    async getRegister(key: string) {
      return clone(registers.get(key) ?? null);
    },
    async putRegister(register: StoredDeviationRegister) {
      registers.set(register.scopeKey, clone(register));
      return clone(register);
    },
    async deleteRegister(key: string) {
      registers.delete(key);
    },
    async listOutbox(key: string) {
      return [...outbox.values()].filter((entry) => entry.scopeKey === key).map(clone);
    },
    async putOutboxIfAbsent(entry: DeviationOutboxEntry) {
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
    async putOutbox(entry: DeviationOutboxEntry) {
      outbox.set(entry.id, clone(entry));
      return clone(entry);
    },
    async deleteOutbox(id: string) {
      outbox.delete(id);
    },
    async putRecovery(entry: DeviationRecoveryEntry) {
      recovery.set(entry.id, clone(entry));
      return clone(entry);
    },
    async listRecovery(key: string) {
      return [...recovery.values()].filter((entry) => entry.scopeKey === key).map(clone);
    },
    async clear(key: string) {
      registers.delete(key);
      for (const [id, entry] of outbox) if (entry.scopeKey === key) outbox.delete(id);
    },
  });
}

const requestUnknown = (request: IDBRequest): Promise<unknown> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
const readOptional = async <Value>(
  request: IDBRequest,
  guard: (value: unknown) => value is Value,
  label: string,
): Promise<Value | undefined> => {
  const value = await requestUnknown(request);
  if (value === undefined) return undefined;
  if (!guard(value)) throw venueError("COMMAND_INVALID", { reason: `${label}-invalid` });
  return value;
};
const readArray = async <Value>(
  request: IDBRequest,
  guard: (value: unknown) => value is Value,
  label: string,
): Promise<Value[]> => {
  const value = await requestUnknown(request);
  if (!Array.isArray(value) || !value.every(guard))
    throw venueError("COMMAND_INVALID", { reason: `${label}-invalid` });
  return value;
};
const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });

export function createIndexedDbDeviationPersistenceAdapter({
  indexedDB: indexedDBImpl = globalThis.indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
}: IndexedDbDeviationAdapterOptions = {}): DeviationPersistenceAdapter {
  if (!indexedDBImpl?.open) throw new TypeError("IndexedDB is unavailable");
  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDBImpl.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(REGISTER_STORE))
          database.createObjectStore(REGISTER_STORE, { keyPath: "scopeKey" });
        if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
          const store = database.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
          store.createIndex("clientSequence", ["scopeKey", "command.clientId", "command.clientSequence"], {
            unique: true,
          });
        }
        if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
          const store = database.createObjectStore(RECOVERY_STORE, { keyPath: "id" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
    });
    return databasePromise;
  };
  return Object.freeze({
    kind: "indexeddb",
    async getRegister(key: string) {
      const transaction = (await database()).transaction(REGISTER_STORE, "readonly");
      return clone(
        (await readOptional(transaction.objectStore(REGISTER_STORE).get(key), isStoredRegister, "deviation-register")) ??
          null,
      );
    },
    async putRegister(register: StoredDeviationRegister) {
      const transaction = (await database()).transaction(REGISTER_STORE, "readwrite");
      transaction.objectStore(REGISTER_STORE).put(clone(register));
      await transactionDone(transaction);
      return clone(register);
    },
    async deleteRegister(key: string) {
      const transaction = (await database()).transaction(REGISTER_STORE, "readwrite");
      transaction.objectStore(REGISTER_STORE).delete(key);
      await transactionDone(transaction);
    },
    async listOutbox(key: string) {
      const transaction = (await database()).transaction(OUTBOX_STORE, "readonly");
      return clone(
        await readArray(
          transaction.objectStore(OUTBOX_STORE).index("scopeKey").getAll(key),
          isOutboxEntry,
          "deviation-outbox",
        ),
      );
    },
    async putOutboxIfAbsent(entry: DeviationOutboxEntry) {
      const transaction = (await database()).transaction(OUTBOX_STORE, "readwrite");
      const store = transaction.objectStore(OUTBOX_STORE);
      const existing = await readOptional(store.get(entry.id), isOutboxEntry, "deviation-outbox-entry");
      if (existing) {
        await transactionDone(transaction);
        return { inserted: false, entry: clone(existing) };
      }
      const sequenceConflict = await readOptional(
        store.index("clientSequence").get([entry.scopeKey, entry.command.clientId, entry.command.clientSequence]),
        isOutboxEntry,
        "deviation-outbox-entry",
      );
      if (sequenceConflict) {
        await transactionDone(transaction);
        return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      }
      store.add(clone(entry));
      await transactionDone(transaction);
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry: DeviationOutboxEntry) {
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
    async putRecovery(entry: DeviationRecoveryEntry) {
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
          isRecovery,
          "deviation-recovery",
        ),
      );
    },
    async clear(key: string) {
      const transaction = (await database()).transaction([REGISTER_STORE, OUTBOX_STORE], "readwrite");
      transaction.objectStore(REGISTER_STORE).delete(key);
      const store = transaction.objectStore(OUTBOX_STORE);
      const entries = await readArray(store.index("scopeKey").getAll(key), isOutboxEntry, "deviation-outbox");
      for (const entry of entries) store.delete(entry.id);
      await transactionDone(transaction);
    },
  });
}

const defaultAdapter = (options: IndexedDbDeviationAdapterOptions): DeviationPersistenceAdapter => {
  try {
    return createIndexedDbDeviationPersistenceAdapter(options);
  } catch {
    return createMemoryDeviationPersistenceAdapter();
  }
};

export function createDeviationStore({
  organizationId,
  projectId,
  registerId,
  adapter,
  indexedDB,
  databaseName,
  clock = () => new Date().toISOString(),
}: DeviationStoreOptions = {}) {
  if (!isNonEmptyString(organizationId) || !isNonEmptyString(projectId) || !isNonEmptyString(registerId))
    throw new TypeError("Deviation store requires Organization, Project, and Deviation Register IDs");
  const persistence =
    adapter ??
    defaultAdapter({
      ...(indexedDB !== undefined ? { indexedDB } : {}),
      ...(databaseName !== undefined ? { databaseName } : {}),
    });
  const key = scopeKey(organizationId, projectId, registerId);
  const listOutbox = async (): Promise<DeviationOutboxEntry[]> =>
    (await persistence.listOutbox(key)).sort(compareOutbox);
  const persistRegister = async (
    register: LivePlanDeviationRegister,
    authoritative: boolean,
  ): Promise<LivePlanDeviationRegister> => {
    assertRegister(register, organizationId, projectId, registerId);
    const current = await persistence.getRegister(key);
    if (!authoritative && current && current.revision > register.revision) {
      const { scopeKey: _scopeKey, organizationId: _organizationId, ...retained } = current;
      return clone(retained);
    }
    await persistence.putRegister({ ...clone(register), scopeKey: key, organizationId });
    return clone(register);
  };
  return Object.freeze({
    persistenceKind: persistence.kind ?? "custom",
    async hydrate() {
      const [stored, outbox] = await Promise.all([persistence.getRegister(key), listOutbox()]);
      if (!stored) return { source: "local" as const, register: null, outbox, recovery: null };
      const { scopeKey: _scopeKey, organizationId: _organizationId, ...register } = stored;
      try {
        assertRegister(register, organizationId, projectId, registerId);
      } catch {
        const quarantinedAt = clock();
        const recovery: DeviationRecoveryEntry = {
          id: `${key}::${encodeURIComponent(quarantinedAt)}`,
          schemaVersion: 1,
          scopeKey: key,
          code: "DEVIATION_CACHE_INVALID",
          quarantinedAt,
          register: clone(stored),
        };
        await persistence.putRecovery(recovery);
        await persistence.deleteRegister(key);
        return {
          source: "local" as const,
          register: null,
          outbox,
          recovery: { id: recovery.id, code: recovery.code, quarantinedAt },
        };
      }
      return { source: "local" as const, register: clone(register), outbox, recovery: null };
    },
    async saveRegister(register: LivePlanDeviationRegister, options: { readonly authoritative?: boolean } = {}) {
      return persistRegister(register, options.authoritative === true);
    },
    async enqueue(command: DeviationOutboxCommand) {
      assertCommand(command, projectId);
      const normalized = clone(command);
      const inputFingerprint = commandFingerprint(normalized);
      const entry: DeviationOutboxEntry = {
        id: outboxId(key, normalized.idempotencyKey),
        schemaVersion: 1,
        scopeKey: key,
        organizationId,
        projectId,
        registerId,
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
          reason: "deviation-client-sequence-conflict",
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
      const requested = new Set(idempotencyKeys);
      const attemptedAt = clock();
      const updated: DeviationOutboxEntry[] = [];
      for (const entry of await listOutbox()) {
        if (!requested.has(entry.idempotencyKey)) continue;
        const next: DeviationOutboxEntry = {
          ...entry,
          attempts: entry.attempts + 1,
          lastAttemptAt: attemptedAt,
        };
        await persistence.putOutbox(next);
        updated.push(clone(next));
      }
      return updated;
    },
    async acknowledge(acknowledgements: readonly DeviationAcknowledgement[]) {
      const entries = await listOutbox();
      const byKey = new Map(entries.map((entry) => [entry.idempotencyKey, entry]));
      const summary: { removed: string[]; retained: string[]; ignored: (string | null)[] } = {
        removed: [],
        retained: [],
        ignored: [],
      };
      for (const acknowledgement of acknowledgements) {
        if (!isAcknowledgement(acknowledgement)) {
          summary.ignored.push(null);
          continue;
        }
        const entry = byKey.get(acknowledgement.idempotencyKey);
        if (!entry) {
          summary.ignored.push(acknowledgement.idempotencyKey);
          continue;
        }
        if (REMOVABLE_STATUSES.has(acknowledgement.status)) {
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
      return summary;
    },
    async discardConflicts() {
      const removed: string[] = [];
      for (const entry of await listOutbox()) {
        if (!RETAINED_STATUSES.has(entry.syncStatus)) continue;
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

export type DeviationStore = ReturnType<typeof createDeviationStore>;
