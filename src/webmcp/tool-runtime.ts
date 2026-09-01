import { VENUE_TOOL_AUTHORIZATION_SCOPES } from "../contracts/venue-contracts.ts";
import { createShortLivedAgentAuthorization } from "../domain/authorization.ts";
import { errorPayload, venueError } from "../domain/errors.ts";
import { createVenueToolService } from "../tools/venue-tool-service.ts";

const encoder: any = new TextEncoder();
const byteLength: any = (value: any) => encoder.encode(JSON.stringify(value)).byteLength;
const SENSITIVE_KEYS: any = /^(apiKey|accessToken|refreshToken|authorization|password|secret|attendeeRecords|attendeeHealthRecords|contactEmail|contactPhone)$/i;

export const DEFAULT_WEBMCP_SCOPES = Object.freeze([...VENUE_TOOL_AUTHORIZATION_SCOPES]);

export const redactToolData = (value: any, seen: any = new WeakSet()): any => {
  if (Array.isArray(value)) return value.map((item: any) => redactToolData(item, seen));
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]: any) => [key, SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redactToolData(item, seen)]));
};

const resultSummary: any = (toolName: any, output: any) => {
  if (toolName === "venue.inspect_layout") return `Plan ${output.planId} v${output.planVersion} · ${output.objects?.length ?? 0} objects · Proposal ${output.proposal?.status ?? "unknown"}`;
  if (toolName === "venue.validate_layout") return `Validation ${output.status} · ${output.unresolvedIssues ?? 0} unresolved · ${output.validationId}`;
  if (toolName === "venue.export_plan" || toolName === "venue.export_simulation") return `Export ${output.format} · ${output.filename} · ${output.encoding}`;
  if (toolName === "venue.preview_revision") return `Proposal ${output.proposalId} · ${output.status} · ${output.changedItems ?? 0} changes`;
  if (toolName === "venue.run_scenario") return `Simulation ${output.runId} · ${output.status} · ${output.model}`;
  if (toolName === "venue.inspect_live_occupancy" || toolName === "venue.refresh_live_occupancy" || toolName === "venue.ingest_occupancy_signal") return `Occupancy ${output.projection?.overallStatus ?? output.overallStatus ?? "unavailable"} · R${output.monitor?.revision ?? output.revision ?? 0}`;
  if (toolName === "venue.export_live_occupancy") return `Occupancy export · ${output.filename}`;
  if (toolName === "venue.inspect_incidents" || toolName === "venue.report_incident") return `Incidents ${output.register?.incidents?.length ?? output.incidents?.length ?? 0} · R${output.register?.revision ?? 0}`;
  if (toolName === "venue.export_incident_record") return `Incident export · ${output.filename}`;
  if (Array.isArray(output)) return `${toolName} · ${output.length} records`;
  const status: any = output?.status ?? "ok";
  const stableId: any = output?.proposalId ?? output?.branchId ?? output?.commentId ?? output?.id ?? null;
  return `${toolName} · ${status}${stableId ? ` · ${stableId}` : ""}`;
};

const cancelled: any = (signal: any) => signal?.aborted === true;

export async function executeVenueWebMcpTool({ contract, planner, projectOperations, occupancyOperations, incidentOperations, toolService, input = {}, signal, grantedScopes = DEFAULT_WEBMCP_SCOPES, organizationId = "org-local", projectId = "project-summit-forward", authorization: suppliedAuthorization, clock = () => new Date().toISOString(), correlationIdFactory = () => `corr-webmcp-${globalThis.crypto?.randomUUID?.() ?? Date.now()}` }: any) {
  const correlationId: any = typeof input.correlationId === "string" && input.correlationId.trim() ? input.correlationId.trim() : correlationIdFactory();
  const metadata: any = { toolName: contract.name, contractVersion: contract.contractVersion, correlationId };
  try {
    if (cancelled(signal)) throw venueError("TOOL_CALL_CANCELLED", metadata);
    const requiredScope: any = contract.authorization.requiredScope;
    if (!new Set(grantedScopes).has(requiredScope)) throw venueError("TOOL_SCOPE_REQUIRED", { ...metadata, requiredScope });
    const authorization: any = suppliedAuthorization ?? createShortLivedAgentAuthorization({ agentId: "webmcp-agent", organizationId, projectId, scopes: grantedScopes, issuedBy: "venuemind-webmcp-host", clock });
    const inputBytes: any = byteLength(input);
    if (inputBytes > contract.limits.maximumInputBytes) throw venueError("TOOL_PAYLOAD_TOO_LARGE", { ...metadata, direction: "input", actualBytes: inputBytes, maximumBytes: contract.limits.maximumInputBytes });

    const service: any = toolService ?? createVenueToolService({ executeCommand: (command: any, options: any) => planner.execute(command, options), projectOperations, occupancyOperations, incidentOperations, recordAuthorizationDenial: (denial: any) => planner.recordAuthorizationDenial(denial) });
    const output: any = await service.execute(contract.name, input, "webmcp", { signal, authorization, organizationId, projectId });
    if (cancelled(signal)) throw venueError("TOOL_CALL_CANCELLED", metadata);
    const data: any = redactToolData(output);
    const outputBytes: any = byteLength(data);
    if (outputBytes > contract.limits.maximumOutputBytes) throw venueError("TOOL_PAYLOAD_TOO_LARGE", { ...metadata, direction: "output", actualBytes: outputBytes, maximumBytes: contract.limits.maximumOutputBytes });
    const summary: any = resultSummary(contract.name, data);
    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { schemaVersion: 1, ...metadata, authorizationScope: requiredScope, summary, data },
    };
  } catch (error: any) {
    const payload: any = errorPayload(error);
    const summary: any = `${payload.error.code} · ${payload.error.message}`;
    return {
      isError: true,
      content: [{ type: "text", text: summary }],
      structuredContent: { schemaVersion: 1, ...metadata, summary, ...payload },
    };
  }
}
