import {
  AdapterContractError,
  assertIsoTimestamp,
  createSyncCursor,
  defineAdapter,
  sha256Checksum,
  type AdapterCapability,
  type AdapterDefinition,
  type SyncCursor,
} from "../contracts.ts";
import { isNonContactLabel } from "../privacy.ts";
import type { AdapterHandlerContext, VenueAdapter } from "../runtime.ts";

const MAX_TICKET_CLASSES = 500;
const MAX_ZONES = 500;
const MAX_ACCESSIBILITY_REQUIREMENTS = 100;
const MAX_COUNT = 1_000_000;
const MAX_TRAVERSAL_DEPTH = 32;
const MAX_TRAVERSAL_NODES = 10_000;
const MAX_UNTRUSTED_STRING_LENGTH = 10_000;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const FORBIDDEN_PERSONAL_KEYS = new Set([
  "attendee",
  "attendees",
  "attendeeid",
  "person",
  "people",
  "personid",
  "userid",
  "customerid",
  "name",
  "firstname",
  "lastname",
  "fullname",
  "email",
  "emailaddress",
  "phone",
  "phonenumber",
  "address",
  "postaladdress",
  "barcode",
  "qrcode",
  "ticketcode",
  "orderid",
  "payment",
  "paymentid",
  "card",
  "medical",
  "medicalcondition",
  "diagnosis",
  "disability",
  "note",
  "notes",
  "accessibilitynote",
]);

interface OccupancyZone {
  readonly zoneId: string;
  readonly minimumCapacity: number;
  readonly maximumCapacity: number;
}
interface ProjectOccupancy {
  readonly attendeeTarget: number;
  readonly zones: readonly OccupancyZone[];
}
interface AccessibilityRequirement {
  readonly code: string;
  readonly count: number;
  readonly zoneIds: readonly string[];
}
interface ZoneAllocation {
  readonly zoneId: string;
  readonly ticketedCount: number;
  readonly attendanceForecast: number;
}
interface TicketClass {
  readonly externalId: string;
  readonly ticketedCount: number;
  readonly attendanceForecast: number;
  readonly zoneAllocations: readonly ZoneAllocation[];
  readonly accessRequirementCodes: readonly string[];
}
interface CheckInCount {
  readonly ticketClassId: string;
  readonly count: number;
}
interface CheckIn {
  readonly asOf: string;
  readonly counts: readonly CheckInCount[];
}
interface PreparedRegistrationInput {
  readonly sourceSystem: string;
  readonly sourceVersion: string;
  readonly projectId: string;
  readonly planVersion: string;
  readonly nextCursor: string;
  readonly eventDayMode: boolean;
  readonly projectOccupancy: ProjectOccupancy;
  readonly ticketClasses: readonly TicketClass[];
  readonly accessibilityRequirements: readonly AccessibilityRequirement[];
  readonly checkIn: CheckIn | null;
}
interface PreparedRegistrationWebhookInput extends PreparedRegistrationInput {
  readonly id: string;
  readonly type: "aggregate-check-in.updated";
  readonly occurredAt: string;
  readonly eventDayMode: true;
  readonly checkIn: CheckIn;
}
interface SnapshotTicketClass {
  readonly ticketClassId: string;
  readonly ticketedCount: number;
  readonly attendanceForecast: number;
  readonly zoneAllocations: readonly ZoneAllocation[];
  readonly accessRequirementCodes: readonly string[];
}
interface ReconciliationZone extends OccupancyZone {
  readonly ticketedCount: number;
  readonly attendanceForecast: number;
  readonly ticketClassIds: readonly string[];
  readonly status: "under-target" | "over-capacity" | "within-limit";
}
interface ReconciliationAccessibility {
  readonly code: string;
  readonly requiredCount: number;
  readonly zoneIds: readonly string[];
  readonly ticketClassIds: readonly string[];
  readonly mappedTicketedCount: number;
  readonly status: "covered" | "under-mapped";
}
interface ReconciliationIssue {
  readonly code: string;
  readonly actual: number;
  readonly target: number;
  readonly zoneId?: string;
  readonly requirementCode?: string;
}
interface RegistrationReconciliation {
  readonly status: "pass" | "attention-required";
  readonly projectAttendeeTarget: number;
  readonly ticketClassTotal: number;
  readonly attendanceForecastTotal: number;
  readonly ticketDelta: number;
  readonly zones: readonly ReconciliationZone[];
  readonly accessibility: readonly ReconciliationAccessibility[];
  readonly issues: readonly ReconciliationIssue[];
}
interface SnapshotCheckIn {
  readonly asOf: string;
  readonly total: number;
  readonly byTicketClass: readonly Readonly<{ ticketClassId: string; count: number }>[];
}
interface RegistrationSnapshot {
  readonly id: string;
  readonly status: "reconciled" | "attention-required";
  readonly schemaVersion: 1;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceSystem: string;
  readonly sourceVersion: string;
  readonly synchronizedAt: string;
  readonly projectId: string;
  readonly planVersion: string;
  readonly eventDayMode: boolean;
  readonly syncCursor: SyncCursor;
  readonly ticketClasses: readonly SnapshotTicketClass[];
  readonly accessibilityRequirements: readonly AccessibilityRequirement[];
  readonly checkIn: SnapshotCheckIn | null;
  readonly reconciliation: RegistrationReconciliation;
  readonly privacy: Readonly<{
    mode: "aggregate-only";
    attendeeIdentityStored: false;
    individualCheckInStored: false;
    freeFormAccessibilityStored: false;
  }>;
  readonly checksum: string;
}
interface RegistrationWebhook {
  readonly schemaVersion: 1;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceSystem: string;
  readonly eventId: string;
  readonly eventType: "aggregate-check-in.updated";
  readonly occurredAt: string;
  readonly sourceVersion: string;
  readonly payload: RegistrationSnapshot;
  readonly checksum: string;
}
interface TraversalState {
  nodes: number;
}
interface ValidationContext {
  readonly capability?: AdapterCapability;
  readonly preparedInput?: unknown;
}

const clone = <Value>(value: Value): Value => structuredClone(value);
const compareCodePoints = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isSyncCursor = (value: unknown): value is SyncCursor =>
  isRecord(value) &&
  typeof value["adapterId"] === "string" &&
  typeof value["adapterVersion"] === "string" &&
  typeof value["opaque"] === "string" &&
  typeof value["sourceVersion"] === "string" &&
  typeof value["checksum"] === "string";
const isZoneAllocation = (value: unknown): value is ZoneAllocation =>
  isRecord(value) &&
  typeof value["zoneId"] === "string" &&
  typeof value["ticketedCount"] === "number" &&
  typeof value["attendanceForecast"] === "number";
const isAccessibilityRequirement = (value: unknown): value is AccessibilityRequirement =>
  isRecord(value) &&
  typeof value["code"] === "string" &&
  typeof value["count"] === "number" &&
  Array.isArray(value["zoneIds"]) &&
  value["zoneIds"].every((item) => typeof item === "string");
const isSnapshotTicketClass = (value: unknown): value is SnapshotTicketClass =>
  isRecord(value) &&
  typeof value["ticketClassId"] === "string" &&
  typeof value["ticketedCount"] === "number" &&
  typeof value["attendanceForecast"] === "number" &&
  Array.isArray(value["zoneAllocations"]) &&
  value["zoneAllocations"].every(isZoneAllocation) &&
  Array.isArray(value["accessRequirementCodes"]) &&
  value["accessRequirementCodes"].every((item) => typeof item === "string");
const isReconciliationZone = (value: unknown): value is ReconciliationZone =>
  isRecord(value) &&
  typeof value["zoneId"] === "string" &&
  typeof value["minimumCapacity"] === "number" &&
  typeof value["maximumCapacity"] === "number" &&
  typeof value["ticketedCount"] === "number" &&
  typeof value["attendanceForecast"] === "number" &&
  Array.isArray(value["ticketClassIds"]) &&
  value["ticketClassIds"].every((item) => typeof item === "string") &&
  (value["status"] === "under-target" || value["status"] === "over-capacity" || value["status"] === "within-limit");
const isRegistrationReconciliation = (value: unknown): value is RegistrationReconciliation =>
  isRecord(value) &&
  (value["status"] === "pass" || value["status"] === "attention-required") &&
  typeof value["projectAttendeeTarget"] === "number" &&
  typeof value["ticketClassTotal"] === "number" &&
  typeof value["attendanceForecastTotal"] === "number" &&
  typeof value["ticketDelta"] === "number" &&
  Array.isArray(value["zones"]) &&
  value["zones"].every(isReconciliationZone) &&
  Array.isArray(value["accessibility"]) &&
  Array.isArray(value["issues"]);
const isSnapshotCheckIn = (value: unknown): value is SnapshotCheckIn =>
  isRecord(value) &&
  typeof value["asOf"] === "string" &&
  typeof value["total"] === "number" &&
  Array.isArray(value["byTicketClass"]) &&
  value["byTicketClass"].every(
    (item) => isRecord(item) && typeof item["ticketClassId"] === "string" && typeof item["count"] === "number",
  );
const isRegistrationSnapshot = (value: unknown): value is RegistrationSnapshot =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  (value["status"] === "reconciled" || value["status"] === "attention-required") &&
  value["schemaVersion"] === 1 &&
  typeof value["adapterId"] === "string" &&
  typeof value["adapterVersion"] === "string" &&
  typeof value["sourceSystem"] === "string" &&
  typeof value["sourceVersion"] === "string" &&
  typeof value["synchronizedAt"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["planVersion"] === "string" &&
  typeof value["eventDayMode"] === "boolean" &&
  isSyncCursor(value["syncCursor"]) &&
  Array.isArray(value["ticketClasses"]) &&
  value["ticketClasses"].every(isSnapshotTicketClass) &&
  Array.isArray(value["accessibilityRequirements"]) &&
  value["accessibilityRequirements"].every(isAccessibilityRequirement) &&
  (value["checkIn"] === null || isSnapshotCheckIn(value["checkIn"])) &&
  isRegistrationReconciliation(value["reconciliation"]) &&
  isRecord(value["privacy"]) &&
  value["privacy"]["mode"] === "aggregate-only" &&
  value["privacy"]["attendeeIdentityStored"] === false &&
  value["privacy"]["individualCheckInStored"] === false &&
  value["privacy"]["freeFormAccessibilityStored"] === false &&
  typeof value["checksum"] === "string";
const isRegistrationWebhook = (value: unknown): value is RegistrationWebhook =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["adapterId"] === "string" &&
  typeof value["adapterVersion"] === "string" &&
  typeof value["sourceSystem"] === "string" &&
  typeof value["eventId"] === "string" &&
  value["eventType"] === "aggregate-check-in.updated" &&
  typeof value["occurredAt"] === "string" &&
  typeof value["sourceVersion"] === "string" &&
  isRegistrationSnapshot(value["payload"]) &&
  typeof value["checksum"] === "string";

const fail = (code: string, message: string, details: Readonly<Record<string, unknown>> = {}): never => {
  throw new AdapterContractError(code, message, details);
};

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("ADAPTER_SOURCE_INVALID", `${label} must be an object`);
}

const assertExactKeys = (value: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): void => {
  const unknown = Object.keys(value)
    .filter((key) => !allowed.includes(key))
    .sort();
  if (unknown.length)
    fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", `${label} contains unknown fields`, { fieldCount: unknown.length });
};

const assertIdentifier = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !IDENTIFIER.test(value))
    return fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded identifier`);
  return value;
};

const assertBoundedString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 160)
    return fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded string`);
  return value;
};

const assertCount = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_COUNT)
    return fail("ADAPTER_SOURCE_INVALID", `${label} must be an aggregate integer from 0 to ${MAX_COUNT}`);
  return value;
};

const normalizedPersonalKey = (key: string): string => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const assertTraversalBudget = (value: unknown, path: readonly string[], state: TraversalState): void => {
  state.nodes += 1;
  if (
    state.nodes > MAX_TRAVERSAL_NODES ||
    path.length > MAX_TRAVERSAL_DEPTH ||
    (typeof value === "string" && value.length > MAX_UNTRUSTED_STRING_LENGTH)
  )
    fail("ADAPTER_SOURCE_INVALID", "Registration aggregate exceeds safe traversal limits");
};

const assertNoPersonalData = (
  value: unknown,
  path: readonly string[] = [],
  state: TraversalState = { nodes: 0 },
): void => {
  assertTraversalBudget(value, path, state);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPersonalData(item, [...path, String(index)], state));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && !isNonContactLabel(value))
      fail("ADAPTER_PERSONAL_DATA_REJECTED", "Registration input contains person-level contact data", {
        depth: path.length,
      });
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (!isNonContactLabel(key))
      fail("ADAPTER_PERSONAL_DATA_REJECTED", "Registration input contains person-level contact data in a field name", {
        depth: path.length + 1,
      });
    if (FORBIDDEN_PERSONAL_KEYS.has(normalizedPersonalKey(key)))
      fail("ADAPTER_PERSONAL_DATA_REJECTED", "Registration input contains a forbidden person-level field", {
        fieldCategory: "person-level",
      });
    assertNoPersonalData(item, [...path, key], state);
  }
};

const normalizeProjectOccupancy = (input: unknown): ProjectOccupancy => {
  assertPlainObject(input, "Project occupancy");
  assertExactKeys(input, ["attendeeTarget", "zones"], "Project occupancy");
  const attendeeTarget = assertCount(input.attendeeTarget, "Project attendeeTarget");
  if (!Array.isArray(input.zones) || input.zones.length === 0 || input.zones.length > MAX_ZONES)
    return fail("ADAPTER_SOURCE_INVALID", `Project occupancy zones must contain 1 to ${MAX_ZONES} records`);
  const zones = input.zones
    .map((zone) => {
      assertPlainObject(zone, "Project occupancy zone");
      assertExactKeys(zone, ["zoneId", "minimumCapacity", "maximumCapacity"], "Project occupancy zone");
      const normalized = {
        zoneId: assertIdentifier(zone.zoneId, "Project occupancy zoneId"),
        minimumCapacity: assertCount(zone.minimumCapacity, "Project occupancy minimumCapacity"),
        maximumCapacity: assertCount(zone.maximumCapacity, "Project occupancy maximumCapacity"),
      };
      if (normalized.maximumCapacity < normalized.minimumCapacity)
        fail("ADAPTER_SOURCE_INVALID", "Project occupancy maximumCapacity must be at least minimumCapacity", {
          zoneId: normalized.zoneId,
        });
      return normalized;
    })
    .sort((left, right) => compareCodePoints(left.zoneId, right.zoneId));
  if (new Set(zones.map((zone) => zone.zoneId)).size !== zones.length)
    fail("ADAPTER_SOURCE_INVALID", "Project occupancy zone IDs must be unique");
  return { attendeeTarget, zones };
};

const normalizeAccessibilityRequirements = (
  input: unknown,
  zoneIds: ReadonlySet<string>,
): readonly AccessibilityRequirement[] => {
  if (!Array.isArray(input) || input.length > MAX_ACCESSIBILITY_REQUIREMENTS)
    return fail(
      "ADAPTER_SOURCE_INVALID",
      `Accessibility requirements must contain at most ${MAX_ACCESSIBILITY_REQUIREMENTS} aggregate records`,
    );
  const requirements = input
    .map((requirement) => {
      assertPlainObject(requirement, "Aggregate accessibility requirement");
      assertExactKeys(requirement, ["code", "count", "zoneIds"], "Aggregate accessibility requirement");
      if (
        !Array.isArray(requirement.zoneIds) ||
        requirement.zoneIds.length === 0 ||
        requirement.zoneIds.length > MAX_ZONES
      )
        return fail(
          "ADAPTER_SOURCE_INVALID",
          "Aggregate accessibility requirement zoneIds must be a bounded non-empty array",
        );
      const normalizedZoneIds = [
        ...new Set(
          requirement.zoneIds.map((zoneId) => assertIdentifier(zoneId, "Aggregate accessibility requirement zoneId")),
        ),
      ].sort();
      const foreignZoneIds = normalizedZoneIds.filter((zoneId) => !zoneIds.has(zoneId));
      if (foreignZoneIds.length)
        fail("ADAPTER_ZONE_MAPPING_INVALID", "Aggregate accessibility requirement references unknown Project zones", {
          zoneIds: foreignZoneIds,
        });
      return {
        code: assertIdentifier(requirement.code, "Aggregate accessibility requirement code"),
        count: assertCount(requirement.count, "Aggregate accessibility requirement count"),
        zoneIds: normalizedZoneIds,
      };
    })
    .sort((left, right) => compareCodePoints(left.code, right.code));
  if (new Set(requirements.map((requirement) => requirement.code)).size !== requirements.length)
    fail("ADAPTER_SOURCE_INVALID", "Aggregate accessibility requirement codes must be unique");
  return requirements;
};

const normalizeTicketClasses = (
  input: unknown,
  zoneIds: ReadonlySet<string>,
  accessCodes: ReadonlySet<string>,
): readonly TicketClass[] => {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_TICKET_CLASSES)
    return fail("ADAPTER_SOURCE_INVALID", `Ticket classes must contain 1 to ${MAX_TICKET_CLASSES} aggregate records`);
  const ticketClasses = input
    .map((ticketClass) => {
      assertPlainObject(ticketClass, "Ticket class");
      assertExactKeys(
        ticketClass,
        ["externalId", "ticketedCount", "attendanceForecast", "zoneAllocations", "accessRequirementCodes"],
        "Ticket class",
      );
      if (
        !Array.isArray(ticketClass.zoneAllocations) ||
        ticketClass.zoneAllocations.length === 0 ||
        ticketClass.zoneAllocations.length > MAX_ZONES
      )
        return fail("ADAPTER_SOURCE_INVALID", "Ticket class zoneAllocations must be a bounded non-empty array");
      const zoneAllocations = ticketClass.zoneAllocations
        .map((allocation) => {
          assertPlainObject(allocation, "Ticket class zone allocation");
          assertExactKeys(
            allocation,
            ["zoneId", "ticketedCount", "attendanceForecast"],
            "Ticket class zone allocation",
          );
          const zoneId = assertIdentifier(allocation.zoneId, "Ticket class zoneId");
          if (!zoneIds.has(zoneId))
            fail("ADAPTER_ZONE_MAPPING_INVALID", "Ticket class references an unknown Project zone", { zoneId });
          const normalized = {
            zoneId,
            ticketedCount: assertCount(allocation.ticketedCount, "Ticket class zone ticketedCount"),
            attendanceForecast: assertCount(allocation.attendanceForecast, "Ticket class zone attendanceForecast"),
          };
          if (normalized.attendanceForecast > normalized.ticketedCount)
            fail("ADAPTER_SOURCE_INVALID", "Ticket class zone attendanceForecast cannot exceed ticketedCount", {
              zoneId,
            });
          return normalized;
        })
        .sort((left, right) => compareCodePoints(left.zoneId, right.zoneId));
      if (new Set(zoneAllocations.map((allocation) => allocation.zoneId)).size !== zoneAllocations.length)
        fail("ADAPTER_SOURCE_INVALID", "Ticket class zone allocations must be unique");
      const ticketedCount = assertCount(ticketClass.ticketedCount, "Ticket class ticketedCount");
      const attendanceForecast = assertCount(ticketClass.attendanceForecast, "Ticket class attendanceForecast");
      if (
        zoneAllocations.reduce((sum, allocation) => sum + allocation.ticketedCount, 0) !== ticketedCount ||
        zoneAllocations.reduce((sum, allocation) => sum + allocation.attendanceForecast, 0) !== attendanceForecast
      )
        fail("ADAPTER_TICKET_TOTAL_MISMATCH", "Ticket class totals must equal their zone allocations", {
          externalId: ticketClass.externalId,
        });
      if (attendanceForecast > ticketedCount)
        fail("ADAPTER_SOURCE_INVALID", "Ticket class attendanceForecast cannot exceed ticketedCount", {
          externalId: ticketClass.externalId,
        });
      if (
        !Array.isArray(ticketClass.accessRequirementCodes) ||
        ticketClass.accessRequirementCodes.length > MAX_ACCESSIBILITY_REQUIREMENTS
      )
        return fail("ADAPTER_SOURCE_INVALID", "Ticket class accessRequirementCodes must be a bounded array");
      const accessRequirementCodes = [
        ...new Set(
          ticketClass.accessRequirementCodes.map((code) =>
            assertIdentifier(code, "Ticket class access requirement code"),
          ),
        ),
      ].sort();
      const foreignCodes = accessRequirementCodes.filter((code) => !accessCodes.has(code));
      if (foreignCodes.length)
        fail("ADAPTER_ACCESS_MAPPING_INVALID", "Ticket class references unknown aggregate accessibility requirements", {
          codes: foreignCodes,
        });
      return {
        externalId: assertIdentifier(ticketClass.externalId, "Ticket class externalId"),
        ticketedCount,
        attendanceForecast,
        zoneAllocations,
        accessRequirementCodes,
      };
    })
    .sort((left, right) => compareCodePoints(left.externalId, right.externalId));
  if (new Set(ticketClasses.map((ticketClass) => ticketClass.externalId)).size !== ticketClasses.length)
    fail("ADAPTER_SOURCE_INVALID", "Ticket class external IDs must be unique");
  return ticketClasses;
};

const normalizeCheckIn = (
  input: unknown,
  eventDayMode: boolean,
  ticketClasses: readonly TicketClass[],
): CheckIn | null => {
  if (!eventDayMode) {
    if (input !== null && input !== undefined)
      fail("ADAPTER_EVENT_DAY_REQUIRED", "Aggregate check-in counts require event-day mode");
    return null;
  }
  assertPlainObject(input, "Aggregate check-in");
  assertExactKeys(input, ["asOf", "counts"], "Aggregate check-in");
  const asOf = assertIsoTimestamp(input.asOf, "Aggregate check-in asOf");
  if (!Array.isArray(input.counts) || input.counts.length > MAX_TICKET_CLASSES)
    return fail(
      "ADAPTER_SOURCE_INVALID",
      `Aggregate check-in counts must contain at most ${MAX_TICKET_CLASSES} records`,
    );
  const classes = new Map(ticketClasses.map((ticketClass) => [ticketClass.externalId, ticketClass]));
  const counts = input.counts
    .map((count) => {
      assertPlainObject(count, "Aggregate check-in count");
      assertExactKeys(count, ["ticketClassId", "count"], "Aggregate check-in count");
      const ticketClassId = assertIdentifier(count.ticketClassId, "Aggregate check-in ticketClassId");
      const ticketClass = classes.get(ticketClassId);
      if (!ticketClass)
        return fail("ADAPTER_TICKET_CLASS_UNKNOWN", "Aggregate check-in count references an unknown ticket class", {
          ticketClassId,
        });
      const aggregateCount = assertCount(count.count, "Aggregate check-in count");
      if (aggregateCount > ticketClass.ticketedCount)
        fail("ADAPTER_CHECK_IN_INVALID", "Aggregate check-in count cannot exceed its ticket class total", {
          ticketClassId,
        });
      return { ticketClassId, count: aggregateCount };
    })
    .sort((left, right) => compareCodePoints(left.ticketClassId, right.ticketClassId));
  if (new Set(counts.map((count) => count.ticketClassId)).size !== counts.length)
    fail("ADAPTER_SOURCE_INVALID", "Aggregate check-in ticket class IDs must be unique");
  return { asOf, counts };
};

const normalizeCoreInput = (input: unknown): PreparedRegistrationInput => {
  assertPlainObject(input, "Registration aggregate input");
  const projectOccupancy = normalizeProjectOccupancy(input.projectOccupancy);
  const zoneIds = new Set(projectOccupancy.zones.map((zone) => zone.zoneId));
  const accessibilityRequirements = normalizeAccessibilityRequirements(input.accessibilityRequirements ?? [], zoneIds);
  const accessCodes = new Set(accessibilityRequirements.map((requirement) => requirement.code));
  const ticketClasses = normalizeTicketClasses(input.ticketClasses, zoneIds, accessCodes);
  if (
    ticketClasses.reduce((sum, ticketClass) => sum + ticketClass.ticketedCount, 0) > MAX_COUNT ||
    ticketClasses.reduce((sum, ticketClass) => sum + ticketClass.attendanceForecast, 0) > MAX_COUNT
  )
    fail("ADAPTER_SOURCE_INVALID", `Registration aggregate totals cannot exceed ${MAX_COUNT}`);
  const eventDayMode = input.eventDayMode === true;
  if (input.eventDayMode !== true && input.eventDayMode !== false)
    fail("ADAPTER_SOURCE_INVALID", "eventDayMode must be boolean");
  const checkIn = normalizeCheckIn(input.checkIn, eventDayMode, ticketClasses);
  if (checkIn && checkIn.counts.reduce((sum, count) => sum + count.count, 0) > MAX_COUNT)
    fail("ADAPTER_SOURCE_INVALID", `Aggregate check-in total cannot exceed ${MAX_COUNT}`);
  return {
    sourceSystem: assertIdentifier(input.sourceSystem, "Registration sourceSystem"),
    sourceVersion: assertBoundedString(input.sourceVersion, "Registration sourceVersion"),
    projectId: assertIdentifier(input.projectId, "Registration projectId"),
    planVersion: assertBoundedString(input.planVersion, "Registration planVersion"),
    nextCursor:
      input.nextCursor === undefined
        ? assertBoundedString(input.sourceVersion, "Registration sourceVersion")
        : assertBoundedString(input.nextCursor, "Registration nextCursor"),
    eventDayMode,
    projectOccupancy,
    ticketClasses,
    accessibilityRequirements,
    checkIn,
  };
};

const SOURCE_IMPORT_KEYS = [
  "sourceSystem",
  "sourceVersion",
  "nextCursor",
  "eventDayMode",
  "ticketClasses",
  "accessibilityRequirements",
  "checkIn",
];
const TRUSTED_PROJECT_KEYS = ["projectId", "planVersion", "projectOccupancy"];
const PREPARED_IMPORT_KEYS = [...SOURCE_IMPORT_KEYS, ...TRUSTED_PROJECT_KEYS];
const SOURCE_WEBHOOK_KEYS = ["id", "type", "occurredAt", ...SOURCE_IMPORT_KEYS];
const PREPARED_WEBHOOK_KEYS = ["id", "type", "occurredAt", ...PREPARED_IMPORT_KEYS];

function normalizePreparedRegistrationInput(capability: "webhook", input: unknown): PreparedRegistrationWebhookInput;
function normalizePreparedRegistrationInput(
  capability: "import" | "synchronize",
  input: unknown,
): PreparedRegistrationInput;
function normalizePreparedRegistrationInput(
  capability: AdapterCapability,
  input: unknown,
): PreparedRegistrationInput | PreparedRegistrationWebhookInput;
function normalizePreparedRegistrationInput(
  capability: AdapterCapability,
  input: unknown,
): PreparedRegistrationInput | PreparedRegistrationWebhookInput {
  assertNoPersonalData(input);
  assertPlainObject(input, "Registration adapter input");
  if (capability === "import" || capability === "synchronize") {
    assertExactKeys(input, PREPARED_IMPORT_KEYS, "Prepared registration adapter input");
    return Object.freeze(normalizeCoreInput(input));
  }
  if (capability === "webhook") {
    assertExactKeys(input, PREPARED_WEBHOOK_KEYS, "Prepared registration webhook input");
    if (input.type !== "aggregate-check-in.updated")
      fail("ADAPTER_SOURCE_INVALID", "Registration webhook type must be aggregate-check-in.updated");
    const occurredAt = assertIsoTimestamp(input.occurredAt, "Registration webhook occurredAt");
    const normalized = {
      id: assertIdentifier(input.id, "Registration webhook id"),
      type: input.type,
      occurredAt,
      ...normalizeCoreInput(input),
    };
    if (!normalized.eventDayMode || !normalized.checkIn)
      fail(
        "ADAPTER_EVENT_DAY_REQUIRED",
        "Aggregate check-in webhook requires event-day mode and aggregate check-in counts",
      );
    return Object.freeze({ ...normalized, eventDayMode: true, checkIn: normalized.checkIn });
  }
  return fail("ADAPTER_CAPABILITY_UNSUPPORTED", `Registration adapter does not support ${capability}`);
}

export function normalizeRegistrationAdapterInput(
  capability: AdapterCapability,
  input: unknown,
  trustedProjectContext: unknown,
): PreparedRegistrationInput | PreparedRegistrationWebhookInput {
  assertNoPersonalData(input);
  assertNoPersonalData(trustedProjectContext);
  assertPlainObject(input, "Registration source input");
  assertPlainObject(trustedProjectContext, "Trusted Project context");
  assertExactKeys(trustedProjectContext, TRUSTED_PROJECT_KEYS, "Trusted Project context");
  const sourceKeys = capability === "webhook" ? SOURCE_WEBHOOK_KEYS : SOURCE_IMPORT_KEYS;
  if (capability !== "import" && capability !== "synchronize" && capability !== "webhook")
    fail("ADAPTER_CAPABILITY_UNSUPPORTED", `Registration adapter does not support ${capability}`);
  assertExactKeys(input, sourceKeys, "Registration source input");
  return normalizePreparedRegistrationInput(capability, { ...input, ...trustedProjectContext });
}

const namespacedTicketClassId = (sourceSystem: string, externalId: string): string => `${sourceSystem}:${externalId}`;

export function reconcileRegistrationOccupancy(
  input: Pick<
    PreparedRegistrationInput,
    "sourceSystem" | "projectOccupancy" | "ticketClasses" | "accessibilityRequirements"
  >,
): Readonly<RegistrationReconciliation> {
  const sourceSystem = input.sourceSystem;
  const ticketClasses = input.ticketClasses.map((ticketClass) => ({
    ticketClassId: namespacedTicketClassId(sourceSystem, ticketClass.externalId),
    ticketedCount: ticketClass.ticketedCount,
    attendanceForecast: ticketClass.attendanceForecast,
    zoneAllocations: clone(ticketClass.zoneAllocations),
    accessRequirementCodes: clone(ticketClass.accessRequirementCodes),
  }));
  const ticketClassTotal = ticketClasses.reduce((sum, ticketClass) => sum + ticketClass.ticketedCount, 0);
  const attendanceForecastTotal = ticketClasses.reduce((sum, ticketClass) => sum + ticketClass.attendanceForecast, 0);
  const zones: ReconciliationZone[] = input.projectOccupancy.zones.map((zone): ReconciliationZone => {
    const allocations = ticketClasses.flatMap((ticketClass) =>
      ticketClass.zoneAllocations
        .filter((allocation) => allocation.zoneId === zone.zoneId)
        .map((allocation) => ({ ticketClassId: ticketClass.ticketClassId, ...allocation })),
    );
    const ticketedCount = allocations.reduce((sum, allocation) => sum + allocation.ticketedCount, 0);
    const attendanceForecast = allocations.reduce((sum, allocation) => sum + allocation.attendanceForecast, 0);
    const status =
      ticketedCount < zone.minimumCapacity
        ? "under-target"
        : ticketedCount > zone.maximumCapacity
          ? "over-capacity"
          : "within-limit";
    return {
      zoneId: zone.zoneId,
      minimumCapacity: zone.minimumCapacity,
      maximumCapacity: zone.maximumCapacity,
      ticketedCount,
      attendanceForecast,
      ticketClassIds: allocations.map((allocation) => allocation.ticketClassId).sort(),
      status,
    };
  });
  const accessibility: ReconciliationAccessibility[] = input.accessibilityRequirements.map(
    (requirement): ReconciliationAccessibility => {
      const mapped = ticketClasses.filter(
        (ticketClass) =>
          ticketClass.accessRequirementCodes.includes(requirement.code) &&
          ticketClass.zoneAllocations.some((allocation) => requirement.zoneIds.includes(allocation.zoneId)),
      );
      const mappedTicketedCount = mapped.reduce(
        (sum, ticketClass) =>
          sum +
          ticketClass.zoneAllocations
            .filter((allocation) => requirement.zoneIds.includes(allocation.zoneId))
            .reduce((allocationSum, allocation) => allocationSum + allocation.ticketedCount, 0),
        0,
      );
      return {
        code: requirement.code,
        requiredCount: requirement.count,
        zoneIds: clone(requirement.zoneIds),
        ticketClassIds: mapped.map((ticketClass) => ticketClass.ticketClassId).sort(),
        mappedTicketedCount,
        status: mappedTicketedCount >= requirement.count ? "covered" : "under-mapped",
      };
    },
  );
  const issues: ReconciliationIssue[] = [
    ...(ticketClassTotal === input.projectOccupancy.attendeeTarget
      ? []
      : [{ code: "TICKET_TOTAL_MISMATCH", actual: ticketClassTotal, target: input.projectOccupancy.attendeeTarget }]),
    ...zones
      .filter((zone) => zone.status !== "within-limit")
      .map((zone) => ({
        code: zone.status === "under-target" ? "ZONE_UNDER_TARGET" : "ZONE_OVER_CAPACITY",
        zoneId: zone.zoneId,
        actual: zone.ticketedCount,
        target: zone.status === "under-target" ? zone.minimumCapacity : zone.maximumCapacity,
      })),
    ...accessibility
      .filter((requirement) => requirement.status !== "covered")
      .map((requirement) => ({
        code: "ACCESS_REQUIREMENT_UNDER_MAPPED",
        requirementCode: requirement.code,
        actual: requirement.mappedTicketedCount,
        target: requirement.requiredCount,
      })),
  ];
  issues.sort(
    (left, right) =>
      compareCodePoints(left.code, right.code) ||
      compareCodePoints(left.zoneId ?? left.requirementCode ?? "", right.zoneId ?? right.requirementCode ?? ""),
  );
  return Object.freeze({
    status: issues.length === 0 ? "pass" : "attention-required",
    projectAttendeeTarget: input.projectOccupancy.attendeeTarget,
    ticketClassTotal,
    attendanceForecastTotal,
    ticketDelta: ticketClassTotal - input.projectOccupancy.attendeeTarget,
    zones,
    accessibility,
    issues,
  });
}

const registrationSnapshot = async (
  definition: AdapterDefinition,
  input: PreparedRegistrationInput,
  synchronizedAtValue: unknown,
): Promise<Readonly<RegistrationSnapshot>> => {
  const synchronizedAt = assertIsoTimestamp(synchronizedAtValue, "Registration synchronizedAt");
  if (input.checkIn && Date.parse(input.checkIn.asOf) > Date.parse(synchronizedAt))
    fail("ADAPTER_CHECK_IN_INVALID", "Aggregate check-in asOf cannot be later than synchronization time");
  const reconciliation = reconcileRegistrationOccupancy(input);
  const ticketClasses = input.ticketClasses.map((ticketClass) => ({
    ticketClassId: namespacedTicketClassId(input.sourceSystem, ticketClass.externalId),
    ticketedCount: ticketClass.ticketedCount,
    attendanceForecast: ticketClass.attendanceForecast,
    zoneAllocations: clone(ticketClass.zoneAllocations),
    accessRequirementCodes: clone(ticketClass.accessRequirementCodes),
  }));
  const accessibilityRequirements = clone(input.accessibilityRequirements);
  const checkIn = input.checkIn
    ? {
        asOf: input.checkIn.asOf,
        total: input.checkIn.counts.reduce((sum, count) => sum + count.count, 0),
        byTicketClass: input.checkIn.counts.map((count) => ({
          ticketClassId: namespacedTicketClassId(input.sourceSystem, count.ticketClassId),
          count: count.count,
        })),
      }
    : null;
  const syncCursor = await createSyncCursor(definition, {
    opaque: input.nextCursor,
    sourceVersion: input.sourceVersion,
  });
  const content: Omit<RegistrationSnapshot, "id" | "status" | "checksum"> = {
    schemaVersion: 1,
    adapterId: definition.id,
    adapterVersion: definition.version,
    sourceSystem: input.sourceSystem,
    sourceVersion: input.sourceVersion,
    synchronizedAt,
    projectId: input.projectId,
    planVersion: input.planVersion,
    eventDayMode: input.eventDayMode,
    syncCursor,
    ticketClasses,
    accessibilityRequirements,
    checkIn,
    reconciliation,
    privacy: {
      mode: "aggregate-only",
      attendeeIdentityStored: false,
      individualCheckInStored: false,
      freeFormAccessibilityStored: false,
    },
  };
  const checksum = await sha256Checksum(content);
  return Object.freeze({
    id: `registration-snapshot-${checksum.slice(0, 16)}`,
    status: reconciliation.status === "pass" ? "reconciled" : "attention-required",
    ...content,
    checksum,
  });
};

const assertNoPlanningEffects = (
  value: unknown,
  path: readonly string[] = [],
  state: TraversalState = { nodes: 0 },
): void => {
  assertTraversalBudget(value, path, state);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPlanningEffects(item, [...path, String(index)], state));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["acceptedPlan", "changes", "planningEffects", "proposal", "spatialEffects"].includes(key))
      fail(
        "ADAPTER_REVIEW_BYPASS",
        "Aggregate registration evidence cannot contain executable or accepted-state effects",
        { field: key, path: [...path, key].join(".") },
      );
    assertNoPlanningEffects(item, [...path, key], state);
  }
};

export async function assertRegistrationSnapshot(
  snapshotValue: unknown,
  context: ValidationContext = {},
): Promise<true> {
  if (!isRegistrationSnapshot(snapshotValue))
    return fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot shape is invalid");
  const snapshot = snapshotValue;
  assertNoPersonalData(snapshot);
  assertNoPlanningEffects(snapshot);
  assertPlainObject(snapshot, "Registration snapshot");
  assertExactKeys(
    snapshot,
    [
      "id",
      "status",
      "schemaVersion",
      "adapterId",
      "adapterVersion",
      "sourceSystem",
      "sourceVersion",
      "synchronizedAt",
      "projectId",
      "planVersion",
      "eventDayMode",
      "syncCursor",
      "ticketClasses",
      "accessibilityRequirements",
      "checkIn",
      "reconciliation",
      "privacy",
      "checksum",
    ],
    "Registration snapshot",
  );
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.adapterId !== registrationTicketingAdapterDefinition.id ||
    snapshot.adapterVersion !== registrationTicketingAdapterDefinition.version
  )
    fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot adapter identity is invalid");
  assertIsoTimestamp(snapshot.synchronizedAt, "Registration snapshot synchronizedAt");
  if (!/^[0-9a-f]{64}$/.test(snapshot.checksum ?? ""))
    fail("ADAPTER_CHECKSUM_INVALID", "Registration snapshot checksum is invalid");
  const { id, status: _status, checksum, ...content } = snapshot;
  const actual = await sha256Checksum(content);
  if (actual !== checksum || id !== `registration-snapshot-${checksum.slice(0, 16)}`)
    fail("ADAPTER_CHECKSUM_MISMATCH", "Registration snapshot checksum does not match normalized aggregate content");

  assertIdentifier(snapshot.sourceSystem, "Registration snapshot sourceSystem");
  assertBoundedString(snapshot.sourceVersion, "Registration snapshot sourceVersion");
  assertIdentifier(snapshot.projectId, "Registration snapshot projectId");
  assertBoundedString(snapshot.planVersion, "Registration snapshot planVersion");
  assertPlainObject(snapshot.syncCursor, "Registration snapshot syncCursor");
  assertExactKeys(
    snapshot.syncCursor,
    ["adapterId", "adapterVersion", "opaque", "sourceVersion", "checksum"],
    "Registration snapshot syncCursor",
  );
  if (
    snapshot.syncCursor.adapterId !== snapshot.adapterId ||
    snapshot.syncCursor.adapterVersion !== snapshot.adapterVersion ||
    snapshot.syncCursor.sourceVersion !== snapshot.sourceVersion
  )
    fail("ADAPTER_CURSOR_INCOMPATIBLE", "Registration snapshot cursor identity is invalid");
  assertBoundedString(snapshot.syncCursor.opaque, "Registration snapshot syncCursor opaque");
  const { checksum: cursorChecksum, ...cursorContent } = snapshot.syncCursor;
  if (!/^[0-9a-f]{64}$/.test(cursorChecksum ?? "") || (await sha256Checksum(cursorContent)) !== cursorChecksum)
    fail("ADAPTER_CHECKSUM_MISMATCH", "Registration snapshot cursor checksum is invalid");

  if (!Array.isArray(snapshot.ticketClasses))
    fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot ticketClasses must be an array");
  const ticketPrefix = `${snapshot.sourceSystem}:`;
  const rawTicketClasses = snapshot.ticketClasses.map((ticketClass) => {
    assertPlainObject(ticketClass, "Registration snapshot Ticket Class");
    assertExactKeys(
      ticketClass,
      ["ticketClassId", "ticketedCount", "attendanceForecast", "zoneAllocations", "accessRequirementCodes"],
      "Registration snapshot Ticket Class",
    );
    if (typeof ticketClass.ticketClassId !== "string" || !ticketClass.ticketClassId.startsWith(ticketPrefix))
      fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot Ticket Class identity is invalid");
    return {
      externalId: ticketClass.ticketClassId.slice(ticketPrefix.length),
      ticketedCount: ticketClass.ticketedCount,
      attendanceForecast: ticketClass.attendanceForecast,
      zoneAllocations: ticketClass.zoneAllocations,
      accessRequirementCodes: ticketClass.accessRequirementCodes,
    };
  });

  assertPlainObject(snapshot.reconciliation, "Registration snapshot reconciliation");
  assertExactKeys(
    snapshot.reconciliation,
    [
      "status",
      "projectAttendeeTarget",
      "ticketClassTotal",
      "attendanceForecastTotal",
      "ticketDelta",
      "zones",
      "accessibility",
      "issues",
    ],
    "Registration snapshot reconciliation",
  );
  if (
    !Array.isArray(snapshot.reconciliation.zones) ||
    !Array.isArray(snapshot.reconciliation.accessibility) ||
    !Array.isArray(snapshot.reconciliation.issues)
  )
    fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot reconciliation collections are invalid");
  const rawProjectOccupancy = {
    attendeeTarget: snapshot.reconciliation.projectAttendeeTarget,
    zones: snapshot.reconciliation.zones.map((zone) => {
      assertPlainObject(zone, "Registration snapshot reconciliation zone");
      assertExactKeys(
        zone,
        [
          "zoneId",
          "minimumCapacity",
          "maximumCapacity",
          "ticketedCount",
          "attendanceForecast",
          "ticketClassIds",
          "status",
        ],
        "Registration snapshot reconciliation zone",
      );
      return { zoneId: zone.zoneId, minimumCapacity: zone.minimumCapacity, maximumCapacity: zone.maximumCapacity };
    }),
  };
  const projectOccupancy = normalizeProjectOccupancy(rawProjectOccupancy);
  const zoneIds = new Set(projectOccupancy.zones.map((zone) => zone.zoneId));
  const accessibilityRequirements = normalizeAccessibilityRequirements(snapshot.accessibilityRequirements, zoneIds);
  if (JSON.stringify(accessibilityRequirements) !== JSON.stringify(snapshot.accessibilityRequirements))
    fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot accessibility requirements are not canonical");
  const ticketClasses = normalizeTicketClasses(
    rawTicketClasses,
    zoneIds,
    new Set(accessibilityRequirements.map((requirement) => requirement.code)),
  );
  if (
    ticketClasses.reduce((sum, ticketClass) => sum + ticketClass.ticketedCount, 0) > MAX_COUNT ||
    ticketClasses.reduce((sum, ticketClass) => sum + ticketClass.attendanceForecast, 0) > MAX_COUNT
  )
    fail("ADAPTER_CONTRACT_INVALID", `Registration snapshot aggregate totals cannot exceed ${MAX_COUNT}`);
  const canonicalTicketClasses = ticketClasses.map((ticketClass) => ({
    ticketClassId: namespacedTicketClassId(snapshot.sourceSystem, ticketClass.externalId),
    ticketedCount: ticketClass.ticketedCount,
    attendanceForecast: ticketClass.attendanceForecast,
    zoneAllocations: ticketClass.zoneAllocations,
    accessRequirementCodes: ticketClass.accessRequirementCodes,
  }));
  if (JSON.stringify(canonicalTicketClasses) !== JSON.stringify(snapshot.ticketClasses))
    fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot Ticket Classes are not canonical");
  const expectedReconciliation = reconcileRegistrationOccupancy({
    sourceSystem: snapshot.sourceSystem,
    projectOccupancy,
    accessibilityRequirements,
    ticketClasses,
  });
  if (JSON.stringify(expectedReconciliation) !== JSON.stringify(snapshot.reconciliation))
    fail(
      "ADAPTER_RECONCILIATION_INVALID",
      "Registration snapshot reconciliation does not match its aggregate evidence",
    );

  if (snapshot.eventDayMode) {
    assertPlainObject(snapshot.checkIn, "Registration snapshot checkIn");
    assertExactKeys(snapshot.checkIn, ["asOf", "total", "byTicketClass"], "Registration snapshot checkIn");
    if (!Array.isArray(snapshot.checkIn.byTicketClass))
      fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot checkIn byTicketClass must be an array");
    const rawCheckIn = {
      asOf: snapshot.checkIn.asOf,
      counts: snapshot.checkIn.byTicketClass.map((count) => {
        assertPlainObject(count, "Registration snapshot checkIn count");
        assertExactKeys(count, ["ticketClassId", "count"], "Registration snapshot checkIn count");
        if (typeof count.ticketClassId !== "string" || !count.ticketClassId.startsWith(ticketPrefix))
          fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot checkIn Ticket Class identity is invalid");
        return { ticketClassId: count.ticketClassId.slice(ticketPrefix.length), count: count.count };
      }),
    };
    const checkIn = normalizeCheckIn(rawCheckIn, true, ticketClasses);
    if (!checkIn)
      return fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot checkIn is required in event-day mode");
    if (checkIn.counts.reduce((sum, count) => sum + count.count, 0) > MAX_COUNT)
      fail("ADAPTER_CONTRACT_INVALID", `Registration snapshot aggregate checkIn cannot exceed ${MAX_COUNT}`);
    const canonicalCheckIn = {
      asOf: checkIn.asOf,
      total: checkIn.counts.reduce((sum, count) => sum + count.count, 0),
      byTicketClass: checkIn.counts.map((count) => ({
        ticketClassId: namespacedTicketClassId(snapshot.sourceSystem, count.ticketClassId),
        count: count.count,
      })),
    };
    if (JSON.stringify(canonicalCheckIn) !== JSON.stringify(snapshot.checkIn))
      fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot checkIn aggregates are not canonical");
    if (Date.parse(snapshot.checkIn.asOf) > Date.parse(snapshot.synchronizedAt))
      fail("ADAPTER_CHECK_IN_INVALID", "Registration snapshot checkIn cannot be later than synchronization time");
  } else if (snapshot.checkIn !== null) {
    fail("ADAPTER_EVENT_DAY_REQUIRED", "Registration snapshot checkIn requires event-day mode");
  }

  assertPlainObject(snapshot.privacy, "Registration snapshot privacy");
  assertExactKeys(
    snapshot.privacy,
    ["mode", "attendeeIdentityStored", "individualCheckInStored", "freeFormAccessibilityStored"],
    "Registration snapshot privacy",
  );
  if (
    snapshot.privacy.mode !== "aggregate-only" ||
    snapshot.privacy.attendeeIdentityStored ||
    snapshot.privacy.individualCheckInStored ||
    snapshot.privacy.freeFormAccessibilityStored
  )
    fail("ADAPTER_PERSONAL_DATA_REJECTED", "Registration snapshot privacy evidence is invalid");
  const expectedStatus = snapshot.reconciliation.status === "pass" ? "reconciled" : "attention-required";
  if (snapshot.status !== expectedStatus)
    fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot status does not match reconciliation");
  if (context.preparedInput !== undefined) {
    const capability =
      context.capability === "synchronize" ? "synchronize" : context.capability === "webhook" ? "webhook" : "import";
    const preparedInput = normalizePreparedRegistrationInput(capability, context.preparedInput);
    const expected = await registrationSnapshot(
      registrationTicketingAdapterDefinition,
      preparedInput,
      snapshot.synchronizedAt,
    );
    if (expected.checksum !== snapshot.checksum)
      fail(
        "ADAPTER_SOURCE_MISMATCH",
        "Registration snapshot is not bound to the prepared source and trusted Project context",
      );
  }
  return true;
}

export async function assertRegistrationWebhook(eventValue: unknown, context: ValidationContext = {}): Promise<true> {
  if (!isRegistrationWebhook(eventValue))
    return fail("ADAPTER_CONTRACT_INVALID", "Registration webhook shape is invalid");
  const event = eventValue;
  assertNoPersonalData(event);
  assertNoPlanningEffects(event);
  assertPlainObject(event, "Registration webhook result");
  assertExactKeys(
    event,
    [
      "schemaVersion",
      "adapterId",
      "adapterVersion",
      "sourceSystem",
      "eventId",
      "eventType",
      "occurredAt",
      "sourceVersion",
      "payload",
      "checksum",
    ],
    "Registration webhook result",
  );
  if (
    event.schemaVersion !== 1 ||
    event.adapterId !== registrationTicketingAdapterDefinition.id ||
    event.adapterVersion !== registrationTicketingAdapterDefinition.version ||
    event.eventType !== "aggregate-check-in.updated"
  )
    fail("ADAPTER_CONTRACT_INVALID", "Registration webhook identity is invalid");
  assertIdentifier(event.eventId, "Registration webhook eventId");
  assertIsoTimestamp(event.occurredAt, "Registration webhook occurredAt");
  await assertRegistrationSnapshot(event.payload, context);
  if (!event.payload.eventDayMode || !event.payload.checkIn)
    fail("ADAPTER_EVENT_DAY_REQUIRED", "Aggregate check-in webhook requires event-day aggregate evidence");
  if (
    event.sourceSystem !== event.payload.sourceSystem ||
    event.sourceVersion !== event.payload.sourceVersion ||
    event.occurredAt !== event.payload.synchronizedAt
  )
    fail("ADAPTER_SOURCE_MISMATCH", "Registration webhook envelope does not match its aggregate payload");
  if (context.preparedInput !== undefined) {
    const preparedInput = normalizePreparedRegistrationInput("webhook", context.preparedInput);
    if (
      event.eventId !== preparedInput.id ||
      event.eventType !== preparedInput.type ||
      event.occurredAt !== preparedInput.occurredAt ||
      event.sourceSystem !== preparedInput.sourceSystem ||
      event.sourceVersion !== preparedInput.sourceVersion
    )
      fail("ADAPTER_SOURCE_MISMATCH", "Registration webhook envelope is not bound to its prepared source event");
  }
  const { checksum, ...content } = event;
  if (!/^[0-9a-f]{64}$/.test(checksum ?? "") || (await sha256Checksum(content)) !== checksum)
    fail("ADAPTER_CHECKSUM_MISMATCH", "Registration webhook checksum does not match normalized aggregate content");
  return true;
}

export const registrationTicketingAdapterDefinition = defineAdapter({
  contractVersion: 1,
  id: "registration-ticketing",
  displayName: "Registration Ticketing",
  version: "1.0.0",
  capabilities: ["import", "synchronize", "webhook"],
  importResultMode: "aggregate-snapshot",
  scopes: {
    import: ["registration:aggregate:read"],
    synchronize: ["registration:aggregate:read"],
    webhook: ["registration:aggregate:webhook"],
  },
  retryPolicy: {
    maxAttempts: 4,
    initialDelayMs: 100,
    maximumDelayMs: 800,
    multiplier: 2,
    retryableCodes: ["ADAPTER_NETWORK_ERROR", "ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"],
  },
  rateLimit: { requests: 30, windowMs: 60_000 },
});

export const registrationTicketingAdapter: VenueAdapter = Object.freeze({
  definition: registrationTicketingAdapterDefinition,
  assertImportResult: assertRegistrationSnapshot,
  assertWebhookResult: assertRegistrationWebhook,
  prepareInput(capability: AdapterCapability, input: unknown, context: Readonly<{ adapterContext: unknown }>) {
    return normalizeRegistrationAdapterInput(capability, input, context?.adapterContext);
  },
  async invoke(capability: AdapterCapability, input: unknown, context: AdapterHandlerContext) {
    await context.secrets.get("registration-ticketing/api-token");
    if (capability === "import" || capability === "synchronize") {
      const normalized = normalizePreparedRegistrationInput(capability, input);
      return registrationSnapshot(registrationTicketingAdapterDefinition, normalized, context.clock());
    }
    if (capability === "webhook") {
      const normalized = normalizePreparedRegistrationInput("webhook", input);
      const payload = await registrationSnapshot(
        registrationTicketingAdapterDefinition,
        normalized,
        normalized.occurredAt,
      );
      const content = {
        schemaVersion: 1,
        adapterId: registrationTicketingAdapterDefinition.id,
        adapterVersion: registrationTicketingAdapterDefinition.version,
        sourceSystem: normalized.sourceSystem,
        eventId: normalized.id,
        eventType: normalized.type,
        occurredAt: normalized.occurredAt,
        sourceVersion: normalized.sourceVersion,
        payload,
      };
      return Object.freeze({ ...content, checksum: await sha256Checksum(content) });
    }
    return fail("ADAPTER_CAPABILITY_UNSUPPORTED", `Registration adapter does not support ${capability}`);
  },
});
