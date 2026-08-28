# ADR 0002: Durable project state with local recovery

## Status

Accepted

## Context

VenueMind Projects contain accepted Plan Versions, active Proposals, Proposal Branches, validation evidence, and the Activity Ledger. Losing that state would make approval history and exported evidence unreliable. The Studio also needs to remain useful during a temporary network or service interruption.

## Decision

The deployed application stores Project records in D1 through a versioned `/api/projects` boundary. The browser maintains a local recovery copy of the latest record and may restore from it when the remote store is unavailable. Every record carries an explicit schema version, stable Project ID, and update timestamp.

D1 is the durable source of truth. Browser storage is a recovery cache, not a second authority. The Studio exposes whether the current state is synchronized, saved remotely, or local-only.

## Consequences

- Plan history and Activity Ledger evidence survive browser reloads and device-local cache loss.
- Local work can continue through a transient remote failure.
- Schema migrations must preserve stable IDs and accepted Plan Versions.
- Conflict handling must never silently replace a newer durable record with an older recovery copy.
