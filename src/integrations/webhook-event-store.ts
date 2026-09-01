const clone = (value: any) => structuredClone(value);

export function createMemoryWebhookEventStore(initialEntries: any = []) {
  const events: any = new Map(initialEntries.map(({ key, value }: any) => [key, clone(value)]));
  return Object.freeze({
    async putIfAbsent(key: any, value: any) {
      const existing = events.get(key);
      if (existing) return { inserted: false, value: clone(existing) };
      events.set(key, clone(value));
      return { inserted: true, value: clone(value) };
    },
    async get(key: any) {
      const value = events.get(key);
      return value ? clone(value) : null;
    },
    list() {
      return [...events.entries()].map(([key, value]: any) => ({ key, value: clone(value) }));
    },
  });
}
