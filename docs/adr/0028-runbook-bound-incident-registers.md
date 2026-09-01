# ADR 0028: Bind Incident Registers to Event Day Runbook Versions

- Status: accepted
- Date: 2026-09-02

## Context

Operational issues occur against a specific event-day baseline. Binding them only to a mutable Project snapshot would make later Plan revisions silently change the meaning of locations, emergency actions, and evidence. Treating Live Occupancy Alerts as Incidents would also collapse sensor-derived state and human operational response into one ambiguous model.

## Decision

Create one Incident Register per active Event Day Runbook Version. Freeze the accepted Plan, Validation, Approval, Emergency Plan, and Runbook ledger head in the register baseline. Keep Occupancy Alerts as linkable evidence. Require every Incident transition to carry the frozen Plan identity and either a stable Plan-object anchor or an in-room coordinate.

Store the register aggregate in tenant-scoped D1 and private evidence bytes in R2. Keep object keys and bytes outside the aggregate, ledger, exports, WebMCP, and MCP. Give agents only inspect, report, and export tools; keep operational response authority human-only.

## Consequences

- Post-event records remain interpretable after later Plan changes.
- Every transition is replayable, revision-checked, idempotent, and hash chained.
- Occupancy monitoring and Incident response remain separate but linkable.
- Evidence upload requires an online authenticated path and compensating object deletion when the aggregate write fails.
- A new Runbook Version receives a new Incident Register instead of mutating the old baseline.
