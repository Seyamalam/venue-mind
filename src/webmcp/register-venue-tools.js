import { venueToolContracts } from "../contracts/venue-contracts.js";
import { DEFAULT_WEBMCP_SCOPES, executeVenueWebMcpTool } from "./tool-runtime.js";

export const venueToolDefinitions = venueToolContracts;

export async function registerVenueTools(modelContext, planner, signal, { grantedScopes = DEFAULT_WEBMCP_SCOPES, organizationId = "org-local", projectId = "project-summit-forward", authorization, projectOperations, occupancyOperations, onLifecycle = () => {} } = {}) {
  onLifecycle({ state: "registering", registered: 0, total: venueToolDefinitions.length, errorCode: null });
  let registered = 0;
  signal?.addEventListener("abort", () => onLifecycle({ state: "unregistered", registered: 0, total: venueToolDefinitions.length, errorCode: null }), { once: true });
  try {
    for (const definition of venueToolDefinitions) {
      const { contractVersion, authorization: _toolAuthorization, limits, exampleInput: _exampleInput, errors: _errors, ...webDefinition } = definition;
      await modelContext.registerTool({
        ...webDefinition,
        description: `${definition.description} Contract ${contractVersion}.`,
        execute: async (input = {}, context = {}) => executeVenueWebMcpTool({ contract: definition, planner, projectOperations, occupancyOperations, input, signal: context.signal ?? signal, grantedScopes, organizationId, projectId, authorization }),
      }, { signal });
      registered += 1;
      onLifecycle({ state: "registering", registered, total: venueToolDefinitions.length, errorCode: null });
    }
    const state = { state: "ready", registered, total: venueToolDefinitions.length, errorCode: null };
    onLifecycle(state);
    return state;
  } catch (error) {
    const state = { state: "failed", registered, total: venueToolDefinitions.length, errorCode: error?.name ?? error?.code ?? "REGISTRATION_FAILED" };
    onLifecycle(state);
    throw error;
  }
}
