import { applyDatabaseMigrations } from "./database-migrations.ts";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  run: () => Promise<{ meta?: { changes?: number }; changes?: number } | unknown>;
};
type D1Database = { prepare: (sql: string) => D1Statement };
type IncidentRegister = Record<string, unknown> & {
  id: string;
  projectId: string;
  runbookVersionId: string;
  schemaVersion: number;
  baseline: Record<string, unknown> & { fingerprint: string };
  source?: Record<string, unknown> & { runbookLedgerHeadHash?: string };
  revision: number;
  ledger: Array<{ hash: string }>;
  createdAt: string;
  updatedAt: string;
};

const initialized = new WeakSet<object>();
const parse = (value: unknown) => JSON.parse(String(value)) as IncidentRegister;
const json = (value: unknown) => JSON.stringify(value);
const ledgerHeadHash = (register: IncidentRegister) => {
  const value = register.ledger.at(-1)?.hash ?? register.source?.runbookLedgerHeadHash;
  if (typeof value !== "string" || !value) throw new TypeError("Incident Register ledger head hash is required");
  return value;
};

async function ready(db: D1Database) {
  if (initialized.has(db as object)) return;
  await applyDatabaseMigrations(db as never);
  initialized.add(db as object);
}

export class IncidentRegisterConflict extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: "INCIDENT_REGISTER_ID_CONFLICT" | "INCIDENT_REGISTER_REVISION_CONFLICT" | "INCIDENT_REGISTER_BASELINE_IMMUTABLE" | "INCIDENT_REGISTER_SCOPE_INVALID", details: Record<string, unknown> = {}) {
    super(code === "INCIDENT_REGISTER_ID_CONFLICT"
      ? "Incident Register conflicts with the stored Runbook baseline"
      : code === "INCIDENT_REGISTER_SCOPE_INVALID" ? "Incident Register Project scope is invalid"
      : code === "INCIDENT_REGISTER_BASELINE_IMMUTABLE" ? "Incident Register baseline is immutable" : "Incident Register revision conflict");
    this.name = "IncidentRegisterConflict";
    this.code = code;
    this.details = details;
  }
}

const map = (row: Record<string, unknown> | null) => row ? parse(row.register_json) : null;
const changed = (result: unknown) => {
  const value = result as { meta?: { changes?: number }; changes?: number } | null;
  return Number(value?.meta?.changes ?? value?.changes ?? 0);
};

export function createD1IncidentRepository(db: D1Database) {
  const get = async (organizationId: string, projectId: string, registerId: string) => {
    await ready(db);
    return map(await db.prepare("SELECT register_json FROM event_day_incident_registers WHERE id=? AND organization_id=? AND project_id=?").bind(registerId, organizationId, projectId).first<Record<string, unknown>>());
  };
  const getByRunbook = async (organizationId: string, projectId: string, runbookId: string) => {
    await ready(db);
    return map(await db.prepare("SELECT register_json FROM event_day_incident_registers WHERE runbook_id=? AND organization_id=? AND project_id=?").bind(runbookId, organizationId, projectId).first<Record<string, unknown>>());
  };

  return Object.freeze({
    async create(organizationId: string, projectId: string, register: IncidentRegister) {
      await ready(db);
      if (register.projectId !== projectId) throw new IncidentRegisterConflict("INCIDENT_REGISTER_SCOPE_INVALID", { projectId, registerProjectId: register.projectId });
      try {
        await db.prepare("INSERT INTO event_day_incident_registers (id,organization_id,project_id,runbook_id,schema_version,baseline_fingerprint,baseline_json,register_json,revision,ledger_head_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
          .bind(register.id, organizationId, projectId, register.runbookVersionId, register.schemaVersion, register.baseline.fingerprint, json(register.baseline), json(register), register.revision, ledgerHeadHash(register), register.createdAt, register.updatedAt).run();
        return register;
      } catch (cause) {
        const existing = await get(organizationId, projectId, register.id) ?? await getByRunbook(organizationId, projectId, register.runbookVersionId);
        if (existing && existing.id === register.id && existing.runbookVersionId === register.runbookVersionId && existing.baseline.fingerprint === register.baseline.fingerprint) return existing;
        if (existing) throw new IncidentRegisterConflict("INCIDENT_REGISTER_ID_CONFLICT", { registerId: register.id, runbookVersionId: register.runbookVersionId });
        throw cause;
      }
    },
    get,
    getByRunbook,
    async put(organizationId: string, projectId: string, register: IncidentRegister, expectedRevision: number) {
      await ready(db);
      if (register.projectId !== projectId) throw new IncidentRegisterConflict("INCIDENT_REGISTER_SCOPE_INVALID", { projectId, registerProjectId: register.projectId });
      const current = await get(organizationId, projectId, register.id);
      if (current && (current.runbookVersionId !== register.runbookVersionId
        || current.schemaVersion !== register.schemaVersion
        || current.createdAt !== register.createdAt
        || json(current.baseline) !== json(register.baseline))) {
        throw new IncidentRegisterConflict("INCIDENT_REGISTER_BASELINE_IMMUTABLE", { registerId: register.id });
      }
      const result = await db.prepare("UPDATE event_day_incident_registers SET register_json=?,revision=?,ledger_head_hash=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND revision=?")
        .bind(json(register), register.revision, ledgerHeadHash(register), register.updatedAt, register.id, organizationId, projectId, expectedRevision).run();
      if (changed(result) === 0) throw new IncidentRegisterConflict("INCIDENT_REGISTER_REVISION_CONFLICT", { expectedRevision, currentRevision: (await get(organizationId, projectId, register.id))?.revision ?? null });
      return register;
    },
  });
}
