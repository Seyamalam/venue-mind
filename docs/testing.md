# Testing by layer

## Layer map

| Layer                   | Primary command                                                                                                                            | Evidence                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Planner and domain      | `npm run test:domain`                                                                                                                      | isolated commands, geometry properties, deterministic simulation fixtures |
| Public agent contracts  | `node --test tests/command-schema-contracts.test.mjs tests/security-fuzz.test.mjs`                                                         | generated schema parity, bounded malformed inputs, immutable rejection    |
| WebMCP and browser      | `npm run test:browser`                                                                                                                     | real browser registration, supervised loop, accessibility, reviewed pixels |
| MCP server              | `npm run test:mcp`                                                                                                                         | official client and black-box stdio lifecycle, schema rejection, unchanged Project |
| Persistence and worker  | `npm run test:d1`                                                                                                                          | Wrangler-local D1 migrations, cross-tenant rejection, durable reload      |
| Interchange and exports | `node --test tests/interchange.test.mjs tests/plan-exports.test.mjs`                                                                       | checksums, round trips, vector/PDF/CSV/audit output                       |
| Docs and examples       | `node --test tests/docs-architecture.test.mjs tests/reference-docs.test.mjs tests/client-examples.test.mjs`                                | reachability, contract drift, executable clients                          |
| Skills                  | `npm run test:skills`                                                                                                                      | package structure, version compatibility, adversarial evals               |
| Milestone 11.1          | `npm run test:architecture`                                                                                                                | all architecture additions, real browser, and real local D1               |
| Whole product           | `npm test`                                                                                                                                 | every supported layer                                                     |
| Local completion gate   | `npm run verify:local`                                                                                                                     | source, generated artifacts, security scans, builds, and every test       |

## Test contract

- Use stable IDs and deterministic inputs.
- Use versioned, exact fixtures. Randomized suites must use a fixed local generator seed and a finite case count.
- Assert accepted Plan truth separately from Proposal state.
- For mutations, assert idempotent retry and ledger/receipt evidence.
- For Constraints, assert actual value, threshold, units, affected stable IDs, evidence fingerprint, and status.
- For Project persistence, assert schema-10-only rejection, export/import round trip, ledger verification, and replay.
- For database migrations, assert dry run, checksum, every released fixture, integrity/orphans, backup, staged restore, Project fingerprint, ledger head, and replay.
- For Incidents, assert frozen Runbook/Plan provenance, object and coordinate anchors, authority boundaries, exact retry, stale revisions, one transition/receipt/ledger entry per mutation, and verified exports.
- For public examples, compile or execute code and schema-check configuration and raw fixtures.

## Production mutation failure matrix

`tests/fixtures/production-boundary-failures.json` is the exact inventory of state-changing production boundaries and their executable failure evidence. `tests/test-architecture.test.mjs` rejects missing, duplicate, renamed, or extra boundary entries and verifies that every evidence test still exists. Each referenced test asserts one of three safe outcomes: immutable input remains byte-equivalent, durable rows remain unchanged, or an incomplete operation remains explicitly recoverable and reconciles exactly once.

Read-only projections are covered by schema, integrity, and tamper-rejection tests. They are not classified as mutation boundaries because they have no accepted state to roll back.

Browser tests use the production Next build on an ephemeral loopback port and actual Chromium through `agent-browser`. Pixel baselines are reviewed files under `tests/fixtures/visual`; update them only for an intentional visual change with `npm run test:browser:update`.

The D1 integration test invokes the installed Wrangler runtime twice against one temporary local persistence directory. This proves production migrations, foreign keys, tenant scope, and cross-process durable reads without a paid remote service.

## Failure triage

Run the smallest failing file while diagnosing, then run `npm run verify:local` before completion. A generated-file diff is fixed in its source registry or generator. A snapshot mismatch is investigated as a behavior change; update an expectation only after the new behavior is intentionally specified. See [Local verification](local-verification.md) for the fail-closed phase order and local evidence paths.
