import { AdapterContractError, normalizeAdapterChange, normalizeSyncCursor, sha256Checksum } from "./contracts.js";

const clone = (value) => structuredClone(value);

const fail = (code, message, details) => {
  throw new AdapterContractError(code, message, details);
};

export async function createAdapterStagingBatch(definition, input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("ADAPTER_CONTRACT_INVALID", "Adapter import result must be an object");
  const unknown = Object.keys(input).filter((key) => !["sourceVersion", "syncCursor", "changes", "warnings"].includes(key));
  if (unknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Adapter import result contains unknown fields", { fields: unknown.sort() });
  if (typeof input.sourceVersion !== "string" || !input.sourceVersion) fail("ADAPTER_CONTRACT_INVALID", "Import sourceVersion is required");
  if (!Array.isArray(input.changes)) fail("ADAPTER_CONTRACT_INVALID", "Import changes must be an array");
  const changes = input.changes.map((change) => normalizeAdapterChange(change, definition));
  const ids = changes.map((change) => change.id);
  if (new Set(ids).size !== ids.length) fail("ADAPTER_CHANGE_DUPLICATE", "Adapter change IDs must be unique");
  const externalKeys = changes.map((change) => `${change.external.entityType}\u0000${change.external.externalId}`);
  if (new Set(externalKeys).size !== externalKeys.length) fail("ADAPTER_EXTERNAL_ID_DUPLICATE", "An external entity may appear only once in a staging batch");
  const proposedIds = changes.filter((change) => change.operation === "create").map((change) => change.proposedVenueObjectId);
  if (new Set(proposedIds).size !== proposedIds.length) fail("ADAPTER_STABLE_ID_DUPLICATE", "Proposed VenueMind stable IDs must be unique");
  const syncCursor = normalizeSyncCursor(input.syncCursor, definition);
  const content = { adapterId: definition.id, adapterVersion: definition.version, sourceVersion: input.sourceVersion, syncCursor, changes, warnings: clone(input.warnings ?? []) };
  const checksum = await sha256Checksum(content);
  const batchId = options.batchId ?? `adapter-batch-${checksum.slice(0, 16)}`;
  const stagedAt = options.clock?.() ?? new Date().toISOString();
  return Object.freeze({
    schemaVersion: 1,
    id: batchId,
    status: "awaiting-review",
    adapterId: definition.id,
    adapterVersion: definition.version,
    sourceVersion: input.sourceVersion,
    syncCursor,
    checksum,
    stagedAt,
    changes: clone(changes),
    warnings: clone(input.warnings ?? []),
    proposal: Object.freeze({
      schemaVersion: 1,
      basePlanVersion: options.basePlanVersion ?? null,
      status: "draft",
      requiresHumanApproval: true,
      source: { kind: "adapter-staging", adapterId: definition.id, adapterVersion: definition.version, batchId, checksum },
      changes: clone(changes),
    }),
  });
}

export function assertReviewableStagingBatch(batch) {
  if (batch?.status !== "awaiting-review" || batch?.proposal?.status !== "draft" || batch?.proposal?.requiresHumanApproval !== true) {
    fail("ADAPTER_REVIEW_BYPASS", "Imported changes must remain in a draft Proposal until human review");
  }
  if (batch.proposal.source?.checksum !== batch.checksum || batch.proposal.source?.batchId !== batch.id) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Proposal source does not match its staging batch");
  return true;
}

export function createExternalIdMapping({ venueObjectId, external, batchId, synchronizedAt }) {
  if (typeof venueObjectId !== "string" || !venueObjectId) fail("ADAPTER_CONTRACT_INVALID", "VenueMind stable ID is required");
  if (typeof external?.externalId !== "string" || !external.externalId) fail("ADAPTER_CONTRACT_INVALID", "External reference is required");
  if (venueObjectId === external.externalId) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "External IDs and VenueMind stable IDs must not be conflated", { venueObjectId, externalId: external.externalId });
  return Object.freeze({ schemaVersion: 1, venueObjectId, external: clone(external), batchId, synchronizedAt });
}
