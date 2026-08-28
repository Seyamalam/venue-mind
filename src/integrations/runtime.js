import {
  AdapterContractError,
  adapterInvocationId,
  assertAdapterScope,
  canonicalStringify,
  defineAdapter,
  normalizeSyncCursor,
  sha256Checksum,
} from "./contracts.js";
import { createScopedSecretReader } from "./secret-store.js";
import { assertReviewableStagingBatch, createAdapterStagingBatch } from "./staging.js";

const clone = (value) => structuredClone(value);

const fail = (code, message, details) => {
  throw new AdapterContractError(code, message, details);
};

const asAdapterFailure = (error) => {
  if (error instanceof AdapterContractError) return error;
  return new AdapterContractError(error?.code ?? "ADAPTER_HANDLER_FAILED", error?.message ?? "Adapter handler failed");
};

const isPolicyFailure = (error) => error.code.startsWith("ADAPTER_SECRET_")
  || error.code === "ADAPTER_SCOPE_DENIED"
  || error.code === "ADAPTER_ID_BOUNDARY_VIOLATION"
  || error.code === "ADAPTER_REVIEW_BYPASS"
  || error.code.startsWith("ADAPTER_CONTRACT_");

const normalizeWebhookEvent = async (definition, value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ADAPTER_CONTRACT_INVALID", "Webhook result must be an object");
  const unknown = Object.keys(value).filter((key) => !["eventId", "eventType", "occurredAt", "sourceVersion", "payload", "checksum"].includes(key));
  if (unknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Webhook result contains unknown fields", { fields: unknown.sort() });
  for (const field of ["eventId", "eventType", "occurredAt", "sourceVersion"]) if (typeof value[field] !== "string" || !value[field]) fail("ADAPTER_CONTRACT_INVALID", `Webhook ${field} is required`);
  const content = { adapterId: definition.id, adapterVersion: definition.version, eventId: value.eventId, eventType: value.eventType, occurredAt: value.occurredAt, sourceVersion: value.sourceVersion, payload: clone(value.payload) };
  const checksum = await sha256Checksum(content);
  if (value.checksum !== undefined && value.checksum !== checksum) fail("ADAPTER_CHECKSUM_MISMATCH", "Webhook checksum does not match normalized content", { eventId: value.eventId });
  return Object.freeze({ schemaVersion: 1, ...content, checksum });
};

const normalizeExport = async (definition, value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("ADAPTER_CONTRACT_INVALID", "Export result must be an object");
  const unknown = Object.keys(value).filter((key) => !["mediaType", "sourceVersion", "data", "checksum"].includes(key));
  if (unknown.length) fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Export result contains unknown fields", { fields: unknown.sort() });
  for (const field of ["mediaType", "sourceVersion"]) if (typeof value[field] !== "string" || !value[field]) fail("ADAPTER_CONTRACT_INVALID", `Export ${field} is required`);
  const content = { adapterId: definition.id, adapterVersion: definition.version, mediaType: value.mediaType, sourceVersion: value.sourceVersion, data: clone(value.data) };
  const checksum = await sha256Checksum(content);
  if (value.checksum !== undefined && value.checksum !== checksum) fail("ADAPTER_CHECKSUM_MISMATCH", "Export checksum does not match normalized content");
  return Object.freeze({ schemaVersion: 1, ...content, checksum });
};

export function createVenueAdapter(definitionInput, handlers) {
  const definition = defineAdapter(definitionInput);
  if (!handlers || typeof handlers !== "object" || Array.isArray(handlers)) fail("ADAPTER_CONTRACT_INVALID", "Adapter handlers must be an object");
  const unknown = Object.keys(handlers).filter((key) => !definition.capabilities.includes(key));
  if (unknown.length) fail("ADAPTER_CAPABILITY_UNDECLARED", "Adapter implements undeclared capabilities", { capabilities: unknown.sort() });
  for (const capability of definition.capabilities) if (typeof handlers[capability] !== "function") fail("ADAPTER_HANDLER_MISSING", `Adapter handler is missing for ${capability}`);

  return Object.freeze({
    definition,
    async invoke(capability, input, context) {
      if (!definition.capabilities.includes(capability)) fail("ADAPTER_CAPABILITY_UNSUPPORTED", `${definition.id} does not support ${capability}`);
      const output = await handlers[capability](clone(input), context);
      if (capability === "import" || capability === "synchronize") {
        const staging = await createAdapterStagingBatch(definition, output, { clock: context.clock, basePlanVersion: input?.basePlanVersion });
        assertReviewableStagingBatch(staging);
        return staging;
      }
      if (capability === "export") return normalizeExport(definition, output);
      if (capability === "webhook") return normalizeWebhookEvent(definition, output);
      return clone(output);
    },
  });
}

export function createAdapterRuntime(options = {}) {
  const clock = options.clock ?? (() => Date.now());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadLetterSink = options.deadLetterSink ?? { async add() {} };
  const requestTimes = new Map();
  const processedWebhooks = new Map();

  const acquireRateLimit = async (definition) => {
    const key = `${definition.id}@${definition.version}`;
    const now = clock();
    const retained = (requestTimes.get(key) ?? []).filter((time) => time > now - definition.rateLimit.windowMs);
    if (retained.length >= definition.rateLimit.requests) {
      const waitMs = Math.max(0, retained[0] + definition.rateLimit.windowMs - now);
      await sleep(waitMs);
      const advanced = clock();
      requestTimes.set(key, retained.filter((time) => time > advanced - definition.rateLimit.windowMs));
    } else requestTimes.set(key, retained);
    requestTimes.get(key).push(clock());
  };

  return Object.freeze({
    async execute(adapter, capability, input, authorization = {}) {
      const { definition } = adapter;
      assertAdapterScope(definition, capability, authorization.grantedScopes ?? []);
      const invocationId = adapterInvocationId(definition, capability, input);
      const inputChecksum = await sha256Checksum(input);
      const attempts = [];
      const secretReader = createScopedSecretReader(authorization.secretStore, authorization.secretReferences ?? []);
      for (let attempt = 1; attempt <= definition.retryPolicy.maxAttempts; attempt += 1) {
        await acquireRateLimit(definition);
        try {
          const output = await adapter.invoke(capability, input, { invocationId, attempt, clock: () => new Date(clock()).toISOString(), secrets: secretReader });
          attempts.push({ attempt, status: "succeeded", at: new Date(clock()).toISOString() });
          return { status: "succeeded", invocationId, attempts, output };
        } catch (cause) {
          const error = asAdapterFailure(cause);
          if (isPolicyFailure(error)) throw error;
          const retryable = definition.retryPolicy.retryableCodes.includes(error.code);
          const exhausted = attempt === definition.retryPolicy.maxAttempts;
          attempts.push({ attempt, status: retryable && !exhausted ? "retrying" : "failed", code: error.code, at: new Date(clock()).toISOString() });
          if (!retryable || exhausted) {
            const deadLetter = Object.freeze({
              schemaVersion: 1,
              id: `${invocationId}-dead-letter`,
              adapterId: definition.id,
              adapterVersion: definition.version,
              capability,
              inputChecksum,
              failedAt: new Date(clock()).toISOString(),
              attempts: clone(attempts),
              terminalCode: error.code,
            });
            await deadLetterSink.add(deadLetter);
            return { status: "dead-lettered", invocationId, attempts, deadLetter, error };
          }
          const exponential = definition.retryPolicy.initialDelayMs * (definition.retryPolicy.multiplier ** (attempt - 1));
          const requested = Number.isFinite(error.details?.retryAfterMs) ? error.details.retryAfterMs : 0;
          const delayMs = Math.min(definition.retryPolicy.maximumDelayMs, Math.max(exponential, requested));
          attempts.at(-1).delayMs = delayMs;
          await sleep(delayMs);
        }
      }
      throw new Error("Unreachable adapter attempt state");
    },

    async acceptWebhook(adapter, input, authorization = {}) {
      const result = await this.execute(adapter, "webhook", input, authorization);
      if (result.status !== "succeeded") return result;
      const key = `${adapter.definition.id}\u0000${result.output.eventId}`;
      const existing = processedWebhooks.get(key);
      if (existing) {
        if (existing.checksum !== result.output.checksum) fail("ADAPTER_WEBHOOK_REPLAY_MISMATCH", "Webhook event ID was replayed with different content", { eventId: result.output.eventId });
        return { ...result, status: "duplicate", output: clone(existing) };
      }
      processedWebhooks.set(key, clone(result.output));
      return result;
    },

    inspectRateLimit(adapter) {
      return clone(requestTimes.get(`${adapter.definition.id}@${adapter.definition.version}`) ?? []);
    },
  });
}

export function createMemoryDeadLetterSink() {
  const items = [];
  return Object.freeze({
    async add(item) { items.push(clone(item)); },
    list() { return clone(items); },
  });
}

export function verifySyncCursor(definition, cursor) {
  const normalized = normalizeSyncCursor(cursor, definition);
  if (!normalized) return null;
  const { checksum, ...payload } = normalized;
  return sha256Checksum(payload).then((actual) => {
    if (actual !== checksum) fail("ADAPTER_CHECKSUM_MISMATCH", "Synchronization cursor checksum does not match", { expected: checksum, actual });
    return normalized;
  });
}

export const serializeDeadLetter = (deadLetter) => `${canonicalStringify(deadLetter)}\n`;
