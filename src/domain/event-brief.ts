import { normalizeEventSchedule } from "./event-schedule.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const PRIORITIES: any = ["critical", "high", "medium", "low"];
const STATUSES: any = ["open", "confirmed", "satisfied", "waived"];
const OCCUPANCY_MODES: any = ["theater", "classroom", "banquet", "standing", "mixed", "custom"];
const PLANNING_EFFECT_BINDING_CATEGORIES: any = Object.freeze({
  set_attendance_target: "seating",
  set_event_schedule: "staffing",
});

export function normalizePlanningEffectBindings(input: any, requirements: any = []) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Event Brief Planning Effect bindings must be an object");
  const unknownOperations: any = Object.keys(input).filter((operation: any) => !Object.hasOwn(PLANNING_EFFECT_BINDING_CATEGORIES, operation));
  if (unknownOperations.length) throw new Error(`Event Brief Planning Effect bindings contain unknown operations: ${unknownOperations.sort().join(", ")}`);
  const requirementRegistry: any = new Map(requirements.map((requirement: any) => [requirement.id, requirement]));
  return Object.fromEntries(Object.entries(input).sort(([left]: any, [right]: any) => left.localeCompare(right)).map(([operation, binding]: any) => {
    if (!binding || typeof binding !== "object" || Array.isArray(binding)) throw new Error(`Planning Effect binding ${operation} must be an object`);
    const unknown: any = Object.keys(binding).filter((key: any) => !["targetRequirementId", "category", "affectedConstraintIds"].includes(key));
    if (unknown.length) throw new Error(`Planning Effect binding ${operation} contains unknown fields: ${unknown.sort().join(", ")}`);
    if (typeof binding.targetRequirementId !== "string" || !binding.targetRequirementId) throw new Error(`Planning Effect binding ${operation} requires a stable Requirement ID`);
    if (binding.category !== PLANNING_EFFECT_BINDING_CATEGORIES[operation]) throw new Error(`Planning Effect binding ${operation} has an invalid Requirement category`);
    if (!Array.isArray(binding.affectedConstraintIds) || binding.affectedConstraintIds.some((id: any) => typeof id !== "string" || !id)) throw new Error(`Planning Effect binding ${operation} requires stable Constraint IDs`);
    const affectedConstraintIds: any = [...new Set(binding.affectedConstraintIds)].sort();
    if (operation === "set_attendance_target" && affectedConstraintIds.length === 0) throw new Error("Attendance Planning Effect binding requires affected Constraint IDs");
    if (operation === "set_event_schedule" && affectedConstraintIds.length !== 0) throw new Error("Schedule Planning Effect binding cannot affect spatial Constraints");
    const requirement: any = requirementRegistry.get(binding.targetRequirementId);
    if (!requirement || requirement.category !== binding.category || JSON.stringify(requirement.constraintIds) !== JSON.stringify(affectedConstraintIds)) throw new Error(`Planning Effect binding ${operation} does not match the Event Brief Requirement registry`);
    return [operation, { targetRequirementId: binding.targetRequirementId, category: binding.category, affectedConstraintIds }];
  }));
}

export function normalizeEventBrief(brief: any, fallback: any = null) {
  const source: any = brief ?? fallback;
  if (!source?.id) throw new Error("Event Brief requires a stable ID");
  if (!Number.isFinite(source.attendeeTarget) || source.attendeeTarget < 0) throw new Error("Event Brief attendee target must be zero or greater");
  if (!OCCUPANCY_MODES.includes(source.occupancyMode ?? "custom")) throw new Error("Event Brief occupancy mode is invalid");
  const schedule: any = normalizeEventSchedule(source.schedule, { label: "Event Brief schedule", nullable: true });
  const ids: any = new Set();
  const requirements: any = (source.requirements ?? []).map((requirement: any) => {
    if (!requirement.id || ids.has(requirement.id)) throw new Error("Event Brief requirements require unique stable IDs");
    ids.add(requirement.id);
    if (!PRIORITIES.includes(requirement.priority)) throw new Error(`Invalid Requirement priority: ${requirement.id}`);
    if (!STATUSES.includes(requirement.status)) throw new Error(`Invalid Requirement status: ${requirement.id}`);
    return {
      id: requirement.id,
      category: requirement.category,
      label: requirement.label,
      priority: requirement.priority,
      owner: requirement.owner ?? null,
      status: requirement.status,
      measurable: requirement.measurable ?? (requirement.constraintIds?.length > 0),
      constraintIds: [...new Set(requirement.constraintIds ?? [])].sort(),
      evidenceRefs: [...new Set(requirement.evidenceRefs ?? [])].sort(),
    };
  });
  return {
    id: source.id,
    eventName: source.eventName ?? "Untitled event",
    date: source.date ?? null,
    timezone: source.timezone ?? "UTC",
    venueId: source.venueId ?? null,
    roomId: source.roomId ?? null,
    attendeeTarget: source.attendeeTarget,
    occupancyMode: source.occupancyMode ?? "custom",
    schedule,
    requirements,
    ...(source.planningEffectBindings !== undefined ? { planningEffectBindings: normalizePlanningEffectBindings(source.planningEffectBindings, requirements) } : {}),
  };
}

const requirementCoverage: any = (brief: any, validation: any) => {
  const checks: any = new Map(validation.checks.map((check: any) => [check.constraintId, check]));
  return brief.requirements.map((requirement: any) => {
    const requirementChecks: any = requirement.constraintIds.map((id: any) => checks.get(id)).filter(Boolean);
    let status: any = "unmeasured";
    if (requirementChecks.length > 0) {
      if (requirementChecks.some((check: any) => check.status === "fail")) status = "blocked";
      else if (requirementChecks.some((check: any) => check.status === "warning")) status = "warning";
      else if (requirementChecks.every((check: any) => ["pass", "not-applicable"].includes(check.status))) status = "satisfied";
    }
    return { requirementId: requirement.id, status, constraintIds: requirement.constraintIds, validationCheckIds: requirementChecks.map((check: any) => check.id) };
  });
};

export function eventBriefWithCoverage(brief: any, validation: any, acceptedValidation: any = validation) {
  const coverage: any = requirementCoverage(brief, validation);
  const acceptedPlanCoverage: any = requirementCoverage(brief, acceptedValidation);
  const ambiguities: any = brief.requirements.flatMap((requirement: any) => {
    const issues: any[] = [];
    if (!requirement.owner) issues.push("owner");
    if (requirement.measurable && requirement.constraintIds.length === 0) issues.push("constraint");
    return issues.map((field: any) => ({ id: `ambiguity-${requirement.id}-${field}`, requirementId: requirement.id, field }));
  });
  return {
    ...clone(brief),
    coverage,
    coverageMatrix: {
      acceptedPlan: acceptedPlanCoverage,
      activeProposal: coverage,
    },
    ambiguities,
    summary: {
      total: brief.requirements.length,
      measured: coverage.filter((item: any) => item.status !== "unmeasured").length,
      satisfied: coverage.filter((item: any) => item.status === "satisfied").length,
      unresolved: coverage.filter((item: any) => ["blocked", "warning", "unmeasured"].includes(item.status)).length,
      ambiguous: ambiguities.length,
    },
  };
}
