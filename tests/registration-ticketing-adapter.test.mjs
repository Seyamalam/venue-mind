import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AdapterContractError, defineAdapter, sha256Checksum } from "../src/integrations/contracts.js";
import { assertRegistrationSnapshot, registrationTicketingAdapter } from "../src/integrations/adapters/registration-ticketing-adapter.js";
import { createMemoryProcessedBatchStore } from "../src/integrations/processed-batch-store.js";
import { createAdapterRuntime, createMemoryDeadLetterSink, serializeDeadLetter } from "../src/integrations/runtime.js";
import { createMemorySecretStore } from "../src/integrations/secret-store.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/adapter-registration-ticketing-v1.json", import.meta.url), "utf8"));
const webhookFixture = JSON.parse(await readFile(new URL("./fixtures/adapter-registration-ticketing-webhook-v1.json", import.meta.url), "utf8"));
const secretStore = createMemorySecretStore({ "registration-ticketing/api-token": "test-token" });
const authorization = { grantedScopes: ["registration:aggregate:read"], secretStore, secretReferences: ["registration-ticketing/api-token"] };
const webhookAuthorization = { ...authorization, grantedScopes: ["registration:aggregate:webhook"] };
const clock = () => Date.parse("2026-08-28T12:00:00.000Z");

const reverseEveryCollection = (input) => {
  const value = structuredClone(input);
  value.projectOccupancy.zones.reverse();
  value.ticketClasses.reverse();
  for (const ticketClass of value.ticketClasses) {
    ticketClass.zoneAllocations.reverse();
    ticketClass.accessRequirementCodes.reverse();
  }
  value.accessibilityRequirements.reverse();
  for (const requirement of value.accessibilityRequirements) requirement.zoneIds.reverse();
  value.checkIn.counts.reverse();
  return value;
};

test("ticket-class totals reconcile with Project occupancy using aggregate-only evidence", async () => {
  const result = await createAdapterRuntime({ clock }).execute(registrationTicketingAdapter, "import", structuredClone(fixture), authorization);
  assert.equal(result.status, "succeeded");
  assert.equal(registrationTicketingAdapter.definition.importResultMode, "aggregate-snapshot");
  assert.equal(result.output.status, "reconciled");
  assert.equal(result.output.reconciliation.status, "pass");
  assert.equal(result.output.reconciliation.ticketClassTotal, 400);
  assert.equal(result.output.reconciliation.projectAttendeeTarget, 400);
  assert.equal(result.output.reconciliation.ticketDelta, 0);
  assert.equal(result.output.reconciliation.attendanceForecastTotal, 388);
  assert.deepEqual(result.output.reconciliation.zones, [{
    zoneId: "zone-keynote-floor",
    minimumCapacity: 390,
    maximumCapacity: 410,
    ticketedCount: 400,
    attendanceForecast: 388,
    ticketClassIds: ["registration-prod:accessible-admission", "registration-prod:general-admission"],
    status: "within-limit",
  }]);
  assert.ok(result.output.reconciliation.accessibility.every((requirement) => requirement.status === "covered"));
  assert.equal(result.output.checkIn.total, 200);
  assert.deepEqual(result.output.checkIn.byTicketClass.map((item) => item.ticketClassId), ["registration-prod:accessible-admission", "registration-prod:general-admission"]);
  assert.deepEqual(result.output.privacy, { mode: "aggregate-only", attendeeIdentityStored: false, individualCheckInStored: false, freeFormAccessibilityStored: false });
  assert.ok(result.output.ticketClasses.every((ticketClass) => ticketClass.ticketClassId.startsWith("registration-prod:")));
  assert.ok(result.output.ticketClasses.every((ticketClass) => !Object.hasOwn(ticketClass, "externalId")));
  const { id: _id, status: _status, checksum, ...content } = result.output;
  assert.equal(checksum, await sha256Checksum(content));
  assert.doesNotMatch(JSON.stringify(result.output), /@|\+1 555|barcode|order-|medical-condition|private note/i);
});

test("normalized aggregate ordering produces one checksum and one processed result", async () => {
  const processedBatchStore = createMemoryProcessedBatchStore();
  const runtime = createAdapterRuntime({ clock, processedBatchStore });
  const first = await runtime.execute(registrationTicketingAdapter, "synchronize", structuredClone(fixture), authorization);
  const second = await runtime.execute(registrationTicketingAdapter, "synchronize", reverseEveryCollection(fixture), authorization);
  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "duplicate");
  assert.equal(second.invocationId, first.invocationId);
  assert.equal(second.output.checksum, first.output.checksum);
  assert.equal(second.output.id, first.output.id);
  assert.equal(processedBatchStore.list().length, 1);
});

test("person-level fields are rejected before invocation, hashing, storage, or dead-lettering", async () => {
  const personalMutations = [
    (value) => { value.attendees = [{ id: "attendee-private" }]; },
    (value) => { value.ticketClasses[0].name = "Private Person"; },
    (value) => { value.ticketClasses[0].email = "private@example.test"; },
    (value) => { value.ticketClasses[0].phone = "+1 555 010 1000"; },
    (value) => { value.ticketClasses[0].address = "Private address"; },
    (value) => { value.checkIn.counts[0].barcode = "barcode-private"; },
    (value) => { value.checkIn.counts[0].orderId = "order-private"; },
    (value) => { value.checkIn.counts[0].payment = { token: "payment-private" }; },
    (value) => { value.accessibilityRequirements[0].medicalCondition = "medical-condition-private"; },
    (value) => { value.accessibilityRequirements[0].accessibilityNote = "private note"; },
  ];
  for (const mutate of personalMutations) {
    const processedBatchStore = createMemoryProcessedBatchStore();
    const deadLetterSink = createMemoryDeadLetterSink();
    let invoked = 0;
    const guardedAdapter = { ...registrationTicketingAdapter, async invoke(...args) { invoked += 1; return registrationTicketingAdapter.invoke(...args); } };
    const runtime = createAdapterRuntime({ clock, processedBatchStore, deadLetterSink });
    const input = structuredClone(fixture);
    mutate(input);
    await assert.rejects(() => runtime.execute(guardedAdapter, "import", input, authorization), (error) => error instanceof AdapterContractError && error.code === "ADAPTER_PERSONAL_DATA_REJECTED" && !JSON.stringify(error).includes("private@example.test"));
    assert.equal(invoked, 0);
    assert.deepEqual(processedBatchStore.list(), []);
    assert.deepEqual(deadLetterSink.list(), []);
  }
});

test("contact-shaped values are rejected without echoing their content", async () => {
  for (const sourceVersion of ["private@example.test", "+1 555 010 1000"]) {
    await assert.rejects(() => createAdapterRuntime({ clock }).execute(registrationTicketingAdapter, "import", { ...structuredClone(fixture), sourceVersion }, authorization), (error) => error.code === "ADAPTER_PERSONAL_DATA_REJECTED" && !JSON.stringify(error).includes(sourceVersion));
  }
});

test("foreign zones, unbounded counts, allocation drift, and invalid event-day input fail closed", async () => {
  const cases = [
    [{ ...structuredClone(fixture), ticketClasses: structuredClone(fixture.ticketClasses).map((item, index) => index === 0 ? { ...item, zoneAllocations: [{ ...item.zoneAllocations[0], zoneId: "zone-foreign" }] } : item) }, "ADAPTER_ZONE_MAPPING_INVALID"],
    [{ ...structuredClone(fixture), projectOccupancy: { ...fixture.projectOccupancy, attendeeTarget: 1_000_001 } }, "ADAPTER_SOURCE_INVALID"],
    [{ ...structuredClone(fixture), ticketClasses: structuredClone(fixture.ticketClasses).map((item) => ({ ...item, ticketedCount: 600_000, attendanceForecast: 500_000, zoneAllocations: [{ ...item.zoneAllocations[0], ticketedCount: 600_000, attendanceForecast: 500_000 }] })), checkIn: { ...fixture.checkIn, counts: [] } }, "ADAPTER_SOURCE_INVALID"],
    [{ ...structuredClone(fixture), ticketClasses: structuredClone(fixture.ticketClasses).map((item, index) => index === 0 ? { ...item, ticketedCount: item.ticketedCount + 1 } : item) }, "ADAPTER_TICKET_TOTAL_MISMATCH"],
    [{ ...structuredClone(fixture), eventDayMode: false }, "ADAPTER_EVENT_DAY_REQUIRED"],
    [{ ...structuredClone(fixture), checkIn: { ...fixture.checkIn, counts: [{ ticketClassId: "general-admission", count: 361 }] } }, "ADAPTER_CHECK_IN_INVALID"],
  ];
  for (const [input, code] of cases) await assert.rejects(() => createAdapterRuntime({ clock }).execute(registrationTicketingAdapter, "import", input, authorization), (error) => error.code === code);
});

test("occupancy and accessibility mismatches remain explicit aggregate reconciliation issues", async () => {
  const input = structuredClone(fixture);
  input.ticketClasses[0].ticketedCount = 350;
  input.ticketClasses[0].zoneAllocations[0].ticketedCount = 350;
  input.ticketClasses[1].accessRequirementCodes = [];
  input.checkIn.counts[0].count = 170;
  const result = await createAdapterRuntime({ clock }).execute(registrationTicketingAdapter, "import", input, authorization);
  assert.equal(result.output.status, "attention-required");
  assert.equal(result.output.reconciliation.ticketClassTotal, 390);
  assert.equal(result.output.reconciliation.ticketDelta, -10);
  assert.deepEqual(result.output.reconciliation.issues.map((issue) => issue.code), ["ACCESS_REQUIREMENT_UNDER_MAPPED", "ACCESS_REQUIREMENT_UNDER_MAPPED", "TICKET_TOTAL_MISMATCH"]);
});

test("aggregate check-in webhook storage is sanitized, deterministic, and replay-safe", async () => {
  const runtime = createAdapterRuntime({ clock });
  const first = await runtime.acceptWebhook(registrationTicketingAdapter, structuredClone(webhookFixture), webhookAuthorization);
  const duplicate = await runtime.acceptWebhook(registrationTicketingAdapter, reverseEveryCollection(webhookFixture), webhookAuthorization);
  assert.equal(first.status, "succeeded");
  assert.equal(duplicate.status, "duplicate");
  assert.equal(first.output.checksum, duplicate.output.checksum);
  assert.equal(first.output.payload.checkIn.total, 200);
  assert.equal(first.output.payload.privacy.mode, "aggregate-only");
  assert.doesNotMatch(JSON.stringify(first.output), /email|phone|address|barcode|orderId|payment|medicalCondition|accessibilityNote/);
  const altered = structuredClone(webhookFixture);
  altered.checkIn.counts[0].count += 1;
  await assert.rejects(() => runtime.acceptWebhook(registrationTicketingAdapter, altered, webhookAuthorization), (error) => error.code === "ADAPTER_WEBHOOK_REPLAY_MISMATCH");
});

test("dead letters retain only normalized aggregate checksums and never source content", async () => {
  const deadLetterSink = createMemoryDeadLetterSink();
  const failingAdapter = {
    definition: registrationTicketingAdapter.definition,
    prepareInput: registrationTicketingAdapter.prepareInput,
    async invoke() { throw new AdapterContractError("ADAPTER_UPSTREAM_UNAVAILABLE", "Unavailable"); },
  };
  const result = await createAdapterRuntime({ clock, sleep: async () => {}, deadLetterSink }).execute(failingAdapter, "import", structuredClone(fixture), authorization);
  assert.equal(result.status, "dead-lettered");
  assert.equal(deadLetterSink.list().length, 1);
  const serialized = serializeDeadLetter(result.deadLetter);
  assert.doesNotMatch(serialized, /registration-prod|general-admission|accessible-admission|project-summit-forward|api-token/);
  assert.match(result.deadLetter.inputChecksum, /^[0-9a-f]{64}$/);
});

test("runtime rejects unvalidated, invalid, and tampered aggregate snapshot results", async () => {
  const aggregateDefinition = defineAdapter({
    contractVersion: 1,
    id: "aggregate-contract-test",
    displayName: "Aggregate Contract Test",
    version: "1.0.0",
    capabilities: ["import"],
    importResultMode: "aggregate-snapshot",
    scopes: { import: ["registration:aggregate:read"] },
    retryPolicy: { maxAttempts: 1, initialDelayMs: 0, maximumDelayMs: 0, multiplier: 1, retryableCodes: [] },
    rateLimit: { requests: 10, windowMs: 1_000 },
  });
  await assert.rejects(() => createAdapterRuntime({ clock }).execute({ definition: aggregateDefinition, async invoke() { return {}; } }, "import", {}, authorization), (error) => error.code === "ADAPTER_CONTRACT_INVALID");
  await assert.rejects(() => createAdapterRuntime({ clock }).execute({ definition: aggregateDefinition, assertImportResult: assertRegistrationSnapshot, async invoke() { return {}; } }, "import", {}, authorization), (error) => error.code === "ADAPTER_CONTRACT_INVALID");

  let stored = null;
  const tamperableStore = {
    async get() { return stored ? structuredClone(stored) : null; },
    async putIfAbsent(_key, value) { if (stored) return { inserted: false, value: structuredClone(stored) }; stored = structuredClone(value); return { inserted: true, value: structuredClone(value) }; },
  };
  const runtime = createAdapterRuntime({ clock, processedBatchStore: tamperableStore });
  assert.equal((await runtime.execute(registrationTicketingAdapter, "import", structuredClone(fixture), authorization)).status, "succeeded");
  stored.output.reconciliation.ticketClassTotal += 1;
  await assert.rejects(() => runtime.execute(registrationTicketingAdapter, "import", structuredClone(fixture), authorization), (error) => error.code === "ADAPTER_CHECKSUM_MISMATCH");
});
