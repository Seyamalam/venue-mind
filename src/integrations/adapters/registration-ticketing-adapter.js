import { AdapterContractError, assertIsoTimestamp, createSyncCursor, defineAdapter, sha256Checksum } from "../contracts.js";

const MAX_TICKET_CLASSES = 500;
const MAX_ZONES = 500;
const MAX_ACCESSIBILITY_REQUIREMENTS = 100;
const MAX_COUNT = 1_000_000;
const IDENTIFIER = /^[a-z0-9][a-z0-9._-]{0,119}$/;
const FORBIDDEN_PERSONAL_KEYS = new Set([
  "attendee", "attendees", "attendeeid", "person", "people", "personid", "userid", "customerid",
  "name", "firstname", "lastname", "fullname", "email", "emailaddress", "phone", "phonenumber",
  "address", "postaladdress", "barcode", "qrcode", "ticketcode", "orderid", "payment", "paymentid",
  "card", "medical", "medicalcondition", "diagnosis", "disability", "note", "notes", "accessibilitynote",
]);

const clone = (value) => structuredClone(value);

const fail = (code, message, details = {}) => {
  throw new AdapterContractError(code, message, details);
};

const assertPlainObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ADAPTER_SOURCE_INVALID", `${label} must be an object`);
};

const assertExactKeys = (value, allowed, label) => {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", `${label} contains unknown fields`, { fields: unknown });
};

const assertIdentifier = (value, label) => {
  if (typeof value !== "string" || !IDENTIFIER.test(value)) fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded identifier`);
  return value;
};

const assertBoundedString = (value, label) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded string`);
  return value;
};

const assertCount = (value, label) => {
  if (!Number.isInteger(value) || value < 0 || value > MAX_COUNT) fail("ADAPTER_SOURCE_INVALID", `${label} must be an aggregate integer from 0 to ${MAX_COUNT}`);
  return value;
};

const normalizedPersonalKey = (key) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const assertNoPersonalData = (value, path = []) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoPersonalData(item, [...path, String(index)]));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /(?:[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+\.[a-z]{2,}|\+\d[\d ().-]{8,}\d|\b\d{3}[ .()-]\d{3}[ .-]\d{4}\b)/i.test(value)) fail("ADAPTER_PERSONAL_DATA_REJECTED", "Registration input contains person-level contact data", { path: path.join(".") });
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_PERSONAL_KEYS.has(normalizedPersonalKey(key))) fail("ADAPTER_PERSONAL_DATA_REJECTED", "Registration input contains a forbidden person-level field", { field: key, path: [...path, key].join(".") });
    assertNoPersonalData(item, [...path, key]);
  }
};

const normalizeProjectOccupancy = (input) => {
  assertPlainObject(input, "Project occupancy");
  assertExactKeys(input, ["attendeeTarget", "zones"], "Project occupancy");
  const attendeeTarget = assertCount(input.attendeeTarget, "Project attendeeTarget");
  if (!Array.isArray(input.zones) || input.zones.length === 0 || input.zones.length > MAX_ZONES) fail("ADAPTER_SOURCE_INVALID", `Project occupancy zones must contain 1 to ${MAX_ZONES} records`);
  const zones = input.zones.map((zone) => {
    assertPlainObject(zone, "Project occupancy zone");
    assertExactKeys(zone, ["zoneId", "minimumCapacity", "maximumCapacity"], "Project occupancy zone");
    const normalized = {
      zoneId: assertIdentifier(zone.zoneId, "Project occupancy zoneId"),
      minimumCapacity: assertCount(zone.minimumCapacity, "Project occupancy minimumCapacity"),
      maximumCapacity: assertCount(zone.maximumCapacity, "Project occupancy maximumCapacity"),
    };
    if (normalized.maximumCapacity < normalized.minimumCapacity) fail("ADAPTER_SOURCE_INVALID", "Project occupancy maximumCapacity must be at least minimumCapacity", { zoneId: normalized.zoneId });
    return normalized;
  }).sort((left, right) => left.zoneId.localeCompare(right.zoneId));
  if (new Set(zones.map((zone) => zone.zoneId)).size !== zones.length) fail("ADAPTER_SOURCE_INVALID", "Project occupancy zone IDs must be unique");
  return { attendeeTarget, zones };
};

const normalizeAccessibilityRequirements = (input, zoneIds) => {
  if (!Array.isArray(input) || input.length > MAX_ACCESSIBILITY_REQUIREMENTS) fail("ADAPTER_SOURCE_INVALID", `Accessibility requirements must contain at most ${MAX_ACCESSIBILITY_REQUIREMENTS} aggregate records`);
  const requirements = input.map((requirement) => {
    assertPlainObject(requirement, "Aggregate accessibility requirement");
    assertExactKeys(requirement, ["code", "count", "zoneIds"], "Aggregate accessibility requirement");
    if (!Array.isArray(requirement.zoneIds) || requirement.zoneIds.length === 0 || requirement.zoneIds.length > MAX_ZONES) fail("ADAPTER_SOURCE_INVALID", "Aggregate accessibility requirement zoneIds must be a bounded non-empty array");
    const normalizedZoneIds = [...new Set(requirement.zoneIds.map((zoneId) => assertIdentifier(zoneId, "Aggregate accessibility requirement zoneId")))].sort();
    const foreignZoneIds = normalizedZoneIds.filter((zoneId) => !zoneIds.has(zoneId));
    if (foreignZoneIds.length) fail("ADAPTER_ZONE_MAPPING_INVALID", "Aggregate accessibility requirement references unknown Project zones", { zoneIds: foreignZoneIds });
    return { code: assertIdentifier(requirement.code, "Aggregate accessibility requirement code"), count: assertCount(requirement.count, "Aggregate accessibility requirement count"), zoneIds: normalizedZoneIds };
  }).sort((left, right) => left.code.localeCompare(right.code));
  if (new Set(requirements.map((requirement) => requirement.code)).size !== requirements.length) fail("ADAPTER_SOURCE_INVALID", "Aggregate accessibility requirement codes must be unique");
  return requirements;
};

const normalizeTicketClasses = (input, zoneIds, accessCodes) => {
  if (!Array.isArray(input) || input.length === 0 || input.length > MAX_TICKET_CLASSES) fail("ADAPTER_SOURCE_INVALID", `Ticket classes must contain 1 to ${MAX_TICKET_CLASSES} aggregate records`);
  const ticketClasses = input.map((ticketClass) => {
    assertPlainObject(ticketClass, "Ticket class");
    assertExactKeys(ticketClass, ["externalId", "ticketedCount", "attendanceForecast", "zoneAllocations", "accessRequirementCodes"], "Ticket class");
    if (!Array.isArray(ticketClass.zoneAllocations) || ticketClass.zoneAllocations.length === 0 || ticketClass.zoneAllocations.length > MAX_ZONES) fail("ADAPTER_SOURCE_INVALID", "Ticket class zoneAllocations must be a bounded non-empty array");
    const zoneAllocations = ticketClass.zoneAllocations.map((allocation) => {
      assertPlainObject(allocation, "Ticket class zone allocation");
      assertExactKeys(allocation, ["zoneId", "ticketedCount", "attendanceForecast"], "Ticket class zone allocation");
      const zoneId = assertIdentifier(allocation.zoneId, "Ticket class zoneId");
      if (!zoneIds.has(zoneId)) fail("ADAPTER_ZONE_MAPPING_INVALID", "Ticket class references an unknown Project zone", { zoneId });
      return { zoneId, ticketedCount: assertCount(allocation.ticketedCount, "Ticket class zone ticketedCount"), attendanceForecast: assertCount(allocation.attendanceForecast, "Ticket class zone attendanceForecast") };
    }).sort((left, right) => left.zoneId.localeCompare(right.zoneId));
    if (new Set(zoneAllocations.map((allocation) => allocation.zoneId)).size !== zoneAllocations.length) fail("ADAPTER_SOURCE_INVALID", "Ticket class zone allocations must be unique");
    const ticketedCount = assertCount(ticketClass.ticketedCount, "Ticket class ticketedCount");
    const attendanceForecast = assertCount(ticketClass.attendanceForecast, "Ticket class attendanceForecast");
    if (zoneAllocations.reduce((sum, allocation) => sum + allocation.ticketedCount, 0) !== ticketedCount || zoneAllocations.reduce((sum, allocation) => sum + allocation.attendanceForecast, 0) !== attendanceForecast) fail("ADAPTER_TICKET_TOTAL_MISMATCH", "Ticket class totals must equal their zone allocations", { externalId: ticketClass.externalId });
    if (attendanceForecast > ticketedCount) fail("ADAPTER_SOURCE_INVALID", "Ticket class attendanceForecast cannot exceed ticketedCount", { externalId: ticketClass.externalId });
    if (!Array.isArray(ticketClass.accessRequirementCodes) || ticketClass.accessRequirementCodes.length > MAX_ACCESSIBILITY_REQUIREMENTS) fail("ADAPTER_SOURCE_INVALID", "Ticket class accessRequirementCodes must be a bounded array");
    const accessRequirementCodes = [...new Set(ticketClass.accessRequirementCodes.map((code) => assertIdentifier(code, "Ticket class access requirement code")))].sort();
    const foreignCodes = accessRequirementCodes.filter((code) => !accessCodes.has(code));
    if (foreignCodes.length) fail("ADAPTER_ACCESS_MAPPING_INVALID", "Ticket class references unknown aggregate accessibility requirements", { codes: foreignCodes });
    return { externalId: assertIdentifier(ticketClass.externalId, "Ticket class externalId"), ticketedCount, attendanceForecast, zoneAllocations, accessRequirementCodes };
  }).sort((left, right) => left.externalId.localeCompare(right.externalId));
  if (new Set(ticketClasses.map((ticketClass) => ticketClass.externalId)).size !== ticketClasses.length) fail("ADAPTER_SOURCE_INVALID", "Ticket class external IDs must be unique");
  return ticketClasses;
};

const normalizeCheckIn = (input, eventDayMode, ticketClasses) => {
  if (!eventDayMode) {
    if (input !== null && input !== undefined) fail("ADAPTER_EVENT_DAY_REQUIRED", "Aggregate check-in counts require event-day mode");
    return null;
  }
  assertPlainObject(input, "Aggregate check-in");
  assertExactKeys(input, ["asOf", "counts"], "Aggregate check-in");
  assertIsoTimestamp(input.asOf, "Aggregate check-in asOf");
  if (!Array.isArray(input.counts) || input.counts.length > MAX_TICKET_CLASSES) fail("ADAPTER_SOURCE_INVALID", `Aggregate check-in counts must contain at most ${MAX_TICKET_CLASSES} records`);
  const classes = new Map(ticketClasses.map((ticketClass) => [ticketClass.externalId, ticketClass]));
  const counts = input.counts.map((count) => {
    assertPlainObject(count, "Aggregate check-in count");
    assertExactKeys(count, ["ticketClassId", "count"], "Aggregate check-in count");
    const ticketClassId = assertIdentifier(count.ticketClassId, "Aggregate check-in ticketClassId");
    const ticketClass = classes.get(ticketClassId);
    if (!ticketClass) fail("ADAPTER_TICKET_CLASS_UNKNOWN", "Aggregate check-in count references an unknown ticket class", { ticketClassId });
    const aggregateCount = assertCount(count.count, "Aggregate check-in count");
    if (aggregateCount > ticketClass.ticketedCount) fail("ADAPTER_CHECK_IN_INVALID", "Aggregate check-in count cannot exceed its ticket class total", { ticketClassId });
    return { ticketClassId, count: aggregateCount };
  }).sort((left, right) => left.ticketClassId.localeCompare(right.ticketClassId));
  if (new Set(counts.map((count) => count.ticketClassId)).size !== counts.length) fail("ADAPTER_SOURCE_INVALID", "Aggregate check-in ticket class IDs must be unique");
  return { asOf: input.asOf, counts };
};

const normalizeCoreInput = (input) => {
  assertPlainObject(input, "Registration aggregate input");
  const projectOccupancy = normalizeProjectOccupancy(input.projectOccupancy);
  const zoneIds = new Set(projectOccupancy.zones.map((zone) => zone.zoneId));
  const accessibilityRequirements = normalizeAccessibilityRequirements(input.accessibilityRequirements ?? [], zoneIds);
  const accessCodes = new Set(accessibilityRequirements.map((requirement) => requirement.code));
  const ticketClasses = normalizeTicketClasses(input.ticketClasses, zoneIds, accessCodes);
  if (ticketClasses.reduce((sum, ticketClass) => sum + ticketClass.ticketedCount, 0) > MAX_COUNT || ticketClasses.reduce((sum, ticketClass) => sum + ticketClass.attendanceForecast, 0) > MAX_COUNT) fail("ADAPTER_SOURCE_INVALID", `Registration aggregate totals cannot exceed ${MAX_COUNT}`);
  const eventDayMode = input.eventDayMode === true;
  if (input.eventDayMode !== true && input.eventDayMode !== false) fail("ADAPTER_SOURCE_INVALID", "eventDayMode must be boolean");
  const checkIn = normalizeCheckIn(input.checkIn, eventDayMode, ticketClasses);
  if (checkIn && checkIn.counts.reduce((sum, count) => sum + count.count, 0) > MAX_COUNT) fail("ADAPTER_SOURCE_INVALID", `Aggregate check-in total cannot exceed ${MAX_COUNT}`);
  return {
    sourceSystem: assertIdentifier(input.sourceSystem, "Registration sourceSystem"),
    sourceVersion: assertBoundedString(input.sourceVersion, "Registration sourceVersion"),
    projectId: assertIdentifier(input.projectId, "Registration projectId"),
    planVersion: assertBoundedString(input.planVersion, "Registration planVersion"),
    nextCursor: input.nextCursor === undefined ? input.sourceVersion : assertBoundedString(input.nextCursor, "Registration nextCursor"),
    eventDayMode,
    projectOccupancy,
    ticketClasses,
    accessibilityRequirements,
    checkIn,
  };
};

const IMPORT_KEYS = ["sourceSystem", "sourceVersion", "projectId", "planVersion", "nextCursor", "eventDayMode", "projectOccupancy", "ticketClasses", "accessibilityRequirements", "checkIn"];
const WEBHOOK_KEYS = ["id", "type", "occurredAt", ...IMPORT_KEYS];

export function normalizeRegistrationAdapterInput(capability, input) {
  assertNoPersonalData(input);
  assertPlainObject(input, "Registration adapter input");
  if (capability === "import" || capability === "synchronize") {
    assertExactKeys(input, IMPORT_KEYS, "Registration adapter input");
    return Object.freeze(normalizeCoreInput(input));
  }
  if (capability === "webhook") {
    assertExactKeys(input, WEBHOOK_KEYS, "Registration webhook input");
    if (input.type !== "aggregate-check-in.updated") fail("ADAPTER_SOURCE_INVALID", "Registration webhook type must be aggregate-check-in.updated");
    assertIsoTimestamp(input.occurredAt, "Registration webhook occurredAt");
    return Object.freeze({ id: assertIdentifier(input.id, "Registration webhook id"), type: input.type, occurredAt: input.occurredAt, ...normalizeCoreInput(input) });
  }
  fail("ADAPTER_CAPABILITY_UNSUPPORTED", `Registration adapter does not support ${capability}`);
}

const namespacedTicketClassId = (sourceSystem, externalId) => `${sourceSystem}:${externalId}`;

export function reconcileRegistrationOccupancy(input) {
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
  const zones = input.projectOccupancy.zones.map((zone) => {
    const allocations = ticketClasses.flatMap((ticketClass) => ticketClass.zoneAllocations.filter((allocation) => allocation.zoneId === zone.zoneId).map((allocation) => ({ ticketClassId: ticketClass.ticketClassId, ...allocation })));
    const ticketedCount = allocations.reduce((sum, allocation) => sum + allocation.ticketedCount, 0);
    const attendanceForecast = allocations.reduce((sum, allocation) => sum + allocation.attendanceForecast, 0);
    const status = ticketedCount < zone.minimumCapacity ? "under-target" : ticketedCount > zone.maximumCapacity ? "over-capacity" : "within-limit";
    return { zoneId: zone.zoneId, minimumCapacity: zone.minimumCapacity, maximumCapacity: zone.maximumCapacity, ticketedCount, attendanceForecast, ticketClassIds: allocations.map((allocation) => allocation.ticketClassId).sort(), status };
  });
  const accessibility = input.accessibilityRequirements.map((requirement) => {
    const mapped = ticketClasses.filter((ticketClass) => ticketClass.accessRequirementCodes.includes(requirement.code) && ticketClass.zoneAllocations.some((allocation) => requirement.zoneIds.includes(allocation.zoneId)));
    const mappedTicketedCount = mapped.reduce((sum, ticketClass) => sum + ticketClass.ticketedCount, 0);
    return { code: requirement.code, requiredCount: requirement.count, zoneIds: clone(requirement.zoneIds), ticketClassIds: mapped.map((ticketClass) => ticketClass.ticketClassId).sort(), mappedTicketedCount, status: mappedTicketedCount >= requirement.count ? "covered" : "under-mapped" };
  });
  const issues = [
    ...(ticketClassTotal === input.projectOccupancy.attendeeTarget ? [] : [{ code: "TICKET_TOTAL_MISMATCH", actual: ticketClassTotal, target: input.projectOccupancy.attendeeTarget }]),
    ...zones.filter((zone) => zone.status !== "within-limit").map((zone) => ({ code: zone.status === "under-target" ? "ZONE_UNDER_TARGET" : "ZONE_OVER_CAPACITY", zoneId: zone.zoneId, actual: zone.ticketedCount, target: zone.status === "under-target" ? zone.minimumCapacity : zone.maximumCapacity })),
    ...accessibility.filter((requirement) => requirement.status !== "covered").map((requirement) => ({ code: "ACCESS_REQUIREMENT_UNDER_MAPPED", requirementCode: requirement.code, actual: requirement.mappedTicketedCount, target: requirement.requiredCount })),
  ].sort((left, right) => left.code.localeCompare(right.code) || String(left.zoneId ?? left.requirementCode ?? "").localeCompare(String(right.zoneId ?? right.requirementCode ?? "")));
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

const registrationSnapshot = async (definition, input, synchronizedAt) => {
  assertIsoTimestamp(synchronizedAt, "Registration synchronizedAt");
  if (input.checkIn && Date.parse(input.checkIn.asOf) > Date.parse(synchronizedAt)) fail("ADAPTER_CHECK_IN_INVALID", "Aggregate check-in asOf cannot be later than synchronization time");
  const reconciliation = reconcileRegistrationOccupancy(input);
  const ticketClasses = input.ticketClasses.map((ticketClass) => ({
    ticketClassId: namespacedTicketClassId(input.sourceSystem, ticketClass.externalId),
    ticketedCount: ticketClass.ticketedCount,
    attendanceForecast: ticketClass.attendanceForecast,
    zoneAllocations: clone(ticketClass.zoneAllocations),
    accessRequirementCodes: clone(ticketClass.accessRequirementCodes),
  }));
  const accessibilityRequirements = clone(input.accessibilityRequirements);
  const checkIn = input.checkIn ? {
    asOf: input.checkIn.asOf,
    total: input.checkIn.counts.reduce((sum, count) => sum + count.count, 0),
    byTicketClass: input.checkIn.counts.map((count) => ({ ticketClassId: namespacedTicketClassId(input.sourceSystem, count.ticketClassId), count: count.count })),
  } : null;
  const syncCursor = await createSyncCursor(definition, { opaque: input.nextCursor, sourceVersion: input.sourceVersion });
  const content = {
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
    privacy: { mode: "aggregate-only", attendeeIdentityStored: false, individualCheckInStored: false, freeFormAccessibilityStored: false },
  };
  const checksum = await sha256Checksum(content);
  return Object.freeze({ id: `registration-snapshot-${checksum.slice(0, 16)}`, status: reconciliation.status === "pass" ? "reconciled" : "attention-required", ...content, checksum });
};

const assertNoPlanningEffects = (value, path = []) => {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoPlanningEffects(item, [...path, String(index)]));
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (["acceptedPlan", "changes", "planningEffects", "proposal", "spatialEffects"].includes(key)) fail("ADAPTER_REVIEW_BYPASS", "Aggregate registration evidence cannot contain executable or accepted-state effects", { field: key, path: [...path, key].join(".") });
    assertNoPlanningEffects(item, [...path, key]);
  }
};

export async function assertRegistrationSnapshot(snapshot) {
  assertNoPersonalData(snapshot);
  assertNoPlanningEffects(snapshot);
  assertPlainObject(snapshot, "Registration snapshot");
  assertExactKeys(snapshot, ["id", "status", "schemaVersion", "adapterId", "adapterVersion", "sourceSystem", "sourceVersion", "synchronizedAt", "projectId", "planVersion", "eventDayMode", "syncCursor", "ticketClasses", "accessibilityRequirements", "checkIn", "reconciliation", "privacy", "checksum"], "Registration snapshot");
  if (snapshot.schemaVersion !== 1 || snapshot.adapterId !== registrationTicketingAdapterDefinition.id || snapshot.adapterVersion !== registrationTicketingAdapterDefinition.version) fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot adapter identity is invalid");
  assertIsoTimestamp(snapshot.synchronizedAt, "Registration snapshot synchronizedAt");
  if (!snapshot.reconciliation || !["pass", "attention-required"].includes(snapshot.reconciliation.status)) fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot reconciliation is invalid");
  const expectedStatus = snapshot.reconciliation.status === "pass" ? "reconciled" : "attention-required";
  if (snapshot.status !== expectedStatus) fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot status does not match reconciliation");
  if (!snapshot.privacy || snapshot.privacy.mode !== "aggregate-only" || snapshot.privacy.attendeeIdentityStored !== false || snapshot.privacy.individualCheckInStored !== false || snapshot.privacy.freeFormAccessibilityStored !== false) fail("ADAPTER_PERSONAL_DATA_REJECTED", "Registration snapshot privacy evidence is invalid");
  if (!Array.isArray(snapshot.ticketClasses) || snapshot.ticketClasses.some((ticketClass) => typeof ticketClass.ticketClassId !== "string" || !ticketClass.ticketClassId.startsWith(`${snapshot.sourceSystem}:`) || Object.hasOwn(ticketClass, "externalId"))) fail("ADAPTER_CONTRACT_INVALID", "Registration snapshot Ticket Class identity is invalid");
  if (!/^[0-9a-f]{64}$/.test(snapshot.checksum ?? "")) fail("ADAPTER_CHECKSUM_INVALID", "Registration snapshot checksum is invalid");
  const { id, status: _status, checksum, ...content } = snapshot;
  const actual = await sha256Checksum(content);
  if (actual !== checksum || id !== `registration-snapshot-${checksum.slice(0, 16)}`) fail("ADAPTER_CHECKSUM_MISMATCH", "Registration snapshot checksum does not match normalized aggregate content");
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
  retryPolicy: { maxAttempts: 4, initialDelayMs: 100, maximumDelayMs: 800, multiplier: 2, retryableCodes: ["ADAPTER_NETWORK_ERROR", "ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"] },
  rateLimit: { requests: 30, windowMs: 60_000 },
});

export const registrationTicketingAdapter = Object.freeze({
  definition: registrationTicketingAdapterDefinition,
  assertImportResult: assertRegistrationSnapshot,
  async prepareInput(capability, input) {
    return normalizeRegistrationAdapterInput(capability, input);
  },
  async invoke(capability, input, context) {
    const normalized = normalizeRegistrationAdapterInput(capability, input);
    await context.secrets.get("registration-ticketing/api-token");
    if (capability === "import" || capability === "synchronize") return registrationSnapshot(registrationTicketingAdapterDefinition, normalized, context.clock());
    if (capability === "webhook") {
      const payload = await registrationSnapshot(registrationTicketingAdapterDefinition, normalized, normalized.occurredAt);
      const content = { schemaVersion: 1, adapterId: registrationTicketingAdapterDefinition.id, adapterVersion: registrationTicketingAdapterDefinition.version, sourceSystem: normalized.sourceSystem, eventId: normalized.id, eventType: normalized.type, occurredAt: normalized.occurredAt, sourceVersion: normalized.sourceVersion, payload };
      return Object.freeze({ ...content, checksum: await sha256Checksum(content) });
    }
    fail("ADAPTER_CAPABILITY_UNSUPPORTED", `Registration adapter does not support ${capability}`);
  },
});
