---
name: venuemind-event-day
description: Triage VenueMind event-day issues with runbooks, comments, evidence, and supervised layout adjustments. Use for live access, queue, production, capacity, and circulation incidents.
metadata:
  version: 1.4.0
  tool-contract-version: 1.6.0
---

# VenueMind Event Day

Triage live issues against the accepted Plan. VenueMind is not an emergency-response authority.

## Workflow

1. Call `venue.get_project_brief`, `venue.inspect_layout`, `venue.inspect_live_occupancy`, `venue.inspect_incidents`, and `venue.inspect_live_plan_deviations`. Record the active Plan Version, Runbook Version, monitor, Incident Register, and Deviation Register revisions, affected stable scope/object/Incident/Deviation IDs, source freshness, active Alerts, Locks, and immediate human owner.
2. Use `venue.ingest_occupancy_signal` only when the user provides or authorizes one aggregate check-in or zone count. Reject person-level fields. Preserve the supplied source ID, source version, observation time, confidence, and one unique `idempotencyKey`.
3. Call `venue.refresh_live_occupancy` when the decision depends on current staleness. Treat nominal, warning, exceeded, conflicting, stale, and unavailable as distinct operational states. Do not infer a safe count from conflicting feeds.
4. Call `venue.search_objects` and `venue.get_object` for the incident location and dependencies. Call `venue.validate_layout` and `venue.get_validation_evidence` for affected Constraints.
5. Call `venue.report_incident` when the user requests a new structured issue record. Supply one fixed uppercase summary code, severity, category, an accepted-Plan object or in-room coordinate, relevant stable references, and a unique `idempotencyKey`. Use `venue.add_comment` only for collaboration discussion; a Comment is not an Operational Incident.
6. For congestion questions, call `venue.list_scenarios`, `venue.run_scenario`, and `venue.get_scenario_result` with current geometry and explicit inputs. Keep observed occupancy, simulation assumptions, and deterministic Validation separate.
7. If the user requests a layout adjustment, call `venue.detect_proposal_conflicts` first when the Proposal base is stale. Then call `venue.request_adjustment` with a unique `idempotencyKey`, validate, and retrieve evidence again.
8. When operations require a temporary spatial Change, call `venue.record_live_plan_deviation` with one accepted-Plan location, exact affected object IDs, the available live Constraint IDs, disposition, reason code, and a unique `idempotencyKey`. Never rewrite the approved Plan. End the record with `venue.end_live_plan_deviation` when the operational condition ends.
9. After the event, call `venue.create_post_event_deviation_proposal` only for ended `revision-candidate` records worth retaining. The result is a normal review-state Proposal; do not accept it or imply Approval.
10. For a prepared Post-event Review, call `venue.inspect_post_event_review` before recording outcomes. Use `venue.record_post_event_observation` with exact evidence references, then `venue.record_post_event_lesson` with frozen Requirement or Constraint IDs. Create a Template Improvement Proposal only with `venue.create_template_improvement_proposal`, tracing every Change to observed Lessons. The result stays pending human review and is never published by an agent.
11. Use `venue.export_live_occupancy`, `venue.export_incident_record`, `venue.export_live_plan_deviations`, and `venue.export_post_event_report` for verified operational artifacts. Return severity, observed facts, assumptions, human owner, stable Alert/scope/object/route/Incident/Deviation/Lesson IDs, current revisions, Proposal and Validation IDs, failed checks, and the next human decision.

For immediate danger, direct the operator to the venue emergency plan and local emergency services. Agent tools cannot acknowledge an Occupancy Alert; manage an Operational Incident; or approve, reject, or publish a Template Improvement Proposal. Route those actions to an authenticated human operator in Studio. Never accept a Proposal, override a Lock, create a waiver, or silently change the accepted Plan.

Read [generated contracts](references/contracts.md).
