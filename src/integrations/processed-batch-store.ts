const clone = <Value>(value: Value): Value => structuredClone(value);

export interface ProcessedBatchStore<Value> {
  get(idempotencyKey: string): Promise<Value | null>;
  putIfAbsent(idempotencyKey: string, value: Value): Promise<Readonly<{ inserted: boolean; value: Value }>>;
  list(): Value[];
}

export function createMemoryProcessedBatchStore<Value = object>(): Readonly<ProcessedBatchStore<Value>> {
  const batches = new Map<string, Value>();
  return Object.freeze({
    get(idempotencyKey: string) {
      const value = batches.get(idempotencyKey);
      return Promise.resolve(value ? clone(value) : null);
    },
    putIfAbsent(idempotencyKey: string, value: Value) {
      const existing = batches.get(idempotencyKey);
      if (existing) return Promise.resolve({ inserted: false, value: clone(existing) });
      batches.set(idempotencyKey, clone(value));
      return Promise.resolve({ inserted: true, value: clone(value) });
    },
    list() {
      return [...batches.values()].map(clone);
    },
  });
}
