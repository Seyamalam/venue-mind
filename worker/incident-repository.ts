import { applyDatabaseMigrations } from "./database-migrations.ts";
import { verifyIncidentLedger } from "../src/domain/incidents.ts";
import type { IncidentRegister } from "../src/domain/operational-types.ts";

const initialized = new WeakSet<object>();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isIncidentRegister = (value: unknown): value is IncidentRegister =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["runbookVersionId"] === "string" &&
  isRecord(value["baseline"]) &&
  isRecord(value["source"]) &&
  typeof value["revision"] === "number" &&
  Array.isArray(value["incidents"]) &&
  Array.isArray(value["transitions"]) &&
  Array.isArray(value["receipts"]) &&
  Array.isArray(value["ledger"]) &&
  typeof value["createdAt"] === "string" &&
  typeof value["updatedAt"] === "string";
const parse = (value: unknown): IncidentRegister => {
  if (typeof value !== "string") throw new TypeError("Stored Incident Register must be JSON text");
  const parsed: unknown = JSON.parse(value);
  if (!isIncidentRegister(parsed)) throw new TypeError("Stored Incident Register is invalid");
  return parsed;
};
const json = (value: unknown) => JSON.stringify(value);
const ledgerHeadHash = (register: IncidentRegister) => {
  const value = register.ledger.at(-1)?.hash ?? register.source.runbookLedgerHeadHash;
  if (typeof value !== "string" || !value) throw new TypeError("Incident Register ledger head hash is required");
  return value;
};

async function ready(db: D1Database) {
  if (initialized.has(db)) return;
  await applyDatabaseMigrations(db);
  initialized.add(db);
}

export class IncidentRegisterConflict extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(
    code:
      | "INCIDENT_REGISTER_ID_CONFLICT"
      | "INCIDENT_REGISTER_REVISION_CONFLICT"
      | "INCIDENT_REGISTER_BASELINE_IMMUTABLE"
      | "INCIDENT_REGISTER_SCOPE_INVALID"
      | "INCIDENT_REGISTER_INTEGRITY_FAILED",
    details: Record<string, unknown> = {},
  ) {
    super(
      code === "INCIDENT_REGISTER_ID_CONFLICT"
        ? "Incident Register conflicts with the stored Runbook baseline"
        : code === "INCIDENT_REGISTER_SCOPE_INVALID"
          ? "Incident Register Project scope is invalid"
          : code === "INCIDENT_REGISTER_INTEGRITY_FAILED"
            ? "Incident Register integrity verification failed"
            : code === "INCIDENT_REGISTER_BASELINE_IMMUTABLE"
              ? "Incident Register baseline is immutable"
              : "Incident Register revision conflict",
    );
    this.name = "IncidentRegisterConflict";
    this.code = code;
    this.details = details;
  }
}

const assertIntegrity = (register: IncidentRegister, row?: Record<string, unknown>) => {
  const integrity = verifyIncidentLedger(register);
  const rowMismatch =
    row &&
    (register.id !== row.id ||
      register.projectId !== row.project_id ||
      register.runbookVersionId !== row.runbook_id ||
      register.schemaVersion !== Number(row.schema_version) ||
      register.revision !== Number(row.revision) ||
      ledgerHeadHash(register) !== row.ledger_head_hash ||
      register.createdAt !== row.created_at ||
      register.updatedAt !== row.updated_at);
  if (integrity.status !== "pass" || rowMismatch) {
    throw new IncidentRegisterConflict("INCIDENT_REGISTER_INTEGRITY_FAILED", {
      registerId: register.id,
      reason:
        integrity.status === "pass" ? "row-register-mismatch" : (integrity.reason ?? "ledger-verification-failed"),
    });
  }
  return register;
};

const map = (row: Record<string, unknown> | null) => {
  if (!row) return null;
  const register = parse(row.register_json);
  if (typeof row.baseline_json !== "string") throw new TypeError("Stored Incident Register baseline must be JSON text");
  const baselineValue: unknown = JSON.parse(row.baseline_json);
  if (!isRecord(baselineValue)) throw new TypeError("Stored Incident Register baseline must be an object");
  const baseline = baselineValue;
  if (json(register.baseline) !== json(baseline) || register.baseline.fingerprint !== row.baseline_fingerprint) {
    throw new IncidentRegisterConflict("INCIDENT_REGISTER_BASELINE_IMMUTABLE", { registerId: register.id });
  }
  return assertIntegrity(register, row);
};
const changed = (result: unknown) => {
  if (!isRecord(result)) return 0;
  const meta = isRecord(result.meta) ? result.meta : null;
  const changes = meta?.changes ?? result.changes;
  return typeof changes === "number" ? changes : 0;
};

export function createD1IncidentRepository(db: D1Database) {
  const get = async (organizationId: string, projectId: string, registerId: string) => {
    await ready(db);
    return map(
      await db
        .prepare(
          "SELECT id,project_id,runbook_id,schema_version,baseline_fingerprint,baseline_json,register_json,revision,ledger_head_hash,created_at,updated_at FROM event_day_incident_registers WHERE id=? AND organization_id=? AND project_id=?",
        )
        .bind(registerId, organizationId, projectId)
        .first<Record<string, unknown>>(),
    );
  };
  const getByRunbook = async (organizationId: string, projectId: string, runbookId: string) => {
    await ready(db);
    return map(
      await db
        .prepare(
          "SELECT id,project_id,runbook_id,schema_version,baseline_fingerprint,baseline_json,register_json,revision,ledger_head_hash,created_at,updated_at FROM event_day_incident_registers WHERE runbook_id=? AND organization_id=? AND project_id=?",
        )
        .bind(runbookId, organizationId, projectId)
        .first<Record<string, unknown>>(),
    );
  };

  return Object.freeze({
    async create(organizationId: string, projectId: string, register: IncidentRegister) {
      await ready(db);
      if (register.projectId !== projectId)
        throw new IncidentRegisterConflict("INCIDENT_REGISTER_SCOPE_INVALID", {
          projectId,
          registerProjectId: register.projectId,
        });
      assertIntegrity(register);
      try {
        await db
          .prepare(
            "INSERT INTO event_day_incident_registers (id,organization_id,project_id,runbook_id,schema_version,baseline_fingerprint,baseline_json,register_json,revision,ledger_head_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .bind(
            register.id,
            organizationId,
            projectId,
            register.runbookVersionId,
            register.schemaVersion,
            register.baseline.fingerprint,
            json(register.baseline),
            json(register),
            register.revision,
            ledgerHeadHash(register),
            register.createdAt,
            register.updatedAt,
          )
          .run();
        return register;
      } catch (cause) {
        const existing =
          (await get(organizationId, projectId, register.id)) ??
          (await getByRunbook(organizationId, projectId, register.runbookVersionId));
        if (
          existing &&
          existing.id === register.id &&
          existing.runbookVersionId === register.runbookVersionId &&
          existing.baseline.fingerprint === register.baseline.fingerprint
        )
          return existing;
        if (existing)
          throw new IncidentRegisterConflict("INCIDENT_REGISTER_ID_CONFLICT", {
            registerId: register.id,
            runbookVersionId: register.runbookVersionId,
          });
        throw cause;
      }
    },
    get,
    getByRunbook,
    async put(organizationId: string, projectId: string, register: IncidentRegister, expectedRevision: number) {
      await ready(db);
      if (register.projectId !== projectId)
        throw new IncidentRegisterConflict("INCIDENT_REGISTER_SCOPE_INVALID", {
          projectId,
          registerProjectId: register.projectId,
        });
      const current = await get(organizationId, projectId, register.id);
      if (
        current &&
        (current.runbookVersionId !== register.runbookVersionId ||
          current.schemaVersion !== register.schemaVersion ||
          current.createdAt !== register.createdAt ||
          json(current.source) !== json(register.source) ||
          json(current.baseline) !== json(register.baseline))
      ) {
        throw new IncidentRegisterConflict("INCIDENT_REGISTER_BASELINE_IMMUTABLE", { registerId: register.id });
      }
      assertIntegrity(register);
      const result = await db
        .prepare(
          "UPDATE event_day_incident_registers SET register_json=?,revision=?,ledger_head_hash=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND revision=?",
        )
        .bind(
          json(register),
          register.revision,
          ledgerHeadHash(register),
          register.updatedAt,
          register.id,
          organizationId,
          projectId,
          expectedRevision,
        )
        .run();
      if (changed(result) === 0)
        throw new IncidentRegisterConflict("INCIDENT_REGISTER_REVISION_CONFLICT", {
          expectedRevision,
          currentRevision: (await get(organizationId, projectId, register.id))?.revision ?? null,
        });
      return register;
    },
  });
}
