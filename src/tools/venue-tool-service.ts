import {
  commandForVenueTool,
  venueToolContracts,
  type VenueToolContract,
  type VenueToolInput,
  type VenueToolName,
  type VenueToolSource,
} from "../contracts/venue-contracts.ts";
import {
  assertVenuePermission,
  permissionForTool,
  TRUSTED_LOCAL_AUTHORIZATION,
  type AgentGrant,
  type HumanPrincipal,
  type VenuePrincipal,
} from "../domain/authorization.ts";
import { venueError } from "../domain/errors.ts";

export interface ToolAuthorization {
  readonly principal: VenuePrincipal;
  readonly grant?: AgentGrant;
  readonly delegatedBy?: HumanPrincipal;
  readonly organizationId?: string;
  readonly projectId?: string;
}

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly active?: boolean;
  readonly activePlanId?: string;
  readonly planVersion?: string;
  readonly proposalId?: string | null;
  readonly schemaVersion?: number;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface CanonicalProjectList {
  readonly source: string;
  readonly projects: readonly ProjectSummary[];
}
export interface CanonicalProjectOpen {
  readonly status: string;
  readonly project: ProjectSummary;
}
export interface ToolExecutionContext {
  readonly signal?: AbortSignal;
  readonly authorization?: ToolAuthorization;
  readonly organizationId?: string;
  readonly projectId?: string;
}

type ToolOutput = object | readonly object[];
type MaybePromise<T> = T | Promise<T>;
type Command = ReturnType<typeof commandForVenueTool>;
type CommandExecutor = (command: Command, context: ToolExecutionContext) => MaybePromise<ToolOutput>;
type Operation = (
  input: VenueToolInput,
  context: ToolExecutionContext & { readonly source: VenueToolSource },
) => MaybePromise<ToolOutput>;

export interface ProjectOperations {
  listProjects(): MaybePromise<CanonicalProjectList | ProjectSummary[]>;
  openProject(projectId: string): MaybePromise<CanonicalProjectOpen | ProjectSummary>;
}
export interface OccupancyOperations {
  inspectLiveOccupancy: Operation;
  ingestOccupancySignal: Operation;
  refreshLiveOccupancy: Operation;
  exportLiveOccupancy: Operation;
}
export interface IncidentOperations {
  inspectIncidents: Operation;
  reportIncident: Operation;
  exportIncidentRecord: Operation;
}
export interface DeviationOperations {
  inspectLivePlanDeviations: Operation;
  recordLivePlanDeviation: Operation;
  endLivePlanDeviation: Operation;
  createPostEventDeviationProposal: Operation;
  exportLivePlanDeviations: Operation;
}
export interface AuthorizationProviderContext {
  readonly name: VenueToolName;
  readonly input: VenueToolInput;
  readonly source: VenueToolSource;
}
export interface AuthorizationDenial {
  readonly error: Error;
  readonly actionType: VenueToolName;
  readonly source: VenueToolSource;
  readonly sessionId: string;
}

export interface VenueToolServiceOptions {
  readonly executeCommand: CommandExecutor;
  readonly projectOperations?: ProjectOperations;
  readonly occupancyOperations?: Partial<OccupancyOperations>;
  readonly incidentOperations?: Partial<IncidentOperations>;
  readonly deviationOperations?: Partial<DeviationOperations>;
  readonly authorization?: ToolAuthorization;
  readonly authorizationProvider?: (context: AuthorizationProviderContext) => MaybePromise<ToolAuthorization>;
  readonly recordAuthorizationDenial?: (denial: AuthorizationDenial) => MaybePromise<void>;
}

const contracts = new Map<VenueToolName, VenueToolContract>(
  venueToolContracts.map((contract) => [contract.name, contract]),
);

const canonicalProjectList = (value: CanonicalProjectList | ProjectSummary[]): CanonicalProjectList => {
  if (Array.isArray(value)) return { source: "repository", projects: value };
  return { source: value.source, projects: value.projects };
};

const canonicalProjectOpen = (value: CanonicalProjectOpen | ProjectSummary): CanonicalProjectOpen => {
  if ("project" in value)
    return {
      status: value.status,
      project: { ...value.project, active: value.project.active ?? value.status === "active" },
    };
  return { status: "active", project: { ...value, active: value.active ?? true } };
};

const requiredString = (value: string | undefined, field: string): string => {
  if (!value?.trim()) throw venueError("COMMAND_INVALID", { reason: "tool-input-required", field });
  return value;
};

const asError = (value: unknown): Error =>
  value instanceof Error ? value : new Error("Venue tool authorization failed", { cause: value });

export function createVenueToolService({
  executeCommand,
  projectOperations,
  occupancyOperations,
  incidentOperations,
  deviationOperations,
  authorization: defaultAuthorization = TRUSTED_LOCAL_AUTHORIZATION,
  authorizationProvider,
  recordAuthorizationDenial,
}: VenueToolServiceOptions) {
  return Object.freeze({
    async execute(
      name: VenueToolName,
      input: VenueToolInput = {},
      source: VenueToolSource = "agent-tool",
      {
        signal,
        authorization: suppliedAuthorization,
        organizationId: suppliedOrganizationId,
        projectId: suppliedProjectId,
      }: ToolExecutionContext = {},
    ): Promise<ToolOutput> {
      if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { toolName: name });
      const contract = contracts.get(name);
      if (!contract) throw venueError("COMMAND_UNSUPPORTED", { toolName: name });
      const authorization =
        suppliedAuthorization ?? (await authorizationProvider?.({ name, input, source })) ?? defaultAuthorization;
      const projectId =
        name === "venue.open_project"
          ? (input.projectId ?? null)
          : (suppliedProjectId ?? authorization.projectId ?? null);
      const organizationId = suppliedOrganizationId ?? authorization.organizationId ?? null;
      try {
        assertVenuePermission({
          ...authorization,
          permission: permissionForTool(name, contract.authorization.requiredScope),
          organizationId,
          projectId,
        });
      } catch (error) {
        await recordAuthorizationDenial?.({
          error: asError(error),
          actionType: name,
          source,
          sessionId: input.correlationId ?? "agent-session",
        });
        throw error;
      }
      const operationContext = {
        source,
        authorization,
        ...(organizationId ? { organizationId } : {}),
        ...(projectId ? { projectId } : {}),
        ...(signal ? { signal } : {}),
      };
      let output: ToolOutput;
      if (name === "venue.list_projects") {
        if (!projectOperations) throw venueError("PROJECT_TOOL_UNAVAILABLE", { toolName: name });
        const listed = canonicalProjectList(await projectOperations.listProjects());
        output =
          authorization.principal.type === "agent"
            ? {
                ...listed,
                projects: listed.projects.filter((project) => project.id === authorization.grant?.projectId),
              }
            : listed;
      } else if (name === "venue.open_project") {
        if (!projectOperations) throw venueError("PROJECT_TOOL_UNAVAILABLE", { toolName: name });
        output = canonicalProjectOpen(
          await projectOperations.openProject(requiredString(input.projectId, "projectId")),
        );
      } else if (
        name === "venue.inspect_live_occupancy" ||
        name === "venue.ingest_occupancy_signal" ||
        name === "venue.refresh_live_occupancy" ||
        name === "venue.export_live_occupancy"
      ) {
        const operation =
          name === "venue.inspect_live_occupancy"
            ? occupancyOperations?.inspectLiveOccupancy
            : name === "venue.ingest_occupancy_signal"
              ? occupancyOperations?.ingestOccupancySignal
              : name === "venue.refresh_live_occupancy"
                ? occupancyOperations?.refreshLiveOccupancy
                : occupancyOperations?.exportLiveOccupancy;
        if (!operation) throw venueError("OCCUPANCY_TOOL_UNAVAILABLE", { toolName: name });
        output = await operation(input, operationContext);
      } else if (
        name === "venue.inspect_incidents" ||
        name === "venue.report_incident" ||
        name === "venue.export_incident_record"
      ) {
        const operation =
          name === "venue.inspect_incidents"
            ? incidentOperations?.inspectIncidents
            : name === "venue.report_incident"
              ? incidentOperations?.reportIncident
              : incidentOperations?.exportIncidentRecord;
        if (!operation) throw venueError("INCIDENT_TOOL_UNAVAILABLE", { toolName: name });
        output = await operation(input, operationContext);
      } else if (
        name === "venue.inspect_live_plan_deviations" ||
        name === "venue.record_live_plan_deviation" ||
        name === "venue.end_live_plan_deviation" ||
        name === "venue.create_post_event_deviation_proposal" ||
        name === "venue.export_live_plan_deviations"
      ) {
        const operation =
          name === "venue.inspect_live_plan_deviations"
            ? deviationOperations?.inspectLivePlanDeviations
            : name === "venue.record_live_plan_deviation"
              ? deviationOperations?.recordLivePlanDeviation
              : name === "venue.end_live_plan_deviation"
                ? deviationOperations?.endLivePlanDeviation
                : name === "venue.create_post_event_deviation_proposal"
                  ? deviationOperations?.createPostEventDeviationProposal
                  : deviationOperations?.exportLivePlanDeviations;
        if (!operation) throw venueError("DEVIATION_TOOL_UNAVAILABLE", { toolName: name });
        output = await operation(input, operationContext);
      } else {
        output = await executeCommand(commandForVenueTool(name, input, source), operationContext);
      }
      if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { toolName: name });
      return output;
    },
  });
}

export type VenueToolService = ReturnType<typeof createVenueToolService>;
