# ADR 0026: Public SDK follows canonical tool and adapter contracts

## Status

Accepted

## Context

VenueMind already exposes one supervised planning model through Studio commands, native WebMCP, and the standalone MCP server. A public TypeScript SDK is useful only if it preserves that model. A parallel SDK-specific command layer, direct planner mutations, or hand-maintained response types would drift from authorization, Validation, Approval, stable errors, generated schemas, and Activity Ledger evidence.

External adapters have the same risk. Convenience APIs that bypass normalized input, atomic idempotency, scoped secrets, staging integrity, or durable webhook receipt would make the public path weaker than the internal adapter runtime.

The SDK also participates in several independent compatibility domains: package API, tool contract, adapter contract, Project schema, geometry, Validation engine, Simulation engine, Activity Ledger, and interchange format. One aggregate application version cannot safely stand in for all of them.

## Decision

VenueMind publishes `@venuemind/sdk` as an ESM-only Node.js 22 package. Version `0.1.0` declares only explicit runtime exports: `.`, `./types`, `./client`, `./adapter`, `./testkit`, and `./sandbox`, plus the read-only `./schemas/*` JSON Schema export.

Types are generated from canonical VenueMind schemas and versioned tool input/output contracts. Generated declarations are artifacts; their authoritative sources remain the contract registries.

The typed client is transport-injected. It groups Project, Plan, Proposal, Validation, Activity Ledger, replay, and export operations, then calls the existing `venue.*` tool contract. MCP, WebMCP, local, and test transports retain protocol, authentication, Organization and Project binding, cancellation, and structured-result responsibilities. The client does not recreate command dispatch or domain rules.

Human Approval is intentionally absent from the public agent client. A Proposal remains non-destructive until an authenticated human surface approves it through the existing authorization and planner boundary. Warning Waivers, Project Locks, human conflict decisions, account administration, and destructive Project operations follow the same authority separation.

The adapter entry point exposes the existing contract and runtime semantics: exact definitions, scoped capabilities and secrets, prepared-input privacy boundaries, checksum-bound staging, atomic processed-batch and webhook stores, bounded retries and rate limits, cursor verification, pagination guards, dead letters, and deep aggregate-result validation.

The testkit supplies deterministic in-memory dependencies and assertions. The sandbox supplies disposable local fixtures and a test server. Neither is a production persistence, authentication, concurrency, or secret-storage implementation.

SDK, tool, adapter, schema, engine, ledger, and interchange versions remain separate. Compatibility metadata and deprecations name the exact affected surface.

## Consequences

- SDK clients receive typed ergonomics without gaining a second planning mutation boundary.
- WebMCP, MCP, SDK, generated schemas, examples, and reference documentation share one contract source.
- Approval authority remains human and auditable.
- Adapter authors can depend on public helpers without repository-relative imports or weaker delivery semantics.
- Type generation requires named, closed output contracts for every typed client operation.
- Contract generation, SDK declarations, API reference, packed-package inspection, clean-consumer typechecking, sandbox workflows, and the example adapter suite become release gates.
- A transport may differ in protocol behavior, but it must preserve the canonical tool name, input, structured output, error code, cancellation, scope, and stable identifiers.
- Independent version surfaces require explicit compatibility checks and migration notes; an SDK upgrade alone cannot reinterpret persisted artifacts.
