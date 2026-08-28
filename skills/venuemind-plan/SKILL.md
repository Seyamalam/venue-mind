---
name: venuemind-plan
description: Plan and validate supervised, non-destructive venue revisions. Use for seating, access, circulation, sightlines, production, catering, capacity, or queue changes in VenueMind.
metadata:
  version: 1.1.0
  tool-contract-version: 1.2.0
---

# VenueMind Plan

Keep the accepted Plan unchanged. Prepare evidence-backed Proposals for human review.

## Workflow

1. If no Project is active, call `venue.list_projects`, then `venue.open_project` with the chosen stable Project ID.
2. Call `venue.get_project_brief`, `venue.inspect_layout`, and `venue.list_constraints`. Retain Requirement IDs, ambiguity flags, stable object IDs, the active Plan Version, Proposal base version, and effective Locks.
3. Use `venue.search_objects` and `venue.get_object` only when the outcome needs exact object geometry, metadata, or effective Lock details.
4. Convert the request into measurable conditions. Stop for human disposition when a high-priority measurable Requirement is ambiguous.
5. Give every intended mutation a new `idempotencyKey`. Reuse it only for an exact retry.
6. If the Proposal base is stale, call `venue.detect_proposal_conflicts`. Call `venue.rebase_proposal` only when no blocking conflict remains.
7. Call `venue.create_proposal_branch` for a distinct strategy. Otherwise call `venue.preview_revision` or `venue.request_adjustment` on the active branch.
8. Call `venue.validate_layout`, then `venue.get_validation_evidence` for decision-relevant Constraints. A review-ready Proposal has `status: pass`, no hard failures, and no unexplained warnings.
9. When two strategies matter, call `venue.compare_proposal_branches` with stable Branch IDs.
10. Return the Project ID, Plan Version, Proposal and Branch IDs, changed object IDs, Validation ID and fingerprint, relevant Constraint results, and the Command Receipt. The next action is human review in VenueMind.

Never accept a Proposal, create a human waiver, override a Lock, or claim the Plan changed. Failed and incomplete evidence stays visible.

Read [tool sequence](references/tool-sequence.md) for call selection and [generated contracts](references/contracts.md) for current schemas.
