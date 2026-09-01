const clone: any = (value: any) => value === undefined ? undefined : structuredClone(value);

const comparable: any = (value: any) => JSON.stringify(value ?? null);
const changed: any = (base: any, value: any) => comparable(base) !== comparable(value);

export const PROJECT_MUTABLE_FIELDS = Object.freeze([
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

export function projectEtag(projectId: any, revision: any) {
  if (!projectId || !Number.isInteger(revision) || revision < 1) throw new TypeError("Project ETag requires a stable Project ID and positive revision");
  return `"venuemind:${encodeURIComponent(projectId)}:${revision}"`;
}

export function parseProjectEtag(value: any, projectId: any) {
  const match: any = /^"venuemind:([^:]+):(\d+)"$/.exec(value?.trim() ?? "");
  if (!match || decodeURIComponent(match[1]) !== projectId) return null;
  const revision: any = Number(match[2]);
  return Number.isSafeInteger(revision) && revision > 0 ? revision : null;
}

export function reconcileProjectRecords({ base, local, remote }: any) {
  if (!base || !local || !remote || !Number.isInteger(base.revision) || base.id !== local.id || local.id !== remote.id) {
    return { status: "conflict", kind: "missing-base", overlappingFields: ["snapshot"], localFields: [], remoteFields: [] };
  }
  const localFields: any = PROJECT_MUTABLE_FIELDS.filter((field: any) => changed(base[field], local[field]));
  const remoteFields: any = PROJECT_MUTABLE_FIELDS.filter((field: any) => changed(base[field], remote[field]));
  const overlappingFields: any = localFields.filter((field: any) => remoteFields.includes(field) && changed(local[field], remote[field]));
  if (overlappingFields.length) {
    return {
      status: "conflict",
      kind: overlappingFields.some((field: any) => field === "snapshot" || field === "activePlanId") ? "planning" : "metadata",
      overlappingFields,
      localFields,
      remoteFields,
    };
  }
  const merged: any = clone(remote);
  for (const field of localFields) merged[field] = clone(local[field]);
  return { status: "merged", record: merged, localFields, remoteFields, overlappingFields: [] };
}

export function projectConflictData({ base, local, remote, analysis }: any) {
  return {
    kind: analysis.kind,
    projectId: local.id,
    baseRevision: base?.revision ?? null,
    localRevision: local.revision ?? null,
    remoteRevision: remote.revision,
    overlappingFields: analysis.overlappingFields,
    localFields: analysis.localFields,
    remoteFields: analysis.remoteFields,
    resolutions: analysis.kind === "planning" ? ["recover-proposal-branch", "use-remote"] : ["use-remote", "preserve-project-copy"],
    base: clone(base),
    local: clone(local),
    remote: clone(remote),
  };
}
