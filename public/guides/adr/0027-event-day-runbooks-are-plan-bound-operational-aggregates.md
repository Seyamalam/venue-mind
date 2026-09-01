# ADR 0027: Event Day Runbooks are Plan-bound operational aggregates

## Status

Accepted

## Context

Event-day task transitions are frequent, concurrent, and often created offline. Project persistence currently protects one complete planning snapshot with a Project Record Revision. Storing live task state in that snapshot would make unrelated planning saves and independent task transitions conflict, and could turn retry behavior into last-write-wins data loss.

## Decision

An Event Day Runbook is a separate durable aggregate linked immutably to one accepted Plan Version, Plan fingerprint, Event Brief fingerprint, Validation input fingerprint, Approval ledger entry, and Activity Ledger head.

A Runbook Version freezes its definition and accepted baseline. Runtime task transitions never mutate or retarget that baseline. A later accepted Plan creates a new Runbook Version.

Each task has a stable ID and independent revision. Every transition supplies an expected task revision and stable idempotency key. The server atomically advances the task projection, appends the transition, stores its receipt, and extends a Runbook-specific hash chain anchored to the source Activity Ledger head. Exact retries return the original receipt. Stale task revisions and changed input under a reused key fail explicitly.

Offline clients retain the original commands in an IndexedDB outbox. Device timestamps are evidence only; server sequence and commit time establish authoritative order. Handoffs are deterministic structured projections at one ledger sequence, not editable narrative.

Planning and agent read surfaces may inspect and export Runbooks. Agent mutation remains unavailable until dedicated event-day permissions, actor identity, and device authority exist.

## Consequences

- Live operations do not contend with Proposal or Project metadata saves.
- Runbook history can be replayed and audited without inflating the planning Activity Ledger.
- Offline retries can converge exactly once without trusting device order or time.
- Accepted Plan truth remains unchanged throughout event-day operation.
- Runbook persistence, sync, permissions, and exports require dedicated boundaries.
