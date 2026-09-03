import type {
  VenueMindActivityLedger,
  VenueMindPlanExport,
  VenueMindLayoutInspection,
  VenueMindLivePlanDeviation,
  VenueMindLivePlanDeviationOverlay,
  VenueMindLivePlanDeviationRegister,
  VenueMindPlannerSnapshot,
  VenueMindPreviewRevisionResult,
  VenueMindProjectListResult,
  VenueMindProjectOpenResult,
  VenueMindProjectRecord,
  VenueMindToolInputMap,
  VenueMindToolOutputMap,
  VenueMindValidationResult,
  VenueToolName,
} from "./generated/index.js";

export type {
  VenueMindActivityLedger,
  VenueMindError,
  VenueMindPlanExport,
  VenueMindLayoutInspection,
  VenueMindLivePlanDeviation,
  VenueMindLivePlanDeviationOverlay,
  VenueMindLivePlanDeviationRegister,
  VenueMindPlannerSnapshot,
  VenueMindPreviewRevisionResult,
  VenueMindProjectListResult,
  VenueMindProjectOpenResult,
  VenueMindProjectRecord,
  VenueMindToolInputMap,
  VenueMindToolOutputMap,
  VenueMindValidationResult,
  VenueToolName,
} from "./generated/index.js";
export { VENUE_TOOL_CONTRACT_VERSION, VENUE_TOOL_NAMES } from "./generated/index.js";

export type Project = VenueMindProjectRecord;
export type PlannerSnapshot = VenueMindPlannerSnapshot;
export type Plan = VenueMindPlannerSnapshot["plan"];
export type Proposal = NonNullable<VenueMindPlannerSnapshot["proposal"]>;
export type ValidationResult = VenueMindValidationResult;
export type ActivityLedger = VenueMindActivityLedger;
export type ActivityLedgerEntry = VenueMindActivityLedger[number];
export type PlanExport = VenueMindPlanExport;
export type ProjectListResult = VenueMindProjectListResult;
export type ProjectOpenResult = VenueMindProjectOpenResult;
export type ProjectSummary = VenueMindProjectListResult["projects"][number];
export type LayoutInspection = VenueMindLayoutInspection;
export type PreviewRevisionResult = VenueMindPreviewRevisionResult;
export type LivePlanDeviation = VenueMindLivePlanDeviation;
export type LivePlanDeviationRegister = VenueMindLivePlanDeviationRegister;
export type LivePlanDeviationOverlay = VenueMindLivePlanDeviationOverlay;

export type VenueToolInput<Name extends VenueToolName> = VenueMindToolInputMap[Name];

export type VenueToolOutput<Name extends VenueToolName> = VenueMindToolOutputMap[Name];

export interface VenueToolCallOptions {
  signal?: AbortSignal;
}

export interface VenueMindTransport {
  callTool<Name extends VenueToolName>(
    name: Name,
    input: VenueToolInput<Name>,
    options?: VenueToolCallOptions,
  ): Promise<VenueToolOutput<Name>>;
}
