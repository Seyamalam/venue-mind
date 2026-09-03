# Local verification

VenueMind uses one fail-closed local gate. GitHub Actions and hosted runners are intentionally forbidden.

## Clean start

Use Node.js 22 or newer and create a disposable install from the committed lockfile:

```bash
npm ci
npm run verify:local
```

The first phase verifies `package.json` against lockfile version 3, requires HTTPS npm-registry provenance and SHA-512 integrity for non-bundled packages, dry-runs `npm ci`, and validates the installed dependency tree. It also rejects any `.github/workflows/*.yml` or `.yaml` file.

## Gate order

The command runs these phases sequentially and stops at the first failure:

1. install and lockfile preconditions;
2. source format, lint, and all application, Worker, MCP, and SDK typechecks;
3. generated contract, migration, SDK, example, guide, license, and agent-document drift;
4. skill validation, npm dependency advisories at high severity or above, and redacted credential-signature scanning;
5. production hosting configuration plus the Vercel Next.js build and route-specific frontend boundary;
6. the Cloudflare Worker, MCP server, SDK, and skill builds;
7. migration fixtures and integrity tests;
8. responsive/browser capability contract tests;
9. the complete test suite.

`npm run format:check` enforces the repository's existing source baseline: LF endings, no tabs or trailing whitespace, no merge markers, and one final newline. Generated files are excluded from that source-style decision and are checked by deterministic regeneration instead.

The browser phase verifies responsive and capability contracts locally. It does not claim live Safari or Firefox execution.

## Failure evidence

Every run writes command logs and a machine-readable summary under `.artifacts/local-verification/<run>/`. `.artifacts/` is ignored by Git and never uploaded. `latest.json` points to the most recent summary. Secret findings contain only file, line, and rule identifiers; credential values are never copied into the report.

The gate fails on a missing executable, non-zero phase, malformed lockfile, advisory threshold breach, secret signature, stale generated file, empty migration group, or empty complete-test group. Remaining phases are marked `skipped`, not `passed`.

## Cache boundary

The normal npm download cache may accelerate installation, but `node_modules` is disposable and validated against the committed lockfile. Build outputs, generated contracts/docs, and `.artifacts/` are never inputs to source decisions. Generated outputs must reproduce byte-for-byte from canonical source before builds or tests can pass.

## Focused commands

```bash
npm run check:install
npm run format:check
npm run scan:dependencies
npm run scan:secrets
npm run test:migrations
npm run test:browser
node --test tests/local-verification.test.mjs
```
