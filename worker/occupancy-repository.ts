import { applyDatabaseMigrations } from "./database-migrations.ts";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ meta?: { changes?: number }; changes?: number } | unknown>;
};
type D1Database = { prepare: (sql: string) => D1Statement };
type Monitor = Record<string, unknown> & { id: string; runbookVersionId: string; schemaVersion: number; baseline: Record<string, unknown> & { fingerprint: string }; revision: number; ledger: Array<{ hash: string }>; createdAt: string; updatedAt: string };

const initialized = new WeakSet<object>();
const parse = (value: unknown) => JSON.parse(String(value)) as Monitor;
const json = (value: unknown) => JSON.stringify(value);

async function ready(db: D1Database) {
  if (initialized.has(db as object)) return;
  await applyDatabaseMigrations(db as never);
  initialized.add(db as object);
}

export class OccupancyMonitorConflict extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, details: Record<string, unknown> = {}) {
    super(code === "OCCUPANCY_ID_CONFLICT" ? "Live Occupancy monitor conflicts with the stored Runbook baseline" : "Live Occupancy monitor revision conflict");
    this.name = "OccupancyMonitorConflict";
    this.code = code;
    this.details = details;
  }
}

const map = (row: Record<string, unknown> | null) => row ? parse(row.monitor_json) : null;
const changed = (result: unknown) => {
  const value = result as { meta?: { changes?: number }; changes?: number } | null;
  return Number(value?.meta?.changes ?? value?.changes ?? 0);
};

export function createD1OccupancyRepository(db: D1Database) {
  return {
    async create(organizationId: string, projectId: string, monitor: Monitor) {
      await ready(db);
      try {
        await db.prepare("INSERT INTO live_occupancy_monitors (id,organization_id,project_id,runbook_id,schema_version,baseline_fingerprint,baseline_json,monitor_json,revision,ledger_head_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(monitor.id, organizationId, projectId, monitor.runbookVersionId, monitor.schemaVersion, monitor.baseline.fingerprint, json(monitor.baseline), json(monitor), monitor.revision, monitor.ledger.at(-1)?.hash, monitor.createdAt, monitor.updatedAt).run();
        return monitor;
      } catch (cause) {
        const existing = await this.get(organizationId, projectId, monitor.id);
        if (existing && existing.runbookVersionId === monitor.runbookVersionId && (existing.baseline as { fingerprint?: string }).fingerprint === monitor.baseline.fingerprint) return existing;
        if (existing) throw new OccupancyMonitorConflict("OCCUPANCY_ID_CONFLICT", { monitorId: monitor.id });
        throw cause;
      }
    },
    async get(organizationId: string, projectId: string, monitorId: string) {
      await ready(db);
      return map(await db.prepare("SELECT monitor_json FROM live_occupancy_monitors WHERE id=? AND organization_id=? AND project_id=?").bind(monitorId, organizationId, projectId).first<Record<string, unknown>>());
    },
    async getByRunbook(organizationId: string, projectId: string, runbookId: string) {
      await ready(db);
      return map(await db.prepare("SELECT monitor_json FROM live_occupancy_monitors WHERE runbook_id=? AND organization_id=? AND project_id=?").bind(runbookId, organizationId, projectId).first<Record<string, unknown>>());
    },
    async put(organizationId: string, projectId: string, monitor: Monitor, expectedRevision: number) {
      await ready(db);
      const result = await db.prepare("UPDATE live_occupancy_monitors SET monitor_json=?,revision=?,ledger_head_hash=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND revision=?")
        .bind(json(monitor), monitor.revision, monitor.ledger.at(-1)?.hash, monitor.updatedAt, monitor.id, organizationId, projectId, expectedRevision).run();
      if (changed(result) === 0) throw new OccupancyMonitorConflict("OCCUPANCY_REVISION_CONFLICT", { expectedRevision, currentRevision: (await this.get(organizationId, projectId, monitor.id))?.revision ?? null });
      return monitor;
    },
  };
}
