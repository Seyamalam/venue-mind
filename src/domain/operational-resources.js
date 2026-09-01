import { AdapterContractError, assertIsoTimestamp, sha256Checksum } from "../integrations/contracts.js";
import { isNonContactLabel } from "../integrations/privacy.js";

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
const FAMILIES = new Set(["inventory", "av", "power", "catering", "staffing"]);
const STATUSES = new Set(["available", "unavailable"]);
const clone = (value) => structuredClone(value);
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;

const fail = (code, message, details = {}) => {
  throw new AdapterContractError(code, message, details);
};

const assertObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ADAPTER_SOURCE_INVALID", `${label} must be an object`);
};

const assertExact = (value, keys, label) => {
  assertObject(value, label);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", `${label} contains unknown fields`, { fieldCount: unknown.length });
};

const identifier = (value, label) => {
  if (typeof value !== "string" || !IDENTIFIER.test(value) || !isNonContactLabel(value)) fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded non-contact identifier`);
  return value;
};

const boundedString = (value, label) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 200 || !isNonContactLabel(value)) fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded non-contact string`);
  return value;
};

const count = (value, label, { positive = false } = {}) => {
  if (!Number.isInteger(value) || value < (positive ? 1 : 0) || value > MAX_COUNT) fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded ${positive ? "positive " : ""}integer`);
  return value;
};

const finite = (value, label, { positive = false } = {}) => {
  if (!Number.isFinite(value) || value < (positive ? Number.EPSILON : 0)) fail("ADAPTER_SOURCE_INVALID", `${label} must be a non-negative finite number`);
  return Number(value);
};

const exactTemplateRef = (value, label = "Template binding") => {
  assertExact(value, ["templateId", "version"], label);
  return { templateId: identifier(value.templateId, `${label} templateId`), version: boundedString(value.version, `${label} version`) };
};

const normalizeBooking = (value, label) => {
  assertExact(value, ["bookingRef", "startAt", "endAt", "quantity", "reservationRef"], label);
  assertIsoTimestamp(value.startAt, `${label} startAt`);
  assertIsoTimestamp(value.endAt, `${label} endAt`);
  if (Date.parse(value.endAt) <= Date.parse(value.startAt)) fail("ADAPTER_SOURCE_INVALID", `${label} requires an increasing time window`);
  return {
    bookingRef: identifier(value.bookingRef, `${label} bookingRef`),
    startAt: value.startAt,
    endAt: value.endAt,
    quantity: count(value.quantity, `${label} quantity`, { positive: true }),
    reservationRef: identifier(value.reservationRef, `${label} reservationRef`),
  };
};

const normalizeSource = (value, family) => {
  const allowed = family === "staffing" ? ["entityType", "sourceVersion", "checksum"] : ["entityType", "externalId", "sourceVersion", "checksum"];
  assertExact(value, allowed, "Operational resource source evidence");
  if (!SHA256.test(value.checksum ?? "")) fail("ADAPTER_CHECKSUM_INVALID", "Operational resource source checksum is invalid");
  return {
    entityType: identifier(value.entityType, "Operational resource entityType"),
    ...(family === "staffing" ? {} : { externalId: identifier(value.externalId, "Operational resource externalId") }),
    sourceVersion: boundedString(value.sourceVersion, "Operational resource sourceVersion"),
    checksum: value.checksum,
  };
};

const normalizeCapability = (family, value) => {
  if (family === "inventory") {
    assertExact(value, ["templateRef"], "Inventory capability");
    return { templateRef: exactTemplateRef(value.templateRef, "Inventory template binding") };
  }
  if (family === "av") {
    assertExact(value, ["templateRef", "equipmentType", "powerWatts", "voltage", "connector"], "AV capability");
    return { templateRef: exactTemplateRef(value.templateRef, "AV template binding"), equipmentType: identifier(value.equipmentType, "AV equipmentType"), powerWatts: finite(value.powerWatts, "AV powerWatts"), voltage: finite(value.voltage, "AV voltage", { positive: true }), connector: boundedString(value.connector, "AV connector") };
  }
  if (family === "power") {
    assertExact(value, ["utilityObjectId", "circuitId", "voltage", "maxWatts", "connectors"], "Power capability");
    if (!Array.isArray(value.connectors) || value.connectors.length === 0 || value.connectors.length > 20) fail("ADAPTER_SOURCE_INVALID", "Power connectors must be a bounded non-empty array");
    return { utilityObjectId: identifier(value.utilityObjectId, "Power utilityObjectId"), circuitId: identifier(value.circuitId, "Power circuitId"), voltage: finite(value.voltage, "Power voltage", { positive: true }), maxWatts: finite(value.maxWatts, "Power maxWatts", { positive: true }), connectors: [...new Set(value.connectors.map((item) => boundedString(item, "Power connector")))].sort(compare) };
  }
  if (family === "catering") {
    assertExact(value, ["templateRef", "type", "servers", "serviceRatePerServerMinute", "queueCapacityPersons", "accessibleServicePoint"], "Catering capability");
    if (typeof value.accessibleServicePoint !== "boolean") fail("ADAPTER_SOURCE_INVALID", "Catering accessibleServicePoint must be boolean");
    return { templateRef: exactTemplateRef(value.templateRef, "Catering template binding"), type: identifier(value.type, "Catering type"), servers: count(value.servers, "Catering servers", { positive: true }), serviceRatePerServerMinute: finite(value.serviceRatePerServerMinute, "Catering service rate", { positive: true }), queueCapacityPersons: count(value.queueCapacityPersons, "Catering queue capacity"), accessibleServicePoint: value.accessibleServicePoint };
  }
  assertExact(value, ["assignments"], "Staffing capability");
  if (!Array.isArray(value.assignments) || value.assignments.length === 0 || value.assignments.length > MAX_RESOURCES) fail("ADAPTER_SOURCE_INVALID", "Staffing capability requires bounded role and shift assignments");
  const assignments = value.assignments.map((item) => {
    assertExact(item, ["roleId", "shiftId", "status", "bookings"], "Staffing capability assignment");
    const normalized = { roleId: identifier(item.roleId, "Staffing roleId"), shiftId: identifier(item.shiftId, "Staffing shiftId") };
    if (item.status !== undefined) {
      if (!STATUSES.has(item.status)) fail("ADAPTER_SOURCE_INVALID", "Staffing capability assignment status is invalid");
      normalized.status = item.status;
    }
    if (item.bookings !== undefined) {
      if (!Array.isArray(item.bookings) || item.bookings.length > MAX_BOOKINGS) fail("ADAPTER_SOURCE_INVALID", `Staffing capability assignment bookings must contain at most ${MAX_BOOKINGS} records`);
      normalized.bookings = item.bookings.map((booking, index) => normalizeBooking(booking, `Staffing capability assignment booking ${index + 1}`)).sort((left, right) => compare(left.startAt, right.startAt) || compare(left.endAt, right.endAt) || compare(left.bookingRef, right.bookingRef));
      if (new Set(normalized.bookings.map((booking) => booking.bookingRef)).size !== normalized.bookings.length) fail("ADAPTER_SOURCE_INVALID", "Staffing capability assignment booking references must be unique");
    }
    return normalized;
  }).sort((left, right) => compare(left.roleId, right.roleId) || compare(left.shiftId, right.shiftId));
  if (new Set(assignments.map((item) => `${item.roleId}\u0000${item.shiftId}`)).size !== assignments.length) fail("ADAPTER_SOURCE_INVALID", "Staffing capability assignments must be unique");
  return { assignments };
};

const normalizeResource = (value) => {
  assertExact(value, ["resourceId", "family", "status", "total", "unavailable", "bookings", "capability", "source"], "Operational resource");
  if (!FAMILIES.has(value.family)) fail("ADAPTER_SOURCE_INVALID", "Operational resource family is invalid");
  if (!STATUSES.has(value.status)) fail("ADAPTER_SOURCE_INVALID", "Operational resource status is invalid");
  const total = count(value.total, "Operational resource total", { positive: true });
  const unavailable = count(value.unavailable, "Operational resource unavailable");
  if (unavailable > total) fail("ADAPTER_SOURCE_INVALID", "Operational resource unavailable count cannot exceed total");
  if (!Array.isArray(value.bookings) || value.bookings.length > MAX_BOOKINGS) fail("ADAPTER_SOURCE_INVALID", `Operational resource bookings must contain at most ${MAX_BOOKINGS} records`);
  const bookings = value.bookings.map((item, index) => normalizeBooking(item, `Operational resource booking ${index + 1}`)).sort((left, right) => compare(left.startAt, right.startAt) || compare(left.endAt, right.endAt) || compare(left.bookingRef, right.bookingRef));
  if (new Set(bookings.map((item) => item.bookingRef)).size !== bookings.length) fail("ADAPTER_SOURCE_INVALID", "Operational resource booking references must be unique per resource");
  const resourceId = identifier(value.resourceId, "Operational resource resourceId");
  if (!RESOURCE_ID.test(resourceId)) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Operational resourceId must use the server-owned Resource namespace");
  const source = normalizeSource(value.source, value.family);
  if (source.externalId === resourceId) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Operational resource source ID must remain separate from its stable Resource ID");
  return { resourceId, family: value.family, status: value.status, total, unavailable, bookings, capability: normalizeCapability(value.family, value.capability), source };
};

const normalizeRequirements = (family, value) => {
  if (family === "inventory") {
    assertExact(value, ["templateRef"], "Inventory demand");
    return { templateRef: exactTemplateRef(value.templateRef, "Inventory demand template") };
  }
  if (family === "av") {
    assertExact(value, ["templateRef", "equipmentType", "powerWatts", "voltage", "connector"], "AV demand");
    return { templateRef: exactTemplateRef(value.templateRef, "AV demand template"), equipmentType: identifier(value.equipmentType, "AV demand equipmentType"), powerWatts: finite(value.powerWatts, "AV demand powerWatts"), voltage: finite(value.voltage, "AV demand voltage", { positive: true }), connector: boundedString(value.connector, "AV demand connector") };
  }
  if (family === "power") {
    assertExact(value, ["voltage", "requiredWatts", "connector"], "Power demand");
    return { voltage: finite(value.voltage, "Power demand voltage", { positive: true }), requiredWatts: finite(value.requiredWatts, "Power demand requiredWatts", { positive: true }), connector: boundedString(value.connector, "Power demand connector") };
  }
  if (family === "catering") {
    assertExact(value, ["templateRef", "type", "servers", "serviceRatePerServerMinute", "queueCapacityPersons", "accessibleServicePoint"], "Catering demand");
    if (typeof value.accessibleServicePoint !== "boolean") fail("ADAPTER_SOURCE_INVALID", "Catering demand accessibleServicePoint must be boolean");
    return { templateRef: exactTemplateRef(value.templateRef, "Catering demand template"), type: identifier(value.type, "Catering demand type"), servers: count(value.servers, "Catering demand servers", { positive: true }), serviceRatePerServerMinute: finite(value.serviceRatePerServerMinute, "Catering demand service rate", { positive: true }), queueCapacityPersons: count(value.queueCapacityPersons, "Catering demand queue capacity"), accessibleServicePoint: value.accessibleServicePoint };
  }
  assertExact(value, ["roleId", "shiftId"], "Staffing demand");
  return { roleId: identifier(value.roleId, "Staffing demand roleId"), shiftId: identifier(value.shiftId, "Staffing demand shiftId") };
};

const normalizeDemand = (value) => {
  assertExact(value, ["demandId", "family", "resourceId", "quantity", "targetObjectIds", "requirements", "baseObjectChecksum"], "Operational resource demand");
  if (!FAMILIES.has(value.family)) fail("ADAPTER_SOURCE_INVALID", "Operational demand family is invalid");
  if (!Array.isArray(value.targetObjectIds) || value.targetObjectIds.length > 100) fail("ADAPTER_SOURCE_INVALID", "Operational demand targetObjectIds must be bounded");
  const targetObjectIds = [...new Set(value.targetObjectIds.map((item) => identifier(item, "Operational demand targetObjectId")))].sort(compare);
  if (value.family !== "staffing" && targetObjectIds.length === 0) fail("ADAPTER_SOURCE_INVALID", "Object resource demand requires a target object");
  if (!SHA256.test(value.baseObjectChecksum ?? "")) fail("ADAPTER_CHECKSUM_INVALID", "Operational demand baseObjectChecksum is invalid");
  const resourceId = identifier(value.resourceId, "Operational demand resourceId");
  if (!RESOURCE_ID.test(resourceId)) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Operational demand resourceId must use the server-owned Resource namespace");
  return { demandId: identifier(value.demandId, "Operational demand demandId"), family: value.family, resourceId, quantity: count(value.quantity, "Operational demand quantity", { positive: true }), targetObjectIds, requirements: normalizeRequirements(value.family, value.requirements), baseObjectChecksum: value.baseObjectChecksum };
};

export function normalizePreparedOperationalResourceInput(value) {
  assertExact(value, ["sourceSystem", "sourceVersion", "nextCursor", "project", "resources", "staffing", "demands"], "Prepared operational-resource input");
  assertExact(value.project, ["projectId", "planVersion", "planFingerprint", "eventWindow", "currentReservationRef"], "Operational Project context");
  assertExact(value.project.eventWindow, ["startAt", "endAt"], "Operational event window");
  assertIsoTimestamp(value.project.eventWindow.startAt, "Operational event startAt");
  assertIsoTimestamp(value.project.eventWindow.endAt, "Operational event endAt");
  if (Date.parse(value.project.eventWindow.endAt) <= Date.parse(value.project.eventWindow.startAt)) fail("ADAPTER_SOURCE_INVALID", "Operational event window must increase");
  if (!PLAN_FINGERPRINT.test(value.project.planFingerprint ?? "")) fail("ADAPTER_CHECKSUM_INVALID", "Operational Project planFingerprint is invalid");
  if (!Array.isArray(value.resources) || value.resources.length > MAX_RESOURCES) fail("ADAPTER_SOURCE_INVALID", `Operational resources must contain at most ${MAX_RESOURCES} records`);
  const resources = value.resources.map(normalizeResource).sort((left, right) => compare(left.resourceId, right.resourceId));
  if (new Set(resources.map((item) => item.resourceId)).size !== resources.length) fail("ADAPTER_SOURCE_INVALID", "Operational resource IDs must be unique");
  if (!Array.isArray(value.demands) || value.demands.length > MAX_DEMANDS) fail("ADAPTER_SOURCE_INVALID", `Operational demands must contain at most ${MAX_DEMANDS} records`);
  const demands = value.demands.map(normalizeDemand).sort((left, right) => compare(left.demandId, right.demandId));
  if (new Set(demands.map((item) => item.demandId)).size !== demands.length) fail("ADAPTER_SOURCE_INVALID", "Operational demand IDs must be unique");
  const resourceIds = new Set(resources.map((item) => item.resourceId));
  const resourcesById = new Map(resources.map((item) => [item.resourceId, item]));
  if (demands.some((item) => !resourceIds.has(item.resourceId) || resourcesById.get(item.resourceId).family !== item.family)) fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational demand references an unknown or differently typed resource");
  assertExact(value.staffing, ["roles", "shifts", "assignments"], "Operational staffing evidence");
  for (const field of ["roles", "shifts", "assignments"]) if (!Array.isArray(value.staffing[field]) || value.staffing[field].length > MAX_RESOURCES) fail("ADAPTER_SOURCE_INVALID", `Operational staffing ${field} must be bounded`);
  const roles = value.staffing.roles.map((item) => {
    assertExact(item, ["roleId", "availableHeadcount", "skills", "sourceChecksum"], "Operational staffing role");
    if (!Array.isArray(item.skills) || item.skills.length > 50) fail("ADAPTER_SOURCE_INVALID", "Operational staffing role skills must be bounded");
    if (!SHA256.test(item.sourceChecksum ?? "")) fail("ADAPTER_CHECKSUM_INVALID", "Operational staffing role sourceChecksum is invalid");
    return { roleId: identifier(item.roleId, "Operational staffing roleId"), availableHeadcount: count(item.availableHeadcount, "Operational staffing availableHeadcount"), skills: [...new Set(item.skills.map((skill) => identifier(skill, "Operational staffing skill")))].sort(compare), sourceChecksum: item.sourceChecksum };
  }).sort((left, right) => compare(left.roleId, right.roleId));
  const shifts = value.staffing.shifts.map((item) => {
    assertExact(item, ["shiftId", "startAt", "endAt", "sourceChecksum"], "Operational staffing shift");
    assertIsoTimestamp(item.startAt, "Operational staffing shift startAt");
    assertIsoTimestamp(item.endAt, "Operational staffing shift endAt");
    if (Date.parse(item.endAt) <= Date.parse(item.startAt) || !SHA256.test(item.sourceChecksum ?? "")) fail("ADAPTER_SOURCE_INVALID", "Operational staffing shift is invalid");
    return { shiftId: identifier(item.shiftId, "Operational staffing shiftId"), startAt: item.startAt, endAt: item.endAt, sourceChecksum: item.sourceChecksum };
  }).sort((left, right) => compare(left.shiftId, right.shiftId));
  const assignments = value.staffing.assignments.map((item) => {
    assertExact(item, ["assignmentId", "staffRef", "roleId", "shiftId", "resourceId", "sourceChecksum"], "Operational staffing assignment");
    if (!SHA256.test(item.sourceChecksum ?? "")) fail("ADAPTER_CHECKSUM_INVALID", "Operational staffing assignment sourceChecksum is invalid");
    const staffRef = identifier(item.staffRef, "Operational staffing staffRef");
    const resourceId = identifier(item.resourceId, "Operational staffing assignment resourceId");
    if (!STAFF_REF.test(staffRef) || !RESOURCE_ID.test(resourceId)) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Staffing evidence requires server-owned opaque StaffRef and Resource namespaces");
    return { assignmentId: identifier(item.assignmentId, "Operational staffing assignmentId"), staffRef, roleId: identifier(item.roleId, "Operational staffing assignment roleId"), shiftId: identifier(item.shiftId, "Operational staffing assignment shiftId"), resourceId, sourceChecksum: item.sourceChecksum };
  }).sort((left, right) => compare(left.assignmentId, right.assignmentId));
  if (new Set(roles.map((item) => item.roleId)).size !== roles.length || new Set(shifts.map((item) => item.shiftId)).size !== shifts.length || new Set(assignments.map((item) => item.assignmentId)).size !== assignments.length) fail("ADAPTER_SOURCE_INVALID", "Operational staffing stable IDs must be unique");
  const roleIds = new Set(roles.map((item) => item.roleId));
  const shiftIds = new Set(shifts.map((item) => item.shiftId));
  if (assignments.some((item) => {
    const resource = resourcesById.get(item.resourceId);
    return !roleIds.has(item.roleId) || !shiftIds.has(item.shiftId) || resource?.family !== "staffing" || !resource.capability.assignments.some((assignment) => assignment.roleId === item.roleId && assignment.shiftId === item.shiftId);
  })) fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational staffing assignments must reference compatible roles, shifts, and personnel resources");
  return Object.freeze({
    sourceSystem: identifier(value.sourceSystem, "Operational sourceSystem"),
    sourceVersion: boundedString(value.sourceVersion, "Operational sourceVersion"),
    nextCursor: boundedString(value.nextCursor ?? value.sourceVersion, "Operational nextCursor"),
    project: { projectId: identifier(value.project.projectId, "Operational projectId"), planVersion: boundedString(value.project.planVersion, "Operational planVersion"), planFingerprint: value.project.planFingerprint, eventWindow: clone(value.project.eventWindow), currentReservationRef: identifier(value.project.currentReservationRef, "Operational currentReservationRef") },
    resources,
    staffing: { roles, shifts, assignments },
    demands,
  });
}

export const bookingOverlaps = (booking, eventWindow) => Date.parse(booking.startAt) < Date.parse(eventWindow.endAt)
  && Date.parse(eventWindow.startAt) < Date.parse(booking.endAt);

const availabilityFor = (resource, project, demand = null) => {
  const staffingAssignment = resource.family === "staffing" && demand?.family === "staffing"
    ? resource.capability.assignments.find((assignment) => assignment.roleId === demand.requirements.roleId && assignment.shiftId === demand.requirements.shiftId)
    : null;
  const bookings = staffingAssignment?.bookings ?? resource.bookings;
  const status = staffingAssignment?.status ?? resource.status;
  const otherBookings = bookings.filter((booking) => booking.reservationRef !== project.currentReservationRef && bookingOverlaps(booking, project.eventWindow));
  const booked = otherBookings.reduce((sum, booking) => sum + booking.quantity, 0);
  const healthy = status === "unavailable" ? 0 : Math.max(0, resource.total - resource.unavailable);
  return { status, healthy, booked, available: Math.max(0, healthy - booked), bookingRefs: otherBookings.map((item) => item.bookingRef).sort(compare) };
};

const sameTemplate = (left, right) => left.templateId === right.templateId && left.version === right.version;

export const resourceSatisfiesDemand = (resource, demand) => {
  if (resource.family !== demand.family) return false;
  const capability = resource.capability;
  const requirement = demand.requirements;
  if (demand.family === "inventory") return sameTemplate(capability.templateRef, requirement.templateRef);
  if (demand.family === "av") return sameTemplate(capability.templateRef, requirement.templateRef) && capability.equipmentType === requirement.equipmentType && capability.connector === requirement.connector && capability.voltage === requirement.voltage && capability.powerWatts <= requirement.powerWatts;
  if (demand.family === "power") return capability.voltage === requirement.voltage && capability.maxWatts >= requirement.requiredWatts && capability.connectors.includes(requirement.connector);
  if (demand.family === "catering") return sameTemplate(capability.templateRef, requirement.templateRef) && capability.type === requirement.type && (!requirement.accessibleServicePoint || capability.accessibleServicePoint) && capability.queueCapacityPersons >= requirement.queueCapacityPersons && capability.servers * capability.serviceRatePerServerMinute >= requirement.servers * requirement.serviceRatePerServerMinute;
  return capability.assignments.some((assignment) => assignment.roleId === requirement.roleId && assignment.shiftId === requirement.shiftId);
};

const staffingSatisfiesProject = (resource, demand, input) => {
  if (demand.family !== "staffing") return true;
  const matchingAssignment = input.staffing.assignments.some((assignment) => assignment.resourceId === resource.resourceId && assignment.roleId === demand.requirements.roleId && assignment.shiftId === demand.requirements.shiftId);
  const shift = input.staffing.shifts.find((item) => item.shiftId === demand.requirements.shiftId);
  return matchingAssignment && Date.parse(shift?.startAt ?? "") <= Date.parse(input.project.eventWindow.startAt) && Date.parse(shift?.endAt ?? "") >= Date.parse(input.project.eventWindow.endAt);
};

const conflictReason = (resource, demand, availability) => {
  if (availability.available >= demand.quantity) return null;
  if (availability.status === "unavailable" || resource.unavailable >= resource.total) return "unavailable";
  if (availability.booked > 0 && availability.healthy >= demand.quantity) return "double-booked";
  return "capacity-shortfall";
};

const fingerprintId = async (prefix, payload) => `${prefix}-${(await sha256Checksum(payload)).slice(0, 16)}`;

const allocateSubstitutionCandidates = (candidateSets, capacities) => {
  const ordered = candidateSets.filter((item) => item.candidates.length > 0)
    .sort((left, right) => left.candidates.length - right.candidates.length || right.demand.quantity - left.demand.quantity || compare(left.conflictId, right.conflictId));
  const candidateIds = [...new Set(ordered.flatMap((item) => item.candidates.map((candidate) => candidate.resourceId)))].sort(compare);
  const chooseBestFit = (items, available) => {
    const result = new Map();
    for (const item of items) {
      const candidate = item.candidates
        .filter((resource) => (available.get(resource.resourceId) ?? 0) >= item.demand.quantity)
        .sort((left, right) => ((available.get(left.resourceId) ?? 0) - item.demand.quantity) - ((available.get(right.resourceId) ?? 0) - item.demand.quantity) || compare(left.resourceId, right.resourceId))[0];
      if (!candidate) continue;
      result.set(item.conflictId, candidate);
      available.set(candidate.resourceId, available.get(candidate.resourceId) - item.demand.quantity);
    }
    return result;
  };
  let best = chooseBestFit(ordered, new Map(capacities));
  let bestQuantity = ordered.filter((item) => best.has(item.conflictId)).reduce((sum, item) => sum + item.demand.quantity, 0);
  if (ordered.length > MAX_EXACT_ALLOCATION_CONFLICTS || candidateIds.length > MAX_EXACT_ALLOCATION_RESOURCES) return best;

  const available = new Map(capacities);
  const current = new Map();
  const memo = new Map();
  let explored = 0;
  const updateBest = (quantity) => {
    if (current.size > best.size || (current.size === best.size && quantity > bestQuantity)) {
      best = new Map(current);
      bestQuantity = quantity;
    }
  };
  const search = (index, quantity) => {
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
    const viable = item.candidates
      .filter((candidate) => (available.get(candidate.resourceId) ?? 0) >= item.demand.quantity)
      .sort((left, right) => ((available.get(left.resourceId) ?? 0) - item.demand.quantity) - ((available.get(right.resourceId) ?? 0) - item.demand.quantity) || compare(left.resourceId, right.resourceId));
    for (const candidate of viable) {
      const before = available.get(candidate.resourceId);
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

export async function reconcileOperationalResources(inputValue) {
  const input = normalizePreparedOperationalResourceInput(inputValue);
  const byId = new Map(input.resources.map((item) => [item.resourceId, item]));
  const conflicts = [];
  const substitutionOptions = [];
  const directDemandTotals = new Map();
  for (const demand of input.demands) directDemandTotals.set(demand.resourceId, (directDemandTotals.get(demand.resourceId) ?? 0) + demand.quantity);
  const reservedPrimary = new Map();
  const reservedRoleHeadcount = new Map();
  const conflicted = [];
  for (const demand of input.demands) {
    const resource = byId.get(demand.resourceId);
    const rawAvailability = availabilityFor(resource, input.project, demand);
    const resourceAvailable = Math.max(0, rawAvailability.available - (reservedPrimary.get(resource.resourceId) ?? 0));
    const roleAvailable = demand.family === "staffing"
      ? Math.max(0, (input.staffing.roles.find((item) => item.roleId === demand.requirements.roleId)?.availableHeadcount ?? 0) - (reservedRoleHeadcount.get(demand.requirements.roleId) ?? 0))
      : resourceAvailable;
    const available = Math.min(resourceAvailable, roleAvailable);
    const availability = { ...rawAvailability, available };
    const compatible = resourceSatisfiesDemand(resource, demand) && staffingSatisfiesProject(resource, demand, input);
    const reason = compatible ? conflictReason(resource, demand, availability) : "incompatible-metadata";
    if (!reason) {
      reservedPrimary.set(resource.resourceId, (reservedPrimary.get(resource.resourceId) ?? 0) + demand.quantity);
      if (demand.family === "staffing") reservedRoleHeadcount.set(demand.requirements.roleId, (reservedRoleHeadcount.get(demand.requirements.roleId) ?? 0) + demand.quantity);
      continue;
    }
    const conflictPayload = { reason, family: demand.family, demandId: demand.demandId, resourceId: resource.resourceId, requiredQuantity: demand.quantity, availableQuantity: availability.available, targetObjectIds: demand.targetObjectIds, bookingRefs: availability.bookingRefs };
    const conflictId = await fingerprintId("resource-conflict", conflictPayload);
    conflicted.push({ demand, resource, conflictPayload, conflictId });
  }
  const optionCapacity = new Map(input.resources.map((resource) => [resource.resourceId, Math.max(0, availabilityFor(resource, input.project).available - (directDemandTotals.get(resource.resourceId) ?? 0))]));
  const candidateSets = conflicted.map((conflict) => {
    const { demand, resource } = conflict;
    const previewSupported = ["inventory", "av", "catering"].includes(demand.family) && demand.targetObjectIds.length === 1;
    const candidates = previewSupported ? input.resources.filter((candidate) => {
      if (candidate.resourceId === resource.resourceId || !resourceSatisfiesDemand(candidate, demand)) return false;
      return (optionCapacity.get(candidate.resourceId) ?? 0) >= demand.quantity;
    }).sort((left, right) => compare(left.resourceId, right.resourceId)) : [];
    return { ...conflict, candidates };
  });
  const assignedCandidate = allocateSubstitutionCandidates(candidateSets, optionCapacity);
  for (const { demand, conflictPayload, conflictId } of candidateSets) {
    const candidates = assignedCandidate.has(conflictId) ? [assignedCandidate.get(conflictId)] : [];
    const optionIds = [];
    for (const candidate of candidates) {
      const optionPayload = { conflictId, demandId: demand.demandId, replacementResourceId: candidate.resourceId, targetObjectIds: demand.targetObjectIds, quantity: demand.quantity, replacementSourceChecksum: candidate.source.checksum };
      const id = await fingerprintId("resource-option", optionPayload);
      optionIds.push(id);
      substitutionOptions.push({ id, ...optionPayload, family: demand.family, requiresHumanApproval: true });
    }
    conflicts.push({ id: conflictId, ...conflictPayload, substitutionOptionIds: optionIds.sort(compare), severity: "error" });
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
    summary: { resources: input.resources.length, demands: input.demands.length, conflicts: conflicts.length, unavailable: conflicts.filter((item) => item.reason === "unavailable").length, doubleBooked: conflicts.filter((item) => item.reason === "double-booked").length, capacityShortfalls: conflicts.filter((item) => item.reason === "capacity-shortfall").length, incompatibleMetadata: conflicts.filter((item) => item.reason === "incompatible-metadata").length },
    privacy: { personnelMode: "opaque-reference", rawPersonnelIdentityStored: false, contactDataStored: false },
  });
}
