# Release process

VenueMind versions each compatibility surface independently and records the exact combination in `release/versions.json`.

| Surface | Rule | Compatibility boundary |
| --- | --- | --- |
| Product | SemVer | User-visible product capability and operational behavior |
| Project schema | Positive integer | Exact schema; imported or persisted records must match |
| Tool contract | SemVer | Shared WebMCP, MCP, schemas, SDK metadata, examples, and skills |
| MCP server | SemVer | Server package behavior and supported MCP protocol versions |
| TypeScript SDK | SemVer | ESM package API |
| Agent skills | SemVer per skill | Workflow and target tool-contract compatibility |

Breaking contract changes increment a major version. Backward-compatible additions increment a minor version. Compatible fixes increment a patch version. Project schema changes always receive a new integer and an explicit migration or an exact fail-closed rejection. Released migrations and generated contract artifacts are immutable.

## Release artifacts

Every product release begins as reviewed structured notes in `release/notes/`. Generate and verify the human changelog plus checksum provenance manifest with:

```bash
npm run generate:release
npm run verify:release
```

`release/manifest.json` binds the product release to Project, tool, MCP, SDK, skill, environment, contract, migration, and deployment configuration versions. It contains SHA-256 checksums, no credentials, and no mutable build timestamp.

## Environments

- Preview uses a Vercel preview and Wrangler/local D1 with synthetic fixtures.
- Staging uses a Vercel preview, the staging Worker, and `venue-mind-staging`; it never receives production customer data.
- Production uses the stable Vercel application, production API Worker, and `venue-mind-production` D1 database.

Promotion is one-way: preview to staging to production. The exact Git commit and generated release manifest must be identical at every stage. Do not rebuild between stages.

## Promotion gate

1. Start from a clean checkout of the reviewed release commit.
2. Run the complete local verification gate and `npm run verify:release`.
3. Confirm generated artifacts have no drift and retain `release/manifest.json` with the build.
4. Export representative current Projects and prove import/replay compatibility.
5. Capture a D1 bookmark and SQL export, restore to staging, apply pending migrations, and run integrity verification.
6. Deploy the Worker and frontend to staging. Run the read-only and write golden-loop smoke checks against staging.
7. Promote the same commit, apply the rehearsed migrations, and deploy the same frontend and Worker artifacts to production.
8. Run production health, public-document, routing, durable golden-loop, and second-session reload checks.
9. Retain the prior deployment versions, bookmark, SQL export, and verification evidence until the observation window closes.

A migration must not reach production if staging fingerprints, ledger heads, orphan checks, replay, or restore evidence differ from the pre-migration report.

## Rollback

Application rollback restores the previous Vercel deployment and Worker version while leaving newer accepted data intact. Database rollback is exceptional: stop writes, retain a new current bookmark/export, verify the earlier Time Travel bookmark, restore it, and then verify migrations, Project fingerprints, Activity Ledger hash chains, and accepted-history replay before reopening writes.

Never reverse a release by deleting accepted Plans or ledger entries. When the previous application cannot read a newly migrated schema, keep the compatible application deployed and recover the database from the verified bookmark instead. The production hosting runbook contains the exact smoke and recovery commands.
