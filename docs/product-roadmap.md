# VenueMind product roadmap

VenueMind is an agent-native venue operations product. The first vertical slice remains the complete planning loop, but the product surface extends to documentation, reusable agent skills, an MCP server, machine-readable documentation, integrations, collaboration, and operational readiness.

## 1. Planning foundation

- Versioned Plans with stable IDs for rooms, objects, Constraints, Proposals, and Changes.
- One command interface shared by the UI, WebMCP, the standalone MCP server, and tests.
- Deterministic validation for locks, accessibility, capacity, sightlines, circulation, queues, service lanes, and egress.
- Proposal preview, conflict detection, Approval, Adjustment Requests, undo/redo, export, and Activity Ledger.
- Local persistence, seed scenarios, schema versioning, and migration fixtures.

## 2. Full planning workspace

- Event brief editor with structured requirements and priority levels.
- Venue templates, room inventory, reusable objects, zones, and locked infrastructure.
- Multiple Proposals, branching comparisons, version history, replay, comments, and decision checkpoints.
- Scenario simulation for ingress, egress, queues, accessibility, sightlines, staffing, AV, catering, and emergency constraints.
- Import/export for VenueMind JSON first; SVG/PDF/DXF adapters only after the core schema stabilizes.

## 3. Agent platform

- Native WebMCP tools embedded in the planning workspace.
- Standalone MCP server exposing the same planner interface for external agents.
- Versioned agent skill packages for planning, validation, risk review, and event-day operations.
- Tool schemas, examples, error catalog, authorization model, and conformance tests.
- Human approval policies, scoped capabilities, idempotency keys, base-version checks, and audit exports.

## 4. Documentation and discovery

- Dedicated docs site with quickstart, concepts, tutorials, tool reference, schemas, examples, and troubleshooting.
- `/llms.txt` as the concise agent navigation index.
- `/llms-full.txt` as a generated complete documentation corpus.
- Machine-readable OpenAPI/JSON Schema artifacts where applicable.
- Copy-paste examples for ChatGPT, Codex, Claude, Cursor, and generic MCP clients.
- Architecture decision records, domain glossary, changelog, compatibility policy, and migration guides.

## 5. Product infrastructure

- Sites-backed accounts, Organizations, Membership Roles, Sessions, tenant-owned Projects, export, and deletion.
- Durable persistence, autosave, offline recovery, conflict resolution, and backups.
- Real-time collaboration, presence, comments, notifications, and share links.
- Observability for tool calls, validation latency, proposal outcomes, and failed approvals.
- Security review, rate limits, input limits, dependency scanning, privacy controls, and data export/deletion.

## 6. Integrations and operations

- Calendar and event-platform imports.
- Venue inventory, ticketing, registration, catering, AV, staffing, and emergency-plan adapters.
- Event-day runbook mode with live occupancy, issue tracking, handoffs, and incident ledger.
- Public integration SDK and adapter examples after the domain contracts reach stability.

## Current build order

1. Complete and test the Planning foundation.
2. Make the React workspace a caller of the planner instead of the owner of business state.
3. Prove the same commands through native WebMCP.
4. Add durable persistence and multiple Plan Versions.
5. Establish the docs site and generated agent-discovery artifacts.
6. Package the MCP server and agent skills against the stable planner interface.

Submission assets, video production, and Devpost copy are intentionally deferred.
