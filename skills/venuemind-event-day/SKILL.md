---
name: venuemind-event-day
description: Triage VenueMind event-day issues with runbooks, comments, evidence, and supervised layout adjustments. Use for live access, queue, production, capacity, and circulation incidents.
metadata:
  version: 1.1.0
  tool-contract-version: 1.2.0
---

# VenueMind Event Day

Triage live issues against the accepted Plan. VenueMind is not an emergency-response authority.

## Workflow

1. Call `venue.get_project_brief` and `venue.inspect_layout`. Record the active Plan Version, current Proposal base, event phase, affected stable IDs, Locks, and immediate human owner.
2. Call `venue.search_objects` and `venue.get_object` for the incident location and dependencies. Call `venue.validate_layout` and `venue.get_validation_evidence` for affected Constraints.
3. Call `venue.list_comments`. Use `venue.add_comment` to create a decision-relevant incident record anchored to an object, route, zone, or coordinate when the user requests tracking.
4. For congestion questions, call `venue.list_scenarios`, `venue.run_scenario`, and `venue.get_scenario_result` with current geometry and explicit inputs. Keep simulation separate from observed facts.
5. If the user requests a layout adjustment, call `venue.detect_proposal_conflicts` first when the Proposal base is stale. Then call `venue.request_adjustment` with a unique `idempotencyKey`, validate, and retrieve evidence again.
6. Return severity, observed facts, assumptions, immediate human owner, stable incident/object/route IDs, current version, Proposal and Validation IDs, failed checks, and the next human decision.

For immediate danger, direct the operator to the venue emergency plan and local emergency services. Never accept a Proposal, resolve an incident without evidence, override a Lock, create a waiver, or silently change the accepted Plan.

Read [generated contracts](references/contracts.md).
