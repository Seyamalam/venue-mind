import { VENUE_TOOL_AUTHORIZATION_SCOPES } from "../contracts/venue-contracts.js";
import { createShortLivedAgentAuthorization } from "../domain/authorization.js";
import { errorPayload, venueError } from "../domain/errors.js";
import { createVenueToolService } from "../tools/venue-tool-service.js";

const encoder = new TextEncoder();
const byteLength = (value) => encoder.encode(JSON.stringify(value)).byteLength;
const SENSITIVE_KEYS = /^(apiKey|accessToken|refreshToken|authorization|password|secret|attendeeRecords|attendeeHealthRecords|contactEmail|contactPhone)$/i;

export const DEFAULT_WEBMCP_SCOPES = Object.freeze([...VENUE_TOOL_AUTHORIZATION_SCOPES]);

export const redactToolData = (value, seen = new WeakSet()) => {
  if (Array.isArray(value)) return value.map((item) => redactToolData(item, seen));
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redactToolData(item, seen)]));
};

const resultSummary = (toolName, output) => {
  if (toolName === "venue.inspect_layout") return `Plan ${output.planId} v${output.planVersion} · ${output.objects?.length ?? 0} objects · Proposal ${output.proposal?.status ?? "unknown"}`;
  if (toolName === "venue.validate_layout") return `Validation ${output.status} · ${output.unresolvedIssues ?? 0} unresolved · ${output.validationId}`;
  if (toolName === "venue.export_plan" || toolName === "venue.export_simulation") return `Export ${output.format} · ${output.filename} · ${output.encoding}`;
  if (toolName === "venue.preview_revision") return `Proposal ${output.proposalId} · ${output.status} · ${output.changedItems ?? 0} changes`;
  if (toolName === "venue.run_scenario") return `Simulation ${output.runId} · ${output.status} · ${output.model}`;
  if (toolName === "venue.inspect_live_occupancy" || toolName === "venue.refresh_live_occupancy" || toolName === "venue.ingest_occupancy_signal") return `Occupancy ${output.projection?.overallStatus ?? output.overallStatus ?? "unavailable"} · R${output.monitor?.revision ?? output.revision ?? 0}`;
  if (toolName === "venue.export_live_occupancy") return `Occupancy export · ${output.filename}`;
  if (Array.isArray(output)) return `${toolName} · ${output.length} records`;
  const status = output?.status ?? "ok";
  const stableId = output?.proposalId ?? output?.branchId ?? output?.commentId ?? output?.id ?? null;
  return `${toolName} · ${status}${stableId ? ` · ${stableId}` : ""}`;
};

const cancelled = (signal) => signal?.aborted === true;

export async function executeVenueWebMcpTool({ contract, planner, projectOperations, occupancyOperations, toolService, input = {}, signal, grantedScopes = DEFAULT_WEBMCP_SCOPES, organizationId = "org-local", projectId = "project-summit-forward", authorization: suppliedAuthorization, clock = () => new Date().toISOString(), correlationIdFactory = () => `corr-webmcp-${globalThis.crypto?.randomUUID?.() ?? Date.now()}` }) {
  const correlationId = typeof input.correlationId === "string" && input.correlationId.trim() ? input.correlationId.trim() : correlationIdFactory();
  const metadata = { toolName: contract.name, contractVersion: contract.contractVersion, correlationId };
  try {
    if (cancelled(signal)) throw venueError("TOOL_CALL_CANCELLED", metadata);
    const requiredScope = contract.authorization.requiredScope;
    if (!new Set(grantedScopes).has(requiredScope)) throw venueError("TOOL_SCOPE_REQUIRED", { ...metadata, requiredScope });
    const authorization = suppliedAuthorization ?? createShortLivedAgentAuthorization({ agentId: "webmcp-agent", organizationId, projectId, scopes: grantedScopes, issuedBy: "venuemind-webmcp-host", clock });
    const inputBytes = byteLength(input);
    if (inputBytes > contract.limits.maximumInputBytes) throw venueError("TOOL_PAYLOAD_TOO_LARGE", { ...metadata, direction: "input", actualBytes: inputBytes, maximumBytes: contract.limits.maximumInputBytes });

    const service = toolService ?? createVenueToolService({ executeCommand: (command, options) => planner.execute(command, options), projectOperations, occupancyOperations, recordAuthorizationDenial: (denial) => planner.recordAuthorizationDenial(denial) });
    const output = await service.execute(contract.name, input, "webmcp", { signal, authorization, organizationId, projectId });
    if (cancelled(signal)) throw venueError("TOOL_CALL_CANCELLED", metadata);
    const data = redactToolData(output);
    const outputBytes = byteLength(data);
    if (outputBytes > contract.limits.maximumOutputBytes) throw venueError("TOOL_PAYLOAD_TOO_LARGE", { ...metadata, direction: "output", actualBytes: outputBytes, maximumBytes: contract.limits.maximumOutputBytes });
    const summary = resultSummary(contract.name, data);
    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { schemaVersion: 1, ...metadata, authorizationScope: requiredScope, summary, data },
    };
  } catch (error) {
    const payload = errorPayload(error);
    const summary = `${payload.error.code} · ${payload.error.message}`;
    return {
      isError: true,
      content: [{ type: "text", text: summary }],
      structuredContent: { schemaVersion: 1, ...metadata, summary, ...payload },
    };
  }
}
