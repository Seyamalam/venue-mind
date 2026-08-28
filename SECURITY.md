# VenueMind security policy

## Supported versions

Security fixes target the current main branch and the latest deployed VenueMind release. Pre-release builds may change without backports.

## Report privately

Use GitHub's **Security → Report a vulnerability** flow for this repository. Include:

- Affected version, route, tool, command, or exported artifact.
- Reproduction steps using non-sensitive test data.
- Expected and observed authorization boundary.
- Impact on Project isolation, accepted Plan truth, Approval authority, Locks, ledger integrity, or confidential data.
- Relevant stable error code, correlation ID, and sanitized logs.

If private vulnerability reporting is unavailable, contact the repository owner through an established private channel and ask for a secure reporting route. Do not put exploit details, credentials, private venue data, or unredacted logs in a public issue.

## Response targets

- Acknowledge a complete report within three business days.
- Triage severity and reproduction within seven business days.
- Provide a remediation or coordinated-disclosure plan after reproduction.
- Publish a security advisory when affected users need to upgrade or rotate credentials.

Targets are service goals, not a guarantee. Active exploitation or cross-organization exposure receives immediate priority.

## Scope priorities

- Cross-organization or cross-Project access.
- Authentication, Agent Grant, Human Role, or Approval bypass.
- Accepted Plan mutation outside the supervised command boundary.
- Lock, Warning Waiver, Emergency Review, ledger, replay, or import-integrity bypass.
- Secret, attendee, contact, export, or operational-data exposure.
- WebMCP, MCP, worker, browser, import, or export denial of service beyond published limits.
- Supply-chain or generated-artifact tampering.

## Research safety

Use local fixtures and the smallest proof needed to demonstrate impact. Preserve data, avoid persistence or availability disruption, and stop after proving the boundary failure. Good-faith research following this policy will be evaluated for coordinated remediation rather than treated as hostile activity.

## Disclosure

Keep the report private until a fix or mitigation is available and affected users have a reasonable upgrade window. VenueMind will credit reporters who request attribution and whose disclosure remains coordinated.
