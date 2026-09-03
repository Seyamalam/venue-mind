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

export type AdapterHandler<Input = unknown, Output = unknown> = (
  input: Input,
  context: AdapterHandlerContext,
) => Promise<Output> | Output;
export type AdapterHandlers = Partial<Record<AdapterCapability, AdapterHandler>>;

export interface VenueAdapter {
  readonly definition: AdapterDefinition;
  invoke(capability: AdapterCapability, input: unknown, context: AdapterHandlerContext): Promise<unknown>;
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

export interface AdapterRuntime {
  execute(
    adapter: VenueAdapter,
    capability: AdapterCapability,
    input: unknown,
    authorization?: AdapterAuthorization,
  ): Promise<AdapterRuntimeResult>;
  acceptWebhook(
    adapter: VenueAdapter,
    input: unknown,
    authorization?: AdapterAuthorization,
  ): Promise<AdapterRuntimeResult>;
  inspectRateLimit(adapter: VenueAdapter): number[];
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

export function createVenueAdapter(
  definition: AdapterDefinitionInput | AdapterDefinition,
  handlers: AdapterHandlers,
): Readonly<VenueAdapter> {
  return runtime.createVenueAdapter(definition, handlers);
}

export function createAdapterRuntime(options: AdapterRuntimeOptions = {}): Readonly<AdapterRuntime> {
  return runtime.createAdapterRuntime(options);
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
