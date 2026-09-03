import * as contracts from "../../../src/integrations/contracts.ts";
import * as runtime from "../../../src/integrations/runtime.ts";
import { createExternalIdMapping as internalCreateExternalIdMapping } from "../../../src/integrations/staging.ts";
import { collectAdapterPages as internalCollectAdapterPages } from "../../../src/integrations/pagination.ts";
import {
  adapterHttpError as internalAdapterHttpError,
  normalizeRetryAfter as internalNormalizeRetryAfter,
} from "../../../src/integrations/http-errors.ts";
import { verifyWebhookHmac as internalVerifyWebhookHmac } from "../../../src/integrations/webhook-signatures.ts";

export type AdapterCapability = "import" | "export" | "synchronize" | "webhook";
export type AdapterImportResultMode = "reviewable-proposal" | "aggregate-snapshot";
export type VenueEntityType =
  "event-brief-requirement" | "inventory-item-template" | "project" | "project-object-instance";

export interface AdapterRetryPolicy {
  readonly maxAttempts?: number;
  readonly initialDelayMs?: number;
  readonly maximumDelayMs?: number;
  readonly multiplier?: number;
  readonly retryableCodes?: readonly string[];
}

export interface AdapterRateLimit {
  readonly requests?: number;
  readonly windowMs?: number;
}

export interface AdapterDefinitionInput {
  readonly contractVersion: 1;
  readonly id: string;
  readonly displayName: string;
  readonly version: string;
  readonly capabilities: readonly AdapterCapability[];
  readonly importResultMode?: AdapterImportResultMode;
  readonly scopes: Readonly<Partial<Record<AdapterCapability, readonly string[]>>>;
  readonly retryPolicy?: AdapterRetryPolicy;
  readonly rateLimit?: AdapterRateLimit;
}

export interface AdapterDefinition extends Omit<
  AdapterDefinitionInput,
  "importResultMode" | "retryPolicy" | "rateLimit"
> {
  readonly importResultMode: AdapterImportResultMode;
  readonly retryPolicy: Readonly<Required<AdapterRetryPolicy>>;
  readonly rateLimit: Readonly<Required<AdapterRateLimit>>;
}

export interface AdapterSecretReader {
  get(reference: string): Promise<string>;
}

export interface AdapterHandlerContext {
  readonly invocationId: string;
  readonly attempt: number;
  readonly clock: () => string;
  readonly secrets: AdapterSecretReader;
}

export type AdapterHandler<Input, Output> = (input: Input, context: AdapterHandlerContext) => Promise<Output> | Output;

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

export interface AdapterAuthorization {
  readonly grantedScopes?: readonly string[];
  readonly secretStore?: AdapterSecretReader;
  readonly secretReferences?: readonly string[];
  readonly trustedAdapterContexts?: Readonly<Record<string, unknown>>;
}

export interface AdapterAttempt {
  readonly attempt: number;
  readonly status: "succeeded" | "retrying" | "failed";
  readonly at: string;
  readonly code?: string;
  readonly delayMs?: number;
}

export interface AdapterDeadLetter {
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

export interface AdapterRuntimeResult<Output = unknown> {
  readonly status: "succeeded" | "duplicate" | "dead-lettered";
  readonly invocationId: string;
  readonly attempts: readonly AdapterAttempt[];
  readonly output?: Output;
  readonly duplicateOf?: string;
  readonly deadLetter?: AdapterDeadLetter;
  readonly error?: AdapterContractError;
}

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

export interface AdapterRuntime {
  execute<Contracts extends AdapterContractMap, Capability extends AdapterContractCapability<Contracts>>(
    adapter: VenueAdapter<Contracts>,
    capability: Capability,
    input: AdapterInput<Contracts, Capability>,
    authorization?: AdapterAuthorization,
  ): Promise<AdapterRuntimeResult<AdapterOutput<Contracts, Capability>>>;
  acceptWebhook<
    Contracts extends AdapterContractMap & Readonly<Record<"webhook", AdapterCapabilityContract<unknown, unknown>>>,
  >(
    adapter: VenueAdapter<Contracts>,
    input: Contracts["webhook"] extends AdapterCapabilityContract<infer Input, unknown> ? Input : never,
    authorization?: AdapterAuthorization,
  ): Promise<AdapterRuntimeResult<Readonly<NormalizedWebhookEvent>>>;
  inspectRateLimit<Contracts extends AdapterContractMap>(adapter: VenueAdapter<Contracts>): number[];
}

export interface AdapterDeadLetterSink {
  add(item: AdapterDeadLetter): Promise<void>;
}

export interface AdapterRuntimeOptions {
  readonly clock?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly deadLetterSink?: AdapterDeadLetterSink;
}

export interface AdapterContractError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
}

export const AdapterContractError: {
  new (code: string, message: string, details?: Readonly<Record<string, unknown>>): AdapterContractError;
} = contracts.AdapterContractError;

export const ADAPTER_CONTRACT_VERSION: 1 = contracts.ADAPTER_CONTRACT_VERSION;
export const ADAPTER_CAPABILITIES: readonly AdapterCapability[] = contracts.ADAPTER_CAPABILITIES;
export const ADAPTER_IMPORT_RESULT_MODES: readonly AdapterImportResultMode[] = contracts.ADAPTER_IMPORT_RESULT_MODES;

export function defineAdapter(input: AdapterDefinitionInput): Readonly<AdapterDefinition> {
  return contracts.defineAdapter(input);
}

export function createVenueAdapter<Contracts extends AdapterContractMap>(
  definition: AdapterDefinitionInput | AdapterDefinition,
  handlers: AdapterHandlers<Contracts>,
): Readonly<VenueAdapter<Contracts>> {
  return runtime.createVenueAdapter<Contracts>(definition, handlers);
}

export function createAdapterRuntime(options: AdapterRuntimeOptions = {}): Readonly<AdapterRuntime> {
  // The public SDK mirrors the runtime contract structurally while keeping its declarations repository-independent.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return runtime.createAdapterRuntime(options) as Readonly<AdapterRuntime>;
}

export const canonicalStringify = (value: unknown): string => contracts.canonicalStringify(value);
export const sha256Checksum = (value: unknown): Promise<string> => contracts.sha256Checksum(value);

export interface SyncCursor {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly opaque: string;
  readonly sourceVersion: string;
  readonly checksum: string;
}

export const createSyncCursor = (
  definition: AdapterDefinition,
  input: Readonly<{ opaque: string; sourceVersion: string }>,
): Promise<Readonly<SyncCursor>> => contracts.createSyncCursor(definition, input);

export const verifySyncCursor = async (
  definition: AdapterDefinition,
  cursor: unknown,
): Promise<Readonly<SyncCursor> | null> => runtime.verifySyncCursor(definition, cursor);

export const normalizeExternalReference = (
  input: Readonly<Record<string, unknown>>,
  definition: AdapterDefinition,
): Readonly<Record<string, unknown>> => ({ ...contracts.normalizeExternalReference(input, definition) });

export const normalizeAdapterChange = (
  input: Readonly<Record<string, unknown>>,
  definition: AdapterDefinition,
): Readonly<Record<string, unknown>> => ({ ...contracts.normalizeAdapterChange(input, definition) });

export interface ExternalReference {
  readonly adapterId: string;
  readonly sourceSystem: string;
  readonly entityType: string;
  readonly externalId: string;
  readonly sourceVersion: string;
  readonly checksum: string;
}

export interface ExternalIdMappingInput {
  readonly venueEntityType: VenueEntityType;
  readonly venueObjectId: string;
  readonly external: ExternalReference;
  readonly batchId: string;
  readonly sourceSystem: string;
  readonly sourceVersion: string;
  readonly synchronizedAt: string;
  readonly checksum: string;
}

export const createExternalIdMapping = (input: ExternalIdMappingInput): Readonly<Record<string, unknown>> => ({
  ...internalCreateExternalIdMapping(input),
});

export interface AdapterPage<Item> {
  readonly items: Item[];
  readonly nextCursor: string | null;
  readonly sourceVersion: string;
}

export interface CollectAdapterPagesOptions<Item> {
  readonly fetchPage: (
    input: Readonly<{ cursor: string | null; pageIndex: number; signal: AbortSignal | undefined }>,
  ) => Promise<AdapterPage<Item>> | AdapterPage<Item>;
  readonly initialCursor?: string | null;
  readonly maxPages?: number;
  readonly maxItems?: number;
  readonly signal?: AbortSignal;
}

export interface CollectedAdapterPages<Item> {
  readonly items: Item[];
  readonly nextCursor: null;
  readonly sourceVersion: string;
  readonly pageCount: number;
}

export const collectAdapterPages = <Item>(
  options: CollectAdapterPagesOptions<Item>,
): Promise<Readonly<CollectedAdapterPages<Item>>> => internalCollectAdapterPages(options);

export const normalizeRetryAfter = (
  value: unknown,
  options?: Readonly<{ now?: number; maximumRetryAfterMs?: number }>,
): number => internalNormalizeRetryAfter(value, options);

export const adapterHttpError = (
  responseOrCause: unknown,
  options?: Readonly<{ now?: number; maximumRetryAfterMs?: number }>,
): AdapterContractError => internalAdapterHttpError(responseOrCause, options);

export interface WebhookTimestampOptions {
  value: string;
  unit: "seconds" | "milliseconds";
  separator: string;
  toleranceMs: number;
}

export interface VerifyWebhookHmacOptions {
  body: Uint8Array;
  signature: string;
  secret: Uint8Array;
  algorithm: "SHA-256";
  encoding: "hex" | "base64" | "base64url";
  prefix: string;
  timestamp?: WebhookTimestampOptions | null;
  now?: number;
}

export const verifyWebhookHmac = (options: VerifyWebhookHmacOptions): Promise<boolean> =>
  internalVerifyWebhookHmac(options);
