# ADR 0025: Operational Resource Snapshots are evidence, not Plan truth

## Status

Accepted

## Context

Inventory systems, AV suppliers, caterers, power operations, and staffing platforms change independently of a VenueMind Project. Their availability and booking claims can become stale, can collide across Projects, and can contain external identity data. Mutating Inventory Item Templates or accepted Plan objects directly during synchronization would bypass Project scope, Locks, deterministic Validation, human Approval, immutable Plan Versions, and Activity Ledger replay.

## Decision

VenueMind imports live supply into an immutable, checksum-bound Operational Resource Snapshot tied to one Project, Plan Version, Plan fingerprint, source version, and trusted event window. The Snapshot is a read model outside accepted Plan truth.

An unavailable, double-booked, insufficient, or incompatible accepted Resource Binding creates a separate Operational Resource Conflict. Capacity is reconciled across the complete demand set rather than per demand. Direct demand, including an unresolved shortfall, is reserved before replacement capacity. Compatible alternatives remain non-applied Resource Substitution Options, and an alternative's finite capacity cannot be advertised to more conflicts than it can serve. The minimal translator deterministically assigns at most one viable alternative per conflict in scarcity order, and advertises only single-target inventory, AV, and catering substitutions; other conflict families require dedicated translators. Only an explicit preview selection may translate one Option into a canonical Adapter Staging Batch.

Preview requires a host-owned resolver that returns the latest trusted Snapshot for the Project. Approval independently requires a host-owned freshness verifier whose latest Snapshot ID and checksum match the Proposal evidence. These runtime authorities are injected by the server and are not serializable command input. The resulting Proposal updates the same Project Object Instance's Resource Binding and must pass ordinary Locks, Validation, stale checks, human Approval, versioning, and ledger rules.

Personnel evidence is reduced to server-owned 128-bit hexadecimal `staff-ref-*` references plus exact role-and-shift assignment pairs and booking identifiers. Raw provider person IDs and contact data are removed before the adapter runtime computes invocation identity or stores any result.

## Consequences

- Provider synchronization cannot silently replace accepted resources.
- Global Inventory Item Templates remain reusable specifications rather than Project-specific live booking state.
- Conflict and Option evidence is deterministic and auditable for an exact source snapshot.
- Resource freshness is enforced when a selected Option is previewed and again before Approval; a host that does not inject the trusted resolver/verifier fails closed.
- A Resource Binding update remains subject to role Locks and all normal Proposal lifecycle controls.
