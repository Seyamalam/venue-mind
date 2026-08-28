import { fingerprintPlan } from "../domain/activity-ledger.js";
import { AdapterContractError, assertIsoTimestamp, normalizeAdapterChange, normalizeExternalReference, normalizeSyncCursor, sha256Checksum } from "./contracts.js";

const clone = (value) => structuredClone(value);

const fail = (code, message, details) => {
  throw new AdapterContractError(code, message, details);
};

const proposalChange = (change, index) => {
  const venueObjectId = change.operation === "create" ? change.proposedVenueObjectId : change.venueObjectId;
  if (change.venueEntityType === "event-brief-requirement") {
    const planningEffects = clone(change.planningEffects);
    const label = planningEffects[0].requirement.label;
    return Object.freeze({
      id: change.id,
      number: index + 1,
      title: `Synchronize ${label}`,
      shortTitle: `update ${label}`,
      metrics: [],
      targetObjectIds: [],
      targetRequirementIds: [venueObjectId],
      spatialEffects: [],
      planningEffects,
      effects: {},
    });
  }
  const values = clone(change.values ?? {});
  if (Object.hasOwn(values, "id")) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Adapter values cannot override a VenueMind stable ID", { changeId: change.id });
  if (change.operation === "update") {
    const protectedFields = ["id", "kind", "locked", "locks", "templateRef", "templateOverrides"].filter((field) => Object.hasOwn(values, field));
    if (protectedFields.length) fail("ADAPTER_PROTECTED_FIELD", "Adapter updates cannot change identity, Lock, or template-binding fields", { changeId: change.id, fields: protectedFields });
  }
  const spatialEffects = [];
  if (change.operation === "create") spatialEffects.push({ operation: "add_object", object: { ...values, id: venueObjectId } });
  if (change.operation === "update") {
    const { footprint, ...metadata } = values;
    if (footprint) spatialEffects.push({ operation: "update_footprint", objectId: venueObjectId, footprint });
    if (Object.keys(metadata).length) spatialEffects.push({ operation: "update_metadata", objectId: venueObjectId, values: metadata });
  }
  if (change.operation === "delete") spatialEffects.push({ operation: "delete_object", objectId: venueObjectId });
  if (spatialEffects.length === 0) fail("ADAPTER_CHANGE_EMPTY", "Adapter change must produce at least one executable spatial effect", { changeId: change.id });
  const label = values.label ?? change.external.externalId;
  return Object.freeze({
    id: change.id,
    number: index + 1,
    title: `Synchronize ${label}`,
    shortTitle: `${change.operation} ${label}`,
    metrics: [],
    targetObjectIds: [venueObjectId],
    spatialEffects,
    effects: {
      adapterOperation: change.operation,
      sourceSystem: change.external.sourceSystem,
      sourceVersion: change.external.sourceVersion,
      externalId: change.external.externalId,
      sourceChecksum: change.external.checksum,
    },
  });
};

export function createExternalIdMapping({ venueEntityType, venueObjectId, external, batchId, sourceSystem, sourceVersion, synchronizedAt, checksum }) {
  if (!["event-brief-requirement", "inventory-item-template", "project", "project-object-instance"].includes(venueEntityType)) fail("ADAPTER_ENTITY_TYPE_INVALID", "Venue entity type is invalid", { venueEntityType });
  if (typeof venueObjectId !== "string" || !venueObjectId) fail("ADAPTER_CONTRACT_INVALID", "VenueMind stable ID is required");
  if (typeof external?.externalId !== "string" || !external.externalId) fail("ADAPTER_CONTRACT_INVALID", "External reference is required");
  if (typeof batchId !== "string" || !batchId || typeof sourceSystem !== "string" || !sourceSystem || typeof sourceVersion !== "string" || !sourceVersion) fail("ADAPTER_MAPPING_EVIDENCE_INVALID", "Mapping source evidence is required");
  if (!/^[0-9a-f]{64}$/.test(checksum ?? "")) fail("ADAPTER_CHECKSUM_INVALID", "Mapping checksum must be a lowercase SHA-256 digest");
  if (venueObjectId === external.externalId) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "External IDs and VenueMind stable IDs must not be conflated", { venueObjectId, externalId: external.externalId });
  if (sourceSystem !== external.sourceSystem || sourceVersion !== external.sourceVersion || checksum !== external.checksum) fail("ADAPTER_MAPPING_EVIDENCE_MISMATCH", "Mapping evidence must match its external source reference", { venueObjectId });
  assertIsoTimestamp(synchronizedAt, "Mapping synchronizedAt");
  return Object.freeze({ schemaVersion: 1, venueEntityType, venueObjectId, external: clone(external), batchId, sourceSystem, sourceVersion, synchronizedAt, checksum });
}

export async function createAdapterStagingBatch(definition, input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("ADAPTER_CONTRACT_INVALID", "Adapter import result must be an object");
  const unknown = Object.keys(input).filter((key) => !["sourceSystem", "sourceVersion", "synchronizedAt", "syncCursor", "changes", "mappings", "sourceRecords", "warnings"].includes(key));
  if (unknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Adapter import result contains unknown fields", { fields: unknown.sort() });
  for (const field of ["sourceSystem", "sourceVersion"]) if (typeof input[field] !== "string" || !input[field]) fail("ADAPTER_CONTRACT_INVALID", `Import ${field} is required`);
  assertIsoTimestamp(input.synchronizedAt, "Import synchronizedAt");
  if (typeof options.basePlanVersion !== "string" || !options.basePlanVersion) fail("ADAPTER_BASE_PLAN_VERSION_REQUIRED", "Adapter staging requires exactly one base Plan Version");
  if (!Number.isInteger(options.proposalRevision) || options.proposalRevision < 1) fail("ADAPTER_PROPOSAL_REVISION_REQUIRED", "Adapter staging requires a positive Proposal revision");
  if (!Array.isArray(input.changes)) fail("ADAPTER_CONTRACT_INVALID", "Import changes must be an array");
  const changes = input.changes.map((change) => normalizeAdapterChange(change, definition));
  const ids = changes.map((change) => change.id);
  if (new Set(ids).size !== ids.length) fail("ADAPTER_CHANGE_DUPLICATE", "Adapter change IDs must be unique");
  if (changes.some((change) => change.external.sourceSystem !== input.sourceSystem)) fail("ADAPTER_SOURCE_MISMATCH", "Every imported Change must belong to the batch source system");
  const proposedIds = changes.filter((change) => change.operation === "create").map((change) => change.proposedVenueObjectId);
  if (new Set(proposedIds).size !== proposedIds.length) fail("ADAPTER_STABLE_ID_DUPLICATE", "Proposed VenueMind stable IDs must be unique");
  const syncCursor = normalizeSyncCursor(input.syncCursor, definition);
  const sourceRecords = (input.sourceRecords ?? []).map((record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) fail("ADAPTER_CONTRACT_INVALID", "Source record evidence must be an object");
    const recordUnknown = Object.keys(record).filter((key) => !["external", "synchronizedAt", "descriptive"].includes(key));
    if (recordUnknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Source record evidence contains unknown fields", { fields: recordUnknown.sort() });
    const external = normalizeExternalReference(record.external, definition);
    assertIsoTimestamp(record.synchronizedAt, "Source record synchronizedAt");
    const descriptive = record.descriptive ?? {};
    const descriptiveUnknown = Object.keys(descriptive).filter((key) => !["title", "location", "organizer"].includes(key));
    if (descriptiveUnknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Source record descriptive evidence contains unknown fields", { fields: descriptiveUnknown.sort() });
    if (typeof descriptive.title !== "string" || !descriptive.title) fail("ADAPTER_SOURCE_INVALID", "Source record title is required");
    const locationUnknown = Object.keys(descriptive.location ?? {}).filter((key) => key !== "label");
    const organizerUnknown = Object.keys(descriptive.organizer ?? {}).filter((key) => !["displayName", "organization", "role"].includes(key));
    if (locationUnknown.length || organizerUnknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Source record descriptive metadata contains unknown fields", { fields: [...locationUnknown, ...organizerUnknown].sort() });
    if (typeof descriptive.location?.label !== "string" || !descriptive.location.label || typeof descriptive.organizer?.displayName !== "string" || !descriptive.organizer.displayName) fail("ADAPTER_SOURCE_INVALID", "Source record location and organizer labels are required");
    for (const value of Object.values(descriptive.organizer)) if (typeof value !== "string" || !value || value.includes("@")) fail("ADAPTER_SOURCE_INVALID", "Organizer metadata must contain labels and no contact PII");
    return Object.freeze({ external, synchronizedAt: record.synchronizedAt, descriptive: clone(descriptive) });
  });
  const mappingDrafts = input.mappings ?? changes.map((change) => ({ venueEntityType: change.venueEntityType, venueObjectId: change.operation === "create" ? change.proposedVenueObjectId : change.venueObjectId, external: change.external }));
  if (!Array.isArray(mappingDrafts)) fail("ADAPTER_CONTRACT_INVALID", "Import mappings must be an array");
  const content = { adapterId: definition.id, adapterVersion: definition.version, sourceSystem: input.sourceSystem, sourceVersion: input.sourceVersion, synchronizedAt: input.synchronizedAt, basePlanVersion: options.basePlanVersion, proposalRevision: options.proposalRevision, syncCursor, changes, mappings: clone(mappingDrafts), sourceRecords: clone(sourceRecords), warnings: clone(input.warnings ?? []) };
  const checksum = await sha256Checksum(content);
  const batchId = options.batchId ?? `adapter-batch-${checksum.slice(0, 16)}`;
  const proposal = Object.freeze({
    id: `proposal-adapter-${checksum.slice(0, 16)}`,
    revision: options.proposalRevision,
    baseVersion: options.basePlanVersion,
    status: "review",
    goal: `Synchronize ${input.sourceSystem} ${input.sourceVersion}`,
    changes: clone(changes.map(proposalChange)),
    validation: null,
    waivers: [],
  });
  const mappings = mappingDrafts.map((mapping) => createExternalIdMapping({
    venueEntityType: mapping.venueEntityType,
    venueObjectId: mapping.venueObjectId,
    external: mapping.external,
    batchId,
    sourceSystem: input.sourceSystem,
    sourceVersion: mapping.external.sourceVersion,
    synchronizedAt: input.synchronizedAt,
    checksum: mapping.external.checksum,
  }));
  return Object.freeze({ schemaVersion: 1, id: batchId, status: "awaiting-review", adapterId: definition.id, adapterVersion: definition.version, sourceSystem: input.sourceSystem, sourceVersion: input.sourceVersion, synchronizedAt: input.synchronizedAt, basePlanVersion: options.basePlanVersion, checksum, syncCursor, mappings: clone(mappings), sourceRecords: clone(sourceRecords), warnings: clone(input.warnings ?? []), proposal });
}

export function assertReviewableStagingBatch(batch) {
  if (batch?.status !== "awaiting-review" || batch?.proposal?.status !== "review") fail("ADAPTER_REVIEW_BYPASS", "Imported changes must remain a review Proposal until human Approval");
  if (!batch.proposal.id || !Number.isInteger(batch.proposal.revision) || batch.proposal.baseVersion !== batch.basePlanVersion || !Array.isArray(batch.proposal.changes)) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch does not contain a canonical Proposal");
  if (batch.proposal.changes.some((change) => !change.id || !Number.isInteger(change.number) || !Array.isArray(change.targetObjectIds) || (!change.spatialEffects?.length && !change.planningEffects?.length) || (change.targetObjectIds.length === 0 && !change.planningEffects?.length))) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch contains a non-executable Change");
  if (!batch.sourceSystem || !batch.sourceVersion || !batch.checksum) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch source evidence is incomplete");
  if (!/^[0-9a-f]{64}$/.test(batch.checksum) || !Array.isArray(batch.mappings) || batch.mappings.some((mapping) => mapping.sourceSystem !== batch.sourceSystem || mapping.synchronizedAt !== batch.synchronizedAt || !/^[0-9a-f]{64}$/.test(mapping.checksum ?? ""))) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch mapping evidence is invalid");
  assertIsoTimestamp(batch.synchronizedAt, "Staging batch synchronizedAt");
  return true;
}

export function loadAdapterProposalForReview(planner, batch) {
  assertReviewableStagingBatch(batch);
  if (!planner || typeof planner.getSnapshot !== "function" || typeof planner.execute !== "function") fail("ADAPTER_PLANNER_REQUIRED", "A VenuePlanner instance is required");
  const snapshot = planner.getSnapshot();
  const beforePlanFingerprint = fingerprintPlan(snapshot.plan);
  if (snapshot.plan.version !== batch.proposal.baseVersion) fail("ADAPTER_BASE_PLAN_VERSION_CONFLICT", "Adapter Proposal base Version is stale", { expected: snapshot.plan.version, actual: batch.proposal.baseVersion });
  if (batch.proposal.revision !== snapshot.proposal.revision + 1) fail("ADAPTER_PROPOSAL_REVISION_CONFLICT", "Adapter Proposal revision must follow the current Proposal revision", { expected: snapshot.proposal.revision + 1, actual: batch.proposal.revision });
  const activeBranch = snapshot.branches.find((branch) => branch.id === snapshot.activeBranchId);
  if (!activeBranch) fail("ADAPTER_ACTIVE_BRANCH_MISSING", "The active Proposal Branch is unavailable");
  const revisions = [...(activeBranch.revisions ?? [])];
  if (activeBranch.proposal?.id !== batch.proposal.id) revisions.push(clone(activeBranch.proposal));
  planner.execute({ type: "restore_snapshot", snapshot: { ...snapshot, proposal: clone(batch.proposal), branches: snapshot.branches.map((branch) => branch.id === snapshot.activeBranchId ? { ...branch, proposal: clone(batch.proposal), revisions } : branch) } });
  const after = planner.getSnapshot();
  if (fingerprintPlan(after.plan) !== beforePlanFingerprint) fail("ADAPTER_ACCEPTED_PLAN_MUTATED", "Adapter staging changed accepted Plan truth");
  return Object.freeze({ status: "review", proposalId: after.proposal.id, revision: after.proposal.revision, baseVersion: after.proposal.baseVersion, changedItems: after.proposal.changes.length, requiresHumanApproval: true });
}
