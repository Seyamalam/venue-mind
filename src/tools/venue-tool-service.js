import { commandForVenueTool, venueToolContracts } from "../contracts/venue-contracts.js";
import { assertVenuePermission, permissionForTool, TRUSTED_LOCAL_AUTHORIZATION } from "../domain/authorization.js";
import { venueError } from "../domain/errors.js";

const contracts = new Map(venueToolContracts.map((contract) => [contract.name, contract]));

export function createVenueToolService({ executeCommand, projectOperations, authorization: defaultAuthorization = TRUSTED_LOCAL_AUTHORIZATION, authorizationProvider, recordAuthorizationDenial } = {}) {
  if (typeof executeCommand !== "function") throw new TypeError("Venue tool service requires a command executor");

  return Object.freeze({
    async execute(name, input = {}, source = "agent-tool", { signal, authorization: suppliedAuthorization, organizationId: suppliedOrganizationId, projectId: suppliedProjectId } = {}) {
      if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { toolName: name });
      const contract = contracts.get(name);
      if (!contract) throw venueError("COMMAND_UNSUPPORTED", { toolName: name });
      const authorization = suppliedAuthorization ?? await authorizationProvider?.({ name, input, source }) ?? defaultAuthorization;
      const projectId = name === "venue.open_project" ? input.projectId : suppliedProjectId ?? authorization?.projectId ?? null;
      const organizationId = suppliedOrganizationId ?? authorization?.organizationId ?? null;
      try {
        assertVenuePermission({
          ...authorization,
          permission: permissionForTool(name, contract.authorization.requiredScope),
          organizationId,
          projectId,
        });
      } catch (error) {
        await recordAuthorizationDenial?.({ error, actionType: name, source, sessionId: input.correlationId ?? "agent-session" });
        throw error;
      }
      let output;
      if (name === "venue.list_projects") {
        if (typeof projectOperations?.listProjects !== "function") throw venueError("PROJECT_TOOL_UNAVAILABLE", { toolName: name });
        output = await projectOperations.listProjects();
        if (authorization?.principal?.type === "agent") {
          const allowedProjectId = authorization.grant?.projectId;
          const records = Array.isArray(output) ? output : output.projects;
          const filtered = records.filter((project) => project.id === allowedProjectId);
          output = Array.isArray(output) ? filtered : { ...output, projects: filtered };
        }
      } else if (name === "venue.open_project") {
        if (typeof projectOperations?.openProject !== "function") throw venueError("PROJECT_TOOL_UNAVAILABLE", { toolName: name });
        output = await projectOperations.openProject(input.projectId);
      } else {
        output = await executeCommand(commandForVenueTool(name, input, source), { signal, authorization, organizationId, projectId });
      }
      if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { toolName: name });
      return output;
    },
  });
}
