# VenueMind MCP server

The standalone stdio server exposes durable Project sessions, shared tools, resources, templates, and supervised prompts. Agent clients can inspect, branch, preview, validate, simulate, audit, and export. Human Approval remains in VenueMind Studio.

## Build

```bash
npm install
npm run build:mcp
```

The executable is `packages/mcp-server/dist/index.js`. Set `VENUEMIND_DATA_DIR` to a dedicated writable directory and bind `VENUEMIND_ORGANIZATION_ID` to the host-authorized Organization. The local development default is `org-local`.

## Connect a client

Use the validated examples instead of copying configuration from this file:

- [Generic stdio configuration](../../public/examples/client/config/generic-stdio.json)
- [Codex configuration](../../public/examples/client/config/codex.toml)
- [Claude Desktop configuration](../../public/examples/client/config/claude-desktop.json)
- [Cursor Project configuration](../../public/examples/client/config/cursor-project.json)
- [Executable TypeScript client](../../examples/typescript/supervised-workflow.ts)
- [Complete client guide](../../src/docs/pages/examples.js)

Replace `<VENUE_MIND_ROOT>`, `<WRITABLE_DATA_DIR>`, and `<ORGANIZATION_ID>` before use. The generated example manifest records how every artifact is checked.

## Runtime boundary

- Standard output carries MCP protocol messages only.
- Structured operational events use standard error.
- `SIGINT`, `SIGTERM`, cancellation, and transport closure shut down cleanly.
- Local stdio inherits the host identity and starts one process per client session.
- Remote access requires an authenticated Streamable HTTP Adapter; bind Organization and Project access to the authenticated principal and enforce published VenueMind scopes.
- Approval, Warning Waivers, Project Locks, and conflict decisions are absent from agent tools.
