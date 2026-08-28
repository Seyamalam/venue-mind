# Tool sequence

- `venue.get_project_brief`: read Requirement priority, coverage, ambiguity, and accepted-versus-Proposal state.
- `venue.inspect_layout`: read versions, stable spatial IDs, Locks, and the active branch. Repeat after a version conflict.
- `venue.list_constraints`: discover active checks and parameters before choosing a strategy.
- `venue.search_objects`, then `venue.get_object`: resolve bounded candidates before citing or changing exact objects.
- `venue.preview_revision`: create or refresh one non-destructive Proposal outcome.
- `venue.request_adjustment`: revise the active Proposal from a human instruction.
- `venue.create_proposal_branch`: preserve one strategy while exploring another.
- `venue.detect_proposal_conflicts`: identify stale, deleted, locked, concurrent, and Constraint conflicts.
- `venue.rebase_proposal`: move a conflict-free stale branch to the current Plan Version.
- `venue.validate_layout`: run the deterministic gate.
- `venue.get_validation_evidence`: retrieve object, route, capacity, congestion, or sightline proof for selected Constraint IDs.
- `venue.compare_proposal_branches`: compare two stable Branch IDs and their fingerprints, metrics, and Constraint deltas.
- `venue.get_change_log`: verify authorship and command ordering when history matters.
- `venue.export_plan`: export only when the user requests an artifact.

Mutations require an `idempotencyKey`. The same key and same input return the original Command Receipt; a new intent requires a new key.

The agent tool surface has no acceptance operation. Only the VenueMind human interface can accept a Proposal and create the next Plan Version.
