import { projectConflictData, projectEtag, reconcileProjectRecords } from "../domain/project-concurrency.ts";
import {
  isLocalProjectRecord,
  isProjectRecord,
  type LocalProjectRecord,
  type ProjectConflict,
  type ProjectMetadataPatch,
  type ProjectRecord,
  type SaveProjectInput,
} from "../domain/project-types.ts";

const STORAGE_PREFIX = "venuemind.organization.";

interface StorageLike {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  setItem(key: string, value: string): void;
}

export interface ProjectStoreOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly storage?: StorageLike;
  readonly clock?: () => string;
  readonly organizationId?: string;
}

export interface ProjectStoreResult<RecordType extends LocalProjectRecord = LocalProjectRecord> {
  readonly source: "local" | "remote";
  readonly record: RecordType;
  readonly reconciliation?: Readonly<{
    status: "merged";
    localFields: readonly string[];
    remoteFields: readonly string[];
  }>;
}

interface RecoveryRecord extends ProjectConflict {
  readonly createdAt: string;
  readonly key: string;
}

export class ProjectStoreError extends Error {
  readonly code: string;
  readonly conflict?: ProjectConflict & Readonly<{ recoveryKey: string | null }>;

  constructor(code: string, message: string, conflict?: ProjectConflict & Readonly<{ recoveryKey: string | null }>) {
    super(message);
    this.name = "ProjectStoreError";
    this.code = code;
    if (conflict) this.conflict = conflict;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseJson = (value: string | null): unknown => {
  if (value === null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return null;
  }
};

const responseJson = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("Project endpoint unavailable");
  return response.json();
};

const isPlannerSnapshotShape = (value: unknown): value is LocalProjectRecord["snapshot"] =>
  isObject(value) &&
  isObject(value["plan"]) &&
  isObject(value["proposal"]) &&
  Array.isArray(value["ledger"]) &&
  Array.isArray(value["receipts"]);

const decodeProject = (value: unknown): LocalProjectRecord => {
  if (isLocalProjectRecord(value)) return value;
  if (
    !isObject(value) ||
    typeof value["id"] !== "string" ||
    typeof value["organizationId"] !== "string" ||
    typeof value["name"] !== "string" ||
    typeof value["activePlanId"] !== "string" ||
    value["schemaVersion"] !== 10 ||
    !isPlannerSnapshotShape(value["snapshot"]) ||
    typeof value["createdAt"] !== "string" ||
    typeof value["updatedAt"] !== "string" ||
    (value["revision"] !== undefined &&
      (typeof value["revision"] !== "number" || !Number.isSafeInteger(value["revision"])))
  ) {
    throw new Error("Project endpoint returned an invalid Project");
  }
  return {
    id: value["id"],
    organizationId: value["organizationId"],
    name: value["name"],
    activePlanId: value["activePlanId"],
    schemaVersion: 10,
    snapshot: value["snapshot"],
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
    ...(typeof value["revision"] === "number" ? { revision: value["revision"] } : {}),
    archivedAt: null,
    deletedAt: null,
    recoveryUntil: null,
    pinned: false,
    lastOpenedAt: null,
  };
};

const decodeProjectList = (value: unknown): readonly LocalProjectRecord[] => {
  if (!isObject(value) || !Array.isArray(value["projects"])) {
    throw new Error("Project endpoint returned an invalid Project list");
  }
  return value["projects"].map(decodeProject);
};

const isProjectConflict = (value: unknown): value is ProjectConflict =>
  isObject(value) &&
  ["missing-base", "planning", "metadata"].includes(String(value["kind"])) &&
  typeof value["projectId"] === "string" &&
  Array.isArray(value["overlappingFields"]) &&
  isLocalProjectRecord(value["local"]) &&
  isProjectRecord(value["remote"]);

export function createProjectStore({
  fetchImpl = globalThis.fetch.bind(globalThis),
  storage = globalThis.localStorage,
  clock = () => new Date().toISOString(),
  organizationId = "org-local",
}: ProjectStoreOptions = {}) {
  if (!organizationId.trim()) throw new TypeError("Project store requires an Organization ID");
  const organizationPrefix = `${STORAGE_PREFIX}${organizationId}.project.`;
  const syncBasePrefix = `${STORAGE_PREFIX}${organizationId}.sync-base.`;
  const recoveryPrefix = `${STORAGE_PREFIX}${organizationId}.recovery.`;
  const localKey = (projectId: string): string => `${organizationPrefix}${projectId}`;
  const syncBaseKey = (projectId: string): string => `${syncBasePrefix}${projectId}`;
  const requestHeaders = (headers: Readonly<Record<string, string>> = {}): Record<string, string> => ({
    ...headers,
    "x-venuemind-organization-id": organizationId,
  });
  const readLocal = (projectId: string): LocalProjectRecord | null => {
    const value = parseJson(storage.getItem(localKey(projectId)));
    return isLocalProjectRecord(value) ? value : null;
  };
  const writeLocal = (record: LocalProjectRecord): void => {
    try {
      storage.setItem(localKey(record.id), JSON.stringify(record));
    } catch {
      // The remote record remains authoritative when the local recovery cache is unavailable.
    }
  };
  const readSyncBase = (projectId: string): LocalProjectRecord | null => {
    const value = parseJson(storage.getItem(syncBaseKey(projectId)));
    return isLocalProjectRecord(value) ? value : null;
  };
  const writeSyncBase = (record: LocalProjectRecord): void => {
    try {
      storage.setItem(syncBaseKey(record.id), JSON.stringify(record));
    } catch {
      // The synchronization base is a best-effort local cache.
    }
  };
  const writeRemoteCache = (record: LocalProjectRecord): void => {
    writeLocal(record);
    writeSyncBase(record);
  };
  const writeRecovery = (conflict: ProjectConflict): string | null => {
    try {
      const key = `${recoveryPrefix}${conflict.projectId}.${conflict.localRevision ?? "new"}.${Date.now()}`;
      storage.setItem(key, JSON.stringify({ createdAt: clock(), ...conflict }));
      return key;
    } catch {
      return null;
    }
  };
  const conflictError = (data: ProjectConflict): ProjectStoreError =>
    new ProjectStoreError("PROJECT_REVISION_CONFLICT", "Project revision conflict", {
      ...data,
      recoveryKey: writeRecovery(data),
    });
  const put = (
    record: LocalProjectRecord,
    { createOnly = false, correlationId }: Readonly<{ createOnly?: boolean; correlationId?: string }> = {},
  ): Promise<Response> =>
    fetchImpl(`/api/projects/${encodeURIComponent(record.id)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: requestHeaders({
        "content-type": "application/json",
        accept: "application/json",
        ...(createOnly ? { "if-none-match": "*" } : { "if-match": projectEtag(record.id, record.revision ?? 1) }),
        ...(correlationId ? { "x-correlation-id": correlationId } : {}),
      }),
      body: JSON.stringify(record),
    });

  const resolveWriteResponse = async ({
    response,
    base,
    local,
    correlationId,
    allowMerge = true,
  }: Readonly<{
    response: Response;
    base: LocalProjectRecord | null;
    local: LocalProjectRecord;
    correlationId: string;
    allowMerge?: boolean;
  }>): Promise<ProjectStoreResult> => {
    if (response.ok) {
      const saved = decodeProject(await responseJson(response));
      writeRemoteCache(saved);
      return { source: "remote", record: saved };
    }
    if (![409, 412].includes(response.status)) throw new Error(`Project save failed: ${response.status}`);
    const payload = await responseJson(response);
    const candidate = isObject(payload) && isObject(payload["details"]) ? payload["details"]["current"] : null;
    const remote: ProjectRecord = isProjectRecord(candidate) ? candidate : { ...local, revision: local.revision ?? 1 };
    if (!isProjectRecord(candidate)) {
      throw conflictError(
        projectConflictData({
          base,
          local,
          remote,
          analysis: {
            status: "conflict",
            kind: "missing-base",
            overlappingFields: ["snapshot"],
            localFields: ["snapshot"],
            remoteFields: [],
          },
        }),
      );
    }
    const analysis = reconcileProjectRecords({ base, local, remote });
    if (analysis.status === "merged" && allowMerge) {
      const merged: LocalProjectRecord = { ...analysis.record, updatedAt: clock(), revision: remote.revision };
      writeLocal(merged);
      const retry = await put(merged, { correlationId });
      const result = await resolveWriteResponse({
        response: retry,
        base: remote,
        local: merged,
        correlationId,
        allowMerge: false,
      });
      return {
        ...result,
        reconciliation: {
          status: "merged",
          localFields: analysis.localFields,
          remoteFields: analysis.remoteFields,
        },
      };
    }
    if (analysis.status === "merged") {
      throw conflictError(
        projectConflictData({
          base,
          local,
          remote,
          analysis: {
            status: "conflict",
            kind: "metadata",
            overlappingFields: [],
            localFields: analysis.localFields,
            remoteFields: analysis.remoteFields,
          },
        }),
      );
    }
    throw conflictError(projectConflictData({ base, local, remote, analysis }));
  };

  const store = {
    async list(): Promise<Readonly<{ source: "local" | "remote"; projects: readonly LocalProjectRecord[] }>> {
      try {
        const response = await fetchImpl("/api/projects", {
          credentials: "same-origin",
          headers: requestHeaders({ accept: "application/json" }),
        });
        if (!response.ok) throw new Error(`Project list failed: ${response.status}`);
        return { source: "remote", projects: decodeProjectList(await responseJson(response)) };
      } catch {
        const projects: LocalProjectRecord[] = [];
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (!key?.startsWith(organizationPrefix)) continue;
          const record = readLocal(key.slice(organizationPrefix.length));
          if (record) projects.push(record);
        }
        return { source: "local", projects };
      }
    },

    async load(
      projectId: string,
    ): Promise<Readonly<{ source: "local" | "remote"; record: LocalProjectRecord | null }>> {
      try {
        const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}`, {
          credentials: "same-origin",
          headers: requestHeaders({ accept: "application/json" }),
        });
        if (response.status === 404) return { source: "remote", record: readLocal(projectId) };
        if (!response.ok) throw new Error(`Project load failed: ${response.status}`);
        const record = decodeProject(await responseJson(response));
        writeRemoteCache(record);
        return { source: "remote", record };
      } catch {
        return { source: "local", record: readLocal(projectId) };
      }
    },

    async save(input: SaveProjectInput): Promise<ProjectStoreResult> {
      const {
        id,
        name,
        activePlanId,
        snapshot,
        createdAt,
        provenance,
        archivedAt,
        deletedAt,
        recoveryUntil,
        pinned,
        lastOpenedAt,
      } = input;
      const correlationId = snapshot.receipts.at(-1)?.correlationId ?? `project-save-${id}`;
      const previous = readLocal(id);
      const selectedProvenance = provenance ?? previous?.provenance;
      const record: LocalProjectRecord = {
        id,
        organizationId,
        name,
        activePlanId,
        schemaVersion: 10,
        snapshot,
        createdAt: createdAt ?? clock(),
        updatedAt: clock(),
        ...(previous?.revision !== undefined ? { revision: previous.revision } : {}),
        ...(selectedProvenance ? { provenance: selectedProvenance } : {}),
        archivedAt: archivedAt !== undefined ? archivedAt : (previous?.archivedAt ?? null),
        deletedAt: deletedAt !== undefined ? deletedAt : (previous?.deletedAt ?? null),
        recoveryUntil: recoveryUntil !== undefined ? recoveryUntil : (previous?.recoveryUntil ?? null),
        pinned: pinned !== undefined ? pinned : (previous?.pinned ?? false),
        lastOpenedAt: lastOpenedAt !== undefined ? lastOpenedAt : (previous?.lastOpenedAt ?? null),
      };
      writeLocal(record);
      try {
        const response = await put(record, { createOnly: record.revision === undefined, correlationId });
        return await resolveWriteResponse({
          response,
          base: readSyncBase(id) ?? previous,
          local: record,
          correlationId,
        });
      } catch (error) {
        if (error instanceof ProjectStoreError && error.code === "PROJECT_REVISION_CONFLICT") throw error;
        return { source: "local", record };
      }
    },

    async importProject(input: LocalProjectRecord): Promise<Readonly<{ status: "created" } & ProjectStoreResult>> {
      const record: LocalProjectRecord = { ...input, organizationId, schemaVersion: 10, updatedAt: clock() };
      if (readLocal(record.id))
        throw new ProjectStoreError("PROJECT_ID_CONFLICT", `Project already exists: ${record.id}`);
      try {
        const response = await put(record, { createOnly: true, correlationId: `project-import-${record.id}` });
        if (response.status === 409)
          throw new ProjectStoreError("PROJECT_ID_CONFLICT", `Project already exists: ${record.id}`);
        if (!response.ok) throw new Error(`Project import failed: ${response.status}`);
        const saved = decodeProject(await responseJson(response));
        writeRemoteCache(saved);
        return { status: "created", source: "remote", record: saved };
      } catch (error) {
        if (error instanceof ProjectStoreError && error.code === "PROJECT_ID_CONFLICT") throw error;
        if (readLocal(record.id))
          throw new ProjectStoreError("PROJECT_ID_CONFLICT", `Project already exists: ${record.id}`);
        writeLocal(record);
        return { status: "created", source: "local", record };
      }
    },

    async updateMetadata(projectId: string, patch: ProjectMetadataPatch): Promise<ProjectStoreResult> {
      const loaded = await store.load(projectId);
      if (!loaded.record) throw new ProjectStoreError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
      const current = loaded.record;
      const next: LocalProjectRecord = {
        ...current,
        ...patch,
        id: current.id,
        organizationId,
        activePlanId: current.activePlanId,
        schemaVersion: 10,
        snapshot: current.snapshot,
        createdAt: current.createdAt,
        updatedAt: clock(),
      };
      writeLocal(next);
      try {
        const correlationId = `project-metadata-${projectId}`;
        const response = await put(next, { createOnly: next.revision === undefined, correlationId });
        return await resolveWriteResponse({
          response,
          base: readSyncBase(projectId) ?? current,
          local: next,
          correlationId,
        });
      } catch (error) {
        if (error instanceof ProjectStoreError && error.code === "PROJECT_REVISION_CONFLICT") throw error;
        return { source: "local", record: next };
      }
    },

    archive(projectId: string, archived = true): Promise<ProjectStoreResult> {
      return store.updateMetadata(projectId, { archivedAt: archived ? clock() : null });
    },

    pin(projectId: string, pinned = true): Promise<ProjectStoreResult> {
      return store.updateMetadata(projectId, { pinned });
    },

    rename(projectId: string, name: string): Promise<ProjectStoreResult> {
      const normalized = name.trim();
      if (!normalized) throw new ProjectStoreError("PROJECT_NAME_REQUIRED", "Project name is required");
      return store.updateMetadata(projectId, { name: normalized });
    },

    async softDelete(projectId: string, confirmationName: string): Promise<ProjectStoreResult> {
      const loaded = await store.load(projectId);
      if (!loaded.record) throw new ProjectStoreError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
      if (confirmationName !== loaded.record.name) {
        throw new ProjectStoreError("PROJECT_CONFIRMATION_MISMATCH", "Project confirmation does not match");
      }
      const deletedAt = clock();
      const recoveryUntil = new Date(Date.parse(deletedAt) + 7 * 24 * 60 * 60 * 1000).toISOString();
      return store.updateMetadata(projectId, { deletedAt, recoveryUntil, archivedAt: null, pinned: false });
    },

    restoreDeleted(projectId: string): Promise<ProjectStoreResult> {
      return store.updateMetadata(projectId, { deletedAt: null, recoveryUntil: null });
    },

    acceptRemote(record: ProjectRecord): ProjectRecord {
      if (record.organizationId !== organizationId) {
        throw new TypeError("Remote Project does not match active Organization");
      }
      writeRemoteCache(record);
      return record;
    },

    listRecoveries(projectId: string): readonly RecoveryRecord[] {
      const recoveries: RecoveryRecord[] = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(`${recoveryPrefix}${projectId}.`)) continue;
        const value = parseJson(storage.getItem(key));
        if (!isObject(value) || typeof value["createdAt"] !== "string" || !isProjectConflict(value)) continue;
        recoveries.push({ ...value, createdAt: value["createdAt"], key });
      }
      return recoveries.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    },
  };

  return Object.freeze(store);
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
