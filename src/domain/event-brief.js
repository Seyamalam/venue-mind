const clone = (value) => JSON.parse(JSON.stringify(value));
const PRIORITIES = ["critical", "high", "medium", "low"];
const STATUSES = ["open", "confirmed", "satisfied", "waived"];
const OCCUPANCY_MODES = ["theater", "classroom", "banquet", "standing", "mixed", "custom"];

export function normalizeEventBrief(brief, fallback = null) {
  const source = brief ?? fallback;
  if (!source?.id) throw new Error("Event Brief requires a stable ID");
  if (!Number.isFinite(source.attendeeTarget) || source.attendeeTarget < 0) throw new Error("Event Brief attendee target must be zero or greater");
  if (!OCCUPANCY_MODES.includes(source.occupancyMode ?? "custom")) throw new Error("Event Brief occupancy mode is invalid");
  const ids = new Set();
  const requirements = (source.requirements ?? []).map((requirement) => {
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
    requirements,
  };
}

const requirementCoverage = (brief, validation) => {
  const checks = new Map(validation.checks.map((check) => [check.constraintId, check]));
  return brief.requirements.map((requirement) => {
    const requirementChecks = requirement.constraintIds.map((id) => checks.get(id)).filter(Boolean);
    let status = "unmeasured";
    if (requirementChecks.length > 0) {
      if (requirementChecks.some((check) => check.status === "fail")) status = "blocked";
      else if (requirementChecks.some((check) => check.status === "warning")) status = "warning";
      else if (requirementChecks.every((check) => ["pass", "not-applicable"].includes(check.status))) status = "satisfied";
    }
    return { requirementId: requirement.id, status, constraintIds: requirement.constraintIds, validationCheckIds: requirementChecks.map((check) => check.id) };
  });
};

export function eventBriefWithCoverage(brief, validation, acceptedValidation = validation) {
  const coverage = requirementCoverage(brief, validation);
  const acceptedPlanCoverage = requirementCoverage(brief, acceptedValidation);
  const ambiguities = brief.requirements.flatMap((requirement) => {
    const issues = [];
    if (!requirement.owner) issues.push("owner");
    if (requirement.measurable && requirement.constraintIds.length === 0) issues.push("constraint");
    return issues.map((field) => ({ id: `ambiguity-${requirement.id}-${field}`, requirementId: requirement.id, field }));
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
