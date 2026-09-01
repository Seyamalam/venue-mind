# ADR 0021: Keep Tenancy Authority on the Server

## Status

Accepted

## Context

VenueMind needs durable Organizations without coupling domain authorization to one login vendor. Authentication alone does not establish Organization Membership, human Roles, Project ownership, or agent authority. Trusting client-selected Organization or Role values would make tenant isolation cosmetic.

## Decision

Persist Users, Organizations, Memberships, invitations, Sessions, and account audit events in D1. Resolve Membership and Role authority in the API Worker for every request. The public demo provisions an opaque, isolated browser identity; a verified identity provider can replace that boundary without changing tenant ownership.

Scope every Project repository operation by the server-resolved Organization ID. Namespace browser recovery storage by Organization. Bind both WebMCP and MCP Agent Grants to one Organization and one Project. Configure the standalone stdio repository with one host-controlled Organization ID. Portable Interchange Packages omit Organization ownership so import cannot smuggle tenant authority.

## Consequences

- Replacing the authentication provider does not rewrite Organization authorization.
- A client may request an active Organization, but only a current Membership can activate it.
- Cross-Organization Project reads return not found and writes are denied or conflict safely.
- Invitation secrets are hash-only at rest, Sessions expire and revoke server-side, and mutations require an approved application origin.
- Account export, deletion, audit retrieval, agent tools, and logs use the same tenant boundary.
- Anonymous demo identities are isolated per browser and must be replaced before accepting private production data.
