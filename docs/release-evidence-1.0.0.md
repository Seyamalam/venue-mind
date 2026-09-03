# VenueMind 1.0.0 release evidence

Verified on 2026-09-03 against the public production boundary.

## Deployment

- Frontend: `https://venue-mind-jet.vercel.app`
- Vercel deployment: `dpl_7uxRnkjJUM3wZezxYgw4tmcEtuap`
- Verified application source: `cabfc0c1207d8917294964dd6b84e33ef510faa9`
- API: `https://venue-mind-api.seyamalam41.workers.dev`
- Cloudflare Worker version: `17594588-68b8-4eb4-9778-7052710b4c60`
- Database: `venue-mind-production`, schema 16
- Object storage: disabled by product scope; no R2 dependency exists

## Database evidence

- All 16 production D1 migrations are applied with no migration pending.
- Two durable Projects exist, including the isolated production smoke Project.
- Project rows without state: 0.
- State rows without a Project: 0.
- Product analytics rows: 0; analytics remains opt-in and aggregate-only.
- A pre-release D1 Time Travel bookmark and SQL backup were captured before production migration.
- SQL backup SHA-256: `30b8a3f36aefe0bf6bec1146d9b6aaa14db43f3e2ba4c124da3bd0be40c0d272`.

## Production smoke evidence

The public-route smoke passed for the application, docs, `llms.txt`, `llms-full.txt`, command schema, security headers, cache policy, API health, API not-found behavior, and Worker-only API boundary.

The opt-in write smoke then completed the complete product loop through the stable Vercel origin:

1. `inspect_layout`
2. `preview_revision`
3. `validate_layout`
4. human `approve_proposal`
5. `export_plan`
6. persist the accepted Project to D1
7. reload the same durable revision from a second browser identity

The accepted Plan advanced from 3.2 to 3.3. Validation ID `validation-ed3f8c64` was deterministic, the durable Project reached revision 4, and the second-session reload passed.

## Local release gate

- The deterministic 19-phase local verification gate passed.
- The complete Node test phase passed 662 tests with 0 failures and 3 intentional browser-runner skips; those cases run in the dedicated browser phase.
- The dedicated architecture suite passed all 108 checks, including generated command contracts, security fuzzing, MCP stdio black-box behavior, real local Wrangler D1 persistence, accessibility, visual regression, and a real Chromium WebMCP golden loop.
- The visual comparison permits at most 0.01% antialiasing variance while still requiring exact dimensions and reviewed baseline images.

## Recovery boundary

The prior Vercel deployment and Worker version remain available for application rollback. Database rollback uses the captured pre-release bookmark and SQL export, then re-verifies migration state, Project/state orphans, accepted Plan replay, and Activity Ledger fingerprints before writes resume.
