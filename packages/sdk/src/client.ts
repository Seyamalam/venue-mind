import type {
  ActivityLedger,
  LayoutInspection,
  PlanExport,
  PreviewRevisionResult,
  ProjectSummary,
  ValidationResult,
  VenueMindTransport,
  VenueToolCallOptions,
  VenueToolInput,
  VenueToolName,
  VenueToolOutput,
} from "./types.js";

export interface VenueMindClient {
  readonly projects: {
    list(options?: VenueToolCallOptions): Promise<ProjectSummary[]>;
    open(projectId: string, options?: VenueToolCallOptions): Promise<ProjectSummary>;
  };
  readonly plans: {
    inspect(options?: VenueToolCallOptions): Promise<LayoutInspection>;
  };
  readonly proposals: {
    preview(input: VenueToolInput<"venue.preview_revision">, options?: VenueToolCallOptions): Promise<PreviewRevisionResult>;
  };
  readonly validations: {
    run(options?: VenueToolCallOptions): Promise<ValidationResult>;
  };
  readonly ledger: {
    list(options?: VenueToolCallOptions): Promise<ActivityLedger>;
  };
  readonly exports: {
    plan(format?: VenueToolInput<"venue.export_plan">["format"], options?: VenueToolCallOptions): Promise<PlanExport>;
    audit(options?: VenueToolCallOptions): Promise<PlanExport>;
  };
  call<Name extends VenueToolName>(name: Name, input: VenueToolInput<Name>, options?: VenueToolCallOptions): Promise<VenueToolOutput<Name>>;
}

const freezeNamespace = <Value extends object>(value: Value): Readonly<Value> => Object.freeze(value);

export function createVenueMindClient({ transport }: { transport: VenueMindTransport }): VenueMindClient {
  if (!transport || typeof transport.callTool !== "function") throw new TypeError("VenueMind client requires a transport with callTool(name, input, options)");
  const call = <Name extends VenueToolName>(name: Name, input: VenueToolInput<Name>, options?: VenueToolCallOptions) => transport.callTool(name, input, options);

  return Object.freeze({
    projects: freezeNamespace({
      list: (options?: VenueToolCallOptions) => call("venue.list_projects", {}, options),
      open: (projectId: string, options?: VenueToolCallOptions) => call("venue.open_project", { projectId }, options),
    }),
    plans: freezeNamespace({
      inspect: (options?: VenueToolCallOptions) => call("venue.inspect_layout", {}, options),
    }),
    proposals: freezeNamespace({
      preview: (input: VenueToolInput<"venue.preview_revision">, options?: VenueToolCallOptions) => call("venue.preview_revision", input, options),
    }),
    validations: freezeNamespace({
      run: (options?: VenueToolCallOptions) => call("venue.validate_layout", {}, options),
    }),
    ledger: freezeNamespace({
      list: (options?: VenueToolCallOptions) => call("venue.get_change_log", {}, options),
    }),
    exports: freezeNamespace({
      plan: (format?: VenueToolInput<"venue.export_plan">["format"], options?: VenueToolCallOptions) => call("venue.export_plan", format === undefined ? {} : { format }, options),
      audit: (options?: VenueToolCallOptions) => call("venue.export_audit_package", {}, options),
    }),
    call,
  });
}
