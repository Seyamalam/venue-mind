import {
  normalizeEventBrief,
  type EventBrief,
  type EventRequirement,
  type PlanningEffectBindings,
} from "./event-brief.ts";
import { normalizeEventSchedule, type EventSchedule } from "./event-schedule.ts";
import { assertCanonicalUtcTimestamp } from "./timestamps.ts";
import type { ConstraintWaiver, RoomTemplateUpdateMetadata, VenueProposal } from "./geometry.ts";
import type { SpatialMutation } from "./locks.ts";

const clone = <T>(value: T): T => structuredClone(value);
const SHA256 = /^[0-9a-f]{64}$/;
const PLANNING_EFFECT_OPERATIONS = new Set(["set_attendance_target", "set_event_schedule"]);
const EVIDENCE_FAMILIES = new Set(["capacity", "flow", "operations"]);

type PlanningEffectOperation = "set_attendance_target" | "set_event_schedule";
type EvidenceFamily = "capacity" | "flow" | "operations";
const isPlanningEffectOperation = (value: unknown): value is PlanningEffectOperation =>
  value === "set_attendance_target" || value === "set_event_schedule";
const isRoomTemplateUpdateMetadata = (value: unknown): value is RoomTemplateUpdateMetadata =>
  isRecord(value) &&
  value.kind === "room-template" &&
  typeof value.templateId === "string" &&
  typeof value.fromVersion === "string" &&
  typeof value.toVersion === "string" &&
  typeof value.actor === "string" &&
  Array.isArray(value.skipped) &&
  Array.isArray(value.preservedOverrides);
interface SourceEvidence {
  adapterId: string;
  sourceSystem: string;
  entityType: string;
  externalId: string;
  sourceVersion: string;
  checksum: string;
  synchronizedAt: string;
}
export interface PlanningEffect {
  operation: PlanningEffectOperation;
  targetBriefId: string;
  targetRequirementId: string;
  before: number | EventSchedule | null;
  after: number | EventSchedule;
  requirement: EventRequirement;
  affectedConstraintIds: string[];
  evidenceFamilies: EvidenceFamily[];
  source: SourceEvidence;
}
export interface PlanningChange {
  id: string;
  number?: number;
  title?: string;
  shortTitle?: string;
  label?: string;
  editor?: { operation: string; input: object; fingerprint: string };
  metrics?: Array<[string, string]>;
  targetObjectIds?: string[];
  targetRequirementIds?: string[];
  effects?: Record<
    string,
    number | boolean | string | { kind: string; sourceId: string; sourceChecksum: string } | undefined
  >;
  planningEffects?: readonly PlanningEffect[];
  spatialEffects?: SpatialMutation[];
  semantic?: object;
  lineage?: object;
  templateUpdate?: object;
}
interface ConstraintReference {
  id: string;
  category: string;
}
interface PlanningEffectContext {
  brief: EventBrief;
  constraints: ConstraintReference[];
  planningEffectBindings?: PlanningEffectBindings;
}
interface RawPlanningRecord extends Record<string, unknown> {
  operation?: unknown;
  targetBriefId?: unknown;
  targetRequirementId?: unknown;
  before?: unknown;
  after?: unknown;
  requirement?: unknown;
  affectedConstraintIds?: unknown;
  evidenceFamilies?: unknown;
  source?: unknown;
  changes?: unknown;
  planningEffects?: unknown;
  spatialEffects?: unknown;
  adapterId?: unknown;
  sourceSystem?: unknown;
  entityType?: unknown;
  externalId?: unknown;
  sourceVersion?: unknown;
  checksum?: unknown;
  synchronizedAt?: unknown;
  id?: unknown;
  number?: unknown;
  title?: unknown;
  shortTitle?: unknown;
  label?: unknown;
  editor?: unknown;
  metrics?: unknown;
  targetObjectIds?: unknown;
  targetRequirementIds?: unknown;
  effects?: unknown;
  semantic?: unknown;
  lineage?: unknown;
  templateUpdate?: unknown;
  baseVersion?: unknown;
  revision?: unknown;
  status?: unknown;
  goal?: unknown;
  waivers?: unknown;
  validation?: unknown;
}

const isRecord = (input: unknown): input is RawPlanningRecord =>
  Boolean(input) && typeof input === "object" && !Array.isArray(input);
const isStringArray = (input: unknown): input is string[] =>
  Array.isArray(input) && input.every((item) => typeof item === "string" && item.length > 0);
const isEvidenceFamilyArray = (input: unknown): input is EvidenceFamily[] =>
  Array.isArray(input) && input.every((item) => typeof item === "string" && EVIDENCE_FAMILIES.has(item));
const isSpatialMutation = (input: unknown): input is SpatialMutation =>
  isRecord(input) &&
  typeof input.operation === "string" &&
  (input["objectId"] === undefined || typeof input["objectId"] === "string");
type ChangeEffectValue = NonNullable<PlanningChange["effects"]>[string];
const isChangeEffectValue = (value: unknown): value is ChangeEffectValue =>
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean" ||
  (isRecord(value) &&
    typeof value["kind"] === "string" &&
    typeof value["sourceId"] === "string" &&
    typeof value["sourceChecksum"] === "string");
const normalizeChangeEffects = (value: RawPlanningRecord): NonNullable<PlanningChange["effects"]> =>
  Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, ChangeEffectValue] => isChangeEffectValue(entry[1])),
  );
const isConstraintWaiver = (value: unknown): value is ConstraintWaiver =>
  isRecord(value) && typeof value["constraintId"] === "string";

function fail(message: string): never {
  throw new Error(`Planning Effect invalid: ${message}`);
}

function exactKeys(value: unknown, allowed: readonly string[], label: string): asserts value is RawPlanningRecord {
  if (!isRecord(value)) fail(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`${label} contains unknown fields: ${unknown.sort().join(", ")}`);
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value) fail(`${label} is required`);
}

const normalizeRequirement = (requirement: unknown): EventRequirement => {
  const brief = normalizeEventBrief({ id: "brief-effect-validation", attendeeTarget: 0, requirements: [requirement] });
  const normalized = brief.requirements[0];
  if (!normalized) fail("requirement is required");
  return normalized;
};

const normalizeSource = (source: unknown): SourceEvidence => {
  exactKeys(
    source,
    ["adapterId", "sourceSystem", "entityType", "externalId", "sourceVersion", "checksum", "synchronizedAt"],
    "source evidence",
  );
  const adapterId = source.adapterId;
  nonEmptyString(adapterId, "source adapterId");
  const sourceSystem = source.sourceSystem;
  nonEmptyString(sourceSystem, "source sourceSystem");
  const entityType = source.entityType;
  nonEmptyString(entityType, "source entityType");
  const externalId = source.externalId;
  nonEmptyString(externalId, "source externalId");
  const sourceVersion = source.sourceVersion;
  nonEmptyString(sourceVersion, "source sourceVersion");
  const synchronizedAt = source.synchronizedAt;
  nonEmptyString(synchronizedAt, "source synchronizedAt");
  const checksum = source.checksum;
  if (typeof checksum !== "string" || !SHA256.test(checksum))
    fail("source checksum must be a lowercase SHA-256 digest");
  try {
    assertCanonicalUtcTimestamp(synchronizedAt, "source synchronizedAt");
  } catch (error) {
    fail(error instanceof Error ? error.message : "source synchronizedAt is invalid");
  }
  return clone({
    adapterId,
    sourceSystem,
    entityType,
    externalId,
    sourceVersion,
    checksum,
    synchronizedAt,
  });
};

const normalizeSchedule = (
  schedule: unknown,
  label: string,
  { nullable = false }: { nullable?: boolean } = {},
): EventSchedule | null => {
  try {
    return normalizeEventSchedule(schedule, { label, nullable });
  } catch (error) {
    fail(error instanceof Error ? error.message : `${label} is invalid`);
  }
};

export function normalizePlanningEffect(input: unknown): Readonly<PlanningEffect> {
  exactKeys(
    input,
    [
      "operation",
      "targetBriefId",
      "targetRequirementId",
      "before",
      "after",
      "requirement",
      "affectedConstraintIds",
      "evidenceFamilies",
      "source",
    ],
    "effect",
  );
  if (!isPlanningEffectOperation(input.operation) || !PLANNING_EFFECT_OPERATIONS.has(input.operation))
    fail(`unsupported operation ${typeof input.operation === "string" ? input.operation : ""}`);
  nonEmptyString(input.targetBriefId, "targetBriefId");
  nonEmptyString(input.targetRequirementId, "targetRequirementId");
  const requirement = normalizeRequirement(input.requirement);
  if (requirement.id !== input.targetRequirementId) fail("Requirement ID must match targetRequirementId");
  if (!isStringArray(input.affectedConstraintIds)) fail("affectedConstraintIds must be stable IDs");
  if (!isEvidenceFamilyArray(input.evidenceFamilies) || input.evidenceFamilies.length === 0)
    fail("evidenceFamilies are invalid");
  const affectedConstraintIds = [...new Set(input.affectedConstraintIds)].sort();
  const evidenceFamilies = [...new Set(input.evidenceFamilies)].sort();
  let before: number | EventSchedule | null;
  let after: number | EventSchedule;
  if (input.operation === "set_attendance_target") {
    if (
      typeof input.before !== "number" ||
      typeof input.after !== "number" ||
      !Number.isInteger(input.before) ||
      input.before < 0 ||
      !Number.isInteger(input.after) ||
      input.after < 0 ||
      input.before === input.after
    )
      fail("attendance targets must be distinct non-negative integers");
    if (evidenceFamilies.join("\u0000") !== ["capacity", "flow"].join("\u0000"))
      fail("attendance changes must invalidate exactly capacity and flow evidence");
    if (affectedConstraintIds.length === 0) fail("attendance changes require affected Constraint IDs");
    before = input.before;
    after = input.after;
  } else {
    before = normalizeSchedule(input.before, "before schedule", { nullable: true });
    const normalizedAfter = normalizeSchedule(input.after, "after schedule");
    if (!normalizedAfter) fail("after schedule is required");
    after = normalizedAfter;
    if (JSON.stringify(before) === JSON.stringify(after)) fail("schedule values must differ");
    if (evidenceFamilies.join("\u0000") !== "operations")
      fail("schedule changes must invalidate exactly operations evidence");
  }
  return Object.freeze({
    operation: input.operation,
    targetBriefId: input.targetBriefId,
    targetRequirementId: input.targetRequirementId,
    before,
    after,
    requirement,
    affectedConstraintIds,
    evidenceFamilies,
    source: normalizeSource(input.source),
  });
}

export function assertPlanningEffectBinding(
  rawEffect: unknown,
  context: PlanningEffectContext,
): Readonly<PlanningEffect> {
  const effect = normalizePlanningEffect(rawEffect);
  const brief = context?.brief;
  const constraints = context?.constraints;
  const planningEffectBindings = context?.planningEffectBindings ?? brief?.planningEffectBindings;
  if (
    !brief ||
    !Array.isArray(brief.requirements) ||
    !Array.isArray(constraints) ||
    !planningEffectBindings ||
    typeof planningEffectBindings !== "object"
  )
    fail("server-owned Brief, Constraint registry, and Planning Effect bindings are required");
  const binding = planningEffectBindings[effect.operation];
  const registeredRequirement = brief.requirements.find((requirement) => requirement.id === effect.targetRequirementId);
  if (
    !binding ||
    binding.targetRequirementId !== effect.targetRequirementId ||
    effect.targetBriefId !== brief.id ||
    !registeredRequirement
  )
    fail("effect target is not allocated by the server-owned Project context");
  if (
    binding.category !== registeredRequirement.category ||
    effect.requirement.category !== registeredRequirement.category
  )
    fail("effect Requirement category does not match the server-owned Requirement registry");
  const expectedConstraintIds = [...new Set(binding.affectedConstraintIds ?? [])].sort();
  if (JSON.stringify(expectedConstraintIds) !== JSON.stringify(effect.affectedConstraintIds))
    fail("effect Constraints do not match the server-owned binding");
  if (JSON.stringify(expectedConstraintIds) !== JSON.stringify(effect.requirement.constraintIds))
    fail("effect Requirement Constraints do not match the server-owned binding");
  const allowedConstraintCategories: Record<PlanningEffectOperation, Set<string>> = {
    set_attendance_target: new Set(["capacity", "circulation"]),
    set_event_schedule: new Set(),
  };
  const constraintRegistry = new Map(constraints.map((constraint) => [constraint.id, constraint]));
  for (const constraintId of expectedConstraintIds) {
    const constraint = constraintRegistry.get(constraintId);
    if (!constraint || !allowedConstraintCategories[effect.operation]?.has(constraint.category))
      fail("effect cites an untrusted or incompatible Constraint");
  }
  return effect;
}

export function normalizeProposalPlanningEffects(proposal: unknown, path = "proposal"): VenueProposal {
  if (!isRecord(proposal) || !Array.isArray(proposal.changes)) fail(`${path} must contain Changes`);
  if (typeof proposal.id !== "string" || !proposal.id) fail(`${path} requires an ID`);
  if (
    typeof proposal.baseVersion !== "string" ||
    typeof proposal.revision !== "number" ||
    typeof proposal.status !== "string" ||
    typeof proposal.goal !== "string" ||
    !Array.isArray(proposal.waivers)
  )
    fail(`${path} requires canonical metadata`);
  if (
    proposal.adjustment !== undefined &&
    (typeof proposal.adjustment !== "string" ||
      !proposal.adjustment.trim() ||
      proposal.adjustment.length > 2_000 ||
      proposal.adjustment !== proposal.adjustment.trim())
  )
    fail(`${path}.adjustment must be a canonical bounded instruction`);
  return {
    id: proposal.id,
    baseVersion: proposal.baseVersion,
    revision: proposal.revision,
    status: proposal.status,
    goal: proposal.goal,
    waivers: clone(proposal.waivers).filter(isConstraintWaiver),
    validation: proposal.validation === null || isRecord(proposal.validation) ? clone(proposal.validation) : null,
    ...(typeof proposal.adjustment === "string" ? { adjustment: proposal.adjustment } : {}),
    ...(proposal.templateUpdate === null || isRoomTemplateUpdateMetadata(proposal.templateUpdate)
      ? { templateUpdate: clone(proposal.templateUpdate) }
      : {}),
    ...(Array.isArray(proposal.lineage)
      ? { lineage: clone(proposal.lineage).filter((item): item is object => Boolean(item) && typeof item === "object") }
      : {}),
    changes: proposal.changes.map((change, changeIndex): PlanningChange => {
      if (!isRecord(change)) fail(`${path}.changes[${changeIndex}] must be an object`);
      if (typeof change.id !== "string" || !change.id) fail(`${path}.changes[${changeIndex}] requires an ID`);
      const targetObjectIds = change.targetObjectIds;
      const targetRequirementIds = change.targetRequirementIds;
      if (targetObjectIds !== undefined && !isStringArray(targetObjectIds))
        fail(`${path}.changes[${changeIndex}].targetObjectIds must contain IDs`);
      if (targetRequirementIds !== undefined && !isStringArray(targetRequirementIds))
        fail(`${path}.changes[${changeIndex}].targetRequirementIds must contain IDs`);
      const baseChange: PlanningChange = {
        id: change.id,
        ...(typeof change.number === "number" ? { number: change.number } : {}),
        ...(typeof change.title === "string" ? { title: change.title } : {}),
        ...(typeof change.shortTitle === "string" ? { shortTitle: change.shortTitle } : {}),
        ...(typeof change.label === "string" ? { label: change.label } : {}),
        ...(isRecord(change.editor) &&
        typeof change.editor.operation === "string" &&
        isRecord(change.editor["input"]) &&
        typeof change.editor["fingerprint"] === "string"
          ? {
              editor: {
                operation: change.editor.operation,
                input: clone(change.editor["input"]),
                fingerprint: change.editor["fingerprint"],
              },
            }
          : {}),
        ...(Array.isArray(change.metrics) &&
        change.metrics.every(
          (row): row is [string, string] =>
            Array.isArray(row) && row.length === 2 && row.every((item) => typeof item === "string"),
        )
          ? { metrics: clone(change.metrics) }
          : {}),
        ...(targetObjectIds ? { targetObjectIds: [...targetObjectIds] } : {}),
        ...(targetRequirementIds ? { targetRequirementIds: [...targetRequirementIds] } : {}),
        ...(isRecord(change.effects) ? { effects: normalizeChangeEffects(change.effects) } : {}),
        ...(isRecord(change.semantic) ? { semantic: clone(change.semantic) } : {}),
        ...(isRecord(change.lineage) ? { lineage: clone(change.lineage) } : {}),
        ...(isRecord(change.templateUpdate) ? { templateUpdate: clone(change.templateUpdate) } : {}),
      };
      if (change.planningEffects === undefined) {
        if (
          change.spatialEffects !== undefined &&
          (!Array.isArray(change.spatialEffects) || !change.spatialEffects.every(isSpatialMutation))
        )
          fail(`${path}.changes[${changeIndex}].spatialEffects must be an array`);
        return {
          ...baseChange,
          ...(Array.isArray(change.spatialEffects) ? { spatialEffects: clone(change.spatialEffects) } : {}),
        };
      }
      if (!Array.isArray(change.planningEffects))
        fail(`${path}.changes[${changeIndex}].planningEffects must be an array`);
      const planningEffects = (change.planningEffects ?? []).map((effect) => normalizePlanningEffect(effect));
      const spatialEffects = change.spatialEffects ?? [];
      if (!Array.isArray(spatialEffects) || !spatialEffects.every(isSpatialMutation))
        fail(`${path}.changes[${changeIndex}].spatialEffects must be an array`);
      return { ...baseChange, planningEffects, spatialEffects: clone(spatialEffects) };
    }),
  };
}

export function materializeEventBrief(brief: unknown, changes: readonly PlanningChange[] = []): EventBrief {
  let candidate = normalizeEventBrief(brief);
  for (const change of changes) {
    for (const rawEffect of change.planningEffects ?? []) {
      const effect = normalizePlanningEffect(rawEffect);
      if (effect.targetBriefId !== candidate.id)
        fail(`target Brief ${effect.targetBriefId} does not match ${candidate.id}`);
      const current = effect.operation === "set_attendance_target" ? candidate.attendeeTarget : candidate.schedule;
      if (JSON.stringify(current) !== JSON.stringify(effect.before)) fail(`${effect.operation} before value is stale`);
      const requirements = candidate.requirements.filter((item) => item.id !== effect.targetRequirementId);
      requirements.push(effect.requirement);
      requirements.sort((left, right) => left.id.localeCompare(right.id));
      candidate = normalizeEventBrief({
        ...candidate,
        ...(effect.operation === "set_attendance_target"
          ? { attendeeTarget: effect.after }
          : {
              schedule: effect.after,
              date: typeof effect.after === "object" ? effect.after.startAt.slice(0, 10) : null,
              timezone: typeof effect.after === "object" ? effect.after.timezone : candidate.timezone,
            }),
        requirements,
      });
    }
  }
  return candidate;
}

export function planningEvidenceInvalidations(changes: readonly PlanningChange[] = []) {
  const affectedConstraintIds = new Set<string>();
  const evidenceFamilies = new Set<EvidenceFamily>();
  for (const change of changes)
    for (const effect of change.planningEffects ?? []) {
      const normalized = normalizePlanningEffect(effect);
      normalized.affectedConstraintIds.forEach((id) => affectedConstraintIds.add(id));
      normalized.evidenceFamilies.forEach((family) => evidenceFamilies.add(family));
    }
  return Object.freeze({
    affectedConstraintIds: [...affectedConstraintIds].sort(),
    evidenceFamilies: [...evidenceFamilies].sort(),
  });
}
