# Authentication and tenancy

VenueMind separates authentication from authorization. The initial identity Adapter trusts the OpenAI Sites dispatcher headers `oai-authenticated-user-id` and `oai-authenticated-user-email`; `oai-authenticated-user-full-name` is decoded only when its encoding header is `percent-encoded-utf-8`. Application code never treats a caller-supplied user, actor, Role, or Organization field as authority.

## Request boundary

1. `worker/authentication.ts` converts trusted hosting headers into an authenticated identity.
2. `worker/account-repository.ts` resolves or provisions the VenueMind User and a bounded User Session.
3. The server resolves active Organization Membership and Roles.
4. The Project repository receives the server-resolved Organization ID for every list, get, and put.
5. WebMCP and MCP Agent Grants bind one agent to the same Organization and one Project.

The production Worker returns `401` without authenticated identity or an active Session, `403` for a missing Organization Membership, and `404` when a Project is outside the active Organization. The last behavior prevents resource-existence disclosure.

## Sessions

- The session identifier is an opaque, server-created value stored in an `HttpOnly`, `SameSite=Lax`, secure cookie.
- Sessions expire after 12 hours by default and can never exceed seven days.
- Revocation is persisted server-side and clears the browser cookie.
- Same-origin checks reject cross-origin mutations.
- A revoked Session cannot be replayed. A later trusted Sites identity may start a new Session unless the User account is deleted.

## Organizations and Roles

The first sign-in creates a personal Organization and an `organization-administrator` Membership. Administrators can create Organizations, invite an email address with published Roles, change Roles, remove Memberships, and inspect Organization audit events. Invitation secrets are returned once and only their SHA-256 hashes are persisted.

Approval and other planning authority still flow through `src/domain/authorization.js`. Organization Membership supplies human Roles; it does not bypass the planner permission matrix. Agent Grants carry both `organizationId` and `projectId` and remain time-limited.

## Storage isolation

- D1 Projects carry `organization_id`; every repository query includes it.
- Browser recovery keys use `venuemind.organization.{organizationId}.project.{projectId}`.
- The stdio repository is bound by `VENUEMIND_ORGANIZATION_ID` and rejects records from another Organization.
- Portable VenueMind Interchange Packages intentionally omit Organization ownership. Import creates a Project inside the importing human's active Organization.
- Account export includes only the User's Organizations, Memberships, relevant account audit events, and Projects reachable through active Memberships.
- MCP structured logs contain the bound Organization ID and never accept it from a tool input.

## Replacement boundary

Replace `IdentityProvider.authenticate(request)` to move away from Sites identity. Preserve the normalized identity contract (`provider`, stable `subject`, verified `email`, optional `displayName`), session repository, Organization authorization, and all tenant-isolation tests. Do not move Membership or Role decisions into an identity-provider claim without a new ADR and migration.

## Completion evidence

`tests/organization-isolation.test.mjs` proves two Organizations cannot cross API, browser recovery state, WebMCP, MCP repository/session/resources, exports, or structured logs. It also covers invitation acceptance, Role assignment/removal, session revocation, account export, and account deletion.
