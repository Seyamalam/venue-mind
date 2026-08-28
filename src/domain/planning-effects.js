import { normalizeEventBrief } from "./event-brief.js";

const clone = (value) => structuredClone(value);
const SHA256 = /^[0-9a-f]{64}$/;
const PLANNING_EFFECT_OPERATIONS = new Set(["set_attendance_target", "set_event_schedule"]);
const EVIDENCE_FAMILIES = new Set(["capacity", "flow", "operations"]);

const fail = (message) => {
  throw new Error(`Planning Effect invalid: ${message}`);
};

const exactKeys = (value, allowed, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail(`${label} contains unknown fields: ${unknown.sort().join(", ")}`);
};

const nonEmptyString = (value, label) => {
  if (typeof value !== "string" || !value) fail(`${label} is required`);
};

const normalizeRequirement = (requirement) => {
  const brief = normalizeEventBrief({ id: "brief-effect-validation", attendeeTarget: 0, requirements: [requirement] });
  return brief.requirements[0];
};

const normalizeSource = (source) => {
  exactKeys(source, ["adapterId", "sourceSystem", "entityType", "externalId", "sourceVersion", "checksum", "synchronizedAt"], "source evidence");
  for (const field of ["adapterId", "sourceSystem", "entityType", "externalId", "sourceVersion", "synchronizedAt"]) nonEmptyString(source[field], `source ${field}`);
  if (!SHA256.test(source.checksum ?? "")) fail("source checksum must be a lowercase SHA-256 digest");
  if (Number.isNaN(Date.parse(source.synchronizedAt))) fail("source synchronizedAt must be a timestamp");
  return clone(source);
};

const normalizeSchedule = (schedule, label) => {
  exactKeys(schedule, ["startAt", "endAt", "timezone"], label);
  for (const field of ["startAt", "endAt", "timezone"]) nonEmptyString(schedule[field], `${label} ${field}`);
  if (Number.isNaN(Date.parse(schedule.startAt)) || Number.isNaN(Date.parse(schedule.endAt)) || Date.parse(schedule.endAt) <= Date.parse(schedule.startAt)) fail(`${label} must have a valid start before end`);
  try {
    new Intl.DateTimeFormat("en", { timeZone: schedule.timezone }).format();
  } catch {
    fail(`${label} timezone is invalid`);
  }
  return clone(schedule);
};

export function normalizePlanningEffect(input) {
  exactKeys(input, ["operation", "targetBriefId", "targetRequirementId", "before", "after", "requirement", "affectedConstraintIds", "evidenceFamilies", "source"], "effect");
  if (!PLANNING_EFFECT_OPERATIONS.has(input.operation)) fail(`unsupported operation ${input.operation ?? ""}`);
  nonEmptyString(input.targetBriefId, "targetBriefId");
  nonEmptyString(input.targetRequirementId, "targetRequirementId");
  const requirement = normalizeRequirement(input.requirement);
  if (requirement.id !== input.targetRequirementId) fail("Requirement ID must match targetRequirementId");
  if (!Array.isArray(input.affectedConstraintIds) || input.affectedConstraintIds.some((id) => typeof id !== "string" || !id)) fail("affectedConstraintIds must be stable IDs");
  if (!Array.isArray(input.evidenceFamilies) || input.evidenceFamilies.length === 0 || input.evidenceFamilies.some((family) => !EVIDENCE_FAMILIES.has(family))) fail("evidenceFamilies are invalid");
  const affectedConstraintIds = [...new Set(input.affectedConstraintIds)].sort();
  const evidenceFamilies = [...new Set(input.evidenceFamilies)].sort();
  let before;
  let after;
  if (input.operation === "set_attendance_target") {
    if (!Number.isInteger(input.before) || input.before < 0 || !Number.isInteger(input.after) || input.after < 0 || input.before === input.after) fail("attendance targets must be distinct non-negative integers");
    if (evidenceFamilies.join("\u0000") !== ["capacity", "flow"].join("\u0000")) fail("attendance changes must invalidate exactly capacity and flow evidence");
    if (affectedConstraintIds.length === 0) fail("attendance changes require affected Constraint IDs");
    before = input.before;
    after = input.after;
  } else {
    before = normalizeSchedule(input.before, "before schedule");
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

export function materializeEventBrief(brief, changes = []) {
  let candidate = normalizeEventBrief(brief);
  for (const change of changes) {
    for (const rawEffect of change.planningEffects ?? []) {
      const effect = normalizePlanningEffect(rawEffect);
      if (effect.targetBriefId !== candidate.id) fail(`target Brief ${effect.targetBriefId} does not match ${candidate.id}`);
      const current = effect.operation === "set_attendance_target" ? candidate.attendeeTarget : candidate.schedule;
      if (JSON.stringify(current) !== JSON.stringify(effect.before)) fail(`${effect.operation} before value is stale`);
      const requirements = candidate.requirements.filter((item) => item.id !== effect.targetRequirementId);
      requirements.push(effect.requirement);
      requirements.sort((left, right) => left.id.localeCompare(right.id));
      candidate = normalizeEventBrief({
        ...candidate,
        ...(effect.operation === "set_attendance_target" ? { attendeeTarget: effect.after } : { schedule: effect.after, date: effect.after.startAt.slice(0, 10), timezone: effect.after.timezone }),
        requirements,
      });
    }
  }
  return candidate;
}

export function planningEvidenceInvalidations(changes = []) {
  const affectedConstraintIds = new Set();
  const evidenceFamilies = new Set();
  for (const change of changes) for (const effect of change.planningEffects ?? []) {
    const normalized = normalizePlanningEffect(effect);
    normalized.affectedConstraintIds.forEach((id) => affectedConstraintIds.add(id));
    normalized.evidenceFamilies.forEach((family) => evidenceFamilies.add(family));
  }
  return Object.freeze({ affectedConstraintIds: [...affectedConstraintIds].sort(), evidenceFamilies: [...evidenceFamilies].sort() });
}
