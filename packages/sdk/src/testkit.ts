import type {
  AdapterAuthorization,
  AdapterCapability,
  AdapterDeadLetter,
  AdapterRuntimeOptions,
  AdapterRuntimeResult,
  VenueAdapter,
} from "./adapter.js";
import { createAdapterRuntime } from "./adapter.js";
import { createMemoryProcessedBatchStore as internalProcessedStore } from "../../../src/integrations/processed-batch-store.ts";
import { createMemoryWebhookEventStore as internalWebhookStore } from "../../../src/integrations/webhook-event-store.ts";
import { createMemorySecretStore as internalSecretStore } from "../../../src/integrations/secret-store.ts";
import { createMemoryDeadLetterSink as internalDeadLetterSink } from "../../../src/integrations/runtime.ts";

export interface AtomicMemoryStore<Value = unknown> {
  get(key: string): Promise<Value | null>;
  putIfAbsent(key: string, value: Value): Promise<Readonly<{ inserted: boolean; value: Value }>>;
}

export interface WebhookMemoryEntry<Value = unknown> {
  readonly key: string;
  readonly value: Value;
}

export interface MemorySecretStore {
  get(reference: string): Promise<string>;
}

export interface MemoryDeadLetterSink {
  add(item: AdapterDeadLetter): Promise<void>;
  list(): AdapterDeadLetter[];
}

export const createMemoryProcessedBatchStore = <Value = unknown>(): Readonly<AtomicMemoryStore<Value>> =>
  internalProcessedStore<Value>();

export const createMemoryWebhookEventStore = <Value = unknown>(
  entries: readonly WebhookMemoryEntry<Value>[] = [],
): Readonly<AtomicMemoryStore<Value>> => internalWebhookStore<Value>(entries);

export const createMemorySecretStore = (entries: Readonly<Record<string, string>> = {}): Readonly<MemorySecretStore> =>
  internalSecretStore(entries);

export const createMemoryDeadLetterSink = (): Readonly<MemoryDeadLetterSink> => internalDeadLetterSink();

export function createDeterministicClock(
  start = "2026-01-01T00:00:00.000Z",
  stepMs = 1,
): { now(): number; iso(): string; advance(milliseconds?: number): string } {
  let current = Date.parse(start);
  if (!Number.isFinite(current)) throw new TypeError("Deterministic clock start must be an ISO timestamp");
  if (!Number.isInteger(stepMs) || stepMs < 0)
    throw new TypeError("Deterministic clock stepMs must be a non-negative integer");
  return Object.freeze({
    now: () => current,
    iso: () => new Date(current).toISOString(),
    advance(milliseconds = stepMs) {
      if (!Number.isInteger(milliseconds) || milliseconds < 0)
        throw new TypeError("Clock advance must be a non-negative integer");
      current += milliseconds;
      return new Date(current).toISOString();
    },
  });
}

export interface AdapterConformanceCase {
  readonly name: string;
  readonly capability: AdapterCapability;
  readonly input: unknown;
  readonly expectedStatus?: AdapterRuntimeResult["status"];
  assert?(result: AdapterRuntimeResult): Promise<void> | void;
}

export interface AdapterConformanceOptions {
  readonly adapter: VenueAdapter;
  readonly cases: readonly AdapterConformanceCase[];
  readonly authorization?: AdapterAuthorization;
  readonly runtimeOptions?: AdapterRuntimeOptions;
}

export async function assertAdapterConformance(
  options: AdapterConformanceOptions,
): Promise<ReadonlyArray<{ name: string; result: AdapterRuntimeResult }>> {
  const { adapter, cases, authorization = {}, runtimeOptions = {} } = options;
  if (!adapter?.definition) throw new TypeError("Adapter conformance requires a VenueMind adapter");
  if (cases.length === 0) throw new TypeError("Adapter conformance requires at least one case");
  const runtime = createAdapterRuntime(runtimeOptions);
  const results: Array<{ name: string; result: AdapterRuntimeResult }> = [];
  for (const testCase of cases) {
    if (!testCase?.name || !testCase.capability)
      throw new TypeError("Every adapter conformance case requires a name and capability");
    const result =
      testCase.capability === "webhook"
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
