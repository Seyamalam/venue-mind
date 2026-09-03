# Contributing to VenueMind

Start with [the architecture map](docs/architecture.md). It names every runtime boundary and its source file.

## First checkout

1. Install Node.js 22 or newer.
2. Run `npm ci`.
3. Run `npm run verify:local`.

Completion means the local verification summary records every phase as passed.

## Choose the change path

- New planner command or agent tool: follow [Add a command](docs/architecture.md#add-a-command).
- New deterministic Constraint: follow [Add a Constraint](docs/architecture.md#add-a-constraint).
- Project schema change: follow [Schema migrations](docs/schema-migrations.md).
- Persistence or recovery change: read [Persistence and recovery](docs/persistence-and-recovery.md).
- Database migration, backup, or restore: follow [Database operations](docs/database-operations.md).
- Share Link or notification change: follow [Sharing and notifications](docs/sharing-and-notifications.md).
- Test selection: use [Testing by layer](docs/testing.md).
- Complete change verification: use [Local verification](docs/local-verification.md).
- Release preparation: use the [Release checklist](docs/release-checklist.md).
- Broken local or generated state: use the [Failure recovery runbook](docs/runbooks/failure-recovery.md).
- Vulnerability report or security-sensitive finding: follow [the private reporting policy](SECURITY.md).

## Product invariants

- Accepted Plan truth changes only through a human-authorized planner command.
- Agent work remains a Proposal until human Approval.
- Stable IDs survive ordinary revisions, migrations, export, import, and replay.
- Deterministic Validation is derived from canonical geometry and versioned policy inputs.
- Activity Ledger integrity and replay must pass before restored state becomes authoritative.
- WebMCP, MCP, UI, docs, schemas, and examples consume the shared runtime contracts.
