# Event-day incidents

VenueMind stores one Incident Register for each active Event Day Runbook Version. The register freezes the accepted Plan, Validation, Approval, Emergency Plan, and Runbook ledger head used by operations.

## Operational loop

1. Create or load the register for the active Runbook Version.
2. Report an Operational Incident with severity, category, fixed summary code, and a Plan-object or in-room coordinate anchor.
3. Assign an operational role and acknowledge the Incident.
4. Escalate, relocate, hand off, attach private evidence, or record an authorized emergency action as conditions change.
5. Resolve only after acknowledgement and ownership; close after review. Reopening is human-only and reason-coded.
6. Export the verified Incident record after the event.

Every accepted mutation increments the Incident and register revisions and appends exactly one transition, receipt, and globally ordered hash-chained ledger entry. The ledger records one actor, one server-accepted timestamp, and the current frozen-Plan location context.

## Authority

Agents can inspect the register, report a new structured Incident, and export one verified record. Agents cannot acknowledge, escalate, own, hand off, attach evidence, record emergency actions, resolve, close, or reopen an Incident. Those operations require an authenticated human role in VenueMind Studio.

## Evidence storage

JPEG, PNG, WebP, and PDF evidence is limited to five MiB per object and eight objects per Incident. The API validates actual bytes and media signatures, generates the private object key, computes SHA-256, and stores bytes in a private Cloudflare R2 bucket. D1 stores only the Incident aggregate and checksummed metadata. Public tools, ledgers, and exports never include object keys or evidence bytes.

Downloads are authenticated, integrity-checked against R2 metadata, returned with `private, no-store`, forced attachment disposition, `nosniff`, and a sandbox content-security policy.

## Recovery and conflicts

The browser stores the authoritative register projection and an ordered Project-scoped outbox in IndexedDB. Exact retries are idempotent. Stale Incident revisions and conflicting commands remain in recovery state for human review instead of being discarded.
