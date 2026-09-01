import { commandForVenueTool, venueToolContracts } from "../contracts/venue-contracts.ts";
import { assertVenuePermission, permissionForTool, TRUSTED_LOCAL_AUTHORIZATION } from "../domain/authorization.ts";
import { venueError } from "../domain/errors.ts";

const contracts: any = new Map(venueToolContracts.map((contract: any) => [contract.name, contract]));

const canonicalProjectList: any = (value: any) => {
  const source: any = Array.isArray(value) ? "repository" : value?.source ?? "repository";
  const projects: any = Array.isArray(value) ? value : value?.projects;
  if (!Array.isArray(projects)) throw venueError("PROJECT_TOOL_UNAVAILABLE", { reason: "project-list-contract" });
  return { source, projects };
};

const canonicalProjectOpen: any = (value: any) => value?.project
  ? { status: value.status ?? "active", project: { ...value.project, active: value.project.active ?? value.status === "active" } }
  : { status: "active", project: { ...value, active: value?.active ?? true } };

export function createVenueToolService({ executeCommand, projectOperations, occupancyOperations, incidentOperations, authorization: defaultAuthorization = TRUSTED_LOCAL_AUTHORIZATION, authorizationProvider, recordAuthorizationDenial }: any = {}) {
  if (typeof executeCommand !== "function") throw new TypeError("Venue tool service requires a command executor");

  return Object.freeze({
    async execute(name: any, input: any = {}, source: any = "agent-tool", { signal, authorization: suppliedAuthorization, organizationId: suppliedOrganizationId, projectId: suppliedProjectId }: any = {}) {
      if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { toolName: name });
      const contract: any = contracts.get(name);
      if (!contract) throw venueError("COMMAND_UNSUPPORTED", { toolName: name });
      const authorization: any = suppliedAuthorization ?? await authorizationProvider?.({ name, input, source }) ?? defaultAuthorization;
      const projectId: any = name === "venue.open_project" ? input.projectId : suppliedProjectId ?? authorization?.projectId ?? null;
      const organizationId: any = suppliedOrganizationId ?? authorization?.organizationId ?? null;
      try {
        assertVenuePermission({
          ...authorization,
          permission: permissionForTool(name, contract.authorization.requiredScope),
          organizationId,
          projectId,
        });
      } catch (error: any) {
        await recordAuthorizationDenial?.({ error, actionType: name, source, sessionId: input.correlationId ?? "agent-session" });
        throw error;
      }
      let output: any;
      if (name === "venue.list_projects") {
        if (typeof projectOperations?.listProjects !== "function") throw venueError("PROJECT_TOOL_UNAVAILABLE", { toolName: name });
        output = canonicalProjectList(await projectOperations.listProjects());
        if (authorization?.principal?.type === "agent") {
          const allowedProjectId: any = authorization.grant?.projectId;
          output = { ...output, projects: output.projects.filter((project: any) => project.id === allowedProjectId) };
        }
      } else if (name === "venue.open_project") {
        if (typeof projectOperations?.openProject !== "function") throw venueError("PROJECT_TOOL_UNAVAILABLE", { toolName: name });
        output = canonicalProjectOpen(await projectOperations.openProject(input.projectId));
      } else if (name === "venue.inspect_live_occupancy") {
        if (typeof occupancyOperations?.inspectLiveOccupancy !== "function") throw venueError("OCCUPANCY_TOOL_UNAVAILABLE", { toolName: name });
        output = await occupancyOperations.inspectLiveOccupancy(input, { source, authorization, organizationId, projectId, signal });
      } else if (name === "venue.ingest_occupancy_signal") {
        if (typeof occupancyOperations?.ingestOccupancySignal !== "function") throw venueError("OCCUPANCY_TOOL_UNAVAILABLE", { toolName: name });
        output = await occupancyOperations.ingestOccupancySignal(input, { source, authorization, organizationId, projectId, signal });
      } else if (name === "venue.refresh_live_occupancy") {
        if (typeof occupancyOperations?.refreshLiveOccupancy !== "function") throw venueError("OCCUPANCY_TOOL_UNAVAILABLE", { toolName: name });
        output = await occupancyOperations.refreshLiveOccupancy(input, { source, authorization, organizationId, projectId, signal });
      } else if (name === "venue.export_live_occupancy") {
        if (typeof occupancyOperations?.exportLiveOccupancy !== "function") throw venueError("OCCUPANCY_TOOL_UNAVAILABLE", { toolName: name });
        output = await occupancyOperations.exportLiveOccupancy(input, { source, authorization, organizationId, projectId, signal });
      } else if (name === "venue.inspect_incidents") {
        if (typeof incidentOperations?.inspectIncidents !== "function") throw venueError("INCIDENT_TOOL_UNAVAILABLE", { toolName: name });
        output = await incidentOperations.inspectIncidents(input, { source, authorization, organizationId, projectId, signal });
      } else if (name === "venue.report_incident") {
        if (typeof incidentOperations?.reportIncident !== "function") throw venueError("INCIDENT_TOOL_UNAVAILABLE", { toolName: name });
        output = await incidentOperations.reportIncident(input, { source, authorization, organizationId, projectId, signal });
      } else if (name === "venue.export_incident_record") {
        if (typeof incidentOperations?.exportIncidentRecord !== "function") throw venueError("INCIDENT_TOOL_UNAVAILABLE", { toolName: name });
        output = await incidentOperations.exportIncidentRecord(input, { source, authorization, organizationId, projectId, signal });
      } else {
        output = await executeCommand(commandForVenueTool(name, input, source), { signal, authorization, organizationId, projectId });
      }
      if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { toolName: name });
      return output;
    },
  });
}
