import { stableFingerprint } from "../domain/activity-ledger.js";

export const ADAPTER_CONTRACT_VERSION = 1;
export const ADAPTER_CAPABILITIES = Object.freeze(["import", "export", "synchronize", "webhook"]);
export const ADAPTER_CHANGE_OPERATIONS = Object.freeze(["create", "update", "delete"]);
export const VENUE_ENTITY_TYPES = Object.freeze(["inventory-item-template", "project-object-instance"]);

const CAPABILITY_SET = new Set(ADAPTER_CAPABILITIES);
const CHANGE_OPERATION_SET = new Set(ADAPTER_CHANGE_OPERATIONS);
const VENUE_ENTITY_TYPE_SET = new Set(VENUE_ENTITY_TYPES);
const IDENTIFIER = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[0-9a-f]{64}$/;

const clone = (value) => structuredClone(value);

export class AdapterContractError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "AdapterContractError";
    this.code = code;
    this.details = clone(details);
  }
}

const fail = (code, message, details) => {
  throw new AdapterContractError(code, message, details);
};

const assertPlainObject = (value, label) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ADAPTER_CONTRACT_INVALID", `${label} must be an object`);
};

const assertExactKeys = (value, allowed, label) => {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", `${label} contains unknown fields`, { fields: unknown.sort() });
};

const assertString = (value, label) => {
  if (typeof value !== "string" || value.length === 0) fail("ADAPTER_CONTRACT_INVALID", `${label} must be a non-empty string`);
};

export const assertIsoTimestamp = (value, label = "Timestamp") => {
  assertString(value, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) || Number.isNaN(Date.parse(value))) fail("ADAPTER_CONTRACT_INVALID", `${label} must be an ISO-8601 UTC timestamp`);
  return value;
};

export const canonicalStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
};

export async function sha256Checksum(value) {
  const bytes = new TextEncoder().encode(typeof value === "string" ? value : canonicalStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function defineAdapter(input) {
  assertPlainObject(input, "Adapter definition");
  assertExactKeys(input, ["contractVersion", "id", "displayName", "version", "capabilities", "scopes", "retryPolicy", "rateLimit"], "Adapter definition");
  if (input.contractVersion !== ADAPTER_CONTRACT_VERSION) fail("ADAPTER_CONTRACT_VERSION_UNSUPPORTED", `Adapter contract version must be ${ADAPTER_CONTRACT_VERSION}`, { actual: input.contractVersion });
  if (!IDENTIFIER.test(input.id ?? "")) fail("ADAPTER_CONTRACT_INVALID", "Adapter ID must be a lowercase kebab-case identifier");
  assertString(input.displayName, "Adapter display name");
  if (!VERSION.test(input.version ?? "")) fail("ADAPTER_CONTRACT_INVALID", "Adapter version must be semantic version syntax");
  if (!Array.isArray(input.capabilities) || input.capabilities.length === 0 || input.capabilities.some((item) => !CAPABILITY_SET.has(item))) fail("ADAPTER_CONTRACT_INVALID", "Adapter capabilities are invalid");
  const capabilities = [...new Set(input.capabilities)].sort();
  assertPlainObject(input.scopes, "Adapter scopes");
  assertExactKeys(input.scopes, capabilities, "Adapter scopes");
  const scopes = Object.fromEntries(capabilities.map((capability) => {
    const values = input.scopes[capability];
    if (!Array.isArray(values) || values.some((scope) => typeof scope !== "string" || !scope)) fail("ADAPTER_CONTRACT_INVALID", `Scopes for ${capability} must be strings`);
    return [capability, [...new Set(values)].sort()];
  }));
  const retryPolicy = normalizeRetryPolicy(input.retryPolicy);
  const rateLimit = normalizeRateLimit(input.rateLimit);
  return Object.freeze({ contractVersion: ADAPTER_CONTRACT_VERSION, id: input.id, displayName: input.displayName, version: input.version, capabilities, scopes, retryPolicy, rateLimit });
}

export function normalizeRetryPolicy(input = {}) {
  assertPlainObject(input, "Retry policy");
  assertExactKeys(input, ["maxAttempts", "initialDelayMs", "maximumDelayMs", "multiplier", "retryableCodes"], "Retry policy");
  const policy = {
    maxAttempts: input.maxAttempts ?? 3,
    initialDelayMs: input.initialDelayMs ?? 250,
    maximumDelayMs: input.maximumDelayMs ?? 5_000,
    multiplier: input.multiplier ?? 2,
    retryableCodes: [...new Set(input.retryableCodes ?? ["ADAPTER_NETWORK_ERROR", "ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"])].sort(),
  };
  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1 || policy.maxAttempts > 10) fail("ADAPTER_CONTRACT_INVALID", "maxAttempts must be an integer from 1 to 10");
  if (!Number.isInteger(policy.initialDelayMs) || policy.initialDelayMs < 0) fail("ADAPTER_CONTRACT_INVALID", "initialDelayMs must be a non-negative integer");
  if (!Number.isInteger(policy.maximumDelayMs) || policy.maximumDelayMs < policy.initialDelayMs) fail("ADAPTER_CONTRACT_INVALID", "maximumDelayMs must be at least initialDelayMs");
  if (!Number.isFinite(policy.multiplier) || policy.multiplier < 1) fail("ADAPTER_CONTRACT_INVALID", "multiplier must be at least 1");
  if (policy.retryableCodes.some((code) => typeof code !== "string" || !code)) fail("ADAPTER_CONTRACT_INVALID", "retryableCodes must contain non-empty strings");
  return Object.freeze(policy);
}

export function normalizeRateLimit(input = {}) {
  assertPlainObject(input, "Rate limit");
  assertExactKeys(input, ["requests", "windowMs"], "Rate limit");
  const limit = { requests: input.requests ?? 60, windowMs: input.windowMs ?? 60_000 };
  if (!Number.isInteger(limit.requests) || limit.requests < 1) fail("ADAPTER_CONTRACT_INVALID", "Rate-limit requests must be positive");
  if (!Number.isInteger(limit.windowMs) || limit.windowMs < 1) fail("ADAPTER_CONTRACT_INVALID", "Rate-limit windowMs must be positive");
  return Object.freeze(limit);
}

export function assertAdapterScope(definition, capability, grantedScopes = []) {
  if (!definition.capabilities.includes(capability)) fail("ADAPTER_CAPABILITY_UNSUPPORTED", `${definition.id} does not support ${capability}`, { adapterId: definition.id, capability });
  const granted = new Set(grantedScopes);
  const missingScopes = definition.scopes[capability].filter((scope) => !granted.has(scope));
  if (missingScopes.length) fail("ADAPTER_SCOPE_DENIED", `Missing scopes for ${capability}`, { adapterId: definition.id, capability, missingScopes });
  return true;
}

export function normalizeExternalReference(input, definition) {
  assertPlainObject(input, "External reference");
  assertExactKeys(input, ["adapterId", "sourceSystem", "entityType", "externalId", "sourceVersion", "checksum"], "External reference");
  if (input.adapterId !== definition.id) fail("ADAPTER_SOURCE_MISMATCH", "External reference belongs to another adapter", { expected: definition.id, actual: input.adapterId });
  for (const field of ["sourceSystem", "entityType", "externalId", "sourceVersion"]) assertString(input[field], `External reference ${field}`);
  if (!SHA256.test(input.checksum ?? "")) fail("ADAPTER_CHECKSUM_INVALID", "External reference checksum must be a lowercase SHA-256 digest");
  return Object.freeze(clone(input));
}

export function normalizeAdapterChange(input, definition) {
  assertPlainObject(input, "Adapter change");
  assertExactKeys(input, ["id", "operation", "venueEntityType", "venueObjectId", "proposedVenueObjectId", "external", "values", "baseChecksum"], "Adapter change");
  assertString(input.id, "Adapter change ID");
  if (!CHANGE_OPERATION_SET.has(input.operation)) fail("ADAPTER_CONTRACT_INVALID", "Adapter change operation is invalid", { operation: input.operation });
  if (!VENUE_ENTITY_TYPE_SET.has(input.venueEntityType)) fail("ADAPTER_ENTITY_TYPE_INVALID", "Adapter change must distinguish an Inventory Item Template from a Project Object Instance", { venueEntityType: input.venueEntityType });
  if (input.venueEntityType !== "project-object-instance") fail("ADAPTER_ENTITY_TYPE_UNSUPPORTED", "Spatial Proposal staging currently accepts Project Object Instances only", { venueEntityType: input.venueEntityType });
  if (input.operation === "create") {
    if (input.venueObjectId !== undefined) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Create changes cannot claim an existing VenueMind stable ID");
    assertString(input.proposedVenueObjectId, "Proposed VenueMind stable ID");
  } else {
    assertString(input.venueObjectId, "VenueMind stable ID");
    if (input.proposedVenueObjectId !== undefined) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "Only create changes may propose a VenueMind stable ID");
  }
  const external = normalizeExternalReference(input.external, definition);
  const venueStableId = input.operation === "create" ? input.proposedVenueObjectId : input.venueObjectId;
  if (venueStableId === external.externalId) fail("ADAPTER_ID_BOUNDARY_VIOLATION", "External IDs and VenueMind stable IDs must not be conflated", { venueObjectId: venueStableId, externalId: external.externalId });
  if (input.baseChecksum !== undefined && !SHA256.test(input.baseChecksum)) fail("ADAPTER_CHECKSUM_INVALID", "baseChecksum must be a lowercase SHA-256 digest");
  if (input.operation !== "delete") assertPlainObject(input.values, "Adapter change values");
  return Object.freeze(clone(input));
}

export function normalizeSyncCursor(input, definition) {
  if (input === null || input === undefined) return null;
  assertPlainObject(input, "Synchronization cursor");
  assertExactKeys(input, ["adapterId", "adapterVersion", "opaque", "sourceVersion", "checksum"], "Synchronization cursor");
  if (input.adapterId !== definition.id || input.adapterVersion !== definition.version) fail("ADAPTER_CURSOR_INCOMPATIBLE", "Synchronization cursor was created by another adapter version", { adapterId: input.adapterId, adapterVersion: input.adapterVersion });
  for (const field of ["opaque", "sourceVersion"]) assertString(input[field], `Synchronization cursor ${field}`);
  if (!SHA256.test(input.checksum ?? "")) fail("ADAPTER_CHECKSUM_INVALID", "Synchronization cursor checksum must be a lowercase SHA-256 digest");
  return Object.freeze(clone(input));
}

export async function createSyncCursor(definition, { opaque, sourceVersion }) {
  assertString(opaque, "Synchronization cursor opaque value");
  assertString(sourceVersion, "Synchronization cursor sourceVersion");
  const payload = { adapterId: definition.id, adapterVersion: definition.version, opaque, sourceVersion };
  return Object.freeze({ ...payload, checksum: await sha256Checksum(payload) });
}

export function adapterInvocationId(definition, capability, input) {
  return stableFingerprint("adapter-invocation", { adapterId: definition.id, adapterVersion: definition.version, capability, input });
}
