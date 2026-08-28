# ADR 0020: Accepted history is hash chained and replayable

## Status

Accepted

## Context

A visible activity list is insufficient evidence for approvals, Locks, migrations, and accepted Plan changes. VenueMind must detect edited, reordered, inserted, or removed historical entries and prove that accepted history reconstructs current truth.

## Decision

Every Activity Ledger entry carries schema version, monotonic sequence, stable ID, actor identity, source, session, timestamp, previous hash, and content hash. `sealActivityLedger` creates the chain, `verifyActivityLedger` verifies it, and `replayActivityLedger` reconstructs accepted Plan transitions and compares their fingerprint with the current Plan.

Restore, import, audit export, and replay reject a failed chain. Legacy unsealed history may be sealed only through an explicit schema migration whose event remains in the resulting chain.

## Consequences

- Ledger entries are append-only evidence.
- A corrupted record is quarantined instead of silently repaired.
- Accepted undo and redo append transitions rather than erasing history.
- Audit packages bind Plan, Validation, receipts, ledger head, and replay fingerprints.
