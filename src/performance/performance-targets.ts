export const PERFORMANCE_OPERATIONS = [
  "inspection",
  "preview",
  "validation",
  "branch-switch",
  "approval",
  "replay",
  "load",
  "export",
] as const;
export type PerformanceOperation = (typeof PERFORMANCE_OPERATIONS)[number];
export type PlanTargetName = "small" | "medium" | "large";

export interface PlanPerformanceTarget {
  readonly name: PlanTargetName;
  readonly objects: number;
  readonly constraints: number;
  readonly ledgerEntries: number;
  readonly comments: number;
  readonly branches: number;
  readonly budgetsMs: Readonly<Record<PerformanceOperation, number>>;
}

export const PLAN_PERFORMANCE_TARGETS: Readonly<Record<PlanTargetName, PlanPerformanceTarget>> = Object.freeze({
  small: Object.freeze({
    name: "small",
    objects: 100,
    constraints: 20,
    ledgerEntries: 250,
    comments: 100,
    branches: 5,
    budgetsMs: Object.freeze({
      inspection: 75,
      preview: 40,
      validation: 250,
      "branch-switch": 60,
      approval: 350,
      replay: 80,
      load: 180,
      export: 350,
    }),
  }),
  medium: Object.freeze({
    name: "medium",
    objects: 500,
    constraints: 50,
    ledgerEntries: 1_000,
    comments: 250,
    branches: 15,
    budgetsMs: Object.freeze({
      inspection: 120,
      preview: 100,
      validation: 800,
      "branch-switch": 180,
      approval: 1_100,
      replay: 300,
      load: 650,
      export: 1_200,
    }),
  }),
  large: Object.freeze({
    name: "large",
    objects: 1_000,
    constraints: 100,
    ledgerEntries: 2_000,
    comments: 400,
    branches: 30,
    budgetsMs: Object.freeze({
      inspection: 300,
      preview: 250,
      validation: 2_000,
      "branch-switch": 500,
      approval: 2_800,
      replay: 1_000,
      load: 1_800,
      export: 3_000,
    }),
  }),
});
