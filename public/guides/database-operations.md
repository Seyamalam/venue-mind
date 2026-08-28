# Database operations

VenueMind database schema version 5 is represented by numbered SQL sources in `db/migrations/`. `scripts/generate-db-migrations.mjs` computes SHA-256 checksums, emits the Worker catalog, and creates one Wrangler-ready file per migration. Applied checksums are stored in `schema_migrations`; changed historical SQL fails closed.

## Local migration drill

```bash
npm run generate:migrations
npm run db:migrate -- --database ./var/venuemind.sqlite3 --dry-run
npm run db:migrate -- --database ./var/venuemind.sqlite3
npm run db:verify -- --database ./var/venuemind.sqlite3
```

The dry run reports current, target, applied, and pending versions without applying pending SQL. Verification runs SQLite integrity checks, relational orphan checks, planner snapshot restoration, Activity Ledger verification, and accepted-history replay.

## Project safety export

Run this before any migration marked `destructive` or `requiresProjectExport`:

```bash
node scripts/database-maintenance.mjs export-projects \
  --database ./var/venuemind.sqlite3 \
  --output ./var/pre-migration-projects
```

Each Organization-owned Project becomes a checksum-sealed VenueMind Interchange Package. Organization authority is not embedded in the portable package. The Worker migration runner refuses a flagged migration when its host does not provide a completed Project-export callback.

## Local backup and staged restore

```bash
npm run db:backup -- \
  --database ./var/venuemind.sqlite3 \
  --output ./var/backups/venuemind.sqlite3

npm run db:restore -- \
  --backup ./var/backups/venuemind.sqlite3 \
  --database ./var/restore-drill.sqlite3

npm run db:verify -- --database ./var/restore-drill.sqlite3
```

Backup refuses an unhealthy source. It writes a SHA-256 manifest containing the database migration version and every Project/ledger fingerprint. Restore verifies the backup checksum into a staged database, runs the complete integrity suite, and only then writes the requested target. It refuses an existing target unless the operator explicitly adds `--overwrite`; the ordinary drill always restores to a new path.

## D1 deployment

1. Generate and review `db/migrations-manifest.json`.
2. Export every Project and retain the generated manifest.
3. Capture the current Time Travel bookmark.
4. Export the remote database to a dated SQL file.
5. Import that export into a non-production D1 database and execute pending `db/wrangler/*.sql` files there in numeric order.
6. Run integrity/orphan queries and compare Project/ledger fingerprints with the pre-migration report.
7. Execute the same pending files against production, one at a time, then verify `schema_migrations` name and checksum values.

```bash
npx wrangler d1 time-travel info <DATABASE>
npx wrangler d1 export <DATABASE> --remote --output ./var/backups/venuemind-YYYYMMDD.sql
npx wrangler d1 execute <TEST_DATABASE> --remote --file ./var/backups/venuemind-YYYYMMDD.sql
npx wrangler d1 execute <TEST_DATABASE> --remote --file ./db/wrangler/0003_accounts_and_tenancy.sql
npx wrangler d1 execute <TEST_DATABASE> --remote --file ./db/wrangler/0004_optimistic_concurrency.sql
npx wrangler d1 execute <TEST_DATABASE> --remote --file ./db/wrangler/0005_realtime_collaboration.sql
```

Use only the pending file names reported by the dry run or `schema_migrations`; never replay an applied migration. A remote D1 export can block database requests while it runs, so schedule the operation and announce the write window.

Official references: [D1 import and export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) and [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## Point-in-Time Recovery

D1 production storage supports Time Travel automatically. Current Cloudflare documentation permits restoration to a minute within the retained window: up to 30 days on Workers Paid and seven days on Workers Free. Confirm the database reports `version: production` before relying on it.

```bash
npx wrangler d1 info <DATABASE>
npx wrangler d1 time-travel info <DATABASE> --timestamp="2026-08-28T02:00:00Z"
npx wrangler d1 time-travel restore <DATABASE> --bookmark=<VERIFIED_BOOKMARK>
```

Restore overwrites the database in place and cancels in-flight queries. Before confirming it, retain the current bookmark and an independent SQL export. After restoration, verify migrations, integrity, orphans, Project fingerprints, ledger heads, and replay. Keep the previous bookmark returned by Wrangler so the restore itself can be undone.

## Legacy ownership

Database migration 3 moves pre-Organization Projects into `org-legacy-migration` under a non-login migration principal. This preserves data without granting it to the first person who signs in. Reassignment requires an audited operator procedure; do not change `organization_id` from a browser request or agent tool.

## Gate

`tests/database-migrations.test.mjs` creates production-shaped fixtures at every released database version, performs dry run and upgrade, checks exact Plan and ledger fingerprints, creates a checksum-sealed backup, restores into a separate database, and repeats the integrity checks. It also proves checksum drift, backup tampering, and orphans fail closed.
