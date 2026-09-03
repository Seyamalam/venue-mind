import {
  AdapterContractError,
  adapterInvocationId,
  assertIsoTimestamp,
  assertAdapterScope,
  canonicalStringify,
  defineAdapter,
  normalizeSyncCursor,
  sha256Checksum,
  type AdapterCapability,
  type AdapterDefinition,
} from "./contracts.ts";
import { createScopedSecretReader, type SecretReader } from "./secret-store.ts";
import {
  assertAdapterProjectContext,
  assertReviewableStagingBatch,
  assertStagingBatchIntegrity,
  createAdapterStagingBatch,
  isAdapterStagingBatch,
  type AdapterProjectContext,
  type AdapterStagingBatch,
} from "./staging.ts";
import { createMemoryProcessedBatchStore, type ProcessedBatchStore } from "./processed-batch-store.ts";
import type { WebhookEventStore } from "./webhook-event-store.ts";

const clone = <Value>(value: Value): Value => structuredClone(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const fail = (code: string, message: string, details: Readonly<Record<string, unknown>> = {}): never => {
  throw new AdapterContractError(code, message, details);
};

const asAdapterFailure = (error: unknown): AdapterContractError => {
  if (error instanceof AdapterContractError) return error;
  const code = isRecord(error) && typeof error["code"] === "string" ? error["code"] : "ADAPTER_HANDLER_FAILED";
  const message = error instanceof Error ? error.message : "Adapter handler failed";
  return new AdapterContractError(code, message);
};

const isPolicyFailure = (error: AdapterContractError): boolean =>
  error.code.startsWith("ADAPTER_SECRET_") ||
  error.code === "ADAPTER_SCOPE_DENIED" ||
  error.code === "ADAPTER_SOURCE_MISMATCH" ||
  error.code === "ADAPTER_ID_BOUNDARY_VIOLATION" ||
  error.code === "ADAPTER_REVIEW_BYPASS" ||
  error.code === "ADAPTER_BASE_OBJECT_CONFLICT" ||
  error.code === "ADAPTER_BASE_PLAN_VERSION_REQUIRED" ||
  error.code === "ADAPTER_PROPOSAL_REVISION_REQUIRED" ||
  error.code === "ADAPTER_STAGING_INTEGRITY_FAILED" ||
  error.code === "ADAPTER_PROJECT_BINDING_REQUIRED" ||
  error.code === "ADAPTER_PROJECT_BINDING_MISMATCH" ||
  error.code === "ADAPTER_PLANNING_BINDING_MISMATCH" ||
  error.code === "ADAPTER_WEBHOOK_STORE_REQUIRED" ||
  error.code === "ADAPTER_WEBHOOK_STORE_INTEGRITY_FAILED" ||
  error.code === "ADAPTER_PROCESSED_STORE_INTEGRITY_FAILED" ||
  error.code === "ADAPTER_ENTITY_TYPE_INVALID" ||
  error.code === "ADAPTER_ENTITY_TYPE_UNSUPPORTED" ||
  error.code === "ADAPTER_PROTECTED_FIELD" ||
  error.code === "ADAPTER_CHECKSUM_INVALID" ||
  error.code === "ADAPTER_CHECKSUM_MISMATCH" ||
  error.code === "ADAPTER_PERSONAL_DATA_REJECTED" ||
  error.code.startsWith("ADAPTER_CONTRACT_");

export interface NormalizedWebhookEvent<Payload = unknown> {
  readonly schemaVersion: 1;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceSystem: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly sourceVersion: string;
  readonly payload: Payload;
  readonly checksum: string;
}

export interface NormalizedAdapterExport<Data = unknown> {
  readonly schemaVersion: 1;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly sourceSystem: string;
  readonly mediaType: string;
  readonly sourceVersion: string;
  readonly data: Data;
  readonly checksum: string;
}

export interface AdapterHandlerContext {
  readonly invocationId: string;
  readonly attempt: number;
  readonly clock: () => string;
  readonly secrets: SecretReader;
}

export interface AdapterCapabilityContract<Input, Output, HandlerOutput = Output> {
  readonly input: Input;
  readonly output: Output;
  readonly handlerOutput?: HandlerOutput;
}

export type AdapterContractMap = Readonly<
  Partial<Record<AdapterCapability, AdapterCapabilityContract<unknown, unknown>>>
>;
export type LooseAdapterContractMap = Readonly<Record<AdapterCapability, AdapterCapabilityContract<unknown, unknown>>>;
declare const adapterContractType: unique symbol;

export type AdapterContractCapability<Contracts extends AdapterContractMap> = Extract<
  keyof Contracts,
  AdapterCapability
>;

export type AdapterInput<
  Contracts extends AdapterContractMap,
  Capability extends AdapterContractCapability<Contracts>,
> = NonNullable<Contracts[Capability]>["input"];

export type AdapterOutput<
  Contracts extends AdapterContractMap,
  Capability extends AdapterContractCapability<Contracts>,
> = NonNullable<Contracts[Capability]>["output"];

export type AdapterHandlerOutput<
  Contracts extends AdapterContractMap,
  Capability extends AdapterContractCapability<Contracts>,
> =
  NonNullable<Contracts[Capability]> extends AdapterCapabilityContract<unknown, unknown, infer HandlerOutput>
    ? HandlerOutput
    : never;

export type AdapterHandler<Input, Output> = (input: Input, context: AdapterHandlerContext) => Promise<Output> | Output;

export type AdapterHandlers<Contracts extends AdapterContractMap> = Readonly<{
  [Capability in AdapterContractCapability<Contracts>]?: AdapterHandler<
    AdapterInput<Contracts, Capability>,
    AdapterHandlerOutput<Contracts, Capability>
  >;
}>;

export interface VenueAdapter<Contracts extends AdapterContractMap = LooseAdapterContractMap> {
  readonly definition: AdapterDefinition;
  readonly [adapterContractType]?: Contracts;
  invoke<Capability extends AdapterContractCapability<Contracts>>(
    capability: Capability,
    input: AdapterInput<Contracts, Capability>,
    context: AdapterHandlerContext,
  ): Promise<AdapterOutput<Contracts, Capability>>;
  prepareInput?(capability: AdapterCapability, input: unknown, context: Readonly<{ adapterContext: unknown }>): unknown;
  assertImportResult?(
    output: unknown,
    context?: Readonly<{ capability?: AdapterCapability; preparedInput?: unknown }>,
  ): unknown;
  assertWebhookResult?(
    output: unknown,
    context?: Readonly<{ capability?: AdapterCapability; preparedInput?: unknown }>,
  ): unknown;
}

const isNormalizedWebhookEvent = (value: unknown): value is NormalizedWebhookEvent =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["sourceSystem"] === "string" &&
  typeof value["eventId"] === "string" &&
  typeof value["checksum"] === "string";

const normalizeWebhookEvent = async (
  definition: AdapterDefinition,
  value: unknown,
): Promise<Readonly<NormalizedWebhookEvent>> => {
  if (!isRecord(value)) return fail("ADAPTER_CONTRACT_INVALID", "Webhook result must be an object");
  const unknown = Object.keys(value).filter(
    (key) =>
      !["sourceSystem", "eventId", "eventType", "occurredAt", "sourceVersion", "payload", "checksum"].includes(key),
  );
  if (unknown.length)
    fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Webhook result contains unknown fields", { fields: unknown.sort() });
  const sourceSystem = value["sourceSystem"];
  const eventId = value["eventId"];
  const eventType = value["eventType"];
  const occurredAt = value["occurredAt"];
  const sourceVersion = value["sourceVersion"];
  if (
    typeof sourceSystem !== "string" ||
    !sourceSystem ||
    typeof eventId !== "string" ||
    !eventId ||
    typeof eventType !== "string" ||
    !eventType ||
    typeof occurredAt !== "string" ||
    !occurredAt ||
    typeof sourceVersion !== "string" ||
    !sourceVersion
  )
    return fail("ADAPTER_CONTRACT_INVALID", "Webhook identity fields are required");
  assertIsoTimestamp(occurredAt, "Webhook occurredAt");
  const content = {
    adapterId: definition.id,
    adapterVersion: definition.version,
    sourceSystem,
    eventId,
    eventType,
    occurredAt,
    sourceVersion,
    payload: clone(value["payload"]),
  };
  const checksum = await sha256Checksum(content);
  if (value["checksum"] !== undefined && value["checksum"] !== checksum)
    fail("ADAPTER_CHECKSUM_MISMATCH", "Webhook checksum does not match normalized content", { eventId });
  return Object.freeze({ schemaVersion: 1, ...content, checksum });
};

const validateStoredWebhookEvent = async (
  definition: AdapterDefinition,
  value: unknown,
  expected: NormalizedWebhookEvent,
  inserted: boolean,
): Promise<Readonly<NormalizedWebhookEvent>> => {
  if (!isRecord(value)) return fail("ADAPTER_WEBHOOK_STORE_INTEGRITY_FAILED", "Webhook store returned an invalid row");
  const allowed = [
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
  ];
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length)
    fail("ADAPTER_WEBHOOK_STORE_INTEGRITY_FAILED", "Webhook store row contains unknown fields", {
      fields: unknown.sort(),
    });
  const adapterId = value["adapterId"];
  const adapterVersion = value["adapterVersion"];
  const sourceSystem = value["sourceSystem"];
  const eventId = value["eventId"];
  const eventType = value["eventType"];
  const occurredAt = value["occurredAt"];
  const sourceVersion = value["sourceVersion"];
  const storedChecksum = value["checksum"];
  if (
    value["schemaVersion"] !== 1 ||
    adapterId !== definition.id ||
    adapterVersion !== definition.version ||
    sourceSystem !== expected.sourceSystem ||
    eventId !== expected.eventId
  )
    fail("ADAPTER_WEBHOOK_STORE_INTEGRITY_FAILED", "Webhook store row identity does not match its durable key", {
      adapterId,
      adapterVersion,
      sourceSystem,
      eventId,
    });
  if (
    typeof eventType !== "string" ||
    !eventType ||
    typeof occurredAt !== "string" ||
    !occurredAt ||
    typeof sourceVersion !== "string" ||
    !sourceVersion ||
    typeof adapterId !== "string" ||
    typeof adapterVersion !== "string" ||
    typeof sourceSystem !== "string" ||
    typeof eventId !== "string" ||
    typeof storedChecksum !== "string"
  )
    return fail("ADAPTER_WEBHOOK_STORE_INTEGRITY_FAILED", "Webhook store fields are invalid");
  try {
    assertIsoTimestamp(occurredAt, "Webhook store occurredAt");
  } catch (error) {
    fail(
      "ADAPTER_WEBHOOK_STORE_INTEGRITY_FAILED",
      error instanceof Error ? error.message : "Webhook store timestamp is invalid",
    );
  }
  const content = {
    adapterId,
    adapterVersion,
    sourceSystem,
    eventId,
    eventType,
    occurredAt,
    sourceVersion,
    payload: clone(value["payload"]),
  };
  const checksum = await sha256Checksum(content);
  const schemaBoundChecksum = await sha256Checksum({ schemaVersion: 1, ...content });
  if (![checksum, schemaBoundChecksum].includes(storedChecksum))
    fail("ADAPTER_WEBHOOK_STORE_INTEGRITY_FAILED", "Webhook store row checksum does not match its normalized content", {
      eventId,
    });
  if (storedChecksum !== expected.checksum) {
    const code = inserted ? "ADAPTER_WEBHOOK_STORE_INTEGRITY_FAILED" : "ADAPTER_WEBHOOK_REPLAY_MISMATCH";
    fail(
      code,
      inserted
        ? "Webhook store did not persist the accepted event exactly"
        : "Webhook event ID was replayed with different content",
      { eventId, sourceSystem },
    );
  }
  return Object.freeze({ schemaVersion: 1, ...content, checksum: storedChecksum });
};

const normalizeExport = async (
  definition: AdapterDefinition,
  value: unknown,
): Promise<Readonly<NormalizedAdapterExport>> => {
  if (!isRecord(value)) return fail("ADAPTER_CONTRACT_INVALID", "Export result must be an object");
  const unknown = Object.keys(value).filter(
    (key) => !["sourceSystem", "mediaType", "sourceVersion", "data", "checksum"].includes(key),
  );
  if (unknown.length)
    fail("ADAPTER_CONTRACT_UNKNOWN_FIELD", "Export result contains unknown fields", { fields: unknown.sort() });
  const sourceSystem = value["sourceSystem"];
  const mediaType = value["mediaType"];
  const sourceVersion = value["sourceVersion"];
  if (
    typeof sourceSystem !== "string" ||
    !sourceSystem ||
    typeof mediaType !== "string" ||
    !mediaType ||
    typeof sourceVersion !== "string" ||
    !sourceVersion
  )
    return fail("ADAPTER_CONTRACT_INVALID", "Export identity fields are required");
  const content = {
    adapterId: definition.id,
    adapterVersion: definition.version,
    sourceSystem,
    mediaType,
    sourceVersion,
    data: clone(value["data"]),
  };
  const checksum = await sha256Checksum(content);
  if (value["checksum"] !== undefined && value["checksum"] !== checksum)
    fail("ADAPTER_CHECKSUM_MISMATCH", "Export checksum does not match normalized content");
  return Object.freeze({ schemaVersion: 1, ...content, checksum });
};

const assertAggregateImportResult = async <Contracts extends AdapterContractMap>(
  adapter: VenueAdapter<Contracts>,
  output: unknown,
  capability: AdapterCapability,
  preparedInput: unknown,
): Promise<unknown> => {
  if (!adapter.assertImportResult)
    return fail("ADAPTER_CONTRACT_INVALID", "Aggregate snapshot adapters require an import-result validator", {
      adapterId: adapter.definition.id,
    });
  await adapter.assertImportResult(output, { capability, preparedInput: clone(preparedInput) });
  return output;
};

export function createVenueAdapter<Contracts extends AdapterContractMap>(
  definitionInput: unknown,
  handlers: AdapterHandlers<Contracts>,
): Readonly<VenueAdapter<Contracts>> {
  const definition = defineAdapter(definitionInput);
  const declaredCapabilities: ReadonlySet<string> = new Set(definition.capabilities);
  const unknown = Object.keys(handlers).filter((key) => !declaredCapabilities.has(key));
  if (unknown.length)
    fail("ADAPTER_CAPABILITY_UNDECLARED", "Adapter implements undeclared capabilities", {
      capabilities: unknown.sort(),
    });
  for (const capability of definition.capabilities)
    if (typeof handlers[capability] !== "function")
      fail("ADAPTER_HANDLER_MISSING", `Adapter handler is missing for ${capability}`);

  const adapter = Object.freeze({
    definition,
    async invoke(capability: AdapterCapability, input: unknown, context: AdapterHandlerContext): Promise<unknown> {
      if (!definition.capabilities.includes(capability))
        fail("ADAPTER_CAPABILITY_UNSUPPORTED", `${definition.id} does not support ${capability}`);
      const handler = handlers[capability] as AdapterHandler<unknown, unknown> | undefined;
      if (!handler) return fail("ADAPTER_HANDLER_MISSING", `Adapter handler is missing for ${capability}`);
      const output = await handler(clone(input), context);
      if (capability === "import" || capability === "synchronize") {
        const basePlanVersion = isRecord(input) ? input["basePlanVersion"] : undefined;
        const proposalRevision = isRecord(input) ? input["proposalRevision"] : undefined;
        const staging = await createAdapterStagingBatch(definition, output, {
          ...(typeof basePlanVersion === "string" ? { basePlanVersion } : {}),
          ...(typeof proposalRevision === "number" ? { proposalRevision } : {}),
        });
        if (staging.status === "awaiting-review")
          await assertReviewableStagingBatch(staging, null, { requireProjectContext: false });
        else if (staging.status !== "no-changes" || staging.proposal !== null)
          fail("ADAPTER_STAGING_INTEGRITY_FAILED", "No-change staging must not contain a Proposal");
        return staging;
      }
      if (capability === "export") return normalizeExport(definition, output);
      if (capability === "webhook") return normalizeWebhookEvent(definition, output);
      return clone(output);
    },
  });
  return adapter as Readonly<VenueAdapter<Contracts>>;
}

interface ProcessedBatch {
  readonly invocationId: string;
  readonly inputChecksum: string;
  readonly completedAt: string;
  readonly output: unknown;
}

interface DeadLetter {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly capability: AdapterCapability;
  readonly inputChecksum: string;
  readonly failedAt: string;
  readonly attempts: readonly AdapterAttempt[];
  readonly terminalCode: string;
}

interface AdapterAttempt {
  readonly attempt: number;
  readonly status: "succeeded" | "retrying" | "failed";
  readonly at: string;
  readonly code?: string;
  delayMs?: number;
}

interface DeadLetterSink {
  add(item: DeadLetter): Promise<void>;
}
interface AdapterAuthorization {
  readonly grantedScopes?: readonly string[];
  readonly trustedAdapterContexts?: Readonly<Record<string, unknown>>;
  readonly secretStore?: SecretReader;
  readonly secretReferences?: readonly string[];
}
interface AdapterRuntimeOptions {
  readonly clock?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly deadLetterSink?: DeadLetterSink;
  readonly processedBatchStore?: ProcessedBatchStore<ProcessedBatch>;
  readonly webhookEventStore?: WebhookEventStore<NormalizedWebhookEvent> | null;
  readonly resolveProjectContext?: (
    input: Readonly<{ adapterId: string; adapterVersion: string; capability: AdapterCapability; sourceSystem: string }>,
  ) => Promise<AdapterProjectContext | null> | AdapterProjectContext | null;
  readonly projectContext?: AdapterProjectContext | null;
}

export function createAdapterRuntime(options: AdapterRuntimeOptions = {}) {
  const clock = options.clock ?? (() => Date.now());
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const deadLetterSink: DeadLetterSink = options.deadLetterSink ?? { add: async () => Promise.resolve() };
  const processedBatchStore = options.processedBatchStore ?? createMemoryProcessedBatchStore<ProcessedBatch>();
  const webhookEventStore = options.webhookEventStore ?? null;
  const resolveProjectContext =
    typeof options.resolveProjectContext === "function"
      ? options.resolveProjectContext
      : async () => options.projectContext ?? null;
  const requestTimes = new Map<string, number[]>();

  const validateStagingForPersistence = async (
    definition: AdapterDefinition,
    capability: AdapterCapability,
    output: AdapterStagingBatch,
  ): Promise<AdapterStagingBatch> => {
    await assertStagingBatchIntegrity(output);
    const hasProjectMapping = output.mappings.some((mapping) => mapping.venueEntityType === "project");
    const projectContext = hasProjectMapping
      ? await resolveProjectContext({
          adapterId: definition.id,
          adapterVersion: definition.version,
          capability,
          sourceSystem: output.sourceSystem,
        })
      : null;
    assertAdapterProjectContext(output, projectContext);
    if (output.status === "awaiting-review") await assertReviewableStagingBatch(output, projectContext);
    else if (output.status !== "no-changes" || output.proposal !== null)
      fail("ADAPTER_STAGING_INTEGRITY_FAILED", "No-change staging must not contain a Proposal");
    return output;
  };

  const validateImportForPersistence = async <Contracts extends AdapterContractMap>(
    adapter: VenueAdapter<Contracts>,
    capability: AdapterCapability,
    output: unknown,
    preparedInput: unknown,
  ): Promise<unknown> => {
    if (adapter.definition.importResultMode === "reviewable-proposal") {
      if (!isAdapterStagingBatch(output))
        return fail("ADAPTER_STAGING_INTEGRITY_FAILED", "Adapter staging output is invalid");
      await validateStagingForPersistence(adapter.definition, capability, output);
      if (adapter.assertImportResult)
        await adapter.assertImportResult(output, { capability, preparedInput: clone(preparedInput) });
      return output;
    }
    if (adapter.definition.importResultMode === "aggregate-snapshot")
      return assertAggregateImportResult(adapter, output, capability, preparedInput);
    return fail("ADAPTER_CONTRACT_INVALID", "Adapter importResultMode is unsupported", {
      adapterId: adapter.definition.id,
    });
  };

  const validateStoredProcessedBatch = async <Contracts extends AdapterContractMap>(
    adapter: VenueAdapter<Contracts>,
    capability: AdapterCapability,
    value: ProcessedBatch,
    expected: Readonly<{ invocationId: string; inputChecksum: string; completedAt?: string; output?: unknown }>,
    preparedInput: unknown,
    requireExactOutput = false,
  ): Promise<ProcessedBatch> => {
    const unknown = Object.keys(value).filter(
      (key) => !["invocationId", "inputChecksum", "completedAt", "output"].includes(key),
    );
    if (
      unknown.length ||
      value.invocationId !== expected.invocationId ||
      value.inputChecksum !== expected.inputChecksum
    )
      fail(
        "ADAPTER_PROCESSED_STORE_INTEGRITY_FAILED",
        "Processed batch store row identity does not match its durable key",
      );
    try {
      assertIsoTimestamp(value.completedAt, "Processed batch completedAt");
    } catch {
      fail("ADAPTER_PROCESSED_STORE_INTEGRITY_FAILED", "Processed batch store timestamp is invalid");
    }
    await validateImportForPersistence(adapter, capability, value.output, preparedInput);
    if (expected.completedAt !== undefined && value.completedAt !== expected.completedAt)
      fail("ADAPTER_PROCESSED_STORE_INTEGRITY_FAILED", "Processed batch store changed the completion timestamp");
    if (requireExactOutput && (await sha256Checksum(value.output)) !== (await sha256Checksum(expected.output)))
      fail(
        "ADAPTER_PROCESSED_STORE_INTEGRITY_FAILED",
        "Processed batch store did not persist the accepted output exactly",
      );
    return value;
  };

  const acquireRateLimit = async (definition: AdapterDefinition): Promise<void> => {
    const key = `${definition.id}@${definition.version}`;
    const now = clock();
    const retained = (requestTimes.get(key) ?? []).filter((time) => time > now - definition.rateLimit.windowMs);
    if (retained.length >= definition.rateLimit.requests) {
      const firstRetained = retained[0];
      if (firstRetained === undefined) return fail("ADAPTER_RATE_LIMIT_INVALID", "Adapter rate-limit state is invalid");
      const waitMs = Math.max(0, firstRetained + definition.rateLimit.windowMs - now);
      await sleep(waitMs);
      const advanced = clock();
      requestTimes.set(
        key,
        retained.filter((time) => time > advanced - definition.rateLimit.windowMs),
      );
    } else requestTimes.set(key, retained);
    const times = requestTimes.get(key) ?? [];
    times.push(clock());
    requestTimes.set(key, times);
  };

  type AdapterExecutionResult<Output> =
    | Readonly<{ status: "succeeded"; invocationId: string; attempts: readonly AdapterAttempt[]; output: Output }>
    | Readonly<{
        status: "duplicate";
        invocationId: string;
        attempts: readonly AdapterAttempt[];
        duplicateOf?: string;
        output: Output;
      }>
    | Readonly<{
        status: "dead-lettered";
        invocationId: string;
        attempts: readonly AdapterAttempt[];
        deadLetter: DeadLetter;
        error: AdapterContractError;
      }>;

  const execute = async <Contracts extends AdapterContractMap, Capability extends AdapterContractCapability<Contracts>>(
    adapter: VenueAdapter<Contracts>,
    capability: Capability,
    input: AdapterInput<Contracts, Capability>,
    authorization: AdapterAuthorization = {},
  ): Promise<AdapterExecutionResult<AdapterOutput<Contracts, Capability>>> => {
    const { definition } = adapter;
    assertAdapterScope(definition, capability, authorization.grantedScopes ?? []);
    const adapterContext = authorization.trustedAdapterContexts?.[definition.id];
    const preparedInput =
      typeof adapter.prepareInput === "function"
        ? await adapter.prepareInput(capability, clone(input), { adapterContext: clone(adapterContext) })
        : clone(input);
    const invocationId = adapterInvocationId(definition, capability, preparedInput);
    const inputChecksum = await sha256Checksum(preparedInput);
    const stagesImport = capability === "import" || capability === "synchronize";
    const processedBatchKey = `${definition.id}@${definition.version}:${capability}:${inputChecksum}`;
    if (stagesImport) {
      const completed = await processedBatchStore.get(processedBatchKey);
      if (completed) {
        await validateStoredProcessedBatch(
          adapter,
          capability,
          completed,
          { invocationId, inputChecksum },
          preparedInput,
        );
        return {
          status: "duplicate",
          invocationId,
          attempts: [],
          duplicateOf: completed.completedAt,
          output: clone(completed.output) as AdapterOutput<Contracts, Capability>,
        };
      }
    }
    const attempts: AdapterAttempt[] = [];
    const secretReader = createScopedSecretReader(authorization.secretStore, authorization.secretReferences ?? []);
    for (let attempt = 1; attempt <= definition.retryPolicy.maxAttempts; attempt += 1) {
      await acquireRateLimit(definition);
      try {
        const output = await adapter.invoke(capability, preparedInput, {
          invocationId,
          attempt,
          clock: () => new Date(clock()).toISOString(),
          secrets: secretReader,
        });
        if (stagesImport) await validateImportForPersistence(adapter, capability, output, preparedInput);
        if (capability === "webhook" && typeof adapter.assertWebhookResult === "function")
          await adapter.assertWebhookResult(output, { capability, preparedInput: clone(preparedInput) });
        attempts.push({ attempt, status: "succeeded", at: new Date(clock()).toISOString() });
        if (stagesImport) {
          const completedAt = new Date(clock()).toISOString();
          const expected = { invocationId, inputChecksum, completedAt, output };
          const stored = await processedBatchStore.putIfAbsent(processedBatchKey, expected);
          const validationExpected = stored.inserted ? expected : { invocationId, inputChecksum };
          await validateStoredProcessedBatch(
            adapter,
            capability,
            stored.value,
            validationExpected,
            preparedInput,
            stored.inserted,
          );
          if (!stored.inserted)
            return {
              status: "duplicate",
              invocationId,
              attempts,
              duplicateOf: stored.value.completedAt,
              output: clone(stored.value.output) as AdapterOutput<Contracts, Capability>,
            };
          return {
            status: "succeeded",
            invocationId,
            attempts,
            output: clone(stored.value.output) as AdapterOutput<Contracts, Capability>,
          };
        }
        return { status: "succeeded", invocationId, attempts, output };
      } catch (cause) {
        const error = asAdapterFailure(cause);
        if (isPolicyFailure(error)) throw error;
        const retryable = definition.retryPolicy.retryableCodes.includes(error.code);
        const exhausted = attempt === definition.retryPolicy.maxAttempts;
        attempts.push({
          attempt,
          status: retryable && !exhausted ? "retrying" : "failed",
          code: error.code,
          at: new Date(clock()).toISOString(),
        });
        if (!retryable || exhausted) {
          const deadLetter: DeadLetter = Object.freeze({
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
        const exponential = definition.retryPolicy.initialDelayMs * definition.retryPolicy.multiplier ** (attempt - 1);
        const retryAfterMs = error.details["retryAfterMs"];
        const requested = typeof retryAfterMs === "number" && Number.isFinite(retryAfterMs) ? retryAfterMs : 0;
        const delayMs = Math.min(definition.retryPolicy.maximumDelayMs, Math.max(exponential, requested));
        const currentAttempt = attempts.at(-1);
        if (currentAttempt) currentAttempt.delayMs = delayMs;
        await sleep(delayMs);
      }
    }
    throw new Error("Unreachable adapter attempt state");
  };

  const acceptWebhook = async <Input, Output>(
    adapter: VenueAdapter<Readonly<{ webhook: AdapterCapabilityContract<Input, Output> }>>,
    input: Input,
    authorization: AdapterAuthorization = {},
  ): Promise<AdapterExecutionResult<Readonly<NormalizedWebhookEvent>>> => {
    const eventStore = webhookEventStore;
    if (!eventStore)
      return fail(
        "ADAPTER_WEBHOOK_STORE_REQUIRED",
        "Webhook acceptance requires an injected atomic durable event store",
      );
    const result = await execute(adapter, "webhook", input, authorization);
    if (result.status === "dead-lettered") return result;
    if (!isNormalizedWebhookEvent(result.output)) return fail("ADAPTER_CONTRACT_INVALID", "Webhook output is invalid");
    const key = `${adapter.definition.id}@${adapter.definition.version}\u0000${result.output.sourceSystem}\u0000${result.output.eventId}`;
    const stored = await eventStore.putIfAbsent(key, result.output);
    const storedOutput = await validateStoredWebhookEvent(
      adapter.definition,
      stored.value,
      result.output,
      stored.inserted,
    );
    if (typeof adapter.assertWebhookResult === "function") await adapter.assertWebhookResult(storedOutput);
    if (!stored.inserted) {
      return { ...result, status: "duplicate", output: clone(storedOutput) };
    }
    return { ...result, output: clone(storedOutput) };
  };

  const inspectRateLimit = <Contracts extends AdapterContractMap>(adapter: VenueAdapter<Contracts>): number[] => {
    return clone(requestTimes.get(`${adapter.definition.id}@${adapter.definition.version}`) ?? []);
  };

  return Object.freeze({ execute, acceptWebhook, inspectRateLimit });
}

export function createMemoryDeadLetterSink() {
  const items: DeadLetter[] = [];
  return Object.freeze({
    add(item: DeadLetter) {
      items.push(clone(item));
      return Promise.resolve();
    },
    list() {
      return clone(items);
    },
  });
}

export function verifySyncCursor(definition: AdapterDefinition, cursor: unknown) {
  const normalized = normalizeSyncCursor(cursor, definition);
  if (!normalized) return null;
  const { checksum, ...payload } = normalized;
  return sha256Checksum(payload).then((actual) => {
    if (actual !== checksum)
      fail("ADAPTER_CHECKSUM_MISMATCH", "Synchronization cursor checksum does not match", {
        expected: checksum,
        actual,
      });
    return normalized;
  });
}

export const serializeDeadLetter = (deadLetter: DeadLetter): string => `${canonicalStringify(deadLetter)}\n`;
