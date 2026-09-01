import { venueToolContracts } from "../contracts/venue-contracts.ts";
import { DEFAULT_WEBMCP_SCOPES, executeVenueWebMcpTool } from "./tool-runtime.ts";

export const venueToolDefinitions = venueToolContracts;

export async function registerVenueTools(modelContext: any, planner: any, signal: any, { grantedScopes = DEFAULT_WEBMCP_SCOPES, organizationId = "org-local", projectId = "project-summit-forward", authorization, authorizationProvider, projectOperations, occupancyOperations, incidentOperations, onLifecycle = () => {} }: any = {}) {
  onLifecycle({ state: "registering", registered: 0, total: venueToolDefinitions.length, errorCode: null });
  let registered: any = 0;
  signal?.addEventListener("abort", () => onLifecycle({ state: "unregistered", registered: 0, total: venueToolDefinitions.length, errorCode: null }), { once: true });
  try {
    for (const definition of venueToolDefinitions) {
      const { contractVersion, authorization: _toolAuthorization, limits, exampleInput: _exampleInput, errors: _errors, ...webDefinition } = definition;
      await modelContext.registerTool({
        ...webDefinition,
        description: `${definition.description} Contract ${contractVersion}.`,
        execute: async (input: any = {}, context: any = {}) => executeVenueWebMcpTool({ contract: definition, planner, projectOperations, occupancyOperations, incidentOperations, input, signal: context.signal ?? signal, grantedScopes, organizationId, projectId, authorization: await authorizationProvider?.({ definition, input }) ?? authorization }),
      }, { signal });
      registered += 1;
      onLifecycle({ state: "registering", registered, total: venueToolDefinitions.length, errorCode: null });
    }
    const state: any = { state: "ready", registered, total: venueToolDefinitions.length, errorCode: null };
    onLifecycle(state);
    return state;
  } catch (error: any) {
    const state: any = { state: "failed", registered, total: venueToolDefinitions.length, errorCode: error?.name ?? error?.code ?? "REGISTRATION_FAILED" };
    onLifecycle(state);
    throw error;
  }
}
