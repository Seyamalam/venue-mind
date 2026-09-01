import { stableFingerprint } from "../domain/activity-ledger.js";
import { venueError } from "../domain/errors.js";

const DEFAULT_DATABASE_NAME = "venuemind-runbooks";
const DATABASE_VERSION = 1;
const RUNBOOK_STORE = "runbooks";
const OUTBOX_STORE = "outbox";
const REMOVABLE_ACK_STATUSES = new Set(["applied", "already-applied"]);
const RETAINED_ACK_STATUSES = new Set(["conflict", "rejected"]);

const clone = (value) => value === undefined ? undefined : structuredClone(value);

const outboxId = (runbookVersionId, idempotencyKey) => `${encodeURIComponent(runbookVersionId)}::${encodeURIComponent(idempotencyKey)}`;

const commandFingerprint = (command) => {
  const semantic = Object.fromEntries(Object.entries(command).filter(([key]) => !["correlationId", "idempotencyKey"].includes(key)));
  return stableFingerprint("runbook-outbox-command", semantic);
};

const compareOutboxEntries = (left, right) => left.command.clientId.localeCompare(right.command.clientId)
  || left.command.clientSequence - right.command.clientSequence
  || left.command.idempotencyKey.localeCompare(right.command.idempotencyKey);

const assertCommand = (command) => {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw venueError("COMMAND_INVALID", { reason: "runbook-command-invalid" });
  for (const field of ["runbookVersionId", "idempotencyKey", "operationId", "clientId"]) {
    if (typeof command[field] !== "string" || !command[field].trim()) throw venueError("COMMAND_INVALID", { reason: "runbook-command-field-required", field });
  }
  if (!Number.isSafeInteger(command.clientSequence) || command.clientSequence < 1) throw venueError("COMMAND_INVALID", { reason: "runbook-client-sequence-invalid", clientSequence: command.clientSequence ?? null });
};

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
});

const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
});

export function createMemoryRunbookPersistenceAdapter(initial = {}) {
  const runbooks = new Map((initial.runbooks ?? []).map((runbook) => [runbook.versionId, clone(runbook)]));
  const outbox = new Map((initial.outbox ?? []).map((entry) => [entry.id, clone(entry)]));

  return Object.freeze({
    kind: "memory",
    async getRunbook(runbookVersionId) {
      return clone(runbooks.get(runbookVersionId) ?? null);
    },
    async listRunbooks(projectId) {
      return [...runbooks.values()].filter((runbook) => runbook.source?.projectId === projectId).map(clone);
    },
    async putRunbook(runbook) {
      runbooks.set(runbook.versionId, clone(runbook));
      return clone(runbook);
    },
    async listOutbox(runbookVersionId) {
      return [...outbox.values()].filter((entry) => entry.runbookVersionId === runbookVersionId).map(clone);
    },
    async putOutboxIfAbsent(entry) {
      const existing = outbox.get(entry.id);
      if (existing) return { inserted: false, entry: clone(existing) };
      const sequenceConflict = [...outbox.values()].find((candidate) => candidate.runbookVersionId === entry.runbookVersionId
        && candidate.command.clientId === entry.command.clientId
        && candidate.command.clientSequence === entry.command.clientSequence);
      if (sequenceConflict) return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      outbox.set(entry.id, clone(entry));
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry) {
      outbox.set(entry.id, clone(entry));
      return clone(entry);
    },
    async deleteOutbox(id) {
      outbox.delete(id);
    },
  });
}

export function createIndexedDbRunbookPersistenceAdapter({ indexedDB: indexedDBImpl = globalThis.indexedDB, databaseName = DEFAULT_DATABASE_NAME } = {}) {
  if (!indexedDBImpl?.open) throw new TypeError("IndexedDB is unavailable");
  let databasePromise = null;
  const database = () => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
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
    async getRunbook(runbookVersionId) {
      const db = await database();
      const transaction = db.transaction(RUNBOOK_STORE, "readonly");
      return clone((await requestResult(transaction.objectStore(RUNBOOK_STORE).get(runbookVersionId))) ?? null);
    },
    async listRunbooks(projectId) {
      const db = await database();
      const transaction = db.transaction(RUNBOOK_STORE, "readonly");
      const values = await requestResult(transaction.objectStore(RUNBOOK_STORE).getAll());
      return values.filter((runbook) => runbook.source?.projectId === projectId).map(clone);
    },
    async putRunbook(runbook) {
      const db = await database();
      const transaction = db.transaction(RUNBOOK_STORE, "readwrite");
      transaction.objectStore(RUNBOOK_STORE).put(clone(runbook));
      await transactionDone(transaction);
      return clone(runbook);
    },
    async listOutbox(runbookVersionId) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readonly");
      const values = await requestResult(transaction.objectStore(OUTBOX_STORE).getAll());
      return values.filter((entry) => entry.runbookVersionId === runbookVersionId).map(clone);
    },
    async putOutboxIfAbsent(entry) {
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
    async putOutbox(entry) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readwrite");
      transaction.objectStore(OUTBOX_STORE).put(clone(entry));
      await transactionDone(transaction);
      return clone(entry);
    },
    async deleteOutbox(id) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readwrite");
      transaction.objectStore(OUTBOX_STORE).delete(id);
      await transactionDone(transaction);
    },
  });
}

const defaultAdapter = (options) => {
  try {
    return createIndexedDbRunbookPersistenceAdapter(options);
  } catch {
    return createMemoryRunbookPersistenceAdapter();
  }
};

export function createRunbookStore({ adapter, indexedDB, databaseName, clock = () => new Date().toISOString() } = {}) {
  const persistence = adapter ?? defaultAdapter({ indexedDB, databaseName });

  const listOutbox = async (runbookVersionId) => (await persistence.listOutbox(runbookVersionId)).sort(compareOutboxEntries);

  return Object.freeze({
    persistenceKind: persistence.kind ?? "custom",

    async hydrate(runbookVersionId) {
      if (typeof runbookVersionId !== "string" || !runbookVersionId.trim()) throw venueError("COMMAND_INVALID", { reason: "runbook-version-required" });
      const [runbook, outbox] = await Promise.all([persistence.getRunbook(runbookVersionId), listOutbox(runbookVersionId)]);
      return { source: "local", runbook, outbox };
    },

    async hydrateProject(projectId) {
      if (typeof projectId !== "string" || !projectId.trim()) throw venueError("COMMAND_INVALID", { reason: "runbook-project-required" });
      const runbooks = (await persistence.listRunbooks(projectId)).sort((left, right) => String(right.frozenAt).localeCompare(String(left.frozenAt)) || right.version - left.version);
      const runbook = runbooks[0] ?? null;
      return runbook ? { source: "local", runbook, outbox: await listOutbox(runbook.versionId) } : { source: "local", runbook: null, outbox: [] };
    },

    async saveRunbook(runbook) {
      if (!runbook?.versionId || !Number.isSafeInteger(runbook.revision) || runbook.revision < 0) throw venueError("COMMAND_INVALID", { reason: "runbook-cache-invalid" });
      const existing = await persistence.getRunbook(runbook.versionId);
      if (existing && existing.revision > runbook.revision) return clone(existing);
      return persistence.putRunbook(clone(runbook));
    },

    async enqueue(command) {
      assertCommand(command);
      const normalized = clone(command);
      const inputFingerprint = commandFingerprint(normalized);
      const entry = {
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

    async listOutbox(runbookVersionId) {
      return listOutbox(runbookVersionId);
    },

    async markAttempted(runbookVersionId, idempotencyKeys) {
      const keys = new Set(idempotencyKeys ?? []);
      const attemptedAt = clock();
      const entries = await listOutbox(runbookVersionId);
      const updated = [];
      for (const entry of entries) {
        if (!keys.has(entry.idempotencyKey)) continue;
        const next = { ...entry, attempts: entry.attempts + 1, lastAttemptAt: attemptedAt };
        await persistence.putOutbox(next);
        updated.push(clone(next));
      }
      return updated;
    },

    async acknowledge(runbookVersionId, acknowledgements, { runbook = null } = {}) {
      if (!Array.isArray(acknowledgements)) throw venueError("COMMAND_INVALID", { reason: "runbook-acknowledgements-invalid" });
      const entries = await listOutbox(runbookVersionId);
      const byKey = new Map(entries.map((entry) => [entry.idempotencyKey, entry]));
      const summary = { removed: [], retained: [], ignored: [] };
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
        const next = {
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
