const clone = (value) => structuredClone(value);

export function createMemoryProcessedBatchStore() {
  const batches = new Map();
  return Object.freeze({
    async get(idempotencyKey) {
      const value = batches.get(idempotencyKey);
      return value ? clone(value) : null;
    },
    async putIfAbsent(idempotencyKey, value) {
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
