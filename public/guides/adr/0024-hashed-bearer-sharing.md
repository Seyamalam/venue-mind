# ADR 0024: Hashed bearer capabilities for bounded sharing

Status: accepted

## Decision

Represent public sharing as expiring, revocable bearer capabilities. Return a 256-bit token once, persist only its SHA-256 hash, and resolve it at request time. Support two scopes: accepted-Plan read-only access and one-Proposal reviewer access. Keep public views outside Organization membership and keep Approval, mutation, and access to other Proposals unavailable.

Record Share Link creation and revocation in the Project Activity Ledger through human-only planner commands. Store operational link metadata separately with a recoverable lifecycle: `pending-create`, `active`, `pending-revoke`, or `revoked`. A pending create remains inaccessible until its creation ledger transition is durable; pending revocation denies access before its revocation ledger transition is completed. Reconcile unfinished operations idempotently on Share Link access and scheduled maintenance.

Retain the exact Proposal revision selected for a Reviewer Share Link. Public resolution returns that pinned review artifact even when the authenticated Project later edits or replaces its live Proposal.

Represent review notifications with fixed body codes and an allowlist of stable references. Apply per-User channel and event-type preferences when creating delivery records, including persisted in-app visibility.

Deliver email through a leased outbox and an injected provider using the stable outbox ID as an idempotency key. Mark an item delivered only after the provider reports success. On failure, retain the item for retry with bounded attempt metadata and a safe failure code.

## Consequences

A leaked token grants its bounded view until expiry or revocation, so links receive a maximum 30-day lifetime and operators can revoke them immediately. The raw token cannot be recovered from the database, link listing, Activity Ledger, or Notification records; losing it requires replacement. Reviewer links remain bound to the Proposal ID and retained revision selected at creation even if that Proposal is edited or another Proposal becomes active.

Public responses are intentionally smaller than authenticated Project records. External reviewers cannot approve, request adjustment, comment, inspect the Activity Ledger, or enumerate Organization resources through the capability. Notification transports can render useful destinations from stable references without copying sensitive event narrative or geometry into delivery systems.

Share Link mutations span the operational link store and the Project Activity Ledger, which do not share a transaction. Durable pending states and idempotent reconciliation make that boundary recoverable instead of treating a partial write as success. Email transport is at-least-once at the provider boundary; provider idempotency prevents a retry from becoming duplicate mail, and `delivered_at` remains evidence of confirmed provider success.
