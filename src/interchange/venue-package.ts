import { verifyActivityLedger } from "../domain/activity-ledger.ts";
import { createVenuePlanner } from "../domain/venue-planner.ts";
import { detectLockConflicts } from "../domain/locks.ts";

export const VENUE_PACKAGE_FORMAT = "venuemind-project";
export const VENUE_PACKAGE_VERSION = 1;
export const MAX_VENUE_PACKAGE_BYTES = 2_000_000;

const clone = (value: any) => JSON.parse(JSON.stringify(value));
const encoder = new TextEncoder();

const stableStringify = (value: any): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key: any) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

const sha256 = async (value: any) => {
  if (!globalThis.crypto?.subtle) throw new VenueImportError("IMPORT_CRYPTO_UNAVAILABLE", "SHA-256 is unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte: any) => byte.toString(16).padStart(2, "0")).join("");
};

export class VenueImportError extends Error {
  readonly code: string;
  readonly details: any;

  constructor(code: any, message: any, details: any = {}) {
    super(message);
    this.name = "VenueImportError";
    this.code = code;
    this.details = details;
  }
}

const assertExactKeys = (value: any, allowed: any, scope: any) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new VenueImportError("IMPORT_INVALID_STRUCTURE", `${scope} must be an object`);
  const unknown = Object.keys(value).filter((key: any) => !allowed.includes(key));
  if (unknown.length) throw new VenueImportError("IMPORT_UNKNOWN_FIELD", `Unknown ${scope} field: ${unknown[0]}`, { scope, fields: unknown.sort() });
};

const assertRequired = (value: any, fields: any, scope: any) => {
  const missing = fields.filter((field: any) => value[field] === undefined || value[field] === null);
  if (missing.length) throw new VenueImportError("IMPORT_INVALID_STRUCTURE", `Missing ${scope} field: ${missing[0]}`, { scope, fields: missing });
};

const FORBIDDEN_KEYS: any = new Set(["__proto__", "prototype", "constructor", "commands", "mutations", "deleteProject", "approveProposal"]);

const assertNoControlPayload = (value: any, path: any = "package") => {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new VenueImportError("IMPORT_FORBIDDEN_FIELD", `Forbidden import field: ${path}.${key}`, { path: `${path}.${key}` });
    assertNoControlPayload(child, `${path}.${key}`);
  }
};

const assertUniqueIds = (items: any, scope: any) => {
  const ids: any = new Set();
  for (const item of items ?? []) {
    if (!item?.id || typeof item.id !== "string") throw new VenueImportError("IMPORT_INVALID_STRUCTURE", `${scope} requires stable IDs`);
    if (ids.has(item.id)) throw new VenueImportError("IMPORT_DUPLICATE_ID", `Duplicate stable ID in ${scope}: ${item.id}`, { scope, id: item.id });
    ids.add(item.id);
  }
};

const proposalList = (snapshot: any) => [snapshot.proposal, ...(snapshot.branches ?? []).map((branch: any) => branch.proposal)].filter(Boolean);

const assertStableIds = (snapshot: any) => {
  assertUniqueIds(snapshot.plan?.objects, "Plan objects");
  assertUniqueIds(snapshot.plan?.constraints, "Constraints");
  assertUniqueIds(snapshot.plan?.waivers, "Accepted Plan Warning Waivers");
  assertUniqueIds(snapshot.branches, "Proposal Branches");
  assertUniqueIds(snapshot.ledger, "Activity Ledger");
  assertUniqueIds(snapshot.receipts, "Command Receipts");
  assertUniqueIds(snapshot.projectLocks, "Project Locks");
  assertUniqueIds(snapshot.comments, "Comments");
  assertUniqueIds(snapshot.scenarios, "Scenarios");
  assertUniqueIds(snapshot.scenarioRuns, "Simulation Runs");
  for (const object of snapshot.plan?.objects ?? []) assertUniqueIds(object.locks, `Object ${object.id} Locks`);
  for (const proposal of proposalList(snapshot)) {
    assertUniqueIds(proposal.changes, `Proposal ${proposal.id} Changes`);
    assertUniqueIds(proposal.waivers, `Proposal ${proposal.id} Warning Waivers`);
  }
};

const assertNoLockedProposalMutation = (snapshot: any) => {
  const evidencedProjectLocks: any = new Set((snapshot.projectLocks ?? []).filter((lock: any) => {
    if (lock.source !== "project") return false;
    return (snapshot.ledger ?? []).some((entry: any) => entry.type === "object.lock_added"
      && entry.details?.lockId === lock.id
      && entry.details?.objectId === lock.objectId
      && entry.details?.lockType === lock.type
      && entry.details?.source === lock.source
      && entry.details?.reasonCode === lock.reasonCode
      && entry.details?.authorId === lock.authorId);
  }).map((lock: any) => lock.id));
  const conflicts: any = [];
  for (const proposal of proposalList(snapshot)) {
    conflicts.push(...detectLockConflicts(snapshot.plan, proposal.changes ?? [], snapshot.projectLocks ?? [])
      .filter((conflict: any) => conflict.source !== "project" || !evidencedProjectLocks.has(conflict.lockId))
      .map((conflict: any) => ({ proposalId: proposal.id, ...conflict })));
  }
  if (conflicts.length) throw new VenueImportError("LOCK_CONFLICT", `Imported Proposal Change conflicts with an active Lock: ${conflicts[0].objectId}`, { conflicts });
};

const seedForRecord = (record: any) => {
  const snapshot = record.snapshot;
  if (!snapshot?.plan?.spatial) throw new VenueImportError("IMPORT_INVALID_PROJECT", "Project snapshot requires canonical spatial geometry");
  return { ...clone(snapshot.plan), brief: clone(snapshot.brief), proposal: clone(snapshot.proposal) };
};

const parsePackage = (input: any) => {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input);
  const bytes = encoder.encode(text).byteLength;
  if (bytes > MAX_VENUE_PACKAGE_BYTES) throw new VenueImportError("IMPORT_TOO_LARGE", `Import exceeds ${MAX_VENUE_PACKAGE_BYTES} bytes`, { bytes, maximumBytes: MAX_VENUE_PACKAGE_BYTES });
  let packageValue;
  try {
    packageValue = JSON.parse(text);
  } catch {
    throw new VenueImportError("IMPORT_INVALID_JSON", "Import is not valid JSON");
  }
  return { text, bytes, packageValue };
};

const assertEnvelope = (packageValue: any) => {
  assertExactKeys(packageValue, ["format", "formatVersion", "manifest", "project"], "package");
  assertRequired(packageValue, ["format", "formatVersion", "manifest", "project"], "package");
  if (packageValue.format !== VENUE_PACKAGE_FORMAT) throw new VenueImportError("IMPORT_UNSUPPORTED_FORMAT", `Unsupported import format: ${packageValue.format}`);
  if (packageValue.formatVersion !== VENUE_PACKAGE_VERSION) throw new VenueImportError("IMPORT_UNSUPPORTED_VERSION", `Unsupported import version: ${packageValue.formatVersion}`);
  assertExactKeys(packageValue.manifest, ["packageId", "exportedAt", "payloadBytes", "payloadSha256", "manifestSha256", "source"], "manifest");
  assertRequired(packageValue.manifest, ["packageId", "exportedAt", "payloadBytes", "payloadSha256", "manifestSha256", "source"], "manifest");
  assertExactKeys(packageValue.manifest.source, ["application", "applicationVersion", "projectId", "projectSchemaVersion", "external"], "manifest source");
  assertRequired(packageValue.manifest.source, ["application", "projectId", "projectSchemaVersion"], "manifest source");
  assertExactKeys(packageValue.project, ["id", "name", "activePlanId", "schemaVersion", "snapshot", "createdAt", "updatedAt", "provenance"], "project");
  assertRequired(packageValue.project, ["id", "name", "activePlanId", "schemaVersion", "snapshot", "createdAt", "updatedAt"], "project");
  assertExactKeys(packageValue.project.snapshot, ["plan", "brief", "proposal", "activeBranchId", "branches", "ledger", "receipts", "projectLocks", "editHistory", "comments", "scenarios", "scenarioRuns"], "planner snapshot");
  assertRequired(packageValue.project.snapshot, ["plan", "brief", "proposal", "activeBranchId", "branches", "ledger", "receipts"], "planner snapshot");
  if (packageValue.project.schemaVersion !== 10) {
    throw new VenueImportError("IMPORT_UNSUPPORTED_PROJECT_SCHEMA", `Unsupported Project schema: ${packageValue.project.schemaVersion}`);
  }
  if (packageValue.project.id !== packageValue.manifest.source.projectId) throw new VenueImportError("IMPORT_SOURCE_MISMATCH", "Manifest Project ID does not match payload Project ID");
  if (packageValue.project.schemaVersion !== packageValue.manifest.source.projectSchemaVersion) throw new VenueImportError("IMPORT_SOURCE_MISMATCH", "Manifest schema version does not match payload schema version");
  assertNoControlPayload(packageValue);
};

export async function exportProjectPackage(record: any, { clock = () => new Date().toISOString(), sourceMetadata = null }: any = {}) {
  if (record?.schemaVersion !== 10) throw new VenueImportError("EXPORT_UNSUPPORTED_PROJECT_SCHEMA", `Unsupported Project schema: ${record?.schemaVersion ?? "missing"}`, { supportedSchemaVersion: 10 });
  const { organizationId: _organizationId, revision: _revision, archivedAt: _archivedAt, deletedAt: _deletedAt, recoveryUntil: _recoveryUntil, pinned: _pinned, lastOpenedAt: _lastOpenedAt, ...portableRecord } = record;
  const project = clone(portableRecord);
  const payload = stableStringify(project);
  const payloadBytes = encoder.encode(payload).byteLength;
  if (payloadBytes > MAX_VENUE_PACKAGE_BYTES) throw new VenueImportError("EXPORT_TOO_LARGE", `Project exceeds ${MAX_VENUE_PACKAGE_BYTES} bytes`, { payloadBytes, maximumBytes: MAX_VENUE_PACKAGE_BYTES });
  const payloadSha256 = await sha256(payload);
  const manifestValue: any = {
    exportedAt: clock(),
    payloadBytes,
    payloadSha256,
    source: {
      application: "VenueMind",
      applicationVersion: "0.1.0",
      projectId: project.id,
      projectSchemaVersion: project.schemaVersion,
      ...(sourceMetadata ? { external: clone(sourceMetadata) } : {}),
    },
  };
  const manifestSha256 = await sha256(stableStringify(manifestValue));
  const manifest: any = { packageId: `package-${manifestSha256.slice(0, 16)}`, ...manifestValue, manifestSha256 };
  const packageValue: any = { format: VENUE_PACKAGE_FORMAT, formatVersion: VENUE_PACKAGE_VERSION, manifest, project };
  return { format: VENUE_PACKAGE_FORMAT, filename: `${project.id}.venuemind.json`, payload, package: clone(packageValue), content: `${JSON.stringify(packageValue, null, 2)}\n` };
}

export async function previewProjectImport(input: any, { clock = () => new Date().toISOString() }: any = {}) {
  const { bytes, packageValue } = parsePackage(input);
  assertEnvelope(packageValue);
  const payload = stableStringify(packageValue.project);
  const payloadBytes = encoder.encode(payload).byteLength;
  const payloadSha256 = await sha256(payload);
  const { packageId: _packageId, manifestSha256: _manifestSha256, ...manifestValue } = packageValue.manifest;
  const manifestSha256 = await sha256(stableStringify(manifestValue));
  if (manifestSha256 !== packageValue.manifest.manifestSha256 || packageValue.manifest.packageId !== `package-${manifestSha256.slice(0, 16)}`) {
    throw new VenueImportError("IMPORT_MANIFEST_CHECKSUM_MISMATCH", "Package manifest checksum does not match", { expected: packageValue.manifest.manifestSha256, actual: manifestSha256 });
  }
  if (payloadBytes !== packageValue.manifest.payloadBytes || payloadSha256 !== packageValue.manifest.payloadSha256) {
    throw new VenueImportError("IMPORT_CHECKSUM_MISMATCH", "Project payload checksum does not match the manifest", { expected: packageValue.manifest.payloadSha256, actual: payloadSha256 });
  }

  assertStableIds(packageValue.project.snapshot);
  assertNoLockedProposalMutation(packageValue.project.snapshot);
  let planner;
  try {
    planner = createVenuePlanner(seedForRecord(packageValue.project));
    planner.execute({ type: "restore_snapshot", snapshot: packageValue.project.snapshot });
  } catch (error: any) {
    if (error instanceof VenueImportError) throw error;
    const message = error instanceof Error ? error.message : "Invalid imported Project";
    const code = /geometry|footprint|boundary|polygon|room/i.test(message) ? "IMPORT_GEOMETRY_INVALID" : /ledger|integrity|hash/i.test(message) ? "IMPORT_LEDGER_INVALID" : "IMPORT_INVALID_PROJECT";
    throw new VenueImportError(code, message);
  }

  const snapshot = clone(planner.getSnapshot());
  const replay = planner.execute({ type: "replay_history" });
  if (replay.status !== "pass") throw new VenueImportError("IMPORT_REPLAY_FAILED", "Imported Activity Ledger does not reproduce the accepted Plan", { replay });
  const validation = planner.execute({ type: "validate_layout" });
  const record: any = {
    ...clone(packageValue.project),
    snapshot,
    provenance: {
      sourceFormat: packageValue.format,
      formatVersion: packageValue.formatVersion,
      packageId: packageValue.manifest.packageId,
      payloadSha256: packageValue.manifest.payloadSha256,
      exportedAt: packageValue.manifest.exportedAt,
      importedAt: clock(),
      originalProjectId: packageValue.project.id,
      source: clone(packageValue.manifest.source),
    },
  };

  return {
    status: "ready",
    packageId: packageValue.manifest.packageId,
    inputBytes: bytes,
    record,
    summary: {
      projectId: record.id,
      projectName: record.name,
      planId: snapshot.plan.id,
      planVersion: snapshot.plan.version,
      objects: snapshot.plan.objects.length,
      constraints: snapshot.plan.constraints.length,
      branches: snapshot.branches.length,
      ledgerEntries: snapshot.ledger.length,
      validationStatus: validation.status,
    },
    integrity: { checksum: "pass", schema: "pass", ledger: verifyActivityLedger(snapshot.ledger).status, replay: replay.status, ledgerHeadHash: replay.ledgerHeadHash, planFingerprint: replay.currentFingerprint },
  };
}
