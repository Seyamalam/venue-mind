import { stableFingerprint } from "../domain/activity-ledger.js";
import { venueError } from "../domain/errors.js";

const clone = (value) => value === undefined ? undefined : structuredClone(value);
const REMOVABLE_ACK_STATUSES = new Set(["applied", "already-applied"]);
const RETAINED_ACK_STATUSES = new Set(["conflict", "rejected"]);
const DEFAULT_DATABASE_NAME = "venuemind-incidents";
const DATABASE_VERSION = 1;
const STATE_STORE = "incident-state";
const OUTBOX_STORE = "incident-outbox";
const RECOVERY_STORE = "incident-recovery";

const scopeKey = (organizationId, projectId) => `${encodeURIComponent(organizationId)}::${encodeURIComponent(projectId)}`;
const outboxId = (scope, idempotencyKey) => `${scope}::${encodeURIComponent(idempotencyKey)}`;
const commandFingerprint = (command) => stableFingerprint("incident-outbox-command", Object.fromEntries(Object.entries(command).filter(([key]) => !["correlationId", "idempotencyKey"].includes(key))));
const compareOutboxEntries = (left, right) => left.command.clientId.localeCompare(right.command.clientId)
  || left.command.clientSequence - right.command.clientSequence
  || left.idempotencyKey.localeCompare(right.idempotencyKey);

const assertCommand = (command, projectId) => {
  if (!command || typeof command !== "object" || Array.isArray(command)) throw venueError("COMMAND_INVALID", { reason: "incident-command-invalid" });
  for (const field of ["type", "operationId", "idempotencyKey", "clientId"]) {
    if (typeof command[field] !== "string" || !command[field].trim()) throw venueError("COMMAND_INVALID", { reason: "incident-command-field-required", field });
  }
  if (command.projectId !== undefined && command.projectId !== projectId) throw venueError("COMMAND_INVALID", { reason: "incident-command-project-mismatch" });
  if (!Number.isSafeInteger(command.clientSequence) || command.clientSequence < 1) throw venueError("COMMAND_INVALID", { reason: "incident-client-sequence-invalid" });
};

const assertState = (state, organizationId, projectId) => {
  if (!state || typeof state !== "object" || Array.isArray(state)) throw venueError("COMMAND_INVALID", { reason: "incident-cache-invalid" });
  if (state.schemaVersion !== 1 || state.organizationId !== organizationId || state.projectId !== projectId) throw venueError("COMMAND_INVALID", { reason: "incident-cache-scope-invalid" });
  if (!Array.isArray(state.incidents) || !Array.isArray(state.handoffs)) throw venueError("COMMAND_INVALID", { reason: "incident-cache-shape-invalid" });
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) throw venueError("COMMAND_INVALID", { reason: "incident-cache-revision-invalid" });
};

export function createMemoryIncidentPersistenceAdapter(initial = {}) {
  const states = new Map((initial.states ?? []).map((state) => [state.scopeKey, clone(state)]));
  const outbox = new Map((initial.outbox ?? []).map((entry) => [entry.id, clone(entry)]));
  const recovery = new Map((initial.recovery ?? []).map((entry) => [entry.id, clone(entry)]));

  return Object.freeze({
    kind: "memory",
    async getState(key) { return clone(states.get(key) ?? null); },
    async putState(value) { states.set(value.scopeKey, clone(value)); return clone(value); },
    async deleteState(key) { states.delete(key); },
    async listOutbox(key) { return [...outbox.values()].filter((entry) => entry.scopeKey === key).map(clone); },
    async putOutboxIfAbsent(entry) {
      const existing = outbox.get(entry.id);
      if (existing) return { inserted: false, entry: clone(existing) };
      const sequenceConflict = [...outbox.values()].find((candidate) => candidate.scopeKey === entry.scopeKey
        && candidate.command.clientId === entry.command.clientId
        && candidate.command.clientSequence === entry.command.clientSequence);
      if (sequenceConflict) return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      outbox.set(entry.id, clone(entry));
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry) { outbox.set(entry.id, clone(entry)); return clone(entry); },
    async deleteOutbox(id) { outbox.delete(id); },
    async putRecovery(entry) { recovery.set(entry.id, clone(entry)); return clone(entry); },
    async listRecovery(key) { return [...recovery.values()].filter((entry) => entry.scopeKey === key).map(clone); },
    async clear(key) {
      states.delete(key);
      for (const [id, entry] of outbox) if (entry.scopeKey === key) outbox.delete(id);
    },
  });
}

const requestResult = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
});

const transactionDone = (transaction) => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
});

export function createIndexedDbIncidentPersistenceAdapter({ indexedDB: indexedDBImpl = globalThis.indexedDB, databaseName = DEFAULT_DATABASE_NAME } = {}) {
  if (!indexedDBImpl?.open) throw new TypeError("IndexedDB is unavailable");
  let databasePromise = null;
  const database = () => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDBImpl.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STATE_STORE)) db.createObjectStore(STATE_STORE, { keyPath: "scopeKey" });
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          const store = db.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
          store.createIndex("clientSequence", ["scopeKey", "command.clientId", "command.clientSequence"], { unique: true });
        }
        if (!db.objectStoreNames.contains(RECOVERY_STORE)) {
          const store = db.createObjectStore(RECOVERY_STORE, { keyPath: "id" });
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
    async getState(key) {
      const db = await database();
      const transaction = db.transaction(STATE_STORE, "readonly");
      return clone((await requestResult(transaction.objectStore(STATE_STORE).get(key))) ?? null);
    },
    async putState(value) {
      const db = await database();
      const transaction = db.transaction(STATE_STORE, "readwrite");
      transaction.objectStore(STATE_STORE).put(clone(value));
      await transactionDone(transaction);
      return clone(value);
    },
    async deleteState(key) {
      const db = await database();
      const transaction = db.transaction(STATE_STORE, "readwrite");
      transaction.objectStore(STATE_STORE).delete(key);
      await transactionDone(transaction);
    },
    async listOutbox(key) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readonly");
      return clone(await requestResult(transaction.objectStore(OUTBOX_STORE).index("scopeKey").getAll(key)));
    },
    async putOutboxIfAbsent(entry) {
      const db = await database();
      const transaction = db.transaction(OUTBOX_STORE, "readwrite");
      const store = transaction.objectStore(OUTBOX_STORE);
      const existing = await requestResult(store.get(entry.id));
      if (existing) return { inserted: false, entry: clone(existing) };
      const sequenceConflict = await requestResult(store.index("clientSequence").get([entry.scopeKey, entry.command.clientId, entry.command.clientSequence]));
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
    async putRecovery(entry) {
      const db = await database();
      const transaction = db.transaction(RECOVERY_STORE, "readwrite");
      transaction.objectStore(RECOVERY_STORE).put(clone(entry));
      await transactionDone(transaction);
      return clone(entry);
    },
    async listRecovery(key) {
      const db = await database();
      const transaction = db.transaction(RECOVERY_STORE, "readonly");
      return clone(await requestResult(transaction.objectStore(RECOVERY_STORE).index("scopeKey").getAll(key)));
    },
    async clear(key) {
      const db = await database();
      const transaction = db.transaction([STATE_STORE, OUTBOX_STORE], "readwrite");
      transaction.objectStore(STATE_STORE).delete(key);
      const outbox = transaction.objectStore(OUTBOX_STORE);
      const entries = await requestResult(outbox.index("scopeKey").getAll(key));
      for (const entry of entries) outbox.delete(entry.id);
      await transactionDone(transaction);
    },
  });
}

const defaultAdapter = ({ indexedDB, databaseName }) => {
  try {
    return createIndexedDbIncidentPersistenceAdapter({ indexedDB, databaseName });
  } catch {
    return createMemoryIncidentPersistenceAdapter();
  }
};

export function createIncidentStore({ organizationId, projectId, adapter, indexedDB = globalThis.indexedDB, databaseName, clock = () => new Date().toISOString() } = {}) {
  if (typeof organizationId !== "string" || !organizationId.trim() || typeof projectId !== "string" || !projectId.trim()) throw new TypeError("Incident store requires Organization and Project IDs");
  const persistence = adapter ?? defaultAdapter({ indexedDB, databaseName });
  const key = scopeKey(organizationId, projectId);
  const listOutbox = async () => (await persistence.listOutbox(key)).sort(compareOutboxEntries);
  const saveState = async (state) => {
    assertState(state, organizationId, projectId);
    const current = await persistence.getState(key);
    if (current && current.revision > state.revision) {
      const retained = { ...current };
      delete retained.scopeKey;
      return clone(retained);
    }
    await persistence.putState({ ...clone(state), scopeKey: key });
    return clone(state);
  };

  return Object.freeze({
    persistenceKind: persistence.kind ?? "custom",

    async hydrate() {
      const [stored, outbox] = await Promise.all([persistence.getState(key), listOutbox()]);
      if (!stored) return { source: "local", state: null, register: null, incidents: [], handoffs: [], outbox, recovery: null };
      const state = { ...stored };
      delete state.scopeKey;
      try {
        assertState(state, organizationId, projectId);
      } catch {
        const quarantinedAt = clock();
        const recovery = {
          id: `${key}::${encodeURIComponent(quarantinedAt)}`,
          scopeKey: key,
          schemaVersion: 1,
          code: "INCIDENT_CACHE_INVALID",
          quarantinedAt,
          state: clone(stored),
        };
        await persistence.putRecovery(recovery);
        await persistence.deleteState(key);
        return { source: "local", state: null, register: null, incidents: [], handoffs: [], outbox, recovery: { id: recovery.id, code: recovery.code, quarantinedAt } };
      }
      const register = { ...clone(state) };
      delete register.organizationId;
      delete register.handoffs;
      return { source: "local", state: clone(state), register, incidents: clone(state.incidents), handoffs: clone(state.handoffs), outbox, recovery: null };
    },

    saveState,

    async saveRegister(register) {
      if (!register || typeof register !== "object" || Array.isArray(register) || register.schemaVersion !== 1 || register.projectId !== projectId || !Array.isArray(register.incidents)) {
        throw venueError("COMMAND_INVALID", { reason: "incident-register-cache-invalid" });
      }
      const handoffs = register.incidents.flatMap((incident) => Array.isArray(incident.handoffs) ? incident.handoffs.map((handoff) => ({ ...handoff, incidentId: incident.id })) : []);
      await saveState({ ...clone(register), organizationId, handoffs });
      return clone(register);
    },

    async enqueue(command) {
      assertCommand(command, projectId);
      const normalized = clone(command);
      const inputFingerprint = commandFingerprint(normalized);
      const entry = {
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
      if (stored.sequenceConflict) throw venueError("COMMAND_INVALID", { reason: "incident-client-sequence-conflict", clientId: normalized.clientId, clientSequence: normalized.clientSequence, existingIdempotencyKey: stored.sequenceConflict.idempotencyKey });
      if (!stored.inserted) {
        if (stored.entry.inputFingerprint !== inputFingerprint) throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: normalized.idempotencyKey, commandType: normalized.type });
        return clone(stored.entry);
      }
      return clone(entry);
    },

    async listOutbox() { return listOutbox(); },

    async markAttempted(idempotencyKeys) {
      const keys = new Set(idempotencyKeys ?? []);
      const attemptedAt = clock();
      const updated = [];
      for (const entry of await listOutbox()) {
        if (!keys.has(entry.idempotencyKey)) continue;
        const next = { ...entry, attempts: entry.attempts + 1, lastAttemptAt: attemptedAt };
        await persistence.putOutbox(next);
        updated.push(clone(next));
      }
      return updated;
    },

    async acknowledge(acknowledgements, { state = null } = {}) {
      if (!Array.isArray(acknowledgements)) throw venueError("COMMAND_INVALID", { reason: "incident-acknowledgements-invalid" });
      const entries = await listOutbox();
      const byKey = new Map(entries.map((entry) => [entry.idempotencyKey, entry]));
      const summary = { removed: [], retained: [], ignored: [] };
      for (const acknowledgement of acknowledgements) {
        const entry = byKey.get(acknowledgement?.idempotencyKey);
        if (!entry) { summary.ignored.push(acknowledgement?.idempotencyKey ?? null); continue; }
        if (REMOVABLE_ACK_STATUSES.has(acknowledgement.status)) {
          await persistence.deleteOutbox(entry.id);
          summary.removed.push(entry.idempotencyKey);
          continue;
        }
        if (!RETAINED_ACK_STATUSES.has(acknowledgement.status)) { summary.ignored.push(entry.idempotencyKey); continue; }
        await persistence.putOutbox({ ...entry, syncStatus: acknowledgement.status, lastResult: clone(acknowledgement) });
        summary.retained.push(entry.idempotencyKey);
      }
      if (state) await saveState(state);
      return summary;
    },

    async clear() { await persistence.clear(key); },
  });
}
