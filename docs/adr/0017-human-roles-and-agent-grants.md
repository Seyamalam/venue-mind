# ADR 0017: Separate Human Roles from Agent Grants

## Status

Accepted

## Context

People need durable organization and Project authority. Agents need narrow, temporary capability for one supervised workflow. Treating an agent actor label as a human identity would allow scopes to compose into Approval or other review decisions.

## Decision

Humans receive durable Organization Membership Roles mapped to permissions. Agents receive short-lived Grants bound to one agent, one Organization, one Project, explicit VenueMind scopes, an issuer, and an expiry of at most one hour. Every planner and tool-service action resolves to one permission and is checked at the service boundary.

Agent scopes never include Approval, Warning Waiver, Project Lock management, human conflict resolution, or destructive Project management. Approval additionally requires a permitted human reviewer role and passing current evidence.

## Consequences

- Agent capabilities remain useful without becoming human authority.
- Caller-supplied actor or organization fields cannot grant permission.
- Denials expose a stable sanitized policy decision and may append audit evidence without retaining protected input.
- WebMCP, MCP, UI, and Project API boundaries must apply the same policy mapping.
