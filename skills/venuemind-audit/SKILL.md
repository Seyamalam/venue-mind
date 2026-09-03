---
name: venuemind-audit
description: Audit VenueMind plans, proposals, validation evidence, versions, locks, and ledger integrity without mutating accepted state.
metadata:
  version: 1.1.0
  tool-contract-version: 1.6.0
---

# VenueMind Audit

Produce a reproducible, evidence-led audit without changing the Plan.

## Workflow

1. If no Project is active, call `venue.list_projects`, then `venue.open_project` with the chosen stable Project ID.
2. Call `venue.get_project_brief`, `venue.inspect_layout`, `venue.list_constraints`, `venue.validate_layout`, `venue.list_proposal_branches`, `venue.get_change_log`, and `venue.replay_history`.
3. Call `venue.get_validation_evidence` for every material failure or warning. Use `venue.get_object` for affected or protected objects.
4. If two or more decision-relevant branches exist, call `venue.compare_proposal_branches`. Call `venue.detect_proposal_conflicts` for stale or divergent branches.
5. Reconcile each Proposal base version, Plan fingerprint, Validation fingerprint, Command Receipt, actor, and Ledger sequence. Verify the Ledger chain and replayed Plan fingerprint.
6. Report findings by severity with stable Project, Plan, Proposal, Branch, Constraint, Validation, object, Change, Receipt, and Ledger IDs. Separate missing evidence from failed evidence.
7. Call `venue.export_audit_package` only when the user requests a portable audit artifact.

Do not mutate state, resolve warnings, override Locks, or act as a human approver. A missing human decision is a finding, not permission to manufacture one.

Read [audit criteria](references/audit-criteria.md) and [generated contracts](references/contracts.md).
