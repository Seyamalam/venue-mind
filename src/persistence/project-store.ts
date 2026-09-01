import { projectConflictData, projectEtag, reconcileProjectRecords } from "../domain/project-concurrency.ts";

const STORAGE_PREFIX = "venuemind.organization.";

const safeJson = async (response: any) => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) throw new Error("Project endpoint unavailable");
  return response.json();
};

export function createProjectStore({
  fetchImpl = globalThis.fetch?.bind(globalThis),
  storage = globalThis.localStorage,
  clock = () => new Date().toISOString(),
  organizationId = "org-local",
}: any = {}) {
  if (!String(organizationId).trim()) throw new TypeError("Project store requires an Organization ID");
  const organizationPrefix = `${STORAGE_PREFIX}${organizationId}.project.`;
  const syncBasePrefix = `${STORAGE_PREFIX}${organizationId}.sync-base.`;
  const recoveryPrefix = `${STORAGE_PREFIX}${organizationId}.recovery.`;
  const localKey = (projectId: any) => `${organizationPrefix}${projectId}`;
  const syncBaseKey = (projectId: any) => `${syncBasePrefix}${projectId}`;
  const requestHeaders = (headers: any = {}) => ({ ...headers, "x-venuemind-organization-id": organizationId });
  const readLocal = (projectId: any) => {
    try {
      return JSON.parse(storage?.getItem(localKey(projectId)) ?? "null");
    } catch {
      return null;
    }
  };
  const writeLocal = (record: any) => {
    try {
      storage?.setItem(localKey(record.id), JSON.stringify(record));
    } catch {
      // The remote record remains authoritative when the local recovery cache is unavailable.
    }
  };
  const readSyncBase = (projectId: any) => {
    try { return JSON.parse(storage?.getItem(syncBaseKey(projectId)) ?? "null"); } catch { return null; }
  };
  const writeSyncBase = (record: any) => {
    try { storage?.setItem(syncBaseKey(record.id), JSON.stringify(record)); } catch { /* recovery cache remains best effort */ }
  };
  const writeRemoteCache = (record: any) => {
    writeLocal(record);
    writeSyncBase(record);
  };
  const writeRecovery = (conflict: any) => {
    try {
      const key = `${recoveryPrefix}${conflict.projectId}.${conflict.localRevision ?? "new"}.${Date.now()}`;
      storage?.setItem(key, JSON.stringify({ createdAt: clock(), ...conflict }));
      return key;
    } catch { return null; }
  };
  const conflictError = (data: any) => {
    const error: any = new Error("Project revision conflict");
    error.code = "PROJECT_REVISION_CONFLICT";
    error.conflict = { ...data, recoveryKey: writeRecovery(data) };
    return error;
  };
  const put = (record: any, { createOnly = false, correlationId }: any = {}) => fetchImpl(`/api/projects/${encodeURIComponent(record.id)}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: requestHeaders({
      "content-type": "application/json",
      accept: "application/json",
      ...(createOnly ? { "if-none-match": "*" } : { "if-match": projectEtag(record.id, record.revision) }),
      ...(correlationId ? { "x-correlation-id": correlationId } : {}),
    }),
    body: JSON.stringify(record),
  });

  const resolveWriteResponse = async ({ response, base, local, correlationId, allowMerge = true }: any): Promise<any> => {
    if (response.ok) {
      const saved = await safeJson(response);
      writeRemoteCache(saved);
      return { source: "remote", record: saved };
    }
    if (![409, 412].includes(response.status)) throw new Error(`Project save failed: ${response.status}`);
    const payload = await safeJson(response);
    const remote = payload.details?.current ?? null;
    if (!remote) throw conflictError(projectConflictData({ base, local, remote: { ...local, revision: local.revision ?? 1 }, analysis: { kind: "missing-base", overlappingFields: ["snapshot"], localFields: ["snapshot"], remoteFields: [] } }));
    const analysis = reconcileProjectRecords({ base, local, remote });
    if (analysis.status === "merged" && allowMerge) {
      const merged: any = { ...analysis.record, updatedAt: clock(), revision: remote.revision };
      writeLocal(merged);
      const retry = await put(merged, { correlationId });
      const result: any = await resolveWriteResponse({ response: retry, base: remote, local: merged, correlationId, allowMerge: false });
      return { ...result, reconciliation: { status: "merged", localFields: analysis.localFields, remoteFields: analysis.remoteFields } };
    }
    throw conflictError(projectConflictData({ base, local, remote, analysis }));
  };

  return {
    async list() {
      try {
        const response = await fetchImpl("/api/projects", { credentials: "same-origin", headers: requestHeaders({ accept: "application/json" }) });
        if (!response.ok) throw new Error(`Project list failed: ${response.status}`);
        return { source: "remote", projects: (await safeJson(response)).projects };
      } catch {
        const projects: any = [];
        for (let index = 0; index < (storage?.length ?? 0); index += 1) {
          const key = storage.key(index);
          if (!key?.startsWith(organizationPrefix)) continue;
          const record = readLocal(key.slice(organizationPrefix.length));
          if (record) projects.push(record);
        }
        return { source: "local", projects };
      }
    },

    async load(projectId: any) {
      try {
        const response = await fetchImpl(`/api/projects/${encodeURIComponent(projectId)}`, { credentials: "same-origin", headers: requestHeaders({ accept: "application/json" }) });
        if (response.status === 404) return { source: "remote", record: readLocal(projectId) };
        if (!response.ok) throw new Error(`Project load failed: ${response.status}`);
        const record = await safeJson(response);
        writeRemoteCache(record);
        return { source: "remote", record };
      } catch {
        return { source: "local", record: readLocal(projectId) };
      }
    },

    async save({ id, name, activePlanId, snapshot, createdAt, provenance, archivedAt, deletedAt, recoveryUntil, pinned, lastOpenedAt }: any) {
      const correlationId = snapshot.receipts?.at(-1)?.correlationId ?? `project-save-${id}`;
      const previous = readLocal(id);
      const record: any = {
        id,
        organizationId,
        name,
        activePlanId,
        schemaVersion: 10,
        snapshot,
        createdAt: createdAt ?? clock(),
        updatedAt: clock(),
        ...(Number.isInteger(previous?.revision) ? { revision: previous.revision } : {}),
        ...(provenance ?? previous?.provenance ? { provenance: provenance ?? previous.provenance } : {}),
        archivedAt: archivedAt !== undefined ? archivedAt : previous?.archivedAt ?? null,
        deletedAt: deletedAt !== undefined ? deletedAt : previous?.deletedAt ?? null,
        recoveryUntil: recoveryUntil !== undefined ? recoveryUntil : previous?.recoveryUntil ?? null,
        pinned: pinned !== undefined ? pinned : previous?.pinned ?? false,
        lastOpenedAt: lastOpenedAt !== undefined ? lastOpenedAt : previous?.lastOpenedAt ?? null,
      };
      writeLocal(record);
      try {
        const response = await put(record, { createOnly: !Number.isInteger(record.revision), correlationId });
        return await resolveWriteResponse({ response, base: readSyncBase(id) ?? previous, local: record, correlationId });
      } catch (error: any) {
        if (error?.code === "PROJECT_REVISION_CONFLICT") throw error;
        return { source: "local", record };
      }
    },

    async importProject(input: any) {
      const record: any = {
        ...input,
        organizationId,
        schemaVersion: 10,
        updatedAt: clock(),
      };
      if (readLocal(record.id)) {
        const error: any = new Error(`Project already exists: ${record.id}`);
        error.code = "PROJECT_ID_CONFLICT";
        throw error;
      }
      try {
        const response = await put(record, { createOnly: true, correlationId: `project-import-${record.id}` });
        if (response.status === 409) {
          const error: any = new Error(`Project already exists: ${record.id}`);
          error.code = "PROJECT_ID_CONFLICT";
          throw error;
        }
        if (!response.ok) throw new Error(`Project import failed: ${response.status}`);
        const saved = await safeJson(response);
        writeRemoteCache(saved);
        return { status: "created", source: "remote", record: saved };
      } catch (error: any) {
        if (error?.code === "PROJECT_ID_CONFLICT") throw error;
        if (readLocal(record.id)) {
          const conflict: any = new Error(`Project already exists: ${record.id}`);
          conflict.code = "PROJECT_ID_CONFLICT";
          throw conflict;
        }
        writeLocal(record);
        return { status: "created", source: "local", record };
      }
    },

    async updateMetadata(projectId: any, patch: any) {
      const loaded = await this.load(projectId);
      if (!loaded.record) {
        const error: any = new Error(`Project not found: ${projectId}`);
        error.code = "PROJECT_NOT_FOUND";
        throw error;
      }
      const current = loaded.record;
      const next: any = {
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
        const response = await put(next, { createOnly: !Number.isInteger(next.revision), correlationId });
        return await resolveWriteResponse({ response, base: readSyncBase(projectId) ?? current, local: next, correlationId });
      } catch (error: any) {
        if (error?.code === "PROJECT_REVISION_CONFLICT") throw error;
        return { source: "local", record: next };
      }
    },

    async archive(projectId: any, archived: any = true) {
      return this.updateMetadata(projectId, { archivedAt: archived ? clock() : null });
    },

    async pin(projectId: any, pinned: any = true) {
      return this.updateMetadata(projectId, { pinned: Boolean(pinned) });
    },

    async rename(projectId: any, name: any) {
      const normalized = name?.trim();
      if (!normalized) {
        const error: any = new Error("Project name is required");
        error.code = "PROJECT_NAME_REQUIRED";
        throw error;
      }
      return this.updateMetadata(projectId, { name: normalized });
    },

    async softDelete(projectId: any, confirmationName: any) {
      const loaded = await this.load(projectId);
      if (!loaded.record) {
        const error: any = new Error(`Project not found: ${projectId}`);
        error.code = "PROJECT_NOT_FOUND";
        throw error;
      }
      if (confirmationName !== loaded.record.name) {
        const error: any = new Error("Project confirmation does not match");
        error.code = "PROJECT_CONFIRMATION_MISMATCH";
        throw error;
      }
      const deletedAt = clock();
      const recoveryUntil = new Date(Date.parse(deletedAt) + 7 * 24 * 60 * 60 * 1000).toISOString();
      return this.updateMetadata(projectId, { deletedAt, recoveryUntil, archivedAt: null, pinned: false });
    },

    async restoreDeleted(projectId: any) {
      return this.updateMetadata(projectId, { deletedAt: null, recoveryUntil: null });
    },

    acceptRemote(record: any) {
      if (!record || record.organizationId !== organizationId) throw new TypeError("Remote Project does not match active Organization");
      writeRemoteCache(record);
      return record;
    },

    listRecoveries(projectId: any) {
      const recoveries: any = [];
      for (let index = 0; index < (storage?.length ?? 0); index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(`${recoveryPrefix}${projectId}.`)) continue;
        try { recoveries.push({ key, ...JSON.parse(storage.getItem(key)) }); } catch { /* ignore corrupt recovery entry */ }
      }
      return recoveries.sort((left: any, right: any) => String(right.createdAt).localeCompare(String(left.createdAt)));
    },
  };
}
