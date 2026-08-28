# ADR 0022: Project revisions and Recovery Branches

Status: accepted

## Decision

Use server-assigned Project Record Revisions and strong ETags as the concurrency boundary for complete Project records. Create-only writes use `If-None-Match: *`; updates require `If-Match`. D1 updates use a unique write token so metadata compare-and-swap and snapshot replacement share one guarded batch.

Use a bounded three-way merge only when base/local/remote field changes do not overlap. Treat concurrent `snapshot` or `activePlanId` changes as planning conflicts. Preserve the local record in Organization-scoped recovery storage and let a human convert its Proposal into an auditable Recovery Branch on current remote truth.

## Consequences

No browser session, API client, or delayed write can silently overwrite a newer Project record. Independent metadata and planning changes can converge without prompting. Competing planning edits remain reviewable through VenueMind's existing Proposal conflict, rebase, Validation, and Approval system. Project Record Revisions remain separate from Plan Versions and Proposal revisions.
