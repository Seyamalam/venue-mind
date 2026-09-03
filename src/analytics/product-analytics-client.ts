import {
  PRODUCT_ANALYTICS_SCHEMA_VERSION,
  decodeProductAnalyticsEvent,
  decodeProductAnalyticsMetrics,
  type ProductAnalyticsEvent,
  type ProductAnalyticsEventName,
  type ProductAnalyticsMetrics,
  type ProductAnalyticsStage,
} from "./product-analytics.ts";

export const PRODUCT_ANALYTICS_PREFERENCE_KEY = "venuemind.product-analytics.preference";
export type ProductAnalyticsPreference = "enabled" | "disabled";

interface AnalyticsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const productAnalyticsPreference = (storage: AnalyticsStorage | null): ProductAnalyticsPreference =>
  storage?.getItem(PRODUCT_ANALYTICS_PREFERENCE_KEY) === "enabled" ? "enabled" : "disabled";

export const setProductAnalyticsPreference = (
  storage: AnalyticsStorage | null,
  preference: ProductAnalyticsPreference,
): ProductAnalyticsPreference => {
  storage?.setItem(PRODUCT_ANALYTICS_PREFERENCE_KEY, preference);
  return preference;
};

export interface ProductAnalyticsClient {
  readonly capture: (event: ProductAnalyticsEvent) => Promise<boolean>;
  readonly markStage: (stage: ProductAnalyticsStage) => void;
  readonly abandon: () => Promise<boolean>;
  readonly complete: () => void;
}

export function createProductAnalyticsClient({
  organizationId,
  fetchImpl = globalThis.fetch,
  storage = globalThis.localStorage ?? null,
}: Readonly<{
  organizationId: string;
  fetchImpl?: typeof globalThis.fetch;
  storage?: AnalyticsStorage | null;
}>): ProductAnalyticsClient {
  let stage: ProductAnalyticsStage = "inspect";
  let completed = false;
  let abandoned = false;
  const capture = async (input: ProductAnalyticsEvent): Promise<boolean> => {
    if (productAnalyticsPreference(storage) !== "enabled") return false;
    const event = decodeProductAnalyticsEvent(input);
    try {
      const response = await fetchImpl("/api/analytics/events", {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: {
          "content-type": "application/json",
          "x-venuemind-organization-id": organizationId,
        },
        body: JSON.stringify(event),
      });
      return response.ok;
    } catch {
      return false;
    }
  };
  return Object.freeze({
    capture,
    markStage(nextStage: ProductAnalyticsStage): void {
      stage = nextStage;
    },
    async abandon(): Promise<boolean> {
      if (completed || abandoned) return false;
      abandoned = true;
      return capture({
        schemaVersion: PRODUCT_ANALYTICS_SCHEMA_VERSION,
        eventName: "workflow.abandoned",
        outcome: "abandoned",
        stage,
        errorCategory: null,
      });
    },
    complete(): void {
      completed = true;
    },
  });
}

export const productAnalyticsEvent = (
  eventName: ProductAnalyticsEventName,
  input: Omit<ProductAnalyticsEvent, "schemaVersion" | "eventName">,
): ProductAnalyticsEvent =>
  decodeProductAnalyticsEvent({ schemaVersion: PRODUCT_ANALYTICS_SCHEMA_VERSION, eventName, ...input });

export const loadProductAnalyticsMetrics = async (
  organizationId: string,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
  windowDays = 30,
): Promise<ProductAnalyticsMetrics> => {
  const response = await fetchImpl(`/api/analytics/metrics?days=${windowDays}`, {
    credentials: "same-origin",
    headers: { accept: "application/json", "x-venuemind-organization-id": organizationId },
  });
  if (!response.ok) throw new Error("PRODUCT_ANALYTICS_METRICS_UNAVAILABLE");
  return decodeProductAnalyticsMetrics(await response.json());
};
