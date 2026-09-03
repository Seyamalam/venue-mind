# Resource limits

VenueMind uses one versioned, typed policy in `src/security/resource-limits.ts`. Limits fail before a mutation reaches accepted Plan truth. Errors expose only the surface, resource kind, actual count, and maximum count; they never echo the rejected payload.

## Product budgets

| Resource | Maximum |
| --- | ---: |
| API or Project record | 2,000,000 bytes |
| Ordinary Planner command | 262,144 bytes |
| Restore command | 2,100,000 bytes |
| JSON depth | 64 |
| JSON nodes | 100,000 |
| Items in one generic array | 10,000 |
| Keys in one object | 1,000 |
| Plan Objects | 5,000 |
| Plan Constraints | 1,000 |
| Changes in one Proposal | 1,000 |
| Proposal Branches | 64 |
| Revisions per Branch | 256 |
| Comments | 5,000 |
| Activity Ledger entries | 50,000 |
| Command receipts | 50,000 |
| Scenario definitions | 256 |
| Scenario Runs | 2,000 |
| Validation budget | 5 seconds |
| Simulation budget | 15 seconds |

Every WebMCP and MCP tool also publishes exact `maximumInputBytes` and `maximumOutputBytes` values in its canonical tool contract. Those per-tool values are stricter than the general Project limits.

## Enforcement boundaries

- The Studio browser measures Project records before remote save.
- The Planner measures initial Plans, commands, restored snapshots, and semantic collection counts before mutation.
- WebMCP and MCP measure input and output using the same non-recursive structural walker and each tool's published byte budget.
- The Worker rejects oversized or structurally excessive JSON before route decoding or repository access.
- Imports validate manifest byte declarations, exact schemas, collection sizes, privacy depth, and adapter pagination before staging.
- Validation and simulation accept cancellation and have bounded input sizes and deterministic algorithm limits. Callers should abort when the published time budget expires.

The structural walker is iterative so hostile nesting does not consume the JavaScript call stack. It distinguishes shared references from cycles, rejects actual cyclic objects, and stops as soon as a limit is crossed.

## Rate budgets

Worker mutation traffic is limited per Session identity, Organization, and endpoint family. Read-only health and static assets do not share a mutation bucket. A rejected request returns `429`, a bounded `Retry-After`, and `RESOURCE_RATE_LIMITED` without recording request content. Rate state contains only opaque scope identifiers, window start, and request count.

| Endpoint family | Identity | Organization | Window |
| --- | ---: | ---: | ---: |
| Project writes | 60 | 600 | 60 seconds |
| Operational command sync | 120 | 1,200 | 60 seconds |
| Sharing and membership mutations | 30 | 300 | 60 seconds |
| Adapter/webhook mutation | 120 | 1,200 | 60 seconds |

## Verification

`tests/resource-limits.test.mjs` covers deterministic measurement, excessive depth, cycles, semantic Planner collections, oversized commands, and mutation-free rejection. WebMCP and MCP suites verify their boundary behavior; Worker tests verify request and rate responses; adapter suites verify bounded pagination, retries, webhooks, and privacy traversal.

Run:

```bash
npm run check:typesafety
npm run check:generated
npm test
```
