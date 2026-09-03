import { fingerprintEventBrief, fingerprintPlan } from "../domain/activity-ledger.ts";
import {
  assertPlanningEffectBinding,
  normalizePlanningEffect,
  normalizeProposalPlanningEffects,
} from "../domain/planning-effects.ts";
import type { EventBrief, PlanningEffectBindings } from "../domain/event-brief.ts";
import type { VenueProposal } from "../domain/geometry.ts";
import type { VenuePlanner } from "../domain/venue-planner.ts";
import {
  AdapterContractError,
  assertIsoTimestamp,
  normalizeAdapterChange,
  normalizeExternalReference,
  normalizeSyncCursor,
  sha256Checksum,
  type AdapterChange,
  type AdapterDefinition,
  type ExternalReference,
  type SyncCursor,
  type VenueEntityType,
} from "./contracts.ts";
import { isNonContactLabel } from "./privacy.ts";

const clone = <Value>(value: Value): Value => structuredClone(value);

const deepFreeze = <Value>(value: Value): Readonly<Value> => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const fail = (code: string, message: string, details: Readonly<Record<string, unknown>> = {}): never => {
  throw new AdapterContractError(code, message, details);
};

export interface ExternalIdMapping {
  readonly schemaVersion: 1;
  readonly venueEntityType: VenueEntityType;
  readonly venueObjectId: string;
  readonly external: ExternalReference;
  readonly batchId: string;
  readonly sourceSystem: string;
  readonly sourceVersion: string;
  readonly synchronizedAt: string;
  readonly checksum: string;
}

type ExternalIdMappingInput = Omit<ExternalIdMapping, "schemaVersion">;

export interface AdapterSourceRecord {
  readonly external: ExternalReference;
  readonly synchronizedAt: string;
  readonly descriptive: Readonly<{
    title: string;
    location: Readonly<{ label: string }>;
    organizer: Readonly<{ displayName: string; organization: string; role: string }>;
  }>;
}

export interface AdapterImportOutput {
  readonly sourceSystem: string;
  readonly sourceVersion: string;
  readonly synchronizedAt: string;
  readonly syncCursor?: SyncCursor | null;
  readonly changes: readonly unknown[];
  readonly mappings?: readonly unknown[];
  readonly sourceRecords?: readonly unknown[];
  readonly warnings?: readonly unknown[];
}

export interface AdapterStagingBatch {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly status: "awaiting-review" | "no-changes";
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceSystem: string;
  readonly sourceVersion: string;
  readonly synchronizedAt: string;
  readonly basePlanVersion: string;
  readonly proposalRevision: number;
  readonly checksum: string;
  readonly syncCursor: Readonly<SyncCursor> | null;
  readonly mappings: readonly Readonly<ExternalIdMapping>[];
  readonly sourceRecords: readonly Readonly<AdapterSourceRecord>[];
  readonly warnings: readonly unknown[];
  readonly proposal: VenueProposal | null;
}

interface AdapterStagingOptions {
  readonly basePlanVersion?: string;
  readonly proposalRevision?: number;
  readonly batchId?: string;
}

export interface AdapterProjectContext {
  readonly projectId: string;
  readonly brief: EventBrief;
  readonly constraints: readonly Readonly<{ id: string; category: string }>[];
  readonly planningEffectBindings: PlanningEffectBindings;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isAdapterStagingBatch = (value: unknown): value is AdapterStagingBatch =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  (value["status"] === "awaiting-review" || value["status"] === "no-changes") &&
  typeof value["adapterId"] === "string" &&
  typeof value["adapterVersion"] === "string" &&
  typeof value["sourceSystem"] === "string" &&
  typeof value["sourceVersion"] === "string" &&
  typeof value["synchronizedAt"] === "string" &&
  typeof value["basePlanVersion"] === "string" &&
  typeof value["proposalRevision"] === "number" &&
  typeof value["checksum"] === "string" &&
  Array.isArray(value["mappings"]) &&
  Array.isArray(value["sourceRecords"]) &&
  Array.isArray(value["warnings"]) &&
  (value["proposal"] === null || isRecord(value["proposal"]));

const proposalChange = (change: Readonly<AdapterChange>, index: number): Readonly<Record<string, unknown>> => {
  const venueObjectId = change.operation === "create" ? change.proposedVenueObjectId : change.venueObjectId;
  if (typeof venueObjectId !== "string" || !venueObjectId)
    return fail("ADAPTER_CONTRACT_INVALID", "Adapter Change requires a VenueMind stable ID");
  if (change.venueEntityType === "event-brief-requirement") {
    const planningEffects = clone(change.planningEffects ?? []);
    const firstEffect = planningEffects[0];
    if (!firstEffect) return fail("ADAPTER_CHANGE_EMPTY", "Requirement Change requires a Planning Effect");
    const label = firstEffect.requirement.label;
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
  if (Object.hasOwn(values, "id"))
    fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Adapter values cannot override a VenueMind stable ID", {
      changeId: change.id,
    });
  if (change.operation === "update") {
    const protectedFields = ["id", "kind", "locked", "locks", "templateRef", "templateOverrides"].filter((field) =>
      Object.hasOwn(values, field),
    );
    if (protectedFields.length)
      fail("ADAPTER_PROTECTED_FIELD", "Adapter updates cannot change identity, Lock, or template-binding fields", {
        changeId: change.id,
        fields: protectedFields,
      });
  }
  const spatialEffects = [];
  if (change.operation === "create")
    spatialEffects.push({ operation: "add_object", object: { ...values, id: venueObjectId } });
  if (change.operation === "update") {
    const { footprint, ...metadata } = values;
    if (footprint) spatialEffects.push({ operation: "update_footprint", objectId: venueObjectId, footprint });
    if (Object.keys(metadata).length)
      spatialEffects.push({ operation: "update_metadata", objectId: venueObjectId, values: metadata });
  }
  if (change.operation === "delete") spatialEffects.push({ operation: "delete_object", objectId: venueObjectId });
  if (spatialEffects.length === 0)
    fail("ADAPTER_CHANGE_EMPTY", "Adapter change must produce at least one executable spatial effect", {
      changeId: change.id,
    });
  const label = typeof values["label"] === "string" ? values["label"] : venueObjectId;
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
      ...(change.baseChecksum ? { baseChecksum: change.baseChecksum } : {}),
      ...(change.evidence ? { adapterEvidence: clone(change.evidence) } : {}),
    },
  });
};

export function createExternalIdMapping({
  venueEntityType,
  venueObjectId,
  external,
  batchId,
  sourceSystem,
  sourceVersion,
  synchronizedAt,
  checksum,
}: ExternalIdMappingInput): Readonly<ExternalIdMapping> {
  if (
    !["event-brief-requirement", "inventory-item-template", "project", "project-object-instance"].includes(
      venueEntityType,
    )
  )
    fail("ADAPTER_ENTITY_TYPE_INVALID", "Venue entity type is invalid", { venueEntityType });
  if (typeof venueObjectId !== "string" || !venueObjectId)
    fail("ADAPTER_CONTRACT_INVALID", "VenueMind stable ID is required");
  if (typeof external?.externalId !== "string" || !external.externalId)
    fail("ADAPTER_CONTRACT_INVALID", "External reference is required");
  if (
    typeof batchId !== "string" ||
    !batchId ||
    typeof sourceSystem !== "string" ||
    !sourceSystem ||
    typeof sourceVersion !== "string" ||
    !sourceVersion
  )
    fail("ADAPTER_MAPPING_EVIDENCE_INVALID", "Mapping source evidence is required");
  if (!/^[0-9a-f]{64}$/.test(checksum ?? ""))
    fail("ADAPTER_CHECKSUM_INVALID", "Mapping checksum must be a lowercase SHA-256 digest");
  if (venueObjectId === external.externalId)
    fail("ADAPTER_ID_BOUNDARY_VIOLATION", "External IDs and VenueMind stable IDs must not be conflated", {
      venueObjectId,
      externalId: external.externalId,
    });
  if (
    sourceSystem !== external.sourceSystem ||
    sourceVersion !== external.sourceVersion ||
    checksum !== external.checksum
  )
    fail("ADAPTER_MAPPING_EVIDENCE_MISMATCH", "Mapping evidence must match its external source reference", {
      venueObjectId,
    });
  assertIsoTimestamp(synchronizedAt, "Mapping synchronizedAt");
  return deepFreeze({
    schemaVersion: 1,
    venueEntityType,
    venueObjectId,
    external: clone(external),
    batchId,
    sourceSystem,
    sourceVersion,
    synchronizedAt,
    checksum,
  });
}

const mappingIntegrityPayload = (mapping: Readonly<ExternalIdMapping>) => ({
  schemaVersion: mapping.schemaVersion ?? 1,
  venueEntityType: mapping.venueEntityType,
  venueObjectId: mapping.venueObjectId,
  external: clone(mapping.external),
  sourceSystem: mapping.sourceSystem,
  sourceVersion: mapping.sourceVersion,
  synchronizedAt: mapping.synchronizedAt,
  checksum: mapping.checksum,
});

export const stagingIntegrityPayload = (batch: Omit<AdapterStagingBatch, "id" | "checksum"> | AdapterStagingBatch) => ({
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
  proposal: batch.proposal
    ? {
        revision: batch.proposal.revision,
        baseVersion: batch.proposal.baseVersion,
        status: batch.proposal.status,
        goal: batch.proposal.goal,
        changes: clone(batch.proposal.changes),
        validation: clone(batch.proposal.validation),
        waivers: clone(batch.proposal.waivers),
      }
    : null,
});

export async function createAdapterStagingBatch(
  definition: AdapterDefinition,
  inputValue: unknown,
  options: AdapterStagingOptions = {},
): Promise<Readonly<AdapterStagingBatch>> {
  if (!isRecord(inputValue)) return fail("ADAPTER_CONTRACT_INVALID", "Adapter import result must be an object");
  const input = inputValue;
  const unknown = Object.keys(input).filter(
    (key) =>
      ![
        "sourceSystem",
        "sourceVersion",
        "synchronizedAt",
        "syncCursor",
        "changes",
        "mappings",
        "sourceRecords",
        "warnings",
      ].includes(key),
  );
  if (unknown.length)
    fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Adapter import result contains unknown fields", {
      fieldCount: unknown.length,
    });
  const sourceSystem = input["sourceSystem"];
  const sourceVersion = input["sourceVersion"];
  const synchronizedAt = input["synchronizedAt"];
  const basePlanVersion = options.basePlanVersion;
  const proposalRevision = options.proposalRevision;
  if (typeof sourceSystem !== "string" || !sourceSystem)
    return fail("ADAPTER_CONTRACT_INVALID", "Import sourceSystem is required");
  if (typeof sourceVersion !== "string" || !sourceVersion)
    return fail("ADAPTER_CONTRACT_INVALID", "Import sourceVersion is required");
  if (typeof synchronizedAt !== "string") return fail("ADAPTER_CONTRACT_INVALID", "Import synchronizedAt is required");
  assertIsoTimestamp(synchronizedAt, "Import synchronizedAt");
  if (typeof basePlanVersion !== "string" || !basePlanVersion)
    return fail("ADAPTER_BASE_PLAN_VERSION_REQUIRED", "Adapter staging requires exactly one base Plan Version");
  if (typeof proposalRevision !== "number" || !Number.isInteger(proposalRevision) || proposalRevision < 1)
    return fail("ADAPTER_PROPOSAL_REVISION_REQUIRED", "Adapter staging requires a positive Proposal revision");
  const rawChanges = input["changes"];
  if (!Array.isArray(rawChanges)) return fail("ADAPTER_CONTRACT_INVALID", "Import changes must be an array");
  const changes = rawChanges.map((change) => normalizeAdapterChange(change, definition));
  const ids = changes.map((change) => change.id);
  if (new Set(ids).size !== ids.length) fail("ADAPTER_CHANGE_DUPLICATE", "Adapter change IDs must be unique");
  if (changes.some((change) => change.external.sourceSystem !== sourceSystem))
    fail("ADAPTER_SOURCE_MISMATCH", "Every imported Change must belong to the batch source system");
  const proposedIds = changes
    .filter((change) => change.operation === "create")
    .map((change) => change.proposedVenueObjectId)
    .filter((id): id is string => typeof id === "string");
  if (new Set(proposedIds).size !== proposedIds.length)
    fail("ADAPTER_STABLE_ID_DUPLICATE", "Proposed VenueMind stable IDs must be unique");
  const syncCursor = normalizeSyncCursor(input["syncCursor"], definition);
  const rawSourceRecords = input["sourceRecords"] ?? [];
  if (!Array.isArray(rawSourceRecords))
    return fail("ADAPTER_CONTRACT_INVALID", "Import sourceRecords must be an array");
  const sourceRecords: AdapterSourceRecord[] = rawSourceRecords.map((record): AdapterSourceRecord => {
    if (!isRecord(record)) return fail("ADAPTER_CONTRACT_INVALID", "Source record evidence must be an object");
    const recordUnknown = Object.keys(record).filter(
      (key) => !["external", "synchronizedAt", "descriptive"].includes(key),
    );
    if (recordUnknown.length)
      fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Source record evidence contains unknown fields", {
        fieldCount: recordUnknown.length,
      });
    const external = normalizeExternalReference(record["external"], definition);
    const recordSynchronizedAt = record["synchronizedAt"];
    if (typeof recordSynchronizedAt !== "string")
      return fail("ADAPTER_CONTRACT_INVALID", "Source record synchronizedAt is required");
    assertIsoTimestamp(recordSynchronizedAt, "Source record synchronizedAt");
    const descriptive = record["descriptive"];
    if (!isRecord(descriptive))
      return fail("ADAPTER_CONTRACT_INVALID", "Source record descriptive evidence must be an object");
    const descriptiveUnknown = Object.keys(descriptive).filter(
      (key) => !["title", "location", "organizer"].includes(key),
    );
    if (descriptiveUnknown.length)
      fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Source record descriptive evidence contains unknown fields", {
        fieldCount: descriptiveUnknown.length,
      });
    if (!isNonContactLabel(descriptive["title"]))
      return fail("ADAPTER_PERSONAL_DATA_REJECTED", "Source record title must be a non-contact label");
    const location = descriptive["location"];
    const organizer = descriptive["organizer"];
    if (!isRecord(location) || !isRecord(organizer))
      return fail("ADAPTER_SOURCE_INVALID", "Source record location and organizer metadata are required");
    const locationUnknown = Object.keys(location).filter((key) => key !== "label");
    const organizerUnknown = Object.keys(organizer).filter(
      (key) => !["displayName", "organization", "role"].includes(key),
    );
    if (locationUnknown.length || organizerUnknown.length)
      fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Source record descriptive metadata contains unknown fields", {
        fieldCount: locationUnknown.length + organizerUnknown.length,
      });
    if (!isNonContactLabel(location["label"]))
      return fail("ADAPTER_PERSONAL_DATA_REJECTED", "Source record location must be a non-contact label");
    const displayName = organizer["displayName"];
    const organization = organizer["organization"];
    const role = organizer["role"];
    for (const field of ["displayName", "organization", "role"]) {
      const value = organizer[field];
      if (!isNonContactLabel(value))
        fail("ADAPTER_SOURCE_INVALID", "Organizer metadata must contain exact labels and no contact PII", { field });
    }
    if (!isNonContactLabel(displayName) || !isNonContactLabel(organization) || !isNonContactLabel(role))
      return fail("ADAPTER_SOURCE_INVALID", "Organizer metadata must contain exact labels and no contact PII");
    return Object.freeze({
      external,
      synchronizedAt: recordSynchronizedAt,
      descriptive: {
        title: descriptive["title"],
        location: { label: location["label"] },
        organizer: { displayName, organization, role },
      },
    });
  });
  const rawMappingDrafts: readonly unknown[] =
    input["mappings"] === undefined
      ? changes.map((change) => ({
          venueEntityType: change.venueEntityType,
          venueObjectId: change.operation === "create" ? change.proposedVenueObjectId : change.venueObjectId,
          external: change.external,
        }))
      : Array.isArray(input["mappings"])
        ? input["mappings"]
        : fail("ADAPTER_CONTRACT_INVALID", "Import mappings must be an array");
  const mappingDrafts = rawMappingDrafts.map(
    (mapping): Readonly<{ venueEntityType: VenueEntityType; venueObjectId: string; external: ExternalReference }> => {
      if (!isRecord(mapping)) return fail("ADAPTER_CONTRACT_INVALID", "Import mapping must be an object");
      const mappingUnknown = Object.keys(mapping).filter(
        (key) => !["venueEntityType", "venueObjectId", "external"].includes(key),
      );
      if (mappingUnknown.length)
        fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Import mapping contains unknown fields", {
          fieldCount: mappingUnknown.length,
        });
      const venueEntityType = mapping["venueEntityType"];
      const venueObjectId = mapping["venueObjectId"];
      if (
        venueEntityType !== "event-brief-requirement" &&
        venueEntityType !== "inventory-item-template" &&
        venueEntityType !== "project" &&
        venueEntityType !== "project-object-instance"
      )
        return fail("ADAPTER_ENTITY_TYPE_INVALID", "Import mapping Venue entity type is invalid");
      if (typeof venueObjectId !== "string" || !venueObjectId)
        return fail("ADAPTER_CONTRACT_INVALID", "Import mapping VenueMind stable ID is required");
      return { venueEntityType, venueObjectId, external: normalizeExternalReference(mapping["external"], definition) };
    },
  );
  const status = changes.length === 0 ? "no-changes" : "awaiting-review";
  const proposalDraft =
    changes.length === 0
      ? null
      : {
          id: "proposal-adapter-pending",
          revision: proposalRevision,
          baseVersion: basePlanVersion,
          status: "review",
          goal: `Synchronize ${sourceSystem} ${sourceVersion}`,
          changes: clone(changes.map(proposalChange)),
          validation: null,
          waivers: [],
        };
  const mappingEvidence: Array<Omit<ExternalIdMapping, "batchId">> = mappingDrafts.map((mapping) => ({
    schemaVersion: 1,
    venueEntityType: mapping.venueEntityType,
    venueObjectId: mapping.venueObjectId,
    external: mapping.external,
    sourceSystem,
    sourceVersion: mapping.external.sourceVersion,
    synchronizedAt,
    checksum: mapping.external.checksum,
  }));
  const warnings = input["warnings"] ?? [];
  if (!Array.isArray(warnings)) return fail("ADAPTER_CONTRACT_INVALID", "Import warnings must be an array");
  const normalizedProposal = proposalDraft ? normalizeProposalPlanningEffects(proposalDraft) : null;
  const draft: Omit<AdapterStagingBatch, "id" | "checksum"> = {
    schemaVersion: 1,
    status,
    adapterId: definition.id,
    adapterVersion: definition.version,
    sourceSystem,
    sourceVersion,
    synchronizedAt,
    basePlanVersion,
    proposalRevision,
    syncCursor,
    mappings: mappingEvidence.map((mapping) => ({ ...mapping, batchId: "pending" })),
    sourceRecords: clone(sourceRecords),
    warnings: clone(warnings),
    proposal: normalizedProposal,
  };
  const checksum = await sha256Checksum(stagingIntegrityPayload(draft));
  const batchId = `adapter-batch-${checksum.slice(0, 16)}`;
  if (options.batchId !== undefined && options.batchId !== batchId)
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Adapter batch ID must be derived from its checksum", {
      expected: batchId,
      actual: options.batchId,
    });
  const proposal: VenueProposal | null = normalizedProposal
    ? { ...normalizedProposal, id: `proposal-adapter-${checksum.slice(0, 16)}` }
    : null;
  const mappings = mappingEvidence.map((mapping) => createExternalIdMapping({ ...mapping, batchId }));
  return deepFreeze({ ...draft, id: batchId, checksum, mappings, proposal });
}

export async function assertStagingBatchIntegrity(batch: AdapterStagingBatch): Promise<true> {
  const allowedBatchFields = [
    "schemaVersion",
    "id",
    "status",
    "adapterId",
    "adapterVersion",
    "sourceSystem",
    "sourceVersion",
    "synchronizedAt",
    "basePlanVersion",
    "proposalRevision",
    "checksum",
    "syncCursor",
    "mappings",
    "sourceRecords",
    "warnings",
    "proposal",
  ];
  const unknownBatchFields = Object.keys(batch).filter((key) => !allowedBatchFields.includes(key));
  if (unknownBatchFields.length)
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch contains fields outside its canonical integrity payload", {
      fieldCount: unknownBatchFields.length,
    });
  if (batch.proposal) {
    const unknownProposalFields = Object.keys(batch.proposal).filter(
      (key) => !["id", "revision", "baseVersion", "status", "goal", "changes", "validation", "waivers"].includes(key),
    );
    if (unknownProposalFields.length)
      fail(
        "ADAPTER_STAGING_INTEGRITY_FAILED",
        "Staging Proposal contains fields outside its canonical integrity payload",
        { fieldCount: unknownProposalFields.length },
      );
  }
  if (!Array.isArray(batch.mappings)) fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging mappings must be an array");
  for (const mapping of batch.mappings) {
    const unknownMappingFields = Object.keys(mapping ?? {}).filter(
      (key) =>
        ![
          "schemaVersion",
          "venueEntityType",
          "venueObjectId",
          "external",
          "batchId",
          "sourceSystem",
          "sourceVersion",
          "synchronizedAt",
          "checksum",
        ].includes(key),
    );
    const unknownExternalFields = Object.keys(mapping?.external ?? {}).filter(
      (key) => !["adapterId", "sourceSystem", "entityType", "externalId", "sourceVersion", "checksum"].includes(key),
    );
    if (unknownMappingFields.length || unknownExternalFields.length)
      fail(
        "ADAPTER_STAGING_INTEGRITY_FAILED",
        "Staging mapping contains fields outside its canonical integrity payload",
        { fieldCount: unknownMappingFields.length + unknownExternalFields.length },
      );
  }
  const actualChecksum = await sha256Checksum(stagingIntegrityPayload(batch));
  if (batch.checksum !== actualChecksum)
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch checksum does not match its canonical content", {
      expected: batch.checksum,
      actual: actualChecksum,
    });
  const expectedId = `adapter-batch-${actualChecksum.slice(0, 16)}`;
  if (batch.id !== expectedId)
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch ID does not match its checksum", {
      expected: expectedId,
      actual: batch.id,
    });
  if (batch.proposal && batch.proposal.id !== `proposal-adapter-${actualChecksum.slice(0, 16)}`)
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Proposal ID does not match the staging checksum", {
      proposalId: batch.proposal.id,
    });
  if (batch.mappings.some((mapping) => mapping.batchId !== batch.id))
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "External ID mappings must reference the checksum-derived batch ID");
  return true;
}

export function assertAdapterProjectContext(batch: AdapterStagingBatch, context: AdapterProjectContext | null): true {
  const projectMappings = batch.mappings.filter((mapping) => mapping.venueEntityType === "project");
  const planningEffects = batch.proposal?.changes.flatMap((change) => change.planningEffects ?? []) ?? [];
  if (planningEffects.length && projectMappings.length !== 1)
    fail("ADAPTER_PROJECT_BINDING_REQUIRED", "Planning Changes require exactly one server-verifiable Project mapping", {
      projectMappings: projectMappings.length,
    });
  if (projectMappings.length === 0) return true;
  const projectMapping = projectMappings[0];
  if (!projectMapping || context === null || !context.projectId)
    return fail(
      "ADAPTER_PROJECT_BINDING_REQUIRED",
      "Project-mapped adapter results require one trusted server-owned Project context",
    );
  if (projectMapping.venueObjectId !== context.projectId)
    fail(
      "ADAPTER_PROJECT_BINDING_MISMATCH",
      "Adapter Project mapping does not match the server-owned Project context",
      { expectedProjectId: context.projectId, actualProjectId: projectMapping.venueObjectId },
    );
  if (!planningEffects.length) return true;
  for (const effect of planningEffects) {
    try {
      assertPlanningEffectBinding(effect, {
        brief: context.brief,
        constraints: [...context.constraints],
        planningEffectBindings: context.planningEffectBindings,
      });
    } catch (error) {
      fail(
        "ADAPTER_PLANNING_BINDING_MISMATCH",
        "Planning Effect does not match the server-owned Brief, Requirement, and Constraint registry",
        {
          operation: effect.operation,
          targetBriefId: effect.targetBriefId,
          targetRequirementId: effect.targetRequirementId,
          cause: error instanceof Error ? error.message : "Unknown Planning Effect error",
        },
      );
    }
    const expectedBefore =
      effect.operation === "set_attendance_target" ? context.brief.attendeeTarget : (context.brief.schedule ?? null);
    if (JSON.stringify(expectedBefore) !== JSON.stringify(effect.before))
      fail(
        "ADAPTER_PLANNING_BINDING_MISMATCH",
        "Planning Effect before value does not match server-owned accepted Brief truth",
        { operation: effect.operation, targetRequirementId: effect.targetRequirementId },
      );
  }
  return true;
}

export async function assertReviewableStagingBatch(
  batch: AdapterStagingBatch,
  projectContext: AdapterProjectContext | null = null,
  { requireProjectContext = true }: Readonly<{ requireProjectContext?: boolean }> = {},
): Promise<true> {
  await assertStagingBatchIntegrity(batch);
  const proposal = batch.proposal;
  if (batch.status !== "awaiting-review" || proposal === null || proposal.status !== "review")
    return fail("ADAPTER_REVIEW_BYPASS", "Imported changes must remain a review Proposal until human Approval");
  if (
    !proposal.id ||
    !Number.isInteger(proposal.revision) ||
    proposal.baseVersion !== batch.basePlanVersion ||
    !Array.isArray(proposal.changes)
  )
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch does not contain a canonical Proposal");
  if (proposal.changes.length === 0)
    fail("ADAPTER_CHANGE_EMPTY", "A no-change adapter batch cannot enter Proposal review");
  if (
    proposal.changes.some(
      (change) =>
        !change.id ||
        !Number.isInteger(change.number) ||
        !Array.isArray(change.targetObjectIds) ||
        (!change.spatialEffects?.length && !change.planningEffects?.length) ||
        (change.targetObjectIds.length === 0 && !change.planningEffects?.length),
    )
  )
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch contains a non-executable Change");
  try {
    proposal.changes.flatMap((change) => change.planningEffects ?? []).forEach(normalizePlanningEffect);
  } catch (error) {
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch contains an invalid Planning Effect", {
      cause: error instanceof Error ? error.message : "Unknown Planning Effect error",
    });
  }
  if (!batch.sourceSystem || !batch.sourceVersion || !batch.checksum)
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch source evidence is incomplete");
  if (
    !/^[0-9a-f]{64}$/.test(batch.checksum) ||
    batch.mappings.some(
      (mapping) =>
        mapping.sourceSystem !== batch.sourceSystem ||
        mapping.synchronizedAt !== batch.synchronizedAt ||
        !/^[0-9a-f]{64}$/.test(mapping.checksum),
    )
  )
    fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch mapping evidence is invalid");
  if (requireProjectContext) assertAdapterProjectContext(batch, projectContext);
  assertIsoTimestamp(batch.synchronizedAt, "Staging batch synchronizedAt");
  return true;
}

export async function loadAdapterProposalForReview(planner: VenuePlanner, batch: AdapterStagingBatch) {
  const projectContext =
    typeof planner.getAdapterProjectContext === "function" ? planner.getAdapterProjectContext() : null;
  await assertReviewableStagingBatch(batch, projectContext);
  const proposal = batch.proposal;
  if (proposal === null) return fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Staging batch requires a Proposal");
  const snapshot = planner.getSnapshot();
  const beforePlanFingerprint = fingerprintPlan(snapshot.plan);
  const beforeBriefFingerprint = fingerprintEventBrief(snapshot.brief);
  const projectMapping = batch.mappings.find((mapping) => mapping.venueEntityType === "project") ?? null;
  if (projectMapping) {
    const boundProjectId = typeof planner.getProjectId === "function" ? planner.getProjectId() : null;
    if (!boundProjectId)
      fail(
        "ADAPTER_PROJECT_BINDING_REQUIRED",
        "Planner must carry a server-owned Project binding before adapter review",
      );
    if (projectMapping.venueObjectId !== boundProjectId)
      fail(
        "ADAPTER_PROJECT_BINDING_MISMATCH",
        "Adapter Project mapping does not match the server-owned planner Project",
        { expectedProjectId: boundProjectId, actualProjectId: projectMapping.venueObjectId },
      );
  }
  if (snapshot.plan.version !== proposal.baseVersion)
    fail("ADAPTER_BASE_PLAN_VERSION_CONFLICT", "Adapter Proposal base Version is stale", {
      expected: snapshot.plan.version,
      actual: proposal.baseVersion,
    });
  if (proposal.revision !== snapshot.proposal.revision + 1)
    fail("ADAPTER_PROPOSAL_REVISION_CONFLICT", "Adapter Proposal revision must follow the current Proposal revision", {
      expected: snapshot.proposal.revision + 1,
      actual: proposal.revision,
    });
  for (const change of proposal.changes) {
    const expectedChecksum = change.effects?.baseChecksum;
    if (expectedChecksum === undefined) continue;
    const operation = change.effects?.adapterOperation;
    if (operation !== "update" && operation !== "delete")
      fail("ADAPTER_BASE_OBJECT_CONFLICT", "Adapter base object checksum is valid only for update or delete Changes", {
        changeId: change.id,
        operation: operation ?? null,
      });
    const objectId = change.targetObjectIds?.[0] ?? null;
    const acceptedObject = snapshot.plan.objects.find((object) => object.id === objectId);
    const actualChecksum = acceptedObject ? await sha256Checksum(acceptedObject) : null;
    if (!acceptedObject || actualChecksum !== expectedChecksum)
      fail("ADAPTER_BASE_OBJECT_CONFLICT", "Adapter Change no longer matches the accepted base object", {
        changeId: change.id,
        objectId,
        expectedChecksum,
        actualChecksum,
      });
  }
  const activeBranch = snapshot.branches.find((branch) => branch.id === snapshot.activeBranchId);
  if (!activeBranch) return fail("ADAPTER_ACTIVE_BRANCH_MISSING", "The active Proposal Branch is unavailable");
  const revisions = [...activeBranch.revisions];
  if (activeBranch.proposal.id !== proposal.id) revisions.push(clone(activeBranch.proposal));
  const restored = planner.execute({
    type: "restore_snapshot",
    snapshot: {
      ...snapshot,
      proposal: clone(proposal),
      branches: snapshot.branches.map((branch) =>
        branch.id === snapshot.activeBranchId ? { ...branch, proposal: clone(proposal), revisions } : branch,
      ),
    },
  });
  if (restored instanceof Promise) await restored;
  const after = planner.getSnapshot();
  if (fingerprintPlan(after.plan) !== beforePlanFingerprint)
    fail("ADAPTER_ACCEPTED_PLAN_MUTATED", "Adapter staging changed accepted Plan truth");
  if (fingerprintEventBrief(after.brief) !== beforeBriefFingerprint)
    fail("ADAPTER_ACCEPTED_BRIEF_MUTATED", "Adapter staging changed accepted Event Brief truth");
  return Object.freeze({
    status: "review",
    proposalId: after.proposal.id,
    revision: after.proposal.revision,
    baseVersion: after.proposal.baseVersion,
    changedItems: after.proposal.changes.length,
    requiresHumanApproval: true,
  });
}
