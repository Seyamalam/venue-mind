import { stableFingerprint } from "../domain/activity-ledger.ts";
import { normalizePlanningEffect } from "../domain/planning-effects.ts";
import { assertCanonicalUtcTimestamp } from "../domain/timestamps.ts";
import { isNonContactLabel } from "./privacy.ts";

export const ADAPTER_CONTRACT_VERSION = 1;
export const ADAPTER_CAPABILITIES = ["import", "export", "synchronize", "webhook"] as const;
export const ADAPTER_IMPORT_RESULT_MODES = ["reviewable-proposal", "aggregate-snapshot"] as const;
export const ADAPTER_CHANGE_OPERATIONS = ["create", "update", "delete"] as const;
export const VENUE_ENTITY_TYPES = [
  "event-brief-requirement",
  "inventory-item-template",
  "project",
  "project-object-instance",
] as const;
export const ADAPTER_EVIDENCE_LIMITS = Object.freeze({
  kindLength: 80,
  sourceIdLength: 160,
  referenceLength: 160,
  references: 20,
});

export type AdapterCapability = (typeof ADAPTER_CAPABILITIES)[number];
export type AdapterImportResultMode = (typeof ADAPTER_IMPORT_RESULT_MODES)[number];
export type AdapterChangeOperation = (typeof ADAPTER_CHANGE_OPERATIONS)[number];
export type VenueEntityType = (typeof VENUE_ENTITY_TYPES)[number];

const CAPABILITY_SET: ReadonlySet<string> = new Set(ADAPTER_CAPABILITIES);
const IMPORT_RESULT_MODE_SET: ReadonlySet<string> = new Set(ADAPTER_IMPORT_RESULT_MODES);
const CHANGE_OPERATION_SET: ReadonlySet<string> = new Set(ADAPTER_CHANGE_OPERATIONS);
const VENUE_ENTITY_TYPE_SET: ReadonlySet<string> = new Set(VENUE_ENTITY_TYPES);
const IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const EVIDENCE_IDENTIFIER = /^[a-z0-9][a-z0-9._:-]*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;

const clone = <Value>(value: Value): Value => structuredClone(value);

export type ContractDetails = Readonly<Record<string, unknown>>;

export class AdapterContractError extends Error {
  readonly code: string;
  readonly details: ContractDetails;

  constructor(code: string, message: string, details: ContractDetails = {}) {
    super(message);
    this.name = "AdapterContractError";
    this.code = code;
    this.details = clone(details);
  }
}

const fail = (code: string, message: string, details: ContractDetails = {}): never => {
  throw new AdapterContractError(code, message, details);
};

function assertPlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new AdapterContractError("ADAPTER_CONTRACT_INVALID", `${label} must be an object`);
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertExactKeys = (value: Readonly<Record<string, unknown>>, allowed: readonly string[], label: string): void => {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length)
    fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", `${label} contains unknown fields`, { fields: unknown.sort() });
};

function assertString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0)
    throw new AdapterContractError("ADAPTER_CONTRACT_INVALID", `${label} must be a non-empty string`);
}

function assertBoundedEvidenceIdentifier(
  value: unknown,
  label: string,
  maximumLength: number,
): asserts value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximumLength) {
    throw new AdapterContractError("ADAPTER_CONTRACT_INVALID", `${label} must be a bounded lowercase identifier`);
  }
}

const assertEvidenceIdentifierSyntax = (value: string, label: string, pattern: RegExp = EVIDENCE_IDENTIFIER): void => {
  if (!pattern.test(value)) fail("ADAPTER_CONTRACT_INVALID", `${label} must be a bounded lowercase identifier`);
};

export const assertIsoTimestamp = (value: unknown, label = "Timestamp"): string => {
  try {
    return assertCanonicalUtcTimestamp(value, label);
  } catch (error) {
    return fail("ADAPTER_CONTRACT_INVALID", error instanceof Error ? error.message : "Timestamp is invalid");
  }
};

export const canonicalStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

export async function sha256Checksum(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface AdapterRetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maximumDelayMs: number;
  readonly multiplier: number;
  readonly retryableCodes: readonly string[];
}

export interface AdapterRateLimit {
  readonly requests: number;
  readonly windowMs: number;
}

export interface AdapterDefinition {
  readonly contractVersion: 1;
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly capabilities: readonly AdapterCapability[];
  readonly importResultMode: AdapterImportResultMode;
  readonly scopes: Readonly<Partial<Record<AdapterCapability, readonly string[]>>>;
  readonly retryPolicy: AdapterRetryPolicy;
  readonly rateLimit: AdapterRateLimit;
}

const isCapability = (value: unknown): value is AdapterCapability =>
  typeof value === "string" && CAPABILITY_SET.has(value);
const isImportResultMode = (value: unknown): value is AdapterImportResultMode =>
  typeof value === "string" && IMPORT_RESULT_MODE_SET.has(value);

export function defineAdapter(input: unknown): Readonly<AdapterDefinition> {
  assertPlainObject(input, "Adapter definition");
  assertExactKeys(
    input,
    [
      "contractVersion",
      "id",
      "displayName",
      "version",
      "capabilities",
      "scopes",
      "retryPolicy",
      "rateLimit",
      "importResultMode",
    ],
    "Adapter definition",
  );
  if (input["contractVersion"] !== ADAPTER_CONTRACT_VERSION)
    fail("ADAPTER_CONTRACT_VERSION_UNSUPPORTED", `Adapter contract version must be ${ADAPTER_CONTRACT_VERSION}`, {
      actual: input["contractVersion"],
    });
  const id = input["id"];
  const displayName = input["displayName"];
  const version = input["version"];
  if (typeof id !== "string" || !IDENTIFIER.test(id))
    return fail("ADAPTER_CONTRACT_INVALID", "Adapter ID must be a lowercase kebab-case identifier");
  assertString(displayName, "Adapter display name");
  if (typeof version !== "string" || !VERSION.test(version))
    return fail("ADAPTER_CONTRACT_INVALID", "Adapter version must be semantic version syntax");
  const rawCapabilities = input["capabilities"];
  if (!Array.isArray(rawCapabilities) || rawCapabilities.length === 0 || !rawCapabilities.every(isCapability))
    return fail("ADAPTER_CONTRACT_INVALID", "Adapter capabilities are invalid");
  const capabilities = [...new Set<AdapterCapability>(rawCapabilities)].sort();
  const importResultMode = input["importResultMode"] ?? "reviewable-proposal";
  if (!isImportResultMode(importResultMode))
    return fail("ADAPTER_CONTRACT_INVALID", "Adapter importResultMode is invalid", { importResultMode });
  const rawScopes = input["scopes"];
  assertPlainObject(rawScopes, "Adapter scopes");
  assertExactKeys(rawScopes, capabilities, "Adapter scopes");
  const scopes: Partial<Record<AdapterCapability, readonly string[]>> = {};
  for (const capability of capabilities) {
    const values = rawScopes[capability];
    if (
      !Array.isArray(values) ||
      !values.every((scope): scope is string => typeof scope === "string" && scope.length > 0)
    )
      return fail("ADAPTER_CONTRACT_INVALID", `Scopes for ${capability} must be strings`);
    scopes[capability] = [...new Set<string>(values)].sort();
  }
  const retryPolicy = normalizeRetryPolicy(input["retryPolicy"]);
  const rateLimit = normalizeRateLimit(input["rateLimit"]);
  return Object.freeze({
    contractVersion: ADAPTER_CONTRACT_VERSION,
    id,
    displayName,
    version,
    capabilities,
    importResultMode,
    scopes,
    retryPolicy,
    rateLimit,
  });
}

export function normalizeRetryPolicy(input: unknown = {}): Readonly<AdapterRetryPolicy> {
  assertPlainObject(input, "Retry policy");
  assertExactKeys(
    input,
    ["maxAttempts", "initialDelayMs", "maximumDelayMs", "multiplier", "retryableCodes"],
    "Retry policy",
  );
  const policy = {
    maxAttempts: input["maxAttempts"] ?? 3,
    initialDelayMs: input["initialDelayMs"] ?? 250,
    maximumDelayMs: input["maximumDelayMs"] ?? 5_000,
    multiplier: input["multiplier"] ?? 2,
    retryableCodes: [
      ...new Set(
        Array.isArray(input["retryableCodes"])
          ? input["retryableCodes"]
          : ["ADAPTER_NETWORK_ERROR", "ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"],
      ),
    ].sort(),
  };
  if (
    typeof policy.maxAttempts !== "number" ||
    !Number.isInteger(policy.maxAttempts) ||
    policy.maxAttempts < 1 ||
    policy.maxAttempts > 10
  )
    return fail("ADAPTER_CONTRACT_INVALID", "maxAttempts must be an integer from 1 to 10");
  if (
    typeof policy.initialDelayMs !== "number" ||
    !Number.isInteger(policy.initialDelayMs) ||
    policy.initialDelayMs < 0
  )
    return fail("ADAPTER_CONTRACT_INVALID", "initialDelayMs must be a non-negative integer");
  if (
    typeof policy.maximumDelayMs !== "number" ||
    !Number.isInteger(policy.maximumDelayMs) ||
    policy.maximumDelayMs < policy.initialDelayMs
  )
    return fail("ADAPTER_CONTRACT_INVALID", "maximumDelayMs must be at least initialDelayMs");
  if (typeof policy.multiplier !== "number" || !Number.isFinite(policy.multiplier) || policy.multiplier < 1)
    return fail("ADAPTER_CONTRACT_INVALID", "multiplier must be at least 1");
  if (!policy.retryableCodes.every((code): code is string => typeof code === "string" && code.length > 0))
    return fail("ADAPTER_CONTRACT_INVALID", "retryableCodes must contain non-empty strings");
  return Object.freeze({
    maxAttempts: policy.maxAttempts,
    initialDelayMs: policy.initialDelayMs,
    maximumDelayMs: policy.maximumDelayMs,
    multiplier: policy.multiplier,
    retryableCodes: policy.retryableCodes,
  });
}

export function normalizeRateLimit(input: unknown = {}): Readonly<AdapterRateLimit> {
  assertPlainObject(input, "Rate limit");
  assertExactKeys(input, ["requests", "windowMs"], "Rate limit");
  const requests = input["requests"] ?? 60;
  const windowMs = input["windowMs"] ?? 60_000;
  if (typeof requests !== "number" || !Number.isInteger(requests) || requests < 1)
    return fail("ADAPTER_CONTRACT_INVALID", "Rate-limit requests must be positive");
  if (typeof windowMs !== "number" || !Number.isInteger(windowMs) || windowMs < 1)
    return fail("ADAPTER_CONTRACT_INVALID", "Rate-limit windowMs must be positive");
  return Object.freeze({ requests, windowMs });
}

export function assertAdapterScope(
  definition: AdapterDefinition,
  capability: AdapterCapability,
  grantedScopes: readonly string[] = [],
): true {
  if (!definition.capabilities.includes(capability))
    fail("ADAPTER_CAPABILITY_UNSUPPORTED", `${definition.id} does not support ${capability}`, {
      adapterId: definition.id,
      capability,
    });
  const granted = new Set<string>(grantedScopes);
  const missingScopes = (definition.scopes[capability] ?? []).filter((scope) => !granted.has(scope));
  if (missingScopes.length)
    fail("ADAPTER_SCOPE_DENIED", `Missing scopes for ${capability}`, {
      adapterId: definition.id,
      capability,
      missingScopes,
    });
  return true;
}

export interface ExternalReference {
  readonly adapterId: string;
  readonly sourceSystem: string;
  readonly entityType: string;
  readonly externalId: string;
  readonly sourceVersion: string;
  readonly checksum: string;
}

export function normalizeExternalReference(input: unknown, definition: AdapterDefinition): Readonly<ExternalReference> {
  assertPlainObject(input, "External reference");
  assertExactKeys(
    input,
    ["adapterId", "sourceSystem", "entityType", "externalId", "sourceVersion", "checksum"],
    "External reference",
  );
  if (input["adapterId"] !== definition.id)
    fail("ADAPTER_SOURCE_MISMATCH", "External reference belongs to another adapter", {
      expected: definition.id,
      actual: input["adapterId"],
    });
  const sourceSystem = input["sourceSystem"];
  const entityType = input["entityType"];
  const externalId = input["externalId"];
  const sourceVersion = input["sourceVersion"];
  const checksum = input["checksum"];
  assertString(sourceSystem, "External reference sourceSystem");
  assertString(entityType, "External reference entityType");
  assertString(externalId, "External reference externalId");
  assertString(sourceVersion, "External reference sourceVersion");
  if (typeof checksum !== "string" || !SHA256.test(checksum))
    return fail("ADAPTER_CHECKSUM_INVALID", "External reference checksum must be a lowercase SHA-256 digest");
  return Object.freeze({ adapterId: definition.id, sourceSystem, entityType, externalId, sourceVersion, checksum });
}

export interface AdapterChangeEvidence {
  readonly kind: string;
  readonly sourceId: string;
  readonly sourceChecksum: string;
  readonly references: readonly string[];
}

export interface AdapterChange {
  readonly id: string;
  readonly operation: AdapterChangeOperation;
  readonly venueEntityType: VenueEntityType;
  readonly venueObjectId?: string;
  readonly proposedVenueObjectId?: string;
  readonly external: ExternalReference;
  readonly values?: Readonly<Record<string, unknown>>;
  readonly planningEffects?: readonly ReturnType<typeof normalizePlanningEffect>[];
  readonly baseChecksum?: string;
  readonly evidence?: AdapterChangeEvidence;
}

const isChangeOperation = (value: unknown): value is AdapterChangeOperation =>
  typeof value === "string" && CHANGE_OPERATION_SET.has(value);
const isVenueEntityType = (value: unknown): value is VenueEntityType =>
  typeof value === "string" && VENUE_ENTITY_TYPE_SET.has(value);

export function normalizeAdapterChange(input: unknown, definition: AdapterDefinition): Readonly<AdapterChange> {
  assertPlainObject(input, "Adapter change");
  assertExactKeys(
    input,
    [
      "id",
      "operation",
      "venueEntityType",
      "venueObjectId",
      "proposedVenueObjectId",
      "external",
      "values",
      "planningEffects",
      "baseChecksum",
      "evidence",
    ],
    "Adapter change",
  );
  const id = input["id"];
  const operation = input["operation"];
  const venueEntityType = input["venueEntityType"];
  assertString(id, "Adapter change ID");
  if (!isChangeOperation(operation))
    return fail("ADAPTER_CONTRACT_INVALID", "Adapter change operation is invalid", { operation });
  if (!isVenueEntityType(venueEntityType))
    return fail("ADAPTER_ENTITY_TYPE_INVALID", "Adapter change must use an explicit VenueMind entity type", {
      venueEntityType,
    });
  if (venueEntityType !== "project-object-instance" && venueEntityType !== "event-brief-requirement")
    return fail(
      "ADAPTER_ENTITY_TYPE_UNSUPPORTED",
      "Proposal staging accepts Project Object Instances and Event Brief Requirements only",
      { venueEntityType },
    );
  if (venueEntityType === "event-brief-requirement" && operation !== "update")
    fail("ADAPTER_CONTRACT_INVALID", "Requirement adapter changes must update an allocated stable Requirement ID");
  let venueObjectId: string | undefined;
  let proposedVenueObjectId: string | undefined;
  if (operation === "create") {
    if (input["venueObjectId"] !== undefined)
      fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Create changes cannot claim an existing VenueMind stable ID");
    const proposed = input["proposedVenueObjectId"];
    assertString(proposed, "Proposed VenueMind stable ID");
    proposedVenueObjectId = proposed;
  } else {
    const existing = input["venueObjectId"];
    assertString(existing, "VenueMind stable ID");
    venueObjectId = existing;
    if (input["proposedVenueObjectId"] !== undefined)
      fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Only create changes may propose a VenueMind stable ID");
  }
  const external = normalizeExternalReference(input["external"], definition);
  const venueStableId = operation === "create" ? proposedVenueObjectId : venueObjectId;
  if (venueStableId === external.externalId)
    fail("ADAPTER_ID_BOUNDARY_VIOLATION", "External IDs and VenueMind stable IDs must not be conflated", {
      venueObjectId: venueStableId,
      externalId: external.externalId,
    });
  const rawBaseChecksum = input["baseChecksum"];
  if (rawBaseChecksum !== undefined && (typeof rawBaseChecksum !== "string" || !SHA256.test(rawBaseChecksum)))
    fail("ADAPTER_CHECKSUM_INVALID", "baseChecksum must be a lowercase SHA-256 digest");
  let evidence: AdapterChangeEvidence | undefined;
  if (input["evidence"] !== undefined) {
    const rawEvidence = input["evidence"];
    assertPlainObject(rawEvidence, "Adapter change evidence");
    assertExactKeys(rawEvidence, ["kind", "sourceId", "sourceChecksum", "references"], "Adapter change evidence");
    const kind = rawEvidence["kind"];
    const sourceId = rawEvidence["sourceId"];
    const sourceChecksum = rawEvidence["sourceChecksum"];
    const references = rawEvidence["references"];
    assertBoundedEvidenceIdentifier(kind, "Adapter change evidence kind", ADAPTER_EVIDENCE_LIMITS.kindLength);
    assertBoundedEvidenceIdentifier(
      sourceId,
      "Adapter change evidence sourceId",
      ADAPTER_EVIDENCE_LIMITS.sourceIdLength,
    );
    if (!isNonContactLabel(kind) || !isNonContactLabel(sourceId))
      fail("ADAPTER_PERSONAL_DATA_REJECTED", "Adapter change evidence labels must not contain contact data");
    assertEvidenceIdentifierSyntax(kind, "Adapter change evidence kind", IDENTIFIER);
    assertEvidenceIdentifierSyntax(sourceId, "Adapter change evidence sourceId");
    if (typeof sourceChecksum !== "string" || !SHA256.test(sourceChecksum))
      return fail(
        "ADAPTER_CHECKSUM_INVALID",
        "Adapter change evidence sourceChecksum must be a lowercase SHA-256 digest",
      );
    if (!Array.isArray(references) || references.length > ADAPTER_EVIDENCE_LIMITS.references)
      return fail("ADAPTER_CONTRACT_INVALID", "Adapter change evidence references must be unique bounded identifiers");
    for (const reference of references)
      assertBoundedEvidenceIdentifier(
        reference,
        "Adapter change evidence reference",
        ADAPTER_EVIDENCE_LIMITS.referenceLength,
      );
    if (!references.every((reference): reference is string => typeof reference === "string"))
      return fail("ADAPTER_CONTRACT_INVALID", "Adapter change evidence references must be strings");
    if (new Set<string>(references).size !== references.length)
      fail("ADAPTER_CONTRACT_INVALID", "Adapter change evidence references must be unique bounded identifiers");
    if (references.some((item) => !isNonContactLabel(item)))
      fail("ADAPTER_PERSONAL_DATA_REJECTED", "Adapter change evidence labels must not contain contact data");
    for (const reference of references) assertEvidenceIdentifierSyntax(reference, "Adapter change evidence reference");
    evidence = { kind, sourceId, sourceChecksum, references };
  }
  const rawValues = input["values"];
  if (venueEntityType === "project-object-instance" && operation !== "delete")
    assertPlainObject(rawValues, "Adapter change values");
  if (venueEntityType === "event-brief-requirement" && rawValues !== undefined)
    fail("ADAPTER_CONTRACT_INVALID", "Requirement changes use typed planningEffects instead of values");
  const rawPlanningEffects = input["planningEffects"] ?? [];
  if (!Array.isArray(rawPlanningEffects))
    return fail("ADAPTER_CONTRACT_INVALID", "Adapter planningEffects must be an array");
  const planningEffects = rawPlanningEffects.map(normalizePlanningEffect);
  if (venueEntityType === "event-brief-requirement" && planningEffects.length === 0)
    fail("ADAPTER_CHANGE_EMPTY", "Requirement change must contain an executable Planning Effect");
  if (venueEntityType === "project-object-instance" && planningEffects.length > 0)
    fail("ADAPTER_CONTRACT_INVALID", "Project Object changes cannot carry Event Brief Planning Effects");
  return Object.freeze({
    id,
    operation,
    venueEntityType,
    ...(venueObjectId ? { venueObjectId } : {}),
    ...(proposedVenueObjectId ? { proposedVenueObjectId } : {}),
    external,
    ...(isPlainObject(rawValues) ? { values: clone(rawValues) } : {}),
    ...(planningEffects.length ? { planningEffects: clone(planningEffects) } : {}),
    ...(typeof rawBaseChecksum === "string" ? { baseChecksum: rawBaseChecksum } : {}),
    ...(evidence ? { evidence } : {}),
  });
}

export interface SyncCursor {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly opaque: string;
  readonly sourceVersion: string;
  readonly checksum: string;
}

export function normalizeSyncCursor(input: unknown, definition: AdapterDefinition): Readonly<SyncCursor> | null {
  if (input === null || input === undefined) return null;
  assertPlainObject(input, "Synchronization cursor");
  assertExactKeys(
    input,
    ["adapterId", "adapterVersion", "opaque", "sourceVersion", "checksum"],
    "Synchronization cursor",
  );
  if (input["adapterId"] !== definition.id || input["adapterVersion"] !== definition.version)
    fail("ADAPTER_CURSOR_INCOMPATIBLE", "Synchronization cursor was created by another adapter version", {
      adapterId: input["adapterId"],
      adapterVersion: input["adapterVersion"],
    });
  const opaque = input["opaque"];
  const sourceVersion = input["sourceVersion"];
  const checksum = input["checksum"];
  assertString(opaque, "Synchronization cursor opaque");
  assertString(sourceVersion, "Synchronization cursor sourceVersion");
  if (typeof checksum !== "string" || !SHA256.test(checksum))
    return fail("ADAPTER_CHECKSUM_INVALID", "Synchronization cursor checksum must be a lowercase SHA-256 digest");
  return Object.freeze({
    adapterId: definition.id,
    adapterVersion: definition.version,
    opaque,
    sourceVersion,
    checksum,
  });
}

export async function createSyncCursor(
  definition: AdapterDefinition,
  { opaque, sourceVersion }: Readonly<{ opaque: string; sourceVersion: string }>,
): Promise<Readonly<SyncCursor>> {
  assertString(opaque, "Synchronization cursor opaque value");
  assertString(sourceVersion, "Synchronization cursor sourceVersion");
  const payload = { adapterId: definition.id, adapterVersion: definition.version, opaque, sourceVersion };
  return Object.freeze({ ...payload, checksum: await sha256Checksum(payload) });
}

export function adapterInvocationId(
  definition: AdapterDefinition,
  capability: AdapterCapability,
  input: unknown,
): string {
  return stableFingerprint("adapter-invocation", {
    adapterId: definition.id,
    adapterVersion: definition.version,
    capability,
    input,
  });
}
