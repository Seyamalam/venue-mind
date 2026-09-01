# Adapter authoring with `@venuemind/sdk`

VenueMind adapters normalize external systems into reviewable planning input or validated aggregate evidence. They do not write accepted Plan truth.

Import adapter primitives from `@venuemind/sdk/adapter`. Use `@venuemind/sdk/testkit` for deterministic stores, clocks, fixtures, and contract assertions.

## Lifecycle

1. Define a versioned adapter, its capabilities, scopes, retry policy, rate limit, and import result mode.
2. Normalize provider input before it enters invocation identity, checksums, storage, dead letters, or webhook evidence.
3. Read secrets through the scoped secret reader supplied in the handler context.
4. Return canonical Changes and mappings, or an adapter-specific aggregate snapshot with a deep result validator.
5. Execute through the adapter runtime so scope, idempotency, retries, rate limiting, durable receipt, and result integrity are enforced.
6. Load a reviewable staging result through the normal Proposal path. Human Approval remains a separate authenticated action.

An adapter is complete when duplicate delivery returns the original verified result, external and VenueMind IDs remain distinct, tampered stored evidence fails closed, and no accepted Plan changes before Approval.

## Define the contract

```ts
import {
  ADAPTER_CONTRACT_VERSION,
  createSyncCursor,
  createVenueAdapter,
  defineAdapter,
} from "@venuemind/sdk/adapter";

const definition = defineAdapter({
  contractVersion: ADAPTER_CONTRACT_VERSION,
  id: "venue-inventory",
  displayName: "Venue inventory",
  version: "1.0.0",
  capabilities: ["import", "synchronize", "webhook"],
  importResultMode: "reviewable-proposal",
  scopes: {
    import: ["inventory:read"],
    synchronize: ["inventory:read"],
    webhook: ["inventory:webhook"],
  },
  retryPolicy: {
    maxAttempts: 4,
    initialDelayMs: 100,
    maximumDelayMs: 800,
    multiplier: 2,
    retryableCodes: [
      "ADAPTER_NETWORK_ERROR",
      "ADAPTER_RATE_LIMITED",
      "ADAPTER_UPSTREAM_UNAVAILABLE",
    ],
  },
  rateLimit: { requests: 30, windowMs: 60_000 },
});
```

Adapter IDs are lowercase kebab-case. Adapter versions use semantic version syntax. Declare only implemented capabilities, and grant each capability the minimum provider scope it requires.

## Normalize before execution

Provider data is untrusted. Keep source payloads outside the adapter runtime until `prepareInput` has:

- selected an exact allowlist of fields;
- bounded arrays, strings, nesting, and payload size;
- converted timestamps to canonical representations;
- removed contact data and unnecessary person-level identity;
- separated provider IDs from VenueMind stable IDs;
- joined server-owned Project context through a trusted adapter context;
- rejected unknown fields.

The prepared input becomes the basis for the invocation ID and idempotency checksum. A field removed after that point can still leak through durable operational metadata, so privacy reduction belongs before runtime execution.

## Implement handlers

```ts
const adapter = createVenueAdapter(definition, {
  async import(input, context) {
    const token = await context.secrets.get("venue-inventory/api-token");
    const page = await provider.readInventory({ token, cursor: input.cursor });

    return {
      sourceSystem: input.sourceSystem,
      sourceVersion: page.version,
      synchronizedAt: context.clock(),
      syncCursor: await createSyncCursor(definition, {
        opaque: page.nextCursor ?? `complete-${page.version}`,
        sourceVersion: page.version,
      }),
      changes: await Promise.all(page.records.map(toCanonicalChange)),
      mappings: page.records.map(toExternalIdMapping),
      sourceRecords: page.records.map(toBoundedEvidence),
      warnings: page.warnings.map(toSafeWarning),
    };
  },

  async synchronize(input, context) {
    return synchronizeInventory(input, context);
  },

  async webhook(input) {
    return normalizeWebhook(input);
  },
});
```

Handlers receive scoped capabilities rather than the backing secret store. Results are normalized, checksum-bound, and revalidated before persistence and again when duplicates are returned.

## Reviewable Proposal mode

Use `reviewable-proposal` when imported data can affect Plan objects or structured Event Brief requirements. Every Change must use an explicit VenueMind entity type and retain external source evidence.

- Creates receive a separately allocated VenueMind stable ID.
- Updates and deletes reference an existing VenueMind stable ID.
- External IDs never become VenueMind object, template, Project, Requirement, Proposal, or Change IDs.
- Planning changes target one exact base Plan Version and Proposal revision.
- Project Object Instance changes carry executable spatial effects.
- Event Brief Requirement changes carry a closed, typed Planning Effect.
- A no-change result contains no Proposal.

Adapter Change evidence is bounded metadata, not a provider payload. `kind` is a lowercase kebab-case identifier of at most 80 characters. `sourceId` and each reference are lowercase opaque identifiers of at most 160 characters, starting with an ASCII letter or digit and continuing only with letters, digits, `.`, `_`, `:`, or `-`. Evidence may contain at most 20 unique references and one exact lowercase SHA-256 source checksum. Invalid identifiers are rejected before staging without being copied into error messages or details.

Review staging can enter the planner only through the canonical staging loader. Locks, stale base checks, Validation, human Approval, immutable Plan Versions, and Activity Ledger evidence still apply.

## Aggregate snapshot mode

Use `aggregate-snapshot` for operational read models that must remain outside accepted Plan truth. Supply `assertImportResult` and recompute the complete result from prepared input. Checking only the outer checksum is insufficient.

The validator must verify identity, Project and Plan binding, source version, timestamps, cursor, mappings, privacy boundaries, summaries, conflicts, options, and checksum. The runtime invokes it for new results, duplicates, and concurrent insert races.

## Idempotency and durable stores

Import and synchronization identity is derived from adapter ID, adapter version, capability, and normalized input. The processed-batch store must implement atomic `putIfAbsent`; a read followed by a write is not sufficient under concurrent delivery.

Production stores must survive process restarts and return the exact persisted value for both inserted and duplicate writes. The runtime revalidates stored output before returning it. Use memory stores only in tests and sandbox runs.

## Pagination and cursors

Treat a synchronization cursor as opaque provider progress wrapped with adapter ID, adapter version, source version, and checksum. Verify it before use. A cursor from another adapter version is incompatible unless that adapter explicitly migrates it.

Use `collectAdapterPages` to consume bounded pages. Each page must have a deterministic record order, a maximum item count, and either a next cursor or terminal state. The helper rejects repeated cursors, source-version drift, item overflow, page overflow, malformed pages, and cancellation so a faulty provider cannot create an infinite synchronization run.

Persist the final verified cursor only with the successful normalized result. A failed page does not advance durable progress.

## Retries and rate limits

Retry only error codes listed in the adapter definition. Convert provider HTTP failures with `adapterHttpError`; it maps network failures, timeouts, rate limits, provider rejections, and upstream outages to stable adapter codes and bounds `Retry-After`. The runtime applies bounded exponential backoff, honors that bounded provider delay, and stops at `maxAttempts`. Contract, scope, secret, checksum, privacy, and review-boundary failures are policy failures and return immediately.

An exhausted or non-retryable handler failure creates a bounded dead-letter record containing stable adapter identity, input checksum, attempt evidence, timestamp, and terminal code. It excludes provider payloads and secret values.

## Webhooks

Verify signatures over the raw request bytes before parsing JSON. `verifyWebhookHmac` supports an explicit SHA-256 HMAC encoding, prefix, and optional timestamp freshness window. Keep signature secrets behind the scoped secret reader and compare signatures through the constant-time cryptographic verification path.

Normalize the webhook envelope after signature verification and before acceptance. Its durable key includes adapter version, source system, and event ID. The webhook store must implement atomic `putIfAbsent`.

An exact replay returns the original event as a duplicate. Reusing an event ID with different normalized content fails closed. Validate the stored row and recompute its checksum before returning either an inserted or duplicate event.

Webhook acceptance records evidence; it does not bypass import normalization or Proposal review. If a webhook signals a planning-relevant change, synchronize the authoritative provider state and stage the resulting canonical change.

## Contract test matrix

At minimum, test:

- definition version, capability, scope, retry, and rate-limit validation;
- exact field allowlists and payload bounds;
- external ID and VenueMind stable-ID separation;
- new import, exact duplicate, concurrent duplicate, and tampered stored result;
- retryable, exhausted, non-retryable, and dead-letter paths;
- cursor checksum, repeated cursor, page ceiling, and adapter-version mismatch;
- webhook insert, exact replay, mismatched replay, and store integrity;
- secret-reference denial and absence of secret values in output or errors;
- privacy attacks in values, keys, nested records, warnings, and dead letters;
- review staging, stale base, Lock conflict, Validation, and human Approval boundary.

Finally, install the packed SDK into a clean temporary consumer, compile the example adapter with TypeScript, and run its contract suite against the matching sandbox. Repository-relative imports do not satisfy the public SDK completion gate.
