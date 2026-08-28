import { AdapterContractError, createSyncCursor, defineAdapter, sha256Checksum } from "../contracts.js";
import { createVenueAdapter } from "../runtime.js";

const clone = (value) => structuredClone(value);

export const calendarEventAdapterDefinition = defineAdapter({
  contractVersion: 1,
  id: "calendar-events",
  displayName: "Calendar Events",
  version: "1.0.0",
  capabilities: ["import", "synchronize", "webhook"],
  scopes: {
    import: ["calendar:event:read"],
    synchronize: ["calendar:event:read"],
    webhook: ["calendar:event:webhook"],
  },
  retryPolicy: { maxAttempts: 4, initialDelayMs: 100, maximumDelayMs: 800, multiplier: 2, retryableCodes: ["ADAPTER_NETWORK_ERROR", "ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"] },
  rateLimit: { requests: 60, windowMs: 60_000 },
});

const fail = (message, details = {}) => {
  throw new AdapterContractError("ADAPTER_SOURCE_INVALID", message, details);
};

const assertExact = (value, keys, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) throw new AdapterContractError("ADAPTER_CONTRACT_UNKNOWN_FIELD", `${label} contains unknown fields`, { fields: unknown.sort() });
};

const normalizeSchedule = (event, { nullable = false } = {}) => {
  if (nullable && event === null) return null;
  const schedule = { startAt: event.startAt, endAt: event.endAt, timezone: event.timezone };
  if ([schedule.startAt, schedule.endAt, schedule.timezone].some((value) => typeof value !== "string" || !value)) fail("Calendar event schedule is required");
  if (Number.isNaN(Date.parse(schedule.startAt)) || Number.isNaN(Date.parse(schedule.endAt)) || Date.parse(schedule.endAt) <= Date.parse(schedule.startAt)) fail("Calendar event must have a valid start before end");
  try {
    new Intl.DateTimeFormat("en", { timeZone: schedule.timezone }).format();
  } catch {
    fail("Calendar event timezone is invalid", { timezone: schedule.timezone });
  }
  return schedule;
};

const normalizeEvent = (event) => {
  assertExact(event, ["externalId", "sourceVersion", "title", "startAt", "endAt", "timezone", "location", "attendanceTarget", "organizer"], "Calendar event");
  for (const field of ["externalId", "sourceVersion", "title"]) if (typeof event[field] !== "string" || !event[field]) fail(`Calendar event ${field} is required`);
  if (!Number.isInteger(event.attendanceTarget) || event.attendanceTarget < 0) fail("Calendar event attendanceTarget must be a non-negative integer");
  assertExact(event.location, ["label"], "Calendar event location");
  assertExact(event.organizer, ["displayName", "organization", "role"], "Calendar event organizer");
  if (typeof event.location.label !== "string" || !event.location.label || typeof event.organizer.displayName !== "string" || !event.organizer.displayName) fail("Calendar event location and organizer labels are required");
  for (const [field, value] of Object.entries(event.organizer)) if (typeof value !== "string" || !value || value.includes("@")) fail("Calendar organizer metadata must not contain contact PII", { field });
  return Object.freeze({
    externalId: event.externalId,
    sourceVersion: event.sourceVersion,
    title: event.title,
    ...normalizeSchedule(event),
    location: clone(event.location),
    attendanceTarget: event.attendanceTarget,
    organizer: clone(event.organizer),
  });
};

const requirement = ({ id, category, label, constraintIds, evidenceRef }) => ({
  id,
  category,
  label,
  priority: "high",
  owner: null,
  status: "confirmed",
  measurable: constraintIds.length > 0,
  constraintIds,
  evidenceRefs: [evidenceRef],
});

const importEvent = async (input, definition, synchronizedAt) => {
  assertExact(input.currentPlanningState, ["attendeeTarget", "schedule"], "Current planning state");
  assertExact(input.requirementIds, ["attendance", "schedule"], "Requirement IDs");
  for (const field of ["sourceSystem", "projectId", "briefId"]) if (typeof input[field] !== "string" || !input[field]) fail(`${field} is required`);
  for (const field of ["attendance", "schedule"]) if (typeof input.requirementIds[field] !== "string" || !input.requirementIds[field]) fail(`Stable ${field} Requirement ID is required`);
  if (!Number.isInteger(input.currentPlanningState.attendeeTarget) || input.currentPlanningState.attendeeTarget < 0) fail("Current attendee target is invalid");
  const event = normalizeEvent(input.event);
  const currentSchedule = normalizeSchedule(input.currentPlanningState.schedule, { nullable: true });
  const checksum = await sha256Checksum(event);
  const external = { adapterId: definition.id, sourceSystem: input.sourceSystem, entityType: "calendar-event", externalId: event.externalId, sourceVersion: event.sourceVersion, checksum };
  if (input.projectId === event.externalId || input.requirementIds.attendance === event.externalId || input.requirementIds.schedule === event.externalId) throw new AdapterContractError("ADAPTER_ID_BOUNDARY_VIOLATION", "Calendar external ID must remain separate from VenueMind stable IDs", { externalId: event.externalId });
  const source = { ...external, synchronizedAt };
  const evidenceRef = `adapter:${definition.id}:${checksum}`;
  const changes = [];
  if (input.currentPlanningState.attendeeTarget !== event.attendanceTarget) {
    const affectedConstraintIds = [...new Set(input.attendanceConstraintIds ?? [])].sort();
    if (affectedConstraintIds.length === 0) fail("Attendance updates require affected Constraint IDs");
    const attendanceRequirement = requirement({ id: input.requirementIds.attendance, category: "seating", label: `Attendance target ${event.attendanceTarget}`, constraintIds: affectedConstraintIds, evidenceRef });
    changes.push({
      id: `change-calendar-attendance-${(await sha256Checksum({ externalId: event.externalId, sourceVersion: event.sourceVersion, attendanceTarget: event.attendanceTarget })).slice(0, 12)}`,
      operation: "update",
      venueEntityType: "event-brief-requirement",
      venueObjectId: input.requirementIds.attendance,
      external,
      planningEffects: [{ operation: "set_attendance_target", targetBriefId: input.briefId, targetRequirementId: input.requirementIds.attendance, before: input.currentPlanningState.attendeeTarget, after: event.attendanceTarget, requirement: attendanceRequirement, affectedConstraintIds, evidenceFamilies: ["capacity", "flow"], source }],
    });
  }
  const eventSchedule = { startAt: event.startAt, endAt: event.endAt, timezone: event.timezone };
  if (JSON.stringify(currentSchedule) !== JSON.stringify(eventSchedule)) {
    const scheduleRequirement = requirement({ id: input.requirementIds.schedule, category: "staffing", label: `Event schedule ${event.startAt}`, constraintIds: [], evidenceRef });
    changes.push({
      id: `change-calendar-schedule-${(await sha256Checksum({ externalId: event.externalId, sourceVersion: event.sourceVersion, schedule: eventSchedule })).slice(0, 12)}`,
      operation: "update",
      venueEntityType: "event-brief-requirement",
      venueObjectId: input.requirementIds.schedule,
      external,
      planningEffects: [{ operation: "set_event_schedule", targetBriefId: input.briefId, targetRequirementId: input.requirementIds.schedule, before: currentSchedule, after: eventSchedule, requirement: scheduleRequirement, affectedConstraintIds: [], evidenceFamilies: ["operations"], source }],
    });
  }
  const sourceVersion = input.sourceVersion ?? event.sourceVersion;
  return {
    sourceSystem: input.sourceSystem,
    sourceVersion,
    synchronizedAt,
    syncCursor: await createSyncCursor(definition, { opaque: input.nextCursor ?? sourceVersion, sourceVersion }),
    changes,
    mappings: [{ venueEntityType: "project", venueObjectId: input.projectId, external }],
    sourceRecords: [{ external, synchronizedAt, descriptive: { title: event.title, location: clone(event.location), organizer: clone(event.organizer) } }],
    warnings: [],
  };
};

export const calendarEventAdapter = createVenueAdapter(calendarEventAdapterDefinition, {
  async import(input, context) {
    await context.secrets.get("calendar-events/api-token");
    return importEvent(input, calendarEventAdapterDefinition, context.clock());
  },
  async synchronize(input, context) {
    await context.secrets.get("calendar-events/api-token");
    return importEvent(input, calendarEventAdapterDefinition, context.clock());
  },
  async webhook(input) {
    const event = normalizeEvent(input.event);
    return { sourceSystem: input.sourceSystem, eventId: input.id, eventType: input.type, occurredAt: input.occurredAt, sourceVersion: event.sourceVersion, payload: event };
  },
});
