# ADR 0030: Post-event Reviews Freeze Operational Evidence

- Status: accepted
- Date: 2026-09-03

## Context

Event-day evidence is distributed across the accepted Plan, Event Day Runbook, live occupancy, incidents, Live Plan Deviations, and completed scenario runs. Retrospective analysis must compare forecasts with observed outcomes without rewriting any of those source records. Lessons may suggest reusable template improvements, but a retrospective must not silently publish a new template or mutate the accepted Plan.

## Decision

Bind one Post-event Review to one Runbook Version. At creation, freeze the exact source aggregates, their fingerprints, and their ledger heads. Predictions must cite that frozen evidence. Record at most one structured Observation per prediction, then derive deterministic Comparisons using the prediction's direction and absolute or relative tolerance. Missing or unavailable observations produce `insufficient-evidence`, never an inferred outcome.

Record Lessons as structured codes linked to a Comparison and stable Requirement and Constraint IDs from the accepted baseline. A Template Improvement Proposal may trace each proposed Change to Lessons, Comparisons, and observed evidence. It is a normal planning Proposal in review state. Only a human may approve or reject the recommendation, approval never publishes the template, and neither decision mutates the accepted Plan.

Keep every mutation revision-checked, exactly idempotent, and in a hash-chained ledger anchored to the Deviation Register ledger head. Generate JSON or plain-text reports on demand from verified state; do not persist report blobs.

## Consequences

- Retrospective claims remain reproducible against exact event-day evidence.
- Prediction gaps are explicit and cannot seed template changes as if observed.
- Human-reviewed learning enters the ordinary planning lifecycle without a privileged publishing path.
- Accepted Plan and template truth remain unchanged by review operations.
- Reports require no object storage and can be regenerated after integrity verification.
