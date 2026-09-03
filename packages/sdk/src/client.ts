import type {
  ActivityLedger,
  LayoutInspection,
  PlanExport,
  PreviewRevisionResult,
  ProjectListResult,
  ProjectOpenResult,
  ValidationResult,
  VenueMindTransport,
  VenueToolCallOptions,
  VenueToolInput,
  VenueToolName,
  VenueToolOutput,
} from "./types.js";
export type { VenueMindTransport, VenueToolCallOptions } from "./types.js";

export interface VenueMindClient {
  readonly projects: {
    list(options?: VenueToolCallOptions): Promise<ProjectListResult>;
    open(projectId: string, options?: VenueToolCallOptions): Promise<ProjectOpenResult>;
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
  readonly deviations: {
    inspect(
      input?: VenueToolInput<"venue.inspect_live_plan_deviations">,
      options?: VenueToolCallOptions,
    ): Promise<VenueToolOutput<"venue.inspect_live_plan_deviations">>;
    record(
      input: VenueToolInput<"venue.record_live_plan_deviation">,
      options?: VenueToolCallOptions,
    ): Promise<VenueToolOutput<"venue.record_live_plan_deviation">>;
    end(
      input: VenueToolInput<"venue.end_live_plan_deviation">,
      options?: VenueToolCallOptions,
    ): Promise<VenueToolOutput<"venue.end_live_plan_deviation">>;
    createPostEventProposal(
      input: VenueToolInput<"venue.create_post_event_deviation_proposal">,
      options?: VenueToolCallOptions,
    ): Promise<VenueToolOutput<"venue.create_post_event_deviation_proposal">>;
  };
  readonly postEvent: {
    inspect(options?: VenueToolCallOptions): Promise<VenueToolOutput<"venue.inspect_post_event_review">>;
    recordObservation(
      input: VenueToolInput<"venue.record_post_event_observation">,
      options?: VenueToolCallOptions,
    ): Promise<VenueToolOutput<"venue.record_post_event_observation">>;
    recordLesson(
      input: VenueToolInput<"venue.record_post_event_lesson">,
      options?: VenueToolCallOptions,
    ): Promise<VenueToolOutput<"venue.record_post_event_lesson">>;
    createTemplateImprovementProposal(
      input: VenueToolInput<"venue.create_template_improvement_proposal">,
      options?: VenueToolCallOptions,
    ): Promise<VenueToolOutput<"venue.create_template_improvement_proposal">>;
    exportReport(
      format?: VenueToolInput<"venue.export_post_event_report">["format"],
      options?: VenueToolCallOptions,
    ): Promise<VenueToolOutput<"venue.export_post_event_report">>;
  };
  readonly exports: {
    plan(format?: VenueToolInput<"venue.export_plan">["format"], options?: VenueToolCallOptions): Promise<PlanExport>;
    audit(options?: VenueToolCallOptions): Promise<PlanExport>;
    deviations(options?: VenueToolCallOptions): Promise<VenueToolOutput<"venue.export_live_plan_deviations">>;
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
    deviations: freezeNamespace({
      inspect: (
        input: VenueToolInput<"venue.inspect_live_plan_deviations"> = {},
        options?: VenueToolCallOptions,
      ) => call("venue.inspect_live_plan_deviations", input, options),
      record: (input: VenueToolInput<"venue.record_live_plan_deviation">, options?: VenueToolCallOptions) =>
        call("venue.record_live_plan_deviation", input, options),
      end: (input: VenueToolInput<"venue.end_live_plan_deviation">, options?: VenueToolCallOptions) =>
        call("venue.end_live_plan_deviation", input, options),
      createPostEventProposal: (
        input: VenueToolInput<"venue.create_post_event_deviation_proposal">,
        options?: VenueToolCallOptions,
      ) => call("venue.create_post_event_deviation_proposal", input, options),
    }),
    postEvent: freezeNamespace({
      inspect: (options?: VenueToolCallOptions) => call("venue.inspect_post_event_review", {}, options),
      recordObservation: (
        input: VenueToolInput<"venue.record_post_event_observation">,
        options?: VenueToolCallOptions,
      ) => call("venue.record_post_event_observation", input, options),
      recordLesson: (input: VenueToolInput<"venue.record_post_event_lesson">, options?: VenueToolCallOptions) =>
        call("venue.record_post_event_lesson", input, options),
      createTemplateImprovementProposal: (
        input: VenueToolInput<"venue.create_template_improvement_proposal">,
        options?: VenueToolCallOptions,
      ) => call("venue.create_template_improvement_proposal", input, options),
      exportReport: (
        format?: VenueToolInput<"venue.export_post_event_report">["format"],
        options?: VenueToolCallOptions,
      ) => call("venue.export_post_event_report", format === undefined ? {} : { format }, options),
    }),
    exports: freezeNamespace({
      plan: (format?: VenueToolInput<"venue.export_plan">["format"], options?: VenueToolCallOptions) => call("venue.export_plan", format === undefined ? {} : { format }, options),
      audit: (options?: VenueToolCallOptions) => call("venue.export_audit_package", {}, options),
      deviations: (options?: VenueToolCallOptions) => call("venue.export_live_plan_deviations", {}, options),
    }),
    call,
  });
}
