import { normalizeEventBrief } from "./event-brief.ts";
import { normalizeEventSchedule } from "./event-schedule.ts";
import { assertCanonicalUtcTimestamp } from "./timestamps.ts";

const clone: any = (value: any) => structuredClone(value);
const SHA256: any = /^[0-9a-f]{64}$/;
const PLANNING_EFFECT_OPERATIONS: any = new Set(["set_attendance_target", "set_event_schedule"]);
const EVIDENCE_FAMILIES: any = new Set(["capacity", "flow", "operations"]);

const fail: any = (message: any) => {
  throw new Error(`Planning Effect invalid: ${message}`);
};

const exactKeys: any = (value: any, allowed: any, label: any) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const unknown: any = Object.keys(value).filter((key: any) => !allowed.includes(key));
  if (unknown.length) fail(`${label} contains unknown fields: ${unknown.sort().join(", ")}`);
};

const nonEmptyString: any = (value: any, label: any) => {
  if (typeof value !== "string" || !value) fail(`${label} is required`);
};

const normalizeRequirement: any = (requirement: any) => {
  const brief: any = normalizeEventBrief({ id: "brief-effect-validation", attendeeTarget: 0, requirements: [requirement] });
  return brief.requirements[0];
};

const normalizeSource: any = (source: any) => {
  exactKeys(source, ["adapterId", "sourceSystem", "entityType", "externalId", "sourceVersion", "checksum", "synchronizedAt"], "source evidence");
  for (const field of ["adapterId", "sourceSystem", "entityType", "externalId", "sourceVersion", "synchronizedAt"]) nonEmptyString(source[field], `source ${field}`);
  if (!SHA256.test(source.checksum ?? "")) fail("source checksum must be a lowercase SHA-256 digest");
  try {
    assertCanonicalUtcTimestamp(source.synchronizedAt, "source synchronizedAt");
  } catch (error: any) {
    fail(error.message);
  }
  return clone(source);
};

const normalizeSchedule: any = (schedule: any, label: any, { nullable = false }: any = {}) => {
  try {
    return normalizeEventSchedule(schedule, { label, nullable });
  } catch (error: any) {
    fail(error.message);
  }
};

export function normalizePlanningEffect(input: any) {
  exactKeys(input, ["operation", "targetBriefId", "targetRequirementId", "before", "after", "requirement", "affectedConstraintIds", "evidenceFamilies", "source"], "effect");
  if (!PLANNING_EFFECT_OPERATIONS.has(input.operation)) fail(`unsupported operation ${input.operation ?? ""}`);
  nonEmptyString(input.targetBriefId, "targetBriefId");
  nonEmptyString(input.targetRequirementId, "targetRequirementId");
  const requirement: any = normalizeRequirement(input.requirement);
  if (requirement.id !== input.targetRequirementId) fail("Requirement ID must match targetRequirementId");
  if (!Array.isArray(input.affectedConstraintIds) || input.affectedConstraintIds.some((id: any) => typeof id !== "string" || !id)) fail("affectedConstraintIds must be stable IDs");
  if (!Array.isArray(input.evidenceFamilies) || input.evidenceFamilies.length === 0 || input.evidenceFamilies.some((family: any) => !EVIDENCE_FAMILIES.has(family))) fail("evidenceFamilies are invalid");
  const affectedConstraintIds: any = [...new Set(input.affectedConstraintIds)].sort();
  const evidenceFamilies: any = [...new Set(input.evidenceFamilies)].sort();
  let before: any;
  let after: any;
  if (input.operation === "set_attendance_target") {
    if (!Number.isInteger(input.before) || input.before < 0 || !Number.isInteger(input.after) || input.after < 0 || input.before === input.after) fail("attendance targets must be distinct non-negative integers");
    if (evidenceFamilies.join("\u0000") !== ["capacity", "flow"].join("\u0000")) fail("attendance changes must invalidate exactly capacity and flow evidence");
    if (affectedConstraintIds.length === 0) fail("attendance changes require affected Constraint IDs");
    before = input.before;
    after = input.after;
  } else {
    before = normalizeSchedule(input.before, "before schedule", { nullable: true });
    after = normalizeSchedule(input.after, "after schedule");
    if (JSON.stringify(before) === JSON.stringify(after)) fail("schedule values must differ");
    if (evidenceFamilies.join("\u0000") !== "operations") fail("schedule changes must invalidate exactly operations evidence");
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

export function assertPlanningEffectBinding(rawEffect: any, context: any) {
  const effect: any = normalizePlanningEffect(rawEffect);
  const brief: any = context?.brief;
  const constraints: any = context?.constraints;
  const planningEffectBindings: any = context?.planningEffectBindings ?? brief?.planningEffectBindings;
  if (!brief || !Array.isArray(brief.requirements) || !Array.isArray(constraints) || !planningEffectBindings || typeof planningEffectBindings !== "object") fail("server-owned Brief, Constraint registry, and Planning Effect bindings are required");
  const binding: any = planningEffectBindings[effect.operation];
  const registeredRequirement: any = brief.requirements.find((requirement: any) => requirement.id === effect.targetRequirementId);
  if (!binding || binding.targetRequirementId !== effect.targetRequirementId || effect.targetBriefId !== brief.id || !registeredRequirement) fail("effect target is not allocated by the server-owned Project context");
  if (binding.category !== registeredRequirement.category || effect.requirement.category !== registeredRequirement.category) fail("effect Requirement category does not match the server-owned Requirement registry");
  const expectedConstraintIds: any = [...new Set(binding.affectedConstraintIds ?? [])].sort();
  if (JSON.stringify(expectedConstraintIds) !== JSON.stringify(effect.affectedConstraintIds)) fail("effect Constraints do not match the server-owned binding");
  if (JSON.stringify(expectedConstraintIds) !== JSON.stringify(effect.requirement.constraintIds)) fail("effect Requirement Constraints do not match the server-owned binding");
  const allowedConstraintCategories: any = { set_attendance_target: new Set(["capacity", "circulation"]), set_event_schedule: new Set([]) };
  const constraintRegistry: any = new Map(constraints.map((constraint: any) => [constraint.id, constraint]));
  for (const constraintId of expectedConstraintIds) {
    const constraint: any = constraintRegistry.get(constraintId);
    if (!constraint || !allowedConstraintCategories[effect.operation]?.has(constraint.category)) fail("effect cites an untrusted or incompatible Constraint");
  }
  return effect;
}

export function normalizeProposalPlanningEffects(proposal: any, path: any = "proposal") {
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal) || !Array.isArray(proposal.changes)) fail(`${path} must contain Changes`);
  return {
    ...clone(proposal),
    changes: proposal.changes.map((change: any, changeIndex: any) => {
      if (!change || typeof change !== "object" || Array.isArray(change)) fail(`${path}.changes[${changeIndex}] must be an object`);
      if (change.planningEffects === undefined) return clone(change);
      if (!Array.isArray(change.planningEffects)) fail(`${path}.changes[${changeIndex}].planningEffects must be an array`);
      const planningEffects: any = (change.planningEffects ?? []).map((effect: any) => normalizePlanningEffect(effect));
      const spatialEffects: any = change.spatialEffects ?? [];
      if (!Array.isArray(spatialEffects)) fail(`${path}.changes[${changeIndex}].spatialEffects must be an array`);
      return { ...clone(change), planningEffects };
    }),
  };
}

export function materializeEventBrief(brief: any, changes: any = []) {
  let candidate: any = normalizeEventBrief(brief);
  for (const change of changes) {
    for (const rawEffect of change.planningEffects ?? []) {
      const effect: any = normalizePlanningEffect(rawEffect);
      if (effect.targetBriefId !== candidate.id) fail(`target Brief ${effect.targetBriefId} does not match ${candidate.id}`);
      const current: any = effect.operation === "set_attendance_target" ? candidate.attendeeTarget : candidate.schedule;
      if (JSON.stringify(current) !== JSON.stringify(effect.before)) fail(`${effect.operation} before value is stale`);
      const requirements: any = candidate.requirements.filter((item: any) => item.id !== effect.targetRequirementId);
      requirements.push(effect.requirement);
      requirements.sort((left: any, right: any) => left.id.localeCompare(right.id));
      candidate = normalizeEventBrief({
        ...candidate,
        ...(effect.operation === "set_attendance_target" ? { attendeeTarget: effect.after } : { schedule: effect.after, date: effect.after.startAt.slice(0, 10), timezone: effect.after.timezone }),
        requirements,
      });
    }
  }
  return candidate;
}

export function planningEvidenceInvalidations(changes: any = []) {
  const affectedConstraintIds: any = new Set();
  const evidenceFamilies: any = new Set();
  for (const change of changes) for (const effect of change.planningEffects ?? []) {
    const normalized: any = normalizePlanningEffect(effect);
    normalized.affectedConstraintIds.forEach((id: any) => affectedConstraintIds.add(id));
    normalized.evidenceFamilies.forEach((family: any) => evidenceFamilies.add(family));
  }
  return Object.freeze({ affectedConstraintIds: [...affectedConstraintIds].sort(), evidenceFamilies: [...evidenceFamilies].sort() });
}
