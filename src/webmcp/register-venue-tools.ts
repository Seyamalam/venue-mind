import { venueToolContracts, type VenueToolContract, type VenueToolInput } from "../contracts/venue-contracts.ts";
import type { AgentScope } from "../domain/authorization.ts";
import type {
  DeviationOperations,
  IncidentOperations,
  OccupancyOperations,
  PostEventOperations,
  ProjectOperations,
  ToolAuthorization,
} from "../tools/venue-tool-service.ts";
import type { TelemetryClock, TelemetrySink } from "../observability/telemetry.ts";
import {
  DEFAULT_WEBMCP_SCOPES,
  executeVenueWebMcpTool,
  type WebMcpPlanner,
  type WebMcpToolResult,
} from "./tool-runtime.ts";

export const venueToolDefinitions = venueToolContracts;

export type ToolRegistrationState = "registering" | "ready" | "failed" | "unregistered";
export interface ToolRegistrationLifecycle {
  readonly state: ToolRegistrationState;
  readonly registered: number;
  readonly total: number;
  readonly errorCode: string | null;
}

interface WebMcpExecutionContext {
  readonly signal?: AbortSignal;
}
type WebMcpToolDefinition = Omit<
  VenueToolContract,
  "description" | "contractVersion" | "authorization" | "limits" | "exampleInput" | "errors"
> & {
  readonly description: string;
  readonly execute: (input?: VenueToolInput, context?: WebMcpExecutionContext) => Promise<WebMcpToolResult>;
};

export interface BrowserModelContext {
  registerTool(definition: WebMcpToolDefinition, options: { readonly signal: AbortSignal }): Promise<void> | void;
}

export interface RegisterVenueToolOptions {
  readonly grantedScopes?: readonly AgentScope[];
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly authorization?: ToolAuthorization;
  readonly authorizationProvider?: (context: {
    readonly definition: VenueToolContract;
    readonly input: VenueToolInput;
  }) => Promise<ToolAuthorization> | ToolAuthorization;
  readonly projectOperations?: ProjectOperations;
  readonly occupancyOperations?: Partial<OccupancyOperations>;
  readonly incidentOperations?: Partial<IncidentOperations>;
  readonly deviationOperations?: Partial<DeviationOperations>;
  readonly postEventOperations?: Partial<PostEventOperations>;
  readonly onLifecycle?: (lifecycle: ToolRegistrationLifecycle) => void;
  readonly observability?: TelemetrySink;
  readonly telemetryClock?: TelemetryClock;
}

const errorCode = (error: unknown): string => {
  if (error instanceof Error && error.name) return error.name;
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string")
    return error.code;
  return "REGISTRATION_FAILED";
};

export async function registerVenueTools(
  modelContext: BrowserModelContext,
  planner: WebMcpPlanner,
  signal: AbortSignal,
  {
    grantedScopes = DEFAULT_WEBMCP_SCOPES,
    organizationId = "org-local",
    projectId = "project-summit-forward",
    authorization,
    authorizationProvider,
    projectOperations,
    occupancyOperations,
    incidentOperations,
    deviationOperations,
    postEventOperations,
    onLifecycle = () => {},
    observability,
    telemetryClock,
  }: RegisterVenueToolOptions = {},
): Promise<ToolRegistrationLifecycle> {
  onLifecycle({ state: "registering", registered: 0, total: venueToolDefinitions.length, errorCode: null });
  let registered = 0;
  signal.addEventListener(
    "abort",
    () => onLifecycle({ state: "unregistered", registered: 0, total: venueToolDefinitions.length, errorCode: null }),
    { once: true },
  );
  try {
    for (const definition of venueToolDefinitions) {
      const {
        contractVersion,
        authorization: _toolAuthorization,
        limits: _limits,
        exampleInput: _exampleInput,
        errors: _errors,
        ...webDefinition
      } = definition;
      await modelContext.registerTool(
        {
          ...webDefinition,
          description: `${definition.description} Contract ${contractVersion}.`,
          execute: async (input = {}, context = {}) => {
            const resolvedAuthorization = (await authorizationProvider?.({ definition, input })) ?? authorization;
            return executeVenueWebMcpTool({
              contract: definition,
              planner,
              input,
              signal: context.signal ?? signal,
              grantedScopes,
              organizationId,
              projectId,
              ...(resolvedAuthorization ? { authorization: resolvedAuthorization } : {}),
              ...(projectOperations ? { projectOperations } : {}),
              ...(occupancyOperations ? { occupancyOperations } : {}),
              ...(incidentOperations ? { incidentOperations } : {}),
              ...(deviationOperations ? { deviationOperations } : {}),
              ...(postEventOperations ? { postEventOperations } : {}),
              ...(observability ? { observability } : {}),
              ...(telemetryClock ? { telemetryClock } : {}),
            });
          },
        },
        { signal },
      );
      registered += 1;
      onLifecycle({ state: "registering", registered, total: venueToolDefinitions.length, errorCode: null });
    }
    const state: ToolRegistrationLifecycle = {
      state: "ready",
      registered,
      total: venueToolDefinitions.length,
      errorCode: null,
    };
    onLifecycle(state);
    return state;
  } catch (error) {
    const state: ToolRegistrationLifecycle = {
      state: "failed",
      registered,
      total: venueToolDefinitions.length,
      errorCode: errorCode(error),
    };
    onLifecycle(state);
    throw error;
  }
}
