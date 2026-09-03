# Failure recovery runbook

Use this runbook for Project load/save failure, corrupt generated artifacts, failed migration, ledger mismatch, or an MCP process that cannot complete the supervised loop.

## Preserve evidence first

1. Stop mutation attempts on the affected Project.
2. Preserve the Project ID, Plan Version, Proposal ID, latest receipt ID, ledger head hash, error code, and correlation ID.
3. Export VM JSON or copy the local recovery record when the Studio can still read it.
4. Keep the original bytes unchanged for diagnosis.

## Project API unavailable

1. Confirm the Studio reports `LOCAL` instead of synchronized state.
2. Continue only Proposal-safe work.
3. Restore the endpoint and compare remote and recovery records before saving.
4. Preserve divergent local work as a Branch or separate imported Project.
5. Validate and obtain ordinary human Approval after reconciliation.

## Ledger or replay failure

1. Treat `LEDGER_INTEGRITY_FAILED` or replay fingerprint mismatch as blocking.
2. Quarantine the record; do not reseal modified entries as if they were original evidence.
3. Restore the newest backup or Interchange Package whose checksum, ledger, and replay pass.
4. Compare the last verified Plan Version with external operational exports before reopening work.

## Unsupported Project schema or database migration failure

1. Preserve the source schema version and original payload.
2. Confirm the application rejects non-schema-10 Project input at load, restore, import, and export boundaries.
3. Keep any one-off Project conversion outside the application runtime and emit a new checksummed canonical artifact.
4. Prove the converted artifact passes stable-ID checks, ledger verification, replay, and export/import round trip before use.
5. For database migrations, stop traffic and retain the pre-migration Project exports, SQL export, and Time Travel bookmark.
6. Restore into a separate target first and run `npm run db:verify -- --database <target>`.

## Database restore

Before releases that change persistence or migrations, run `npm run db:drill -- --database <local-sqlite-path>`. The drill creates a temporary backup, verifies its checksum, restores it into an isolated database, compares every Project Plan fingerprint and ledger head with the source, emits only integrity evidence, and removes its temporary files.

1. Never overwrite the only copy. Verify the backup manifest checksum and stage the restore into a separate database.
2. Compare database migration version, SQLite integrity, orphan counts, Project fingerprints, and ledger head hashes.
3. For D1 Time Travel, retain the current bookmark before restoring the verified target bookmark.
4. After restore, run ledger replay and deterministic Validation before reopening writes.
5. Retain the undo bookmark and independent SQL export until the recovery window closes.

## MCP client failure

1. Verify `npm run build:mcp` succeeds.
2. Confirm the configured Node executable, server path, and writable data directory.
3. Keep standard output protocol-only and inspect structured standard-error events by correlation ID.
4. Run the executable TypeScript example to separate host configuration from server behavior.
5. Reconnect only after the server exits cleanly.

## Generated documentation drift

1. Edit the source contract, docs registry, example catalog, or generator.
2. Run `npm run generate:contracts` and `npm run generate:docs`.
3. Run `npm run check:generated`.
4. Review the generated diff; never hand-edit it to silence the gate.

Recovery is complete when authoritative state passes the exact current schema, geometry and Lock validation, ledger verification, replay, deterministic Validation, and the relevant end-to-end test.
