const clone = (value: any) => structuredClone(value);

export function createMemoryProcessedBatchStore() {
  const batches: any = new Map();
  return Object.freeze({
    async get(idempotencyKey: any) {
      const value = batches.get(idempotencyKey);
      return value ? clone(value) : null;
    },
    async putIfAbsent(idempotencyKey: any, value: any) {
      const existing = batches.get(idempotencyKey);
      if (existing) return { inserted: false, value: clone(existing) };
      batches.set(idempotencyKey, clone(value));
      return { inserted: true, value: clone(value) };
    },
    list() {
      return [...batches.values()].map(clone);
    },
  });
}
