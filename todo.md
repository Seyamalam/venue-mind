# VenueMind product backlog

This is the execution backlog for turning VenueMind from a strong golden-loop prototype into a complete, trustworthy venue-operations product. Work from top to bottom unless a task is explicitly marked parallel. Keep submission copy, judging materials, and video production deferred until the final milestone.

## Product invariants

Every implementation must preserve these rules:

- The accepted Plan changes only through explicit human Approval.
- Agent actions create inspectable Proposals and Changes, never hidden Plan mutations.
- Every Proposal is based on exactly one immutable Plan Version.
- Stable IDs survive save, restore, branch, replay, import, export, and migration.
- Validation is deterministic: the same input produces the same ordered result.
- Locked Objects remain protected across UI, WebMCP, MCP, import, replay, and migrations.
- UI actions and agent tools use the same command interface.
- Every meaningful human and agent action appears in the Activity Ledger.
- Narrative copy stays out of the Studio interface; use labels, values, statuses, and evidence.
- Documentation, schemas, examples, and runtime behavior share sources of truth where practical.
- Every externally callable mutation has authorization, base-version, idempotency, and input-size checks.

## Definition of done

A task is complete only when all relevant conditions below hold:

- [ ] The behavior is implemented through the shared planner or service boundary.
- [ ] The visible UI exposes the result when the feature has a human-facing state.
- [ ] WebMCP and standalone MCP remain behaviorally consistent where the feature is agent-facing.
- [ ] Unit tests cover success, invalid input, stale state, and protected-state cases.
- [ ] Integration tests cover persistence and reload when the feature stores state.
- [ ] Accessibility checks cover keyboard operation, focus, labels, contrast, and reduced motion.
- [ ] Documentation and machine-readable contracts are updated from their canonical sources.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] The golden demo loop still works from a fresh Project.

## Current verified baseline

The following foundation exists and should be protected by regression tests:

- [x] Versioned Plan domain model with stable object IDs.
- [x] Shared command interface used by the Studio and agent tools.
- [x] Seeded SummitForward venue scenario.
- [x] Non-destructive Proposal previews with violet ghost Changes.
- [x] Deterministic checks for current locks, accessibility, capacity, circulation, sightlines, and congestion inputs.
- [x] Explicit human Approval that creates an immutable Plan Version.
- [x] Stale base-version rejection before Approval.
- [x] Adjustment Requests and individual Change reversion.
- [x] Undo and redo across accepted Plan Versions.
- [x] Activity Ledger with ordered human and agent entries.
- [x] Proposal Branch creation, switching, and strategy variants.
- [x] Visible Versions, Ledger, and Branches drawer.
- [x] VenueMind JSON export containing validation and ledger evidence.
- [x] Native WebMCP tool registration.
- [x] Standalone stdio MCP server using shared contracts.
- [x] Human-only Approval boundary across WebMCP and MCP.
- [x] D1 Project repository and `/api/projects` API.
- [x] Browser recovery cache and remote/local save status.
- [x] Project schema versioning and legacy snapshot normalization.
- [x] Generated JSON Schemas for commands, planner snapshots, and Project records.
- [x] `venuemind-plan` and `venuemind-audit` agent skills.
- [x] Multi-route documentation site.
- [x] Generated `/llms.txt` and `/llms-full.txt`.
- [x] Sites-compatible production worker bundle.
- [x] Automated domain, persistence, worker, MCP, and agent-doc tests.

---

# Milestone 1 — Make the golden loop production-grade

This is the immediate next milestone. Finish every section before broadening into collaboration or integrations.

## 1.1 Canonical geometry model

- [x] Define canonical units for coordinates, distance, area, angle, and time.
- [x] Store venue geometry in real-world units rather than screen pixels.
- [x] Add room polygons with outer boundaries and optional holes.
- [x] Add object footprints supporting rectangles, circles, lines, and polygons.
- [x] Add object rotation around an explicit anchor point.
- [x] Add doors, exits, corridors, aisles, service lanes, and restricted zones as typed geometry.
- [x] Add object elevation metadata for stage, riser, screen, and sightline calculations.
- [x] Add spatial layers for architecture, furniture, access, production, catering, safety, and annotations.
- [x] Define precision and rounding rules for geometry serialization.
- [x] Reject self-intersecting room and zone polygons.
- [x] Reject objects outside the room unless their type explicitly permits it.
- [x] Add geometry migration fixtures for every supported schema version.
- [x] Add deterministic geometry hashing for comparison and cache keys.
- [x] Document the coordinate system and unit policy.

Completion gate:

- [x] A room with rotated tables, irregular zones, doors, and aisles round-trips through save, export, import, and reload without geometry drift.

## 1.2 Constraint engine architecture

- [x] Replace scenario-specific checks with a registry of typed Constraint evaluators.
- [x] Give each Constraint a stable ID, category, severity, scope, parameters, and evidence format.
- [x] Return machine-readable actual values, thresholds, units, affected IDs, and suggested remediation.
- [x] Define `pass`, `warning`, `fail`, and `not-applicable` outcomes.
- [x] Sort Validation results deterministically by severity, category, and stable ID.
- [x] Add a Validation run ID and the exact Plan or Proposal fingerprint it evaluated.
- [x] Cache Validation by immutable input fingerprint.
- [x] Invalidate cached results only when relevant geometry or parameters change.
- [x] Distinguish hard safety Constraints from configurable operational preferences.
- [x] Prevent Approval when any hard Constraint fails.
- [x] Require an explicit human waiver record for waivable warnings.
- [x] Store waiver author, reason code, timestamp, and affected Constraint ID.
- [x] Add an error catalog with stable codes and remediation metadata.
- [x] Publish the Constraint and Validation result schemas.

Completion gate:

- [x] Two independent Validation runs over identical serialized input produce byte-equivalent normalized results.

## 1.3 Locks and protected infrastructure

- [x] Support position locks, rotation locks, deletion locks, dimension locks, and role locks.
- [x] Support inherited locks from venue templates.
- [x] Support human-authored temporary locks on a Project.
- [x] Display lock type and source in the object inspector.
- [x] Show lock conflicts directly on Proposal ghosts.
- [x] Reject locked mutations inside the planner command boundary.
- [x] Reject locked mutations during import and replay.
- [x] Add tests for partial locks and multi-object commands.
- [x] Record rejected lock attempts in the Activity Ledger without mutating the Plan.

Completion gate:

- [x] Every mutation path produces the same stable lock-conflict error for the same protected object.

## 1.4 Accessibility validation

- [x] Model accessible entrances and routes as a traversable graph.
- [x] Validate minimum clear route width.
- [x] Validate turning clearances at corners and destinations.
- [x] Validate accessible seating count and distribution.
- [x] Validate companion seating adjacency.
- [x] Validate accessible seating sightlines.
- [x] Validate routes from accessible entrances to seating, stage, restrooms, and exits.
- [x] Validate door clearance and obstruction zones.
- [x] Validate temporary ramps by slope, width, landing, and edge protection parameters.
- [x] Parameterize regulatory thresholds by jurisdiction and venue policy.
- [x] Label policy sources and effective dates in Constraint metadata.
- [x] Add access-first Proposal strategy tests.
- [x] Add an accessibility evidence summary to export.

Completion gate:

- [x] The seeded scenario can identify, visualize, explain, and resolve a deliberately broken accessible route without relying on an LLM judgment.

## 1.5 Capacity and occupancy validation

- [x] Calculate usable room area after fixed infrastructure and restricted zones.
- [x] Support seated, standing, classroom, banquet, theater, and mixed occupancy modes.
- [x] Calculate capacity from both placed inventory and density rules.
- [x] Apply the stricter result when multiple capacity limits exist.
- [x] Account for staff, performers, vendors, and production areas.
- [x] Validate section and zone capacities independently.
- [x] Validate total capacity against event requirements and venue maximum.
- [x] Show capacity deltas per Proposal Change.
- [x] Add over-capacity and under-target explanations to Validation evidence.
- [x] Export the final occupancy calculation.

Completion gate:

- [x] Capacity totals reconcile exactly from object-level counts through zones to the full Plan.

## 1.6 Circulation, egress, and congestion

- [x] Build a walkable navigation graph from room geometry, obstacles, doors, and aisles.
- [x] Detect disconnected occupied zones.
- [x] Validate minimum aisle and service-lane widths.
- [x] Validate that exit approach zones remain unobstructed.
- [x] Compute shortest paths from every occupied zone to valid exits.
- [x] Detect single points of circulation failure.
- [x] Estimate flow demand from zone occupancy and event phase.
- [x] Estimate bottleneck load at doors, aisle intersections, queues, and checkpoints.
- [x] Add ingress, interval, egress, and emergency phase profiles.
- [x] Visualize congestion evidence as overlays, not prose.
- [x] Add deterministic benchmark scenarios with known path results.
- [x] Add a circulation-first Proposal strategy.

Completion gate:

- [x] Moving one obstruction produces a visible path change, a reproducible congestion delta, and an auditable Validation result.

## 1.7 Sightlines

- [x] Model focal points for stage, screens, speakers, exhibits, and demonstrations.
- [x] Model opaque and partially opaque obstructions.
- [x] Compute horizontal viewing angles.
- [x] Compute vertical viewing angles using object and eye-height metadata.
- [x] Validate maximum viewing distance.
- [x] Validate blocked-seat percentage by section.
- [x] Support priority focal points and fallback focal points.
- [x] Render sightline rays for selected seats or representative samples.
- [x] Add sightlines-first branch strategy tests.
- [x] Store sampled seat IDs and computed evidence in Validation output.

Completion gate:

- [x] A moved screen or column changes only the affected sightline checks and preserves deterministic evidence IDs.

## 1.8 Proposal conflict handling

- [x] Define conflict types: stale base, same-object edit, geometry overlap, lock conflict, deleted dependency, and Constraint regression.
- [x] Detect conflicts between the active Proposal and a newer accepted Plan Version.
- [x] Add Proposal rebase onto the latest Plan Version.
- [x] Preserve stable Change IDs when a Change rebases unchanged.
- [x] Generate new Change IDs only for transformed or newly created Changes.
- [x] Present conflicts as structured choices in the Studio.
- [x] Support keep-proposal, keep-plan, and manual-resolution outcomes where safe.
- [x] Re-run Validation after every conflict resolution.
- [x] Record conflict detection and resolution in the Activity Ledger.
- [x] Add concurrent-edit fixtures covering two Proposal Branches.

Completion gate:

- [x] A stale Proposal can be rebased, reviewed, validated, and approved without losing its original lineage or ledger evidence.

## 1.9 Idempotency and command receipts

- [x] Add an idempotency key to every mutating command.
- [x] Store command receipts with actor, command type, input fingerprint, result IDs, and timestamp.
- [x] Return the original receipt for an exact retry.
- [x] Reject reuse of an idempotency key with different input.
- [x] Define retry-safe WebMCP and MCP behavior.
- [x] Add command correlation IDs across UI, API, worker, MCP, and ledger events.
- [x] Add tests for duplicate preview, branch creation, adjustment, and Approval commands.

Completion gate:

- [x] Replaying the same command request ten times produces one state transition and ten equivalent receipts.

## 1.10 Ledger integrity and replay

- [x] Define a versioned Activity Ledger event schema.
- [x] Add before/after Plan Version IDs to all state-transition events.
- [x] Add Proposal, Branch, Change, Validation, and command receipt references.
- [x] Add actor ID, actor type, source surface, and session metadata.
- [x] Hash-chain ledger entries to make accidental history corruption detectable.
- [x] Verify the ledger chain on load and export.
- [x] Implement replay from the original seed through accepted Plan Versions.
- [x] Compare replayed state with the stored current state fingerprint.
- [x] Surface ledger-integrity failures as blocking system status.
- [x] Add a portable audit export containing schemas and integrity metadata.

Completion gate:

- [x] A fresh planner can reconstruct every accepted Plan Version from the exported audit package and match all fingerprints.

---

# Milestone 2 — Complete the planning workspace

## 2.1 Project dashboard

- [x] Add a Project list backed by the existing Project API.
- [x] Create a Project from an empty template.
- [x] Duplicate a Project with new stable IDs and explicit provenance.
- [x] Rename and archive Projects.
- [x] Restore archived Projects.
- [x] Show last modified, current Plan Version, active Proposal status, and Validation status.
- [x] Add search, sort, and status filters.
- [x] Add a safe delete flow with typed Project confirmation and recovery window.
- [x] Add recent Projects and pinned Projects.
- [x] Add empty, loading, offline, and recovery states.

Completion gate:

- [x] A user can create, leave, reload, find, open, archive, and restore a Project without losing Plan history.

## 2.2 Structured event brief

- [x] Add event name, date, timezone, venue, room, attendance target, and occupancy mode.
- [x] Add structured requirements for accessibility, seating, production, catering, staffing, security, and emergency operations.
- [x] Give each requirement a stable ID, priority, owner, status, and evidence link.
- [x] Convert measurable requirements into Constraints.
- [x] Flag ambiguous requirements before agent planning.
- [x] Track requirement coverage by Proposal and accepted Plan Version.
- [x] Show unresolved requirements as a compact counter and filter.
- [x] Include the brief and coverage matrix in export.

Completion gate:

- [x] Every high-priority measurable requirement maps to a passing Constraint or an explicit human disposition.

## 2.3 Venue templates and inventory

- [x] Create reusable Venue and Room templates.
- [x] Separate template IDs from Project instance IDs.
- [x] Store architectural boundaries, exits, columns, utilities, rigging points, and restricted zones.
- [x] Store reusable furniture, seating, barriers, staging, AV, catering, signage, and queue objects.
- [x] Add dimensions, weight, power, capacity, cost, and inventory count metadata.
- [x] Add template versioning and migration.
- [x] Propagate safe template updates into Projects as reviewable Proposals.
- [x] Preserve Project-specific overrides.
- [x] Add inventory availability warnings.
- [x] Add starter templates for conference, concert, banquet, exhibition, classroom, and community event layouts.

Completion gate:

- [x] Updating a Room template creates an inspectable Project Proposal rather than silently changing accepted Plans.

## 2.4 Editing tools

- [x] Add select, multi-select, pan, zoom, place, move, rotate, resize, duplicate, align, distribute, and delete.
- [x] Add box selection and additive selection.
- [x] Add grid, guides, snapping, and configurable snap tolerance.
- [x] Add numeric position, dimension, and rotation inputs.
- [x] Add layer visibility and lock controls.
- [x] Add object grouping and ungrouping.
- [x] Add zone creation and vertex editing.
- [x] Add measurement and clearance tools.
- [x] Add keyboard shortcuts with a discoverable shortcut panel.
- [x] Add clipboard-safe copy and paste with new stable IDs.
- [x] Add focused object inspector with Constraint evidence.
- [x] Make every editing command undoable and ledgered.
- [x] Preserve current bright editorial visual direction.
- [x] Keep workspace labels operational and concise.

Completion gate:

- [x] A keyboard-and-mouse user can construct the seeded venue from an empty room and produce the same normalized Plan fingerprint.

## 2.5 Proposal comparison

- [x] Add side-by-side comparison of two Proposal Branches.
- [x] Add overlay comparison against the accepted Plan.
- [x] Summarize added, removed, moved, rotated, resized, and metadata Changes.
- [x] Compare capacity, access, circulation, sightlines, risk, and cost metrics.
- [x] Highlight Constraint regressions and improvements.
- [x] Add branch naming and human notes.
- [x] Add branch duplication from any prior Proposal revision.
- [x] Add branch archive and restore.
- [x] Add a decision checkpoint that records the chosen branch and rejected alternatives.

Completion gate:

- [x] A reviewer can identify why one branch was approved using only comparison evidence and the Activity Ledger.

## 2.6 Comments and annotations

- [x] Add comments anchored to a Project, Plan Version, Proposal, Change, Constraint, or spatial coordinate.
- [x] Add open, resolved, and reopened states.
- [x] Add author, timestamp, mentions, and edit history.
- [x] Add compact annotation pins on the canvas.
- [x] Add filters by author, status, and subject.
- [x] Prevent comments from changing planning state.
- [x] Include decision-relevant comments in audit export.

Completion gate:

- [x] A comment remains anchored to the correct immutable subject across branch changes and new Plan Versions.

## 2.7 Import and export

- [x] Finalize a versioned VenueMind JSON interchange format.
- [x] Publish its JSON Schema and examples.
- [x] Add import preview with validation and migration report.
- [x] Reject unknown destructive fields and malformed geometry.
- [x] Preserve external source metadata and checksums.
- [x] Export SVG with layers, IDs, dimensions, and accessible labels.
- [x] Export print-ready PDF with plan, legend, metrics, Validation, and version metadata.
- [x] Export CSV inventory and object schedules.
- [x] Export a portable audit package.
- [x] Investigate DXF import behind an adapter boundary after JSON stabilizes.
- [x] Investigate PDF floor-plan tracing as an assisted workflow, never as authoritative geometry.

Completion gate:

- [x] A VenueMind JSON export imports into a clean installation and reproduces the same Plan, Constraints, versions, and ledger fingerprints.

---

# Milestone 3 — Simulation and planning intelligence

## 3.1 Scenario framework

- [x] Define scenario inputs, deterministic seed, time horizon, phases, outputs, and confidence metadata.
- [x] Separate deterministic Constraint Validation from probabilistic simulation.
- [x] Store simulation engine version and parameters with every result.
- [x] Cache simulations by immutable input fingerprint.
- [x] Cancel obsolete simulations when a Proposal changes.
- [x] Show progress and partial results without blocking manual planning.
- [x] Compare simulation results across Proposal Branches.
- [x] Export scenario parameters and results.

Completion gate:

- [x] Re-running a seeded scenario with the same engine version produces matching normalized outputs.

## 3.2 Ingress and egress simulation

- [x] Model arrival and departure curves.
- [x] Model entrances, exits, checkpoints, doors, stairs, elevators, and corridors.
- [x] Model attendee mobility profiles without exposing sensitive personal data.
- [x] Estimate clearance time by zone and full venue.
- [x] Surface bottleneck duration and affected occupancy.
- [x] Compare normal egress and emergency egress assumptions.
- [x] Render time-based density overlays.
- [x] Add benchmark scenarios with expected ranges.

Completion gate:

- [x] The Studio can compare two branches by total clearance time, worst bottleneck, and accessible-route performance.

## 3.3 Queue simulation

- [x] Model arrivals, service rates, parallel servers, abandonment, and priority lanes.
- [x] Support registration, security, cloakroom, food, beverage, restroom, merchandise, and transport queues.
- [x] Estimate average wait, percentile wait, maximum queue length, and overflow risk.
- [x] Detect queue spill into circulation or exit zones.
- [x] Suggest measurable capacity changes without auto-applying them.
- [x] Validate queue geometry after every suggested Proposal.

Completion gate:

- [x] A service-rate change produces reproducible queue metrics and a spatially valid Proposal option.

## 3.4 Staffing and operations

- [x] Model staff roles, counts, stations, shifts, and coverage zones.
- [x] Validate required coverage at entrances, exits, accessible routes, stages, and service areas.
- [x] Estimate walking distance and handoff risk.
- [x] Add staff-only circulation and service routes.
- [x] Add post positions to the Plan as typed objects.
- [x] Export a staffing schedule and post map.

Completion gate:

- [x] Every required operational zone has an assigned role, reachable post, and auditable coverage result.

## 3.5 AV and production planning

- [x] Model stages, screens, projectors, speakers, cameras, control desks, cable routes, power, rigging, and backstage zones.
- [x] Validate throw distances, screen visibility, speaker coverage assumptions, and control sightlines.
- [x] Validate cable crossings and accessible-route conflicts.
- [x] Validate power demand against circuits and distribution metadata.
- [x] Add production-only layers and export schedules.
- [x] Add equipment inventory reconciliation.

Completion gate:

- [x] Production Changes expose spatial, power, cable, inventory, and sightline evidence before Approval.

## 3.6 Catering and service planning

- [x] Model bars, buffets, kitchens, prep, waste, water, service lanes, and replenishment routes.
- [x] Validate food-service queue spill and circulation conflict.
- [x] Validate separation requirements from production and emergency infrastructure.
- [x] Estimate service capacity by attendance and event phase.
- [x] Add allergen and dietary-station metadata without storing attendee health records.
- [x] Export service station and replenishment schedules.

Completion gate:

- [x] Catering layout branches can be compared by service capacity, queue risk, circulation impact, and accessible service points.

## 3.7 Emergency planning

- [x] Model emergency exits, assembly points, emergency access lanes, fire equipment, first aid, and command posts.
- [x] Add emergency-only hard Constraints.
- [x] Add degraded scenarios for blocked exit, unavailable corridor, and power loss.
- [x] Require explicit authorized human review for emergency-plan Approval.
- [x] Store emergency assumptions and reviewer identity in the audit package.
- [x] Add a print-safe emergency plan export.

Completion gate:

- [x] A blocked-exit scenario identifies affected zones, alternative routes, capacity impact, and unresolved hard failures.

---

# Milestone 4 — Agent platform completeness

## 4.1 WebMCP production hardening

- [x] Detect and display tool registration lifecycle states.
- [x] Version every WebMCP tool contract.
- [x] Add structured content and human-readable summaries to tool results.
- [x] Add stable tool error codes.
- [x] Add request correlation and idempotency metadata.
- [x] Add per-tool authorization scopes.
- [x] Add tool-call cancellation where supported.
- [x] Add size limits for inspection, export, and geometry payloads.
- [x] Add redaction rules for sensitive Project metadata.
- [x] Add browser conformance tests for registration, invocation, errors, and reload.
- [x] Add a WebMCP diagnostics panel to the Studio.

Completion gate:

- [x] The browser tool suite passes a repeatable conformance test from fresh load through export with no direct UI-state mutation.

## 4.2 Standalone MCP server

- [x] Add a persisted Project repository adapter rather than process-local state only.
- [x] Add Project selection and scoped sessions.
- [x] Add MCP resources for current Project, Plan Version, active Proposal, schemas, and documentation.
- [x] Add MCP resource templates for Project and Plan IDs.
- [x] Add MCP prompts for supervised planning and audit workflows where useful.
- [x] Add progress reporting for expensive Validation and simulation calls.
- [x] Add structured logging to standard error.
- [x] Add graceful shutdown and interrupted-command handling.
- [x] Add authentication transport guidance for remote deployment.
- [x] Add server capability and compatibility metadata.
- [x] Add black-box tests with the official MCP client.
- [x] Add installation examples for Codex, ChatGPT-compatible hosts, Claude Desktop, Cursor, and generic clients.

Completion gate:

- [x] An external MCP client can open a durable Project, inspect, create a branch, preview, validate, read the ledger, and export while Approval remains unavailable.

## 4.3 Tool expansion

- [x] Add `venue.list_projects`.
- [x] Add `venue.open_project`.
- [x] Add `venue.get_project_brief`.
- [x] Add `venue.list_constraints`.
- [x] Add `venue.get_validation_evidence`.
- [x] Add `venue.compare_proposal_branches`.
- [x] Add `venue.request_adjustment`.
- [x] Add `venue.rebase_proposal`.
- [x] Add `venue.get_object` with scoped geometry and metadata.
- [x] Add `venue.search_objects` with bounded filters.
- [x] Add `venue.run_scenario` after the simulation framework is stable.
- [x] Add `venue.get_scenario_result`.
- [x] Add `venue.export_audit_package`.
- [x] Keep Approval and destructive Project deletion out of agent tools.

Completion gate:

- [x] Every tool is generated into docs, MCP registration, WebMCP registration, schemas, error catalog, examples, and conformance tests from shared sources.

## 4.4 Agent skills

- [x] Version and package `venuemind-plan` for installation.
- [x] Version and package `venuemind-audit` for installation.
- [x] Add `venuemind-access-review` for accessibility evidence and remediation branches.
- [x] Add `venuemind-crowd-flow` after simulations are deterministic enough for repeatable use.
- [x] Add `venuemind-production-plan` for AV, staging, power, and cable routing.
- [x] Add `venuemind-event-day` for live runbooks and issue triage.
- [x] Add references that point to generated schemas rather than duplicating them.
- [x] Add adversarial fixtures for premature Approval, ignored locks, stale versions, and missing evidence.
- [x] Validate every skill package in CI.
- [x] Add evaluation prompts and expected behavioral invariants.
- [x] Measure tool-selection accuracy and unnecessary-call rate.

Completion gate:

- [x] Every skill completes its workflow with the correct tools, stops at its authority boundary, and produces the required evidence across the evaluation suite.

## 4.5 Authorization policy

- [x] Define roles for viewer, planner, reviewer, approver, venue administrator, and organization administrator.
- [x] Define agent scopes separately from human roles.
- [x] Add Project, Plan, Proposal, export, and audit permissions.
- [x] Enforce authorization inside service boundaries, not only in UI controls.
- [x] Add short-lived scoped agent grants.
- [x] Add Approval policy checks for required reviewer roles.
- [x] Add permission-denial ledger events without leaking protected data.
- [x] Add policy decision tests for every command and tool.

Completion gate:

- [x] An authorization matrix test proves every role and agent scope can perform exactly its documented operations.

---

# Milestone 5 — Documentation as a product

## 5.1 Documentation architecture

- [x] Keep structured docs content as the canonical source for site pages and agent text files.
- [x] Split the current compact source when page complexity makes maintenance difficult.
- [x] Add stable page metadata: title, description, canonical path, audience, and last reviewed version.
- [x] Generate navigation and table of contents from page structure.
- [x] Add search with keyboard navigation.
- [x] Add heading anchors and deep-link copy controls.
- [x] Add previous/next navigation.
- [x] Add version and compatibility badges.
- [x] Add a visible docs changelog.
- [x] Add broken-link and duplicate-anchor tests.
- [x] Add sitemap and metadata for public hosting.

Completion gate:

- [x] Every public contract, tool, skill, and workflow is reachable in two navigation actions or fewer from `/docs`.

## 5.2 Tutorials

- [x] Write “Create your first Project.”
- [x] Write “Run the one-minute supervised planning loop.”
- [x] Write “Compare access-first and capacity-first branches.”
- [x] Write “Resolve a stale Proposal.”
- [x] Write “Audit an approved Plan Version.”
- [x] Write “Install the VenueMind MCP server.”
- [x] Write “Use VenueMind through native WebMCP.”
- [x] Write “Install and invoke VenueMind agent skills.”
- [x] Write “Import, validate, and export a venue plan.”
- [x] Write “Recover from offline local state.”
- [x] Back every tutorial with a tested fixture or executable example.

Completion gate:

- [x] A fresh user can complete every tutorial against a clean local installation without undocumented steps.

## 5.3 Reference documentation

- [x] Generate a page for every command and tool.
- [x] Document input fields, defaults, bounds, and examples.
- [x] Document output fields and stable IDs.
- [x] Document every stable error code and remediation path.
- [x] Document Project and planner schema versions.
- [x] Document persistence and recovery semantics.
- [x] Document branch, rebase, conflict, Approval, undo, and replay semantics.
- [x] Document all Constraint categories and evidence units.
- [x] Document Activity Ledger events.
- [x] Document security and authorization scopes.
- [x] Publish compatibility and deprecation policies.

Completion gate:

- [x] Contract tests prove documented required fields, examples, and error codes match runtime behavior.

## 5.4 Agent discovery files

- [x] Keep `/llms.txt` concise and navigational.
- [x] Keep `/llms-full.txt` generated from complete canonical docs.
- [x] Add absolute production URLs during deployment builds.
- [x] Include tool names, safety boundary, schema URLs, skill names, and compatibility versions.
- [x] Exclude stale or private documentation.
- [x] Add size and content checks in CI.
- [x] Add a generation-drift check that fails on uncommitted output changes.

Completion gate:

- [x] Regenerating agent docs in a clean checkout produces no diff and includes every public tool exactly once.

## 5.5 Examples and client guides

- [x] Add minimal WebMCP browser invocation examples.
- [x] Add generic MCP client configuration.
- [x] Add Codex configuration and workflow examples.
- [x] Add Claude Desktop configuration and workflow examples.
- [x] Add Cursor configuration and workflow examples.
- [x] Add raw JSON request and response fixtures.
- [x] Add TypeScript examples using generated schemas.
- [x] Add examples for retry, stale base, validation failure, and export.
- [x] Redact local paths and secrets from published examples.

Completion gate:

- [x] Every published example is executed or schema-validated in CI.

## 5.6 Architecture and contributor docs

- [x] Add an architecture overview showing UI, planner, contracts, persistence, WebMCP, MCP, and docs generation.
- [x] Add a data-flow diagram for inspect through Approval and export.
- [x] Add a persistence and recovery diagram.
- [x] Add an ADR for shared runtime contracts.
- [x] Add ADRs for geometry units, validation registry, ledger integrity, and authorization.
- [x] Add a schema migration guide.
- [x] Add a local development guide.
- [x] Add a testing guide by layer.
- [x] Add a release checklist.
- [x] Add a security reporting policy before public launch.

Completion gate:

- [x] A new contributor can locate the correct boundary for a proposed change and run its relevant test suite without private guidance.

---

# Milestone 6 — Accounts, collaboration, and durability

## 6.1 Authentication and organizations

- [x] Choose an authentication provider behind a replaceable adapter.
- [x] Add users and organizations.
- [x] Add organization membership and invitations.
- [x] Add role assignment and removal.
- [x] Add session expiration and revocation.
- [x] Add organization-level Project ownership.
- [x] Add audit events for membership and role changes.
- [x] Add account export and deletion workflows.

Completion gate:

- [x] Two organizations remain fully isolated across API, UI, WebMCP, MCP, export, and logs.

## 6.2 Persistence migrations and backups

- [x] Add explicit database migrations rather than runtime-only schema creation.
- [x] Add migration numbering and checksums.
- [x] Add backup and restore procedures.
- [x] Add Point-in-Time Recovery guidance where supported.
- [x] Add Project export before destructive migrations.
- [x] Add migration fixtures from every released schema version.
- [x] Add migration dry-run reporting.
- [x] Add database integrity and orphan checks.

Completion gate:

- [x] A copy of production-shaped data upgrades and restores in a test environment with matching Project and ledger fingerprints.

## 6.3 Optimistic concurrency

- [x] Add durable record revisions or ETags.
- [x] Reject writes based on stale Project revisions.
- [x] Return structured conflict data.
- [x] Reconcile independent non-overlapping edits where safe.
- [x] Route overlapping planning edits through Proposal conflict handling.
- [x] Preserve local unsynchronized work as a recoverable branch.
- [x] Show synchronization state without narrative alerts.

Completion gate:

- [x] Two browser sessions editing the same Project cannot silently overwrite each other.

## 6.4 Real-time collaboration

- [x] Add presence with user identity, current Plan Version, and focused object.
- [x] Add live cursor or viewport indicators only when useful.
- [x] Stream comments, ledger entries, Proposal updates, and Approval results.
- [x] Keep accepted Plan mutation serialized through the command boundary.
- [x] Reconnect and resume from a durable sequence cursor.
- [x] Detect and recover from missed events.
- [x] Add collaboration load tests.

Completion gate:

- [x] Three sessions can review one Proposal concurrently and converge on identical accepted state after Approval.

## 6.5 Sharing and notifications

- [x] Add read-only share links with expiration and revocation.
- [x] Add reviewer share links scoped to one Proposal.
- [x] Add optional email or in-product notifications for review requested, Adjustment requested, Approval completed, and conflict detected.
- [x] Add per-user notification preferences.
- [x] Avoid including sensitive geometry or event details in notification bodies.
- [x] Record share-link creation and revocation in the ledger.

Completion gate:

- [x] A revoked share link loses access immediately and leaves a complete audit trail.

---

# Milestone 7 — Integrations and adapter SDK

## 7.1 Adapter architecture

- [x] Define a versioned adapter interface for import, export, synchronization, and webhook events.
- [x] Separate external IDs from VenueMind stable IDs.
- [x] Store source system, source version, sync timestamp, and checksum.
- [x] Make imported changes reviewable before they affect an accepted Plan.
- [x] Add per-adapter scopes and secret storage.
- [x] Add retry, rate-limit, and dead-letter behavior.
- [x] Add adapter contract tests and fixtures.
- [x] Publish an example adapter after the interface stabilizes.

Completion gate:

- [x] An adapter can import a change twice without duplicating objects or bypassing Proposal review.

## 7.2 Calendar and event platforms

- [x] Import event title, schedule, timezone, location, attendance target, and organizer metadata.
- [x] Map external events to Projects.
- [x] Detect schedule and attendance changes.
- [x] Turn planning-relevant updates into reviewable requirement Changes.
- [x] Keep calendar content outside the spatial ledger unless it affects planning state.

Completion gate:

- [x] An updated attendance target creates a traceable requirement change and invalidates only relevant capacity and flow evidence.

## 7.3 Registration and ticketing

- [x] Import ticket classes and attendance forecasts.
- [x] Map ticket classes to zones and access requirements.
- [x] Import aggregate accessibility requirements with privacy-preserving defaults.
- [x] Reconcile checked-in counts during event-day mode.
- [x] Avoid storing unnecessary attendee identity data.

Completion gate:

- [x] Ticket-class totals reconcile with Project occupancy requirements without exposing personal attendee data.

## 7.4 Inventory, AV, catering, and staffing adapters

- [x] Import venue inventory availability.
- [x] Import AV equipment and power metadata.
- [x] Import catering stations and service capacities.
- [x] Import staffing roles, shifts, and assigned personnel.
- [x] Detect unavailable or double-booked resources.
- [x] Create reviewable substitutions rather than silent replacements.

Completion gate:

- [x] An unavailable approved object creates a visible operational conflict and a validated replacement Proposal.

## 7.5 Public SDK

- [x] Publish TypeScript types from canonical schemas.
- [x] Add a typed client for Project, Plan, Proposal, Validation, ledger, and export APIs.
- [x] Add adapter helpers for idempotency, pagination, retries, and webhooks.
- [x] Add sandbox fixtures and a local test server.
- [x] Add semantic versioning and deprecation policy.
- [x] Add generated API reference and examples.

Completion gate:

- [x] The example adapter builds and passes its contract suite against the latest SDK release.

---

# Milestone 8 — Event-day operations

## 8.1 Runbook mode

- [ ] Create an event-day runbook from an approved Plan Version.
- [ ] Freeze the operational baseline and record its source version.
- [ ] Add timed tasks, owners, dependencies, status, and evidence.
- [ ] Add setup, doors, live event, interval, egress, and breakdown phases.
- [ ] Add filtered role views for production, front of house, security, catering, and venue operations.
- [ ] Add offline-capable task updates.
- [ ] Add shift handoff summaries derived from structured state.

Completion gate:

- [ ] A runbook can operate offline through a full seeded event and synchronize without duplicate task transitions.

## 8.2 Live occupancy

- [ ] Ingest aggregate check-in and zone occupancy signals.
- [ ] Display source freshness and confidence.
- [ ] Compare live occupancy with approved capacity and simulation assumptions.
- [ ] Trigger structured warnings for thresholds and stale data.
- [ ] Preserve privacy by defaulting to aggregate data.
- [ ] Record threshold events in the incident ledger.

Completion gate:

- [ ] Stale, conflicting, and over-threshold occupancy feeds produce distinct, auditable operational states.

## 8.3 Issues and incidents

- [ ] Add issue severity, category, location, owner, status, and timestamps.
- [ ] Anchor incidents to Plan objects or coordinates.
- [ ] Add photos or attachments behind secure storage controls.
- [ ] Add escalation and acknowledgement states.
- [ ] Add structured handoffs.
- [ ] Link emergency actions to the approved emergency Plan Version.
- [ ] Export a post-event incident record.

Completion gate:

- [ ] Every incident transition has one actor, one timestamp, one location context, and one ordered ledger entry.

## 8.4 Live plan deviations

- [ ] Record operational deviations from the approved Plan without rewriting historical truth.
- [ ] Require reason, author, timestamp, and affected objects.
- [ ] Validate emergency Changes against available live Constraints.
- [ ] Distinguish temporary deviation from permanent Plan revision.
- [ ] Create a post-event Proposal for changes worth retaining.

Completion gate:

- [ ] The final record clearly distinguishes the approved Plan, live deviations, and post-event recommended revisions.

## 8.5 Post-event review

- [ ] Compare predicted and observed occupancy, queue, flow, and incident outcomes.
- [ ] Capture structured lessons against requirements and Constraints.
- [ ] Produce template-improvement Proposals.
- [ ] Preserve evidence provenance.
- [ ] Export a concise post-event report.

Completion gate:

- [ ] Every recommended template change traces to an observed event-day outcome and remains human-approved.

---

# Milestone 9 — Security, reliability, and scale

## 9.1 Threat model

- [ ] Document assets, trust boundaries, actors, entry points, and abuse cases.
- [ ] Cover prompt injection through imported event content and comments.
- [ ] Cover malicious geometry and oversized payloads.
- [ ] Cover cross-organization access and insecure share links.
- [ ] Cover forged ledger entries and replayed commands.
- [ ] Cover MCP tool overreach and confused-deputy scenarios.
- [ ] Cover export data leakage.
- [ ] Assign mitigations and verification owners.

Completion gate:

- [ ] Every high-risk threat has an implemented control, a test, and an owner.

## 9.2 Input and resource limits

- [ ] Define maximum Project, room, object, Change, Proposal, comment, and export sizes.
- [ ] Enforce limits at browser, API, worker, planner, WebMCP, MCP, and import boundaries.
- [ ] Add geometry-complexity and recursion limits.
- [ ] Add time budgets for Validation and simulation.
- [ ] Add rate limits by identity, organization, and endpoint.
- [ ] Return stable limit errors with safe metadata.

Completion gate:

- [ ] Fuzz and load tests cannot cause unbounded memory, CPU, database, or response growth within documented limits.

## 9.3 Data protection

- [ ] Classify stored data and document retention defaults.
- [ ] Minimize personal data in event, registration, and incident workflows.
- [ ] Encrypt secrets and integration credentials.
- [ ] Add export and deletion workflows.
- [ ] Add organization retention policies.
- [ ] Redact secrets and sensitive data from logs.
- [ ] Validate backup deletion expectations.

Completion gate:

- [ ] A Project deletion audit proves primary data, derived exports, caches, and configured backups follow the documented policy.

## 9.4 Observability

- [ ] Add structured application and worker logs.
- [ ] Add metrics for command latency, Validation latency, simulation latency, persistence failures, conflicts, and Approval outcomes.
- [ ] Add traces across client, API, repository, planner, and external adapters.
- [ ] Add correlation IDs to user-visible diagnostics.
- [ ] Add dashboards for golden-loop health.
- [ ] Add alerts for elevated failure rates and data-integrity errors.
- [ ] Avoid logging raw sensitive Project payloads.

Completion gate:

- [ ] A failed Approval can be traced from UI action through policy, Validation, persistence, and ledger result using one correlation ID.

## 9.5 Performance

- [ ] Define target Plan sizes for small, medium, and large Projects.
- [ ] Benchmark inspection, preview, Validation, branch switch, Approval, replay, load, and export.
- [ ] Move expensive geometry work off the main UI thread.
- [ ] Incrementally validate only affected Constraints where correctness permits.
- [ ] Virtualize long ledgers, object lists, comments, and history.
- [ ] Add spatial indexes for object queries and collision candidates.
- [ ] Add performance regression budgets to CI.

Completion gate:

- [ ] The target large Plan remains interactively editable while Validation and simulation run within documented budgets.

## 9.6 Reliability and recovery

- [ ] Add crash-safe autosave boundaries.
- [ ] Add network interruption and retry tests.
- [ ] Add corrupted local-cache recovery.
- [ ] Add partial database-write recovery.
- [ ] Add worker restart and deployment compatibility tests.
- [ ] Add backup restoration drills.
- [ ] Add a visible system-integrity status derived from checks, not narrative messaging.

Completion gate:

- [ ] Every injected failure either leaves state unchanged or produces a recoverable, ledgered state with no silent data loss.

---

# Milestone 10 — Accessibility and product quality

## 10.1 Studio accessibility

- [ ] Complete keyboard navigation for canvas, drawers, branch controls, history, validation, and Approval.
- [ ] Add visible focus states to every interactive control.
- [ ] Add semantic names for icon-only controls.
- [ ] Add accessible canvas alternatives for object selection and editing.
- [ ] Announce Validation and Proposal state changes through appropriate live regions.
- [ ] Preserve usability at 200% zoom.
- [ ] Support reduced motion.
- [ ] Verify color is never the only carrier of status.
- [ ] Test contrast for ghost Changes, failures, warnings, locks, and selection.
- [ ] Add automated accessibility checks and a manual checklist.

Completion gate:

- [ ] The complete golden loop can be operated and understood without a pointing device.

## 10.2 Responsive workspace

- [ ] Define supported minimum viewport sizes.
- [ ] Optimize review and Approval for tablet layouts.
- [ ] Provide a read-only mobile review mode.
- [ ] Keep precision editing desktop-first unless research justifies mobile editing.
- [ ] Test docs, dashboard, Studio, exports, and shared reviews across supported sizes.

Completion gate:

- [ ] Reviewers can inspect evidence, request an Adjustment, and approve or reject safely on a supported tablet.

## 10.3 Visual system

- [ ] Formalize color, type, spacing, border, elevation, icon, and motion tokens.
- [ ] Define semantic status colors and contrast requirements.
- [ ] Extract reusable controls without erasing the editorial visual identity.
- [ ] Add component states for loading, empty, offline, conflict, invalid, and disabled.
- [ ] Add visual regression tests for critical product states.
- [ ] Keep Studio copy terse and operational.

Completion gate:

- [ ] Critical screens use shared tokens and pass visual regression without genericizing the selected design direction.

## 10.4 Cross-browser and device quality

- [ ] Define supported browsers and versions.
- [ ] Test Chromium, Safari, and Firefox behavior.
- [ ] Test high-density and standard-density displays.
- [ ] Test trackpad, mouse, keyboard, and touch interactions where supported.
- [ ] Test clipboard, downloads, printing, and local recovery behavior.
- [ ] Test WebMCP availability and graceful fallback by browser.

Completion gate:

- [ ] The golden loop and exports pass the supported-browser matrix with documented WebMCP capability differences.

## 10.5 Next.js and shadcn frontend platform

- [x] Pin the current stable Next.js 16, React 19, Tailwind CSS 4, and shadcn toolchain.
- [x] Establish App Router ownership for Studio, Projects, Settings, Shared Review, and every generated docs page.
- [x] Add route metadata, loading, error, not-found, typed dynamic params, and static docs params.
- [x] Keep browser persistence, collaboration, and WebMCP behind client-only route boundaries.
- [x] Preserve the Vite/Sites compatibility package while Next.js becomes the primary Vercel frontend.
- [x] Add source-owned shadcn primitives and map the selected Design 2 palette into semantic tokens.
- [x] Replace manual internal navigation with Next Link and router APIs.
- [x] Move docs content and navigation into Server Components; retain only search, copy, and keyboard behavior on the client.
- [ ] Migrate product controls, menus, popovers, sheets, tabs, forms, confirmations, and feedback to VenueMind compositions over shadcn primitives.
- [x] Replace browser prompts with accessible dialogs and confirmation flows.
- [x] Split the heavy editor, simulations, and comments surfaces behind interaction-driven client chunks.
- [ ] Split the remaining history and sharing surfaces from the initial Studio runtime.
- [ ] Remove the obsolete Vite SPA entry after the Sites compatibility boundary has a supported Next.js handoff.
- [ ] Verify route-specific bundles, WebMCP cleanup, persistence recovery, collaboration teardown, accessibility, and visual parity.

Completion gate:

- [ ] Next.js is the production frontend, public/docs routes exclude the Studio runtime, all product routes preserve Design 2 without narrative UI copy, and the complete local verification gate passes.

---

# Milestone 11 — Testing and delivery system

## 11.1 Test architecture

- [ ] Keep fast domain tests independent of React and network services.
- [ ] Add geometry unit and property tests.
- [ ] Add command contract tests generated from schemas.
- [ ] Add persistence integration tests against a real local database runtime.
- [ ] Add WebMCP browser tests.
- [ ] Add MCP black-box tests.
- [ ] Add end-to-end golden-loop tests.
- [ ] Add accessibility tests.
- [ ] Add visual regression tests for critical states.
- [x] Add import/export round-trip tests.
- [x] Add migration tests for every schema version.
- [ ] Add deterministic simulation fixtures.
- [ ] Add security fuzz tests for geometry and tool inputs.

Completion gate:

- [ ] Each production boundary has at least one failure test proving errors do not partially mutate accepted state.

## 11.2 CI

- [ ] Add install, format, lint, typecheck, test, build, and artifact verification jobs.
- [ ] Add generated-contract and generated-doc drift checks.
- [ ] Add skill validation.
- [ ] Add dependency and secret scanning.
- [ ] Add migration tests.
- [ ] Add browser tests on protected branches.
- [ ] Cache dependencies without caching generated truth incorrectly.
- [ ] Upload useful test artifacts on failure.

Completion gate:

- [ ] A clean CI run proves source, generated artifacts, tests, production build, worker bundle, MCP bundle, and skills are mutually compatible.

## 11.3 Release process

- [ ] Define semantic versioning for product, Project schema, tools, MCP server, and skills.
- [ ] Add a changelog generated from reviewed release notes.
- [ ] Add preview, staging, and production environments.
- [ ] Add database migration gates.
- [ ] Add smoke tests after deployment.
- [ ] Add rollback procedures for application and database changes.
- [ ] Add compatibility checks for existing Projects before release.
- [ ] Add release provenance and checksums for distributed artifacts.

Completion gate:

- [ ] A release can be promoted, verified, and rolled back without losing accepted Plan or ledger data.

---

# Milestone 12 — Deployment and public readiness

## 12.1 Hosting

- [ ] Create a production Sites project only when deployment is explicitly authorized.
- [ ] Bind the production D1 database.
- [ ] Configure production environment values and secrets.
- [ ] Configure custom domain and HTTPS.
- [ ] Add security headers and content security policy.
- [ ] Add cache policy for static assets, schemas, and agent discovery files.
- [ ] Verify SPA route fallback and API 404 behavior.
- [ ] Verify `/docs`, `/llms.txt`, `/llms-full.txt`, and `/schemas/*` in production.
- [ ] Run post-deployment golden-loop smoke tests.

Completion gate:

- [ ] A fresh production user can complete the golden loop and reload the durable Project from another browser session.

## 12.2 Legal and trust surfaces

- [ ] Add privacy policy matching actual data flows.
- [ ] Add terms appropriate to the product stage.
- [ ] Add security and responsible disclosure contact.
- [ ] Add data export and deletion instructions.
- [ ] Add operational disclaimer boundaries for safety-sensitive planning.
- [ ] Add third-party license notices.
- [ ] Document which checks are configurable policies rather than legal determinations.

Completion gate:

- [ ] Public trust documents match implemented collection, storage, retention, and deletion behavior.

## 12.3 Product analytics

- [ ] Define a privacy-preserving event taxonomy.
- [ ] Track golden-loop completion, validation outcomes, Adjustment cycles, branch comparison, and export.
- [ ] Track errors and abandonment without collecting raw geometry or event content by default.
- [ ] Add opt-out controls where required.
- [ ] Use analytics to identify friction, not to weaken supervision.

Completion gate:

- [ ] Product metrics answer where users fail in the golden loop without exposing sensitive Project content.

---

# Final milestone — Hackathon submission package

Start this only in the final days, after the product demo path is stable.

## Submission readiness gate

- [ ] Production golden loop works from a fresh account and Project.
- [ ] Native WebMCP invocation is visible and reproducible.
- [ ] Human Approval boundary is obvious in the demo.
- [ ] Validation evidence is deterministic and credible.
- [ ] Version history and Activity Ledger tell the full story.
- [ ] Export produces a polished validated plan.
- [ ] Docs, MCP server, schemas, skills, and agent discovery files are public and functional.
- [ ] No critical test, security, accessibility, or data-loss issue remains open.

## Devpost submission

- [ ] Re-read the current official hackathon rules and judging criteria.
- [ ] Confirm eligibility, dates, required technologies, team rules, and submission fields.
- [ ] Map each judging criterion to one visible product proof.
- [ ] Write the project title, tagline, summary, inspiration, implementation, challenges, accomplishments, lessons, and roadmap.
- [ ] List the exact WebMCP usage and why it matters to the product.
- [ ] Add public repository, production URL, docs URL, and demo video URL.
- [ ] Add accurate technology and contributor credits.
- [ ] Review all claims against the running product.

## One-minute winning demo

- [ ] Freeze one deterministic seeded Project and browser state.
- [ ] Start with the accepted Plan and visible Constraint status.
- [ ] Show the agent call `venue.inspect_layout`.
- [ ] Ask for a measurable layout outcome.
- [ ] Show `venue.preview_revision` producing violet ghost Changes.
- [ ] Show `venue.validate_layout` with access, capacity, circulation, locks, and sightline evidence.
- [ ] Compare the active Proposal with an alternative branch if time permits.
- [ ] Show the human Approval action.
- [ ] Show the new immutable Plan Version and ledger entries.
- [ ] Export the validated plan.
- [ ] Keep every frame product-focused and remove setup delays.
- [ ] Record a clean backup take.

## Submission media

- [ ] Capture crisp product screenshots at consistent dimensions.
- [ ] Include the Studio, violet Proposal ghosts, Validation evidence, Branch comparison, Ledger, docs, and agent tool invocation.
- [ ] Create a short architecture visual only if it improves understanding.
- [ ] Record voiceover after the demo timing is locked.
- [ ] Add captions.
- [ ] Verify text remains readable after platform compression.
- [ ] Export and test the final video on the submission platform.

Completion gate:

- [ ] A judge can understand the problem, WebMCP advantage, safety model, technical depth, and finished outcome in one minute without narration-dependent gaps.

---

# Immediate execution queue

When resuming development, take the first unchecked item whose dependencies are satisfied. The next recommended sequence is:

1. [x] Introduce canonical real-world geometry units and typed room/object footprints.
2. [x] Refactor current Validation into a typed Constraint evaluator registry.
3. [x] Add command idempotency keys and receipts.
4. [x] Add Activity Ledger schema versioning, fingerprints, and replay verification.
5. [x] Implement Proposal stale-conflict detection and rebase.
6. [x] Build the Project dashboard and new-Project flow.
7. [x] Build the structured event brief and requirement-to-Constraint mapping.
8. [x] Expand accessibility, circulation, capacity, and sightline evidence against real geometry.
9. [x] Add side-by-side Proposal Branch comparison.
10. [x] Finalize VenueMind JSON round-trip import/export.

## Verification commands

Run these from the VenueMind project root after each completed slice:

```bash
npm test
npm run build
```

Use the narrow suites during development:

```bash
npm run test:domain
npm run test:mcp
npm run test:sites
```

Before marking a milestone complete, also verify the live routes:

```text
/
/docs
/llms.txt
/llms-full.txt
/schemas/venue-command.schema.json
/schemas/planner-snapshot.schema.json
/schemas/project-record.schema.json
```

## Backlog maintenance

- [ ] Mark a checkbox only after its completion gate is satisfied.
- [ ] Add newly discovered work under the owning milestone rather than appending an unstructured tail.
- [ ] Record architecture decisions in `docs/adr/` when a choice changes a durable boundary.
- [ ] Update `CONTEXT.md` when domain language changes.
- [ ] Update generated contracts and agent docs through their generator scripts.
- [ ] Keep deferred submission work in the final milestone.
- [ ] Remove tasks that no longer serve the product instead of preserving stale sediment.
