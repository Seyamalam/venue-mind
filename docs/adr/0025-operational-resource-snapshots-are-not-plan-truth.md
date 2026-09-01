# ADR 0025: Operational Resource Snapshots are evidence, not Plan truth

## Status

Accepted

## Context

Inventory systems, AV suppliers, caterers, power operations, and staffing platforms change independently of a VenueMind Project. Their availability and booking claims can become stale, can collide across Projects, and can contain external identity data. Mutating Inventory Item Templates or accepted Plan objects directly during synchronization would bypass Project scope, Locks, deterministic Validation, human Approval, immutable Plan Versions, and Activity Ledger replay.

## Decision

VenueMind imports live supply into an immutable, checksum-bound Operational Resource Snapshot tied to one Project, Plan Version, Plan fingerprint, source version, and trusted event window. The Snapshot is a read model outside accepted Plan truth.

An unavailable, double-booked, insufficient, or incompatible accepted Resource Binding creates a separate Operational Resource Conflict. Compatible alternatives remain non-applied Resource Substitution Options. Only an explicit preview selection may translate one Option into a canonical Adapter Staging Batch. The resulting Proposal updates the same Project Object Instance's Resource Binding and must pass ordinary Locks, Validation, stale checks, human Approval, versioning, and ledger rules.

Personnel evidence is reduced to trusted opaque Staff References plus role, shift, assignment, and booking identifiers. Raw provider person IDs and contact data are removed before the adapter runtime computes invocation identity or stores any result.

## Consequences

- Provider synchronization cannot silently replace accepted resources.
- Global Inventory Item Templates remain reusable specifications rather than Project-specific live booking state.
- Conflict and Option evidence is deterministic and auditable for an exact source snapshot.
- Resource freshness must be rechecked when a selected Option is previewed and again before Approval in a production host.
- A Resource Binding update remains subject to role Locks and all normal Proposal lifecycle controls.
