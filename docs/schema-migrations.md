# Schema migration guide

Current Project schema: 10. Released migration fixtures cover schemas 5 through 10.

Current database schema: 7. Numbered, checksummed SQL migrations and production-shaped fixtures cover database versions 1 through 7. Project schema migrations change planner snapshots; database schema migrations change durable tables and indexes. Neither substitutes for the other.

## Rules

- Migration is deterministic and sequential.
- Stable Project, Plan, object, Constraint, Proposal, Change, Lock, Comment, Scenario, receipt, and ledger IDs survive unless identity genuinely changes.
- Accepted Plan Versions are never rewritten to look newly approved.
- Added evidence is derived from canonical stored inputs or explicit fallback templates; guessed operational facts remain marked or blocked.
- Every migration appends one `schema.migrated` ledger entry with a stable migration ID.
- Restore and Import Preview verify geometry, Locks, ledger integrity, and replay after migration.

## Add a migration

1. Increment the Project schema constant and `projectRecordSchema` in `src/contracts/venue-contracts.js`.
2. Extend `normalizeSnapshot` in `src/domain/venue-planner.js` with one bounded `vN-to-vN+1` transformation.
3. Record its stable migration ID in the migration list and append `schema.migrated` evidence.
4. Update `src/persistence/project-store.js`, `src/interchange/venue-package.js`, the compatibility reference, and generated schemas.
5. Add the oldest representative pre-migration fixture that exposes every changed field.
6. Prove restore, export, Import Preview, import commit, ledger verification, replay, and a second load are stable.
7. Run `npm run generate:contracts`, `npm run generate:docs`, `npm test`, and `npm run check:generated`.

## Completion evidence

- The legacy fixture reaches the current schema exactly once.
- A second normalization produces no additional migration entries or data changes.
- Stable IDs and accepted Plan fingerprints match the migration expectation.
- Invalid or tampered legacy state fails with a stable error instead of being repaired silently.
- The compatibility and deprecation page names the supported range and migration behavior.

## Activity Ledger accepted-Brief proof

Early schema-10 snapshots sealed accepted Plan truth but did not include accepted Event Brief proof. Their unkeyed legacy ledger cannot authenticate a complete edited Brief, so snapshot-derived planner seeds and caller-labelled templates never authorize migration. Restore requires an explicit human attestation supplied through the server by an authenticated Venue Administrator or Organization Administrator. The proof actor and role must match the server-resolved principal and the proof must contain the exact Brief under review; a mismatch fails with `LEDGER_INTEGRITY_FAILED`, while a missing or unauthorized proof fails with `LEGACY_BRIEF_ATTESTATION_REQUIRED`. A successful restore appends one `activity-ledger-v1-accepted-brief-proof` entry containing the accepted Plan, Brief, SHA-256 challenge bindings, and proof reference. Imported snapshots cannot self-attest, and migration never infers Brief history.

## Add a database migration

1. Add the next contiguous `db/migrations/NNNN_name.sql` file with one statement per `-- statement-breakpoint` block.
2. Never edit an applied migration. Add a new migration; checksum drift is a hard failure.
3. Set `-- migration-destructive: true` and `-- migration-requires-project-export: true` when applicable. A completed Project safety export is then mandatory before application.
4. Run `npm run generate:migrations` and inspect `db/migrations-manifest.json` plus `db/wrangler/`.
5. Add a production-shaped fixture for the prior database version.
6. Prove dry run, upgrade, idempotent second run, integrity/orphan checks, backup, staged restore, Project fingerprint, ledger head, and replay.

Migration 7 is the reference for recoverable cross-store operations. It preserves pending Share Link lifecycle state until the corresponding Activity Ledger transition is complete, retains the exact reviewer Proposal revision, applies in-app visibility at Notification creation, and leases email-outbox delivery attempts. Future migrations that coordinate Project records with operational tables must retain enough state for idempotent reconciliation after any interrupted write.

See `docs/database-operations.md` for local, D1, backup, restore, and Point-in-Time Recovery procedures.
