---
name: venuemind-event-day
description: Triage VenueMind event-day issues with runbooks, comments, evidence, and supervised layout adjustments. Use for live access, queue, production, capacity, and circulation incidents.
metadata:
  version: 1.3.0
  tool-contract-version: 1.4.0
---

# VenueMind Event Day

Triage live issues against the accepted Plan. VenueMind is not an emergency-response authority.

## Workflow

1. Call `venue.get_project_brief`, `venue.inspect_layout`, `venue.inspect_live_occupancy`, and `venue.inspect_incidents`. Record the active Plan Version, Runbook Version, monitor and Incident Register revisions, affected stable scope/object/Incident IDs, source freshness, active Alerts, Locks, and immediate human owner.
2. Use `venue.ingest_occupancy_signal` only when the user provides or authorizes one aggregate check-in or zone count. Reject person-level fields. Preserve the supplied source ID, source version, observation time, confidence, and one unique `idempotencyKey`.
3. Call `venue.refresh_live_occupancy` when the decision depends on current staleness. Treat nominal, warning, exceeded, conflicting, stale, and unavailable as distinct operational states. Do not infer a safe count from conflicting feeds.
4. Call `venue.search_objects` and `venue.get_object` for the incident location and dependencies. Call `venue.validate_layout` and `venue.get_validation_evidence` for affected Constraints.
5. Call `venue.report_incident` when the user requests a new structured issue record. Supply one fixed uppercase summary code, severity, category, an accepted-Plan object or in-room coordinate, relevant stable references, and a unique `idempotencyKey`. Use `venue.add_comment` only for collaboration discussion; a Comment is not an Operational Incident.
6. For congestion questions, call `venue.list_scenarios`, `venue.run_scenario`, and `venue.get_scenario_result` with current geometry and explicit inputs. Keep observed occupancy, simulation assumptions, and deterministic Validation separate.
7. If the user requests a layout adjustment, call `venue.detect_proposal_conflicts` first when the Proposal base is stale. Then call `venue.request_adjustment` with a unique `idempotencyKey`, validate, and retrieve evidence again.
8. Use `venue.export_live_occupancy` for the verified aggregate monitor artifact and `venue.export_incident_record` for one verified Operational Incident. Return severity, observed facts, assumptions, human owner, stable Alert/scope/object/route/Incident IDs, current versions, Proposal and Validation IDs, failed checks, and the next human decision.

For immediate danger, direct the operator to the venue emergency plan and local emergency services. Agent tools cannot acknowledge an Occupancy Alert or acknowledge, escalate, own, hand off, attach evidence to, act on, resolve, close, or reopen an Operational Incident. Route those actions to an authenticated human operator in Studio. Never accept a Proposal, override a Lock, create a waiver, or silently change the accepted Plan.

Read [generated contracts](references/contracts.md).
