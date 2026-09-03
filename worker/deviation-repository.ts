import { verifyDeviationLedger } from "../src/domain/live-plan-deviations.ts";
import type { LivePlanDeviationRegister } from "../src/domain/operational-types.ts";
import { applyDatabaseMigrations } from "./database-migrations.ts";

const initialized = new WeakSet<object>();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isDeviationRegister = (value: unknown): value is LivePlanDeviationRegister =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["runbookVersionId"] === "string" &&
  isRecord(value["source"]) &&
  isRecord(value["baseline"]) &&
  Array.isArray(value["deviations"]) &&
  Array.isArray(value["recommendations"]) &&
  Array.isArray(value["transitions"]) &&
  Array.isArray(value["receipts"]) &&
  Array.isArray(value["ledger"]) &&
  typeof value["revision"] === "number" &&
  typeof value["createdAt"] === "string" &&
  typeof value["updatedAt"] === "string";
const parse = (value: unknown): LivePlanDeviationRegister => {
  if (typeof value !== "string") throw new TypeError("Stored Deviation Register must be JSON text");
  const parsed: unknown = JSON.parse(value);
  if (!isDeviationRegister(parsed)) throw new TypeError("Stored Deviation Register is invalid");
  return parsed;
};
const json = (value: unknown) => JSON.stringify(value);
const ledgerHeadHash = (register: LivePlanDeviationRegister) => {
  const value = register.ledger.at(-1)?.hash ?? register.source.runbookLedgerHeadHash;
  if (typeof value !== "string" || !value) throw new TypeError("Deviation Register ledger head hash is required");
  return value;
};

async function ready(db: D1Database) {
  if (initialized.has(db)) return;
  await applyDatabaseMigrations(db);
  initialized.add(db);
}

export class DeviationRegisterConflict extends Error {
  readonly code:
    | "DEVIATION_REGISTER_ID_CONFLICT"
    | "DEVIATION_REGISTER_REVISION_CONFLICT"
    | "DEVIATION_REGISTER_BASELINE_IMMUTABLE"
    | "DEVIATION_REGISTER_SCOPE_INVALID"
    | "DEVIATION_REGISTER_INTEGRITY_FAILED";
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DeviationRegisterConflict["code"], details: Readonly<Record<string, unknown>> = {}) {
    super(
      code === "DEVIATION_REGISTER_ID_CONFLICT"
        ? "Deviation Register conflicts with the stored Runbook baseline"
        : code === "DEVIATION_REGISTER_SCOPE_INVALID"
          ? "Deviation Register Project scope is invalid"
          : code === "DEVIATION_REGISTER_INTEGRITY_FAILED"
            ? "Deviation Register integrity verification failed"
            : code === "DEVIATION_REGISTER_BASELINE_IMMUTABLE"
              ? "Deviation Register baseline is immutable"
              : "Deviation Register revision conflict",
    );
    this.name = "DeviationRegisterConflict";
    this.code = code;
    this.details = details;
  }
}

const assertIntegrity = (register: LivePlanDeviationRegister, row?: Readonly<Record<string, unknown>>) => {
  const integrity = verifyDeviationLedger(register);
  const rowMismatch =
    row !== undefined &&
    (register.id !== row["id"] ||
      register.projectId !== row["project_id"] ||
      register.runbookVersionId !== row["runbook_id"] ||
      register.schemaVersion !== Number(row["schema_version"]) ||
      register.revision !== Number(row["revision"]) ||
      ledgerHeadHash(register) !== row["ledger_head_hash"] ||
      register.createdAt !== row["created_at"] ||
      register.updatedAt !== row["updated_at"]);
  if (integrity.status !== "pass" || rowMismatch) {
    throw new DeviationRegisterConflict("DEVIATION_REGISTER_INTEGRITY_FAILED", {
      registerId: register.id,
      reason: integrity.status === "pass" ? "row-register-mismatch" : "ledger-verification-failed",
      sequence: integrity.sequence,
    });
  }
  return register;
};

const map = (row: Record<string, unknown> | null) => {
  if (!row) return null;
  const register = parse(row["register_json"]);
  if (typeof row["baseline_json"] !== "string")
    throw new TypeError("Stored Deviation Register baseline must be JSON text");
  const baselineValue: unknown = JSON.parse(row["baseline_json"]);
  if (!isRecord(baselineValue)) throw new TypeError("Stored Deviation Register baseline must be an object");
  if (json(register.baseline) !== json(baselineValue) || register.baseline.fingerprint !== row["baseline_fingerprint"])
    throw new DeviationRegisterConflict("DEVIATION_REGISTER_BASELINE_IMMUTABLE", { registerId: register.id });
  return assertIntegrity(register, row);
};
const changed = (result: unknown) => {
  if (!isRecord(result)) return 0;
  const meta = isRecord(result["meta"]) ? result["meta"] : null;
  const changes = meta?.["changes"] ?? result["changes"];
  return typeof changes === "number" ? changes : 0;
};

export function createD1DeviationRepository(db: D1Database) {
  const get = async (organizationId: string, projectId: string, registerId: string) => {
    await ready(db);
    return map(
      await db
        .prepare(
          "SELECT id,project_id,runbook_id,schema_version,baseline_fingerprint,baseline_json,register_json,revision,ledger_head_hash,created_at,updated_at FROM event_day_deviation_registers WHERE id=? AND organization_id=? AND project_id=?",
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
          "SELECT id,project_id,runbook_id,schema_version,baseline_fingerprint,baseline_json,register_json,revision,ledger_head_hash,created_at,updated_at FROM event_day_deviation_registers WHERE runbook_id=? AND organization_id=? AND project_id=?",
        )
        .bind(runbookId, organizationId, projectId)
        .first<Record<string, unknown>>(),
    );
  };

  return Object.freeze({
    async create(organizationId: string, projectId: string, register: LivePlanDeviationRegister) {
      await ready(db);
      if (register.projectId !== projectId)
        throw new DeviationRegisterConflict("DEVIATION_REGISTER_SCOPE_INVALID", {
          projectId,
          registerProjectId: register.projectId,
        });
      assertIntegrity(register);
      try {
        await db
          .prepare(
            "INSERT INTO event_day_deviation_registers (id,organization_id,project_id,runbook_id,schema_version,baseline_fingerprint,baseline_json,register_json,revision,ledger_head_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
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
          throw new DeviationRegisterConflict("DEVIATION_REGISTER_ID_CONFLICT", {
            registerId: register.id,
            runbookVersionId: register.runbookVersionId,
          });
        throw cause;
      }
    },
    get,
    getByRunbook,
    async put(
      organizationId: string,
      projectId: string,
      register: LivePlanDeviationRegister,
      expectedRevision: number,
    ) {
      await ready(db);
      if (register.projectId !== projectId)
        throw new DeviationRegisterConflict("DEVIATION_REGISTER_SCOPE_INVALID", {
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
      )
        throw new DeviationRegisterConflict("DEVIATION_REGISTER_BASELINE_IMMUTABLE", { registerId: register.id });
      assertIntegrity(register);
      const result = await db
        .prepare(
          "UPDATE event_day_deviation_registers SET register_json=?,revision=?,ledger_head_hash=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND revision=?",
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
        throw new DeviationRegisterConflict("DEVIATION_REGISTER_REVISION_CONFLICT", {
          expectedRevision,
          currentRevision: (await get(organizationId, projectId, register.id))?.revision ?? null,
        });
      return register;
    },
  });
}

export type D1DeviationRepository = ReturnType<typeof createD1DeviationRepository>;
