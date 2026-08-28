import assert from "node:assert/strict";
import test from "node:test";
import { AdapterContractError, sha256Checksum } from "../src/integrations/contracts.js";
import { createAdapterRuntime, createMemoryDeadLetterSink, createVenueAdapter, serializeDeadLetter } from "../src/integrations/runtime.js";
import { createMemorySecretStore } from "../src/integrations/secret-store.js";
import { roomInventoryAdapter } from "../src/integrations/adapters/room-inventory-adapter.js";

const secretStore = createMemorySecretStore({ "test/token": "secret", "room-inventory/api-token": "test-token" });
const auth = { grantedScopes: ["records:read"], secretStore, secretReferences: ["test/token"] };

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

const emptyImport = { sourceVersion: "1", syncCursor: null, changes: [], warnings: [] };

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
  const result = await runtime.execute(adapter, "import", { query: "chairs" }, auth);

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
  const input = { customer: "private", token: "must-not-be-stored" };
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
  await runtime.execute(adapter, "import", { page: 1 }, auth);
  await runtime.execute(adapter, "import", { page: 2 }, auth);
  await runtime.execute(adapter, "import", { page: 3 }, auth);
  assert.deepEqual(waits, [1_000]);
  assert.deepEqual(runtime.inspectRateLimit(adapter), [1_000]);
});

test("webhook delivery is idempotent and altered replay is rejected", async () => {
  const runtime = createAdapterRuntime({ clock: () => Date.parse("2026-08-28T12:00:00.000Z") });
  const webhookAuth = { grantedScopes: ["inventory:webhook"], secretStore, secretReferences: [] };
  const event = { id: "event-42", type: "inventory.updated", occurredAt: "2026-08-28T11:59:00.000Z", sourceVersion: "42", record: { externalId: "chair-7", quantity: 20 } };
  const first = await runtime.acceptWebhook(roomInventoryAdapter, event, webhookAuth);
  const duplicate = await runtime.acceptWebhook(roomInventoryAdapter, event, webhookAuth);
  assert.equal(first.status, "succeeded");
  assert.equal(duplicate.status, "duplicate");
  await assert.rejects(() => runtime.acceptWebhook(roomInventoryAdapter, { ...event, record: { ...event.record, quantity: 19 } }, webhookAuth), (error) => error.code === "ADAPTER_WEBHOOK_REPLAY_MISMATCH");
});
