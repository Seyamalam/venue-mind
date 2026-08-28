# Local development

## Requirements

- Node.js 22 or newer.
- npm with the checked-in lockfile.
- A writable directory for MCP Project data when testing an external host.

## Start

```bash
npm ci
npm run dev -- --host 0.0.0.0 --port 4173
```

The Studio is at `/studio/project-summit-forward`, the Project index at `/projects`, and docs at `/docs`.

## Generated sources

```bash
npm run generate:contracts
npm run generate:docs
npm run build:skills
npm run check:generated
```

Edit contract and docs sources, then regenerate. Do not hand-edit public schemas, manifests, client fixtures, `llms.txt`, or packaged skills.

## Standalone MCP

```bash
npm run build:mcp
VENUEMIND_DATA_DIR=<WRITABLE_DATA_DIR> node packages/mcp-server/dist/index.js
```

Use `public/examples/client/` for validated host configurations and workflows. Standard output belongs to the protocol.

## Before handing off a change

```bash
npm run check:generated
npm test
npm run build
```

The build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`. Resolve failures at their source and regenerate; generated output is evidence, not an editing surface.
