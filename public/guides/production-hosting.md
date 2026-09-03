# Production hosting

VenueMind has one public application boundary and one durable data boundary:

- `https://venue-mind-jet.vercel.app` serves the Next.js application and public agent documentation.
- `https://venue-mind-api.seyamalam41.workers.dev` serves API requests only.
- Cloudflare D1 database `venue-mind-production` stores durable product state for the Worker.
- Cloudflare D1 database `venue-mind-staging` stores synthetic staging state for `venue-mind-api-staging`.
- Object storage and file evidence are disabled. VenueMind does not require R2.

The Vercel project domain is the stable production domain and includes managed HTTPS. A paid vanity domain is not a production prerequisite. The Worker must return `API_ROUTE_REQUIRED` for non-API paths, and Vercel is the sole frontend host.

## Configuration

`VENUEMIND_API_ORIGIN` is a build-time Vercel value containing the credential-free HTTPS Worker origin. The Worker accepts the Vercel production origin through `VENUEMIND_APP_ORIGINS` and runs the public demonstration in `anonymous-demo` authentication mode. Secrets must be configured in their host control plane and must never be written to repository files, verification output, or browser bundles.

Run the static boundary check before a release:

```bash
npm run verify:hosting
```

This verifies the Vercel/Next.js boundary, Worker/D1 binding, allowed origin, storage exclusions, cache policies, security headers, and absence of GitHub Actions or alternate Cloudflare frontend configuration.

## Promotion sequence

1. Run the complete local release gate from a clean checkout.
2. Generate migrations and confirm their checked-in checksums have not drifted.
3. Capture the D1 Time Travel bookmark and a dated remote SQL export.
4. Restore the export into a non-production database and apply every pending migration there first.
5. Verify database integrity, Project fingerprints, ledger heads, and accepted-history replay.
6. Apply the same migrations to production and verify that no migration remains pending.
7. Deploy the API Worker, then verify `/api/health` and its non-API 404 boundary.
8. Deploy and promote the Vercel production build.
9. Run `npm run smoke:production` for read-only public and routing checks.
10. Run `npm run smoke:production:write` to execute and persist the complete golden loop, then reload it using a separate browser session.

The write smoke test uses the fixed `project-production-smoke` Project and an isolated anonymous demonstration identity so repeated releases update a bounded verification record rather than creating unbounded production data.

## Rollback

Keep the previous verified Vercel deployment, Worker deployment version, D1 bookmark, and SQL export until both smoke commands pass. If an application deploy fails, restore the previous Vercel deployment and Worker version without reverting accepted data. If a migration causes a data-integrity failure, stop writes, capture a new bookmark and export, then use the documented D1 Time Travel procedure only after verifying the target bookmark. Re-run migration verification and both smoke tests after recovery.

Never delete or rewrite an accepted Plan or Activity Ledger entry to make a rollback pass.

The staging Worker is deployed with `npm run deploy:cloudflare:staging`. Its dedicated D1 binding must be migrated and verified before the production database. Staging accepts synthetic data only and never uses the production D1 database ID.
