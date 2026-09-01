# VenueMind TypeScript SDK

`@venuemind/sdk` is the supported TypeScript boundary for VenueMind tool clients and external adapters. Version `0.1.0` is ESM-only and targets Node.js 22 or newer.

The SDK is a facade over canonical contracts. It does not recreate planning logic, Validation, authorization, or persistence. Calls still pass through the shared VenueMind tool service and `VenuePlanner.execute` command boundary.

## Package surface

| Entry point | Contract |
| --- | --- |
| `@venuemind/sdk` | SDK version and primary public exports |
| `@venuemind/sdk/types` | Generated Project, Plan, Proposal, Validation, Activity Ledger, export, tool input, and tool output types |
| `@venuemind/sdk/client` | Typed tool client and transport contract |
| `@venuemind/sdk/adapter` | Adapter definition, normalization, runtime, and delivery helpers |
| `@venuemind/sdk/testkit` | Deterministic in-memory dependencies and contract assertions |
| `@venuemind/sdk/sandbox` | Local test server and canonical fixtures |
| `@venuemind/sdk/schemas/*` | Canonical read-only JSON Schema artifacts |
| `@venuemind/sdk/fixtures/*` | Published JSON fixtures for external contract tests |

Only declared package exports are public. Generated types derive from the same schema and tool registries used by WebMCP, the standalone MCP server, examples, and reference documentation.

## Client boundary

Create the client with an injected transport:

```ts
import {
  createVenueMindClient,
  type VenueMindTransport,
} from "@venuemind/sdk/client";

const transport: VenueMindTransport = {
  async callTool(name, input, options) {
    return toolHost.callTool(name, input, { signal: options?.signal });
  },
};

const venue = createVenueMindClient({ transport });
```

The transport performs protocol-specific work. An MCP transport unwraps MCP structured content; a WebMCP transport invokes the browser-registered tool; a local transport may call `createVenueToolService` directly. Each transport must preserve the exact tool name, input, structured result, stable error code, and abort signal.

The client groups the golden loop without changing it. Project selection results use
the same canonical wrappers on every transport: `projects.list()` returns
`{ source, projects }`, while `projects.open(projectId)` returns
`{ status, project }`. The `status` value is `active` when selection completes in
the current call and `opening` when the host reports an in-progress selection.

| Client family | Canonical tools | Result truth |
| --- | --- | --- |
| `projects` | `venue.list_projects`, `venue.open_project` | Project selection and bounded summaries |
| `plans` | `venue.inspect_layout` | Accepted Plan plus visible Proposal evidence |
| `proposals` | `venue.preview_revision` | Reviewable Proposal state only |
| `validations` | `venue.validate_layout` | Deterministic evidence for one immutable input |
| `ledger` | `venue.get_change_log` | Hash-chained activity evidence |
| `exports` | `venue.export_plan`, `venue.export_audit_package` | Read-only artifacts bound to versions and fingerprints |

## Supervised workflow

```ts
const { source, projects } = await venue.projects.list();
const { status, project } = await venue.projects.open("project-summit-forward");

if (status !== "active") {
  throw new Error(`Project ${project.id} is still opening`);
}

const accepted = await venue.plans.inspect();
const proposal = await venue.proposals.preview({
  goal: "Reduce entrance congestion while preserving accessible routes",
  idempotencyKey: "proposal-arrival-001",
  correlationId: "planning-session-001",
});
const validation = await venue.validations.run();

if (validation.evaluatedProposalId !== proposal.proposalId) {
  throw new Error("Validation does not cover the current Proposal");
}

const ledger = await venue.ledger.list();
const planExport = await venue.exports.plan("json");

console.log({
  projectCount: projects.length,
  projectSource: source,
  acceptedVersion: accepted.planVersion,
  proposalId: proposal.proposalId,
  validationId: validation.validationId,
  validationStatus: validation.status,
  ledgerHead: ledger.at(-1)?.hash,
  filename: planExport.filename,
});
```

The workflow ends at a validated Proposal and read-only export. Approval requires authenticated human authority and remains outside every SDK agent-client method.

## Mutation metadata

Every mutating tool input uses one idempotency key for one semantic intent. Retrying the same intent with the same key returns its original receipt. Reusing a key for different input fails with `IDEMPOTENCY_KEY_CONFLICT`.

Use `correlationId` to join client telemetry with command receipts and sanitized ledger evidence. Pass an `AbortSignal` through the client options when a host can cancel work. Cancellation returns the published `TOOL_CALL_CANCELLED` error and does not authorize a partial mutation.

## Errors

The client rejects failed calls with a typed VenueMind error containing:

- a stable `code`;
- a human-readable `message`;
- published remediation;
- bounded structured `details`.

Branch on `code`, not message text. Preserve the original code and details when logging or presenting remediation, subject to the application's privacy policy. Treat unknown future codes as a safe failure and retain the original payload for diagnosis.

## Authorization

The SDK does not mint authority. The host binds the call to an authenticated principal, Organization, Project, and required VenueMind scope. Client method availability is not proof of permission.

Agent callers may inspect, propose, comment, simulate, and export within their grant. Approval, Warning Waivers, Project Locks, conflict decisions reserved for humans, account administration, and destructive Project operations remain absent from the agent client.

## Generated types

Types are generated from canonical JSON Schemas and versioned tool input/output contracts. Generated declarations are evidence, not an independent source of truth.

When a contract changes:

1. update its canonical schema or tool registry;
2. assign the correct contract version;
3. regenerate SDK declarations and API reference;
4. run type-level consumer tests and runtime contract tests;
5. verify generated drift is empty.

The change is complete when a packed SDK can be installed into a clean consumer, its declarations typecheck, and its runtime examples pass against the matching sandbox.

## Sandbox and testkit

Use `@venuemind/sdk/testkit` for deterministic clocks, memory-backed idempotency and webhook stores, fixtures, and contract assertions. Use `@venuemind/sdk/sandbox` when a client needs a real local request boundary.

Sandbox state is disposable and isolated. It is not a production authentication, durability, concurrency, or secret-storage implementation.

## Version compatibility

The SDK version does not replace the tool contract, adapter contract, Project schema, Validation engine, Simulation engine, or Activity Ledger schema versions. Persist and compare the version named by each artifact. See [Compatibility and deprecation](compatibility-and-deprecation.md).
