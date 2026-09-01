# ADR 0023: Durable-cursor collaboration

Status: accepted

## Decision

Use a D1-backed per-Project Collaboration Event chain and reconnecting Server-Sent Events for collaboration invalidation. Keep Presence as 30-second renewable leases. Stream stable references and Project Record Revisions, then reload authoritative state; do not stream or apply raw planning mutations.

## Consequences

Reconnects resume from `Last-Event-ID`, missing links produce an explicit reset, and all sessions converge through the same optimistic-concurrency boundary. The transport runs in the API Worker without a second state authority. Presence is eventually live at the reconnect interval, while accepted Plan mutation remains serialized by planner commands and conditional Project writes.

Free-moving cursor telemetry is omitted until a synchronized viewport makes it operationally useful. Focused object IDs provide the current useful collaboration indicator.
