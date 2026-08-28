import { applyDatabaseMigrations } from "./database-migrations.ts";

type D1Statement = {
  bind: (...values: unknown[]) => D1Statement;
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

type D1Database = {
  prepare: (sql: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown>;
};

export type ProjectRecord = {
  id: string;
  organizationId: string;
  name: string;
  activePlanId: string;
  schemaVersion: number;
  snapshot: unknown;
  createdAt: string;
  updatedAt: string;
  revision: number;
  provenance?: Record<string, unknown>;
  archivedAt?: string | null;
  deletedAt?: string | null;
  recoveryUntil?: string | null;
  pinned?: boolean;
  lastOpenedAt?: string | null;
};

export class ProjectRevisionConflict extends Error {
  current: ProjectRecord | null;

  constructor(current: ProjectRecord | null) {
    super("PROJECT_REVISION_CONFLICT");
    this.name = "ProjectRevisionConflict";
    this.current = current;
  }
}

type PutOptions = { expectedRevision?: number | null; createOnly?: boolean };

const initializedDatabases = new WeakSet<object>();

async function ensureSchema(db: D1Database) {
  if (initializedDatabases.has(db as object)) return;
  await applyDatabaseMigrations(db);
  await db.prepare("PRAGMA optimize").run();
  initializedDatabases.add(db as object);
}

export function createD1ProjectRepository(db: D1Database) {
  return {
    async list(organizationId: string) {
      await ensureSchema(db);
      const { results } = await db.prepare(
        `SELECT p.id, p.organization_id, p.name, p.active_plan_id, p.created_at, p.updated_at, p.provenance_json,
                p.archived_at, p.deleted_at, p.recovery_until, p.pinned, p.last_opened_at, p.revision,
                s.schema_version, s.snapshot_json
         FROM projects p
         JOIN project_states s ON s.project_id = p.id
         WHERE p.organization_id = ?
         ORDER BY p.updated_at DESC`,
      ).bind(organizationId).all<Record<string, string | number>>();
      return results.map((row) => ({
        id: String(row.id),
        organizationId: String(row.organization_id),
        name: String(row.name),
        activePlanId: String(row.active_plan_id),
        schemaVersion: Number(row.schema_version),
        snapshot: JSON.parse(String(row.snapshot_json)),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        revision: Number(row.revision),
        ...(row.provenance_json ? { provenance: JSON.parse(String(row.provenance_json)) } : {}),
        archivedAt: row.archived_at ? String(row.archived_at) : null,
        deletedAt: row.deleted_at ? String(row.deleted_at) : null,
        recoveryUntil: row.recovery_until ? String(row.recovery_until) : null,
        pinned: Boolean(row.pinned),
        lastOpenedAt: row.last_opened_at ? String(row.last_opened_at) : null,
      }));
    },

    async get(organizationId: string, projectId: string): Promise<ProjectRecord | null> {
      await ensureSchema(db);
      const row = await db.prepare(
        `SELECT p.id, p.organization_id, p.name, p.active_plan_id, p.created_at, p.updated_at, p.provenance_json,
                p.archived_at, p.deleted_at, p.recovery_until, p.pinned, p.last_opened_at, p.revision,
                s.schema_version, s.snapshot_json
         FROM projects p
         JOIN project_states s ON s.project_id = p.id
         WHERE p.id = ? AND p.organization_id = ?`,
      ).bind(projectId, organizationId).first<Record<string, string | number>>();
      if (!row) return null;
      return {
        id: String(row.id),
        organizationId: String(row.organization_id),
        name: String(row.name),
        activePlanId: String(row.active_plan_id),
        schemaVersion: Number(row.schema_version),
        snapshot: JSON.parse(String(row.snapshot_json)),
        createdAt: String(row.created_at),
        updatedAt: String(row.updated_at),
        revision: Number(row.revision),
        ...(row.provenance_json ? { provenance: JSON.parse(String(row.provenance_json)) } : {}),
        archivedAt: row.archived_at ? String(row.archived_at) : null,
        deletedAt: row.deleted_at ? String(row.deleted_at) : null,
        recoveryUntil: row.recovery_until ? String(row.recovery_until) : null,
        pinned: Boolean(row.pinned),
        lastOpenedAt: row.last_opened_at ? String(row.last_opened_at) : null,
      };
    },

    async put(organizationId: string, record: ProjectRecord, options: PutOptions = {}) {
      await ensureSchema(db);
      if (record.organizationId !== organizationId) throw new TypeError("Project organization does not match repository scope");
      const existing = await db.prepare("SELECT organization_id, revision FROM projects WHERE id = ?").bind(record.id).first<{ organization_id: string | null; revision: number }>();
      if (existing && existing.organization_id !== organizationId) throw new Error("PROJECT_ID_CONFLICT");
      const writeToken = crypto.randomUUID();
      if (options.createOnly) {
        if (existing) throw new ProjectRevisionConflict(await this.get(organizationId, record.id));
        try {
          await db.batch([
            db.prepare(
              `INSERT INTO projects (id, organization_id, name, active_plan_id, created_at, updated_at, provenance_json, archived_at, deleted_at, recovery_until, pinned, last_opened_at, revision, write_token)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            ).bind(record.id, organizationId, record.name, record.activePlanId, record.createdAt, record.updatedAt, record.provenance ? JSON.stringify(record.provenance) : null, record.archivedAt ?? null, record.deletedAt ?? null, record.recoveryUntil ?? null, record.pinned ? 1 : 0, record.lastOpenedAt ?? null, writeToken),
            db.prepare("INSERT INTO project_states (project_id, schema_version, snapshot_json, updated_at) VALUES (?, ?, ?, ?)")
              .bind(record.id, record.schemaVersion, JSON.stringify(record.snapshot), record.updatedAt),
          ]);
        } catch (cause) {
          const current = await this.get(organizationId, record.id);
          if (current) throw new ProjectRevisionConflict(current);
          throw cause;
        }
        return await this.get(organizationId, record.id) as ProjectRecord;
      }

      const expectedRevision = options.expectedRevision;
      if (!existing || !Number.isInteger(expectedRevision) || expectedRevision! < 1 || Number(existing.revision) !== expectedRevision) {
        throw new ProjectRevisionConflict(existing ? await this.get(organizationId, record.id) : null);
      }
      await db.batch([
        db.prepare(
          `UPDATE projects SET name = ?, active_plan_id = ?, updated_at = ?, provenance_json = ?, archived_at = ?, deleted_at = ?, recovery_until = ?, pinned = ?, last_opened_at = ?, revision = revision + 1, write_token = ?
           WHERE id = ? AND organization_id = ? AND revision = ?`,
        ).bind(record.name, record.activePlanId, record.updatedAt, record.provenance ? JSON.stringify(record.provenance) : null, record.archivedAt ?? null, record.deletedAt ?? null, record.recoveryUntil ?? null, record.pinned ? 1 : 0, record.lastOpenedAt ?? null, writeToken, record.id, organizationId, expectedRevision),
        db.prepare(
          `UPDATE project_states SET schema_version = ?, snapshot_json = ?, updated_at = ?
           WHERE project_id = ? AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND organization_id = ? AND write_token = ?)`,
        ).bind(record.schemaVersion, JSON.stringify(record.snapshot), record.updatedAt, record.id, record.id, organizationId, writeToken),
      ]);
      const receipt = await db.prepare("SELECT revision, write_token FROM projects WHERE id = ? AND organization_id = ?").bind(record.id, organizationId).first<{ revision: number; write_token: string | null }>();
      if (!receipt || receipt.write_token !== writeToken || Number(receipt.revision) !== expectedRevision! + 1) {
        throw new ProjectRevisionConflict(await this.get(organizationId, record.id));
      }
      return await this.get(organizationId, record.id) as ProjectRecord;
    },
  };
}
