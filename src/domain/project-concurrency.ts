import type { LocalProjectRecord, ProjectConflict, ProjectMutableField, ProjectRecord } from "./project-types.ts";

const clone = <T>(value: T): T => structuredClone(value);

const comparable = (value: unknown): string => JSON.stringify(value ?? null);
const changed = (base: unknown, value: unknown): boolean => comparable(base) !== comparable(value);

export const PROJECT_MUTABLE_FIELDS: readonly ProjectMutableField[] = Object.freeze([
  "name",
  "activePlanId",
  "snapshot",
  "provenance",
  "archivedAt",
  "deletedAt",
  "recoveryUntil",
  "pinned",
  "lastOpenedAt",
]);

export function projectEtag(projectId: string, revision: number): string {
  if (!projectId || !Number.isInteger(revision) || revision < 1)
    throw new TypeError("Project ETag requires a stable Project ID and positive revision");
  return `"venuemind:${encodeURIComponent(projectId)}:${revision}"`;
}

export function parseProjectEtag(value: string | null | undefined, projectId: string): number | null {
  const match = /^"venuemind:([^:]+):(\d+)"$/.exec(value?.trim() ?? "");
  if (!match || !match[1] || decodeURIComponent(match[1]) !== projectId) return null;
  const revision = Number(match[2]);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

export type ProjectMergeAnalysis =
  | {
      status: "conflict";
      kind: "missing-base" | "planning" | "metadata";
      overlappingFields: ProjectMutableField[];
      localFields: ProjectMutableField[];
      remoteFields: ProjectMutableField[];
    }
  | {
      status: "merged";
      record: LocalProjectRecord;
      localFields: ProjectMutableField[];
      remoteFields: ProjectMutableField[];
      overlappingFields: [];
    };

const fieldValue = (record: LocalProjectRecord, field: ProjectMutableField): unknown => record[field];

export function reconcileProjectRecords({
  base,
  local,
  remote,
}: {
  base: LocalProjectRecord | null;
  local: LocalProjectRecord;
  remote: ProjectRecord;
}): ProjectMergeAnalysis {
  if (
    !base ||
    !local ||
    !remote ||
    !Number.isInteger(base.revision) ||
    base.id !== local.id ||
    local.id !== remote.id
  ) {
    return {
      status: "conflict",
      kind: "missing-base",
      overlappingFields: ["snapshot"],
      localFields: [],
      remoteFields: [],
    };
  }
  const localFields = PROJECT_MUTABLE_FIELDS.filter((field) =>
    changed(fieldValue(base, field), fieldValue(local, field)),
  );
  const remoteFields = PROJECT_MUTABLE_FIELDS.filter((field) =>
    changed(fieldValue(base, field), fieldValue(remote, field)),
  );
  const overlappingFields = localFields.filter(
    (field) => remoteFields.includes(field) && changed(fieldValue(local, field), fieldValue(remote, field)),
  );
  if (overlappingFields.length) {
    return {
      status: "conflict",
      kind: overlappingFields.some((field) => field === "snapshot" || field === "activePlanId")
        ? "planning"
        : "metadata",
      overlappingFields,
      localFields,
      remoteFields,
    };
  }
  let merged: LocalProjectRecord = clone(remote);
  for (const field of localFields) {
    if (field === "name") merged = { ...merged, name: local.name };
    else if (field === "activePlanId") merged = { ...merged, activePlanId: local.activePlanId };
    else if (field === "snapshot") merged = { ...merged, snapshot: clone(local.snapshot) };
    else if (field === "provenance")
      merged = local.provenance
        ? { ...merged, provenance: clone(local.provenance) }
        : (() => {
            const { provenance: _provenance, ...without } = merged;
            return without;
          })();
    else if (field === "archivedAt") merged = { ...merged, archivedAt: local.archivedAt };
    else if (field === "deletedAt") merged = { ...merged, deletedAt: local.deletedAt };
    else if (field === "recoveryUntil") merged = { ...merged, recoveryUntil: local.recoveryUntil };
    else if (field === "pinned") merged = { ...merged, pinned: local.pinned };
    else if (field === "lastOpenedAt") merged = { ...merged, lastOpenedAt: local.lastOpenedAt };
  }
  return { status: "merged", record: merged, localFields, remoteFields, overlappingFields: [] };
}

export function projectConflictData({
  base,
  local,
  remote,
  analysis,
}: {
  base: LocalProjectRecord | null;
  local: LocalProjectRecord;
  remote: ProjectRecord;
  analysis: Extract<ProjectMergeAnalysis, { status: "conflict" }>;
}): ProjectConflict {
  return {
    kind: analysis.kind,
    projectId: local.id,
    baseRevision: base?.revision ?? null,
    localRevision: local.revision ?? null,
    remoteRevision: remote.revision,
    overlappingFields: analysis.overlappingFields,
    localFields: analysis.localFields,
    remoteFields: analysis.remoteFields,
    resolutions:
      analysis.kind === "planning"
        ? ["recover-proposal-branch", "use-remote"]
        : ["use-remote", "preserve-project-copy"],
    base: clone(base),
    local: clone(local),
    remote: clone(remote),
  };
}
