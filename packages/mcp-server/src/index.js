#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import { VENUE_TOOL_CONTRACT_VERSION, venueToolContracts } from "../../../src/contracts/venue-contracts.js";
import { errorCatalog, errorPayload, venueError } from "../../../src/domain/errors.js";
import { AGENT_SCOPES, createShortLivedAgentAuthorization } from "../../../src/domain/authorization.js";
import { createVenueToolService } from "../../../src/tools/venue-tool-service.js";
import { createFileProjectRepository } from "./project-repository.js";
import { createProjectSession } from "./project-session.js";

export { createFileProjectRepository, createMemoryProjectRepository } from "./project-repository.js";
export { createProjectSession } from "./project-session.js";

export const MCP_SERVER_VERSION = "0.4.0";
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
  "Remote transport guidance: stdio inherits the local host identity. A remote HTTP Adapter must validate bearer tokens, bind Project access to the authenticated principal, enforce published VenueMind scopes, require TLS, restrict origins, and never trust caller-supplied actor or organization IDs.",
].join("\n");

const jsonResource = (uri, value) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: `${JSON.stringify(value, null, 2)}\n` }] });
const textResource = (uri, value) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: value }] });
const structured = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : { result: value };

export function createStructuredLogger({ sink = process.stderr, clock = () => new Date().toISOString() } = {}) {
  const write = (level, event, fields = {}) => sink?.write?.(`${JSON.stringify({ timestamp: clock(), level, event, ...fields })}\n`);
  return Object.freeze({
    info: (event, fields) => write("info", event, fields),
    error: (event, fields) => write("error", event, fields),
  });
}

const sendProgress = async (ctx, progress, total, message) => {
  const progressToken = ctx?.mcpReq?._meta?.progressToken;
  if (progressToken === undefined) return;
  await ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken, progress, total, message } });
};

const projectSummary = (record) => ({
  id: record.id,
  name: record.name,
  activePlanId: record.activePlanId,
  schemaVersion: record.schemaVersion,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  planVersion: record.snapshot.plan.version,
  proposalId: record.snapshot.proposal?.id ?? null,
});

export function createVenueMindMcpServer({
  repository = createFileProjectRepository(),
  logger = createStructuredLogger(),
  organizationId = repository.organizationId ?? "org-local",
  session = createProjectSession({ repository, organizationId, logger }),
  agentAuthorization,
} = {}) {
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
    authorizationProvider: () => agentAuthorization ?? createShortLivedAgentAuthorization({ agentId: "mcp-agent", organizationId, projectId: "project-summit-forward", scopes: AGENT_SCOPES, issuedBy: "venuemind-stdio-host" }),
    recordAuthorizationDenial: (denial) => session.recordAuthorizationDenial(denial),
  });

  const execute = async (name, input, ctx, operation) => {
    const correlationId = input?.correlationId || `mcp-${String(ctx?.mcpReq?.id ?? "request")}`;
    const expensive = name === "venue.validate_layout" || name === "venue.run_scenario" || name === "venue.compare_simulations";
    logger.info("tool.started", { organizationId, tool: name, correlationId });
    try {
      if (ctx?.mcpReq?.signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { tool: name });
      if (expensive) await sendProgress(ctx, 0, 1, name === "venue.validate_layout" ? "validating" : "simulating");
      const output = await operation();
      if (expensive) await sendProgress(ctx, 1, 1, "complete");
      logger.info("tool.completed", { organizationId, tool: name, correlationId });
      return { content: [{ type: "text", text: JSON.stringify(output, null, 2) }], structuredContent: structured(output) };
    } catch (error) {
      const payload = errorPayload(error);
      logger.error("tool.failed", { organizationId, tool: name, correlationId, code: payload.error.code });
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload, isError: true };
    }
  };

  for (const contract of venueToolContracts) {
    server.registerTool(contract.name, {
      title: contract.title,
      description: contract.description,
      annotations: contract.annotations,
      inputSchema: z.fromJSONSchema(contract.inputSchema),
      _meta: {
        "venuemind/serverVersion": MCP_SERVER_VERSION,
        "venuemind/contractVersion": contract.contractVersion,
        "venuemind/requiredScope": contract.authorization.requiredScope,
        "venuemind/errors": contract.errors,
      },
    }, (input, ctx) => execute(contract.name, input, ctx, () => toolService.execute(contract.name, input, "mcp", { signal: ctx.mcpReq.signal })));
  }

  server.registerResource("current-project", "venuemind://current/project", { title: "Current Project", mimeType: "application/json" }, async (uri) => {
    const { record } = await session.current();
    return jsonResource(uri, projectSummary(record));
  });
  server.registerResource("current-plan", "venuemind://current/plan", { title: "Current Plan Version", mimeType: "application/json" }, async (uri) => {
    const { snapshot } = await session.current();
    return jsonResource(uri, snapshot.plan);
  });
  server.registerResource("active-proposal", "venuemind://current/proposal", { title: "Active Proposal", mimeType: "application/json" }, async (uri) => {
    const { snapshot } = await session.current();
    return jsonResource(uri, snapshot.proposal);
  });
  server.registerResource("contract-schemas", "venuemind://schemas/index", { title: "VenueMind Contract Schemas", mimeType: "application/json" }, async (uri) => jsonResource(uri, {
    contractVersion: VENUE_TOOL_CONTRACT_VERSION,
    tools: venueToolContracts.map(({ name, inputSchema, authorization, limits, exampleInput, errors }) => ({ name, inputSchema, authorization, limits, exampleInput, errors })),
    errors: errorCatalog,
  }));
  server.registerResource("agent-reference", "venuemind://docs/agent-reference", { title: "VenueMind Agent Reference", mimeType: "text/markdown" }, async (uri) => textResource(uri, agentReference));
  server.registerResource("server-capabilities", "venuemind://server/capabilities", { title: "VenueMind MCP Compatibility", mimeType: "application/json" }, async (uri) => jsonResource(uri, {
    serverVersion: MCP_SERVER_VERSION,
    compatibility: MCP_COMPATIBILITY,
    tools: { shared: venueToolContracts.length, session: 0 },
    resources: true,
    resourceTemplates: true,
    prompts: ["venuemind.supervised_planning", "venuemind.audit_plan"],
    progress: ["venue.validate_layout", "venue.run_scenario", "venue.compare_simulations"],
  }));

  const projectTemplate = new ResourceTemplate("venuemind://projects/{projectId}", {
    list: async () => ({ resources: (await session.listProjects()).map((project) => ({ uri: `venuemind://projects/${encodeURIComponent(project.id)}`, name: project.id, title: project.name, mimeType: "application/json" })) }),
    complete: { projectId: async (value) => (await session.listProjects()).map((project) => project.id).filter((id) => id.startsWith(value)) },
  });
  server.registerResource("project-by-id", projectTemplate, { title: "Project by ID", mimeType: "application/json" }, async (uri, variables) => {
    const record = await session.readProject(String(variables.projectId));
    return jsonResource(uri, projectSummary(record));
  });

  const planTemplate = new ResourceTemplate("venuemind://projects/{projectId}/plans/{planVersion}", {
    list: async () => ({ resources: (await session.listProjects()).map((project) => ({ uri: `venuemind://projects/${encodeURIComponent(project.id)}/plans/${encodeURIComponent(project.planVersion)}`, name: `${project.id}@${project.planVersion}`, title: `${project.name} ${project.planVersion}`, mimeType: "application/json" })) }),
    complete: {
      projectId: async (value) => (await session.listProjects()).map((project) => project.id).filter((id) => id.startsWith(value)),
      planVersion: async (value, context) => {
        const record = context?.arguments?.projectId ? await session.readProject(context.arguments.projectId) : null;
        return record?.snapshot?.plan?.version?.startsWith(value) ? [record.snapshot.plan.version] : [];
      },
    },
  });
  server.registerResource("plan-by-project-and-version", planTemplate, { title: "Plan Version by Project", mimeType: "application/json" }, async (uri, variables) => {
    const record = await session.readProject(String(variables.projectId));
    if (record.snapshot.plan.version !== String(variables.planVersion)) throw new Error(`Plan Version not found: ${variables.planVersion}`);
    return jsonResource(uri, record.snapshot.plan);
  });

  server.registerPrompt("venuemind.supervised_planning", {
    title: "Supervised venue planning",
    description: "Inspect, branch, preview, validate, audit, and stop for human Approval.",
    argsSchema: z.object({ goal: z.string().min(1), projectId: z.string().optional() }),
  }, ({ goal, projectId }) => ({
    description: "VenueMind supervised planning workflow",
    messages: [{ role: "user", content: { type: "text", text: `Use VenueMind to ${goal}. ${projectId ? `Open Project ${projectId}. ` : ""}Inspect the accepted Plan, work on a Proposal branch, preview Changes, validate every Constraint, inspect conflicts and the Activity Ledger, then stop for human Approval in VenueMind Studio.` } }],
  }));
  server.registerPrompt("venuemind.audit_plan", {
    title: "Audit a venue Plan",
    description: "Reconcile Plan, Proposal, Validation, conflicts, locks, receipts, and ledger evidence.",
    argsSchema: z.object({ projectId: z.string().optional(), focus: z.string().optional() }),
  }, ({ projectId, focus }) => ({
    description: "VenueMind Plan audit workflow",
    messages: [{ role: "user", content: { type: "text", text: `Audit ${projectId ? `Project ${projectId}` : "the active VenueMind Project"}${focus ? ` for ${focus}` : ""}. Read the current Plan and Proposal resources, validate, detect conflicts, replay history, inspect the Activity Ledger, and report stable IDs and evidence fingerprints. Do not approve or mutate accepted Plan truth.` } }],
  }));

  logger.info("server.created", { serverVersion: MCP_SERVER_VERSION, organizationId, transport: "unbound" });
  return server;
}

export function startVenueMindStdioServer({ logger = createStructuredLogger(), repository = createFileProjectRepository() } = {}) {
  const handle = serveStdio(() => createVenueMindMcpServer({ logger, repository }), {
    onerror: (error) => logger.error("transport.error", { message: error.message }),
  });
  let closing = null;
  const close = (signal = "shutdown") => {
    if (!closing) {
      logger.info("server.stopping", { signal });
      closing = handle.close().then(() => logger.info("server.stopped", { signal }));
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
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => void running.close(signal));
}
