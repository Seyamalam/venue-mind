# Reliability and recovery

VenueMind treats accepted Plan truth, Proposal work, browser recovery, and durable D1 state as separate evidence boundaries. Failure never grants Approval authority and never converts a local cache into accepted remote truth.

## Browser autosave

Each Project recovery copy is a versioned envelope containing a monotonic sequence, commit time, and checksum over the complete Project record. A save writes and verifies an autosave journal before replacing the committed recovery key. On restart, the newest verified envelope wins. A valid journal is promoted to the committed key; malformed, structurally invalid, or checksum-mismatched bytes are removed from active recovery and represented only by content-free quarantine metadata.

The Studio status is derived from the inspected envelope:

- `SAFE`: committed recovery envelope verified.
- `RECOVERED`: verified journal selected during recovery.
- `CACHE BLOCK`: corrupt recovery quarantined; Studio does not initialize a replacement Project over it while offline.
- `REMOTE ONLY`: no usable browser recovery copy.

The remote Project remains authoritative when available. Network failure leaves a verified local envelope and reports `LOCAL`. A later explicit save uses the ordinary create/revision preconditions. Conflicts remain recoverable branches; no retry silently overwrites remote state.

## Durable writes and restarts

Project metadata and snapshot state are submitted through one D1 batch. Revision and write-token verification rejects an incomplete or raced write. Failure-injection tests prove that a second-statement rollback leaves both rows unchanged. Worker instances retain no Project truth in process memory: a newly constructed Worker reads the existing repository record.

Database migrations are checksum-pinned and tested from every released schema version. This is the deployment compatibility boundary for persisted Projects.

## Restore drills

`npm run db:drill -- --database <local-sqlite-path>` performs a disposable recovery exercise:

1. Verify SQLite, relational, Project, ledger, and replay integrity.
2. Create a backup and SHA-256 manifest.
3. Restore into an isolated temporary database.
4. Re-run integrity checks.
5. Compare Project IDs, Plan fingerprints, and ledger heads with the source.
6. Remove temporary backup and restore files.

The command fails closed on source corruption, checksum mismatch, restore corruption, or evidence mismatch. Its output contains integrity evidence, not Project payloads.

## Failure evidence

| Injection | Required result |
| --- | --- |
| Tab closes between journal and committed-cache writes | Verified journal is recovered after restart |
| Recovery bytes change | Payload is quarantined and never loaded |
| Project API disconnects | Local envelope remains available; remote write count stays zero |
| Second database statement fails | Transaction rolls back; metadata and snapshot remain unchanged |
| Worker process restarts | Fresh instance loads the same durable revision |
| Backup bytes change | Restore stops at checksum verification |

The operational response is in [the failure recovery runbook](./runbooks/failure-recovery.md). Database migration, verification, backup, and restore mechanics are in [database operations](./database-operations.md).
