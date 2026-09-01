# VenueMind

VenueMind is an agent-native venue operations workspace. A human or agent can inspect a versioned venue layout, propose non-destructive changes, validate safety and operational constraints, request human approval, commit an auditable Plan Version, and export the result.

## Why WebMCP

Venue planning is a shared human-and-agent workflow, not a chat prompt. VenueMind registers versioned tools with `document.modelContext.registerTool(...)` so agents can operate the same command bus as the UI while stable IDs, scopes, idempotency, validation, and human-only Approval remain enforced.

The core supervised loop is:

1. `inspect_layout`
2. `preview_revision`
3. `validate_layout`
4. human Approval
5. versioned commit and Activity Ledger entry
6. validated export

## Product surface

- Geometry-backed venue plans with stable object IDs and typed locks
- Non-destructive Proposal previews and visible constraint evidence
- Access, capacity, circulation, sightline, production, catering, emergency, staffing, and queue validation
- Proposal branches, conflict handling, approval, undo, redo, and ledger replay
- Secure read-only and reviewer share links with notification delivery
- Browser WebMCP plus standalone MCP tools generated from shared contracts
- SVG, CSV, PDF, audit-package, and interchange exports
- Documentation, `llms.txt`, `llms-full.txt`, agent skills, schemas, examples, and migration guides

## Run locally

Requirements: Node.js 22 or newer.

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Use ChatGPT's in-app browser, or Chrome with WebMCP testing enabled, to inspect and invoke the registered tools.

## Verify

Verification runs locally; this repository intentionally has no GitHub Actions workflows.

```bash
npm run build
npm test
npm run check:generated
```

## Repository map

- `src/domain/` — canonical venue model, planning, validation, replay, and exports
- `src/webmcp/` — browser tool registration and shared adapter
- `src/contracts/` — versioned tool and schema contracts
- `worker/` and `db/` — hosted API, persistence, migrations, sharing, and delivery
- `mcp/` — standalone MCP server
- `skills/` — packaged agent skills and evaluations
- `docs/` and `public/` — contributor and public documentation
- `tests/` — domain, contract, WebMCP, MCP, worker, migration, and end-to-end workflow tests

## License

[MIT](LICENSE)
