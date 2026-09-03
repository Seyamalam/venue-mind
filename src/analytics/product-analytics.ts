export const PRODUCT_ANALYTICS_SCHEMA_VERSION = 1 as const;
export const PRODUCT_ANALYTICS_RETENTION_DAYS = 180;
export const PRODUCT_ANALYTICS_MAX_WINDOW_DAYS = 90;

export const productAnalyticsEventNames = [
  "golden-loop.completed",
  "validation.completed",
  "adjustment.cycle",
  "branch.compared",
  "export.completed",
  "product.error",
  "workflow.abandoned",
] as const;
export type ProductAnalyticsEventName = (typeof productAnalyticsEventNames)[number];

export const productAnalyticsOutcomes = [
  "completed",
  "pass",
  "warn",
  "fail",
  "requested",
  "compared",
  "exported",
  "error",
  "abandoned",
] as const;
export type ProductAnalyticsOutcome = (typeof productAnalyticsOutcomes)[number];

export const productAnalyticsStages = [
  "inspect",
  "preview",
  "validate",
  "review",
  "approve",
  "adjust",
  "compare",
  "export",
] as const;
export type ProductAnalyticsStage = (typeof productAnalyticsStages)[number];

export const productAnalyticsErrorCategories = [
  "authorization",
  "validation",
  "conflict",
  "persistence",
  "export",
  "unknown",
] as const;
export type ProductAnalyticsErrorCategory = (typeof productAnalyticsErrorCategories)[number];

export interface ProductAnalyticsEvent {
  readonly schemaVersion: typeof PRODUCT_ANALYTICS_SCHEMA_VERSION;
  readonly eventName: ProductAnalyticsEventName;
  readonly outcome: ProductAnalyticsOutcome;
  readonly stage: ProductAnalyticsStage;
  readonly errorCategory: ProductAnalyticsErrorCategory | null;
}

export interface ProductAnalyticsMetric extends ProductAnalyticsEvent {
  readonly count: number;
}

export interface ProductAnalyticsMetrics {
  readonly schemaVersion: typeof PRODUCT_ANALYTICS_SCHEMA_VERSION;
  readonly windowDays: number;
  readonly fromDay: string;
  readonly throughDay: string;
  readonly totals: readonly ProductAnalyticsMetric[];
  readonly interpretation: Readonly<{
    purpose: "friction-only";
    automationAuthority: "none";
    supervisionPolicy: "unchanged";
  }>;
}

type EventRule = Readonly<{
  outcomes: readonly ProductAnalyticsOutcome[];
  stages: readonly ProductAnalyticsStage[];
  errorCategory: "required" | "forbidden";
}>;

const eventRule = (
  outcomes: readonly ProductAnalyticsOutcome[],
  stages: readonly ProductAnalyticsStage[],
  errorCategory: EventRule["errorCategory"],
): EventRule => Object.freeze({ outcomes: Object.freeze(outcomes), stages: Object.freeze(stages), errorCategory });

export const productAnalyticsRules = Object.freeze({
  "golden-loop.completed": eventRule(["completed"], ["approve"], "forbidden"),
  "validation.completed": eventRule(["pass", "warn", "fail"], ["validate"], "forbidden"),
  "adjustment.cycle": eventRule(["requested"], ["adjust"], "forbidden"),
  "branch.compared": eventRule(["compared"], ["compare"], "forbidden"),
  "export.completed": eventRule(["exported"], ["export"], "forbidden"),
  "product.error": eventRule(["error"], productAnalyticsStages, "required"),
  "workflow.abandoned": eventRule(["abandoned"], productAnalyticsStages, "forbidden"),
} satisfies Readonly<Record<ProductAnalyticsEventName, EventRule>>);

const eventNameSet = new Set<string>(productAnalyticsEventNames);
const outcomeSet = new Set<string>(productAnalyticsOutcomes);
const stageSet = new Set<string>(productAnalyticsStages);
const errorCategorySet = new Set<string>(productAnalyticsErrorCategories);
const exactKeys = ["errorCategory", "eventName", "outcome", "schemaVersion", "stage"] as const;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const decodeProductAnalyticsEvent = (value: unknown): ProductAnalyticsEvent => {
  if (!isRecord(value) || Object.keys(value).sort().join("|") !== [...exactKeys].sort().join("|"))
    throw new TypeError("PRODUCT_ANALYTICS_EVENT_INVALID");
  const schemaVersion = value["schemaVersion"];
  const eventName = value["eventName"];
  const outcome = value["outcome"];
  const stage = value["stage"];
  const errorCategory = value["errorCategory"];
  if (
    schemaVersion !== PRODUCT_ANALYTICS_SCHEMA_VERSION ||
    typeof eventName !== "string" ||
    !eventNameSet.has(eventName) ||
    typeof outcome !== "string" ||
    !outcomeSet.has(outcome) ||
    typeof stage !== "string" ||
    !stageSet.has(stage) ||
    (errorCategory !== null && (typeof errorCategory !== "string" || !errorCategorySet.has(errorCategory)))
  )
    throw new TypeError("PRODUCT_ANALYTICS_EVENT_INVALID");
  const typedName = productAnalyticsEventNames.find((candidate) => candidate === eventName);
  const typedOutcome = productAnalyticsOutcomes.find((candidate) => candidate === outcome);
  const typedStage = productAnalyticsStages.find((candidate) => candidate === stage);
  const typedError = productAnalyticsErrorCategories.find((candidate) => candidate === errorCategory) ?? null;
  if (!typedName || !typedOutcome || !typedStage) throw new TypeError("PRODUCT_ANALYTICS_EVENT_INVALID");
  const rule = productAnalyticsRules[typedName];
  if (
    !rule.outcomes.includes(typedOutcome) ||
    !rule.stages.includes(typedStage) ||
    (rule.errorCategory === "required" ? typedError === null : typedError !== null)
  )
    throw new TypeError("PRODUCT_ANALYTICS_EVENT_INVALID");
  return Object.freeze({ schemaVersion, eventName: typedName, outcome: typedOutcome, stage: typedStage, errorCategory: typedError });
};

export const productAnalyticsInterpretation = Object.freeze({
  purpose: "friction-only",
  automationAuthority: "none",
  supervisionPolicy: "unchanged",
} as const);

export const productAnalyticsErrorCategory = (
  error: unknown,
  fallback: ProductAnalyticsErrorCategory = "unknown",
): ProductAnalyticsErrorCategory => {
  const code =
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
      ? error.code.toUpperCase()
      : error instanceof Error
        ? error.message.toUpperCase()
        : "";
  if (code.includes("AUTHORIZATION") || code.includes("DENIED")) return "authorization";
  if (code.includes("VALIDATION") || code.includes("CONSTRAINT")) return "validation";
  if (code.includes("CONFLICT") || code.includes("STALE")) return "conflict";
  if (code.includes("PERSIST") || code.includes("NETWORK") || code.includes("STORAGE")) return "persistence";
  if (code.includes("EXPORT")) return "export";
  return fallback;
};
