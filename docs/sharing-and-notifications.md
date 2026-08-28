# Sharing and notifications

VenueMind shares bounded review views through short-lived bearer capabilities. A Share Link never grants Organization membership, planner authority, or Approval authority. Notifications identify work through stable references while keeping venue geometry, event details, and free-form instructions out of notification bodies.

## Share-link scopes

| Scope | Public view | Proposal access |
| --- | --- | --- |
| `read-only` | Project identity and the accepted Plan | None |
| `reviewer` | Project identity, the accepted Plan, and one retained Proposal | Only the stable Proposal ID pinned when the link is created |

Only Venue Administrators and Organization Administrators can list, create, or revoke Share Links. Creation accepts an expiry no more than 30 days in the future. A Reviewer Share Link must name a Proposal currently present in the Project snapshot.

The server creates a cryptographically random 64-character token, returns it once, stores only its SHA-256 hash, and publishes the browser URL as `/share/:token`. The public API resolves the same token at `GET /api/share/:token`. The public response omits Organization identity, the Activity Ledger, and every Proposal outside the pinned reviewer scope. The link pins the Proposal's stable ID and resolution includes retained Proposal history, so a later live edit cannot silently retarget an already-issued capability.

## Share-link lifecycle

1. Load the authoritative Project record and current Project Record Revision.
2. Validate scope, stable Proposal binding, expiry, and the caller's Human Role.
3. Persist a `pending-create` Share Link operation containing the token hash and pinned Proposal ID when applicable.
4. Append `share_link.created` through `VenuePlanner.execute`, save with compare-and-swap, and mark the link `active` with `creation_ledgered_at`.
5. Resolve each public request by hashing its token and checking lifecycle state, revocation, and expiry at request time.
6. On operator revocation, move the link to `pending-revoke` first so access stops immediately, append `share_link.revoked`, then mark it `revoked` with `revocation_ledgered_at`.
7. Reconcile pending operations on authenticated and public Share Link requests and from scheduled maintenance. Reconciliation retries the missing ledger transition idempotently and records bounded attempt metadata and a safe failure code.

The raw token never enters the Project record, Activity Ledger, link listing, logs, or notification records. Only `active` links resolve; `pending-create`, `pending-revoke`, revoked, and expired links are unavailable. Rotation means creating a replacement link and revoking the old link.

## Authenticated endpoints

| Method and path | Result |
| --- | --- |
| `GET /api/projects/:id/share-links` | Link metadata and computed `active`, `expired`, or `revoked` status; token hashes are omitted |
| `POST /api/projects/:id/share-links` | One-time token, browser URL, scope, pinned Proposal ID when applicable, expiry, and resulting Project Record Revision |
| `POST /api/projects/:id/share-links/:linkId/revoke` | Immediate revocation and resulting Project Record Revision |
| `GET /api/notifications` | Up to 100 in-product Notifications for the active User and Organization |
| `POST /api/notifications/:id/read` | Marks one Notification owned by the current User as read |
| `GET /api/notification-preferences` | Current User preferences, with safe defaults when none are stored |
| `PUT /api/notification-preferences` | Replaces channel and event-type preferences for the current User |
| `POST /api/notifications/email/drain` | Organization Administrator drain of claimed email-outbox work through the configured delivery provider |

Every authenticated call uses the server-side User Session and active Organization Membership. Share-link management additionally requires the Human Role named above. Public resolution grants only the capability encoded in the token.

## Notification contract

VenueMind emits four event types:

- `review_requested` after a Project write publishes or updates a Proposal.
- `adjustment_requested` after a Project write appends `proposal.adjustment_requested`.
- `approval_completed` after a Project write commits Approval.
- `conflict_detected` to the User whose conditional Project write fails with `PROJECT_REVISION_CONFLICT`.

Each record has a fixed `notification.<eventType>` body code and references drawn only from `projectId`, `proposalId`, `planVersion`, `conflictCode`, and `revision`. The renderer may resolve display labels after the recipient opens authenticated Project context. The notification itself contains no Project name, event brief, venue geometry, Change details, or free-form instruction.

Preferences select in-product delivery, email outbox delivery, and any subset of the four event types. Defaults enable in-product delivery for every supported event and disable email. Preferences are applied when a Notification is created: disabled in-product delivery produces no visible in-app record, while email delivery can still enqueue the safe notification payload. Organization-wide review events exclude the initiating User. Conflict notifications target the User whose write conflicted.

Email delivery is an explicit outbox boundary. An administrative drain or scheduled Worker claims rows with a lease, then calls the injected provider as `emailDelivery.send({ idempotencyKey, to, bodyCode, refs })`. Provider success is the only transition that sets `delivered_at`. Failure increments the attempt count, records a safe `failure_code`, and releases the lease for retry; provider exception text and sensitive Project data are not persisted. The stable outbox ID is the provider idempotency key.

## Audit and recovery

Share creation and revocation are durable Project ledger events containing stable Share Link ID, scope, pinned Proposal ID when applicable, expiry, and revocation reason. They contain no bearer token or token hash. The link repository retains creator and revoker User IDs, lifecycle state, ledger-completion timestamps, attempt count, safe last error, and operation timestamps for access-control investigation and crash recovery. Proposal history retains the exact revision named by a Reviewer Share Link.

Database migration 6 adds Share Links, Notification Preferences, Notifications, and the email outbox. Migration 7 adds recoverable Share Link lifecycle state, retained-Proposal resolution, creation-time in-app visibility, and leased email delivery fields. Backup, restore, orphan inspection, and checksum rules follow `docs/database-operations.md`. A restored link remains governed by its original scope, pinned Proposal, expiry, revocation, and pending-operation state; reconciliation resumes unfinished lifecycle work.

## Completion evidence

`tests/sharing-notifications.test.mjs` proves retained Proposal-revision scoping, read-only omission of Proposals, immediate revocation, expiration boundaries, one-time token handling, safe link listings, ledger creation and revocation evidence, pending-operation reconciliation, all four Notification types, creation-time per-User preferences, rejection of unsafe notification references, and email delivery retry semantics. Provider-failure tests prove `delivered_at` remains unset until the injected provider succeeds. Database migration tests cover schema version 7 and its durable recovery and delivery fields.
