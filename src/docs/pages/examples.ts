import { BROWSER_EXAMPLE_SUMMARY, CLIENT_CONFIGS, CODEX_TOML, HOST_WORKFLOWS } from "../../examples/client-catalog.ts";
import { bullets, code, links, prose, steps, type DocsPage } from "../blocks.ts";

const root = "/examples/client";

export const clientExamplesPage = {
  slug: "client-examples",
  group: "Agents",
  title: "Client examples",
  eyebrow: "Executable integrations",
  summary: "Validated WebMCP, MCP, Codex, Claude Desktop, Cursor, JSON-RPC, retry, failure, and export examples.",
  audience: ["developers", "agent integrators"],
  compatibility: ["Tool contract 1.5.0", "MCP server 0.7.0"],
  sections: [
    {
      id: "webmcp",
      title: "Browser WebMCP",
      blocks: [
        prose("The open Studio registers native tools. The browser agent host invokes them; the published harness captures the same registrations for deterministic local execution."),
        code(BROWSER_EXAMPLE_SUMMARY, "javascript"),
        links({ label: "Executable browser harness", href: `${root}/webmcp/browser-invocation.mjs` }, { label: "WebMCP tutorial", href: "/docs/tutorial-webmcp" }),
      ],
    },
    {
      id: "generic",
      title: "Generic stdio client",
      blocks: [
        code(JSON.stringify(CLIENT_CONFIGS.generic, null, 2), "json"),
        bullets("Replace <VENUE_MIND_ROOT> with the absolute repository path.", "Replace <WRITABLE_DATA_DIR> with a dedicated writable directory.", "The host launches one local server process per stdio session.", "Standard output is protocol-only; structured diagnostics use standard error."),
        links({ label: "Generic configuration", href: `${root}/config/generic-stdio.json` }, { label: "Executable TypeScript client", href: `${root}/typescript/supervised-workflow.ts` }, { label: "Official MCP TypeScript client guide", href: "https://ts.sdk.modelcontextprotocol.io/v2/clients/connect" }),
      ],
    },
    {
      id: "codex",
      title: "Codex",
      blocks: [
        code("codex mcp add venuemind --env VENUEMIND_DATA_DIR=<WRITABLE_DATA_DIR> -- node <VENUE_MIND_ROOT>/packages/mcp-server/dist/index.js\ncodex mcp get venuemind", "bash"),
        code(CODEX_TOML, "toml"),
        code(HOST_WORKFLOWS.codex, "text"),
        links({ label: "Codex TOML", href: `${root}/config/codex.toml` }),
      ],
    },
    {
      id: "claude-desktop",
      title: "Claude Desktop",
      blocks: [
        steps("Open Claude Desktop developer settings and edit the local MCP configuration.", "Merge the venuemind entry under mcpServers.", "Replace both path placeholders and restart Claude Desktop.", "Confirm VenueMind tools are available before running the supervised prompt."),
        code(JSON.stringify(CLIENT_CONFIGS.claudeDesktop, null, 2), "json"),
        code(HOST_WORKFLOWS.claudeDesktop, "text"),
        links({ label: "Claude Desktop configuration", href: `${root}/config/claude-desktop.json` }, { label: "Anthropic MCP documentation", href: "https://docs.anthropic.com/en/docs/mcp" }),
      ],
    },
    {
      id: "cursor",
      title: "Cursor",
      blocks: [
        steps("Create .cursor/mcp.json for Project scope or ~/.cursor/mcp.json for global scope.", "Copy the configuration and replace both path placeholders.", "Open Cursor MCP settings and confirm venuemind is enabled.", "Keep tool approval enabled for the supervised workflow."),
        code(JSON.stringify(CLIENT_CONFIGS.cursorProject, null, 2), "json"),
        code(HOST_WORKFLOWS.cursor, "text"),
        links({ label: "Cursor Project configuration", href: `${root}/config/cursor-project.json` }, { label: "Cursor MCP documentation", href: "https://docs.cursor.com/context/model-context-protocol" }),
      ],
    },
    {
      id: "failure-workflows",
      title: "Retry and failure workflows",
      blocks: [
        bullets("Exact retry — reuse one idempotency key only for byte-equivalent intent; VenueMind returns the original receipt.", "Stale base — retain PLAN_VERSION_CONFLICT details, inspect current truth, detect conflicts, then rebase the Proposal.", "Validation failure — use affected stable IDs and remediation evidence; create another Proposal revision and validate again.", "Export — export only the currently evaluated Plan or Proposal and retain its version, Validation ID, and evidence fingerprints."),
        links({ label: "Retry sequence", href: `${root}/raw/retry-sequence.json` }, { label: "Stale-base error", href: `${root}/raw/stale-base.error.json` }, { label: "Validation failure", href: `${root}/raw/validation-failure.response.json` }, { label: "Text export response", href: `${root}/raw/export-text.response.json` }),
      ],
    },
    {
      id: "raw-fixtures",
      title: "Raw request and response fixtures",
      blocks: [
        links({ label: "Preview request", href: `${root}/raw/preview-revision.request.json` }, { label: "Preview response", href: `${root}/raw/preview-revision.response.json` }, { label: "Example manifest", href: `${root}/manifest.json` }),
        prose("Generation uses the production planner, error catalog, export implementation, and shared tool contracts. CI compiles and executes both code examples and contract-validates every configuration and fixture."),
      ],
    },
  ],
} satisfies DocsPage;
