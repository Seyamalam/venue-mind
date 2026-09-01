import { fingerprintEventBrief, fingerprintPlan } from "../domain/activity-ledger.js";
import { assertPlanningEffectBinding, normalizePlanningEffect } from "../domain/planning-effects.js";
import { AdapterContractError, assertIsoTimestamp, normalizeAdapterChange, normalizeExternalReference, normalizeSyncCursor, sha256Checksum } from "./contracts.js";
import { isNonContactLabel } from "./privacy.js";

const clone = (value) => structuredClone(value);

const deepFreeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

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
  return deepFreeze({ schemaVersion: 1, venueEntityType, venueObjectId, external: clone(external), batchId, sourceSystem, sourceVersion, synchronizedAt, checksum });
}

const mappingIntegrityPayload = (mapping) => ({
  schemaVersion: mapping.schemaVersion ?? 1,
  venueEntityType: mapping.venueEntityType,
  venueObjectId: mapping.venueObjectId,
  external: clone(mapping.external),
  sourceSystem: mapping.sourceSystem,
  sourceVersion: mapping.sourceVersion,
  synchronizedAt: mapping.synchronizedAt,
  checksum: mapping.checksum,
});

export const stagingIntegrityPayload = (batch) => ({
  schemaVersion: batch.schemaVersion,
  status: batch.status,
  adapterId: batch.adapterId,
  adapterVersion: batch.adapterVersion,
  sourceSystem: batch.sourceSystem,
  sourceVersion: batch.sourceVersion,
  synchronizedAt: batch.synchronizedAt,
  basePlanVersion: batch.basePlanVersion,
  proposalRevision: batch.proposalRevision,
  syncCursor: clone(batch.syncCursor),
  mappings: (batch.mappings ?? []).map(mappingIntegrityPayload),
  sourceRecords: clone(batch.sourceRecords ?? []),
  warnings: clone(batch.warnings ?? []),
  proposal: batch.proposal ? {
    revision: batch.proposal.revision,
    baseVersion: batch.proposal.baseVersion,
    status: batch.proposal.status,
    goal: batch.proposal.goal,
    changes: clone(batch.proposal.changes),
    validation: clone(batch.proposal.validation),
    waivers: clone(batch.proposal.waivers),
  } : null,
});

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
  const rawSourceRecords = input.sourceRecords ?? [];
  if (!Array.isArray(rawSourceRecords)) fail("ADAPTER_CONTRACT_INVALID", "Import sourceRecords must be an array");
  const sourceRecords = rawSourceRecords.map((record) => {
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
    if (typeof descriptive.location?.label !== "string" || !descriptive.location.label) fail("ADAPTER_SOURCE_INVALID", "Source record location label is required");
    for (const field of ["displayName", "organization", "role"]) {
      const value = descriptive.organizer?.[field];
      if (!isNonContactLabel(value)) fail("ADAPTER_SOURCE_INVALID", "Organizer metadata must contain exact labels and no contact PII", { field });
    }
    return Object.freeze({ external, synchronizedAt: record.synchronizedAt, descriptive: clone(descriptive) });
  });
  const rawMappingDrafts = input.mappings ?? changes.map((change) => ({ venueEntityType: change.venueEntityType, venueObjectId: change.operation === "create" ? change.proposedVenueObjectId : change.venueObjectId, external: change.external }));
  if (!Array.isArray(rawMappingDrafts)) fail("ADAPTER_CONTRACT_INVALID", "Import mappings must be an array");
  const mappingDrafts = rawMappingDrafts.map((mapping) => {
    if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) fail("ADAPTER_CONTRACT_INVALID", "Import mapping must be an object");
    const mappingUnknown = Object.keys(mapping).filter((key) => !["venueEntityType", "venueObjectId", "external"].includes(key));
    if (mappingUnknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Import mapping contains unknown fields", { fields: mappingUnknown.sort() });
    return { venueEntityType: mapping.venueEntityType, venueObjectId: mapping.venueObjectId, external: normalizeExternalReference(mapping.external, definition) };
  });
  const status = changes.length === 0 ? "no-changes" : "awaiting-review";
  const proposalDraft = changes.length === 0 ? null : {
    revision: options.proposalRevision,
    baseVersion: options.basePlanVersion,
    status: "review",
    goal: `Synchronize ${input.sourceSystem} ${input.sourceVersion}`,
    changes: clone(changes.map(proposalChange)),
    validation: null,
    waivers: [],
  };
  const mappingEvidence = mappingDrafts.map((mapping) => ({
    schemaVersion: 1,
    venueEntityType: mapping.venueEntityType,
    venueObjectId: mapping.venueObjectId,
    external: mapping.external,
    sourceSystem: input.sourceSystem,
    sourceVersion: mapping.external.sourceVersion,
    synchronizedAt: input.synchronizedAt,
    checksum: mapping.external.checksum,
  }));
  const draft = { schemaVersion: 1, status, adapterId: definition.id, adapterVersion: definition.version, sourceSystem: input.sourceSystem, sourceVersion: input.sourceVersion, synchronizedAt: input.synchronizedAt, basePlanVersion: options.basePlanVersion, proposalRevision: options.proposalRevision, syncCursor, mappings: mappingEvidence, sourceRecords: clone(sourceRecords), warnings: clone(input.warnings ?? []), proposal: proposalDraft };
  const checksum = await sha256Checksum(stagingIntegrityPayload(draft));
  const batchId = `adapter-batch-${checksum.slice(0, 16)}`;
  if (options.batchId !== undefined && options.batchId !== batchId) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Adapter batch ID must be derived from its checksum", { expected: batchId, actual: options.batchId });
  const proposal = proposalDraft ? { id: `proposal-adapter-${checksum.slice(0, 16)}`, ...proposalDraft } : null;
  const mappings = mappingEvidence.map((mapping) => createExternalIdMapping({ ...mapping, batchId }));
  return deepFreeze({ ...draft, id: batchId, checksum, mappings, proposal });
}

export async function assertStagingBatchIntegrity(batch) {
  if (!batch || typeof batch !== "object" || Array.isArray(batch)) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch must be an object");
  const allowedBatchFields = ["schemaVersion", "id", "status", "adapterId", "adapterVersion", "sourceSystem", "sourceVersion", "synchronizedAt", "basePlanVersion", "proposalRevision", "checksum", "syncCursor", "mappings", "sourceRecords", "warnings", "proposal"];
  const unknownBatchFields = Object.keys(batch).filter((key) => !allowedBatchFields.includes(key));
  if (unknownBatchFields.length) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch contains fields outside its canonical integrity payload", { fields: unknownBatchFields.sort() });
  if (batch.proposal) {
    const unknownProposalFields = Object.keys(batch.proposal).filter((key) => !["id", "revision", "baseVersion", "status", "goal", "changes", "validation", "waivers"].includes(key));
    if (unknownProposalFields.length) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging Proposal contains fields outside its canonical integrity payload", { fields: unknownProposalFields.sort() });
  }
  if (!Array.isArray(batch.mappings)) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging mappings must be an array");
  for (const mapping of batch.mappings) {
    const unknownMappingFields = Object.keys(mapping ?? {}).filter((key) => !["schemaVersion", "venueEntityType", "venueObjectId", "external", "batchId", "sourceSystem", "sourceVersion", "synchronizedAt", "checksum"].includes(key));
    const unknownExternalFields = Object.keys(mapping?.external ?? {}).filter((key) => !["adapterId", "sourceSystem", "entityType", "externalId", "sourceVersion", "checksum"].includes(key));
    if (unknownMappingFields.length || unknownExternalFields.length) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging mapping contains fields outside its canonical integrity payload", { fields: [...unknownMappingFields, ...unknownExternalFields].sort() });
  }
  const actualChecksum = await sha256Checksum(stagingIntegrityPayload(batch));
  if (batch.checksum !== actualChecksum) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch checksum does not match its canonical content", { expected: batch.checksum, actual: actualChecksum });
  const expectedId = `adapter-batch-${actualChecksum.slice(0, 16)}`;
  if (batch.id !== expectedId) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch ID does not match its checksum", { expected: expectedId, actual: batch.id });
  if (batch.proposal && batch.proposal.id !== `proposal-adapter-${actualChecksum.slice(0, 16)}`) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Proposal ID does not match the staging checksum", { proposalId: batch.proposal.id });
  if (!Array.isArray(batch.mappings) || batch.mappings.some((mapping) => mapping.batchId !== batch.id)) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "External ID mappings must reference the checksum-derived batch ID");
  return true;
}

export function assertAdapterProjectContext(batch, context) {
  const projectMappings = batch.mappings.filter((mapping) => mapping.venueEntityType === "project");
  const planningEffects = batch.proposal?.changes.flatMap((change) => change.planningEffects ?? []) ?? [];
  if (planningEffects.length && projectMappings.length !== 1) fail("ADAPTER_PROJECT_BINDING_REQUIRED", "Planning Changes require exactly one server-verifiable Project mapping", { projectMappings: projectMappings.length });
  if (projectMappings.length === 0) return true;
  if (projectMappings.length !== 1 || !context || typeof context !== "object" || typeof context.projectId !== "string" || !context.projectId) fail("ADAPTER_PROJECT_BINDING_REQUIRED", "Project-mapped adapter results require one trusted server-owned Project context");
  if (projectMappings[0].venueObjectId !== context.projectId) fail("ADAPTER_PROJECT_BINDING_MISMATCH", "Adapter Project mapping does not match the server-owned Project context", { expectedProjectId: context.projectId, actualProjectId: projectMappings[0].venueObjectId });
  if (!planningEffects.length) return true;
  if (!context.brief || !Array.isArray(context.brief.requirements) || !Array.isArray(context.constraints) || !context.planningEffectBindings || typeof context.planningEffectBindings !== "object") fail("ADAPTER_PROJECT_BINDING_REQUIRED", "Planning Changes require a trusted Brief, Constraint registry, and Planning Effect bindings");
  for (const effect of planningEffects) {
    try {
      assertPlanningEffectBinding(effect, context);
    } catch (error) {
      fail("ADAPTER_PLANNING_BINDING_MISMATCH", "Planning Effect does not match the server-owned Brief, Requirement, and Constraint registry", { operation: effect.operation, targetBriefId: effect.targetBriefId, targetRequirementId: effect.targetRequirementId, cause: error.message });
    }
    const expectedBefore = effect.operation === "set_attendance_target" ? context.brief.attendeeTarget : context.brief.schedule ?? null;
    if (JSON.stringify(expectedBefore) !== JSON.stringify(effect.before)) fail("ADAPTER_PLANNING_BINDING_MISMATCH", "Planning Effect before value does not match server-owned accepted Brief truth", { operation: effect.operation, targetRequirementId: effect.targetRequirementId });
  }
  return true;
}

export async function assertReviewableStagingBatch(batch, projectContext = null, { requireProjectContext = true } = {}) {
  await assertStagingBatchIntegrity(batch);
  if (batch?.status !== "awaiting-review" || batch?.proposal?.status !== "review") fail("ADAPTER_REVIEW_BYPASS", "Imported changes must remain a review Proposal until human Approval");
  if (!batch.proposal.id || !Number.isInteger(batch.proposal.revision) || batch.proposal.baseVersion !== batch.basePlanVersion || !Array.isArray(batch.proposal.changes)) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch does not contain a canonical Proposal");
  if (batch.proposal.changes.length === 0) fail("ADAPTER_CHANGE_EMPTY", "A no-change adapter batch cannot enter Proposal review");
  if (batch.proposal.changes.some((change) => !change.id || !Number.isInteger(change.number) || !Array.isArray(change.targetObjectIds) || (!change.spatialEffects?.length && !change.planningEffects?.length) || (change.targetObjectIds.length === 0 && !change.planningEffects?.length))) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch contains a non-executable Change");
  try {
    batch.proposal.changes.flatMap((change) => change.planningEffects ?? []).forEach(normalizePlanningEffect);
  } catch (error) {
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch contains an invalid Planning Effect", { cause: error.message });
  }
  if (!batch.sourceSystem || !batch.sourceVersion || !batch.checksum) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch source evidence is incomplete");
  if (!/^[0-9a-f]{64}$/.test(batch.checksum) || !Array.isArray(batch.mappings) || batch.mappings.some((mapping) => mapping.sourceSystem !== batch.sourceSystem || mapping.synchronizedAt !== batch.synchronizedAt || !/^[0-9a-f]{64}$/.test(mapping.checksum ?? ""))) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch mapping evidence is invalid");
  if (requireProjectContext) assertAdapterProjectContext(batch, projectContext);
  assertIsoTimestamp(batch.synchronizedAt, "Staging batch synchronizedAt");
  return true;
}

export async function loadAdapterProposalForReview(planner, batch) {
  if (!planner || typeof planner.getSnapshot !== "function" || typeof planner.execute !== "function") fail("ADAPTER_PLANNER_REQUIRED", "A VenuePlanner instance is required");
  const projectContext = typeof planner.getAdapterProjectContext === "function" ? planner.getAdapterProjectContext() : null;
  await assertReviewableStagingBatch(batch, projectContext);
  const snapshot = planner.getSnapshot();
  const beforePlanFingerprint = fingerprintPlan(snapshot.plan);
  const beforeBriefFingerprint = fingerprintEventBrief(snapshot.brief);
  const projectMapping = batch.mappings.find((mapping) => mapping.venueEntityType === "project") ?? null;
  if (projectMapping) {
    const boundProjectId = typeof planner.getProjectId === "function" ? planner.getProjectId() : null;
    if (!boundProjectId) fail("ADAPTER_PROJECT_BINDING_REQUIRED", "Planner must carry a server-owned Project binding before adapter review");
    if (projectMapping.venueObjectId !== boundProjectId) fail("ADAPTER_PROJECT_BINDING_MISMATCH", "Adapter Project mapping does not match the server-owned planner Project", { expectedProjectId: boundProjectId, actualProjectId: projectMapping.venueObjectId });
  }
  if (snapshot.plan.version !== batch.proposal.baseVersion) fail("ADAPTER_BASE_PLAN_VERSION_CONFLICT", "Adapter Proposal base Version is stale", { expected: snapshot.plan.version, actual: batch.proposal.baseVersion });
  if (batch.proposal.revision !== snapshot.proposal.revision + 1) fail("ADAPTER_PROPOSAL_REVISION_CONFLICT", "Adapter Proposal revision must follow the current Proposal revision", { expected: snapshot.proposal.revision + 1, actual: batch.proposal.revision });
  const activeBranch = snapshot.branches.find((branch) => branch.id === snapshot.activeBranchId);
  if (!activeBranch) fail("ADAPTER_ACTIVE_BRANCH_MISSING", "The active Proposal Branch is unavailable");
  const revisions = [...(activeBranch.revisions ?? [])];
  if (activeBranch.proposal?.id !== batch.proposal.id) revisions.push(clone(activeBranch.proposal));
  planner.execute({ type: "restore_snapshot", snapshot: { ...snapshot, proposal: clone(batch.proposal), branches: snapshot.branches.map((branch) => branch.id === snapshot.activeBranchId ? { ...branch, proposal: clone(batch.proposal), revisions } : branch) } });
  const after = planner.getSnapshot();
  if (fingerprintPlan(after.plan) !== beforePlanFingerprint) fail("ADAPTER_ACCEPTED_PLAN_MUTATED", "Adapter staging changed accepted Plan truth");
  if (fingerprintEventBrief(after.brief) !== beforeBriefFingerprint) fail("ADAPTER_ACCEPTED_BRIEF_MUTATED", "Adapter staging changed accepted Event Brief truth");
  return Object.freeze({ status: "review", proposalId: after.proposal.id, revision: after.proposal.revision, baseVersion: after.proposal.baseVersion, changedItems: after.proposal.changes.length, requiresHumanApproval: true });
}
