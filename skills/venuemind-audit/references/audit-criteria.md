# Audit criteria

## Safety

- Every high-priority measurable Requirement maps to Constraint evidence or an explicit human disposition.
- Event Brief ambiguity and coverage counts reconcile with the listed stable Requirement IDs.
- Every locked object retains its stable ID and protected status.
- Accessibility, capacity, sightline, circulation, and congestion checks expose actual and threshold values.
- Route Graph evidence names reachable destinations, bottleneck widths, and shortest exit paths; sightline evidence names sampled seats, focal points, and obstructions.
- Capacity evidence reconciles section counts, density capacity, non-attendee load, venue maximum, and effective capacity.
- `blockingIssues` equals failed error-severity checks; `unresolvedIssues` equals failed checks plus warnings without an active Warning Waiver.
- Every warning excluded from `unresolvedIssues` has a human Warning Waiver matching its Constraint ID, Proposal, base version, and Validation input fingerprint.
- Approved Plan Warning Waivers retain author, reason code, timestamp, and accepted Plan Version.

## Concurrency

- A Proposal names one `baseVersion`.
- Approval advances exactly one Plan Version.
- A branch based on an older version is stale until refreshed.
- A branch decision should cite one deterministic comparison ID plus its Constraint improvements, regressions, metric deltas, and geometry fingerprints.

## Supervision

- Agent entries may inspect, preview, validate, branch, switch, read, or export.
- `proposal.approved` entries are human-authored.
- Undo and redo remain explicit Activity Ledger entries.

## Traceability

- Ledger sequence numbers are ordered and stable.
- Ledger hashes form an unbroken chain from `genesis` to the exported head hash.
- Replayed accepted Plan transitions match the current Plan fingerprint.
- Mutating ledger entries reference a Command Receipt, correlation ID, idempotency key, and input fingerprint.
- Findings cite Plan, Proposal, Branch, Change, and locked-object IDs rather than visual position alone.
