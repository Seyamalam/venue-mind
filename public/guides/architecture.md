# VenueMind architecture

VenueMind is one domain runtime with three callers: Studio UI, native WebMCP, and the standalone MCP server. The planner owns mutation rules; callers never recreate them.

## Component map

```mermaid
flowchart LR
  IDP[Sites identity Adapter] --> ACCOUNTS[Users / Organizations / Sessions]
  ACCOUNTS --> API[Organization-scoped Project API]
  SHARE[Hashed Share Links] --> API
  API --> NOTIFY[Notification store / email outbox]
  UI[Studio UI] --> BUS[VenuePlanner.execute]
  WEB[Native WebMCP] --> SERVICE[Venue tool service]
  MCP[stdio MCP server] --> SERVICE
  SERVICE --> BUS
  CONTRACTS[Shared contracts] --> UI
  CONTRACTS --> WEB
  CONTRACTS --> MCP
  CONTRACTS --> DOCGEN[Docs and example generators]
  BUS --> VALIDATE[Constraint engine]
  BUS --> LEDGER[Activity Ledger]
  BUS --> EXPORTS[Exports and interchange]
  BUS --> PROJECTS[Project repository]
  PROJECTS --> API
  PROJECTS --> LOCAL[Organization-scoped browser recovery cache]
```

## Source map

| Responsibility | Authoritative source |
| --- | --- |
| Commands, tools, schemas, examples, and tool-to-command mapping | `src/contracts/venue-contracts.js` |
| Command execution and versioned planner state | `src/domain/venue-planner.js` |
| Deterministic Constraint registry | `src/domain/constraint-engine.js` |
| Human Roles, Agent Grants, permissions, and Approval policy | `src/domain/authorization.js` |
| Users, Organizations, Memberships, invitations, and Sessions | `src/domain/accounts.js` and `worker/account-repository.ts` |
| Trusted hosting identity Adapter | `worker/authentication.ts` |
| Stable errors and remediation | `src/domain/errors.js` |
| Ledger sealing, verification, and replay | `src/domain/activity-ledger.js` |
| Tool authorization and dispatch | `src/tools/venue-tool-service.js` |
| Browser registration and bounded results | `src/webmcp/` |
| Standalone MCP resources, prompts, progress, and stdio | `packages/mcp-server/src/` |
| Browser Project persistence and recovery | `src/persistence/project-store.js` |
| Organization-scoped Worker API and Project repository | `worker/index.ts` and `worker/project-repository.ts` |
| Share Links, Notification Preferences, notifications, and email outbox | `src/domain/sharing.js` and `worker/sharing-repository.ts` |
| Numbered database migrations, integrity, backup, and restore | `db/migrations/`, `worker/database-migrations.ts`, and `scripts/database-maintenance.mjs` |
| Interchange and operational exports | `src/interchange/` |
| Canonical docs registry | `src/docs/` |
| Generated public artifacts | `scripts/generate-*.mjs` and `public/` |

## Supervised planning flow

```mermaid
sequenceDiagram
  participant A as Agent host
  participant T as Tool service
  participant P as Planner
  participant V as Constraint engine
  participant H as Human reviewer
  participant R as Project repository

  A->>T: inspect_layout
  T->>P: inspect_layout command
  P-->>A: accepted Plan + stable IDs
  A->>T: preview_revision(idempotencyKey)
  T->>P: Proposal command
  P-->>A: violet Changes + receipt
  A->>T: validate_layout
  T->>P: Validation command
  P->>V: immutable candidate input
  V-->>P: checks + evidence fingerprint
  P-->>A: pass / warning / fail
  H->>P: approve_proposal
  P->>V: revalidate exact candidate
  P->>R: save next immutable Plan Version
  P-->>H: Approval ledger transition
  A->>T: export_plan
  T->>P: read-only export command
  P-->>A: versioned validated artifact
```

## Deep boundaries

- `VenuePlanner.execute` is the only planning mutation boundary.
- `createVenueToolService` is the common authorization and dispatch boundary for WebMCP and MCP.
- `venueToolContracts` is the public agent contract registry; agent-only behavior does not live in registration adapters.
- `evaluators` in the Constraint engine is the deterministic evidence registry.
- `sealActivityLedger`, `verifyActivityLedger`, and `replayActivityLedger` are the integrity boundary for accepted history.
- Project persistence stores complete normalized snapshots; UI component state is never authoritative Plan truth.
- Collaboration Events carry durable revision invalidation and Presence Leases carry awareness; neither can mutate accepted Plan truth.
- SSE reconnect uses a per-Project previous-event chain. A missed link forces an authoritative reload through Project Record Revision checks.
- Public Share Links are bearer capabilities stored only as SHA-256 hashes. Reviewer access is Proposal-scoped, expiry and revocation fail closed, and notification payloads carry fixed body codes plus allowlisted stable references.

## Add a command

1. Add one exact variant to `venueCommandSchema` in `src/contracts/venue-contracts.js`. Define required fields, bounds, and `additionalProperties` explicitly.
2. Implement the branch in `VenuePlanner.execute`. Mutations require an idempotency key, return stable result IDs, append an Activity Ledger event, and preserve accepted truth unless the command is human-authorized Approval or accepted-history navigation.
3. Map the command in `COMMAND_PERMISSION` inside `src/domain/authorization.js`.
4. For an agent-facing command, add one `venueToolContracts` entry and map it in `commandForVenueTool`. Approval and destructive Project deletion remain absent.
5. Add stable runtime errors to `src/domain/errors.js`, then add output IDs and applicable errors to `src/docs/reference-data.js` and `src/docs/pages/reference.js` where inference is insufficient.
6. Add domain tests, authorization tests, and WebMCP/MCP conformance tests as applicable.
7. Run `npm run generate:contracts`, `npm run generate:docs`, `npm test`, and `npm run check:generated`.

The command is complete when its runtime behavior, permission, generated schema, tool surfaces, docs page, examples, errors, receipts, ledger evidence, and tests agree.

## Add a Constraint

1. Add the evaluator name to `venueConstraintSchema.properties.evaluator.enum`.
2. Implement a pure evaluator in `src/domain/constraint-engine.js` and register it in `evaluators`.
3. Return ordered evidence with stable object and evidence IDs, normalized units, actual value, threshold, comparator, and remediation.
4. Add or migrate seeded Constraint records that use the evaluator.
5. Add the evaluator category, evidence family, and units to `CONSTRAINT_REFERENCE`.
6. Test pass, fail, not-applicable, stable ordering, fingerprint invalidation, and Approval blocking behavior.
7. Regenerate contracts and docs, then run the full test and drift gates.

The Constraint is complete when identical immutable input produces byte-equivalent evidence and every changed relevant input invalidates the cached result.
