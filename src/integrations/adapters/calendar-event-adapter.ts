import {
  AdapterContractError,
  createSyncCursor,
  defineAdapter,
  sha256Checksum,
  type AdapterDefinition,
} from "../contracts.ts";
import { createVenueAdapter } from "../runtime.ts";
import { isNonContactLabel } from "../privacy.ts";
import { normalizeEventSchedule, type EventSchedule } from "../../domain/event-schedule.ts";
import type { EventRequirement } from "../../domain/event-brief.ts";

export const CALENDAR_WEBHOOK_EVENT_TYPES: readonly [
  "event.created",
  "event.updated",
  "event.cancelled",
  "event.deleted",
] = Object.freeze(["event.created", "event.updated", "event.cancelled", "event.deleted"]);
type CalendarWebhookEventType = (typeof CALENDAR_WEBHOOK_EVENT_TYPES)[number];

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
  retryPolicy: {
    maxAttempts: 4,
    initialDelayMs: 100,
    maximumDelayMs: 800,
    multiplier: 2,
    retryableCodes: ["ADAPTER_NETWORK_ERROR", "ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"],
  },
  rateLimit: { requests: 60, windowMs: 60_000 },
});

interface CalendarEvent {
  readonly externalId: string;
  readonly sourceVersion: string;
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly timezone: string;
  readonly location: Readonly<{ label: string }>;
  readonly attendanceTarget: number;
  readonly organizer: Readonly<{ displayName: string; organization: string; role: string }>;
}
interface CalendarImportInput {
  readonly sourceSystem: string;
  readonly projectId: string;
  readonly briefId: string;
  readonly event: CalendarEvent;
  readonly currentPlanningState: Readonly<{ attendeeTarget: number; schedule: EventSchedule | null }>;
  readonly requirementIds: Readonly<{ attendance: string; schedule: string }>;
  readonly attendanceConstraintIds: readonly string[];
  readonly sourceVersion?: string;
  readonly nextCursor?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const clone = <Value>(value: Value): Value => structuredClone(value);
const fail = (message: string, details: Readonly<Record<string, unknown>> = {}): never => {
  throw new AdapterContractError("ADAPTER_SOURCE_INVALID", message, details);
};
function assertExact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) return fail(`${label} must be an object`);
  const unknownFields = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknownFields.length)
    throw new AdapterContractError("ADAPTER_CONTRACT_UNKNOWN_FIELD", `${label} contains unknown fields`, {
      fields: unknownFields.sort(),
    });
}
const requiredString = (value: unknown, label: string): string =>
  typeof value === "string" && value ? value : fail(`${label} is required`);
const optionalString = (value: unknown, label: string): string | undefined =>
  value === undefined ? undefined : requiredString(value, label);

const normalizeSchedule = (event: unknown, nullable = false): EventSchedule | null => {
  try {
    return normalizeEventSchedule(event, { label: "Calendar event schedule", nullable });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Calendar event schedule is invalid");
  }
};

const normalizeEvent = (event: unknown): CalendarEvent => {
  assertExact(
    event,
    [
      "externalId",
      "sourceVersion",
      "title",
      "startAt",
      "endAt",
      "timezone",
      "location",
      "attendanceTarget",
      "organizer",
    ],
    "Calendar event",
  );
  const externalId = requiredString(event["externalId"], "Calendar event externalId");
  const sourceVersion = requiredString(event["sourceVersion"], "Calendar event sourceVersion");
  const title = requiredString(event["title"], "Calendar event title");
  const attendanceTarget = event["attendanceTarget"];
  if (typeof attendanceTarget !== "number" || !Number.isInteger(attendanceTarget) || attendanceTarget < 0)
    return fail("Calendar event attendanceTarget must be a non-negative integer");
  assertExact(event["location"], ["label"], "Calendar event location");
  assertExact(event["organizer"], ["displayName", "organization", "role"], "Calendar event organizer");
  const location = event["location"];
  const organizer = event["organizer"];
  const label = requiredString(location["label"], "Calendar event location label");
  const displayName = organizer["displayName"];
  const organization = organizer["organization"];
  const role = organizer["role"];
  if (!isNonContactLabel(displayName) || !isNonContactLabel(organization) || !isNonContactLabel(role))
    return fail("Calendar organizer metadata must contain exact non-contact labels");
  const schedule = normalizeSchedule({ startAt: event["startAt"], endAt: event["endAt"], timezone: event["timezone"] });
  if (!schedule) return fail("Calendar event schedule is required");
  return Object.freeze({
    externalId,
    sourceVersion,
    title,
    ...schedule,
    location: { label },
    attendanceTarget,
    organizer: { displayName, organization, role },
  });
};

const normalizeImportInput = (value: unknown): CalendarImportInput => {
  assertExact(
    value,
    [
      "sourceSystem",
      "projectId",
      "briefId",
      "event",
      "currentPlanningState",
      "requirementIds",
      "attendanceConstraintIds",
      "sourceVersion",
      "nextCursor",
      "basePlanVersion",
      "proposalRevision",
    ],
    "Calendar import",
  );
  assertExact(value["currentPlanningState"], ["attendeeTarget", "schedule"], "Current planning state");
  assertExact(value["requirementIds"], ["attendance", "schedule"], "Requirement IDs");
  const currentPlanningState = value["currentPlanningState"];
  const requirementIds = value["requirementIds"];
  const attendeeTarget = currentPlanningState["attendeeTarget"];
  if (typeof attendeeTarget !== "number" || !Number.isInteger(attendeeTarget) || attendeeTarget < 0)
    return fail("Current attendee target is invalid");
  const rawConstraintIds = value["attendanceConstraintIds"] ?? [];
  if (!Array.isArray(rawConstraintIds) || !rawConstraintIds.every((id) => typeof id === "string" && id.length > 0))
    return fail("Attendance Constraint IDs are invalid");
  const sourceVersion = optionalString(value["sourceVersion"], "sourceVersion");
  const nextCursor = optionalString(value["nextCursor"], "nextCursor");
  return {
    sourceSystem: requiredString(value["sourceSystem"], "sourceSystem"),
    projectId: requiredString(value["projectId"], "projectId"),
    briefId: requiredString(value["briefId"], "briefId"),
    event: normalizeEvent(value["event"]),
    currentPlanningState: { attendeeTarget, schedule: normalizeSchedule(currentPlanningState["schedule"], true) },
    requirementIds: {
      attendance: requiredString(requirementIds["attendance"], "Stable attendance Requirement ID"),
      schedule: requiredString(requirementIds["schedule"], "Stable schedule Requirement ID"),
    },
    attendanceConstraintIds: [...new Set(rawConstraintIds)].sort(),
    ...(sourceVersion ? { sourceVersion } : {}),
    ...(nextCursor ? { nextCursor } : {}),
  };
};

const requirement = ({
  id,
  category,
  label,
  constraintIds,
  evidenceRef,
}: Readonly<{
  id: string;
  category: string;
  label: string;
  constraintIds: readonly string[];
  evidenceRef: string;
}>): EventRequirement => ({
  id,
  category,
  label,
  priority: "high",
  owner: null,
  status: "confirmed",
  measurable: constraintIds.length > 0,
  constraintIds: [...constraintIds],
  evidenceRefs: [evidenceRef],
});

const importEvent = async (inputValue: unknown, definition: AdapterDefinition, synchronizedAt: string) => {
  const input = normalizeImportInput(inputValue);
  const event = input.event;
  const checksum = await sha256Checksum(event);
  const external = {
    adapterId: definition.id,
    sourceSystem: input.sourceSystem,
    entityType: "calendar-event",
    externalId: event.externalId,
    sourceVersion: event.sourceVersion,
    checksum,
  };
  if (
    input.projectId === event.externalId ||
    input.requirementIds.attendance === event.externalId ||
    input.requirementIds.schedule === event.externalId
  )
    throw new AdapterContractError(
      "ADAPTER_ID_BOUNDARY_VIOLATION",
      "Calendar external ID must remain separate from VenueMind stable IDs",
      { externalId: event.externalId },
    );
  const source = { ...external, synchronizedAt };
  const evidenceRef = `adapter:${definition.id}:${checksum}`;
  const changes: Array<Readonly<Record<string, unknown>>> = [];
  if (input.currentPlanningState.attendeeTarget !== event.attendanceTarget) {
    if (input.attendanceConstraintIds.length === 0) return fail("Attendance updates require affected Constraint IDs");
    const attendanceRequirement = requirement({
      id: input.requirementIds.attendance,
      category: "seating",
      label: `Attendance target ${event.attendanceTarget}`,
      constraintIds: input.attendanceConstraintIds,
      evidenceRef,
    });
    changes.push({
      id: `change-calendar-attendance-${(await sha256Checksum({ externalId: event.externalId, sourceVersion: event.sourceVersion, attendanceTarget: event.attendanceTarget })).slice(0, 12)}`,
      operation: "update",
      venueEntityType: "event-brief-requirement",
      venueObjectId: input.requirementIds.attendance,
      external,
      planningEffects: [
        {
          operation: "set_attendance_target",
          targetBriefId: input.briefId,
          targetRequirementId: input.requirementIds.attendance,
          before: input.currentPlanningState.attendeeTarget,
          after: event.attendanceTarget,
          requirement: attendanceRequirement,
          affectedConstraintIds: input.attendanceConstraintIds,
          evidenceFamilies: ["capacity", "flow"],
          source,
        },
      ],
    });
  }
  const eventSchedule: EventSchedule = { startAt: event.startAt, endAt: event.endAt, timezone: event.timezone };
  if (JSON.stringify(input.currentPlanningState.schedule) !== JSON.stringify(eventSchedule)) {
    const scheduleRequirement = requirement({
      id: input.requirementIds.schedule,
      category: "staffing",
      label: `Event schedule ${event.startAt}`,
      constraintIds: [],
      evidenceRef,
    });
    changes.push({
      id: `change-calendar-schedule-${(await sha256Checksum({ externalId: event.externalId, sourceVersion: event.sourceVersion, schedule: eventSchedule })).slice(0, 12)}`,
      operation: "update",
      venueEntityType: "event-brief-requirement",
      venueObjectId: input.requirementIds.schedule,
      external,
      planningEffects: [
        {
          operation: "set_event_schedule",
          targetBriefId: input.briefId,
          targetRequirementId: input.requirementIds.schedule,
          before: input.currentPlanningState.schedule,
          after: eventSchedule,
          requirement: scheduleRequirement,
          affectedConstraintIds: [],
          evidenceFamilies: ["operations"],
          source,
        },
      ],
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
    sourceRecords: [
      {
        external,
        synchronizedAt,
        descriptive: { title: event.title, location: clone(event.location), organizer: clone(event.organizer) },
      },
    ],
    warnings: [],
  };
};

const isWebhookType = (value: unknown): value is CalendarWebhookEventType =>
  value === "event.created" || value === "event.updated" || value === "event.cancelled" || value === "event.deleted";

export const calendarEventAdapter = createVenueAdapter(calendarEventAdapterDefinition, {
  import(input, context) {
    return context.secrets
      .get("calendar-events/api-token")
      .then(() => importEvent(input, calendarEventAdapterDefinition, context.clock()));
  },
  synchronize(input, context) {
    return context.secrets
      .get("calendar-events/api-token")
      .then(() => importEvent(input, calendarEventAdapterDefinition, context.clock()));
  },
  webhook(input) {
    assertExact(input, ["sourceSystem", "id", "type", "occurredAt", "event"], "Calendar webhook");
    const type = input["type"];
    if (!isWebhookType(type))
      return fail("Calendar webhook type is not supported", {
        eventType: type ?? null,
        supportedEventTypes: CALENDAR_WEBHOOK_EVENT_TYPES,
      });
    const event = normalizeEvent(input["event"]);
    return {
      sourceSystem: requiredString(input["sourceSystem"], "Calendar webhook sourceSystem"),
      eventId: requiredString(input["id"], "Calendar webhook ID"),
      eventType: type,
      occurredAt: requiredString(input["occurredAt"], "Calendar webhook occurredAt"),
      sourceVersion: event.sourceVersion,
      payload: event,
    };
  },
});
