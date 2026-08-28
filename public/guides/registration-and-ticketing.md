# Registration and ticketing

VenueMind imports registration data only when it can be reduced to planning-relevant aggregates. The Registration Snapshot is bound to one Project, one exact Plan Version, one source-system version, and one deterministic checksum. It is an operational read model, not accepted Plan truth and not a substitute for deterministic capacity Validation.

## Imported aggregate contract

Each import or synchronization contains:

- Source system, source version, and versioned synchronization cursor.
- Project ID and exact Plan Version.
- Project attendee target and Occupancy Zone minimum and maximum capacities.
- Ticket Classes with total ticketed count, attendance forecast, exact zone allocations, and broad access requirement codes.
- Aggregate Accessibility Requirements containing only a stable requirement code, count, and Occupancy Zone IDs.
- Optional event-day Check-in Aggregates containing one timestamp and counts by Ticket Class.

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

Input collection ordering does not affect invocation identity, checksum, output ordering, or duplicate detection. Changed aggregate content under one webhook event ID fails replay validation.

## Runtime and secret boundary

The Adapter requires `registration:aggregate:read` for import and synchronization and `registration:aggregate:webhook` for aggregate webhooks. Its provider token is read only through the scoped secret reference `registration-ticketing/api-token`. Retry, rate-limit, dead-letter, processed-batch, and webhook replay behavior use the canonical adapter runtime.

The versioned Adapter definition declares `importResultMode: aggregate-snapshot`. The runtime requires and executes the Registration Snapshot validator before committing a new processed result and whenever it reads a duplicate result. Definitions that omit the mode remain `reviewable-proposal` and must satisfy the canonical Adapter Staging Batch invariant.

The aggregate snapshot cannot mutate the Event Brief, Plan, Proposal, or Activity Ledger. A later generalized non-spatial staging workflow may translate a planning-relevant mismatch into an ordinary reviewable Requirement Change, but registration ingestion itself does not bypass that boundary.

## Completion evidence

`tests/registration-ticketing-adapter.test.mjs` proves a 400-ticket class total reconciles exactly with the 400-person Project occupancy requirement, including zone and accessibility mappings and aggregate event-day counts. It also proves recursive privacy rejection before storage, bounded counts, foreign-zone rejection, allocation consistency, permutation-stable checksums, source-namespaced IDs, sanitized webhook replay, explicit mismatch evidence, and content-free dead letters.
