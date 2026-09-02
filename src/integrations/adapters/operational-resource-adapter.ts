import {
  AdapterContractError,
  assertIsoTimestamp,
  createSyncCursor,
  defineAdapter,
  sha256Checksum,
  type AdapterCapability,
  type SyncCursor,
} from "../contracts.ts";
import { createAdapterStagingBatch, type AdapterStagingBatch } from "../staging.ts";
import type { AdapterHandlerContext, VenueAdapter } from "../runtime.ts";
import { isNonContactLabel } from "../privacy.ts";
import { stableFingerprint } from "../../domain/activity-ledger.ts";
import {
  normalizePreparedOperationalResourceInput,
  reconcileOperationalResources,
} from "../../domain/operational-resources.ts";

const MAX_RECORDS = 1_000;
const MAX_COUNT = 1_000_000;
const IDENTIFIER = /^[a-z0-9][a-z0-9._:-]{0,159}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const PLAN_FINGERPRINT = /^plan-[0-9a-f]{8}$/;
const RESOURCE_ID = /^resource-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const STAFF_REF = /^staff-ref-[0-9a-f]{32}$/;
const FAMILIES = ["inventory", "av", "power", "catering", "staffing"] as const;
type ResourceFamily = (typeof FAMILIES)[number];
type ObjectResourceFamily = Exclude<ResourceFamily, "staffing">;
type AvailabilityStatus = "available" | "unavailable";
interface TemplateRef {
  readonly templateId: string;
  readonly version: string;
}
interface Booking {
  readonly bookingRef: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly quantity: number;
  readonly reservationRef: string;
}
interface TemplateMapping {
  readonly family: "inventory" | "av" | "catering";
  readonly externalId: string;
  readonly resourceId: string;
  readonly binding: Readonly<{ templateRef: TemplateRef }>;
}
interface PowerMapping {
  readonly family: "power";
  readonly externalId: string;
  readonly resourceId: string;
  readonly binding: Readonly<{ utilityObjectId: string; circuitId: string }>;
}
type ResourceMapping = TemplateMapping | PowerMapping;
interface RoleMapping {
  readonly externalId: string;
  readonly roleId: string;
}
interface ShiftMapping {
  readonly externalId: string;
  readonly shiftId: string;
}
interface PersonnelMapping {
  readonly externalPersonId: string;
  readonly staffRef: string;
  readonly resourceId: string;
}
interface ReservationMapping {
  readonly externalId: string;
  readonly reservationRef: string;
}
interface EventWindow {
  readonly startAt: string;
  readonly endAt: string;
}
interface ProjectContext {
  readonly projectId: string;
  readonly planVersion: string;
  readonly planFingerprint: string;
  readonly eventWindow: EventWindow;
  readonly currentReservationRef: string;
}
interface OperationalDemand {
  readonly demandId: string;
  readonly family: ResourceFamily;
  readonly resourceId: string;
  readonly quantity: number;
  readonly targetObjectIds: readonly string[];
  readonly baseObjectChecksum: string;
  readonly requirements: Readonly<Record<string, unknown>>;
}
interface TrustedContext {
  readonly project: ProjectContext;
  readonly resourceMappings: readonly ResourceMapping[];
  readonly roleMappings: readonly RoleMapping[];
  readonly shiftMappings: readonly ShiftMapping[];
  readonly personnelMappings: readonly PersonnelMapping[];
  readonly reservationMappings: readonly ReservationMapping[];
  readonly demands: readonly OperationalDemand[];
}
interface ResourceSource {
  readonly entityType: string;
  readonly externalId?: string;
  readonly sourceVersion: string;
  readonly checksum: string;
}
interface OperationalResource {
  readonly resourceId: string;
  readonly family: ResourceFamily;
  readonly status: AvailabilityStatus;
  readonly total: number;
  readonly unavailable: number;
  readonly bookings: readonly Booking[];
  readonly capability: Readonly<Record<string, unknown>>;
  readonly source: ResourceSource;
}
interface StaffingRole {
  readonly roleId: string;
  readonly availableHeadcount: number;
  readonly skills: readonly string[];
  readonly sourceChecksum: string;
}
interface StaffingShift {
  readonly shiftId: string;
  readonly startAt: string;
  readonly endAt: string;
  readonly sourceChecksum: string;
}
interface StaffingAssignment {
  readonly assignmentId: string;
  readonly staffRef: string;
  readonly roleId: string;
  readonly shiftId: string;
  readonly resourceId: string;
  readonly sourceChecksum: string;
}
interface PreparedOperationalInput {
  readonly sourceSystem: string;
  readonly sourceVersion: string;
  readonly nextCursor: string;
  readonly project: ProjectContext;
  readonly resources: readonly OperationalResource[];
  readonly staffing: Readonly<{
    roles: readonly StaffingRole[];
    shifts: readonly StaffingShift[];
    assignments: readonly StaffingAssignment[];
  }>;
  readonly demands: readonly OperationalDemand[];
}
interface Conflict {
  readonly id: string;
  readonly reason: string;
  readonly family: ResourceFamily;
  readonly demandId: string;
  readonly resourceId: string;
  readonly requiredQuantity: number;
  readonly availableQuantity: number;
  readonly targetObjectIds: readonly string[];
  readonly bookingRefs: readonly string[];
  readonly substitutionOptionIds: readonly string[];
  readonly severity: string;
}
interface SubstitutionOption {
  readonly id: string;
  readonly conflictId: string;
  readonly demandId: string;
  readonly replacementResourceId: string;
  readonly targetObjectIds: readonly string[];
  readonly quantity: number;
  readonly replacementSourceChecksum: string;
  readonly family: ResourceFamily;
  readonly requiresHumanApproval: boolean;
}
interface Reconciliation {
  readonly schemaVersion: 1;
  readonly status: string;
  readonly projectId: string;
  readonly planVersion: string;
  readonly planFingerprint: string;
  readonly eventWindow: EventWindow;
  readonly currentReservationRef: string;
  readonly resources: readonly OperationalResource[];
  readonly staffing: PreparedOperationalInput["staffing"];
  readonly demands: readonly OperationalDemand[];
  readonly conflicts: readonly Conflict[];
  readonly substitutionOptions: readonly SubstitutionOption[];
  readonly summary: Readonly<Record<string, number>>;
  readonly privacy: Readonly<{
    personnelMode: "opaque-reference";
    rawPersonnelIdentityStored: false;
    contactDataStored: false;
  }>;
}
interface OperationalSnapshot extends Reconciliation {
  readonly id: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceSystem: string;
  readonly sourceVersion: string;
  readonly synchronizedAt: string;
  readonly syncCursor: SyncCursor;
  readonly checksum: string;
}
interface AcceptedObject {
  readonly id: string;
  readonly kind?: string;
  readonly resourceBinding?: Readonly<{ resourceId: string; kind: string; quantity: number }>;
  readonly templateRef?: Readonly<{ kind: string; templateId: string; version: string }>;
  readonly [key: string]: unknown;
}
interface AcceptedPlan {
  readonly version: string;
  readonly objects: readonly AcceptedObject[];
  readonly [key: string]: unknown;
}
interface SnapshotAssertionContext {
  readonly preparedInput?: unknown;
}
interface SubstitutionRequest {
  readonly snapshot: unknown;
  readonly conflictId?: string;
  readonly optionId?: string;
  readonly acceptedPlan: unknown;
  readonly proposalRevision: number;
  readonly resolveLatestSnapshot?: (identity: Readonly<{ adapterId: string; projectId: string }>) => Promise<unknown>;
}

const clone = <Value>(value: Value): Value => structuredClone(value);
const compare = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);
const isResourceFamily = (value: unknown): value is ResourceFamily =>
  typeof value === "string" && FAMILIES.some((family) => family === value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isBooking = (value: unknown): value is Booking =>
  isRecord(value) &&
  typeof value["bookingRef"] === "string" &&
  typeof value["startAt"] === "string" &&
  typeof value["endAt"] === "string" &&
  typeof value["quantity"] === "number" &&
  typeof value["reservationRef"] === "string";
const isOperationalResource = (value: unknown): value is OperationalResource =>
  isRecord(value) &&
  typeof value["resourceId"] === "string" &&
  isResourceFamily(value["family"]) &&
  (value["status"] === "available" || value["status"] === "unavailable") &&
  typeof value["total"] === "number" &&
  typeof value["unavailable"] === "number" &&
  Array.isArray(value["bookings"]) &&
  value["bookings"].every(isBooking) &&
  isRecord(value["capability"]) &&
  isRecord(value["source"]) &&
  typeof value["source"]["entityType"] === "string" &&
  typeof value["source"]["sourceVersion"] === "string" &&
  typeof value["source"]["checksum"] === "string" &&
  (value["source"]["externalId"] === undefined || typeof value["source"]["externalId"] === "string");
const isDemand = (value: unknown): value is OperationalDemand =>
  isRecord(value) &&
  typeof value["demandId"] === "string" &&
  isResourceFamily(value["family"]) &&
  typeof value["resourceId"] === "string" &&
  typeof value["quantity"] === "number" &&
  Array.isArray(value["targetObjectIds"]) &&
  value["targetObjectIds"].every((item) => typeof item === "string") &&
  typeof value["baseObjectChecksum"] === "string" &&
  isRecord(value["requirements"]);
const isProjectContext = (value: unknown): value is ProjectContext =>
  isRecord(value) &&
  typeof value["projectId"] === "string" &&
  typeof value["planVersion"] === "string" &&
  typeof value["planFingerprint"] === "string" &&
  typeof value["currentReservationRef"] === "string" &&
  isRecord(value["eventWindow"]) &&
  typeof value["eventWindow"]["startAt"] === "string" &&
  typeof value["eventWindow"]["endAt"] === "string";
const isStaffing = (value: unknown): value is PreparedOperationalInput["staffing"] =>
  isRecord(value) &&
  Array.isArray(value["roles"]) &&
  Array.isArray(value["shifts"]) &&
  Array.isArray(value["assignments"]);
const isPreparedOperationalInput = (value: unknown): value is PreparedOperationalInput =>
  isRecord(value) &&
  typeof value["sourceSystem"] === "string" &&
  typeof value["sourceVersion"] === "string" &&
  typeof value["nextCursor"] === "string" &&
  isProjectContext(value["project"]) &&
  Array.isArray(value["resources"]) &&
  value["resources"].every(isOperationalResource) &&
  isStaffing(value["staffing"]) &&
  Array.isArray(value["demands"]) &&
  value["demands"].every(isDemand);
const isConflict = (value: unknown): value is Conflict =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["reason"] === "string" &&
  isResourceFamily(value["family"]) &&
  typeof value["demandId"] === "string" &&
  typeof value["resourceId"] === "string" &&
  typeof value["requiredQuantity"] === "number" &&
  typeof value["availableQuantity"] === "number" &&
  Array.isArray(value["targetObjectIds"]) &&
  value["targetObjectIds"].every((item) => typeof item === "string") &&
  Array.isArray(value["bookingRefs"]) &&
  value["bookingRefs"].every((item) => typeof item === "string") &&
  Array.isArray(value["substitutionOptionIds"]) &&
  value["substitutionOptionIds"].every((item) => typeof item === "string") &&
  typeof value["severity"] === "string";
const isSubstitutionOption = (value: unknown): value is SubstitutionOption =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["conflictId"] === "string" &&
  typeof value["demandId"] === "string" &&
  typeof value["replacementResourceId"] === "string" &&
  Array.isArray(value["targetObjectIds"]) &&
  value["targetObjectIds"].every((item) => typeof item === "string") &&
  typeof value["quantity"] === "number" &&
  typeof value["replacementSourceChecksum"] === "string" &&
  isResourceFamily(value["family"]) &&
  value["requiresHumanApproval"] === true;
const isReconciliation = (value: unknown): value is Reconciliation =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["status"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["planVersion"] === "string" &&
  typeof value["planFingerprint"] === "string" &&
  isRecord(value["eventWindow"]) &&
  typeof value["eventWindow"]["startAt"] === "string" &&
  typeof value["eventWindow"]["endAt"] === "string" &&
  typeof value["currentReservationRef"] === "string" &&
  Array.isArray(value["resources"]) &&
  value["resources"].every(isOperationalResource) &&
  isStaffing(value["staffing"]) &&
  Array.isArray(value["demands"]) &&
  value["demands"].every(isDemand) &&
  Array.isArray(value["conflicts"]) &&
  value["conflicts"].every(isConflict) &&
  Array.isArray(value["substitutionOptions"]) &&
  value["substitutionOptions"].every(isSubstitutionOption) &&
  isRecord(value["summary"]) &&
  isRecord(value["privacy"]);
const isSyncCursor = (value: unknown): value is SyncCursor =>
  isRecord(value) &&
  typeof value["adapterId"] === "string" &&
  typeof value["adapterVersion"] === "string" &&
  typeof value["opaque"] === "string" &&
  typeof value["sourceVersion"] === "string" &&
  typeof value["checksum"] === "string";
const isOperationalSnapshot = (value: unknown): value is OperationalSnapshot =>
  isRecord(value) &&
  typeof value["id"] === "string" &&
  typeof value["adapterId"] === "string" &&
  typeof value["adapterVersion"] === "string" &&
  typeof value["sourceSystem"] === "string" &&
  typeof value["sourceVersion"] === "string" &&
  typeof value["synchronizedAt"] === "string" &&
  isSyncCursor(value["syncCursor"]) &&
  typeof value["checksum"] === "string" &&
  isReconciliation(value);
const isAcceptedObject = (value: unknown): value is AcceptedObject => {
  if (!isRecord(value) || typeof value["id"] !== "string") return false;
  const resourceBinding = value["resourceBinding"];
  if (
    resourceBinding !== undefined &&
    (!isRecord(resourceBinding) ||
      typeof resourceBinding["resourceId"] !== "string" ||
      typeof resourceBinding["kind"] !== "string" ||
      typeof resourceBinding["quantity"] !== "number")
  )
    return false;
  const templateRef = value["templateRef"];
  return (
    templateRef === undefined ||
    (isRecord(templateRef) &&
      typeof templateRef["kind"] === "string" &&
      typeof templateRef["templateId"] === "string" &&
      typeof templateRef["version"] === "string")
  );
};
const isAcceptedPlan = (value: unknown): value is AcceptedPlan =>
  isRecord(value) &&
  typeof value["version"] === "string" &&
  Array.isArray(value["objects"]) &&
  value["objects"].every(isAcceptedObject);
const templateRefFrom = (value: Readonly<Record<string, unknown>>): TemplateRef | null => {
  const templateRef = value["templateRef"];
  return isRecord(templateRef) &&
    typeof templateRef["templateId"] === "string" &&
    typeof templateRef["version"] === "string"
    ? { templateId: templateRef["templateId"], version: templateRef["version"] }
    : null;
};

const normalizePrepared = (value: unknown): PreparedOperationalInput => {
  const normalized: unknown = normalizePreparedOperationalResourceInput(value);
  if (!isPreparedOperationalInput(normalized))
    return fail("ADAPTER_CONTRACT_INVALID", "Prepared operational-resource input is invalid");
  return normalized;
};

const reconcilePrepared = async (input: PreparedOperationalInput): Promise<Reconciliation> => {
  const reconciled: unknown = await reconcileOperationalResources(input);
  if (!isReconciliation(reconciled))
    return fail("ADAPTER_RECONCILIATION_INVALID", "Operational resource reconciliation is invalid");
  return reconciled;
};

const fail = (code: string, message: string, details: Readonly<Record<string, unknown>> = {}): never => {
  throw new AdapterContractError(code, message, details);
};

function assertObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("ADAPTER_SOURCE_INVALID", `${label} must be an object`);
}

function assertExact(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  assertObject(value, label);
  const unknown = Object.keys(value).filter((key) => !keys.includes(key));
  if (unknown.length)
    fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", `${label} contains unknown fields`, { fieldCount: unknown.length });
}

const identifier = (value: unknown, label: string): string => {
  if (typeof value !== "string")
    return fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded opaque non-contact identifier`);
  if (!IDENTIFIER.test(value) || !isNonContactLabel(value))
    return fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded opaque non-contact identifier`);
  return value;
};

const boundedString = (value: unknown, label: string): string => {
  if (typeof value !== "string") return fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded non-contact string`);
  if (value.length === 0 || value.length > 200 || !isNonContactLabel(value))
    return fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded non-contact string`);
  return value;
};

const count = (value: unknown, label: string, { positive = false }: Readonly<{ positive?: boolean }> = {}): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < (positive ? 1 : 0) || value > MAX_COUNT)
    return fail("ADAPTER_SOURCE_INVALID", `${label} must be a bounded integer`);
  return value;
};

const finite = (value: unknown, label: string, { positive = false }: Readonly<{ positive?: boolean }> = {}): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < (positive ? Number.EPSILON : 0))
    return fail("ADAPTER_SOURCE_INVALID", `${label} must be a non-negative finite number`);
  return value;
};

const records = (value: unknown, label: string): readonly unknown[] => {
  if (!Array.isArray(value) || value.length > MAX_RECORDS)
    return fail("ADAPTER_SOURCE_INVALID", `${label} must contain at most ${MAX_RECORDS} records`);
  return value;
};

const normalizeSourceBooking = (value: unknown, lookup: ReadonlyMap<string, string>): Booking => {
  assertExact(
    value,
    ["externalId", "startAt", "endAt", "quantity", "reservationExternalId"],
    "Operational source booking",
  );
  const startAt = assertIsoTimestamp(value.startAt, "Operational source booking startAt");
  const endAt = assertIsoTimestamp(value.endAt, "Operational source booking endAt");
  if (Date.parse(endAt) <= Date.parse(startAt))
    fail("ADAPTER_SOURCE_INVALID", "Operational source booking requires an increasing time window");
  const reservation = lookup.get(identifier(value.reservationExternalId, "Operational reservation external ID"));
  if (!reservation)
    return fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational booking has no trusted reservation mapping");
  return {
    bookingRef: identifier(value.externalId, "Operational booking external ID"),
    startAt,
    endAt,
    quantity: count(value.quantity, "Operational booking quantity", { positive: true }),
    reservationRef: reservation,
  };
};

const normalizeTemplateBinding = (value: unknown, label: string): TemplateRef => {
  assertExact(value, ["templateId", "version"], label);
  return {
    templateId: identifier(value.templateId, `${label} templateId`),
    version: boundedString(value.version, `${label} version`),
  };
};

const normalizeMapping = (mapping: unknown): ResourceMapping => {
  assertExact(mapping, ["family", "externalId", "resourceId", "binding"], "Operational resource mapping");
  const family = mapping.family;
  if (!isResourceFamily(family) || family === "staffing")
    return fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational resource mapping family is invalid");
  assertObject(mapping.binding, "Operational resource mapping binding");
  if (family === "inventory" || family === "av" || family === "catering") {
    assertExact(mapping.binding, ["templateRef"], "Operational template resource binding");
    return {
      family,
      externalId: identifier(mapping.externalId, "Operational resource externalId"),
      resourceId: identifier(mapping.resourceId, "Operational resourceId"),
      binding: { templateRef: normalizeTemplateBinding(mapping.binding.templateRef, "Operational template binding") },
    };
  }
  assertExact(mapping.binding, ["utilityObjectId", "circuitId"], "Operational power binding");
  return {
    family,
    externalId: identifier(mapping.externalId, "Operational resource externalId"),
    resourceId: identifier(mapping.resourceId, "Operational resourceId"),
    binding: {
      utilityObjectId: identifier(mapping.binding.utilityObjectId, "Operational utilityObjectId"),
      circuitId: identifier(mapping.binding.circuitId, "Operational circuitId"),
    },
  };
};

const normalizeCommonResource = async (
  record: unknown,
  family: ObjectResourceFamily,
  mapping: ResourceMapping,
  reservationLookup: ReadonlyMap<string, string>,
): Promise<OperationalResource> => {
  assertObject(record, `Operational ${family} record`);
  const common = ["externalId", "sourceVersion", "status", "total", "unavailable", "bookings"];
  const extra =
    family === "av"
      ? ["equipmentType", "powerWatts", "voltage", "connector"]
      : family === "power"
        ? ["voltage", "maxWatts", "connectors"]
        : family === "catering"
          ? ["type", "servers", "serviceRatePerServerMinute", "queueCapacityPersons", "accessibleServicePoint"]
          : [];
  assertExact(record, [...common, ...extra], `Operational ${family} record`);
  const total = count(record.total, `Operational ${family} total`, { positive: true });
  const unavailable = count(record.unavailable, `Operational ${family} unavailable`);
  const status = record.status;
  if (unavailable > total || (status !== "available" && status !== "unavailable"))
    return fail("ADAPTER_SOURCE_INVALID", `Operational ${family} availability is invalid`);
  const bookings = records(record.bookings, `Operational ${family} bookings`)
    .map((item) => normalizeSourceBooking(item, reservationLookup))
    .sort((left, right) => compare(left.startAt, right.startAt) || compare(left.bookingRef, right.bookingRef));
  let capability: Readonly<Record<string, unknown>>;
  if (family === "inventory") {
    if (!("templateRef" in mapping.binding))
      return fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational inventory mapping requires a template binding");
    capability = { templateRef: mapping.binding.templateRef };
  } else if (family === "av") {
    if (!("templateRef" in mapping.binding))
      return fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational AV mapping requires a template binding");
    capability = {
      templateRef: mapping.binding.templateRef,
      equipmentType: identifier(record["equipmentType"], "Operational AV equipmentType"),
      powerWatts: finite(record["powerWatts"], "Operational AV powerWatts"),
      voltage: finite(record["voltage"], "Operational AV voltage", { positive: true }),
      connector: boundedString(record["connector"], "Operational AV connector"),
    };
  } else if (family === "power") {
    const connectors = record["connectors"];
    if (!Array.isArray(connectors) || connectors.length === 0 || connectors.length > 20)
      return fail("ADAPTER_SOURCE_INVALID", "Operational power connectors must be bounded");
    if (!("utilityObjectId" in mapping.binding))
      return fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational power mapping requires a utility binding");
    capability = {
      utilityObjectId: mapping.binding.utilityObjectId,
      circuitId: mapping.binding.circuitId,
      voltage: finite(record["voltage"], "Operational power voltage", { positive: true }),
      maxWatts: finite(record["maxWatts"], "Operational power maxWatts", { positive: true }),
      connectors: [...new Set(connectors.map((item) => boundedString(item, "Operational power connector")))].sort(
        compare,
      ),
    };
  } else {
    if (typeof record.accessibleServicePoint !== "boolean")
      fail("ADAPTER_SOURCE_INVALID", "Operational catering accessibleServicePoint must be boolean");
    if (!("templateRef" in mapping.binding))
      return fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational catering mapping requires a template binding");
    capability = {
      templateRef: mapping.binding.templateRef,
      type: identifier(record["type"], "Operational catering type"),
      servers: count(record["servers"], "Operational catering servers", { positive: true }),
      serviceRatePerServerMinute: finite(record["serviceRatePerServerMinute"], "Operational catering service rate", {
        positive: true,
      }),
      queueCapacityPersons: count(record["queueCapacityPersons"], "Operational catering queue capacity"),
      accessibleServicePoint: record["accessibleServicePoint"],
    };
  }
  const externalId = identifier(record.externalId, `Operational ${family} externalId`);
  const sourceVersion = boundedString(record.sourceVersion, `Operational ${family} sourceVersion`);
  const sourceRecord = {
    externalId,
    sourceVersion,
    status,
    total,
    unavailable,
    bookings,
    ...Object.fromEntries(extra.map((field) => [field, capability[field]])),
  };
  return {
    resourceId: mapping.resourceId,
    family,
    status,
    total,
    unavailable,
    bookings,
    capability,
    source: {
      entityType: `${family}-resource`,
      externalId,
      sourceVersion,
      checksum: await sha256Checksum(sourceRecord),
    },
  };
};

const mapByExternal = <Item extends Readonly<{ externalId: string }>, Key extends keyof Item>(
  items: readonly Item[],
  label: string,
  valueKey: Key,
): Map<string, Item[Key]> => {
  const result = new Map<string, Item[Key]>();
  for (const item of items) {
    if (result.has(item.externalId)) fail("ADAPTER_RESOURCE_MAPPING_INVALID", `${label} external IDs must be unique`);
    result.set(item.externalId, item[valueKey]);
  }
  return result;
};

const normalizeTrustedContext = (value: unknown): TrustedContext => {
  assertExact(
    value,
    [
      "project",
      "resourceMappings",
      "roleMappings",
      "shiftMappings",
      "personnelMappings",
      "reservationMappings",
      "demands",
    ],
    "Trusted operational-resource context",
  );
  assertExact(
    value.project,
    ["projectId", "planVersion", "planFingerprint", "eventWindow", "currentReservationRef"],
    "Trusted operational Project context",
  );
  assertExact(value.project.eventWindow, ["startAt", "endAt"], "Trusted operational event window");
  const trustedStartAt = assertIsoTimestamp(value.project.eventWindow.startAt, "Trusted operational event startAt");
  const trustedEndAt = assertIsoTimestamp(value.project.eventWindow.endAt, "Trusted operational event endAt");
  const trustedFingerprint = value.project.planFingerprint;
  if (
    typeof trustedFingerprint !== "string" ||
    (!PLAN_FINGERPRINT.test(trustedFingerprint) && !SHA256.test(trustedFingerprint)) ||
    Date.parse(trustedEndAt) <= Date.parse(trustedStartAt)
  )
    fail("ADAPTER_SOURCE_INVALID", "Trusted operational Project evidence is invalid");
  const resourceMappings = records(value.resourceMappings, "Trusted operational resource mappings")
    .map(normalizeMapping)
    .sort((left, right) => compare(left.family, right.family) || compare(left.externalId, right.externalId));
  const roleMappings = records(value.roleMappings, "Trusted operational role mappings")
    .map((item) => {
      assertExact(item, ["externalId", "roleId"], "Trusted role mapping");
      return {
        externalId: identifier(item.externalId, "Trusted role externalId"),
        roleId: identifier(item.roleId, "Trusted roleId"),
      };
    })
    .sort((left, right) => compare(left.externalId, right.externalId));
  const shiftMappings = records(value.shiftMappings, "Trusted operational shift mappings")
    .map((item) => {
      assertExact(item, ["externalId", "shiftId"], "Trusted shift mapping");
      return {
        externalId: identifier(item.externalId, "Trusted shift externalId"),
        shiftId: identifier(item.shiftId, "Trusted shiftId"),
      };
    })
    .sort((left, right) => compare(left.externalId, right.externalId));
  const personnelMappings = records(value.personnelMappings, "Trusted personnel mappings")
    .map((item) => {
      assertExact(item, ["externalPersonId", "staffRef", "resourceId"], "Trusted personnel mapping");
      return {
        externalPersonId: identifier(item.externalPersonId, "Trusted external personnel ID"),
        staffRef: identifier(item.staffRef, "Trusted staffRef"),
        resourceId: identifier(item.resourceId, "Trusted staff resourceId"),
      };
    })
    .sort((left, right) => compare(left.externalPersonId, right.externalPersonId));
  const reservationMappings = records(value.reservationMappings, "Trusted reservation mappings")
    .map((item) => {
      assertExact(item, ["externalId", "reservationRef"], "Trusted reservation mapping");
      return {
        externalId: identifier(item.externalId, "Trusted reservation externalId"),
        reservationRef: identifier(item.reservationRef, "Trusted reservationRef"),
      };
    })
    .sort((left, right) => compare(left.externalId, right.externalId));
  const demands = records(value.demands, "Trusted operational demands").map((demand, index): OperationalDemand => {
    assertExact(
      demand,
      ["demandId", "family", "resourceId", "quantity", "targetObjectIds", "requirements", "baseObjectChecksum"],
      `Trusted operational demand ${index + 1}`,
    );
    const family = demand["family"];
    if (!isResourceFamily(family))
      return fail("ADAPTER_SOURCE_INVALID", `Trusted operational demand ${index + 1} family is invalid`);
    const targetObjectIds = records(
      demand["targetObjectIds"],
      `Trusted operational demand ${index + 1} targetObjectIds`,
    ).map((item) => identifier(item, "Trusted demand targetObjectId"));
    assertObject(demand["requirements"], `Trusted operational demand ${index + 1} requirements`);
    return {
      demandId: identifier(demand["demandId"], "Trusted demandId"),
      family,
      resourceId: identifier(demand["resourceId"], "Trusted demand resourceId"),
      quantity: count(demand["quantity"], "Trusted demand quantity", { positive: true }),
      targetObjectIds,
      requirements: clone(demand["requirements"]),
      baseObjectChecksum: boundedString(demand["baseObjectChecksum"], "Trusted demand baseObjectChecksum"),
    };
  });
  const demandTargetObjectIds = demands.flatMap((demand, index) => {
    if (!Array.isArray(demand.targetObjectIds))
      fail("ADAPTER_SOURCE_INVALID", `Trusted operational demand ${index + 1} targetObjectIds must be an array`);
    return demand.targetObjectIds.map((item) => identifier(item, "Trusted demand targetObjectId"));
  });
  if (
    new Set(resourceMappings.map((item) => `${item.family}\u0000${item.externalId}`)).size !==
      resourceMappings.length ||
    new Set(resourceMappings.map((item) => item.resourceId)).size !== resourceMappings.length ||
    new Set(roleMappings.map((item) => item.externalId)).size !== roleMappings.length ||
    new Set(roleMappings.map((item) => item.roleId)).size !== roleMappings.length ||
    new Set(shiftMappings.map((item) => item.externalId)).size !== shiftMappings.length ||
    new Set(shiftMappings.map((item) => item.shiftId)).size !== shiftMappings.length ||
    new Set(personnelMappings.map((item) => item.externalPersonId)).size !== personnelMappings.length ||
    new Set(personnelMappings.map((item) => item.staffRef)).size !== personnelMappings.length ||
    new Set(personnelMappings.map((item) => item.resourceId)).size !== personnelMappings.length ||
    new Set(reservationMappings.map((item) => item.externalId)).size !== reservationMappings.length ||
    new Set(reservationMappings.map((item) => item.reservationRef)).size !== reservationMappings.length
  ) {
    fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Trusted operational mappings must be one-to-one");
  }
  if (
    resourceMappings.some((item) => !RESOURCE_ID.test(item.resourceId)) ||
    personnelMappings.some((item) => !RESOURCE_ID.test(item.resourceId) || !STAFF_REF.test(item.staffRef))
  )
    fail(
      "ADAPTER_ID_BOUNDARY_VIOLATION",
      "Operational mappings require server-owned Resource and opaque StaffRef namespaces",
    );
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
    ...resourceMappings.flatMap((item) =>
      item.family === "power"
        ? [item.resourceId, item.binding.utilityObjectId, item.binding.circuitId]
        : [item.resourceId, item.binding.templateRef.templateId],
    ),
    ...roleMappings.map((item) => item.roleId),
    ...shiftMappings.map((item) => item.shiftId),
    ...personnelMappings.flatMap((item) => [item.staffRef, item.resourceId]),
    ...reservationMappings.map((item) => item.reservationRef),
    ...demandTargetObjectIds,
  ]);
  if ([...externalIds].some((id) => stableIds.has(id)))
    fail(
      "ADAPTER_ID_BOUNDARY_VIOLATION",
      "External operational IDs must remain globally separate from VenueMind stable IDs",
    );
  const planFingerprint = boundedString(value.project.planFingerprint, "Trusted planFingerprint");
  const eventStartAt = assertIsoTimestamp(value.project.eventWindow.startAt, "Trusted operational event startAt");
  const eventEndAt = assertIsoTimestamp(value.project.eventWindow.endAt, "Trusted operational event endAt");
  return {
    project: {
      projectId: identifier(value.project.projectId, "Trusted projectId"),
      planVersion: boundedString(value.project.planVersion, "Trusted planVersion"),
      planFingerprint,
      eventWindow: { startAt: eventStartAt, endAt: eventEndAt },
      currentReservationRef: identifier(value.project.currentReservationRef, "Trusted currentReservationRef"),
    },
    resourceMappings,
    roleMappings,
    shiftMappings,
    personnelMappings,
    reservationMappings,
    demands,
  };
};

export async function normalizeOperationalResourceAdapterInput(
  capability: AdapterCapability,
  input: unknown,
  trustedContext: unknown,
): Promise<PreparedOperationalInput> {
  if (capability !== "import" && capability !== "synchronize")
    fail("ADAPTER_CAPABILITY_UNSUPPORTED", `Operational resource adapter does not support ${capability}`);
  assertExact(
    input,
    [
      "sourceSystem",
      "sourceVersion",
      "nextCursor",
      "inventory",
      "avEquipment",
      "powerCircuits",
      "cateringStations",
      "staffing",
    ],
    "Operational resource source input",
  );
  assertExact(input.staffing, ["roles", "shifts", "assignments"], "Operational source staffing");
  const trusted = normalizeTrustedContext(trustedContext);
  const reservationLookup = mapByExternal(trusted.reservationMappings, "Reservation mappings", "reservationRef");
  const mappingLookup = new Map(
    trusted.resourceMappings.map((item) => [`${item.family}\u0000${item.externalId}`, item]),
  );
  const normalizedResources: OperationalResource[] = [];
  const collections: readonly (readonly [ObjectResourceFamily, unknown])[] = [
    ["inventory", input.inventory],
    ["av", input.avEquipment],
    ["power", input.powerCircuits],
    ["catering", input.cateringStations],
  ];
  for (const [family, collection] of collections) {
    for (const record of records(collection, `Operational ${family} records`)) {
      assertObject(record, `Operational ${family} record`);
      const externalId = identifier(record.externalId, `Operational ${family} externalId`);
      const mapping = mappingLookup.get(`${family}\u0000${externalId}`);
      if (!mapping)
        return fail("ADAPTER_RESOURCE_MAPPING_INVALID", `Operational ${family} record has no trusted mapping`);
      normalizedResources.push(await normalizeCommonResource(record, family, mapping, reservationLookup));
    }
  }
  const roleLookup = mapByExternal(trusted.roleMappings, "Role mappings", "roleId");
  const shiftLookup = mapByExternal(trusted.shiftMappings, "Shift mappings", "shiftId");
  const personLookup = new Map(trusted.personnelMappings.map((item) => [item.externalPersonId, item]));
  const roles: StaffingRole[] = [];
  for (const role of records(input.staffing.roles, "Operational staffing roles")) {
    assertExact(
      role,
      ["externalId", "sourceVersion", "availableHeadcount", "skills"],
      "Operational source staffing role",
    );
    const roleId = roleLookup.get(identifier(role.externalId, "Operational source role externalId"));
    if (!roleId) return fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational staffing role has no trusted mapping");
    if (!Array.isArray(role.skills) || role.skills.length > 50)
      return fail("ADAPTER_SOURCE_INVALID", "Operational staffing role skills must be bounded");
    const skills = [...new Set(role.skills.map((item) => identifier(item, "Operational staffing skill")))].sort(
      compare,
    );
    const sourceEvidence = {
      externalId: identifier(role.externalId, "Operational source role externalId"),
      sourceVersion: boundedString(role.sourceVersion, "Operational staffing role sourceVersion"),
      availableHeadcount: count(role.availableHeadcount, "Operational staffing availableHeadcount"),
      skills,
    };
    roles.push({
      roleId,
      availableHeadcount: sourceEvidence.availableHeadcount,
      skills,
      sourceChecksum: await sha256Checksum(sourceEvidence),
    });
  }
  const shifts: StaffingShift[] = [];
  for (const shift of records(input.staffing.shifts, "Operational staffing shifts")) {
    assertExact(shift, ["externalId", "sourceVersion", "startAt", "endAt"], "Operational source staffing shift");
    const shiftId = shiftLookup.get(identifier(shift.externalId, "Operational source shift externalId"));
    if (!shiftId) return fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational staffing shift has no trusted mapping");
    const startAt = assertIsoTimestamp(shift.startAt, "Operational staffing shift startAt");
    const endAt = assertIsoTimestamp(shift.endAt, "Operational staffing shift endAt");
    if (Date.parse(endAt) <= Date.parse(startAt))
      fail("ADAPTER_SOURCE_INVALID", "Operational staffing shift requires an increasing time window");
    const sourceEvidence = {
      externalId: identifier(shift.externalId, "Operational source shift externalId"),
      sourceVersion: boundedString(shift.sourceVersion, "Operational staffing shift sourceVersion"),
      startAt,
      endAt,
    };
    shifts.push({ shiftId, startAt, endAt, sourceChecksum: await sha256Checksum(sourceEvidence) });
  }
  const assignments: StaffingAssignment[] = [];
  interface StaffingDraft {
    readonly resourceId: string;
    readonly staffRef: string;
    readonly sourceVersions: Set<string>;
    readonly sourceChecksums: Set<string>;
    readonly assignments: Map<
      string,
      Readonly<{ roleId: string; shiftId: string; status: AvailabilityStatus; bookings: readonly Booking[] }>
    >;
    readonly bookings: Map<string, Booking>;
  }
  const staffResourceDrafts = new Map<string, StaffingDraft>();
  for (const assignment of records(input.staffing.assignments, "Operational staffing assignments")) {
    assertExact(
      assignment,
      ["externalPersonId", "sourceVersion", "roleExternalId", "shiftExternalId", "status", "bookings"],
      "Operational source staffing assignment",
    );
    const person = personLookup.get(identifier(assignment.externalPersonId, "Operational source personnel ID"));
    const roleId = roleLookup.get(identifier(assignment.roleExternalId, "Operational source assignment role ID"));
    const shiftId = shiftLookup.get(identifier(assignment.shiftExternalId, "Operational source assignment shift ID"));
    if (!person)
      return fail(
        "ADAPTER_RESOURCE_MAPPING_INVALID",
        "Operational staffing assignment has no trusted personnel mapping",
      );
    if (!roleId)
      return fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational staffing assignment has no trusted role mapping");
    if (!shiftId)
      return fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Operational staffing assignment has no trusted shift mapping");
    const assignmentStatus = assignment.status;
    if (assignmentStatus !== "available" && assignmentStatus !== "unavailable")
      return fail("ADAPTER_SOURCE_INVALID", "Operational staffing assignment status is invalid");
    const bookings = records(assignment.bookings, "Operational staffing assignment bookings")
      .map((item) => normalizeSourceBooking(item, reservationLookup))
      .sort((left, right) => compare(left.startAt, right.startAt) || compare(left.bookingRef, right.bookingRef));
    const sourceChecksum = await sha256Checksum({
      staffRef: person.staffRef,
      sourceVersion: boundedString(assignment.sourceVersion, "Operational staffing assignment sourceVersion"),
      roleId,
      shiftId,
      status: assignment.status,
      bookings,
    });
    const assignmentId = `staff-assignment-${(await sha256Checksum({ staffRef: person.staffRef, roleId, shiftId, sourceChecksum })).slice(0, 16)}`;
    assignments.push({
      assignmentId,
      staffRef: person.staffRef,
      roleId,
      shiftId,
      resourceId: person.resourceId,
      sourceChecksum,
    });
    const draft = staffResourceDrafts.get(person.resourceId) ?? {
      resourceId: person.resourceId,
      staffRef: person.staffRef,
      sourceVersions: new Set<string>(),
      sourceChecksums: new Set<string>(),
      assignments: new Map<
        string,
        Readonly<{ roleId: string; shiftId: string; status: AvailabilityStatus; bookings: readonly Booking[] }>
      >(),
      bookings: new Map<string, Booking>(),
    };
    if (draft.staffRef !== person.staffRef)
      fail("ADAPTER_RESOURCE_MAPPING_INVALID", "Trusted personnel resource mapping is inconsistent");
    const assignmentKey = `${roleId}\u0000${shiftId}`;
    if (draft.assignments.has(assignmentKey))
      fail("ADAPTER_SOURCE_INVALID", "Operational staffing assignments must be unique per personnel, role, and shift");
    draft.sourceVersions.add(boundedString(assignment.sourceVersion, "Operational staffing assignment sourceVersion"));
    draft.sourceChecksums.add(sourceChecksum);
    draft.assignments.set(assignmentKey, { roleId, shiftId, status: assignmentStatus, bookings });
    for (const item of bookings) {
      const existing = draft.bookings.get(item.bookingRef);
      if (existing && JSON.stringify(existing) !== JSON.stringify(item))
        fail("ADAPTER_SOURCE_INVALID", "Operational staffing booking reference has inconsistent content");
      draft.bookings.set(item.bookingRef, item);
    }
    staffResourceDrafts.set(person.resourceId, draft);
  }
  for (const draft of [...staffResourceDrafts.values()].sort((left, right) =>
    compare(left.resourceId, right.resourceId),
  )) {
    const sourceVersions = [...draft.sourceVersions].sort(compare);
    const sourceChecksums = [...draft.sourceChecksums].sort(compare);
    const normalizedAssignments = [...draft.assignments.values()].sort(
      (left, right) => compare(left.roleId, right.roleId) || compare(left.shiftId, right.shiftId),
    );
    const allUnavailable = normalizedAssignments.every((item) => item.status === "unavailable");
    normalizedResources.push({
      resourceId: draft.resourceId,
      family: "staffing",
      status: allUnavailable ? "unavailable" : "available",
      total: 1,
      unavailable: allUnavailable ? 1 : 0,
      bookings: [...draft.bookings.values()].sort(
        (left, right) => compare(left.startAt, right.startAt) || compare(left.bookingRef, right.bookingRef),
      ),
      capability: { assignments: normalizedAssignments },
      source: {
        entityType: "staff-assignment",
        sourceVersion: boundedString(input.sourceVersion, "Operational staffing sourceVersion"),
        checksum: await sha256Checksum({ staffRef: draft.staffRef, sourceVersions, sourceChecksums }),
      },
    });
  }
  return normalizePrepared({
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
  retryPolicy: {
    maxAttempts: 4,
    initialDelayMs: 100,
    maximumDelayMs: 800,
    multiplier: 2,
    retryableCodes: ["ADAPTER_NETWORK_ERROR", "ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"],
  },
  rateLimit: { requests: 30, windowMs: 60_000 },
});

const createOperationalSnapshot = async (
  inputValue: unknown,
  synchronizedAtValue: unknown,
): Promise<Readonly<OperationalSnapshot>> => {
  const input = normalizePrepared(inputValue);
  const synchronizedAt = assertIsoTimestamp(synchronizedAtValue, "Operational resource synchronizedAt");
  const reconciliation = await reconcilePrepared(input);
  const syncCursor = await createSyncCursor(operationalResourceAdapterDefinition, {
    opaque: input.nextCursor,
    sourceVersion: input.sourceVersion,
  });
  const content = {
    adapterId: operationalResourceAdapterDefinition.id,
    adapterVersion: operationalResourceAdapterDefinition.version,
    sourceSystem: input.sourceSystem,
    sourceVersion: input.sourceVersion,
    synchronizedAt,
    syncCursor,
    ...reconciliation,
  };
  const checksum = await sha256Checksum(content);
  return Object.freeze({ id: `operational-resource-snapshot-${checksum.slice(0, 16)}`, ...content, checksum });
};

const SNAPSHOT_KEYS = [
  "id",
  "schemaVersion",
  "adapterId",
  "adapterVersion",
  "sourceSystem",
  "sourceVersion",
  "synchronizedAt",
  "syncCursor",
  "status",
  "projectId",
  "planVersion",
  "planFingerprint",
  "eventWindow",
  "currentReservationRef",
  "resources",
  "staffing",
  "demands",
  "conflicts",
  "substitutionOptions",
  "summary",
  "privacy",
  "checksum",
];

export async function assertOperationalResourceSnapshot(
  snapshot: unknown,
  context: SnapshotAssertionContext = {},
): Promise<true> {
  if (!isOperationalSnapshot(snapshot))
    return fail("ADAPTER_CONTRACT_INVALID", "Operational resource snapshot shape is invalid");
  assertExact(snapshot, SNAPSHOT_KEYS, "Operational resource snapshot");
  if (
    snapshot.schemaVersion !== 1 ||
    snapshot.adapterId !== operationalResourceAdapterDefinition.id ||
    snapshot.adapterVersion !== operationalResourceAdapterDefinition.version
  )
    fail("ADAPTER_CONTRACT_INVALID", "Operational resource snapshot adapter identity is invalid");
  assertIsoTimestamp(snapshot.synchronizedAt, "Operational resource snapshot synchronizedAt");
  if (!SHA256.test(snapshot.checksum ?? ""))
    fail("ADAPTER_CHECKSUM_INVALID", "Operational resource snapshot checksum is invalid");
  assertExact(
    snapshot.syncCursor,
    ["adapterId", "adapterVersion", "opaque", "sourceVersion", "checksum"],
    "Operational resource snapshot cursor",
  );
  const { checksum: cursorChecksum, ...cursorContent } = snapshot.syncCursor;
  if (
    snapshot.syncCursor.adapterId !== snapshot.adapterId ||
    snapshot.syncCursor.adapterVersion !== snapshot.adapterVersion ||
    snapshot.syncCursor.sourceVersion !== snapshot.sourceVersion ||
    !SHA256.test(cursorChecksum ?? "") ||
    (await sha256Checksum(cursorContent)) !== cursorChecksum
  )
    fail("ADAPTER_CURSOR_INCOMPATIBLE", "Operational resource snapshot cursor is invalid");
  const { id, checksum, ...content } = snapshot;
  const actual = await sha256Checksum(content);
  if (checksum !== actual || id !== `operational-resource-snapshot-${checksum.slice(0, 16)}`)
    fail("ADAPTER_CHECKSUM_MISMATCH", "Operational resource snapshot checksum does not match its canonical content");
  assertExact(
    snapshot.privacy,
    ["personnelMode", "rawPersonnelIdentityStored", "contactDataStored"],
    "Operational resource privacy evidence",
  );
  if (
    snapshot.privacy.personnelMode !== "opaque-reference" ||
    snapshot.privacy.rawPersonnelIdentityStored ||
    snapshot.privacy.contactDataStored
  )
    fail("ADAPTER_PERSONAL_DATA_REJECTED", "Operational resource privacy evidence is invalid");
  if (context.preparedInput !== undefined) {
    const expected = await createOperationalSnapshot(context.preparedInput, snapshot.synchronizedAt);
    if (expected.checksum !== snapshot.checksum)
      fail(
        "ADAPTER_SOURCE_MISMATCH",
        "Operational resource snapshot is not bound to the prepared source and trusted Project context",
      );
  } else {
    const reconstructed = normalizePrepared({
      sourceSystem: snapshot.sourceSystem,
      sourceVersion: snapshot.sourceVersion,
      nextCursor: snapshot.syncCursor.opaque,
      project: {
        projectId: snapshot.projectId,
        planVersion: snapshot.planVersion,
        planFingerprint: snapshot.planFingerprint,
        eventWindow: snapshot.eventWindow,
        currentReservationRef: snapshot.currentReservationRef,
      },
      resources: snapshot.resources,
      staffing: snapshot.staffing,
      demands: snapshot.demands,
    });
    const reconciliation = await reconcilePrepared(reconstructed);
    if (
      JSON.stringify(reconciliation) !==
      JSON.stringify({
        schemaVersion: snapshot.schemaVersion,
        status: snapshot.status,
        projectId: snapshot.projectId,
        planVersion: snapshot.planVersion,
        planFingerprint: snapshot.planFingerprint,
        eventWindow: snapshot.eventWindow,
        currentReservationRef: snapshot.currentReservationRef,
        resources: snapshot.resources,
        staffing: snapshot.staffing,
        demands: snapshot.demands,
        conflicts: snapshot.conflicts,
        substitutionOptions: snapshot.substitutionOptions,
        summary: snapshot.summary,
        privacy: snapshot.privacy,
      })
    )
      fail("ADAPTER_RECONCILIATION_INVALID", "Operational resource snapshot reconciliation is invalid");
  }
  return true;
}

export const operationalResourceAdapter: VenueAdapter = Object.freeze({
  definition: operationalResourceAdapterDefinition,
  assertImportResult: assertOperationalResourceSnapshot,
  prepareInput(capability: AdapterCapability, input: unknown, context: Readonly<{ adapterContext: unknown }>) {
    return normalizeOperationalResourceAdapterInput(capability, input, context?.adapterContext);
  },
  async invoke(capability: AdapterCapability, input: unknown, context: AdapterHandlerContext) {
    if (capability !== "import" && capability !== "synchronize")
      fail("ADAPTER_CAPABILITY_UNSUPPORTED", `Operational resource adapter does not support ${capability}`);
    await context.secrets.get("operational-resources/api-token");
    return createOperationalSnapshot(input, context.clock());
  },
});

export async function createOperationalSubstitutionStagingBatch({
  snapshot: snapshotValue,
  conflictId,
  optionId,
  acceptedPlan: acceptedPlanValue,
  proposalRevision,
  resolveLatestSnapshot,
}: SubstitutionRequest): Promise<Readonly<AdapterStagingBatch>> {
  if (typeof resolveLatestSnapshot !== "function")
    return fail(
      "ADAPTER_SNAPSHOT_PROVENANCE_REQUIRED",
      "Operational substitution preview requires a trusted latest-snapshot resolver",
    );
  if (!isOperationalSnapshot(snapshotValue))
    return fail("ADAPTER_CONTRACT_INVALID", "Operational resource snapshot shape is invalid");
  const snapshot = snapshotValue;
  const trustedSnapshotValue = await resolveLatestSnapshot({
    adapterId: operationalResourceAdapterDefinition.id,
    projectId: snapshot.projectId,
  });
  if (!trustedSnapshotValue)
    return fail("ADAPTER_SNAPSHOT_PROVENANCE_REQUIRED", "Trusted operational snapshot evidence was not found");
  if (!isOperationalSnapshot(trustedSnapshotValue))
    return fail("ADAPTER_CONTRACT_INVALID", "Trusted operational snapshot shape is invalid");
  const trustedSnapshot = trustedSnapshotValue;
  await assertOperationalResourceSnapshot(trustedSnapshot, {});
  if (trustedSnapshot.id !== snapshot?.id || trustedSnapshot.checksum !== snapshot?.checksum)
    fail("ADAPTER_SOURCE_MISMATCH", "Operational resource snapshot is no longer the latest trusted Project evidence");
  await assertOperationalResourceSnapshot(snapshot, {});
  if (!conflictId || !optionId)
    return fail(
      "ADAPTER_SUBSTITUTION_SELECTION_REQUIRED",
      "Operational substitution requires an explicit conflict and option selection",
    );
  if (!isAcceptedPlan(acceptedPlanValue))
    return fail("ADAPTER_PROJECT_BINDING_REQUIRED", "Accepted Plan is required for operational substitution");
  const acceptedPlan = acceptedPlanValue;
  const fingerprintValue: unknown = PLAN_FINGERPRINT.test(snapshot.planFingerprint)
    ? stableFingerprint("plan", acceptedPlan)
    : await sha256Checksum(acceptedPlan);
  if (typeof fingerprintValue !== "string")
    return fail("ADAPTER_CHECKSUM_INVALID", "Accepted Plan fingerprint is invalid");
  const acceptedPlanFingerprint = fingerprintValue;
  if (acceptedPlan.version !== snapshot.planVersion || acceptedPlanFingerprint !== snapshot.planFingerprint)
    fail("ADAPTER_BASE_PLAN_VERSION_CONFLICT", "Operational snapshot is stale for the accepted Plan");
  const conflict = snapshot.conflicts.find((item) => item.id === conflictId);
  const option = snapshot.substitutionOptions.find((item) => item.id === optionId && item.conflictId === conflictId);
  if (!conflict) return fail("ADAPTER_SUBSTITUTION_INVALID", "Operational substitution conflict was not found");
  if (!option || !conflict.substitutionOptionIds.includes(optionId))
    return fail(
      "ADAPTER_SUBSTITUTION_INVALID",
      "Operational substitution option does not belong to the selected conflict",
    );
  if (option.family === "staffing")
    fail(
      "ADAPTER_ENTITY_TYPE_UNSUPPORTED",
      "Personnel substitutions require a privacy-preserving staffing assignment workflow",
    );
  if (option.targetObjectIds.length !== 1)
    fail("ADAPTER_SUBSTITUTION_INVALID", "Minimal operational substitution requires exactly one target object");
  const demand = snapshot.demands.find((item) => item.demandId === option.demandId);
  const replacement = snapshot.resources.find((item) => item.resourceId === option.replacementResourceId);
  const object = acceptedPlan.objects?.find((item) => item.id === option.targetObjectIds[0]);
  if (!demand || !replacement || !object || (await sha256Checksum(object)) !== demand.baseObjectChecksum)
    return fail(
      "ADAPTER_SUBSTITUTION_STALE",
      "Operational substitution target no longer matches its accepted object evidence",
    );
  const resourceBinding = object.resourceBinding;
  if (!resourceBinding || resourceBinding.resourceId !== conflict.resourceId)
    return fail(
      "ADAPTER_SUBSTITUTION_STALE",
      "Operational substitution target is not bound to the conflicted resource",
    );
  if (resourceBinding.kind !== demand.family || resourceBinding.quantity !== demand.quantity)
    fail(
      "ADAPTER_SUBSTITUTION_STALE",
      "Operational substitution target binding no longer matches the demanded family and quantity",
    );
  const binding = templateRefFrom(replacement.capability);
  if (
    !binding ||
    object.templateRef?.kind !== "inventory-item-template" ||
    object.templateRef.templateId !== binding.templateId ||
    object.templateRef.version !== binding.version
  )
    fail(
      "ADAPTER_SUBSTITUTION_INVALID",
      "Minimal operational substitution must retain the exact Inventory Item Template binding",
    );
  const changeChecksum = await sha256Checksum({
    snapshotChecksum: snapshot.checksum,
    conflictId,
    optionId,
    objectId: object.id,
    replacementResourceId: replacement.resourceId,
  });
  const replacementExternalId = replacement.source.externalId;
  if (!replacementExternalId)
    return fail("ADAPTER_SOURCE_INVALID", "Operational replacement resource is missing its external source ID");
  return createAdapterStagingBatch(
    operationalResourceAdapterDefinition,
    {
      sourceSystem: snapshot.sourceSystem,
      sourceVersion: snapshot.sourceVersion,
      synchronizedAt: snapshot.synchronizedAt,
      syncCursor: snapshot.syncCursor,
      changes: [
        {
          id: `change-resource-substitution-${changeChecksum.slice(0, 16)}`,
          operation: "update",
          venueEntityType: "project-object-instance",
          venueObjectId: object.id,
          external: {
            adapterId: operationalResourceAdapterDefinition.id,
            sourceSystem: snapshot.sourceSystem,
            entityType: `${replacement.family}-resource`,
            externalId: replacementExternalId,
            sourceVersion: replacement.source.sourceVersion,
            checksum: replacement.source.checksum,
          },
          values: {
            resourceBinding: {
              schemaVersion: 1,
              kind: replacement.family,
              resourceId: replacement.resourceId,
              quantity: demand.quantity,
            },
          },
          baseChecksum: demand.baseObjectChecksum,
          evidence: {
            kind: "operational-resource-substitution",
            sourceId: snapshot.id,
            sourceChecksum: snapshot.checksum,
            references: [conflict.id, option.id].sort(compare),
          },
        },
      ],
      mappings: [
        {
          venueEntityType: "project",
          venueObjectId: snapshot.projectId,
          external: {
            adapterId: operationalResourceAdapterDefinition.id,
            sourceSystem: snapshot.sourceSystem,
            entityType: "operational-resource-snapshot",
            externalId: snapshot.id,
            sourceVersion: snapshot.sourceVersion,
            checksum: snapshot.checksum,
          },
        },
        {
          venueEntityType: "project-object-instance",
          venueObjectId: object.id,
          external: {
            adapterId: operationalResourceAdapterDefinition.id,
            sourceSystem: snapshot.sourceSystem,
            entityType: `${replacement.family}-resource`,
            externalId: replacementExternalId,
            sourceVersion: replacement.source.sourceVersion,
            checksum: replacement.source.checksum,
          },
        },
      ],
      warnings: [],
    },
    { basePlanVersion: snapshot.planVersion, proposalRevision },
  );
}
