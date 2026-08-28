# ADR 0024: Hashed bearer capabilities for bounded sharing

Status: accepted

## Decision

Represent public sharing as expiring, revocable bearer capabilities. Return a 256-bit token once, persist only its SHA-256 hash, and resolve it at request time. Support two scopes: accepted-Plan read-only access and one-Proposal reviewer access. Keep public views outside Organization membership and keep Approval, mutation, and access to other Proposals unavailable.

Record Share Link creation and revocation in the Project Activity Ledger through human-only planner commands. Store operational link metadata separately so revocation takes effect immediately without rewriting accepted Plan truth.

Represent review notifications with fixed body codes and an allowlist of stable references. Apply per-User channel and event-type preferences before creating in-product records or email-outbox entries.

## Consequences

A leaked token grants its bounded view until expiry or revocation, so links receive a maximum 30-day lifetime and operators can revoke them immediately. The raw token cannot be recovered from the database, link listing, Activity Ledger, or Notification records; losing it requires replacement. Reviewer links remain bound to the Proposal ID selected at creation even if another Proposal becomes active.

Public responses are intentionally smaller than authenticated Project records. External reviewers cannot approve, request adjustment, comment, inspect the Activity Ledger, or enumerate Organization resources through the capability. Notification transports can render useful destinations from stable references without copying sensitive event narrative or geometry into delivery systems.
