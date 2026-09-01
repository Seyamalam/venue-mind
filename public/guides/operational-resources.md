# Operational resource adapters

VenueMind reconciles live inventory, AV and power, catering, and staffing supply against one exact accepted Plan without treating provider state as accepted Plan truth. The result is an immutable Operational Resource Snapshot containing deterministic demand, conflict, substitution, and privacy evidence.

## Trusted Project boundary

Provider input supplies source-system resource, booking, circuit, station, role, shift, and assignment records. The Project ID, Plan Version, Plan fingerprint, event window, current Project Object Instances, Template and Resource Bindings, role and shift mappings, current-Project reservation references, and newly allocated VenueMind stable IDs come only from the repository-derived trusted adapter context.

The normalized input participates in invocation identity, idempotency, processed-result storage, and semantic result validation. Attempts to provide Project or Plan authority in the provider payload fail as unknown fields. External resource IDs remain separate from Project Object Instance, Template, Resource, role, shift, and Staff Reference IDs.

## Snapshot and conflict model

Collections are exact, bounded, code-point sorted, and checksum-bound. Booking windows use canonical UTC timestamps and half-open overlap semantics: a booking overlaps when its start is before the event end and the event start is before its end. Bookings ending exactly when the event starts, or starting exactly when it ends, do not conflict.

The reconciler derives demand from the trusted accepted Plan and reports Operational Resource Conflicts with one of four reasons:

- `unavailable`
- `double-booked`
- `capacity-shortfall`
- `incompatible-metadata`

Conflict and substitution option IDs are deterministic digests of canonical evidence. A resource assigned to the current Project is excluded only through a trusted reservation mapping. Provider-supplied project identity cannot suppress another booking.

## Explicit substitution boundary

Import and synchronization never apply a replacement. They return sorted compatible Resource Substitution Options bound to one exact Snapshot and Conflict. A caller must explicitly select an option for preview.

The preview translator revalidates the Snapshot checksum and semantics, Plan Version and fingerprint, Conflict and Option IDs, exact target object checksum, and same-template compatibility. It then creates a canonical Adapter Staging Batch whose Proposal changes only the target object's Resource Binding. The accepted Plan remains unchanged until ordinary human Approval. Locks, deterministic Validation, stale Proposal checks, version creation, ledger evidence, undo, replay, and export continue through the shared planner boundary.

## Personnel privacy

Staffing imports retain only role, shift, assignment, booking, and opaque Staff Reference evidence required for operations. Raw provider person IDs are resolved through trusted context and removed before invocation hashing, storage, dead letters, results, Proposals, the Activity Ledger, and exports. Names, email addresses, phone numbers, free-form notes, and contact-shaped keys or values are rejected before adapter invocation.

## Runtime and persistence

The `operational-resources` Adapter uses `aggregate-snapshot` import validation and the shared retry, rate-limit, scoped-secret, cursor, and atomic processed-batch contracts. The semantic validator recomputes demand, conflicts, options, IDs, checksum, and trusted Project bindings for fresh, duplicate, inserted, and lost-race results. Production must provide a durable processed-batch store.

## Completion evidence

The focused operational-resource suites cover all four supply families, permutation stability, half-open booking conflicts, self-booking exclusion, pool capacity, personnel privacy, compatible and absent substitution options, forged or stale evidence, accepted Plan immutability during preview, normal Validation, human Approval, and auditable Resource Binding replacement.
