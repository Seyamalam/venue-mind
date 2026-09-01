# Testing by layer

## Layer map

| Layer | Primary command | Evidence |
| --- | --- | --- |
| Planner and domain | `npm run test:domain` | Commands, Validation, Approval, replay, and strict schema boundaries |
| WebMCP | `node --test tests/webmcp*.test.mjs` | Registration, scopes, limits, cancellation, redaction |
| MCP server | `npm run test:mcp` | Official client, stdio lifecycle, resources, prompts, progress |
| Persistence and worker | `node --test tests/project-store.test.mjs tests/incident-store.test.mjs tests/incident-routes.test.mjs tests/incident-attachments.test.mjs tests/database-migrations.test.mjs` | remote authority, local recovery, private evidence, API routing, database upgrade/restore |
| Interchange and exports | `node --test tests/interchange.test.mjs tests/plan-exports.test.mjs` | checksums, round trips, vector/PDF/CSV/audit output |
| Docs and examples | `node --test tests/docs-architecture.test.mjs tests/reference-docs.test.mjs tests/client-examples.test.mjs` | reachability, contract drift, executable clients |
| Skills | `npm run test:skills` | package structure, version compatibility, adversarial evals |
| Whole product | `npm test` | every supported layer |

## Test contract

- Use stable IDs and deterministic inputs.
- Assert accepted Plan truth separately from Proposal state.
- For mutations, assert idempotent retry and ledger/receipt evidence.
- For Constraints, assert actual value, threshold, units, affected stable IDs, evidence fingerprint, and status.
- For Project persistence, assert schema-10-only rejection, export/import round trip, ledger verification, and replay.
- For database migrations, assert dry run, checksum, every released fixture, integrity/orphans, backup, staged restore, Project fingerprint, ledger head, and replay.
- For Incidents, assert frozen Runbook/Plan provenance, object and coordinate anchors, authority boundaries, exact retry, stale revisions, one transition/receipt/ledger entry per mutation, R2 signature and metadata checks, compensation, and byte-free exports.
- For public examples, compile or execute code and schema-check configuration and raw fixtures.

## Failure triage

Run the smallest failing file while diagnosing, then run `npm test` before completion. A generated-file diff is fixed in its source registry or generator. A snapshot mismatch is investigated as a behavior change; update an expectation only after the new behavior is intentionally specified.
