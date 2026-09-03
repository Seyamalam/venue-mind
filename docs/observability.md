# Observability

VenueMind uses a shared, versioned telemetry envelope in the Studio, planner, browser repositories, WebMCP adapters, API Worker, and D1 observability repository. The system works without a paid monitoring provider: the Studio uses a bounded in-memory sink, Workers emit JSON lines, and the durable boundary uses D1.

## Event contract

Every event has exactly these fields:

- `schemaVersion`, currently `1`
- `eventId`, a safe opaque token
- `occurredAt`, an ISO timestamp
- `component`: `client`, `api`, `repository`, `planner`, or `adapter`
- `operation`: one of the bounded operation families in `src/observability/telemetry.ts`
- `outcome`: a bounded lifecycle or terminal result
- `level`, derived from the outcome
- `correlationId`, a safe opaque token propagated across boundaries
- `durationMs`, bounded to one hour or `null`
- `action`, a bounded operation code or `null`
- `errorCode`, a bounded error code or `null`

No extension metadata is accepted. Events never contain request bodies, Project snapshots, plan geometry, names, email addresses, account or session identifiers, authorization values, cookies, tokens, integration credentials, or arbitrary exception messages.

## Correlation

Studio commands create one safe correlation ID. The planner uses it for policy, Validation, command, simulation, conflict, Approval, and ledger spans. The resulting command receipt supplies the same ID to browser persistence, which sends it as `x-correlation-id`. The Worker returns that header and uses it for API and D1 repository spans. Invalid caller-provided correlation values are replaced before logging.

A failed Approval trace therefore has a single correlation ID across:

1. `client / approval`
2. `planner / command`
3. `planner / policy`
4. `planner / validation`
5. `planner / approval`
6. `repository / persistence`
7. `api / request`
8. `repository / persistence`

The Activity Ledger and command receipt remain the authoritative product audit. Telemetry is operational evidence and never substitutes for ledger integrity.

## Metrics and alerts

The health snapshot uses a fixed 15-minute window and bounded event storage. It reports samples, failures, failure rate, operation latency, conflicts, Approval outcomes, integrity failures, and recent safe correlation IDs.

Alerts are deterministic:

- `FAILURE_RATE_HIGH`: at least five terminal samples and a failure rate of 20% or greater.
- `INTEGRITY_FAILURE`: one or more failed integrity checks.

There are no per-user, per-Project, or arbitrary-label metric dimensions. This prevents identity leakage and unbounded metric cardinality.

## Surfaces

- Studio: `HEALTH` opens the lazy, non-modal diagnostics sheet. Labels are operational codes only.
- Worker: authenticated `GET /api/diagnostics/health` returns the bounded aggregate.
- Worker: authenticated `GET /api/diagnostics/traces/:correlationId` returns at most 100 safe events.
- Worker logs: one JSON object per event.

## Storage and retention

Migration `0015_observability.sql` adds `observability_events`. D1 records only the exact event envelope plus a one-way Organization scope hash for tenant isolation. Inserts prune records older than seven days, queries are capped at 2,048 events per health window, trace results are capped at 100 events, and the browser retains at most 256 events. Sink failures are isolated from product operations.

## Local verification

Run the focused observability, planner, persistence, Worker, migration, and UI tests, followed by typecheck, lint, Worker build, and generated-artifact drift checks. GitHub Actions and external monitoring services are not required.
