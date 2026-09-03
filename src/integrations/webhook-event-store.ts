const clone = <Value>(value: Value): Value => structuredClone(value);

export interface WebhookEventEntry<Value> {
  readonly key: string;
  readonly value: Value;
}

export interface WebhookEventStore<Value> {
  putIfAbsent(key: string, value: Value): Promise<Readonly<{ inserted: boolean; value: Value }>>;
  get(key: string): Promise<Value | null>;
  list(): WebhookEventEntry<Value>[];
}

export function createMemoryWebhookEventStore<Value = object>(
  initialEntries: readonly WebhookEventEntry<Value>[] = [],
): Readonly<WebhookEventStore<Value>> {
  const events = new Map<string, Value>(initialEntries.map(({ key, value }) => [key, clone(value)]));
  return Object.freeze({
    putIfAbsent(key: string, value: Value) {
      const existing = events.get(key);
      if (existing) return Promise.resolve({ inserted: false, value: clone(existing) });
      events.set(key, clone(value));
      return Promise.resolve({ inserted: true, value: clone(value) });
    },
    get(key: string) {
      const value = events.get(key);
      return Promise.resolve(value ? clone(value) : null);
    },
    list() {
      return [...events.entries()].map(([key, value]) => ({ key, value: clone(value) }));
    },
  });
}
