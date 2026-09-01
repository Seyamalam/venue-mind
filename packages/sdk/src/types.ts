import type {
  VenueMindActivityLedger,
  VenueMindError,
  VenueMindPlanExport,
  VenueMindPlannerSnapshot,
  VenueMindProjectRecord,
  VenueMindToolInputMap,
  VenueMindValidationResult,
  VenueToolName,
} from "./generated/index.js";

export type {
  VenueMindActivityLedger,
  VenueMindError,
  VenueMindPlanExport,
  VenueMindPlannerSnapshot,
  VenueMindProjectRecord,
  VenueMindToolInputMap,
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

export interface ProjectSummary {
  id: string;
  name: string;
  activePlanId: string;
  planVersion: string;
  proposalId: string | null;
  updatedAt: string;
  active: boolean;
}

export interface ProposalSummary {
  id: string;
  baseVersion: string;
  revision: number;
  status: string;
  goal: string;
  changedItems: number;
  templateUpdate: unknown | null;
}

export interface LayoutInspection {
  planId: string;
  planVersion: string;
  event: Record<string, unknown>;
  venue: Record<string, unknown>;
  spatial: Plan["spatial"];
  spatialObjects: Array<Record<string, unknown> & { id: string; kind: string; label: string }>;
  constraints: Plan["constraints"];
  metrics: Plan["metrics"];
  proposal: ProposalSummary | null;
  activeBranchId: string;
  proposalBranches: Array<{ id: string; name: string; strategy: string; proposalId: string }>;
  commandReceiptCount: number;
  ledgerIntegrity: Record<string, unknown>;
  brief: VenueMindPlannerSnapshot["brief"];
  [key: string]: unknown;
}

export interface PreviewRevisionResult {
  proposalId: string;
  baseVersion: string;
  revision: number;
  changedItems: number;
  requiresHumanApproval: true;
}

export type VenueToolInput<Name extends VenueToolName> = VenueMindToolInputMap[Name];

type DefaultToolOutputs = { [Name in VenueToolName]: unknown };
export type VenueToolOutputMap = DefaultToolOutputs & {
  "venue.list_projects": ProjectSummary[];
  "venue.open_project": ProjectSummary;
  "venue.inspect_layout": LayoutInspection;
  "venue.preview_revision": PreviewRevisionResult;
  "venue.validate_layout": ValidationResult;
  "venue.get_change_log": ActivityLedger;
  "venue.export_plan": PlanExport;
  "venue.export_audit_package": PlanExport;
};

export type VenueToolOutput<Name extends VenueToolName> = VenueToolOutputMap[Name];

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
