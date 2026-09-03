# VenueMind threat model

This threat model covers the Vercel-hosted Next.js frontend, the Cloudflare API Worker and D1 database, native WebMCP, the standalone MCP server, browser recovery storage, adapters, imports, exports, and generated public artifacts. It is reviewed whenever one of those trust boundaries changes.

## Security invariants

- Only an authenticated, active Organization member may reach tenant data.
- A human Role is the only source of Approval, emergency-response, and incident-response authority.
- An Agent Grant is short-lived, Project-bound, scope-limited, and cannot mint human authority.
- Accepted Plan truth changes only through the canonical command, Validation, and Approval boundary.
- Locks, base versions, idempotency, and ledger integrity are enforced behind every UI and agent surface.
- Imported text and comments are untrusted data, never instructions.
- Logs, metrics, notifications, and errors contain identifiers and bounded codes, not raw Project payloads.

## Assets

| Asset | Required property | Primary control |
| --- | --- | --- |
| Accepted Plans and Proposals | integrity, provenance | versioned commands, Validation, human Approval |
| Locks and safety evidence | integrity, availability | canonical restore, protected mutations, deterministic Validation |
| Activity and operational ledgers | ordering, tamper evidence | hash chains, replay, integrity checks |
| Organization Projects | confidentiality, isolation | server-owned tenant scope on every repository query |
| Sessions and Agent Grants | confidentiality, least privilege | `HttpOnly` cookies, expiry, revocation, exact scopes |
| D1 records and backups | durability, recoverability | numbered migrations, checksums, integrity verification, restore drills |
| Public schemas, docs, SDK, MCP, and skills | supply-chain integrity | generated sources of truth and drift checks |
| Exports and share links | bounded disclosure | explicit scopes, hashed tokens, expiry, revocation, safe export projections |

## Actors

| Actor | Trust level | Permitted authority |
| --- | --- | --- |
| Organization member | authenticated | Role-defined Project actions |
| Planner or reviewer | authenticated | Proposal and review actions; Approval only when the Role matrix permits it |
| Safety or venue administrator | authenticated | named operational actions within the active Organization |
| Agent through WebMCP or MCP | delegated | exact Agent Grant scopes for one Organization and Project |
| Share-link visitor | possession-bound | exact read or Proposal review scope until expiry or revocation |
| Adapter provider | external/untrusted | versioned, capability-scoped data returned through strict normalization |
| Imported event content or comment author | untrusted-data source | no command or policy authority |
| Anonymous network caller | untrusted | health endpoint only |

## Trust boundaries and entry points

| Boundary | Entry points | Boundary rule |
| --- | --- | --- |
| Browser → Vercel frontend | product and docs routes | no server secrets or D1 binding in the frontend |
| Browser → Cloudflare Worker | `/api/*`, Session cookie, origin header | authenticate, enforce same-origin mutations, derive actor and tenant server-side |
| Worker → D1 | repositories and migrations | bind Organization and Project in every key/query; transact multi-row writes |
| Host agent → WebMCP | registered `venue.*` tools | validate exact contracts and Agent Grant before shared tool service execution |
| MCP client → stdio server | JSON-RPC tools/resources | protocol-only stdout, bounded inputs, scoped repository, no Approval tool |
| Provider → adapter runtime | imports, sync, webhooks | verify signatures, normalize exact schemas, reject PII and replay |
| Product → download/share | exports and hashed links | explicit projection, integrity metadata, scope, expiry, revocation |
| Source → published artifacts | generators and builds | generated-drift checks; no hand-edited contract copies |

## High-risk abuse cases and controls

| ID | Threat | Implemented mitigation | Verification | Owner |
| --- | --- | --- | --- | --- |
| TM-01 | Prompt injection in an imported event description or comment attempts to make an agent mutate or disclose data | Imported strings remain inert domain data; tool selection and authority come only from exact contracts and Agent Grants; contact-shaped and excessive input is rejected | `tests/adapter-contract.test.mjs`, `tests/comments.test.mjs`, `tests/webmcp-conformance.test.mjs` | Contracts |
| TM-02 | Malicious geometry causes excessive recursion, memory use, invalid topology, or a hidden out-of-room object | Canonical geometry validators bound coordinates and structure, reject self-intersection and incompatible footprints, and run before persistence or tool execution | `tests/venue-planner.test.mjs`, `tests/privacy.test.mjs` | Geometry |
| TM-03 | Oversized tool, import, export, or Project payload exhausts a browser, Worker, or MCP host | Shared limits constrain request bytes, collections, geometry, depth, generated outputs, retries, and adapter pagination; failures return stable safe codes | `tests/privacy.test.mjs`, `tests/adapter-pagination.test.mjs`, `tests/worker-api.test.mjs` | Runtime |
| TM-04 | Caller substitutes an Organization, Project, User, Role, or actor ID to cross a tenant boundary | Session, Membership, tenant, actor, and time are resolved server-side; repositories include tenant scope; foreign resources return no existence detail | `tests/organization-isolation.test.mjs`, `tests/worker-api.test.mjs` | Identity |
| TM-05 | A share token is guessed, leaked, replayed after revocation, or used for broader access | Store only SHA-256 token hashes; use high-entropy tokens, exact scopes, expiry, revocation, and ledger reconciliation | `tests/sharing-notifications.test.mjs` | Sharing |
| TM-06 | A caller forges, removes, or reorders ledger entries or restores a state whose accepted truth does not match history | Versioned hash chains, canonical fingerprints, replay, migration integrity checks, and blocking load/export failures | `tests/venue-planner.test.mjs`, `tests/database-migrations.test.mjs` | Domain |
| TM-07 | Replayed or concurrent mutations create duplicate changes or overwrite newer accepted state | Mandatory idempotency keys, input fingerprints, immutable receipts, optimistic revisions, and atomic repositories | `tests/venue-planner.test.mjs`, `tests/project-concurrency.test.mjs`, `tests/runbook-repository.test.mjs` | Persistence |
| TM-08 | An MCP/WebMCP tool acts as a confused deputy by approving, escalating incidents, or escaping its Project | No agent Approval or privileged incident-response tools; the shared service checks grant, human Role, Organization, Project, tool scope, and contract version | `tests/authorization.test.mjs`, `tests/mcp-server.test.mjs`, `tests/webmcp-conformance.test.mjs`, `tests/incidents.test.mjs` | Agent surfaces |
| TM-09 | An export, error, log, metric, notification, or dead letter leaks geometry, secrets, attendee data, or contact data | Allowlisted structured projections and error metadata; secret-free dead letters; aggregate-only attendance; no raw Project bodies in telemetry | `tests/registration-ticketing-adapter.test.mjs`, `tests/sharing-notifications.test.mjs`, `tests/adapter-runtime.test.mjs` | Privacy |
| TM-10 | An untrusted provider forges or replays webhook data, drifts versions, or returns an unbounded page sequence | Raw-byte HMAC and timestamp verification, source-namespaced idempotency, exact versioned normalization, bounded pagination, abort, and retry policies | `tests/adapter-webhook-signatures.test.mjs`, `tests/calendar-event-adapter.test.mjs`, `tests/registration-ticketing-adapter.test.mjs` | Adapters |
| TM-11 | Cross-origin requests mutate Worker state using a valid browser Session | Mutations require the configured Vercel origin; Session cookies are secure, `HttpOnly`, and `SameSite=Lax` | `tests/worker-api.test.mjs`, `tests/organization-isolation.test.mjs` | Worker |
| TM-12 | A changed migration, generated schema, package, or published skill silently changes runtime truth | Immutable migration checksums, generated artifact verification, package/skill contract tests, and local release provenance | `tests/database-migrations.test.mjs`, `tests/agent-docs.test.mjs`, `tests/sdk-package.test.mjs` | Release |

## Verification ownership

The owner column names a code area, not a person. A change owner must update the mitigation, its cited executable test, and this model in one review. A high-risk row may not be marked complete unless the control exists in production code, the test exercises the failure path, and the test is part of `npm test`.

Run the complete local security gate:

```bash
npm run check:typesafety
npm run check:generated
npm test
```

GitHub-hosted Actions are intentionally not used. Release evidence is produced locally and reviewed before deployment.

## Residual risk and response

VenueMind checks configured venue policy and deterministic model evidence; it does not replace a licensed safety, accessibility, engineering, or legal determination. A system-integrity failure blocks Approval or export where truth cannot be verified. Suspected cross-tenant exposure, authority bypass, or accepted-truth corruption follows the private process in `SECURITY.md` and the operational recovery steps in `docs/runbooks/failure-recovery.md`.
