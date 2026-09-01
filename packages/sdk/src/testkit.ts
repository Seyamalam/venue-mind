import type { AdapterAuthorization, AdapterCapability, AdapterRuntimeResult, VenueAdapter } from "./adapter.js";
import { createAdapterRuntime } from "./adapter.js";
import { createMemoryProcessedBatchStore as internalProcessedStore } from "../../../src/integrations/processed-batch-store.ts";
import { createMemoryWebhookEventStore as internalWebhookStore } from "../../../src/integrations/webhook-event-store.ts";
import { createMemorySecretStore as internalSecretStore } from "../../../src/integrations/secret-store.ts";
import { createMemoryDeadLetterSink as internalDeadLetterSink } from "../../../src/integrations/runtime.ts";

export interface AtomicMemoryStore<Value = unknown> {
  get(key: string): Promise<Value | null>;
  putIfAbsent(key: string, value: Value): Promise<{ inserted: boolean; value: Value }>;
}

export interface MemorySecretStore {
  get(reference: string): Promise<string>;
}

export interface MemoryDeadLetterSink {
  add(item: unknown): Promise<void>;
  list(): unknown[];
}

export const createMemoryProcessedBatchStore = internalProcessedStore as () => AtomicMemoryStore;
export const createMemoryWebhookEventStore = internalWebhookStore as (entries?: unknown[]) => AtomicMemoryStore;
export const createMemorySecretStore = internalSecretStore as (entries?: Record<string, string>) => MemorySecretStore;
export const createMemoryDeadLetterSink = internalDeadLetterSink as () => MemoryDeadLetterSink;

export function createDeterministicClock(start = "2026-01-01T00:00:00.000Z", stepMs = 1): { now(): number; iso(): string; advance(milliseconds?: number): string } {
  let current = Date.parse(start);
  if (!Number.isFinite(current)) throw new TypeError("Deterministic clock start must be an ISO timestamp");
  if (!Number.isInteger(stepMs) || stepMs < 0) throw new TypeError("Deterministic clock stepMs must be a non-negative integer");
  return Object.freeze({
    now: () => current,
    iso: () => new Date(current).toISOString(),
    advance(milliseconds = stepMs) {
      if (!Number.isInteger(milliseconds) || milliseconds < 0) throw new TypeError("Clock advance must be a non-negative integer");
      current += milliseconds;
      return new Date(current).toISOString();
    },
  });
}

export interface AdapterConformanceCase {
  name: string;
  capability: AdapterCapability;
  input: unknown;
  expectedStatus?: AdapterRuntimeResult["status"];
  assert?(result: AdapterRuntimeResult): Promise<void> | void;
}

export async function assertAdapterConformance({
  adapter,
  cases,
  authorization = {},
  runtimeOptions = {},
}: {
  adapter: VenueAdapter;
  cases: AdapterConformanceCase[];
  authorization?: AdapterAuthorization;
  runtimeOptions?: Record<string, unknown>;
}): Promise<ReadonlyArray<{ name: string; result: AdapterRuntimeResult }>> {
  if (!adapter?.definition) throw new TypeError("Adapter conformance requires a VenueMind adapter");
  if (!Array.isArray(cases) || cases.length === 0) throw new TypeError("Adapter conformance requires at least one case");
  const runtime = createAdapterRuntime(runtimeOptions);
  const results: Array<{ name: string; result: AdapterRuntimeResult }> = [];
  for (const testCase of cases) {
    if (!testCase?.name || !testCase.capability) throw new TypeError("Every adapter conformance case requires a name and capability");
    const result = testCase.capability === "webhook"
      ? await runtime.acceptWebhook(adapter, testCase.input, authorization)
      : await runtime.execute(adapter, testCase.capability, testCase.input, authorization);
    if (testCase.expectedStatus && result.status !== testCase.expectedStatus) {
      throw new Error(`${testCase.name}: expected ${testCase.expectedStatus}, received ${result.status}`);
    }
    await testCase.assert?.(result);
    results.push({ name: testCase.name, result });
  }
  return Object.freeze(results);
}
