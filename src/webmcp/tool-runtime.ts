import {
  VENUE_TOOL_AUTHORIZATION_SCOPES,
  type VenueToolContract,
  type VenueToolInput,
  type commandForVenueTool,
} from "../contracts/venue-contracts.ts";
import { createShortLivedAgentAuthorization, type AgentScope } from "../domain/authorization.ts";
import { errorPayload, venueError } from "../domain/errors.ts";
import { measureJsonResource } from "../security/resource-limits.ts";
import type { TelemetryClock, TelemetrySink } from "../observability/telemetry.ts";
import {
  createVenueToolService,
  type AuthorizationDenial,
  type DeviationOperations,
  type IncidentOperations,
  type OccupancyOperations,
  type PostEventOperations,
  type ProjectOperations,
  type ToolAuthorization,
  type ToolExecutionContext,
  type VenueToolService,
} from "../tools/venue-tool-service.ts";

type JsonScalar = string | number | boolean | null;
export type RedactedToolData = JsonScalar | RedactedToolData[] | { [key: string]: RedactedToolData };
type RedactedRecord = { [key: string]: RedactedToolData };

const SENSITIVE_KEYS =
  /^(apiKey|accessToken|refreshToken|authorization|password|secret|attendeeRecords|attendeeHealthRecords|contactEmail|contactPhone)$/i;

export const DEFAULT_WEBMCP_SCOPES: readonly AgentScope[] = Object.freeze([...VENUE_TOOL_AUTHORIZATION_SCOPES]);

export const redactToolData = (value: unknown, seen: WeakSet<object> = new WeakSet<object>()): RedactedToolData => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean")
    return value;
  if (Array.isArray(value)) return value.map((item) => redactToolData(item, seen));
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.description ?? "[Symbol]";
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "undefined") return "[Undefined]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const output: RedactedRecord = {};
  for (const [key, item] of Object.entries(value))
    output[key] = SENSITIVE_KEYS.test(key) ? "[REDACTED]" : redactToolData(item, seen);
  return output;
};

const recordValue = (value: RedactedToolData | undefined): RedactedRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;
const redactToolRecord = (value: object): RedactedRecord => {
  const redacted = redactToolData(value);
  const record = recordValue(redacted);
  if (!record) throw new TypeError("Tool result must be an object");
  return record;
};
const stringValue = (value: RedactedToolData | undefined, fallback: string): string =>
  typeof value === "string" ? value : fallback;
const numberValue = (value: RedactedToolData | undefined, fallback = 0): number =>
  typeof value === "number" ? value : fallback;
const arrayLength = (value: RedactedToolData | undefined): number => (Array.isArray(value) ? value.length : 0);

const resultSummary = (toolName: VenueToolContract["name"], output: RedactedToolData): string => {
  if (Array.isArray(output)) return `${toolName} · ${output.length} records`;
  const record = recordValue(output);
  if (!record) return `${toolName} · ok`;
  if (toolName === "venue.inspect_layout")
    return `Plan ${stringValue(record["planId"], "unknown")} v${stringValue(record["planVersion"], "unknown")} · ${arrayLength(record["objects"])} objects · Proposal ${stringValue(recordValue(record["proposal"])?.["status"], "unknown")}`;
  if (toolName === "venue.validate_layout")
    return `Validation ${stringValue(record["status"], "unknown")} · ${numberValue(record["unresolvedIssues"])} unresolved · ${stringValue(record["validationId"], "unknown")}`;
  if (toolName === "venue.export_plan" || toolName === "venue.export_simulation")
    return `Export ${stringValue(record["format"], "unknown")} · ${stringValue(record["filename"], "unknown")} · ${stringValue(record["encoding"], "unknown")}`;
  if (toolName === "venue.preview_revision")
    return `Proposal ${stringValue(record["proposalId"], "unknown")} · ${stringValue(record["status"], "unknown")} · ${numberValue(record["changedItems"])} changes`;
  if (toolName === "venue.run_scenario")
    return `Simulation ${stringValue(record["runId"], "unknown")} · ${stringValue(record["status"], "unknown")} · ${stringValue(record["model"], "unknown")}`;
  if (
    toolName === "venue.inspect_live_occupancy" ||
    toolName === "venue.refresh_live_occupancy" ||
    toolName === "venue.ingest_occupancy_signal"
  ) {
    const projection = recordValue(record["projection"]);
    const monitor = recordValue(record["monitor"]);
    return `Occupancy ${stringValue(projection?.["overallStatus"] ?? record["overallStatus"], "unavailable")} · R${numberValue(monitor?.["revision"] ?? record["revision"])}`;
  }
  if (toolName === "venue.export_live_occupancy")
    return `Occupancy export · ${stringValue(record["filename"], "unknown")}`;
  if (toolName === "venue.inspect_incidents" || toolName === "venue.report_incident") {
    const register = recordValue(record["register"]);
    return `Incidents ${arrayLength(register?.["incidents"] ?? record["incidents"])} · R${numberValue(register?.["revision"])}`;
  }
  if (toolName === "venue.export_incident_record")
    return `Incident export · ${stringValue(record["filename"], "unknown")}`;
  if (
    toolName === "venue.inspect_live_plan_deviations" ||
    toolName === "venue.record_live_plan_deviation" ||
    toolName === "venue.end_live_plan_deviation" ||
    toolName === "venue.create_post_event_deviation_proposal"
  ) {
    const register = recordValue(record["register"]);
    return `Deviations ${arrayLength(register?.["deviations"] ?? record["deviations"])} · R${numberValue(register?.["revision"])}`;
  }
  if (toolName === "venue.export_live_plan_deviations")
    return `Deviation export · ${stringValue(record["filename"], "unknown")}`;
  if (toolName === "venue.inspect_post_event_review") {
    const review = recordValue(record["review"]);
    return `Post-event R${numberValue(review?.["revision"])} · ${arrayLength(record["comparisons"])} comparisons`;
  }
  if (
    toolName === "venue.record_post_event_observation" ||
    toolName === "venue.record_post_event_lesson" ||
    toolName === "venue.create_template_improvement_proposal"
  ) {
    const review = recordValue(record["review"]);
    const subject = recordValue(record["subject"]);
    return `Post-event R${numberValue(review?.["revision"])} · ${stringValue(subject?.["id"], "unknown")}`;
  }
  if (toolName === "venue.export_post_event_report")
    return `Post-event export · ${stringValue(record["filename"], "unknown")}`;
  const status = stringValue(record["status"], "ok");
  const stableId = record["proposalId"] ?? record["branchId"] ?? record["commentId"] ?? record["id"];
  return `${toolName} · ${status}${typeof stableId === "string" ? ` · ${stableId}` : ""}`;
};

export interface WebMcpPlanner {
  execute(command: ReturnType<typeof commandForVenueTool>, context: ToolExecutionContext): Promise<object> | object;
  recordAuthorizationDenial(denial: AuthorizationDenial): Promise<void> | void;
}

export interface ExecuteVenueWebMcpToolOptions {
  readonly contract: VenueToolContract;
  readonly planner: WebMcpPlanner;
  readonly projectOperations?: ProjectOperations;
  readonly occupancyOperations?: Partial<OccupancyOperations>;
  readonly incidentOperations?: Partial<IncidentOperations>;
  readonly deviationOperations?: Partial<DeviationOperations>;
  readonly postEventOperations?: Partial<PostEventOperations>;
  readonly toolService?: VenueToolService;
  readonly input?: VenueToolInput;
  readonly signal?: AbortSignal;
  readonly grantedScopes?: readonly AgentScope[];
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly authorization?: ToolAuthorization;
  readonly clock?: () => string;
  readonly correlationIdFactory?: () => string;
  readonly observability?: TelemetrySink;
  readonly telemetryClock?: TelemetryClock;
}

export interface WebMcpToolResult {
  readonly isError?: true;
  readonly content: readonly Readonly<{ type: "text"; text: string }>[];
  readonly structuredContent: RedactedRecord;
}

export async function executeVenueWebMcpTool({
  contract,
  planner,
  projectOperations,
  occupancyOperations,
  incidentOperations,
  deviationOperations,
  postEventOperations,
  toolService,
  input = {},
  signal,
  grantedScopes = DEFAULT_WEBMCP_SCOPES,
  organizationId = "org-local",
  projectId = "project-summit-forward",
  authorization: suppliedAuthorization,
  clock = () => new Date().toISOString(),
  correlationIdFactory = () => `corr-webmcp-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
  observability,
  telemetryClock,
}: ExecuteVenueWebMcpToolOptions): Promise<WebMcpToolResult> {
  const correlationId = input.correlationId?.trim() || correlationIdFactory();
  const metadata = { toolName: contract.name, contractVersion: contract.contractVersion, correlationId };
  try {
    if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", metadata);
    const requiredScope = contract.authorization.requiredScope;
    if (!new Set(grantedScopes).has(requiredScope))
      throw venueError("TOOL_SCOPE_REQUIRED", { ...metadata, requiredScope });
    const authorization =
      suppliedAuthorization ??
      createShortLivedAgentAuthorization({
        agentId: "webmcp-agent",
        organizationId,
        projectId,
        scopes: grantedScopes,
        issuedBy: "venuemind-webmcp-host",
        clock,
      });
    measureJsonResource(input, {
      surface: "webmcp-input",
      maximumBytes: contract.limits.maximumInputBytes,
      errorCode: "TOOL_PAYLOAD_TOO_LARGE",
    });

    const service =
      toolService ??
      createVenueToolService({
        executeCommand: (command, options) => planner.execute(command, options),
        ...(projectOperations ? { projectOperations } : {}),
        ...(occupancyOperations ? { occupancyOperations } : {}),
        ...(incidentOperations ? { incidentOperations } : {}),
        ...(deviationOperations ? { deviationOperations } : {}),
        ...(postEventOperations ? { postEventOperations } : {}),
        recordAuthorizationDenial: (denial) => planner.recordAuthorizationDenial(denial),
        ...(observability ? { observability } : {}),
        ...(telemetryClock ? { telemetryClock } : {}),
      });
    const output = await service.execute(contract.name, input, "webmcp", {
      ...(signal ? { signal } : {}),
      authorization,
      organizationId,
      projectId,
    });
    if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", metadata);
    const data = redactToolData(output);
    measureJsonResource(data, {
      surface: "webmcp-output",
      maximumBytes: contract.limits.maximumOutputBytes,
      errorCode: "TOOL_PAYLOAD_TOO_LARGE",
    });
    const summary = resultSummary(contract.name, data);
    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { schemaVersion: 1, ...metadata, authorizationScope: requiredScope, summary, data },
    };
  } catch (error) {
    const payload = errorPayload(
      typeof error === "object" && error !== null ? error : new Error("Venue tool failed", { cause: error }),
    );
    const summary = `${payload.error.code} · ${payload.error.message}`;
    return {
      isError: true,
      content: [{ type: "text", text: summary }],
      structuredContent: redactToolRecord({ schemaVersion: 1, ...metadata, summary, ...payload }),
    };
  }
}
