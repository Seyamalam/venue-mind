# Data protection

VenueMind stores venue geometry, planning decisions, aggregate event-day observations, operational incidents, user identity, and tamper-evident audit evidence. It does not store attendee records, individual occupancy events, raw integration credentials, or generated export files.

## Classification and defaults

| Class | Examples | Active retention | Delete recovery | Backup expiry |
| --- | --- | ---: | ---: | ---: |
| Public contract | Schemas, tool reference | Product lifetime | None | 30 days |
| Project content | Brief, Plan, Proposals, comments | Until deleted | 30 days | 30 days after purge |
| Operational sensitive | Runbook, occupancy aggregates, incidents, deviations, post-event review | 365 days | 30 days | 30 days after purge |
| Account identity | Email, display name, membership | Account lifetime | None | 30 days |
| Security evidence | Session, authorization, organization audit | 400 days | None | 30 days |
| Secret reference | Opaque environment binding names | Configuration lifetime | None | Not stored in D1 or backups |

Organization administrators may shorten or extend operational retention from 30 days to seven years, security evidence from 90 days to seven years, and Project recovery from zero to 30 days. The runtime rejects values outside these bounds.

## Data minimization

- Live occupancy accepts aggregate counts by stable source and zone only.
- Personnel resources use opaque references and non-contact operational labels.
- Integration adapters receive secrets through scoped readers. Project records, command receipts, logs, exports, and browser caches never receive raw credentials.
- Exports are generated on demand and returned directly. VenueMind does not retain them in object storage.
- Diagnostic logs use an allowlist of bounded scalar fields and omit request bodies, payloads, snapshots, geometry, identity attributes, cookies, and credentials.

## Export and deletion

Account export includes the account, its memberships, relevant organization audit events, and Project records. Project export remains available through VenueMind JSON and audit packages.

Deleting a Project first creates a recoverable tombstone. Its browser cache is removed immediately. At the configured deadline, the D1 Project row is purged and foreign-key cascades remove accepted state, runbooks, occupancy, incidents, deviations, post-event reviews, receipts, and ledgers. Backups expire 30 days after the primary purge. Previously downloaded exports remain under the downloader's control because VenueMind does not retain a server copy.

Deleting an account immediately revokes sessions, suspends memberships, and anonymizes identity fields. Organization audit evidence retains opaque actor identifiers for integrity until its retention deadline.

The Project store handles deletion as a server transaction, not a metadata edit. It sends the current Project ETag, removes the Project, synchronization base, and conflict-recovery keys from browser storage, then acknowledges the server-issued cache directive. A failed acknowledgement is surfaced as `PROJECT_CACHE_ACK_FAILED`; it never restores the removed cache.

## Retention operations

Organization administrators manage policy at `GET|PUT /api/data-protection/retention-policy`. The daily Worker schedule evaluates each active organization independently and deletes at most 50 eligible records per invocation. Due Project tombstones are purged first. Old Runbook roots are deleted only when the Runbook, tasks, occupancy monitor, incident register, and deviation register are all older than the operational cutoff. Foreign-key cascades remove their child receipts and ledgers under a short-lived, tenant-scoped purge lease. Old organization audit and completed deletion evidence use the security-evidence cutoff. Every visited organization receives a bounded sweep audit record with the applied cutoffs and counts.

Backup expiry is an operator boundary, not an application deletion claim. `GET /api/data-protection/backup-expiry` reports eligibility 30 days after the actual D1 purge. After checking the provider-side retention state, an administrator may submit a non-secret evidence reference to `POST /api/data-protection/backup-expiry/verify`. VenueMind records immutable operator evidence with `claim: eligibility-and-operator-evidence-only`; it does not report that a Cloudflare backup was deleted.

## Secrets

Production credentials belong in Vercel or Cloudflare encrypted environment-secret stores. VenueMind persists only validated opaque secret-reference names. There is no application database column or API for raw integration credentials.

## Verification

The data-protection tests verify retention bounds, strict admin routes, browser cache purge and acknowledgement, bounded tenant sweeps, deletion coverage, collection boundaries, and log redaction. Database deletion tests verify the complete D1 cascade. Backup drills verify eligibility, checksums, and immutable operator evidence without copying secrets or downloaded exports.
