# ADR 0029: Runbook-bound Deviations Derive Operational Overlays

- Status: accepted
- Date: 2026-09-03

## Context

Event-day teams must record emergency spatial Changes without making the approved Plan claim that those Changes were historically approved. Rewriting the Plan would destroy audit truth, while treating every operational action as a Proposal would misrepresent an action already taken under live conditions.

## Decision

Bind one Live Plan Deviation Register to one active Event Day Runbook Version and freeze its accepted Plan, Brief, Validation, Approval, and ledger provenance. Record each deviation as an append-only, revision-checked operational transition with exact actor, accepted time, Plan-bound location, affected-object lineage, and deterministic Validation against the Constraints available live. Derive the Active Plan Overlay by replaying active deviations in stable sequence; never persist it as accepted Plan truth.

A failed live Validation remains blocking evidence but does not erase or reject the record of an operational action that occurred. The register preserves what happened; authorization and incident-response policy govern whether an action may be taken.

Distinguish Temporary Deviations from Revision-candidate Deviations at record time. Only revision candidates can seed a normal post-event Proposal, and that Proposal still follows ordinary review, Validation, and human Approval before it can create a Plan Version.

## Consequences

- Accepted Plan history remains immutable and independently verifiable.
- Live operators and agents share one command seam and one deterministic overlay.
- Partial live Constraint availability is explicit evidence, not a silent pass.
- Ending a deviation removes its effect from the overlay without deleting its history.
- Retained event-day learning enters planning through the existing Proposal process rather than a privileged operational shortcut.
