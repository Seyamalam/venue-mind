---
name: venuemind-event-day
description: Triage VenueMind event-day issues with runbooks, comments, evidence, and supervised layout adjustments. Use for live access, queue, production, capacity, and circulation incidents.
metadata:
  version: 1.2.0
  tool-contract-version: 1.3.0
---

# VenueMind Event Day

Triage live issues against the accepted Plan. VenueMind is not an emergency-response authority.

## Workflow

1. Call `venue.get_project_brief`, `venue.inspect_layout`, and `venue.inspect_live_occupancy`. Record the active Plan Version, Runbook Version, monitor revision, affected stable scope/object IDs, source freshness, active Alerts, Locks, and immediate human owner.
2. Use `venue.ingest_occupancy_signal` only when the user provides or authorizes one aggregate check-in or zone count. Reject person-level fields. Preserve the supplied source ID, source version, observation time, confidence, and one unique `idempotencyKey`.
3. Call `venue.refresh_live_occupancy` when the decision depends on current staleness. Treat nominal, warning, exceeded, conflicting, stale, and unavailable as distinct operational states. Do not infer a safe count from conflicting feeds.
4. Call `venue.search_objects` and `venue.get_object` for the incident location and dependencies. Call `venue.validate_layout` and `venue.get_validation_evidence` for affected Constraints.
5. Call `venue.list_comments`. Use `venue.add_comment` to create a decision-relevant incident record anchored to an object, route, zone, or coordinate when the user requests tracking.
6. For congestion questions, call `venue.list_scenarios`, `venue.run_scenario`, and `venue.get_scenario_result` with current geometry and explicit inputs. Keep observed occupancy, simulation assumptions, and deterministic Validation separate.
7. If the user requests a layout adjustment, call `venue.detect_proposal_conflicts` first when the Proposal base is stale. Then call `venue.request_adjustment` with a unique `idempotencyKey`, validate, and retrieve evidence again.
8. Use `venue.export_live_occupancy` when the user requests the verified aggregate incident artifact. Return severity, observed facts, assumptions, human owner, stable Alert/scope/object/route IDs, current versions, Proposal and Validation IDs, failed checks, and the next human decision.

For immediate danger, direct the operator to the venue emergency plan and local emergency services. Agent tools cannot acknowledge an Occupancy Alert; route acknowledgement to an authenticated human operator in Studio. Never accept a Proposal, resolve an incident without evidence, override a Lock, create a waiver, or silently change the accepted Plan.

Read [generated contracts](references/contracts.md).
