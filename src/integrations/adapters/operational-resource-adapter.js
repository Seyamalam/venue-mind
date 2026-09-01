import { AdapterContractError, assertIsoTimestamp, createSyncCursor, defineAdapter, sha256Checksum } from "../contracts.js";
import { createAdapterStagingBatch } from "../staging.js";
import { isNonContactLabel } from "../privacy.js";
import { fingerprintPlan } from "../../domain/activity-ledger.js";
import { normalizePreparedOperationalResourceInput, reconcileOperationalResources } from "../../domain/operational-resources.js";

const MAX_RECORDS = 1_000;
const MAX_COUNT = 1_000_000;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PLAN_FINGERPRINT = /^plan-[0-9a-f]{8}$/;
const RESOURCE_ID = /^resource-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAFF_REF = /^staff-ref-[0-9a-f]{32}$/;
const FAMILIES = ["inventory", "av", "power", "catering", "staffing"];
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
  if (typeof value !== "string" || !IDENTIFIER.test(value) || !isNonContactLabel(value)) fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded opaque non-contact identifier`);
  return value;
};

const boundedString = (value, label) => {
  if (typeof value !== "string" || value.length === 0 || value.length > 200 || !isNonContactLabel(value)) fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded non-contact string`);
  return value;
};

const count = (value, label, { positive = false } = {}) => {
  if (!Number.isInteger(value) || value < (positive ? 1 : 0) || value > MAX_COUNT) fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded integer`);
  return value;
};

const finite = (value, label, { positive = false } = {}) => {
  if (!Number.isFinite(value) || value < (positive ? Number.EPSILON : 0)) fail("ADAPTER_SOURCE_INVALID", `${label} must be a non-negative finite number`);
  return Number(value);
};

const records = (value, label) => {
  if (!Array.isArray(value) || value.length > MAX_RECORDS) fail("ADAPTER_SOURCE_INVALID", `${label} must contain at most ${MAX_RECORDS} records`);
  return value;
};

const normalizeSourceBooking = (value, lookup) => {
  assertExact(value, ["externalId", "startAt", "endAt", "quantity", "reservationExternalId"], "Operational source booking");
  assertIsoTimestamp(value.startAt, "Operational source booking startAt");
  assertIsoTimestamp(value.endAt, "Operational source booking endAt");
  if (Date.parse(value.endAt) <= Date.parse(value.startAt)) fail("ADAPTER_SOURCE_INVALID", "Operational source booking requires an increasing time window");
  const reservation = lookup.get(identifier(value.reservationExternalId, "Operational reservation external ID"));
  if (!reservation) fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational booking has no trusted reservation mapping");
  return { bookingRef: identifier(value.externalId, "Operational booking external ID"), startAt: value.startAt, endAt: value.endAt, quantity: count(value.quantity, "Operational booking quantity", { positive: true }), reservationRef: reservation };
};

const normalizeTemplateBinding = (value, label) => {
  assertExact(value, ["templateId", "version"], label);
  return { templateId: identifier(value.templateId, `${label} templateId`), version: boundedString(value.version, `${label} version`) };
};

const normalizeMapping = (mapping) => {
  assertExact(mapping, ["family", "externalId", "resourceId", "binding"], "Operational resource mapping");
  if (!FAMILIES.includes(mapping.family) || mapping.family === "staffing") fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational resource mapping family is invalid");
  assertObject(mapping.binding, "Operational resource mapping binding");
  if (mapping.family === "inventory" || mapping.family === "av" || mapping.family === "catering") {
    assertExact(mapping.binding, ["templateRef"], "Operational template resource binding");
    return { family: mapping.family, externalId: identifier(mapping.externalId, "Operational resource externalId"), resourceId: identifier(mapping.resourceId, "Operational resourceId"), binding: { templateRef: normalizeTemplateBinding(mapping.binding.templateRef, "Operational template binding") } };
  }
  assertExact(mapping.binding, ["utilityObjectId", "circuitId"], "Operational power binding");
  return { family: mapping.family, externalId: identifier(mapping.externalId, "Operational resource externalId"), resourceId: identifier(mapping.resourceId, "Operational resourceId"), binding: { utilityObjectId: identifier(mapping.binding.utilityObjectId, "Operational utilityObjectId"), circuitId: identifier(mapping.binding.circuitId, "Operational circuitId") } };
};

const normalizeCommonResource = async (record, family, mapping, reservationLookup) => {
  const common = ["externalId", "sourceVersion", "status", "total", "unavailable", "bookings"];
  const extra = family === "av" ? ["equipmentType", "powerWatts", "voltage", "connector"]
    : family === "power" ? ["voltage", "maxWatts", "connectors"]
      : family === "catering" ? ["type", "servers", "serviceRatePerServerMinute", "queueCapacityPersons", "accessibleServicePoint"] : [];
  assertExact(record, [...common, ...extra], `Operational ${family} record`);
  const total = count(record.total, `Operational ${family} total`, { positive: true });
  const unavailable = count(record.unavailable, `Operational ${family} unavailable`);
  if (unavailable > total || !["available", "unavailable"].includes(record.status)) fail("ADAPTER_SOURCE_INVALID", `Operational ${family} availability is invalid`);
  const bookings = records(record.bookings, `Operational ${family} bookings`).map((item) => normalizeSourceBooking(item, reservationLookup)).sort((left, right) => compare(left.startAt, right.startAt) || compare(left.bookingRef, right.bookingRef));
  let capability;
  if (family === "inventory") capability = { templateRef: mapping.binding.templateRef };
  if (family === "av") capability = { templateRef: mapping.binding.templateRef, equipmentType: identifier(record.equipmentType, "Operational AV equipmentType"), powerWatts: finite(record.powerWatts, "Operational AV powerWatts"), voltage: finite(record.voltage, "Operational AV voltage", { positive: true }), connector: boundedString(record.connector, "Operational AV connector") };
  if (family === "power") {
    if (!Array.isArray(record.connectors) || record.connectors.length === 0 || record.connectors.length > 20) fail("ADAPTER_SOURCE_INVALID", "Operational power connectors must be bounded");
    capability = { utilityObjectId: mapping.binding.utilityObjectId, circuitId: mapping.binding.circuitId, voltage: finite(record.voltage, "Operational power voltage", { positive: true }), maxWatts: finite(record.maxWatts, "Operational power maxWatts", { positive: true }), connectors: [...new Set(record.connectors.map((item) => boundedString(item, "Operational power connector")))].sort(compare) };
  }
  if (family === "catering") {
    if (typeof record.accessibleServicePoint !== "boolean") fail("ADAPTER_SOURCE_INVALID", "Operational catering accessibleServicePoint must be boolean");
    capability = { templateRef: mapping.binding.templateRef, type: identifier(record.type, "Operational catering type"), servers: count(record.servers, "Operational catering servers", { positive: true }), serviceRatePerServerMinute: finite(record.serviceRatePerServerMinute, "Operational catering service rate", { positive: true }), queueCapacityPersons: count(record.queueCapacityPersons, "Operational catering queue capacity"), accessibleServicePoint: record.accessibleServicePoint };
  }
  const externalId = identifier(record.externalId, `Operational ${family} externalId`);
  const sourceVersion = boundedString(record.sourceVersion, `Operational ${family} sourceVersion`);
  const sourceRecord = { externalId, sourceVersion, status: record.status, total, unavailable, bookings, ...Object.fromEntries(extra.map((field) => [field, capability[field]])) };
  return { resourceId: mapping.resourceId, family, status: record.status, total, unavailable, bookings, capability, source: { entityType: `${family}-resource`, externalId, sourceVersion, checksum: await sha256Checksum(sourceRecord) } };
};

const mapByExternal = (items, label, valueKey) => {
  const result = new Map();
  for (const item of items) {
    if (result.has(item.externalId)) fail("ADAPTER_RESOURCE_MAPPING_INVALID", `${label} external IDs must be unique`);
    result.set(item.externalId, item[valueKey]);
  }
  return result;
};

const normalizeTrustedContext = (value) => {
  assertExact(value, ["project", "resourceMappings", "roleMappings", "shiftMappings", "personnelMappings", "reservationMappings", "demands"], "Trusted operational-resource context");
  assertExact(value.project, ["projectId", "planVersion", "planFingerprint", "eventWindow", "currentReservationRef"], "Trusted operational Project context");
  assertExact(value.project.eventWindow, ["startAt", "endAt"], "Trusted operational event window");
  assertIsoTimestamp(value.project.eventWindow.startAt, "Trusted operational event startAt");
  assertIsoTimestamp(value.project.eventWindow.endAt, "Trusted operational event endAt");
  if ((!PLAN_FINGERPRINT.test(value.project.planFingerprint ?? "") && !SHA256.test(value.project.planFingerprint ?? "")) || Date.parse(value.project.eventWindow.endAt) <= Date.parse(value.project.eventWindow.startAt)) fail("ADAPTER_SOURCE_INVALID", "Trusted operational Project evidence is invalid");
  const resourceMappings = records(value.resourceMappings, "Trusted operational resource mappings").map(normalizeMapping).sort((left, right) => compare(left.family, right.family) || compare(left.externalId, right.externalId));
  const roleMappings = records(value.roleMappings, "Trusted operational role mappings").map((item) => { assertExact(item, ["externalId", "roleId"], "Trusted role mapping"); return { externalId: identifier(item.externalId, "Trusted role externalId"), roleId: identifier(item.roleId, "Trusted roleId") }; }).sort((left, right) => compare(left.externalId, right.externalId));
  const shiftMappings = records(value.shiftMappings, "Trusted operational shift mappings").map((item) => { assertExact(item, ["externalId", "shiftId"], "Trusted shift mapping"); return { externalId: identifier(item.externalId, "Trusted shift externalId"), shiftId: identifier(item.shiftId, "Trusted shiftId") }; }).sort((left, right) => compare(left.externalId, right.externalId));
  const personnelMappings = records(value.personnelMappings, "Trusted personnel mappings").map((item) => { assertExact(item, ["externalPersonId", "staffRef", "resourceId"], "Trusted personnel mapping"); return { externalPersonId: identifier(item.externalPersonId, "Trusted external personnel ID"), staffRef: identifier(item.staffRef, "Trusted staffRef"), resourceId: identifier(item.resourceId, "Trusted staff resourceId") }; }).sort((left, right) => compare(left.externalPersonId, right.externalPersonId));
  const reservationMappings = records(value.reservationMappings, "Trusted reservation mappings").map((item) => { assertExact(item, ["externalId", "reservationRef"], "Trusted reservation mapping"); return { externalId: identifier(item.externalId, "Trusted reservation externalId"), reservationRef: identifier(item.reservationRef, "Trusted reservationRef") }; }).sort((left, right) => compare(left.externalId, right.externalId));
  const demands = clone(records(value.demands, "Trusted operational demands"));
  const demandTargetObjectIds = demands.flatMap((demand, index) => {
    if (!Array.isArray(demand?.targetObjectIds)) fail("ADAPTER_SOURCE_INVALID", `Trusted operational demand ${index + 1} targetObjectIds must be an array`);
    return demand.targetObjectIds.map((item) => identifier(item, "Trusted demand targetObjectId"));
  });
  if (new Set(resourceMappings.map((item) => `${item.family}\u0000${item.externalId}`)).size !== resourceMappings.length
    || new Set(resourceMappings.map((item) => item.resourceId)).size !== resourceMappings.length
    || new Set(roleMappings.map((item) => item.externalId)).size !== roleMappings.length
    || new Set(roleMappings.map((item) => item.roleId)).size !== roleMappings.length
    || new Set(shiftMappings.map((item) => item.externalId)).size !== shiftMappings.length
    || new Set(shiftMappings.map((item) => item.shiftId)).size !== shiftMappings.length
    || new Set(personnelMappings.map((item) => item.externalPersonId)).size !== personnelMappings.length
    || new Set(personnelMappings.map((item) => item.staffRef)).size !== personnelMappings.length
    || new Set(personnelMappings.map((item) => item.resourceId)).size !== personnelMappings.length
    || new Set(reservationMappings.map((item) => item.externalId)).size !== reservationMappings.length
    || new Set(reservationMappings.map((item) => item.reservationRef)).size !== reservationMappings.length) {
    fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Trusted operational mappings must be one-to-one");
  }
  if (resourceMappings.some((item) => !RESOURCE_ID.test(item.resourceId))
    || personnelMappings.some((item) => !RESOURCE_ID.test(item.resourceId) || !STAFF_REF.test(item.staffRef))) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Operational mappings require server-owned Resource and opaque StaffRef namespaces");
  const externalIds = new Set([
    ...resourceMappings.map((item) => item.externalId),
    ...roleMappings.map((item) => item.externalId),
    ...shiftMappings.map((item) => item.externalId),
    ...personnelMappings.map((item) => item.externalPersonId),
    ...reservationMappings.map((item) => item.externalId),
  ]);
  const stableIds = new Set([
    identifier(value.project.projectId, "Trusted projectId"),
    identifier(value.project.currentReservationRef, "Trusted currentReservationRef"),
    ...resourceMappings.flatMap((item) => [item.resourceId, item.binding.templateRef?.templateId, item.binding.utilityObjectId, item.binding.circuitId].filter(Boolean)),
    ...roleMappings.map((item) => item.roleId),
    ...shiftMappings.map((item) => item.shiftId),
    ...personnelMappings.flatMap((item) => [item.staffRef, item.resourceId]),
    ...reservationMappings.map((item) => item.reservationRef),
    ...demandTargetObjectIds,
  ]);
  if ([...externalIds].some((id) => stableIds.has(id))) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "External operational IDs must remain globally separate from VenueMind stable IDs");
  return {
    project: { projectId: identifier(value.project.projectId, "Trusted projectId"), planVersion: boundedString(value.project.planVersion, "Trusted planVersion"), planFingerprint: value.project.planFingerprint, eventWindow: clone(value.project.eventWindow), currentReservationRef: identifier(value.project.currentReservationRef, "Trusted currentReservationRef") },
    resourceMappings,
    roleMappings,
    shiftMappings,
    personnelMappings,
    reservationMappings,
    demands,
  };
};

export async function normalizeOperationalResourceAdapterInput(capability, input, trustedContext) {
  if (capability !== "import" && capability !== "synchronize") fail("ADAPTER_CAPABILITY_UNSUPPORTED", `Operational resource adapter does not support ${capability}`);
  assertExact(input, ["sourceSystem", "sourceVersion", "nextCursor", "inventory", "avEquipment", "powerCircuits", "cateringStations", "staffing"], "Operational resource source input");
  assertExact(input.staffing, ["roles", "shifts", "assignments"], "Operational source staffing");
  const trusted = normalizeTrustedContext(trustedContext);
  const reservationLookup = mapByExternal(trusted.reservationMappings, "Reservation mappings", "reservationRef");
  const mappingLookup = new Map(trusted.resourceMappings.map((item) => [`${item.family}\u0000${item.externalId}`, item]));
  const normalizedResources = [];
  for (const [family, collection] of [["inventory", input.inventory], ["av", input.avEquipment], ["power", input.powerCircuits], ["catering", input.cateringStations]]) {
    for (const record of records(collection, `Operational ${family} records`)) {
      const externalId = identifier(record?.externalId, `Operational ${family} externalId`);
      const mapping = mappingLookup.get(`${family}\u0000${externalId}`);
      if (!mapping) fail("ADAPTER_RESOURCE_MAPPING_INVALID", `Operational ${family} record has no trusted mapping`);
      normalizedResources.push(await normalizeCommonResource(record, family, mapping, reservationLookup));
    }
  }
  const roleLookup = mapByExternal(trusted.roleMappings, "Role mappings", "roleId");
  const shiftLookup = mapByExternal(trusted.shiftMappings, "Shift mappings", "shiftId");
  const personLookup = new Map(trusted.personnelMappings.map((item) => [item.externalPersonId, item]));
  const roles = [];
  for (const role of records(input.staffing.roles, "Operational staffing roles")) {
    assertExact(role, ["externalId", "sourceVersion", "availableHeadcount", "skills"], "Operational source staffing role");
    const roleId = roleLookup.get(identifier(role.externalId, "Operational source role externalId"));
    if (!roleId) fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational staffing role has no trusted mapping");
    if (!Array.isArray(role.skills) || role.skills.length > 50) fail("ADAPTER_SOURCE_INVALID", "Operational staffing role skills must be bounded");
    const skills = [...new Set(role.skills.map((item) => identifier(item, "Operational staffing skill")))].sort(compare);
    const sourceEvidence = { externalId: identifier(role.externalId, "Operational source role externalId"), sourceVersion: boundedString(role.sourceVersion, "Operational staffing role sourceVersion"), availableHeadcount: count(role.availableHeadcount, "Operational staffing availableHeadcount"), skills };
    roles.push({ roleId, availableHeadcount: sourceEvidence.availableHeadcount, skills, sourceChecksum: await sha256Checksum(sourceEvidence) });
  }
  const shifts = [];
  for (const shift of records(input.staffing.shifts, "Operational staffing shifts")) {
    assertExact(shift, ["externalId", "sourceVersion", "startAt", "endAt"], "Operational source staffing shift");
    const shiftId = shiftLookup.get(identifier(shift.externalId, "Operational source shift externalId"));
    if (!shiftId) fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational staffing shift has no trusted mapping");
    assertIsoTimestamp(shift.startAt, "Operational staffing shift startAt");
    assertIsoTimestamp(shift.endAt, "Operational staffing shift endAt");
    if (Date.parse(shift.endAt) <= Date.parse(shift.startAt)) fail("ADAPTER_SOURCE_INVALID", "Operational staffing shift requires an increasing time window");
    const sourceEvidence = { externalId: identifier(shift.externalId, "Operational source shift externalId"), sourceVersion: boundedString(shift.sourceVersion, "Operational staffing shift sourceVersion"), startAt: shift.startAt, endAt: shift.endAt };
    shifts.push({ shiftId, startAt: shift.startAt, endAt: shift.endAt, sourceChecksum: await sha256Checksum(sourceEvidence) });
  }
  const assignments = [];
  const staffResourceDrafts = new Map();
  for (const assignment of records(input.staffing.assignments, "Operational staffing assignments")) {
    assertExact(assignment, ["externalPersonId", "sourceVersion", "roleExternalId", "shiftExternalId", "status", "bookings"], "Operational source staffing assignment");
    const person = personLookup.get(identifier(assignment.externalPersonId, "Operational source personnel ID"));
    const roleId = roleLookup.get(identifier(assignment.roleExternalId, "Operational source assignment role ID"));
    const shiftId = shiftLookup.get(identifier(assignment.shiftExternalId, "Operational source assignment shift ID"));
    if (!person || !roleId || !shiftId) fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational staffing assignment has no trusted personnel, role, or shift mapping");
    if (!["available", "unavailable"].includes(assignment.status)) fail("ADAPTER_SOURCE_INVALID", "Operational staffing assignment status is invalid");
    const bookings = records(assignment.bookings, "Operational staffing assignment bookings").map((item) => normalizeSourceBooking(item, reservationLookup)).sort((left, right) => compare(left.startAt, right.startAt) || compare(left.bookingRef, right.bookingRef));
    const sourceChecksum = await sha256Checksum({ staffRef: person.staffRef, sourceVersion: boundedString(assignment.sourceVersion, "Operational staffing assignment sourceVersion"), roleId, shiftId, status: assignment.status, bookings });
    const assignmentId = `staff-assignment-${(await sha256Checksum({ staffRef: person.staffRef, roleId, shiftId, sourceChecksum })).slice(0, 16)}`;
    assignments.push({ assignmentId, staffRef: person.staffRef, roleId, shiftId, resourceId: person.resourceId, sourceChecksum });
    const draft = staffResourceDrafts.get(person.resourceId) ?? { resourceId: person.resourceId, staffRef: person.staffRef, status: "available", sourceVersions: new Set(), sourceChecksums: new Set(), assignments: new Map(), bookings: new Map() };
    if (draft.staffRef !== person.staffRef) fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Trusted personnel resource mapping is inconsistent");
    const assignmentKey = `${roleId}\u0000${shiftId}`;
    if (draft.assignments.has(assignmentKey)) fail("ADAPTER_SOURCE_INVALID", "Operational staffing assignments must be unique per personnel, role, and shift");
    draft.sourceVersions.add(boundedString(assignment.sourceVersion, "Operational staffing assignment sourceVersion"));
    draft.sourceChecksums.add(sourceChecksum);
    draft.assignments.set(assignmentKey, { roleId, shiftId, status: assignment.status, bookings });
    for (const item of bookings) {
      const existing = draft.bookings.get(item.bookingRef);
      if (existing && JSON.stringify(existing) !== JSON.stringify(item)) fail("ADAPTER_SOURCE_INVALID", "Operational staffing booking reference has inconsistent content");
      draft.bookings.set(item.bookingRef, item);
    }
    staffResourceDrafts.set(person.resourceId, draft);
  }
  for (const draft of [...staffResourceDrafts.values()].sort((left, right) => compare(left.resourceId, right.resourceId))) {
    const sourceVersions = [...draft.sourceVersions].sort(compare);
    const sourceChecksums = [...draft.sourceChecksums].sort(compare);
    const normalizedAssignments = [...draft.assignments.values()].sort((left, right) => compare(left.roleId, right.roleId) || compare(left.shiftId, right.shiftId));
    const allUnavailable = normalizedAssignments.every((item) => item.status === "unavailable");
    normalizedResources.push({ resourceId: draft.resourceId, family: "staffing", status: allUnavailable ? "unavailable" : "available", total: 1, unavailable: allUnavailable ? 1 : 0, bookings: [...draft.bookings.values()].sort((left, right) => compare(left.startAt, right.startAt) || compare(left.bookingRef, right.bookingRef)), capability: { assignments: normalizedAssignments }, source: { entityType: "staff-assignment", sourceVersion: boundedString(input.sourceVersion, "Operational staffing sourceVersion"), checksum: await sha256Checksum({ staffRef: draft.staffRef, sourceVersions, sourceChecksums }) } });
  }
  return normalizePreparedOperationalResourceInput({
    sourceSystem: identifier(input.sourceSystem, "Operational sourceSystem"),
    sourceVersion: boundedString(input.sourceVersion, "Operational sourceVersion"),
    nextCursor: boundedString(input.nextCursor ?? input.sourceVersion, "Operational nextCursor"),
    project: trusted.project,
    resources: normalizedResources,
    staffing: { roles, shifts, assignments },
    demands: trusted.demands,
  });
}

export const operationalResourceAdapterDefinition = defineAdapter({
  contractVersion: 1,
  id: "operational-resources",
  displayName: "Operational Resources",
  version: "1.0.0",
  capabilities: ["import", "synchronize"],
  importResultMode: "aggregate-snapshot",
  scopes: { import: ["operational-resources:read"], synchronize: ["operational-resources:read"] },
  retryPolicy: { maxAttempts: 4, initialDelayMs: 100, maximumDelayMs: 800, multiplier: 2, retryableCodes: ["ADAPTER_NETWORK_ERROR", "ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"] },
  rateLimit: { requests: 30, windowMs: 60_000 },
});

const createOperationalSnapshot = async (inputValue, synchronizedAt) => {
  const input = normalizePreparedOperationalResourceInput(inputValue);
  assertIsoTimestamp(synchronizedAt, "Operational resource synchronizedAt");
  const reconciliation = await reconcileOperationalResources(input);
  const syncCursor = await createSyncCursor(operationalResourceAdapterDefinition, { opaque: input.nextCursor, sourceVersion: input.sourceVersion });
  const content = { schemaVersion: 1, adapterId: operationalResourceAdapterDefinition.id, adapterVersion: operationalResourceAdapterDefinition.version, sourceSystem: input.sourceSystem, sourceVersion: input.sourceVersion, synchronizedAt, syncCursor, ...reconciliation };
  const checksum = await sha256Checksum(content);
  return Object.freeze({ id: `operational-resource-snapshot-${checksum.slice(0, 16)}`, ...content, checksum });
};

const SNAPSHOT_KEYS = ["id", "schemaVersion", "adapterId", "adapterVersion", "sourceSystem", "sourceVersion", "synchronizedAt", "syncCursor", "status", "projectId", "planVersion", "planFingerprint", "eventWindow", "currentReservationRef", "resources", "staffing", "demands", "conflicts", "substitutionOptions", "summary", "privacy", "checksum"];

export async function assertOperationalResourceSnapshot(snapshot, context = {}) {
  assertExact(snapshot, SNAPSHOT_KEYS, "Operational resource snapshot");
  if (snapshot.schemaVersion !== 1 || snapshot.adapterId !== operationalResourceAdapterDefinition.id || snapshot.adapterVersion !== operationalResourceAdapterDefinition.version) fail("ADAPTER_CONTRACT_INVALID", "Operational resource snapshot adapter identity is invalid");
  assertIsoTimestamp(snapshot.synchronizedAt, "Operational resource snapshot synchronizedAt");
  if (!SHA256.test(snapshot.checksum ?? "")) fail("ADAPTER_CHECKSUM_INVALID", "Operational resource snapshot checksum is invalid");
  assertExact(snapshot.syncCursor, ["adapterId", "adapterVersion", "opaque", "sourceVersion", "checksum"], "Operational resource snapshot cursor");
  const { checksum: cursorChecksum, ...cursorContent } = snapshot.syncCursor;
  if (snapshot.syncCursor.adapterId !== snapshot.adapterId || snapshot.syncCursor.adapterVersion !== snapshot.adapterVersion || snapshot.syncCursor.sourceVersion !== snapshot.sourceVersion
    || !SHA256.test(cursorChecksum ?? "") || await sha256Checksum(cursorContent) !== cursorChecksum) fail("ADAPTER_CURSOR_INCOMPATIBLE", "Operational resource snapshot cursor is invalid");
  const { id, checksum, ...content } = snapshot;
  const actual = await sha256Checksum(content);
  if (checksum !== actual || id !== `operational-resource-snapshot-${checksum.slice(0, 16)}`) fail("ADAPTER_CHECKSUM_MISMATCH", "Operational resource snapshot checksum does not match its canonical content");
  assertExact(snapshot.privacy, ["personnelMode", "rawPersonnelIdentityStored", "contactDataStored"], "Operational resource privacy evidence");
  if (snapshot.privacy.personnelMode !== "opaque-reference" || snapshot.privacy.rawPersonnelIdentityStored !== false || snapshot.privacy.contactDataStored !== false) fail("ADAPTER_PERSONAL_DATA_REJECTED", "Operational resource privacy evidence is invalid");
  if (context.preparedInput !== undefined) {
    const expected = await createOperationalSnapshot(context.preparedInput, snapshot.synchronizedAt);
    if (expected.checksum !== snapshot.checksum) fail("ADAPTER_SOURCE_MISMATCH", "Operational resource snapshot is not bound to the prepared source and trusted Project context");
  } else {
    const reconstructed = normalizePreparedOperationalResourceInput({ sourceSystem: snapshot.sourceSystem, sourceVersion: snapshot.sourceVersion, nextCursor: snapshot.syncCursor.opaque, project: { projectId: snapshot.projectId, planVersion: snapshot.planVersion, planFingerprint: snapshot.planFingerprint, eventWindow: snapshot.eventWindow, currentReservationRef: snapshot.currentReservationRef }, resources: snapshot.resources, staffing: snapshot.staffing, demands: snapshot.demands });
    const reconciliation = await reconcileOperationalResources(reconstructed);
    if (JSON.stringify(reconciliation) !== JSON.stringify({ schemaVersion: snapshot.schemaVersion, status: snapshot.status, projectId: snapshot.projectId, planVersion: snapshot.planVersion, planFingerprint: snapshot.planFingerprint, eventWindow: snapshot.eventWindow, currentReservationRef: snapshot.currentReservationRef, resources: snapshot.resources, staffing: snapshot.staffing, demands: snapshot.demands, conflicts: snapshot.conflicts, substitutionOptions: snapshot.substitutionOptions, summary: snapshot.summary, privacy: snapshot.privacy })) fail("ADAPTER_RECONCILIATION_INVALID", "Operational resource snapshot reconciliation is invalid");
  }
  return true;
}

export const operationalResourceAdapter = Object.freeze({
  definition: operationalResourceAdapterDefinition,
  assertImportResult: assertOperationalResourceSnapshot,
  async prepareInput(capability, input, context) {
    return normalizeOperationalResourceAdapterInput(capability, input, context?.adapterContext);
  },
  async invoke(capability, input, context) {
    if (capability !== "import" && capability !== "synchronize") fail("ADAPTER_CAPABILITY_UNSUPPORTED", `Operational resource adapter does not support ${capability}`);
    await context.secrets.get("operational-resources/api-token");
    return createOperationalSnapshot(input, context.clock());
  },
});

export async function createOperationalSubstitutionStagingBatch({ snapshot, conflictId, optionId, acceptedPlan, proposalRevision, resolveLatestSnapshot }) {
  if (typeof resolveLatestSnapshot !== "function") fail("ADAPTER_SNAPSHOT_PROVENANCE_REQUIRED", "Operational substitution preview requires a trusted latest-snapshot resolver");
  const trustedSnapshot = await resolveLatestSnapshot({ adapterId: operationalResourceAdapterDefinition.id, projectId: snapshot?.projectId });
  if (!trustedSnapshot) fail("ADAPTER_SNAPSHOT_PROVENANCE_REQUIRED", "Trusted operational snapshot evidence was not found");
  await assertOperationalResourceSnapshot(trustedSnapshot, {});
  if (trustedSnapshot.id !== snapshot?.id || trustedSnapshot.checksum !== snapshot?.checksum) fail("ADAPTER_SOURCE_MISMATCH", "Operational resource snapshot is no longer the latest trusted Project evidence");
  await assertOperationalResourceSnapshot(snapshot, {});
  if (!conflictId || !optionId) fail("ADAPTER_SUBSTITUTION_SELECTION_REQUIRED", "Operational substitution requires an explicit conflict and option selection");
  if (!acceptedPlan || typeof acceptedPlan !== "object" || Array.isArray(acceptedPlan)) fail("ADAPTER_PROJECT_BINDING_REQUIRED", "Accepted Plan is required for operational substitution");
  const acceptedPlanFingerprint = PLAN_FINGERPRINT.test(snapshot.planFingerprint) ? fingerprintPlan(acceptedPlan) : await sha256Checksum(acceptedPlan);
  if (acceptedPlan.version !== snapshot.planVersion || acceptedPlanFingerprint !== snapshot.planFingerprint) fail("ADAPTER_BASE_PLAN_VERSION_CONFLICT", "Operational snapshot is stale for the accepted Plan");
  const conflict = snapshot.conflicts.find((item) => item.id === conflictId);
  const option = snapshot.substitutionOptions.find((item) => item.id === optionId && item.conflictId === conflictId);
  if (!conflict || !option || !conflict.substitutionOptionIds.includes(optionId)) fail("ADAPTER_SUBSTITUTION_INVALID", "Operational substitution option does not belong to the selected conflict");
  if (option.family === "staffing") fail("ADAPTER_ENTITY_TYPE_UNSUPPORTED", "Personnel substitutions require a privacy-preserving staffing assignment workflow");
  if (option.targetObjectIds.length !== 1) fail("ADAPTER_SUBSTITUTION_INVALID", "Minimal operational substitution requires exactly one target object");
  const demand = snapshot.demands.find((item) => item.demandId === option.demandId);
  const replacement = snapshot.resources.find((item) => item.resourceId === option.replacementResourceId);
  const object = acceptedPlan.objects?.find((item) => item.id === option.targetObjectIds[0]);
  if (!demand || !replacement || !object || await sha256Checksum(object) !== demand.baseObjectChecksum) fail("ADAPTER_SUBSTITUTION_STALE", "Operational substitution target no longer matches its accepted object evidence");
  if (object.resourceBinding?.resourceId !== conflict.resourceId) fail("ADAPTER_SUBSTITUTION_STALE", "Operational substitution target is not bound to the conflicted resource");
  if (object.resourceBinding.kind !== demand.family || object.resourceBinding.quantity !== demand.quantity) fail("ADAPTER_SUBSTITUTION_STALE", "Operational substitution target binding no longer matches the demanded family and quantity");
  const binding = replacement.capability.templateRef;
  if (!binding || object.templateRef?.kind !== "inventory-item-template" || object.templateRef.templateId !== binding.templateId || object.templateRef.version !== binding.version) fail("ADAPTER_SUBSTITUTION_INVALID", "Minimal operational substitution must retain the exact Inventory Item Template binding");
  const changeChecksum = await sha256Checksum({ snapshotChecksum: snapshot.checksum, conflictId, optionId, objectId: object.id, replacementResourceId: replacement.resourceId });
  return createAdapterStagingBatch(operationalResourceAdapterDefinition, {
    sourceSystem: snapshot.sourceSystem,
    sourceVersion: snapshot.sourceVersion,
    synchronizedAt: snapshot.synchronizedAt,
    syncCursor: snapshot.syncCursor,
    changes: [{
      id: `change-resource-substitution-${changeChecksum.slice(0, 16)}`,
      operation: "update",
      venueEntityType: "project-object-instance",
      venueObjectId: object.id,
      external: { adapterId: operationalResourceAdapterDefinition.id, sourceSystem: snapshot.sourceSystem, entityType: `${replacement.family}-resource`, externalId: replacement.source.externalId, sourceVersion: replacement.source.sourceVersion, checksum: replacement.source.checksum },
      values: { resourceBinding: { schemaVersion: 1, kind: replacement.family, resourceId: replacement.resourceId, quantity: demand.quantity } },
      baseChecksum: demand.baseObjectChecksum,
      evidence: { kind: "operational-resource-substitution", sourceId: snapshot.id, sourceChecksum: snapshot.checksum, references: [conflict.id, option.id].sort(compare) },
    }],
    mappings: [
      { venueEntityType: "project", venueObjectId: snapshot.projectId, external: { adapterId: operationalResourceAdapterDefinition.id, sourceSystem: snapshot.sourceSystem, entityType: "operational-resource-snapshot", externalId: snapshot.id, sourceVersion: snapshot.sourceVersion, checksum: snapshot.checksum } },
      { venueEntityType: "project-object-instance", venueObjectId: object.id, external: { adapterId: operationalResourceAdapterDefinition.id, sourceSystem: snapshot.sourceSystem, entityType: `${replacement.family}-resource`, externalId: replacement.source.externalId, sourceVersion: replacement.source.sourceVersion, checksum: replacement.source.checksum } },
    ],
    warnings: [],
  }, { basePlanVersion: snapshot.planVersion, proposalRevision });
}
