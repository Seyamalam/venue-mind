import { AdapterContractError, assertIsoTimestamp, sha256Checksum } from "../integrations/contracts.ts";
import { isNonContactLabel } from "../integrations/privacy.ts";

const MAX_RESOURCES = 1_000;
const MAX_BOOKINGS = 1_000;
const MAX_DEMANDS = 1_000;
const MAX_COUNT = 1_000_000;
const MAX_EXACT_ALLOCATION_CONFLICTS = 28;
const MAX_EXACT_ALLOCATION_RESOURCES = 18;
const MAX_ALLOCATION_SEARCH_NODES = 250_000;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const RESOURCE_ID = /^resource-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAFF_REF = /^staff-ref-[0-9a-f]{32}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PLAN_FINGERPRINT = /^plan-[0-9a-f]{8}$/;
type ResourceFamily = "inventory" | "av" | "power" | "catering" | "staffing";
type AvailabilityStatus = "available" | "unavailable";
interface TemplateRef {
  templateId: string;
  version: string;
}
interface Booking {
  bookingRef: string;
  startAt: string;
  endAt: string;
  quantity: number;
  reservationRef: string;
}
interface StaffingCapabilityAssignment {
  roleId: string;
  shiftId: string;
  status?: AvailabilityStatus;
  bookings?: Booking[];
}
type ResourceCapability =
  | { templateRef: TemplateRef }
  | { templateRef: TemplateRef; equipmentType: string; powerWatts: number; voltage: number; connector: string }
  | { utilityObjectId: string; circuitId: string; voltage: number; maxWatts: number; connectors: string[] }
  | {
      templateRef: TemplateRef;
      type: string;
      servers: number;
      serviceRatePerServerMinute: number;
      queueCapacityPersons: number;
      accessibleServicePoint: boolean;
    }
  | { assignments: StaffingCapabilityAssignment[] };
type DemandRequirements =
  | ResourceCapability
  | { voltage: number; requiredWatts: number; connector: string }
  | { roleId: string; shiftId: string };
interface ResourceSource {
  entityType: string;
  externalId?: string;
  sourceVersion: string;
  checksum: string;
}
interface OperationalResource {
  resourceId: string;
  family: ResourceFamily;
  status: AvailabilityStatus;
  total: number;
  unavailable: number;
  bookings: Booking[];
  capability: ResourceCapability;
  source: ResourceSource;
}
interface OperationalDemand {
  demandId: string;
  family: ResourceFamily;
  resourceId: string;
  quantity: number;
  targetObjectIds: string[];
  requirements: DemandRequirements;
  baseObjectChecksum: string;
}
interface EventWindow {
  startAt: string;
  endAt: string;
}
interface ProjectContext {
  projectId: string;
  planVersion: string;
  planFingerprint: string;
  eventWindow: EventWindow;
  currentReservationRef: string;
}
interface StaffingRole {
  roleId: string;
  availableHeadcount: number;
  skills: string[];
  sourceChecksum: string;
}
interface StaffingShift {
  shiftId: string;
  startAt: string;
  endAt: string;
  sourceChecksum: string;
}
interface StaffingAssignment {
  assignmentId: string;
  staffRef: string;
  roleId: string;
  shiftId: string;
  resourceId: string;
  sourceChecksum: string;
}
interface PreparedOperationalInput {
  sourceSystem: string;
  sourceVersion: string;
  nextCursor: string;
  project: ProjectContext;
  resources: OperationalResource[];
  staffing: { roles: StaffingRole[]; shifts: StaffingShift[]; assignments: StaffingAssignment[] };
  demands: OperationalDemand[];
}
interface Availability {
  status: AvailabilityStatus;
  healthy: number;
  booked: number;
  available: number;
  bookingRefs: string[];
}
interface ResourceConflict {
  id: string;
  reason: string;
  family: ResourceFamily;
  demandId: string;
  resourceId: string;
  requiredQuantity: number;
  availableQuantity: number;
  targetObjectIds: string[];
  bookingRefs: string[];
  substitutionOptionIds: string[];
  severity: "error";
}
interface SubstitutionOption {
  id: string;
  conflictId: string;
  demandId: string;
  replacementResourceId: string;
  targetObjectIds: string[];
  quantity: number;
  replacementSourceChecksum: string;
  family: ResourceFamily;
  requiresHumanApproval: true;
}
type RawRecord = Record<string, unknown>;
const clone = <T>(value: T): T => structuredClone(value);
const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const isFamily = (value: unknown): value is ResourceFamily =>
  value === "inventory" || value === "av" || value === "power" || value === "catering" || value === "staffing";
const isStatus = (value: unknown): value is AvailabilityStatus => value === "available" || value === "unavailable";

const fail: (code: string, message: string, details?: Record<string, string | number | boolean | null>) => never = (
  code,
  message,
  details = {},
) => {
  throw new AdapterContractError(code, message, details);
};

const assertObject: (value: unknown, label: string) => asserts value is RawRecord = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("ADAPTER_SOURCE_INVALID", `${label} must be an object`);
};

const assertExact: (value: unknown, keys: readonly string[], label: string) => asserts value is RawRecord = (
  value,
  keys,
  label,
) => {
  assertObject(value, label);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length)
    fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", `${label} contains unknown fields`, { fieldCount: unknown.length });
};

const identifier = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || !isNonContactLabel(value))
    fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded non-contact identifier`);
  return value;
};

const boundedString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0 || value.length > 200 || !isNonContactLabel(value))
    fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded non-contact string`);
  return value;
};

const checksum = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !SHA256.test(value)) fail("ADAPTER_CHECKSUM_INVALID", `${label} is invalid`);
  return value;
};

const planFingerprint = (value: unknown): string => {
  if (typeof value !== "string" || !PLAN_FINGERPRINT.test(value))
    fail("ADAPTER_CHECKSUM_INVALID", "Operational Project planFingerprint is invalid");
  return value;
};

const count = (value: unknown, label: string, { positive = false }: { positive?: boolean } = {}): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < (positive ? 1 : 0) || value > MAX_COUNT)
    fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded ${positive ? "positive " : ""}integer`);
  return value;
};

const finite = (value: unknown, label: string, { positive = false }: { positive?: boolean } = {}): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < (positive ? Number.EPSILON : 0))
    fail("ADAPTER_SOURCE_INVALID", `${label} must be a non-negative finite number`);
  return Number(value);
};

const exactTemplateRef = (value: unknown, label = "Template binding"): TemplateRef => {
  assertExact(value, ["templateId", "version"], label);
  return {
    templateId: identifier(value.templateId, `${label} templateId`),
    version: boundedString(value.version, `${label} version`),
  };
};

const normalizeBooking = (value: unknown, label: string): Booking => {
  assertExact(value, ["bookingRef", "startAt", "endAt", "quantity", "reservationRef"], label);
  const startAt = assertIsoTimestamp(value.startAt, `${label} startAt`);
  const endAt = assertIsoTimestamp(value.endAt, `${label} endAt`);
  if (Date.parse(endAt) <= Date.parse(startAt))
    fail("ADAPTER_SOURCE_INVALID", `${label} requires an increasing time window`);
  return {
    bookingRef: identifier(value.bookingRef, `${label} bookingRef`),
    startAt,
    endAt,
    quantity: count(value.quantity, `${label} quantity`, { positive: true }),
    reservationRef: identifier(value.reservationRef, `${label} reservationRef`),
  };
};

const normalizeSource = (value: unknown, family: ResourceFamily): ResourceSource => {
  const allowed =
    family === "staffing"
      ? ["entityType", "sourceVersion", "checksum"]
      : ["entityType", "externalId", "sourceVersion", "checksum"];
  assertExact(value, allowed, "Operational resource source evidence");
  const sourceChecksum = checksum(value.checksum, "Operational resource source checksum");
  return {
    entityType: identifier(value.entityType, "Operational resource entityType"),
    ...(family === "staffing" ? {} : { externalId: identifier(value.externalId, "Operational resource externalId") }),
    sourceVersion: boundedString(value.sourceVersion, "Operational resource sourceVersion"),
    checksum: sourceChecksum,
  };
};

const normalizeCapability = (family: ResourceFamily, value: unknown): ResourceCapability => {
  if (family === "inventory") {
    assertExact(value, ["templateRef"], "Inventory capability");
    return { templateRef: exactTemplateRef(value.templateRef, "Inventory template binding") };
  }
  if (family === "av") {
    assertExact(value, ["templateRef", "equipmentType", "powerWatts", "voltage", "connector"], "AV capability");
    return {
      templateRef: exactTemplateRef(value.templateRef, "AV template binding"),
      equipmentType: identifier(value.equipmentType, "AV equipmentType"),
      powerWatts: finite(value.powerWatts, "AV powerWatts"),
      voltage: finite(value.voltage, "AV voltage", { positive: true }),
      connector: boundedString(value.connector, "AV connector"),
    };
  }
  if (family === "power") {
    assertExact(value, ["utilityObjectId", "circuitId", "voltage", "maxWatts", "connectors"], "Power capability");
    if (!Array.isArray(value.connectors) || value.connectors.length === 0 || value.connectors.length > 20)
      fail("ADAPTER_SOURCE_INVALID", "Power connectors must be a bounded non-empty array");
    return {
      utilityObjectId: identifier(value.utilityObjectId, "Power utilityObjectId"),
      circuitId: identifier(value.circuitId, "Power circuitId"),
      voltage: finite(value.voltage, "Power voltage", { positive: true }),
      maxWatts: finite(value.maxWatts, "Power maxWatts", { positive: true }),
      connectors: [...new Set(value.connectors.map((item) => boundedString(item, "Power connector")))].sort(compare),
    };
  }
  if (family === "catering") {
    assertExact(
      value,
      [
        "templateRef",
        "type",
        "servers",
        "serviceRatePerServerMinute",
        "queueCapacityPersons",
        "accessibleServicePoint",
      ],
      "Catering capability",
    );
    if (typeof value.accessibleServicePoint !== "boolean")
      fail("ADAPTER_SOURCE_INVALID", "Catering accessibleServicePoint must be boolean");
    return {
      templateRef: exactTemplateRef(value.templateRef, "Catering template binding"),
      type: identifier(value.type, "Catering type"),
      servers: count(value.servers, "Catering servers", { positive: true }),
      serviceRatePerServerMinute: finite(value.serviceRatePerServerMinute, "Catering service rate", { positive: true }),
      queueCapacityPersons: count(value.queueCapacityPersons, "Catering queue capacity"),
      accessibleServicePoint: value.accessibleServicePoint,
    };
  }
  assertExact(value, ["assignments"], "Staffing capability");
  if (!Array.isArray(value.assignments) || value.assignments.length === 0 || value.assignments.length > MAX_RESOURCES)
    fail("ADAPTER_SOURCE_INVALID", "Staffing capability requires bounded role and shift assignments");
  const assignments: StaffingCapabilityAssignment[] = value.assignments
    .map((item: unknown) => {
      assertExact(item, ["roleId", "shiftId", "status", "bookings"], "Staffing capability assignment");
      const normalized: StaffingCapabilityAssignment = {
        roleId: identifier(item.roleId, "Staffing roleId"),
        shiftId: identifier(item.shiftId, "Staffing shiftId"),
      };
      if (item.status !== undefined) {
        if (!isStatus(item.status)) fail("ADAPTER_SOURCE_INVALID", "Staffing capability assignment status is invalid");
        normalized.status = item.status;
      }
      if (item.bookings !== undefined) {
        if (!Array.isArray(item.bookings) || item.bookings.length > MAX_BOOKINGS)
          fail(
            "ADAPTER_SOURCE_INVALID",
            `Staffing capability assignment bookings must contain at most ${MAX_BOOKINGS} records`,
          );
        normalized.bookings = item.bookings
          .map((booking, index) => normalizeBooking(booking, `Staffing capability assignment booking ${index + 1}`))
          .sort(
            (left, right) =>
              compare(left.startAt, right.startAt) ||
              compare(left.endAt, right.endAt) ||
              compare(left.bookingRef, right.bookingRef),
          );
        if (new Set(normalized.bookings.map((booking) => booking.bookingRef)).size !== normalized.bookings.length)
          fail("ADAPTER_SOURCE_INVALID", "Staffing capability assignment booking references must be unique");
      }
      return normalized;
    })
    .sort((left, right) => compare(left.roleId, right.roleId) || compare(left.shiftId, right.shiftId));
  if (new Set(assignments.map((item) => `${item.roleId}\u0000${item.shiftId}`)).size !== assignments.length)
    fail("ADAPTER_SOURCE_INVALID", "Staffing capability assignments must be unique");
  return { assignments };
};

const normalizeResource = (value: unknown): OperationalResource => {
  assertExact(
    value,
    ["resourceId", "family", "status", "total", "unavailable", "bookings", "capability", "source"],
    "Operational resource",
  );
  if (!isFamily(value.family)) fail("ADAPTER_SOURCE_INVALID", "Operational resource family is invalid");
  if (!isStatus(value.status)) fail("ADAPTER_SOURCE_INVALID", "Operational resource status is invalid");
  const total = count(value.total, "Operational resource total", { positive: true });
  const unavailable = count(value.unavailable, "Operational resource unavailable");
  if (unavailable > total) fail("ADAPTER_SOURCE_INVALID", "Operational resource unavailable count cannot exceed total");
  if (!Array.isArray(value.bookings) || value.bookings.length > MAX_BOOKINGS)
    fail("ADAPTER_SOURCE_INVALID", `Operational resource bookings must contain at most ${MAX_BOOKINGS} records`);
  const bookings = value.bookings
    .map((item, index) => normalizeBooking(item, `Operational resource booking ${index + 1}`))
    .sort(
      (left, right) =>
        compare(left.startAt, right.startAt) ||
        compare(left.endAt, right.endAt) ||
        compare(left.bookingRef, right.bookingRef),
    );
  if (new Set(bookings.map((item) => item.bookingRef)).size !== bookings.length)
    fail("ADAPTER_SOURCE_INVALID", "Operational resource booking references must be unique per resource");
  const resourceId = identifier(value.resourceId, "Operational resource resourceId");
  if (!RESOURCE_ID.test(resourceId))
    fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Operational resourceId must use the server-owned Resource namespace");
  const source = normalizeSource(value.source, value.family);
  if (source.externalId === resourceId)
    fail(
      "ADAPTER_ID_BOUNDARY_VIOLATION",
      "Operational resource source ID must remain separate from its stable Resource ID",
    );
  return {
    resourceId,
    family: value.family,
    status: value.status,
    total,
    unavailable,
    bookings,
    capability: normalizeCapability(value.family, value.capability),
    source,
  };
};

const normalizeRequirements = (family: ResourceFamily, value: unknown): DemandRequirements => {
  if (family === "inventory") {
    assertExact(value, ["templateRef"], "Inventory demand");
    return { templateRef: exactTemplateRef(value.templateRef, "Inventory demand template") };
  }
  if (family === "av") {
    assertExact(value, ["templateRef", "equipmentType", "powerWatts", "voltage", "connector"], "AV demand");
    return {
      templateRef: exactTemplateRef(value.templateRef, "AV demand template"),
      equipmentType: identifier(value.equipmentType, "AV demand equipmentType"),
      powerWatts: finite(value.powerWatts, "AV demand powerWatts"),
      voltage: finite(value.voltage, "AV demand voltage", { positive: true }),
      connector: boundedString(value.connector, "AV demand connector"),
    };
  }
  if (family === "power") {
    assertExact(value, ["voltage", "requiredWatts", "connector"], "Power demand");
    return {
      voltage: finite(value.voltage, "Power demand voltage", { positive: true }),
      requiredWatts: finite(value.requiredWatts, "Power demand requiredWatts", { positive: true }),
      connector: boundedString(value.connector, "Power demand connector"),
    };
  }
  if (family === "catering") {
    assertExact(
      value,
      [
        "templateRef",
        "type",
        "servers",
        "serviceRatePerServerMinute",
        "queueCapacityPersons",
        "accessibleServicePoint",
      ],
      "Catering demand",
    );
    if (typeof value.accessibleServicePoint !== "boolean")
      fail("ADAPTER_SOURCE_INVALID", "Catering demand accessibleServicePoint must be boolean");
    return {
      templateRef: exactTemplateRef(value.templateRef, "Catering demand template"),
      type: identifier(value.type, "Catering demand type"),
      servers: count(value.servers, "Catering demand servers", { positive: true }),
      serviceRatePerServerMinute: finite(value.serviceRatePerServerMinute, "Catering demand service rate", {
        positive: true,
      }),
      queueCapacityPersons: count(value.queueCapacityPersons, "Catering demand queue capacity"),
      accessibleServicePoint: value.accessibleServicePoint,
    };
  }
  assertExact(value, ["roleId", "shiftId"], "Staffing demand");
  return {
    roleId: identifier(value.roleId, "Staffing demand roleId"),
    shiftId: identifier(value.shiftId, "Staffing demand shiftId"),
  };
};

const normalizeDemand = (value: unknown): OperationalDemand => {
  assertExact(
    value,
    ["demandId", "family", "resourceId", "quantity", "targetObjectIds", "requirements", "baseObjectChecksum"],
    "Operational resource demand",
  );
  if (!isFamily(value.family)) fail("ADAPTER_SOURCE_INVALID", "Operational demand family is invalid");
  if (!Array.isArray(value.targetObjectIds) || value.targetObjectIds.length > 100)
    fail("ADAPTER_SOURCE_INVALID", "Operational demand targetObjectIds must be bounded");
  const targetObjectIds = [
    ...new Set(value.targetObjectIds.map((item) => identifier(item, "Operational demand targetObjectId"))),
  ].sort(compare);
  if (value.family !== "staffing" && targetObjectIds.length === 0)
    fail("ADAPTER_SOURCE_INVALID", "Object resource demand requires a target object");
  const baseObjectChecksum = checksum(value.baseObjectChecksum, "Operational demand baseObjectChecksum");
  const resourceId = identifier(value.resourceId, "Operational demand resourceId");
  if (!RESOURCE_ID.test(resourceId))
    fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Operational demand resourceId must use the server-owned Resource namespace");
  return {
    demandId: identifier(value.demandId, "Operational demand demandId"),
    family: value.family,
    resourceId,
    quantity: count(value.quantity, "Operational demand quantity", { positive: true }),
    targetObjectIds,
    requirements: normalizeRequirements(value.family, value.requirements),
    baseObjectChecksum,
  };
};

export function normalizePreparedOperationalResourceInput(value: unknown): Readonly<PreparedOperationalInput> {
  assertExact(
    value,
    ["sourceSystem", "sourceVersion", "nextCursor", "project", "resources", "staffing", "demands"],
    "Prepared operational-resource input",
  );
  const rawProject = value.project;
  assertExact(
    rawProject,
    ["projectId", "planVersion", "planFingerprint", "eventWindow", "currentReservationRef"],
    "Operational Project context",
  );
  const rawEventWindow = rawProject.eventWindow;
  assertExact(rawEventWindow, ["startAt", "endAt"], "Operational event window");
  const eventWindow: EventWindow = {
    startAt: assertIsoTimestamp(rawEventWindow.startAt, "Operational event startAt"),
    endAt: assertIsoTimestamp(rawEventWindow.endAt, "Operational event endAt"),
  };
  if (Date.parse(eventWindow.endAt) <= Date.parse(eventWindow.startAt))
    fail("ADAPTER_SOURCE_INVALID", "Operational event window must increase");
  const project: ProjectContext = {
    projectId: identifier(rawProject.projectId, "Operational projectId"),
    planVersion: boundedString(rawProject.planVersion, "Operational planVersion"),
    planFingerprint: planFingerprint(rawProject.planFingerprint),
    eventWindow,
    currentReservationRef: identifier(rawProject.currentReservationRef, "Operational currentReservationRef"),
  };
  if (!Array.isArray(value.resources) || value.resources.length > MAX_RESOURCES)
    fail("ADAPTER_SOURCE_INVALID", `Operational resources must contain at most ${MAX_RESOURCES} records`);
  const resources = value.resources
    .map(normalizeResource)
    .sort((left, right) => compare(left.resourceId, right.resourceId));
  if (new Set(resources.map((item) => item.resourceId)).size !== resources.length)
    fail("ADAPTER_SOURCE_INVALID", "Operational resource IDs must be unique");
  if (!Array.isArray(value.demands) || value.demands.length > MAX_DEMANDS)
    fail("ADAPTER_SOURCE_INVALID", `Operational demands must contain at most ${MAX_DEMANDS} records`);
  const demands = value.demands.map(normalizeDemand).sort((left, right) => compare(left.demandId, right.demandId));
  if (new Set(demands.map((item) => item.demandId)).size !== demands.length)
    fail("ADAPTER_SOURCE_INVALID", "Operational demand IDs must be unique");
  const resourceIds = new Set(resources.map((item) => item.resourceId));
  const resourcesById = new Map(resources.map((item) => [item.resourceId, item]));
  if (
    demands.some(
      (item) => !resourceIds.has(item.resourceId) || resourcesById.get(item.resourceId)?.family !== item.family,
    )
  )
    fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational demand references an unknown or differently typed resource");
  const rawStaffing = value.staffing;
  assertExact(rawStaffing, ["roles", "shifts", "assignments"], "Operational staffing evidence");
  const rawRoles = rawStaffing.roles;
  const rawShifts = rawStaffing.shifts;
  const rawAssignments = rawStaffing.assignments;
  if (!Array.isArray(rawRoles) || rawRoles.length > MAX_RESOURCES)
    fail("ADAPTER_SOURCE_INVALID", "Operational staffing roles must be bounded");
  if (!Array.isArray(rawShifts) || rawShifts.length > MAX_RESOURCES)
    fail("ADAPTER_SOURCE_INVALID", "Operational staffing shifts must be bounded");
  if (!Array.isArray(rawAssignments) || rawAssignments.length > MAX_RESOURCES)
    fail("ADAPTER_SOURCE_INVALID", "Operational staffing assignments must be bounded");
  const roles: StaffingRole[] = rawRoles
    .map((item: unknown) => {
      assertExact(item, ["roleId", "availableHeadcount", "skills", "sourceChecksum"], "Operational staffing role");
      if (!Array.isArray(item.skills) || item.skills.length > 50)
        fail("ADAPTER_SOURCE_INVALID", "Operational staffing role skills must be bounded");
      return {
        roleId: identifier(item.roleId, "Operational staffing roleId"),
        availableHeadcount: count(item.availableHeadcount, "Operational staffing availableHeadcount"),
        skills: [...new Set(item.skills.map((skill: unknown) => identifier(skill, "Operational staffing skill")))].sort(
          compare,
        ),
        sourceChecksum: checksum(item.sourceChecksum, "Operational staffing role sourceChecksum"),
      };
    })
    .sort((left, right) => compare(left.roleId, right.roleId));
  const shifts: StaffingShift[] = rawShifts
    .map((item: unknown) => {
      assertExact(item, ["shiftId", "startAt", "endAt", "sourceChecksum"], "Operational staffing shift");
      const startAt = assertIsoTimestamp(item.startAt, "Operational staffing shift startAt");
      const endAt = assertIsoTimestamp(item.endAt, "Operational staffing shift endAt");
      if (Date.parse(endAt) <= Date.parse(startAt))
        fail("ADAPTER_SOURCE_INVALID", "Operational staffing shift is invalid");
      return {
        shiftId: identifier(item.shiftId, "Operational staffing shiftId"),
        startAt,
        endAt,
        sourceChecksum: checksum(item.sourceChecksum, "Operational staffing shift sourceChecksum"),
      };
    })
    .sort((left, right) => compare(left.shiftId, right.shiftId));
  const assignments: StaffingAssignment[] = rawAssignments
    .map((item: unknown) => {
      assertExact(
        item,
        ["assignmentId", "staffRef", "roleId", "shiftId", "resourceId", "sourceChecksum"],
        "Operational staffing assignment",
      );
      const staffRef = identifier(item.staffRef, "Operational staffing staffRef");
      const resourceId = identifier(item.resourceId, "Operational staffing assignment resourceId");
      if (!STAFF_REF.test(staffRef) || !RESOURCE_ID.test(resourceId))
        fail(
          "ADAPTER_ID_BOUNDARY_VIOLATION",
          "Staffing evidence requires server-owned opaque StaffRef and Resource namespaces",
        );
      return {
        assignmentId: identifier(item.assignmentId, "Operational staffing assignmentId"),
        staffRef,
        roleId: identifier(item.roleId, "Operational staffing assignment roleId"),
        shiftId: identifier(item.shiftId, "Operational staffing assignment shiftId"),
        resourceId,
        sourceChecksum: checksum(item.sourceChecksum, "Operational staffing assignment sourceChecksum"),
      };
    })
    .sort((left, right) => compare(left.assignmentId, right.assignmentId));
  if (
    new Set(roles.map((item) => item.roleId)).size !== roles.length ||
    new Set(shifts.map((item) => item.shiftId)).size !== shifts.length ||
    new Set(assignments.map((item) => item.assignmentId)).size !== assignments.length
  )
    fail("ADAPTER_SOURCE_INVALID", "Operational staffing stable IDs must be unique");
  const roleIds = new Set(roles.map((item) => item.roleId));
  const shiftIds = new Set(shifts.map((item) => item.shiftId));
  if (
    assignments.some((item) => {
      const resource = resourcesById.get(item.resourceId);
      return (
        !roleIds.has(item.roleId) ||
        !shiftIds.has(item.shiftId) ||
        resource?.family !== "staffing" ||
        !("assignments" in resource.capability) ||
        !resource.capability.assignments.some(
          (assignment) => assignment.roleId === item.roleId && assignment.shiftId === item.shiftId,
        )
      );
    })
  )
    fail(
      "ADAPTER_RESOURCE_MAPPING_INVALID",
      "Operational staffing assignments must reference compatible roles, shifts, and personnel resources",
    );
  return Object.freeze({
    sourceSystem: identifier(value.sourceSystem, "Operational sourceSystem"),
    sourceVersion: boundedString(value.sourceVersion, "Operational sourceVersion"),
    nextCursor: boundedString(value.nextCursor ?? value.sourceVersion, "Operational nextCursor"),
    project,
    resources,
    staffing: { roles, shifts, assignments },
    demands,
  });
}

export const bookingOverlaps = (booking: Booking, eventWindow: EventWindow): boolean =>
  Date.parse(booking.startAt) < Date.parse(eventWindow.endAt) &&
  Date.parse(eventWindow.startAt) < Date.parse(booking.endAt);

const availabilityFor = (
  resource: OperationalResource,
  project: ProjectContext,
  demand: OperationalDemand | null = null,
): Availability => {
  const staffingRequirement =
    demand?.family === "staffing" && "roleId" in demand.requirements ? demand.requirements : null;
  const staffingAssignment =
    resource.family === "staffing" && staffingRequirement && "assignments" in resource.capability
      ? resource.capability.assignments.find(
          (assignment) =>
            assignment.roleId === staffingRequirement.roleId && assignment.shiftId === staffingRequirement.shiftId,
        )
      : null;
  const bookings = staffingAssignment?.bookings ?? resource.bookings;
  const status = staffingAssignment?.status ?? resource.status;
  const otherBookings = bookings.filter(
    (booking) =>
      booking.reservationRef !== project.currentReservationRef && bookingOverlaps(booking, project.eventWindow),
  );
  const booked = otherBookings.reduce((sum, booking) => sum + booking.quantity, 0);
  const healthy = status === "unavailable" ? 0 : Math.max(0, resource.total - resource.unavailable);
  return {
    status,
    healthy,
    booked,
    available: Math.max(0, healthy - booked),
    bookingRefs: otherBookings.map((item) => item.bookingRef).sort(compare),
  };
};

const sameTemplate = (left: TemplateRef, right: TemplateRef): boolean =>
  left.templateId === right.templateId && left.version === right.version;

export const resourceSatisfiesDemand = (resource: OperationalResource, demand: OperationalDemand): boolean => {
  if (resource.family !== demand.family) return false;
  const capability = resource.capability;
  const requirement = demand.requirements;
  if (demand.family === "inventory")
    return (
      "templateRef" in capability &&
      "templateRef" in requirement &&
      sameTemplate(capability.templateRef, requirement.templateRef)
    );
  if (demand.family === "av")
    return (
      "equipmentType" in capability &&
      "equipmentType" in requirement &&
      sameTemplate(capability.templateRef, requirement.templateRef) &&
      capability.equipmentType === requirement.equipmentType &&
      capability.connector === requirement.connector &&
      capability.voltage === requirement.voltage &&
      capability.powerWatts <= requirement.powerWatts
    );
  if (demand.family === "power")
    return (
      "maxWatts" in capability &&
      "requiredWatts" in requirement &&
      capability.voltage === requirement.voltage &&
      capability.maxWatts >= requirement.requiredWatts &&
      capability.connectors.includes(requirement.connector)
    );
  if (demand.family === "catering")
    return (
      "queueCapacityPersons" in capability &&
      "queueCapacityPersons" in requirement &&
      sameTemplate(capability.templateRef, requirement.templateRef) &&
      capability.type === requirement.type &&
      (!requirement.accessibleServicePoint || capability.accessibleServicePoint) &&
      capability.queueCapacityPersons >= requirement.queueCapacityPersons &&
      capability.servers * capability.serviceRatePerServerMinute >=
        requirement.servers * requirement.serviceRatePerServerMinute
    );
  return (
    "assignments" in capability &&
    "roleId" in requirement &&
    capability.assignments.some(
      (assignment) => assignment.roleId === requirement.roleId && assignment.shiftId === requirement.shiftId,
    )
  );
};

const staffingSatisfiesProject = (
  resource: OperationalResource,
  demand: OperationalDemand,
  input: PreparedOperationalInput,
): boolean => {
  if (demand.family !== "staffing") return true;
  if (!("roleId" in demand.requirements)) return false;
  const requirement = demand.requirements;
  const matchingAssignment = input.staffing.assignments.some(
    (assignment) =>
      assignment.resourceId === resource.resourceId &&
      assignment.roleId === requirement.roleId &&
      assignment.shiftId === requirement.shiftId,
  );
  const shift = input.staffing.shifts.find((item) => item.shiftId === requirement.shiftId);
  return (
    matchingAssignment &&
    Date.parse(shift?.startAt ?? "") <= Date.parse(input.project.eventWindow.startAt) &&
    Date.parse(shift?.endAt ?? "") >= Date.parse(input.project.eventWindow.endAt)
  );
};

type ConflictReason = "unavailable" | "double-booked" | "capacity-shortfall" | "incompatible-metadata";
const conflictReason = (
  resource: OperationalResource,
  demand: OperationalDemand,
  availability: Availability,
): Exclude<ConflictReason, "incompatible-metadata"> | null => {
  if (availability.available >= demand.quantity) return null;
  if (availability.status === "unavailable" || resource.unavailable >= resource.total) return "unavailable";
  if (availability.booked > 0 && availability.healthy >= demand.quantity) return "double-booked";
  return "capacity-shortfall";
};

const fingerprintId = async (prefix: string, payload: object): Promise<string> =>
  `${prefix}-${(await sha256Checksum(payload)).slice(0, 16)}`;

type ResourceConflictPayload = Omit<ResourceConflict, "id" | "substitutionOptionIds" | "severity">;
interface CandidateSet {
  demand: OperationalDemand;
  resource: OperationalResource;
  conflictPayload: ResourceConflictPayload;
  conflictId: string;
  candidates: OperationalResource[];
}
const allocateSubstitutionCandidates = (
  candidateSets: readonly CandidateSet[],
  capacities: ReadonlyMap<string, number>,
): Map<string, OperationalResource> => {
  const ordered = candidateSets
    .filter((item) => item.candidates.length > 0)
    .sort(
      (left, right) =>
        left.candidates.length - right.candidates.length ||
        right.demand.quantity - left.demand.quantity ||
        compare(left.conflictId, right.conflictId),
    );
  const candidateIds = [
    ...new Set(ordered.flatMap((item) => item.candidates.map((candidate) => candidate.resourceId))),
  ].sort(compare);
  const chooseBestFit = (
    items: readonly CandidateSet[],
    available: Map<string, number>,
  ): Map<string, OperationalResource> => {
    const result = new Map<string, OperationalResource>();
    for (const item of items) {
      const candidate = item.candidates
        .filter((resource) => (available.get(resource.resourceId) ?? 0) >= item.demand.quantity)
        .sort(
          (left, right) =>
            (available.get(left.resourceId) ?? 0) -
              item.demand.quantity -
              ((available.get(right.resourceId) ?? 0) - item.demand.quantity) ||
            compare(left.resourceId, right.resourceId),
        )[0];
      if (!candidate) continue;
      result.set(item.conflictId, candidate);
      available.set(candidate.resourceId, (available.get(candidate.resourceId) ?? 0) - item.demand.quantity);
    }
    return result;
  };
  let best = chooseBestFit(ordered, new Map(capacities));
  let bestQuantity = ordered
    .filter((item) => best.has(item.conflictId))
    .reduce((sum, item) => sum + item.demand.quantity, 0);
  if (ordered.length > MAX_EXACT_ALLOCATION_CONFLICTS || candidateIds.length > MAX_EXACT_ALLOCATION_RESOURCES)
    return best;

  const available = new Map(capacities);
  const current = new Map<string, OperationalResource>();
  const memo = new Map<string, number>();
  let explored = 0;
  const updateBest = (quantity: number): void => {
    if (current.size > best.size || (current.size === best.size && quantity > bestQuantity)) {
      best = new Map(current);
      bestQuantity = quantity;
    }
  };
  const search = (index: number, quantity: number): void => {
    if (explored++ >= MAX_ALLOCATION_SEARCH_NODES) return;
    if (current.size + ordered.length - index < best.size) return;
    if (index === ordered.length) {
      updateBest(quantity);
      return;
    }
    const stateKey = `${index}|${candidateIds.map((id) => available.get(id) ?? 0).join(",")}`;
    const prior = memo.get(stateKey);
    if (prior !== undefined && prior >= current.size) return;
    memo.set(stateKey, current.size);
    const item = ordered[index];
    if (!item) return;
    const viable = item.candidates
      .filter((candidate) => (available.get(candidate.resourceId) ?? 0) >= item.demand.quantity)
      .sort(
        (left, right) =>
          (available.get(left.resourceId) ?? 0) -
            item.demand.quantity -
            ((available.get(right.resourceId) ?? 0) - item.demand.quantity) ||
          compare(left.resourceId, right.resourceId),
      );
    for (const candidate of viable) {
      const before = available.get(candidate.resourceId) ?? 0;
      available.set(candidate.resourceId, before - item.demand.quantity);
      current.set(item.conflictId, candidate);
      search(index + 1, quantity + item.demand.quantity);
      current.delete(item.conflictId);
      available.set(candidate.resourceId, before);
    }
    search(index + 1, quantity);
  };
  search(0, 0);
  return best;
};

export async function reconcileOperationalResources(inputValue: unknown) {
  const input = normalizePreparedOperationalResourceInput(inputValue);
  const byId = new Map<string, OperationalResource>(input.resources.map((item) => [item.resourceId, item]));
  const conflicts: ResourceConflict[] = [];
  const substitutionOptions: SubstitutionOption[] = [];
  const directDemandTotals = new Map<string, number>();
  for (const demand of input.demands)
    directDemandTotals.set(demand.resourceId, (directDemandTotals.get(demand.resourceId) ?? 0) + demand.quantity);
  const reservedPrimary = new Map<string, number>();
  const reservedRoleHeadcount = new Map<string, number>();
  const conflicted: Omit<CandidateSet, "candidates">[] = [];
  for (const demand of input.demands) {
    const resource = byId.get(demand.resourceId);
    if (!resource) fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational demand references an unknown resource");
    const rawAvailability = availabilityFor(resource, input.project, demand);
    const resourceAvailable = Math.max(0, rawAvailability.available - (reservedPrimary.get(resource.resourceId) ?? 0));
    const staffingRequirement =
      demand.family === "staffing" && "roleId" in demand.requirements ? demand.requirements : null;
    const roleAvailable = staffingRequirement
      ? Math.max(
          0,
          (input.staffing.roles.find((item) => item.roleId === staffingRequirement.roleId)?.availableHeadcount ?? 0) -
            (reservedRoleHeadcount.get(staffingRequirement.roleId) ?? 0),
        )
      : resourceAvailable;
    const available = Math.min(resourceAvailable, roleAvailable);
    const availability = { ...rawAvailability, available };
    const compatible = resourceSatisfiesDemand(resource, demand) && staffingSatisfiesProject(resource, demand, input);
    const reason = compatible ? conflictReason(resource, demand, availability) : "incompatible-metadata";
    if (!reason) {
      reservedPrimary.set(resource.resourceId, (reservedPrimary.get(resource.resourceId) ?? 0) + demand.quantity);
      if (staffingRequirement)
        reservedRoleHeadcount.set(
          staffingRequirement.roleId,
          (reservedRoleHeadcount.get(staffingRequirement.roleId) ?? 0) + demand.quantity,
        );
      continue;
    }
    const conflictPayload: ResourceConflictPayload = {
      reason,
      family: demand.family,
      demandId: demand.demandId,
      resourceId: resource.resourceId,
      requiredQuantity: demand.quantity,
      availableQuantity: availability.available,
      targetObjectIds: demand.targetObjectIds,
      bookingRefs: availability.bookingRefs,
    };
    const conflictId = await fingerprintId("resource-conflict", conflictPayload);
    conflicted.push({ demand, resource, conflictPayload, conflictId });
  }
  const optionCapacity = new Map(
    input.resources.map((resource) => [
      resource.resourceId,
      Math.max(
        0,
        availabilityFor(resource, input.project).available - (directDemandTotals.get(resource.resourceId) ?? 0),
      ),
    ]),
  );
  const candidateSets: CandidateSet[] = conflicted.map((conflict) => {
    const { demand, resource } = conflict;
    const previewSupported =
      ["inventory", "av", "catering"].includes(demand.family) && demand.targetObjectIds.length === 1;
    const candidates = previewSupported
      ? input.resources
          .filter((candidate) => {
            if (candidate.resourceId === resource.resourceId || !resourceSatisfiesDemand(candidate, demand))
              return false;
            return (optionCapacity.get(candidate.resourceId) ?? 0) >= demand.quantity;
          })
          .sort((left, right) => compare(left.resourceId, right.resourceId))
      : [];
    return { ...conflict, candidates };
  });
  const assignedCandidate = allocateSubstitutionCandidates(candidateSets, optionCapacity);
  for (const { demand, conflictPayload, conflictId } of candidateSets) {
    const assigned = assignedCandidate.get(conflictId);
    const candidates: OperationalResource[] = assigned ? [assigned] : [];
    const optionIds: string[] = [];
    for (const candidate of candidates) {
      const optionPayload = {
        conflictId,
        demandId: demand.demandId,
        replacementResourceId: candidate.resourceId,
        targetObjectIds: demand.targetObjectIds,
        quantity: demand.quantity,
        replacementSourceChecksum: candidate.source.checksum,
      };
      const id = await fingerprintId("resource-option", optionPayload);
      optionIds.push(id);
      substitutionOptions.push({ id, ...optionPayload, family: demand.family, requiresHumanApproval: true });
    }
    conflicts.push({
      id: conflictId,
      ...conflictPayload,
      substitutionOptionIds: optionIds.sort(compare),
      severity: "error",
    });
  }
  conflicts.sort((left, right) => compare(left.id, right.id));
  substitutionOptions.sort((left, right) => compare(left.id, right.id));
  return Object.freeze({
    schemaVersion: 1,
    status: conflicts.length ? "attention-required" : "reconciled",
    projectId: input.project.projectId,
    planVersion: input.project.planVersion,
    planFingerprint: input.project.planFingerprint,
    eventWindow: clone(input.project.eventWindow),
    currentReservationRef: input.project.currentReservationRef,
    resources: clone(input.resources),
    staffing: clone(input.staffing),
    demands: clone(input.demands),
    conflicts,
    substitutionOptions,
    summary: {
      resources: input.resources.length,
      demands: input.demands.length,
      conflicts: conflicts.length,
      unavailable: conflicts.filter((item) => item.reason === "unavailable").length,
      doubleBooked: conflicts.filter((item) => item.reason === "double-booked").length,
      capacityShortfalls: conflicts.filter((item) => item.reason === "capacity-shortfall").length,
      incompatibleMetadata: conflicts.filter((item) => item.reason === "incompatible-metadata").length,
    },
    privacy: { personnelMode: "opaque-reference", rawPersonnelIdentityStored: false, contactDataStored: false },
  });
}
