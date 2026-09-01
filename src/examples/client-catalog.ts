export const PLACEHOLDERS = Object.freeze({
  root: "<VENUE_MIND_ROOT>",
  data: "<WRITABLE_DATA_DIR>",
  organization: "<ORGANIZATION_ID>",
});

export const STDIO_SERVER = Object.freeze({
  command: "node",
  args: [`${PLACEHOLDERS.root}/packages/mcp-server/dist/index.js`],
  env: { VENUEMIND_DATA_DIR: PLACEHOLDERS.data, VENUEMIND_ORGANIZATION_ID: PLACEHOLDERS.organization },
});

export const CLIENT_CONFIGS = Object.freeze({
  generic: { transport: "stdio", ...STDIO_SERVER },
  claudeDesktop: { mcpServers: { venuemind: STDIO_SERVER } },
  cursorProject: { mcpServers: { venuemind: STDIO_SERVER } },
});

export const CODEX_TOML = `[mcp_servers.venuemind]
command = "node"
args = ["${PLACEHOLDERS.root}/packages/mcp-server/dist/index.js"]
env = { VENUEMIND_DATA_DIR = "${PLACEHOLDERS.data}", VENUEMIND_ORGANIZATION_ID = "${PLACEHOLDERS.organization}" }
`;

export const HOST_WORKFLOWS = Object.freeze({
  codex: "Use VenueMind to inspect Project project-summit-forward, prepare one access-first Proposal, validate it, report stable Change and Constraint IDs, export JSON, and stop for human Approval in the Studio.",
  claudeDesktop: "Open project-summit-forward in VenueMind. Inspect accepted truth, preview a revision that protects the west accessible route, validate it, explain every non-pass result, and stop for human Approval.",
  cursor: "Using the VenueMind MCP tools, audit the current Plan, create a separate circulation-first Proposal Branch, validate it, compare it with the active Branch, and leave the decision to a human reviewer.",
});

export const BROWSER_EXAMPLE_SUMMARY = `// The browser host invokes tools registered by the open VenueMind page.
const result = await harness.invoke("venue.preview_revision", {
  goal: "Protect the west accessible route",
  idempotencyKey: "browser-example-preview-001",
  correlationId: "browser-example-001",
});
if (result.isError) throw new Error(result.structuredContent.error.code);
`;
