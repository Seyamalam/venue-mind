# Registration and ticketing

VenueMind imports registration data only when it can be reduced to planning-relevant aggregates. The Registration Snapshot is bound to one Project, one exact Plan Version, one source-system version, and one deterministic checksum. It is an operational read model, not accepted Plan truth and not a substitute for deterministic capacity Validation.

## Imported aggregate contract

Each provider import or synchronization contains:

- Source system, source version, and versioned synchronization cursor.
- Ticket Classes with total ticketed count, attendance forecast, exact zone allocations, and broad access requirement codes.
- Aggregate Accessibility Requirements containing only a stable requirement code, count, and Occupancy Zone IDs.
- Optional event-day Check-in Aggregates containing one timestamp and counts by Ticket Class.

Project ID, exact Plan Version, attendee target, and Occupancy Zone minimum and maximum capacities do not come from the provider payload. The host loads them from the canonical Project/Plan repository and supplies them through the runtime's trusted adapter context. Provider attempts to supply those fields are rejected as unknown input. The trusted context participates in normalization, invocation identity, checksums, and duplicate detection.

Ticket Class IDs are namespaced with the source system in normalized output. External IDs never become Project Object Instance IDs or other VenueMind stable IDs.

## Privacy boundary

Normalization runs before adapter invocation IDs, input checksums, duplicate detection, processed-result storage, dead letters, or webhook replay storage. Exact input schemas reject unknown fields. Recursive screening rejects nested attendee or person records, names, email addresses, phone numbers, postal addresses, barcodes, QR codes, ticket codes, order and payment identifiers, medical fields, disability fields, and free-form accessibility notes.

The normalized result contains no Ticket Class display label, individual scan, ticket holder, device, or contact record. Accessibility data uses broad requirement codes and aggregate counts only. Event-day Check-in Aggregates are allowed only when event-day mode is explicit, and each count must reference one imported Ticket Class without exceeding its ticketed count.

## Ticket Occupancy Reconciliation evidence

The adapter deterministically reports:

- Total ticketed count against the Project attendee target.
- Total attendance forecast.
- Ticketed count and forecast per Occupancy Zone against its minimum and maximum.
- Ticket Classes covering each Aggregate Accessibility Requirement and whether their mapped aggregate count covers the requirement.
- Event-day checked-in total and counts by source-namespaced Ticket Class.
- Stable issue codes for total, zone, or accessibility mapping mismatches.

Input collection ordering does not affect invocation identity, checksum, output ordering, or duplicate detection. Canonical sorting uses locale-independent code-point order. Accessibility coverage counts only Ticket Class allocations inside the requirement's mapped zones. Each zone forecast is bounded by its ticketed count.

## Runtime and secret boundary

The Adapter requires `registration:aggregate:read` for import and synchronization and `registration:aggregate:webhook` for aggregate webhooks. Its provider token is read only through the scoped secret reference `registration-ticketing/api-token`. The host must supply a repository-derived Project context under the `registration-ticketing` trusted adapter context key. Retry, rate-limit, dead-letter, and processed-batch behavior use the canonical adapter runtime.

Webhook replay state uses an injected atomic store, so production can bind it to durable storage. Its key contains Adapter ID and version, source system, and event ID. Concurrent identical deliveries produce one stored result, altered replay fails closed, and the same event ID from another source does not collide. The in-memory implementation exists for deterministic tests only; restart-safe deployments must inject a durable `putIfAbsent` implementation.

The versioned Adapter definition declares `importResultMode: aggregate-snapshot`. The runtime requires and executes the Registration Snapshot validator before committing a new processed result and whenever it reads a duplicate or loses an atomic insert race. The validator checks nested exact schemas, aggregate bounds and references, synchronization cursor integrity, check-in totals, and a recomputed reconciliation proof in addition to the snapshot checksum. Definitions that omit the mode remain `reviewable-proposal` and must satisfy the canonical Adapter Staging Batch invariant.

The aggregate snapshot cannot mutate the Event Brief, Plan, Proposal, or Activity Ledger. A later generalized non-spatial staging workflow may translate a planning-relevant mismatch into an ordinary reviewable Requirement Change, but registration ingestion itself does not bypass that boundary.

## Completion evidence

`tests/registration-ticketing-adapter.test.mjs` proves a 400-ticket class total reconciles exactly with the trusted 400-person Project occupancy requirement, including zone and accessibility mappings and aggregate event-day counts. It also proves recursive privacy rejection before storage, traversal and aggregate bounds, foreign-zone rejection, allocation consistency, allocation-scoped accessibility coverage, permutation-stable checksums, source-namespaced IDs, checksum-valid semantic forgery rejection, atomic restart-safe webhook replay, explicit mismatch evidence, and content-free dead letters.
