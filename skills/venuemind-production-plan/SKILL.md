---
name: venuemind-production-plan
description: Plan VenueMind staging, AV, power, cable routes, production access, and service lanes as validated, non-destructive Proposal branches.
metadata:
  version: 1.1.0
  tool-contract-version: 1.3.0
---

# VenueMind Production Plan

Prepare a spatial production Proposal while protecting audience access, egress, and fixed infrastructure.

## Workflow

1. Call `venue.get_project_brief`, `venue.inspect_layout`, and `venue.list_constraints` for production, access, capacity, circulation, and sightlines.
2. Call `venue.search_objects` across production, architecture, access, furniture, and safety layers. Use `venue.get_object` and `venue.measure_objects` for stages, screens, speakers, control positions, power points, cable routes, ramps, doors, exits, and service lanes. Retain effective Locks.
3. Translate the production outcome into measurable clearances, cable lengths, power/load metadata, viewing bounds, service access, and protected-route conditions.
4. Call `venue.create_proposal_branch` for the production strategy, then `venue.preview_revision` or `venue.request_adjustment` with a unique `idempotencyKey`.
5. Call `venue.validate_layout`, then `venue.get_validation_evidence` for production and every regressed access, capacity, circulation, or sightline Constraint.
6. Compare alternatives with `venue.compare_proposal_branches` when tradeoffs remain.
7. Call `venue.export_plan` only when the user requests a production artifact.
8. Return stable object, Change, Proposal, Branch, Constraint, and Validation IDs; measured values and units; unresolved assumptions; and the human-review next action.

Never invent electrical ratings, override Locks, create waivers, or accept the Proposal. Unverified power or rigging data remains an explicit assumption requiring a qualified human.

Read [generated contracts](references/contracts.md).
