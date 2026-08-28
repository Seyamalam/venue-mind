# ADR 0021: Use Sites Identity with Server-Owned Tenancy

## Status

Accepted

## Context

VenueMind needs authenticated Users and durable Organizations without coupling domain authorization to one login vendor. OpenAI Sites can provide authenticated identity headers to the Worker, but authentication alone does not establish Organization Membership, human Roles, Project ownership, or agent authority. Trusting client-selected Organization or Role values would make tenant isolation cosmetic.

## Decision

Use a replaceable `IdentityProvider` Adapter whose initial implementation accepts only the trusted OpenAI Sites identity headers. Persist Users, Organizations, Memberships, invitations, Sessions, and account audit events in D1. Resolve Membership and Role authority on the server for every API request.

Scope every Project repository operation by the server-resolved Organization ID. Namespace browser recovery storage by Organization. Bind both WebMCP and MCP Agent Grants to one Organization and one Project. Configure the standalone stdio repository with one host-controlled Organization ID. Portable Interchange Packages omit Organization ownership so import cannot smuggle tenant authority.

## Consequences

- Replacing the authentication provider does not rewrite Organization authorization.
- A client may request an active Organization, but only a current Membership can activate it.
- Cross-Organization Project reads return not found and writes are denied or conflict safely.
- Invitation secrets are hash-only at rest, Sessions expire and revoke server-side, and mutations require a same-origin request.
- Account export, deletion, audit retrieval, agent tools, and logs use the same tenant boundary.
- Local development may fall back to the isolated `org-local` recovery workspace when the account API is unavailable; the deployed Worker never grants anonymous API access.
