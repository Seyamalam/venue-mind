# `@venuemind/sdk`

Typed, transport-neutral access to VenueMind tool contracts and adapter primitives.

The package is ESM-only and requires Node.js 22 or newer. It does not expose human Approval. Applications keep Approval in an authenticated VenueMind human surface after Proposal Validation.

## Install

```bash
npm install @venuemind/sdk
```

## Entry points

| Import | Purpose |
| --- | --- |
| `@venuemind/sdk` | Stable package metadata and the primary client surface |
| `@venuemind/sdk/types` | Types generated from canonical VenueMind schemas and tool contracts |
| `@venuemind/sdk/client` | Transport interface, typed client, and public client errors |
| `@venuemind/sdk/adapter` | Adapter definitions, runtime helpers, cursors, retries, idempotency, pagination, and webhook utilities |
| `@venuemind/sdk/testkit` | In-memory stores, deterministic clocks, contract fixtures, and adapter assertions |
| `@venuemind/sdk/sandbox` | Local test server and sandbox Project fixtures |
| `@venuemind/sdk/schemas/*` | Canonical JSON Schema artifacts |

Import through these entry points. Files below `dist/` and repository-relative `src/` paths are implementation details.

## Client

Inject a transport that can call the published `venue.*` tools. The client adds types and stable error handling while the transport retains responsibility for authentication, Organization and Project binding, cancellation, and protocol framing.

```ts
import { createVenueMindClient } from "@venuemind/sdk/client";

const client = createVenueMindClient({
  transport: {
    callTool: (name, input, options) => host.callTool(name, input, options),
  },
});

await client.projects.open("project-summit-forward");
const plan = await client.plans.inspect();
const proposal = await client.proposals.preview({
  goal: "Protect the west accessible route",
  idempotencyKey: "preview-access-001",
});
const validation = await client.validations.run();

if (validation.status !== "pass") {
  console.log(validation.checks.filter((check) => check.status !== "pass"));
}

console.log(plan.planVersion, proposal.proposalId, validation.validationId);
```

Proposal creation is non-destructive. A human reviewer approves or requests adjustment in VenueMind after inspecting the exact Proposal and Validation evidence.

## Adapter

```ts
import {
  createAdapterRuntime,
  createVenueAdapter,
  defineAdapter,
} from "@venuemind/sdk/adapter";

const definition = defineAdapter({
  contractVersion: 1,
  id: "example-inventory",
  displayName: "Example inventory",
  version: "1.0.0",
  capabilities: ["import"],
  scopes: { import: ["inventory:read"] },
  retryPolicy: { maxAttempts: 3 },
  rateLimit: { requests: 30, windowMs: 60_000 },
});

const adapter = createVenueAdapter(definition, {
  async import(input, context) {
    await context.secrets.get("example-inventory/api-token");
    return normalizeProviderRecords(input, context.clock());
  },
});

const result = await createAdapterRuntime().execute(adapter, "import", input, authorization);
```

An import or synchronization result either produces checksum-bound review staging or a validated aggregate snapshot. It never writes accepted Plan truth directly. See [Adapter authoring](https://github.com/Seyamalam/venue-mind/blob/main/docs/adapter-authoring.md).

## Compatibility

SDK, tool-contract, adapter-contract, Project-schema, and engine versions are separate. Pin the SDK range appropriate for the application and check declared compatibility before exchanging persisted data. See [Compatibility and deprecation](https://github.com/Seyamalam/venue-mind/blob/main/docs/compatibility-and-deprecation.md).
