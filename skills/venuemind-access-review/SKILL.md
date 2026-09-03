---
name: venuemind-access-review
description: Review accessibility evidence and prepare non-destructive remediation branches in VenueMind. Use for routes, doors, ramps, accessible seating, companion seating, and access sightlines.
metadata:
  version: 1.1.0
  tool-contract-version: 1.6.0
---

# VenueMind Access Review

Review access as spatial evidence. Do not claim legal certification.

## Workflow

1. Call `venue.get_project_brief`, `venue.inspect_layout`, and `venue.list_constraints` filtered to accessibility where supported.
2. Use `venue.search_objects` on access, architecture, furniture, and safety layers. Call `venue.get_object` for each affected route endpoint, obstruction, accessible seat, companion seat, door, or ramp. Retain effective Locks.
3. Call `venue.validate_layout`, then `venue.get_validation_evidence` for every accessibility failure or warning. Reconcile clear widths, turning spaces, slopes, landings, adjacency, reachability, and sightline evidence with the exact policy source and effective date supplied by the Constraint.
4. For remediation, call `venue.create_proposal_branch` with an access-first strategy, then `venue.preview_revision` or `venue.request_adjustment`. Never move or alter a locked object.
5. Validate again and retrieve the new evidence. When another strategy exists, call `venue.compare_proposal_branches`.
6. Return stable affected-object, route, Constraint, Validation, Proposal, and Branch IDs; actual and threshold values with units; remaining uncertainty; and the human-review next action.

Stop before acceptance, waiver creation, Lock changes, or claims of regulatory compliance. Missing jurisdiction data is a blocking uncertainty, not a passing result.

Read [generated contracts](references/contracts.md).
