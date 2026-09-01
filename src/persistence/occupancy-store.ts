import { stableFingerprint } from "../domain/activity-ledger.ts";
import { venueError } from "../domain/errors.ts";

const memoryValues: any = new Map();
const memoryStorage = Object.freeze({ getItem: (key: any) => memoryValues.get(key) ?? null, setItem: (key: any, value: any) => memoryValues.set(key, value), removeItem: (key: any) => memoryValues.delete(key) });
const clone = (value: any) => value == null ? value : structuredClone(value);
const safeParse = (value: any, fallback: any) => {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
};
const commandFingerprint = (command: any) => stableFingerprint("occupancy-outbox-command", Object.fromEntries(Object.entries(command).filter(([key]: any) => !["correlationId", "operationId"].includes(key))));

export function createOccupancyStore({ organizationId, projectId, storage = globalThis.localStorage ?? memoryStorage, clock = () => new Date().toISOString() }: any = {}) {
  if (!organizationId?.trim() || !projectId?.trim()) throw new TypeError("Live Occupancy store requires Organization and Project IDs");
  const root = `venuemind:occupancy:${encodeURIComponent(organizationId)}:${encodeURIComponent(projectId)}`;
  const monitorKey = `${root}:monitor`;
  const outboxKey = `${root}:outbox`;
  const readMonitor = () => safeParse(storage.getItem(monitorKey), null);
  const readOutbox = () => safeParse(storage.getItem(outboxKey), []).sort((left: any, right: any) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.idempotencyKey.localeCompare(right.idempotencyKey));
  const writeOutbox = (entries: any) => storage.setItem(outboxKey, JSON.stringify(entries));

  return Object.freeze({
    async load() { return { monitor: clone(readMonitor()), outbox: clone(readOutbox()) }; },
    async saveMonitor(monitor: any) {
      if (!monitor?.id || monitor.projectId !== projectId || !Number.isSafeInteger(monitor.revision) || monitor.revision < 0) throw venueError("COMMAND_INVALID", { reason: "occupancy-cache-invalid" });
      const current = readMonitor();
      if (current && current.id === monitor.id && current.revision > monitor.revision) return clone(current);
      storage.setItem(monitorKey, JSON.stringify(monitor));
      return clone(monitor);
    },
    async enqueue(command: any) {
      if (!command?.type || !command.idempotencyKey || !command.operationId) throw venueError("COMMAND_INVALID", { reason: "occupancy-command-invalid" });
      const entries = readOutbox();
      const fingerprint = commandFingerprint(command);
      const existing = entries.find((entry: any) => entry.idempotencyKey === command.idempotencyKey);
      if (existing) {
        if (existing.inputFingerprint !== fingerprint) throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
        return clone(existing);
      }
      const entry: any = { schemaVersion: 1, idempotencyKey: command.idempotencyKey, operationId: command.operationId, inputFingerprint: fingerprint, command: clone(command), enqueuedAt: clock(), attempts: 0, lastAttemptAt: null, lastResult: null };
      writeOutbox([...entries, entry]);
      return clone(entry);
    },
    async listOutbox() { return clone(readOutbox()); },
    async markAttempted(idempotencyKeys: any) {
      const keys: any = new Set(idempotencyKeys);
      const at = clock();
      const next = readOutbox().map((entry: any) => keys.has(entry.idempotencyKey) ? { ...entry, attempts: entry.attempts + 1, lastAttemptAt: at } : entry);
      writeOutbox(next);
      return clone(next.filter((entry: any) => keys.has(entry.idempotencyKey)));
    },
    async acknowledge(acknowledgements: any) {
      const byKey: any = new Map((acknowledgements ?? []).map((item: any) => [item.idempotencyKey, item]));
      const removed: any = [];
      const retained: any = [];
      const next: any = [];
      for (const entry of readOutbox()) {
        const acknowledgement = byKey.get(entry.idempotencyKey);
        if (["applied", "already-applied"].includes(acknowledgement?.status)) { removed.push(entry.idempotencyKey); continue; }
        const updated = acknowledgement ? { ...entry, lastResult: clone(acknowledgement) } : entry;
        next.push(updated);
        if (acknowledgement) retained.push(entry.idempotencyKey);
      }
      writeOutbox(next);
      return { removed, retained };
    },
    async clear() { storage.removeItem(monitorKey); storage.removeItem(outboxKey); },
  });
}
