# Schema boundary and database migrations

Current Project schema: 10. The application runtime accepts Project schema 10 only. Current template schema: 1. Interchange Package format 1 must embed Project schema 10.

Current database schema: 7. Numbered, checksummed SQL migrations and production-shaped fixtures cover database versions 1 through 7. Project schema describes the JSON record stored in `project_states`; database schema describes durable tables and indexes. They are separate boundaries.

## Project runtime contract

- Load, restore, import, and export reject any Project schema other than 10.
- Restore validates the complete canonical snapshot without adding fields, rewriting geometry, synthesizing Locks, creating branches, sealing ledgers, or appending migration events.
- Every restored Activity Ledger must already be schema-versioned, hash chained, and capable of replaying the exact accepted Plan and Event Brief.
- Every persisted Object carries typed Locks, including an empty array when no Lock exists.
- Import Preview verifies schema, checksum, geometry, stable IDs, Locks, ledger integrity, and replay before create-only commit.
- Template inputs reject every schema other than template schema 1.

Unsupported Project bytes should be retained outside the running product for forensic recovery. Conversion, if ever required, is an explicit offline release operation that emits a new canonical artifact; VenueMind does not ship multi-version runtime compatibility.

## Add a database migration

1. Add the next contiguous `db/migrations/NNNN_name.sql` file with one statement per `-- statement-breakpoint` block.
2. Never edit an applied migration. Add a new migration; checksum drift is a hard failure.
3. Set `-- migration-destructive: true` and `-- migration-requires-project-export: true` when applicable. A completed Project safety export is then mandatory before application.
4. Run `npm run generate:migrations` and inspect `db/migrations-manifest.json` plus `db/wrangler/`.
5. Add a production-shaped fixture for the prior database version.
6. Prove dry run, upgrade, idempotent second run, integrity/orphan checks, backup, staged restore, Project fingerprint, ledger head, and replay.

Migration 7 is the reference for recoverable cross-store operations. It preserves pending Share Link lifecycle state until the corresponding Activity Ledger transition is complete, retains the exact reviewer Proposal revision, applies in-app visibility at Notification creation, and leases email-outbox delivery attempts. Future migrations that coordinate Project records with operational tables must retain enough state for idempotent reconciliation after any interrupted write.

See `docs/database-operations.md` for local, D1, backup, restore, and Point-in-Time Recovery procedures.
