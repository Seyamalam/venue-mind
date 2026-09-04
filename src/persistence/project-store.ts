import {
  PROJECT_CREATE_ONLY_HEADER,
  PROJECT_EXPECTED_REVISION_HEADER,
  projectConflictData,
  reconcileProjectRecords,
} from "../domain/project-concurrency.ts";
import {
  isLocalProjectRecord,
  isProjectRecord,
  type LocalProjectRecord,
  type ProjectConflict,
  type ProjectMetadataPatch,
  type ProjectRecord,
  type SaveProjectInput,
} from "../domain/project-types.ts";
import { measureJsonResource, VENUE_RESOURCE_LIMITS } from "../security/resource-limits.ts";
import {
  createRecoveryEnvelope,
  inspectRecoveryEnvelope,
  selectRecoveryEnvelope,
  type RecoveryIntegrityStatus,
} from "./recovery-envelope.ts";
import {
  startTelemetrySpan,
  telemetryErrorCode,
  type TelemetryClock,
  type TelemetrySink,
} from "../observability/telemetry.ts";

const STORAGE_PREFIX = "venuemind.organization.";

interface StorageLike {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface ProjectDeletionReceipt {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly projectId: string;
  readonly projectRevision: number;
  readonly status: "recoverable";
  readonly recoveryUntil: string;
  readonly cacheDirective: Readonly<{
    id: string;
    action: "delete-project-cache";
    issuedAt: string;
    acknowledgedAt: string | null;
    acknowledgedBy: string | null;
  }>;
}

export interface ProjectStoreOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly storage?: StorageLike;
  readonly clock?: () => string;
  readonly organizationId?: string;
  readonly observability?: TelemetrySink;
  readonly telemetryClock?: TelemetryClock;
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

export interface ProjectRecoveryIntegrity {
  readonly status: RecoveryIntegrityStatus;
  readonly projectId: string;
  readonly sequence: number | null;
  readonly committedAt: string | null;
  readonly reason: string;
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
const decodeDeletionReceipt = (value: unknown): ProjectDeletionReceipt => {
  if (
    !isObject(value) ||
    value["schemaVersion"] !== 1 ||
    typeof value["id"] !== "string" ||
    typeof value["projectId"] !== "string" ||
    typeof value["projectRevision"] !== "number" ||
    value["status"] !== "recoverable" ||
    typeof value["recoveryUntil"] !== "string" ||
    !isObject(value["cacheDirective"]) ||
    typeof value["cacheDirective"]["id"] !== "string" ||
    value["cacheDirective"]["action"] !== "delete-project-cache" ||
    typeof value["cacheDirective"]["issuedAt"] !== "string" ||
    (value["cacheDirective"]["acknowledgedAt"] !== null &&
      typeof value["cacheDirective"]["acknowledgedAt"] !== "string") ||
    (value["cacheDirective"]["acknowledgedBy"] !== null &&
      typeof value["cacheDirective"]["acknowledgedBy"] !== "string")
  )
    throw new Error("Project deletion endpoint returned invalid evidence");
  return {
    schemaVersion: 1,
    id: value["id"],
    projectId: value["projectId"],
    projectRevision: value["projectRevision"],
    status: "recoverable",
    recoveryUntil: value["recoveryUntil"],
    cacheDirective: {
      id: value["cacheDirective"]["id"],
      action: "delete-project-cache",
      issuedAt: value["cacheDirective"]["issuedAt"],
      acknowledgedAt: value["cacheDirective"]["acknowledgedAt"],
      acknowledgedBy: value["cacheDirective"]["acknowledgedBy"],
    },
  };
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
  observability,
  telemetryClock,
}: ProjectStoreOptions = {}) {
  if (!organizationId.trim()) throw new TypeError("Project store requires an Organization ID");
  const organizationPrefix = `${STORAGE_PREFIX}${organizationId}.project.`;
  const syncBasePrefix = `${STORAGE_PREFIX}${organizationId}.sync-base.`;
  const recoveryPrefix = `${STORAGE_PREFIX}${organizationId}.recovery.`;
  const autosavePrefix = `${STORAGE_PREFIX}${organizationId}.autosave.`;
  const quarantinePrefix = `${STORAGE_PREFIX}${organizationId}.quarantine.`;
  const localKey = (projectId: string): string => `${organizationPrefix}${projectId}`;
  const syncBaseKey = (projectId: string): string => `${syncBasePrefix}${projectId}`;
  const autosaveKey = (projectId: string): string => `${autosavePrefix}${projectId}`;
  const requestHeaders = (headers: Readonly<Record<string, string>> = {}): Record<string, string> => ({
    ...headers,
    "x-venuemind-organization-id": organizationId,
  });
  const inspectLocal = (projectId: string) => {
    const committed = inspectRecoveryEnvelope(storage.getItem(localKey(projectId)), isLocalProjectRecord);
    const journal = inspectRecoveryEnvelope(storage.getItem(autosaveKey(projectId)), isLocalProjectRecord);
    return selectRecoveryEnvelope(committed, journal);
  };
  const recoveryIntegrity = (
    projectId: string,
    inspection: ReturnType<typeof inspectLocal>,
  ): ProjectRecoveryIntegrity => ({
    status: inspection.status,
    projectId,
    sequence: inspection.envelope?.sequence ?? null,
    committedAt: inspection.envelope?.committedAt ?? null,
    reason: inspection.reason,
  });
  const quarantineLocal = (projectId: string, reason: string): void => {
    try {
      storage.setItem(
        `${quarantinePrefix}${projectId}`,
        JSON.stringify({ schemaVersion: 1, projectId, reason, quarantinedAt: clock() }),
      );
      storage.removeItem?.(localKey(projectId));
      storage.removeItem?.(autosaveKey(projectId));
    } catch {
      // Quarantine evidence is best effort when browser storage itself is unavailable.
    }
  };
  const readLocal = (projectId: string): LocalProjectRecord | null => {
    const inspection = inspectLocal(projectId);
    if (!inspection.envelope) {
      if (inspection.status === "quarantined") quarantineLocal(projectId, inspection.reason);
      return null;
    }
    if (inspection.status === "recovered") {
      try {
        storage.setItem(localKey(projectId), JSON.stringify(inspection.envelope));
        storage.removeItem?.(autosaveKey(projectId));
      } catch {
        // The verified journal remains the recovery source until the next successful write.
      }
    }
    return inspection.envelope.value;
  };
  const writeLocal = (record: LocalProjectRecord): void => {
    try {
      const prior = inspectLocal(record.id).envelope;
      const envelope = createRecoveryEnvelope(record, (prior?.sequence ?? 0) + 1, clock());
      const encoded = JSON.stringify(envelope);
      storage.setItem(autosaveKey(record.id), encoded);
      storage.setItem(localKey(record.id), encoded);
      const committed = inspectRecoveryEnvelope(storage.getItem(localKey(record.id)), isLocalProjectRecord);
      if (!committed.envelope || committed.envelope.checksum !== envelope.checksum) {
        throw new Error("RECOVERY_COMMIT_VERIFY_FAILED");
      }
      storage.removeItem?.(autosaveKey(record.id));
      storage.removeItem?.(`${quarantinePrefix}${record.id}`);
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
  const purgeLocalProject = (projectId: string): void => {
    const keys = [
      localKey(projectId),
      syncBaseKey(projectId),
      autosaveKey(projectId),
      `${quarantinePrefix}${projectId}`,
    ];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${recoveryPrefix}${projectId}.`)) keys.push(key);
    }
    for (const key of new Set(keys)) storage.removeItem(key);
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
  ): Promise<Response> => {
    measureJsonResource(record, {
      surface: "browser-project-save",
      maximumBytes: VENUE_RESOURCE_LIMITS.projectRecordBytes,
    });
    return fetchImpl(`/api/projects/${encodeURIComponent(record.id)}`, {
      method: "PUT",
      credentials: "same-origin",
      headers: requestHeaders({
        "content-type": "application/json",
        accept: "application/json",
        ...(createOnly
          ? { [PROJECT_CREATE_ONLY_HEADER]: "1" }
          : { [PROJECT_EXPECTED_REVISION_HEADER]: String(record.revision ?? 1) }),
        ...(correlationId ? { "x-correlation-id": correlationId } : {}),
      }),
      body: JSON.stringify(record),
    });
  };

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
    if (isObject(payload) && payload["code"] === "PROJECT_ID_CONFLICT" && !isProjectRecord(candidate)) {
      throw new ProjectStoreError("PROJECT_ID_CONFLICT", "Project ID is unavailable in this Organization");
    }
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

    async load(projectId: string): Promise<
      Readonly<{
        source: "local" | "remote";
        record: LocalProjectRecord | null;
        integrity: ProjectRecoveryIntegrity;
      }>
    > {
      try {
        const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}`, {
          credentials: "same-origin",
          headers: requestHeaders({ accept: "application/json" }),
        });
        if (response.status === 404) {
          const beforeRecovery = inspectLocal(projectId);
          const record = readLocal(projectId);
          return {
            source: "remote",
            record,
            integrity:
              beforeRecovery.status === "recovered"
                ? recoveryIntegrity(projectId, beforeRecovery)
                : store.inspectRecovery(projectId),
          };
        }
        if (!response.ok) throw new Error(`Project load failed: ${response.status}`);
        const record = decodeProject(await responseJson(response));
        writeRemoteCache(record);
        return { source: "remote", record, integrity: store.inspectRecovery(projectId) };
      } catch {
        const beforeRecovery = inspectLocal(projectId);
        const record = readLocal(projectId);
        return {
          source: "local",
          record,
          integrity:
            beforeRecovery.status === "recovered"
              ? recoveryIntegrity(projectId, beforeRecovery)
              : store.inspectRecovery(projectId),
        };
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
      const persistenceSpan = startTelemetrySpan(
        observability,
        { component: "repository", operation: "persistence", correlationId, action: "project.save" },
        telemetryClock,
      );
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
        const result = await resolveWriteResponse({
          response,
          base: readSyncBase(id) ?? previous,
          local: record,
          correlationId,
        });
        persistenceSpan.end("ok");
        return result;
      } catch (error) {
        if (error instanceof ProjectStoreError && error.code === "PROJECT_ID_CONFLICT") {
          persistenceSpan.end("conflict", error.code);
          throw error;
        }
        if (error instanceof ProjectStoreError && error.code === "PROJECT_REVISION_CONFLICT") {
          persistenceSpan.end("conflict", error.code);
          startTelemetrySpan(
            observability,
            { component: "repository", operation: "conflict", correlationId, action: "project.save" },
            telemetryClock,
          ).end("conflict", error.code);
          throw error;
        }
        persistenceSpan.end("failed", error instanceof Error ? telemetryErrorCode(error) : "PERSISTENCE_FAILED");
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

    async deleteProject(projectId: string, confirmationName: string): Promise<ProjectDeletionReceipt> {
      const loaded = await store.load(projectId);
      if (!loaded.record) throw new ProjectStoreError("PROJECT_NOT_FOUND", `Project not found: ${projectId}`);
      if (confirmationName !== loaded.record.name) {
        throw new ProjectStoreError("PROJECT_CONFIRMATION_MISMATCH", "Project confirmation does not match");
      }
      if (loaded.record.revision === undefined)
        throw new ProjectStoreError("PROJECT_REVISION_REQUIRED", "Project revision is required");
      const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers: requestHeaders({
          accept: "application/json",
          "content-type": "application/json",
          [PROJECT_EXPECTED_REVISION_HEADER]: String(loaded.record.revision),
        }),
        body: JSON.stringify({ reasonCode: "USER_REQUEST" }),
      });
      if (!response.ok) {
        const payload = await responseJson(response);
        const code =
          isObject(payload) && typeof payload["code"] === "string" ? payload["code"] : "PROJECT_DELETE_FAILED";
        throw new ProjectStoreError(code, "Project deletion failed");
      }
      const receipt = decodeDeletionReceipt(await responseJson(response));
      if (receipt.projectId !== projectId)
        throw new ProjectStoreError("PROJECT_DELETE_EVIDENCE_INVALID", "Project deletion evidence is invalid");
      purgeLocalProject(projectId);
      const acknowledgement = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}/deletion/cache-ack`, {
        method: "POST",
        credentials: "same-origin",
        headers: requestHeaders({ accept: "application/json", "content-type": "application/json" }),
        body: JSON.stringify({ deletionRequestId: receipt.id, directiveId: receipt.cacheDirective.id }),
      });
      if (!acknowledgement.ok)
        throw new ProjectStoreError("PROJECT_CACHE_ACK_FAILED", "Project cache acknowledgement failed");
      const acknowledged = decodeDeletionReceipt(await responseJson(acknowledgement));
      if (acknowledged.cacheDirective.acknowledgedAt === null)
        throw new ProjectStoreError("PROJECT_CACHE_ACK_INVALID", "Project cache acknowledgement is invalid");
      return acknowledged;
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

    inspectRecovery(projectId: string): ProjectRecoveryIntegrity {
      const inspection = inspectLocal(projectId);
      const quarantine = parseJson(storage.getItem(`${quarantinePrefix}${projectId}`));
      if (!inspection.envelope && isObject(quarantine) && typeof quarantine["reason"] === "string") {
        return {
          status: "quarantined",
          projectId,
          sequence: null,
          committedAt: null,
          reason: quarantine["reason"],
        };
      }
      return {
        status: inspection.status,
        projectId,
        sequence: inspection.envelope?.sequence ?? null,
        committedAt: inspection.envelope?.committedAt ?? null,
        reason: inspection.reason,
      };
    },
  };

  return Object.freeze(store);
}

export type ProjectStore = ReturnType<typeof createProjectStore>;
