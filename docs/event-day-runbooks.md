# Event Day Runbooks

Event Day Runbook Mode turns one accepted, validated Plan Version into a frozen operational baseline. It tracks live work without changing the Plan, Proposal, Project snapshot, or planning Activity Ledger.

## Boundary

A Runbook Version records the exact Project, Plan ID and Version, Plan and Event Brief fingerprints, Validation ID and input fingerprint, accepted-history ledger entry, and source ledger head. Its baseline is immutable. Accepting another Plan creates another Runbook Version.

The Runbook is a separate aggregate because task transitions can be frequent, concurrent, and offline. Each task owns a revision. A transition for one task cannot conflict with an unrelated planning save or another task.

## Phases and tasks

Every version has six ordered phases:

1. `setup`
2. `doors`
3. `live-event`
4. `interval`
5. `egress`
6. `breakdown`

Tasks carry stable IDs, a workstream, structured owner references, dependency task IDs, Plan object IDs, required evidence codes, status, and task revision. Readiness is derived: every dependency must be `completed`; a skipped dependency does not silently unblock work.

The ordinary transition graph is:

```text
pending -> in-progress | blocked | skipped
in-progress -> completed | blocked
blocked -> in-progress | skipped
```

Skipping requires a reason code. Completing a task requires every declared structured evidence code. Terminal work can be reopened only by a reason-coded human operation.

## Offline operation

The browser caches each Runbook Version and its outbox in IndexedDB. One user action creates one immutable operation ID, idempotency key, client ID, client sequence, and client occurrence time. Every retry sends the same command.

The server assigns authoritative commit time and order. In one transaction it checks the idempotency receipt, compares the expected task revision, advances the task projection, appends the transition, stores the receipt, and extends the Runbook Ledger.

The authenticated HTTP boundary is:

- `POST /api/projects/:projectId/runbooks` creates or exactly retries a frozen browser-shaped Runbook.
- `GET /api/projects/:projectId/runbooks/:runbookVersionId` returns the authoritative browser-shaped projection.
- `POST /api/projects/:projectId/runbooks/:runbookVersionId/transitions:sync` processes up to 100 original commands in client order and returns one acknowledgement per command plus the final projection.

Create and synchronize require a Planner, Venue Administrator, or Organization Administrator role. Reads require active membership and remain Organization scoped. The server replaces claimed actor, source, and session metadata with the authenticated human, Studio source, and server session before writing audit state.

Batch acknowledgements are explicit:

- `applied` and `already-applied` remove the local operation.
- `conflict` and `rejected` remain in the outbox for review.
- an unknown result never removes local evidence.

A repeated key with identical semantic input returns the original receipt, including after authentication-session rotation. Authority metadata is recorded from the first accepted operation but is not part of its offline semantic fingerprint. The same key with changed task intent fails with `IDEMPOTENCY_KEY_CONFLICT`. A stale task update fails with `RUNBOOK_TASK_REVISION_CONFLICT`; last-write-wins is never used.

## Ledger and handoff

The Runbook Ledger is a per-Runbook hash chain whose genesis links to the accepted Plan Activity Ledger head. Device time is retained as evidence, but ledger sequence and server commit time define audit order.

A shift handoff is a deterministic projection at one ledger sequence. It contains sorted task IDs for pending, active, blocked, completed, skipped, overdue, and evidence-gap work plus structured assignment references. It is not editable narrative.

## Export

The Runbook JSON export preserves the complete aggregate. The audit export includes source truth, frozen definition, current task projection, transitions, receipts, deterministic handoff, ledger integrity result, and the full Runbook Ledger. Export is read-only and rejects a failed ledger chain.

## Agent boundary

Studio and agent runtimes share read operations for inspection, task listing, change-log inspection, and export. Agent task mutation remains unavailable until dedicated event-day permissions can prove the acting user, operational role, session, and device authority. Human Approval remains exclusively in the planning aggregate.
