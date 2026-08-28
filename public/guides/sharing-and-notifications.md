# Sharing and notifications

VenueMind shares bounded review views through short-lived bearer capabilities. A Share Link never grants Organization membership, planner authority, or Approval authority. Notifications identify work through stable references while keeping venue geometry, event details, and free-form instructions out of notification bodies.

## Share-link scopes

| Scope | Public view | Proposal access |
| --- | --- | --- |
| `read-only` | Project identity and the accepted Plan | None |
| `reviewer` | Project identity, the accepted Plan, and one exact Proposal | Only the Proposal ID pinned when the link is created |

Only Venue Administrators and Organization Administrators can list, create, or revoke Share Links. Creation accepts an expiry no more than 30 days in the future. A Reviewer Share Link must name a Proposal currently present in the Project snapshot.

The server creates a cryptographically random 64-character token, returns it once, stores only its SHA-256 hash, and publishes the browser URL as `/share/:token`. The public API resolves the same token at `GET /api/share/:token`. The public response omits Organization identity, the Activity Ledger, and every Proposal outside the pinned reviewer scope.

## Share-link lifecycle

1. Load the authoritative Project record and current Project Record Revision.
2. Validate scope, Proposal binding, expiry, and the caller's Human Role.
3. Append `share_link.created` through `VenuePlanner.execute` and save with compare-and-swap.
4. Persist the token hash and return the raw token once.
5. Resolve each public request by hashing its token and checking revocation and expiry at request time.
6. On operator revocation, set the revocation fields and append `share_link.revoked` to the Project Activity Ledger.

The raw token never enters the Project record, Activity Ledger, link listing, logs, or notification records. Revoked and expired tokens both resolve as unavailable. Rotation means creating a replacement link and revoking the old link.

## Authenticated endpoints

| Method and path | Result |
| --- | --- |
| `GET /api/projects/:id/share-links` | Link metadata and computed `active`, `expired`, or `revoked` status; token hashes are omitted |
| `POST /api/projects/:id/share-links` | One-time token, browser URL, scope, expiry, and resulting Project Record Revision |
| `POST /api/projects/:id/share-links/:linkId/revoke` | Immediate revocation and resulting Project Record Revision |
| `GET /api/notifications` | Up to 100 in-product Notifications for the active User and Organization |
| `POST /api/notifications/:id/read` | Marks one Notification owned by the current User as read |
| `GET /api/notification-preferences` | Current User preferences, with safe defaults when none are stored |
| `PUT /api/notification-preferences` | Replaces channel and event-type preferences for the current User |

Every authenticated call uses the server-side User Session and active Organization Membership. Share-link management additionally requires the Human Role named above. Public resolution grants only the capability encoded in the token.

## Notification contract

VenueMind emits four event types:

- `review_requested` after a Project write publishes or updates a Proposal.
- `adjustment_requested` after a Project write appends `proposal.adjustment_requested`.
- `approval_completed` after a Project write commits Approval.
- `conflict_detected` to the User whose conditional Project write fails with `PROJECT_REVISION_CONFLICT`.

Each record has a fixed `notification.<eventType>` body code and references drawn only from `projectId`, `proposalId`, `planVersion`, `conflictCode`, and `revision`. The renderer may resolve display labels after the recipient opens authenticated Project context. The notification itself contains no Project name, event brief, venue geometry, Change details, or free-form instruction.

Preferences select in-product delivery, email outbox delivery, and any subset of the four event types. Defaults enable in-product delivery for every supported event and disable email. Organization-wide review events exclude the initiating User. Conflict notifications target the User whose write conflicted. Email-enabled delivery writes the same body code and stable references to the outbox; an external mail sender remains downstream of this boundary.

## Audit and recovery

Share creation and revocation are durable Project ledger events containing stable Share Link ID, scope, Proposal ID when applicable, expiry, and revocation reason. They contain no bearer token or token hash. The link repository retains creator and revoker User IDs plus timestamps for access-control investigation.

Database migration 6 adds Share Links, Notification Preferences, Notifications, and the email outbox. Backup, restore, orphan inspection, and checksum rules follow `docs/database-operations.md`. A restored link remains governed by its original expiry and revocation fields.

## Completion evidence

`tests/sharing-notifications.test.mjs` proves Proposal scoping, read-only omission of Proposals, immediate revocation, expiration boundaries, one-time token handling, safe link listings, ledger creation and revocation evidence, all four Notification types, per-User preferences, and rejection of unsafe notification references. Database migration tests cover schema version 6 and its durable tables.
