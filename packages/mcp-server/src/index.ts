#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { McpServer, ResourceTemplate, type CallToolResult, type ServerContext } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  VENUE_TOOL_CONTRACT_VERSION,
  venueToolContracts,
  type VenueToolContract,
  type VenueToolInput,
  type VenueToolName,
} from "../../../src/contracts/venue-contracts.ts";
import { errorCatalog, errorPayload, venueError } from "../../../src/domain/errors.ts";
import { AGENT_SCOPES, createShortLivedAgentAuthorization } from "../../../src/domain/authorization.ts";
import { createVenueToolService, type ToolAuthorization } from "../../../src/tools/venue-tool-service.ts";
import { measureJsonResource } from "../../../src/security/resource-limits.ts";
import { createFileProjectRepository, type McpProjectRecord, type McpProjectRepository } from "./project-repository.ts";
import { createProjectSession, type McpLogger, type ProjectSession } from "./project-session.ts";

export { createFileProjectRepository, createMemoryProjectRepository } from "./project-repository.ts";
export { createProjectSession } from "./project-session.ts";

export const MCP_SERVER_VERSION = "0.7.0";
export const MCP_COMPATIBILITY = Object.freeze({
  minimumProtocolRevision: "2025-03-26",
  preferredProtocolRevision: "2026-07-28",
  projectSchemaVersion: 10,
  toolContractVersion: VENUE_TOOL_CONTRACT_VERSION,
  transport: "stdio",
  approvalAuthority: "human-only",
});

const instructions = [
  "Open a Project, then inspect its accepted Plan before proposing a change.",
  "Use Proposal branches, preview, and deterministic Validation before asking the human to approve in VenueMind Studio.",
  "Live Plan Deviation tools preserve the approved Plan, validate event-day Changes, and create only review-state post-event Proposals.",
  "Approval is intentionally absent from MCP.",
  "Treat stable IDs, baseVersion, idempotencyKey, and correlationId as concurrency and audit controls.",
].join(" ");

const agentReference = [
  "VenueMind MCP supervised planning sequence:",
  "1. venue.list_projects and venue.open_project.",
  "2. venue.get_project_brief and venue.inspect_layout.",
  "3. venue.create_proposal_branch or venue.preview_revision.",
  "4. venue.validate_layout and venue.detect_proposal_conflicts.",
  "5. venue.get_change_log and venue.export_plan.",
  "6. Stop for human review in VenueMind Studio. MCP has no Approval tool.",
  "7. During event operations, inspect and record Live Plan Deviations; create a post-event Proposal only from ended revision candidates.",
  "Remote transport guidance: stdio inherits the local host identity. A remote HTTP Adapter must validate bearer tokens, bind Project access to the authenticated principal, enforce published VenueMind scopes, require TLS, restrict origins, and never trust caller-supplied actor or organization IDs.",
].join("\n");

type StructuredValue = object | readonly object[];
type LogFields = Readonly<Record<string, string | number | boolean | null>>;
type LogSink = { write(chunk: string): unknown };
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isVenueToolInput = (value: unknown): value is VenueToolInput => isRecord(value);
const venueToolInput = (value: unknown): VenueToolInput => {
  if (!isVenueToolInput(value)) throw venueError("COMMAND_INVALID", { reason: "tool-input-object-required" });
  return value;
};
const resourceVariable = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
const jsonResource = (uri: URL, value: StructuredValue) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: `${JSON.stringify(value, null, 2)}\n` }],
});
const textResource = (uri: URL, value: string) => ({
  contents: [{ uri: uri.href, mimeType: "text/markdown", text: value }],
});
const structured = (value: StructuredValue): Record<string, unknown> => (isRecord(value) ? value : { result: value });

export function createStructuredLogger({
  sink = process.stderr,
  clock = () => new Date().toISOString(),
}: { readonly sink?: LogSink; readonly clock?: () => string } = {}): McpLogger {
  const write = (level: "info" | "error", event: string, fields: LogFields = {}): void => {
    sink.write(`${JSON.stringify({ timestamp: clock(), level, event, ...fields })}\n`);
  };
  return Object.freeze({
    info: (event: string, fields: LogFields) => {
      write("info", event, fields);
    },
    error: (event: string, fields: LogFields) => {
      write("error", event, fields);
    },
  });
}

const sendProgress = async (ctx: ServerContext, progress: number, total: number, message: string): Promise<void> => {
  const progressToken = ctx.mcpReq._meta?.progressToken;
  if (progressToken === undefined) return;
  await ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken, progress, total, message } });
};

const projectSummary = (record: McpProjectRecord) => ({
  id: record.id,
  name: record.name,
  activePlanId: record.activePlanId,
  schemaVersion: record.schemaVersion,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  planVersion: record.snapshot.plan.version,
  proposalId: record.snapshot.proposal.id,
});

interface VenueMindMcpServerOptions {
  readonly repository?: McpProjectRepository;
  readonly logger?: McpLogger;
  readonly organizationId?: string;
  readonly session?: ProjectSession;
  readonly agentAuthorization?: ToolAuthorization;
}

export function createVenueMindMcpServer({
  repository = createFileProjectRepository(),
  logger = createStructuredLogger(),
  organizationId = repository.organizationId,
  session = createProjectSession({ repository, organizationId, logger }),
  agentAuthorization,
}: VenueMindMcpServerOptions = {}) {
  const server = new McpServer(
    { name: "venuemind", title: "VenueMind", version: MCP_SERVER_VERSION },
    {
      instructions,
      cacheHints: {
        "tools/list": { ttlMs: 60_000, cacheScope: "public" },
        "prompts/list": { ttlMs: 60_000, cacheScope: "public" },
        "resources/templates/list": { ttlMs: 60_000, cacheScope: "public" },
      },
    },
  );
  const toolService = createVenueToolService({
    executeCommand: (command, options) => session.execute(command, options),
    projectOperations: session,
    occupancyOperations: session,
    incidentOperations: session,
    deviationOperations: session,
    postEventOperations: session,
    authorizationProvider: () =>
      agentAuthorization ??
      createShortLivedAgentAuthorization({
        agentId: "mcp-agent",
        organizationId,
        projectId: "project-summit-forward",
        scopes: AGENT_SCOPES,
        issuedBy: "venuemind-stdio-host",
      }),
    recordAuthorizationDenial: async (denial) => {
      await session.recordAuthorizationDenial(denial);
    },
  });

  const execute = async (
    name: VenueToolName,
    input: VenueToolInput,
    limits: VenueToolContract["limits"],
    ctx: ServerContext,
    operation: () => Promise<StructuredValue>,
  ): Promise<CallToolResult> => {
    const correlationId = input.correlationId || `mcp-${String(ctx.mcpReq.id)}`;
    const expensive =
      name === "venue.validate_layout" || name === "venue.run_scenario" || name === "venue.compare_simulations";
    logger.info("tool.started", { organizationId, tool: name, correlationId });
    try {
      if (ctx.mcpReq.signal.aborted) throw venueError("TOOL_CALL_CANCELLED", { tool: name });
      measureJsonResource(input, {
        surface: "mcp-input",
        maximumBytes: limits.maximumInputBytes,
        errorCode: "TOOL_PAYLOAD_TOO_LARGE",
      });
      if (expensive) await sendProgress(ctx, 0, 1, name === "venue.validate_layout" ? "validating" : "simulating");
      const output = await operation();
      measureJsonResource(output, {
        surface: "mcp-output",
        maximumBytes: limits.maximumOutputBytes,
        errorCode: "TOOL_PAYLOAD_TOO_LARGE",
      });
      if (expensive) await sendProgress(ctx, 1, 1, "complete");
      logger.info("tool.completed", { organizationId, tool: name, correlationId });
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
        structuredContent: structured(output),
      };
    } catch (error) {
      const payload = errorPayload(error instanceof Error ? error : new Error("MCP tool failed", { cause: error }));
      logger.error("tool.failed", { organizationId, tool: name, correlationId, code: payload.error.code });
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
        isError: true,
      };
    }
  };

  for (const contract of venueToolContracts) {
    const annotations = "annotations" in contract ? contract.annotations : undefined;
    server.registerTool(
      contract.name,
      {
        title: contract.title,
        description: contract.description,
        ...(annotations ? { annotations } : {}),
        inputSchema: z.fromJSONSchema(contract.inputSchema),
        _meta: {
          "venuemind/serverVersion": MCP_SERVER_VERSION,
          "venuemind/contractVersion": contract.contractVersion,
          "venuemind/requiredScope": contract.authorization.requiredScope,
          "venuemind/errors": contract.errors,
        },
      },
      (input, ctx) => {
        const normalizedInput = venueToolInput(input);
        return execute(contract.name, normalizedInput, contract.limits, ctx, () =>
          toolService.execute(contract.name, normalizedInput, "mcp", { signal: ctx.mcpReq.signal }),
        );
      },
    );
  }

  server.registerResource(
    "current-project",
    "venuemind://current/project",
    { title: "Current Project", mimeType: "application/json" },
    async (uri) => {
      const { record } = await session.current();
      return jsonResource(uri, projectSummary(record));
    },
  );
  server.registerResource(
    "current-plan",
    "venuemind://current/plan",
    { title: "Current Plan Version", mimeType: "application/json" },
    async (uri) => {
      const { snapshot } = await session.current();
      return jsonResource(uri, snapshot.plan);
    },
  );
  server.registerResource(
    "active-proposal",
    "venuemind://current/proposal",
    { title: "Active Proposal", mimeType: "application/json" },
    async (uri) => {
      const { snapshot } = await session.current();
      return jsonResource(uri, snapshot.proposal);
    },
  );
  server.registerResource(
    "contract-schemas",
    "venuemind://schemas/index",
    { title: "VenueMind Contract Schemas", mimeType: "application/json" },
    (uri) =>
      jsonResource(uri, {
        contractVersion: VENUE_TOOL_CONTRACT_VERSION,
        tools: venueToolContracts.map(({ name, inputSchema, authorization, limits, exampleInput, errors }) => ({
          name,
          inputSchema,
          authorization,
          limits,
          exampleInput,
          errors,
        })),
        errors: errorCatalog,
      }),
  );
  server.registerResource(
    "agent-reference",
    "venuemind://docs/agent-reference",
    { title: "VenueMind Agent Reference", mimeType: "text/markdown" },
    (uri) => textResource(uri, agentReference),
  );
  server.registerResource(
    "server-capabilities",
    "venuemind://server/capabilities",
    { title: "VenueMind MCP Compatibility", mimeType: "application/json" },
    (uri) =>
      jsonResource(uri, {
        serverVersion: MCP_SERVER_VERSION,
        compatibility: MCP_COMPATIBILITY,
        tools: { shared: venueToolContracts.length, session: 0 },
        resources: true,
        resourceTemplates: true,
        prompts: ["venuemind.supervised_planning", "venuemind.audit_plan"],
        progress: ["venue.validate_layout", "venue.run_scenario", "venue.compare_simulations"],
      }),
  );

  const projectTemplate = new ResourceTemplate("venuemind://projects/{projectId}", {
    list: async () => ({
      resources: (await session.listProjects()).map((project) => ({
        uri: `venuemind://projects/${encodeURIComponent(project.id)}`,
        name: project.id,
        title: project.name,
        mimeType: "application/json",
      })),
    }),
    complete: {
      projectId: async (value) =>
        (await session.listProjects()).map((project) => project.id).filter((id) => id.startsWith(value)),
    },
  });
  server.registerResource(
    "project-by-id",
    projectTemplate,
    { title: "Project by ID", mimeType: "application/json" },
    async (uri, variables) => {
      const record = await session.readProject(String(variables.projectId));
      return jsonResource(uri, projectSummary(record));
    },
  );

  const planTemplate = new ResourceTemplate("venuemind://projects/{projectId}/plans/{planVersion}", {
    list: async () => ({
      resources: (await session.listProjects()).map((project) => ({
        uri: `venuemind://projects/${encodeURIComponent(project.id)}/plans/${encodeURIComponent(project.planVersion ?? "")}`,
        name: `${project.id}@${project.planVersion ?? ""}`,
        title: `${project.name} ${project.planVersion ?? ""}`,
        mimeType: "application/json",
      })),
    }),
    complete: {
      projectId: async (value) =>
        (await session.listProjects()).map((project) => project.id).filter((id) => id.startsWith(value)),
      planVersion: async (value, context) => {
        const projectId = resourceVariable(context?.arguments?.projectId);
        const record = projectId ? await session.readProject(projectId) : null;
        return record?.snapshot?.plan?.version?.startsWith(value) ? [record.snapshot.plan.version] : [];
      },
    },
  });
  server.registerResource(
    "plan-by-project-and-version",
    planTemplate,
    { title: "Plan Version by Project", mimeType: "application/json" },
    async (uri, variables) => {
      const record = await session.readProject(resourceVariable(variables.projectId));
      const planVersion = resourceVariable(variables.planVersion);
      if (record.snapshot.plan.version !== planVersion) throw new Error(`Plan Version not found: ${planVersion}`);
      return jsonResource(uri, record.snapshot.plan);
    },
  );

  server.registerPrompt(
    "venuemind.supervised_planning",
    {
      title: "Supervised venue planning",
      description: "Inspect, branch, preview, validate, audit, and stop for human Approval.",
      argsSchema: z.object({ goal: z.string().min(1), projectId: z.string().optional() }),
    },
    ({ goal, projectId }) => ({
      description: "VenueMind supervised planning workflow",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use VenueMind to ${goal}. ${projectId ? `Open Project ${projectId}. ` : ""}Inspect the accepted Plan, work on a Proposal branch, preview Changes, validate every Constraint, inspect conflicts and the Activity Ledger, then stop for human Approval in VenueMind Studio.`,
          },
        },
      ],
    }),
  );
  server.registerPrompt(
    "venuemind.audit_plan",
    {
      title: "Audit a venue Plan",
      description: "Reconcile Plan, Proposal, Validation, conflicts, locks, receipts, and ledger evidence.",
      argsSchema: z.object({ projectId: z.string().optional(), focus: z.string().optional() }),
    },
    ({ projectId, focus }) => ({
      description: "VenueMind Plan audit workflow",
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Audit ${projectId ? `Project ${projectId}` : "the active VenueMind Project"}${focus ? ` for ${focus}` : ""}. Read the current Plan and Proposal resources, validate, detect conflicts, replay history, inspect the Activity Ledger, and report stable IDs and evidence fingerprints. Do not approve or mutate accepted Plan truth.`,
          },
        },
      ],
    }),
  );

  logger.info("server.created", { serverVersion: MCP_SERVER_VERSION, organizationId, transport: "unbound" });
  return server;
}

export function startVenueMindStdioServer({
  logger = createStructuredLogger(),
  repository = createFileProjectRepository(),
}: { readonly logger?: McpLogger; readonly repository?: McpProjectRepository } = {}) {
  const handle = serveStdio(() => createVenueMindMcpServer({ logger, repository }), {
    onerror: (error) => {
      logger.error("transport.error", { message: error.message });
    },
  });
  let closing: Promise<void> | null = null;
  const close = (signal = "shutdown"): Promise<void> => {
    if (!closing) {
      logger.info("server.stopping", { signal });
      closing = handle.close().then(() => {
        logger.info("server.stopped", { signal });
      });
    }
    return closing;
  };
  return Object.freeze({ close });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const logger = createStructuredLogger();
  const running = startVenueMindStdioServer({ logger });
  logger.info("server.started", { serverVersion: MCP_SERVER_VERSION, transport: "stdio" });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void running.close(signal);
    });
}
