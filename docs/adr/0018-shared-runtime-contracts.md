# ADR 0018: Generate every agent surface from shared runtime contracts

## Status

Accepted

## Context

VenueMind exposes the same planning capabilities through native WebMCP, a standalone MCP server, documentation, schemas, examples, and agent skills. Separate handwritten definitions would drift in required fields, permissions, limits, error codes, and safety boundaries.

## Decision

`src/contracts/venue-contracts.js` is the authoritative registry for planner command schemas, public tool contracts, examples, limits, authorization scopes, and tool-to-command mapping. WebMCP and MCP registration consume that registry. Build scripts generate schemas, manifests, fixtures, and agent discovery files from it. Contract tests compare generated reference pages and examples with the live registry.

Runtime implementation remains in deep domain modules; the contract registry describes and maps behavior but does not duplicate business rules.

## Consequences

- Adding a public tool requires one contract entry and its planner mapping.
- A drift gate fails when generated output is stale.
- Approval and destructive Project deletion can be proven absent from every agent surface.
- Tool-specific adapters stay small and cannot acquire independent planning behavior.
