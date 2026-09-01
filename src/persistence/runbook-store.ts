import { stableFingerprint } from "../domain/activity-ledger.ts";
import { venueError } from "../domain/errors.ts";

const DEFAULT_DATABASE_NAME = "venuemind-runbooks";
const DATABASE_VERSION = 1;
const RUNBOOK_STORE = "runbooks";
const OUTBOX_STORE = "outbox";
const REMOVABLE_ACK_STATUSES: any = new Set(["applied", "already-applied"]);
const RETAINED_ACK_STATUSES: any = new Set(["conflict", "rejected"]);

const clone = (value: any) => value === undefined ? undefined : structuredClone(value);

const outboxId = (runbookVersionId: any, idempotencyKey: any) => `${encodeURIComponent(runbookVersionId)}::${encodeURIComponent(idempotencyKey)}`;

const commandFingerprint = (command: any) => {
  const semantic = Object.fromEntries(Object.entries(command).filter(([key]: any) => !["correlationId", "idempotencyKey"].includes(key)));
  return stableFingerprint("runbook-outbox-command", semantic);
};

const compareOutboxEntries = (left: any, right: any) => left.command.clientId.localeCompare(right.command.clientId)
  || left.command.clientSequence - right.command.clientSequence
  || left.command.idempotencyKey.localeCompare(right.command.idempotencyKey);

const assertCommand = (command: any) => {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw venueError("COMMAND_INVALID", { reason: "runbook-command-invalid" });
  for (const field of ["runbookVersionId", "idempotencyKey", "operationId", "clientId"]) {
    if (typeof command[field] !== "string" || !command[field].trim()) throw venueError("COMMAND_INVALID", { reason: "runbook-command-field-required", field });
  }
  if (!Number.isSafeInteger(command.clientSequence) || command.clientSequence < 1) throw venueError("COMMAND_INVALID", { reason: "runbook-client-sequence-invalid", clientSequence: command.clientSequence ?? null });
};

const requestResult = (request: any): Promise<any> => new Promise((resolve: any, reject: any) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
});

const transactionDone = (transaction: any): Promise<void> => new Promise((resolve: any, reject: any) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
});

export function createMemoryRunbookPersistenceAdapter(initial: any = {}) {
  const runbooks: any = new Map((initial.runbooks ?? []).map((runbook: any) => [runbook.versionId, clone(runbook)]));
  const outbox: any = new Map((initial.outbox ?? []).map((entry: any) => [entry.id, clone(entry)]));

  return Object.freeze({
    kind: "memory",
    async getRunbook(runbookVersionId: any) {
      return clone(runbooks.get(runbookVersionId) ?? null);
    },
    async listRunbooks(projectId: any) {
      return [...runbooks.values()].filter((runbook: any) => runbook.source?.projectId === projectId).map(clone);
    },
    async putRunbook(runbook: any) {
      runbooks.set(runbook.versionId, clone(runbook));
      return clone(runbook);
    },
    async listOutbox(runbookVersionId: any) {
      return [...outbox.values()].filter((entry: any) => entry.runbookVersionId === runbookVersionId).map(clone);
    },
    async putOutboxIfAbsent(entry: any) {
      const existing = outbox.get(entry.id);
      if (existing) return { inserted: false, entry: clone(existing) };
      const sequenceConflict = [...outbox.values()].find((candidate: any) => candidate.runbookVersionId === entry.runbookVersionId
        && candidate.command.clientId === entry.command.clientId
        && candidate.command.clientSequence === entry.command.clientSequence);
      if (sequenceConflict) return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      outbox.set(entry.id, clone(entry));
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry: any) {
      outbox.set(entry.id, clone(entry));
      return clone(entry);
    },
    async deleteOutbox(id: any) {
      outbox.delete(id);
    },
  });
}

export function createIndexedDbRunbookPersistenceAdapter({ indexedDB: indexedDBImpl = globalThis.indexedDB, databaseName = DEFAULT_DATABASE_NAME }: any = {}) {
  if (!indexedDBImpl?.open) throw new TypeError("IndexedDB is unavailable");
  let databasePromise: any = null;
  const database = () => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve: any, reject: any) => {
      const request = indexedDBImpl.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RUNBOOK_STORE)) db.createObjectStore(RUNBOOK_STORE, { keyPath: "versionId" });
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
          store.createIndex("runbookVersionId", "runbookVersionId", { unique: false });
          store.createIndex("clientSequence", ["runbookVersionId", "command.clientId", "command.clientSequence"], { unique: true });
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
    async getRunbook(runbookVersionId: any) {
      const db = await database();
      const transaction = db.transaction(RUNBOOK_STORE, "readonly");
      return clone((await requestResult(transaction.objectStore(RUNBOOK_STORE).get(runbookVersionId))) ?? null);
    },
    async listRunbooks(projectId: any) {
      const db = await database();
      const transaction = db.transaction(RUNBOOK_STORE, "readonly");
      const values = await requestResult(transaction.objectStore(RUNBOOK_STORE).getAll());
      return values.filter((runbook: any) => runbook.source?.projectId === projectId).map(clone);
    },
    async putRunbook(runbook: any) {
      const db = await database();
      const transaction = db.transaction(RUNBOOK_STORE, "readwrite");
      transaction.objectStore(RUNBOOK_STORE).put(clone(runbook));
      await transactionDone(transaction);
      return clone(runbook);
    },
    async listOutbox(runbookVersionId: any) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readonly");
      const values = await requestResult(transaction.objectStore(OUTBOX_STORE).getAll());
      return values.filter((entry: any) => entry.runbookVersionId === runbookVersionId).map(clone);
    },
    async putOutboxIfAbsent(entry: any) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readwrite");
      const store = transaction.objectStore(OUTBOX_STORE);
      const existing = await requestResult(store.get(entry.id));
      if (existing) return { inserted: false, entry: clone(existing) };
      const sequenceConflict = await requestResult(store.index("clientSequence").get([entry.runbookVersionId, entry.command.clientId, entry.command.clientSequence]));
      if (sequenceConflict) return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      store.add(clone(entry));
      await transactionDone(transaction);
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry: any) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readwrite");
      transaction.objectStore(OUTBOX_STORE).put(clone(entry));
      await transactionDone(transaction);
      return clone(entry);
    },
    async deleteOutbox(id: any) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readwrite");
      transaction.objectStore(OUTBOX_STORE).delete(id);
      await transactionDone(transaction);
    },
  });
}

const defaultAdapter = (options: any) => {
  try {
    return createIndexedDbRunbookPersistenceAdapter(options);
  } catch {
    return createMemoryRunbookPersistenceAdapter();
  }
};

export function createRunbookStore({ adapter, indexedDB, databaseName, clock = () => new Date().toISOString() }: any = {}) {
  const persistence = adapter ?? defaultAdapter({ indexedDB, databaseName });

  const listOutbox = async (runbookVersionId: any) => (await persistence.listOutbox(runbookVersionId)).sort(compareOutboxEntries);

  return Object.freeze({
    persistenceKind: persistence.kind ?? "custom",

    async hydrate(runbookVersionId: any) {
      if (typeof runbookVersionId !== "string" || !runbookVersionId.trim()) throw venueError("COMMAND_INVALID", { reason: "runbook-version-required" });
      const [runbook, outbox] = await Promise.all([persistence.getRunbook(runbookVersionId), listOutbox(runbookVersionId)]);
      return { source: "local", runbook, outbox };
    },

    async hydrateProject(projectId: any) {
      if (typeof projectId !== "string" || !projectId.trim()) throw venueError("COMMAND_INVALID", { reason: "runbook-project-required" });
      const runbooks = (await persistence.listRunbooks(projectId)).sort((left: any, right: any) => String(right.frozenAt).localeCompare(String(left.frozenAt)) || right.version - left.version);
      const runbook = runbooks[0] ?? null;
      return runbook ? { source: "local", runbook, outbox: await listOutbox(runbook.versionId) } : { source: "local", runbook: null, outbox: [] };
    },

    async saveRunbook(runbook: any) {
      if (!runbook?.versionId || !Number.isSafeInteger(runbook.revision) || runbook.revision < 0) throw venueError("COMMAND_INVALID", { reason: "runbook-cache-invalid" });
      const existing = await persistence.getRunbook(runbook.versionId);
      if (existing && existing.revision > runbook.revision) return clone(existing);
      return persistence.putRunbook(clone(runbook));
    },

    async enqueue(command: any) {
      assertCommand(command);
      const normalized = clone(command);
      const inputFingerprint = commandFingerprint(normalized);
      const entry: any = {
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
      if (stored.sequenceConflict) throw venueError("COMMAND_INVALID", { reason: "runbook-client-sequence-conflict", clientId: normalized.clientId, clientSequence: normalized.clientSequence, existingIdempotencyKey: stored.sequenceConflict.idempotencyKey });
      if (!stored.inserted) {
        if (stored.entry.inputFingerprint !== inputFingerprint) throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: normalized.idempotencyKey, commandType: normalized.type ?? "runbook-command" });
        return clone(stored.entry);
      }
      return clone(entry);
    },

    async listOutbox(runbookVersionId: any) {
      return listOutbox(runbookVersionId);
    },

    async markAttempted(runbookVersionId: any, idempotencyKeys: any) {
      const keys: any = new Set(idempotencyKeys ?? []);
      const attemptedAt = clock();
      const entries = await listOutbox(runbookVersionId);
      const updated: any = [];
      for (const entry of entries) {
        if (!keys.has(entry.idempotencyKey)) continue;
        const next: any = { ...entry, attempts: entry.attempts + 1, lastAttemptAt: attemptedAt };
        await persistence.putOutbox(next);
        updated.push(clone(next));
      }
      return updated;
    },

    async acknowledge(runbookVersionId: any, acknowledgements: any, { runbook = null }: any = {}) {
      if (!Array.isArray(acknowledgements)) throw venueError("COMMAND_INVALID", { reason: "runbook-acknowledgements-invalid" });
      const entries = await listOutbox(runbookVersionId);
      const byKey: any = new Map(entries.map((entry: any) => [entry.idempotencyKey, entry]));
      const summary: any = { removed: [], retained: [], ignored: [] };
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
        const next: any = {
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
