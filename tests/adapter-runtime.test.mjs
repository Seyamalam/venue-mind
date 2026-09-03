import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AdapterContractError, sha256Checksum } from "../src/integrations/contracts.ts";
import { createAdapterRuntime, createMemoryDeadLetterSink, createVenueAdapter, serializeDeadLetter } from "../src/integrations/runtime.ts";
import { createMemoryProcessedBatchStore } from "../src/integrations/processed-batch-store.ts";
import { createMemorySecretStore } from "../src/integrations/secret-store.ts";
import { roomInventoryAdapter } from "../src/integrations/adapters/room-inventory-adapter.ts";
import { createMemoryWebhookEventStore } from "../src/integrations/webhook-event-store.ts";

const secretStore = createMemorySecretStore({ "test/token": "secret", "room-inventory/api-token": "test-token" });
const auth = { grantedScopes: ["records:read"], secretStore, secretReferences: ["test/token"] };
const webhookFixture = JSON.parse(await readFile(new URL("./fixtures/adapter-room-inventory-webhook-v1.json", import.meta.url), "utf8"));

const definition = (overrides = {}) => ({
  contractVersion: 1,
  id: "test-adapter",
  displayName: "Test Adapter",
  version: "1.0.0",
  capabilities: ["import"],
  scopes: { import: ["records:read"] },
  retryPolicy: { maxAttempts: 3, initialDelayMs: 100, maximumDelayMs: 400, multiplier: 2, retryableCodes: ["ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"] },
  rateLimit: { requests: 10, windowMs: 1_000 },
  ...overrides,
});

const emptyImport = { sourceSystem: "test-source", sourceVersion: "1", synchronizedAt: "2026-08-28T12:00:00.000Z", syncCursor: null, changes: [], warnings: [] };
const stagingInput = (input = {}) => ({ basePlanVersion: "1.0", proposalRevision: 2, ...input });

test("retry timing is deterministic, honors Retry-After, and succeeds without dead-lettering", async () => {
  let time = Date.parse("2026-08-28T12:00:00.000Z");
  const delays = [];
  let calls = 0;
  const adapter = createVenueAdapter(definition(), {
    async import() {
      calls += 1;
      if (calls === 1) throw new AdapterContractError("ADAPTER_RATE_LIMITED", "Slow down", { retryAfterMs: 150 });
      if (calls === 2) throw new AdapterContractError("ADAPTER_UPSTREAM_UNAVAILABLE", "Unavailable");
      return emptyImport;
    },
  });
  const deadLetters = createMemoryDeadLetterSink();
  const runtime = createAdapterRuntime({ clock: () => time, sleep: async (milliseconds) => { delays.push(milliseconds); time += milliseconds; }, deadLetterSink: deadLetters });
  const result = await runtime.execute(adapter, "import", stagingInput({ query: "chairs" }), auth);

  assert.equal(result.status, "succeeded");
  assert.deepEqual(delays, [150, 200]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["retrying", "retrying", "succeeded"]);
  assert.deepEqual(deadLetters.list(), []);
});

test("terminal failures create a deterministic, secret-free dead letter", async () => {
  const time = Date.parse("2026-08-28T12:00:00.000Z");
  const deadLetters = createMemoryDeadLetterSink();
  const adapter = createVenueAdapter(definition({ retryPolicy: { maxAttempts: 2, initialDelayMs: 10, maximumDelayMs: 10, multiplier: 2, retryableCodes: ["ADAPTER_UPSTREAM_UNAVAILABLE"] } }), {
    async import(_input, context) {
      assert.equal(await context.secrets.get("test/token"), "secret");
      throw new AdapterContractError("ADAPTER_UPSTREAM_UNAVAILABLE", "Unavailable");
    },
  });
  const runtime = createAdapterRuntime({ clock: () => time, sleep: async () => {}, deadLetterSink: deadLetters });
  const input = stagingInput({ customer: "private", token: "must-not-be-stored" });
  const result = await runtime.execute(adapter, "import", input, auth);

  assert.equal(result.status, "dead-lettered");
  assert.equal(result.attempts.length, 2);
  assert.equal(result.deadLetter.inputChecksum, await sha256Checksum(input));
  assert.equal(deadLetters.list().length, 1);
  assert.doesNotMatch(serializeDeadLetter(result.deadLetter), /private|must-not-be-stored|secret/);
  assert.equal(result.deadLetter.id, `${result.invocationId}-dead-letter`);
});

test("rate limits use a deterministic rolling window", async () => {
  let time = 0;
  const waits = [];
  const adapter = createVenueAdapter(definition({ rateLimit: { requests: 2, windowMs: 1_000 } }), { async import() { return emptyImport; } });
  const runtime = createAdapterRuntime({ clock: () => time, sleep: async (milliseconds) => { waits.push(milliseconds); time += milliseconds; } });
  await runtime.execute(adapter, "import", stagingInput({ page: 1 }), auth);
  await runtime.execute(adapter, "import", stagingInput({ page: 2 }), auth);
  await runtime.execute(adapter, "import", stagingInput({ page: 3 }), auth);
  assert.deepEqual(waits, [1_000]);
  assert.deepEqual(runtime.inspectRateLimit(adapter), [1_000]);
});

test("reviewable Proposal validators run for fresh, duplicate, and atomic-race results", async () => {
  const events = [];
  const reviewableImport = {
    ...emptyImport,
    changes: [{
      id: "change-reviewable-chair",
      operation: "create",
      venueEntityType: "project-object-instance",
      proposedVenueObjectId: "obj-reviewable-chair",
      external: { adapterId: "test-adapter", sourceSystem: "test-source", entityType: "inventory-record", externalId: "chair-1", sourceVersion: "1", checksum: "a".repeat(64) },
      values: { kind: "chair", label: "Review chair", layer: "furniture", elevationM: 0, locked: false, footprint: { kind: "circle", center: { x: 1, y: 1 }, radius: 0.25 } },
    }],
  };
  const memoryStore = createMemoryProcessedBatchStore();
  const processedBatchStore = {
    async get(key) {
      events.push("get");
      return memoryStore.get(key);
    },
    async putIfAbsent(key, value) {
      events.push("put");
      return memoryStore.putIfAbsent(key, value);
    },
  };
  const baseAdapter = createVenueAdapter(definition(), { async import() { return reviewableImport; } });
  const adapter = Object.freeze({
    ...baseAdapter,
    async assertImportResult(output, context) {
      events.push("validate");
      assert.equal(output.status, "awaiting-review");
      assert.equal(output.proposal.status, "review");
      assert.equal(context.capability, "import");
      assert.equal(context.preparedInput.basePlanVersion, "1.0");
    },
  });
  const runtime = createAdapterRuntime({ clock: () => Date.parse("2026-08-28T12:00:00.000Z"), processedBatchStore });

  const first = await runtime.execute(adapter, "import", stagingInput({ page: 1 }), auth);
  assert.equal(first.status, "succeeded");
  assert.deepEqual(events, ["get", "validate", "put", "validate"]);

  const duplicate = await runtime.execute(adapter, "import", stagingInput({ page: 1 }), auth);
  assert.equal(duplicate.status, "duplicate");
  assert.deepEqual(events, ["get", "validate", "put", "validate", "get", "validate"]);

  const raceEvents = [];
  const raceAdapter = Object.freeze({
    ...baseAdapter,
    async assertImportResult() { raceEvents.push("validate"); },
  });
  const raceStore = {
    async get() {
      raceEvents.push("get");
      return null;
    },
    async putIfAbsent(_key, value) {
      raceEvents.push("put");
      return { inserted: false, value: structuredClone(value) };
    },
  };
  const raced = await createAdapterRuntime({ clock: () => Date.parse("2026-08-28T12:00:00.000Z"), processedBatchStore: raceStore }).execute(raceAdapter, "import", stagingInput({ page: 2 }), auth);
  assert.equal(raced.status, "duplicate");
  assert.deepEqual(raceEvents, ["get", "validate", "put", "validate"]);
});

test("webhook delivery is idempotent and altered replay is rejected", async () => {
  const runtime = createAdapterRuntime({ clock: () => Date.parse("2026-08-28T12:00:00.000Z"), webhookEventStore: createMemoryWebhookEventStore() });
  const webhookAuth = { grantedScopes: ["inventory:webhook"], secretStore, secretReferences: [] };
  const event = structuredClone(webhookFixture);
  const first = await runtime.acceptWebhook(roomInventoryAdapter, event, webhookAuth);
  const duplicate = await runtime.acceptWebhook(roomInventoryAdapter, event, webhookAuth);
  assert.equal(first.status, "succeeded");
  assert.equal(first.output.sourceSystem, webhookFixture.sourceSystem);
  assert.equal(first.output.sourceVersion, webhookFixture.sourceVersion);
  assert.match(first.output.checksum, /^[0-9a-f]{64}$/);
  assert.equal(duplicate.status, "duplicate");
  await assert.rejects(() => runtime.acceptWebhook(roomInventoryAdapter, { ...event, record: { ...event.record, quantity: 19 } }, webhookAuth), (error) => error.code === "ADAPTER_WEBHOOK_REPLAY_MISMATCH");
});
