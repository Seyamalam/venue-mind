import { normalizeEventSchedule, type EventSchedule } from "./event-schedule.ts";

export type RequirementPriority = "critical" | "high" | "medium" | "low";
export type RequirementStatus = "open" | "confirmed" | "satisfied" | "waived";
export type OccupancyMode = "theater" | "classroom" | "banquet" | "standing" | "mixed" | "custom";
export interface EventRequirement {
  id: string;
  category: string;
  label: string;
  priority: RequirementPriority;
  owner: string | null;
  status: RequirementStatus;
  measurable: boolean;
  constraintIds: string[];
  evidenceRefs: string[];
}
export interface PlanningEffectBinding {
  targetRequirementId: string;
  category: string;
  affectedConstraintIds: string[];
}
export type PlanningEffectBindings = Record<string, PlanningEffectBinding>;
export interface EventBrief {
  id: string;
  eventName: string;
  date: string | null;
  timezone: string;
  venueId: string | null;
  roomId: string | null;
  attendeeTarget: number;
  occupancyMode: OccupancyMode;
  schedule: EventSchedule | null;
  requirements: EventRequirement[];
  planningEffectBindings?: PlanningEffectBindings;
}
export interface ValidationCheck {
  id: string;
  constraintId: string;
  status: "pass" | "fail" | "warning" | "not-applicable";
}
export interface ValidationSummary {
  checks: ValidationCheck[];
}
export type RequirementCoverageStatus = "unmeasured" | "blocked" | "warning" | "satisfied";
const isRequirementPriority = (value: unknown): value is RequirementPriority =>
  value === "critical" || value === "high" || value === "medium" || value === "low";
const isRequirementStatus = (value: unknown): value is RequirementStatus =>
  value === "open" || value === "confirmed" || value === "satisfied" || value === "waived";
const isOccupancyMode = (value: unknown): value is OccupancyMode =>
  value === "theater" ||
  value === "classroom" ||
  value === "banquet" ||
  value === "standing" ||
  value === "mixed" ||
  value === "custom";

interface RawBriefRecord extends Record<string, unknown> {
  id?: unknown;
  attendeeTarget?: unknown;
  occupancyMode?: unknown;
  schedule?: unknown;
  requirements?: unknown;
  eventName?: unknown;
  date?: unknown;
  timezone?: unknown;
  venueId?: unknown;
  roomId?: unknown;
  planningEffectBindings?: unknown;
  targetRequirementId?: unknown;
  category?: unknown;
  affectedConstraintIds?: unknown;
  label?: unknown;
  priority?: unknown;
  owner?: unknown;
  status?: unknown;
  measurable?: unknown;
  constraintIds?: unknown;
  evidenceRefs?: unknown;
}
const isRecord = (input: unknown): input is RawBriefRecord =>
  Boolean(input) && typeof input === "object" && !Array.isArray(input);
const isStringArray = (input: unknown): input is string[] =>
  Array.isArray(input) && input.every((item) => typeof item === "string" && item.length > 0);

const clone = <T>(value: T): T => structuredClone(value);
const PLANNING_EFFECT_BINDING_CATEGORIES: Readonly<Record<string, string>> = Object.freeze({
  set_attendance_target: "seating",
  set_event_schedule: "staffing",
});

export function normalizePlanningEffectBindings(
  input: unknown,
  requirements: readonly EventRequirement[] = [],
): PlanningEffectBindings {
  if (!isRecord(input)) throw new Error("Event Brief Planning Effect bindings must be an object");
  const unknownOperations = Object.keys(input).filter(
    (operation) => !Object.hasOwn(PLANNING_EFFECT_BINDING_CATEGORIES, operation),
  );
  if (unknownOperations.length)
    throw new Error(
      `Event Brief Planning Effect bindings contain unknown operations: ${unknownOperations.sort().join(", ")}`,
    );
  const requirementRegistry = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  return Object.fromEntries(
    Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([operation, binding]) => {
        if (!isRecord(binding)) throw new Error(`Planning Effect binding ${operation} must be an object`);
        const unknown = Object.keys(binding).filter(
          (key) => !["targetRequirementId", "category", "affectedConstraintIds"].includes(key),
        );
        if (unknown.length)
          throw new Error(`Planning Effect binding ${operation} contains unknown fields: ${unknown.sort().join(", ")}`);
        if (typeof binding.targetRequirementId !== "string" || !binding.targetRequirementId)
          throw new Error(`Planning Effect binding ${operation} requires a stable Requirement ID`);
        if (binding.category !== PLANNING_EFFECT_BINDING_CATEGORIES[operation])
          throw new Error(`Planning Effect binding ${operation} has an invalid Requirement category`);
        if (!isStringArray(binding.affectedConstraintIds))
          throw new Error(`Planning Effect binding ${operation} requires stable Constraint IDs`);
        const affectedConstraintIds = [...new Set(binding.affectedConstraintIds)].sort();
        if (operation === "set_attendance_target" && affectedConstraintIds.length === 0)
          throw new Error("Attendance Planning Effect binding requires affected Constraint IDs");
        if (operation === "set_event_schedule" && affectedConstraintIds.length !== 0)
          throw new Error("Schedule Planning Effect binding cannot affect spatial Constraints");
        const requirement = requirementRegistry.get(binding.targetRequirementId);
        if (
          !requirement ||
          requirement.category !== binding.category ||
          JSON.stringify(requirement.constraintIds) !== JSON.stringify(affectedConstraintIds)
        )
          throw new Error(`Planning Effect binding ${operation} does not match the Event Brief Requirement registry`);
        return [
          operation,
          { targetRequirementId: binding.targetRequirementId, category: binding.category, affectedConstraintIds },
        ];
      }),
  );
}

export function normalizeEventBrief(brief: unknown, fallback: unknown = null): EventBrief {
  const source = brief ?? fallback;
  if (!isRecord(source) || typeof source.id !== "string" || !source.id)
    throw new Error("Event Brief requires a stable ID");
  if (typeof source.attendeeTarget !== "number" || !Number.isFinite(source.attendeeTarget) || source.attendeeTarget < 0)
    throw new Error("Event Brief attendee target must be zero or greater");
  const occupancyMode = source.occupancyMode ?? "custom";
  if (!isOccupancyMode(occupancyMode)) throw new Error("Event Brief occupancy mode is invalid");
  const schedule = normalizeEventSchedule(source.schedule, { label: "Event Brief schedule", nullable: true });
  const ids = new Set();
  const rawRequirements = source.requirements ?? [];
  if (!Array.isArray(rawRequirements)) throw new Error("Event Brief requirements must be an array");
  const requirements: EventRequirement[] = rawRequirements.map((requirement) => {
    if (!isRecord(requirement) || typeof requirement.id !== "string" || !requirement.id || ids.has(requirement.id))
      throw new Error("Event Brief requirements require unique stable IDs");
    ids.add(requirement.id);
    if (!isRequirementPriority(requirement.priority))
      throw new Error(`Invalid Requirement priority: ${requirement.id}`);
    if (!isRequirementStatus(requirement.status)) throw new Error(`Invalid Requirement status: ${requirement.id}`);
    if (typeof requirement.category !== "string" || typeof requirement.label !== "string")
      throw new Error(`Invalid Requirement metadata: ${requirement.id}`);
    const constraintIds = requirement.constraintIds ?? [];
    const evidenceRefs = requirement.evidenceRefs ?? [];
    if (!isStringArray(constraintIds) || !isStringArray(evidenceRefs))
      throw new Error(`Invalid Requirement references: ${requirement.id}`);
    return {
      id: requirement.id,
      category: requirement.category,
      label: requirement.label,
      priority: requirement.priority,
      owner: typeof requirement.owner === "string" ? requirement.owner : null,
      status: requirement.status,
      measurable: typeof requirement.measurable === "boolean" ? requirement.measurable : constraintIds.length > 0,
      constraintIds: [...new Set(constraintIds)].sort(),
      evidenceRefs: [...new Set(evidenceRefs)].sort(),
    };
  });
  return {
    id: source.id,
    eventName: typeof source.eventName === "string" ? source.eventName : "Untitled event",
    date: typeof source.date === "string" ? source.date : null,
    timezone: typeof source.timezone === "string" ? source.timezone : "UTC",
    venueId: typeof source.venueId === "string" ? source.venueId : null,
    roomId: typeof source.roomId === "string" ? source.roomId : null,
    attendeeTarget: source.attendeeTarget,
    occupancyMode,
    schedule,
    requirements,
    ...(source.planningEffectBindings !== undefined
      ? { planningEffectBindings: normalizePlanningEffectBindings(source.planningEffectBindings, requirements) }
      : {}),
  };
}

const requirementCoverage = (brief: EventBrief, validation: ValidationSummary) => {
  const checks = new Map(validation.checks.map((check) => [check.constraintId, check]));
  return brief.requirements.map((requirement) => {
    const requirementChecks = requirement.constraintIds
      .map((id) => checks.get(id))
      .filter((check): check is ValidationCheck => check !== undefined);
    let status: RequirementCoverageStatus = "unmeasured";
    if (requirementChecks.length > 0) {
      if (requirementChecks.some((check) => check.status === "fail")) status = "blocked";
      else if (requirementChecks.some((check) => check.status === "warning")) status = "warning";
      else if (requirementChecks.every((check) => ["pass", "not-applicable"].includes(check.status)))
        status = "satisfied";
    }
    return {
      requirementId: requirement.id,
      status,
      constraintIds: requirement.constraintIds,
      validationCheckIds: requirementChecks.map((check) => check.id),
    };
  });
};

export function eventBriefWithCoverage(
  brief: EventBrief,
  validation: ValidationSummary,
  acceptedValidation: ValidationSummary = validation,
) {
  const coverage = requirementCoverage(brief, validation);
  const acceptedPlanCoverage = requirementCoverage(brief, acceptedValidation);
  const ambiguities = brief.requirements.flatMap((requirement) => {
    const issues: Array<"owner" | "constraint"> = [];
    if (!requirement.owner) issues.push("owner");
    if (requirement.measurable && requirement.constraintIds.length === 0) issues.push("constraint");
    return issues.map((field) => ({
      id: `ambiguity-${requirement.id}-${field}`,
      requirementId: requirement.id,
      field,
    }));
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
      measured: coverage.filter((item) => item.status !== "unmeasured").length,
      satisfied: coverage.filter((item) => item.status === "satisfied").length,
      unresolved: coverage.filter((item) => ["blocked", "warning", "unmeasured"].includes(item.status)).length,
      ambiguous: ambiguities.length,
    },
  };
}
