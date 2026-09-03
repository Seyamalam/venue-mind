# Release checklist

## Contracts

- [ ] Command, tool, error, authorization, Constraint, Project, and output changes are versioned correctly.
- [ ] Breaking changes declare an exact version cutoff and retain prior immutable artifacts outside the runtime.
- [ ] Approval and destructive Project deletion remain absent from agent surfaces.
- [ ] Stable IDs, idempotency, base-version, Lock, and ledger invariants are tested.

## Generated artifacts

- [ ] Run `npm run generate:contracts`.
- [ ] Run `npm run generate:migrations` and inspect checksums.
- [ ] Run `npm run generate:docs`.
- [ ] Run `npm run build:skills`.
- [ ] Run `npm run check:generated` with no drift.
- [ ] Confirm public examples contain placeholders rather than machine paths or secrets.

## Verification

- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Confirm the Studio, `/docs`, `/llms.txt`, `/llms-full.txt`, schemas, reference manifest, and client-example manifest return successful responses.
- [ ] Review the bundle-size warning and record any accepted regression.
- [ ] Run the failure recovery exercise when persistence, migration, ledger, or import code changed.
- [ ] Export Projects, capture the D1 bookmark, and restore the backup into a test database before a database migration.

## Documentation

- [ ] Update compatibility versions and the changelog.
- [ ] Update command, Constraint, tutorial, example, and runbook sources affected by the release.
- [ ] Confirm every public link and heading is indexed.

## Deployment boundary

- [ ] Set `VENUEMIND_PUBLIC_ORIGIN` so agent-document and sitemap links are absolute.
- [ ] Configure durable storage and environment values through the hosting platform.
- [ ] Verify the deployed health and Project API boundaries without exposing credentials.
- [ ] Retain the previous verified artifact and backup until post-release checks pass.

Hackathon video, submission copy, and final demo packaging are tracked separately and are not release prerequisites for product development.
