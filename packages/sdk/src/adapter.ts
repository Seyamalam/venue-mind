// @ts-expect-error Monorepo JavaScript implementation is bundled into the published entry point.
import * as contracts from "../../../src/integrations/contracts.js";
// @ts-expect-error Monorepo JavaScript implementation is bundled into the published entry point.
import * as runtime from "../../../src/integrations/runtime.js";
// @ts-expect-error Monorepo JavaScript implementation is bundled into the published entry point.
import { createExternalIdMapping as internalCreateExternalIdMapping } from "../../../src/integrations/staging.js";
// @ts-expect-error Monorepo JavaScript implementation is bundled into the published entry point.
import { collectAdapterPages as internalCollectAdapterPages } from "../../../src/integrations/pagination.js";
// @ts-expect-error Monorepo JavaScript implementation is bundled into the published entry point.
import { adapterHttpError as internalAdapterHttpError, normalizeRetryAfter as internalNormalizeRetryAfter } from "../../../src/integrations/http-errors.js";
// @ts-expect-error Monorepo JavaScript implementation is bundled into the published entry point.
import { verifyWebhookHmac as internalVerifyWebhookHmac } from "../../../src/integrations/webhook-signatures.js";

export type AdapterCapability = "import" | "export" | "synchronize" | "webhook";
export type AdapterImportResultMode = "reviewable-proposal" | "aggregate-snapshot";

export interface AdapterRetryPolicy {
  maxAttempts?: number;
  initialDelayMs?: number;
  maximumDelayMs?: number;
  multiplier?: number;
  retryableCodes?: string[];
}

export interface AdapterRateLimit {
  requests?: number;
  windowMs?: number;
}

export interface AdapterDefinitionInput {
  contractVersion: 1;
  id: string;
  displayName: string;
  version: string;
  capabilities: AdapterCapability[];
  importResultMode?: AdapterImportResultMode;
  scopes: Partial<Record<AdapterCapability, string[]>>;
  retryPolicy?: AdapterRetryPolicy;
  rateLimit?: AdapterRateLimit;
}

export interface AdapterDefinition extends Omit<AdapterDefinitionInput, "retryPolicy" | "rateLimit"> {
  readonly capabilities: AdapterCapability[];
  readonly importResultMode: AdapterImportResultMode;
  readonly retryPolicy: Required<AdapterRetryPolicy>;
  readonly rateLimit: Required<AdapterRateLimit>;
}

export interface AdapterSecretReader {
  get(reference: string): Promise<string>;
}

export interface AdapterHandlerContext {
  invocationId: string;
  attempt: number;
  clock(): string;
  secrets: AdapterSecretReader;
}

export type AdapterHandler<Input = unknown, Output = unknown> = (input: Input, context: AdapterHandlerContext) => Promise<Output> | Output;
export type AdapterHandlers = Partial<Record<AdapterCapability, AdapterHandler>>;

export interface VenueAdapter {
  readonly definition: AdapterDefinition;
  invoke(capability: AdapterCapability, input: unknown, context: AdapterHandlerContext): Promise<unknown>;
  prepareInput?(capability: AdapterCapability, input: unknown, context: { adapterContext: unknown }): Promise<unknown> | unknown;
  assertImportResult?(output: unknown, context?: unknown): Promise<void> | void;
  assertWebhookResult?(output: unknown, context?: unknown): Promise<void> | void;
}

export interface AdapterAuthorization {
  grantedScopes?: string[];
  secretStore?: unknown;
  secretReferences?: string[];
  trustedAdapterContexts?: Record<string, unknown>;
}

export interface AdapterRuntimeResult<Output = unknown> {
  status: "succeeded" | "duplicate" | "dead-lettered";
  invocationId: string;
  attempts: Array<Record<string, unknown>>;
  output?: Output;
  duplicateOf?: string;
  deadLetter?: Record<string, unknown>;
  error?: AdapterContractError;
}

export interface AdapterRuntime {
  execute<Output = unknown>(adapter: VenueAdapter, capability: AdapterCapability, input: unknown, authorization?: AdapterAuthorization): Promise<AdapterRuntimeResult<Output>>;
  acceptWebhook<Output = unknown>(adapter: VenueAdapter, input: unknown, authorization?: AdapterAuthorization): Promise<AdapterRuntimeResult<Output>>;
  inspectRateLimit(adapter: VenueAdapter): number[];
}

export interface AdapterContractError extends Error {
  readonly name: "AdapterContractError";
  readonly code: string;
  readonly details: Record<string, unknown>;
}

export const AdapterContractError = contracts.AdapterContractError as {
  new(code: string, message: string, details?: Record<string, unknown>): AdapterContractError;
};

export const ADAPTER_CONTRACT_VERSION = contracts.ADAPTER_CONTRACT_VERSION as 1;
export const ADAPTER_CAPABILITIES = contracts.ADAPTER_CAPABILITIES as readonly AdapterCapability[];
export const ADAPTER_IMPORT_RESULT_MODES = contracts.ADAPTER_IMPORT_RESULT_MODES as readonly AdapterImportResultMode[];
export const defineAdapter = contracts.defineAdapter as (input: AdapterDefinitionInput) => Readonly<AdapterDefinition>;
export const createVenueAdapter = runtime.createVenueAdapter as (definition: AdapterDefinitionInput | AdapterDefinition, handlers: AdapterHandlers) => Readonly<VenueAdapter>;
export const createAdapterRuntime = runtime.createAdapterRuntime as (options?: Record<string, unknown>) => Readonly<AdapterRuntime>;
export const canonicalStringify = contracts.canonicalStringify as (value: unknown) => string;
export const sha256Checksum = contracts.sha256Checksum as (value: unknown) => Promise<string>;
export const createSyncCursor = contracts.createSyncCursor as (definition: AdapterDefinition, input: { opaque: string; sourceVersion: string }) => Promise<Record<string, unknown>>;
export const verifySyncCursor = runtime.verifySyncCursor as (definition: AdapterDefinition, cursor: unknown) => Promise<Record<string, unknown> | null>;
export const normalizeExternalReference = contracts.normalizeExternalReference as (input: Record<string, unknown>, definition: AdapterDefinition) => Readonly<Record<string, unknown>>;
export const normalizeAdapterChange = contracts.normalizeAdapterChange as (input: Record<string, unknown>, definition: AdapterDefinition) => Readonly<Record<string, unknown>>;
export const createExternalIdMapping = internalCreateExternalIdMapping as (input: Record<string, unknown>) => Readonly<Record<string, unknown>>;

export interface AdapterPage<Item> {
  items: Item[];
  nextCursor: string | null;
  sourceVersion: string;
}

export interface CollectAdapterPagesOptions<Item> {
  fetchPage(input: { cursor: string | null; pageIndex: number; signal?: AbortSignal }): Promise<AdapterPage<Item>> | AdapterPage<Item>;
  initialCursor?: string | null;
  maxPages?: number;
  maxItems?: number;
  signal?: AbortSignal;
}

export interface CollectedAdapterPages<Item> {
  readonly items: Item[];
  readonly nextCursor: null;
  readonly sourceVersion: string;
  readonly pageCount: number;
}

export const collectAdapterPages = internalCollectAdapterPages as <Item>(options: CollectAdapterPagesOptions<Item>) => Promise<CollectedAdapterPages<Item>>;
export const normalizeRetryAfter = internalNormalizeRetryAfter as (value: unknown, options?: { now?: number; maximumRetryAfterMs?: number }) => number;
export const adapterHttpError = internalAdapterHttpError as (responseOrCause: unknown, options?: { now?: number; maximumRetryAfterMs?: number }) => AdapterContractError;

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

export const verifyWebhookHmac = internalVerifyWebhookHmac as (options: VerifyWebhookHmacOptions) => Promise<boolean>;
