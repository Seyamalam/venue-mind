import { applyDatabaseMigrations } from "./database-migrations.ts";
import type { LiveOccupancyMonitor } from "../src/domain/operational-types.ts";

const initialized = new WeakSet<object>();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isLiveOccupancyMonitor = (value: unknown): value is LiveOccupancyMonitor =>
  isRecord(value) &&
  value.schemaVersion === 1 &&
  typeof value.id === "string" &&
  typeof value.projectId === "string" &&
  typeof value.runbookVersionId === "string" &&
  isRecord(value.source) &&
  isRecord(value.baseline) &&
  typeof value.baseline.fingerprint === "string" &&
  isRecord(value.policy) &&
  Array.isArray(value.feeds) &&
  Array.isArray(value.observations) &&
  Array.isArray(value.activeAlerts) &&
  Array.isArray(value.receipts) &&
  Array.isArray(value.ledger) &&
  typeof value.revision === "number" &&
  typeof value.createdAt === "string" &&
  typeof value.updatedAt === "string";
const parse = (value: unknown): LiveOccupancyMonitor => {
  if (typeof value !== "string") throw new TypeError("Stored Live Occupancy monitor must be JSON text");
  const parsed: unknown = JSON.parse(value);
  if (!isLiveOccupancyMonitor(parsed)) throw new TypeError("Stored Live Occupancy monitor is invalid");
  return parsed;
};
const json = (value: unknown) => JSON.stringify(value);

async function ready(db: D1Database) {
  if (initialized.has(db)) return;
  await applyDatabaseMigrations(db);
  initialized.add(db);
}

export class OccupancyMonitorConflict extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, details: Record<string, unknown> = {}) {
    super(
      code === "OCCUPANCY_ID_CONFLICT"
        ? "Live Occupancy monitor conflicts with the stored Runbook baseline"
        : "Live Occupancy monitor revision conflict",
    );
    this.name = "OccupancyMonitorConflict";
    this.code = code;
    this.details = details;
  }
}

const map = (row: Record<string, unknown> | null) => (row ? parse(row.monitor_json) : null);
const changed = (result: unknown) => {
  if (!isRecord(result)) return 0;
  const meta = isRecord(result.meta) ? result.meta : null;
  const changes = meta?.changes ?? result.changes;
  return typeof changes === "number" ? changes : 0;
};

export function createD1OccupancyRepository(db: D1Database) {
  return {
    async create(organizationId: string, projectId: string, monitor: LiveOccupancyMonitor) {
      await ready(db);
      try {
        await db
          .prepare(
            "INSERT INTO live_occupancy_monitors (id,organization_id,project_id,runbook_id,schema_version,baseline_fingerprint,baseline_json,monitor_json,revision,ledger_head_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            monitor.id,
            organizationId,
            projectId,
            monitor.runbookVersionId,
            monitor.schemaVersion,
            monitor.baseline.fingerprint,
            json(monitor.baseline),
            json(monitor),
            monitor.revision,
            monitor.ledger.at(-1)?.hash,
            monitor.createdAt,
            monitor.updatedAt,
          )
          .run();
        return monitor;
      } catch (cause) {
        const existing = await this.get(organizationId, projectId, monitor.id);
        if (
          existing &&
          existing.runbookVersionId === monitor.runbookVersionId &&
          existing.baseline.fingerprint === monitor.baseline.fingerprint
        )
          return existing;
        if (existing) throw new OccupancyMonitorConflict("OCCUPANCY_ID_CONFLICT", { monitorId: monitor.id });
        throw cause;
      }
    },
    async get(organizationId: string, projectId: string, monitorId: string) {
      await ready(db);
      return map(
        await db
          .prepare("SELECT monitor_json FROM live_occupancy_monitors WHERE id=? AND organization_id=? AND project_id=?")
          .bind(monitorId, organizationId, projectId)
          .first<Record<string, unknown>>(),
      );
    },
    async getByRunbook(organizationId: string, projectId: string, runbookId: string) {
      await ready(db);
      return map(
        await db
          .prepare(
            "SELECT monitor_json FROM live_occupancy_monitors WHERE runbook_id=? AND organization_id=? AND project_id=?",
          )
          .bind(runbookId, organizationId, projectId)
          .first<Record<string, unknown>>(),
      );
    },
    async put(organizationId: string, projectId: string, monitor: LiveOccupancyMonitor, expectedRevision: number) {
      await ready(db);
      const result = await db
        .prepare(
          "UPDATE live_occupancy_monitors SET monitor_json=?,revision=?,ledger_head_hash=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND revision=?",
        )
        .bind(
          json(monitor),
          monitor.revision,
          monitor.ledger.at(-1)?.hash,
          monitor.updatedAt,
          monitor.id,
          organizationId,
          projectId,
          expectedRevision,
        )
        .run();
      if (changed(result) === 0)
        throw new OccupancyMonitorConflict("OCCUPANCY_REVISION_CONFLICT", {
          expectedRevision,
          currentRevision: (await this.get(organizationId, projectId, monitor.id))?.revision ?? null,
        });
      return monitor;
    },
  };
}
