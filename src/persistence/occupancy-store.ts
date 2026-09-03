import { stableFingerprint } from "../domain/activity-ledger.ts";
import { venueError } from "../domain/errors.ts";
import type { LiveOccupancyMonitor, OccupancyMutationCommand } from "../domain/operational-types.ts";

export type OccupancyOutboxCommand = OccupancyMutationCommand &
  Readonly<{
    operationId: string;
    correlationId: string;
    clientId: string;
    clientSequence: number;
    clientOccurredAt: string;
  }>;
export type OccupancyAcknowledgementStatus = "applied" | "already-applied" | "conflict" | "rejected";
export interface OccupancyAcknowledgement {
  readonly idempotencyKey: string;
  readonly operationId?: string | null;
  readonly status: OccupancyAcknowledgementStatus;
  readonly code?: string;
  readonly message?: string;
  readonly details?: object;
}
export interface OccupancyOutboxEntry {
  readonly schemaVersion: 1;
  readonly idempotencyKey: string;
  readonly operationId: string;
  readonly inputFingerprint: string;
  readonly command: OccupancyOutboxCommand;
  readonly enqueuedAt: string;
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
  readonly lastResult: OccupancyAcknowledgement | null;
}
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface OccupancyStoreOptions {
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly storage?: StorageLike;
  readonly clock?: () => string;
}

const memoryValues = new Map<string, string>();
const memoryStorage: StorageLike = Object.freeze({
  getItem(key: string) {
    return memoryValues.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    memoryValues.set(key, value);
  },
  removeItem(key: string) {
    memoryValues.delete(key);
  },
});
const clone = <T>(value: T): T => (value == null ? value : structuredClone(value));
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isMonitor = (value: unknown): value is LiveOccupancyMonitor =>
  isObject(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["runbookVersionId"] === "string" &&
  typeof value["revision"] === "number" &&
  typeof value["updatedAt"] === "string";
const isOutboxCommand = (value: unknown): value is OccupancyOutboxCommand => {
  if (
    !isObject(value) ||
    !["ingest_occupancy_signal", "refresh_live_occupancy", "acknowledge_occupancy_alert"].includes(
      String(value["type"]),
    ) ||
    typeof value["idempotencyKey"] !== "string" ||
    typeof value["operationId"] !== "string" ||
    typeof value["expectedRevision"] !== "number"
  )
    return false;
  if (value["type"] === "ingest_occupancy_signal") return isObject(value["signal"]);
  if (value["type"] === "acknowledge_occupancy_alert")
    return typeof value["alertId"] === "string" && typeof value["reasonCode"] === "string";
  return value["type"] === "refresh_live_occupancy";
};
const isAcknowledgement = (value: unknown): value is OccupancyAcknowledgement =>
  isObject(value) &&
  typeof value["idempotencyKey"] === "string" &&
  (value["operationId"] === undefined || typeof value["operationId"] === "string" || value["operationId"] === null) &&
  ["applied", "already-applied", "conflict", "rejected"].includes(String(value["status"]));
const isOutboxEntry = (value: unknown): value is OccupancyOutboxEntry =>
  isObject(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["idempotencyKey"] === "string" &&
  typeof value["operationId"] === "string" &&
  typeof value["inputFingerprint"] === "string" &&
  isOutboxCommand(value["command"]) &&
  typeof value["enqueuedAt"] === "string" &&
  typeof value["attempts"] === "number" &&
  (value["lastAttemptAt"] === null || typeof value["lastAttemptAt"] === "string") &&
  (value["lastResult"] === null || isAcknowledgement(value["lastResult"]));
const parseStored = (value: string | null): unknown => {
  try {
    const parsed: unknown = value ? JSON.parse(value) : null;
    return parsed;
  } catch {
    return null;
  }
};
const commandFingerprint = (command: OccupancyOutboxCommand) =>
  stableFingerprint(
    "occupancy-outbox-command",
    Object.fromEntries(Object.entries(command).filter(([key]) => !["correlationId", "operationId"].includes(key))),
  );

export function createOccupancyStore({
  organizationId,
  projectId,
  storage = globalThis.localStorage ?? memoryStorage,
  clock = () => new Date().toISOString(),
}: OccupancyStoreOptions = {}) {
  if (!organizationId?.trim() || !projectId?.trim())
    throw new TypeError("Live Occupancy store requires Organization and Project IDs");
  const root = `venuemind:occupancy:${encodeURIComponent(organizationId)}:${encodeURIComponent(projectId)}`;
  const monitorKey = `${root}:monitor`;
  const outboxKey = `${root}:outbox`;
  const readMonitor = (): LiveOccupancyMonitor | null => {
    const parsed = parseStored(storage.getItem(monitorKey));
    return isMonitor(parsed) ? parsed : null;
  };
  const readOutbox = (): OccupancyOutboxEntry[] => {
    const parsed = parseStored(storage.getItem(outboxKey));
    return Array.isArray(parsed) && parsed.every(isOutboxEntry)
      ? [...parsed].sort(
          (left, right) =>
            left.enqueuedAt.localeCompare(right.enqueuedAt) || left.idempotencyKey.localeCompare(right.idempotencyKey),
        )
      : [];
  };
  const writeOutbox = (entries: readonly OccupancyOutboxEntry[]) => {
    storage.setItem(outboxKey, JSON.stringify(entries));
  };

  return Object.freeze({
    async load() {
      return { monitor: clone(readMonitor()), outbox: clone(readOutbox()) };
    },
    async saveMonitor(monitor: LiveOccupancyMonitor) {
      if (
        !monitor.id ||
        monitor.projectId !== projectId ||
        !Number.isSafeInteger(monitor.revision) ||
        monitor.revision < 0
      )
        throw venueError("COMMAND_INVALID", { reason: "occupancy-cache-invalid" });
      const current = readMonitor();
      if (current && current.id === monitor.id && current.revision > monitor.revision) return clone(current);
      storage.setItem(monitorKey, JSON.stringify(monitor));
      return clone(monitor);
    },
    async enqueue(command: OccupancyOutboxCommand) {
      if (!command.type || !command.idempotencyKey || !command.operationId)
        throw venueError("COMMAND_INVALID", { reason: "occupancy-command-invalid" });
      const entries = readOutbox();
      const fingerprint = commandFingerprint(command);
      const existing = entries.find((entry) => entry.idempotencyKey === command.idempotencyKey);
      if (existing) {
        if (existing.inputFingerprint !== fingerprint)
          throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
        return clone(existing);
      }
      const entry: OccupancyOutboxEntry = {
        schemaVersion: 1,
        idempotencyKey: command.idempotencyKey,
        operationId: command.operationId,
        inputFingerprint: fingerprint,
        command: clone(command),
        enqueuedAt: clock(),
        attempts: 0,
        lastAttemptAt: null,
        lastResult: null,
      };
      writeOutbox([...entries, entry]);
      return clone(entry);
    },
    async listOutbox() {
      return clone(readOutbox());
    },
    async markAttempted(idempotencyKeys: readonly string[]) {
      const keys = new Set(idempotencyKeys);
      const at = clock();
      const next = readOutbox().map((entry) =>
        keys.has(entry.idempotencyKey) ? { ...entry, attempts: entry.attempts + 1, lastAttemptAt: at } : entry,
      );
      writeOutbox(next);
      return clone(next.filter((entry) => keys.has(entry.idempotencyKey)));
    },
    async acknowledge(acknowledgements: readonly OccupancyAcknowledgement[]) {
      const byKey = new Map(acknowledgements.map((item) => [item.idempotencyKey, item]));
      const removed: string[] = [];
      const retained: string[] = [];
      const next: OccupancyOutboxEntry[] = [];
      for (const entry of readOutbox()) {
        const acknowledgement = byKey.get(entry.idempotencyKey);
        if (acknowledgement?.status === "applied" || acknowledgement?.status === "already-applied") {
          removed.push(entry.idempotencyKey);
          continue;
        }
        const updated = acknowledgement ? { ...entry, lastResult: clone(acknowledgement) } : entry;
        next.push(updated);
        if (acknowledgement) retained.push(entry.idempotencyKey);
      }
      writeOutbox(next);
      return { removed, retained };
    },
    async clear() {
      storage.removeItem(monitorKey);
      storage.removeItem(outboxKey);
    },
  });
}

export type OccupancyStore = ReturnType<typeof createOccupancyStore>;
