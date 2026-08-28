const clone = (value) => structuredClone(value);

export function createMemoryWebhookEventStore(initialEntries = []) {
  const events = new Map(initialEntries.map(({ key, value }) => [key, clone(value)]));
  return Object.freeze({
    async putIfAbsent(key, value) {
      const existing = events.get(key);
      if (existing) return { inserted: false, value: clone(existing) };
      events.set(key, clone(value));
      return { inserted: true, value: clone(value) };
    },
    async get(key) {
      const value = events.get(key);
      return value ? clone(value) : null;
    },
    list() {
      return [...events.entries()].map(([key, value]) => ({ key, value: clone(value) }));
    },
  });
}
