import assert from "node:assert/strict";
import test from "node:test";
import { AdapterContractError } from "../src/integrations/contracts.ts";
import { adapterHttpError, normalizeRetryAfter } from "../src/integrations/http-errors.ts";
import { createAdapterRuntime, createVenueAdapter } from "../src/integrations/runtime.ts";
import { createMemorySecretStore } from "../src/integrations/secret-store.ts";

test("normalizeRetryAfter accepts seconds or HTTP dates and applies the configured bound", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");
  assert.equal(normalizeRetryAfter("15", { now }), 15_000);
  assert.equal(normalizeRetryAfter("Fri, 28 Aug 2026 12:00:20 GMT", { now }), 20_000);
  assert.equal(normalizeRetryAfter("Fri, 28 Aug 2026 11:59:00 GMT", { now }), 0);
  assert.equal(normalizeRetryAfter("999999", { now, maximumRetryAfterMs: 7_500 }), 7_500);
  assert.equal(normalizeRetryAfter("not-a-date", { now }), 0);
});

test("adapterHttpError maps upstream failures to the runtime retry vocabulary", () => {
  const now = Date.parse("2026-08-28T12:00:00.000Z");
  const cases = [
    [new Response(null, { status: 429, headers: { "retry-after": "12" } }), "ADAPTER_RATE_LIMITED", { status: 429, retryAfterMs: 12_000 }],
    [new Response(null, { status: 408 }), "ADAPTER_NETWORK_ERROR", { status: 408 }],
    [new Response(null, { status: 503 }), "ADAPTER_UPSTREAM_UNAVAILABLE", { status: 503 }],
    [new Response(null, { status: 422 }), "ADAPTER_SOURCE_INVALID", { status: 422 }],
    [new Response(null, { status: 302 }), "ADAPTER_HANDLER_FAILED", { status: 302 }],
    [new TypeError("private network detail"), "ADAPTER_NETWORK_ERROR", {}],
    [Object.assign(new Error("cancelled"), { name: "AbortError" }), "ADAPTER_REQUEST_ABORTED", {}],
  ];
  for (const [input, code, details] of cases) {
    const error = adapterHttpError(input, { now });
    assert.equal(error.code, code);
    assert.deepEqual(error.details, details);
    assert.doesNotMatch(JSON.stringify(error), /private network detail/);
  }
});

test("adapterHttpError preserves an existing contract error and never reads response bodies", () => {
  const existing = new AdapterContractError("ADAPTER_SOURCE_INVALID", "Already normalized", { stable: true });
  assert.equal(adapterHttpError(existing), existing);
  let bodyRead = false;
  const response = {
    status: 429,
    headers: { get: () => "3" },
    text() { bodyRead = true; throw new Error("must not read"); },
  };
  const error = adapterHttpError(response);
  assert.equal(error.code, "ADAPTER_RATE_LIMITED");
  assert.equal(error.details.retryAfterMs, 3_000);
  assert.equal(bodyRead, false);
});

test("normalizeRetryAfter rejects unsafe configuration rather than creating unbounded waits", () => {
  assert.throws(() => normalizeRetryAfter("1", { maximumRetryAfterMs: -1 }), TypeError);
  assert.throws(() => normalizeRetryAfter("1", { maximumRetryAfterMs: 86_400_001 }), TypeError);
  assert.throws(() => normalizeRetryAfter("1", { now: Number.NaN }), TypeError);
});

test("classified HTTP failures are retried only by the adapter runtime", async () => {
  let calls = 0;
  let time = Date.parse("2026-08-28T12:00:00.000Z");
  const delays = [];
  const adapter = createVenueAdapter({
    contractVersion: 1,
    id: "http-helper-test",
    displayName: "HTTP Helper Test",
    version: "1.0.0",
    capabilities: ["import"],
    scopes: { import: ["records:read"] },
    retryPolicy: { maxAttempts: 2, initialDelayMs: 25, maximumDelayMs: 25, multiplier: 1, retryableCodes: ["ADAPTER_UPSTREAM_UNAVAILABLE"] },
    rateLimit: { requests: 10, windowMs: 1_000 },
  }, {
    async import() {
      calls += 1;
      if (calls === 1) throw adapterHttpError(new Response(null, { status: 503 }));
      return { sourceSystem: "fixture", sourceVersion: "1", synchronizedAt: "2026-08-28T12:00:00.000Z", syncCursor: null, changes: [], warnings: [] };
    },
  });
  const runtime = createAdapterRuntime({
    clock: () => time,
    sleep: async (milliseconds) => { delays.push(milliseconds); time += milliseconds; },
  });
  const result = await runtime.execute(adapter, "import", { basePlanVersion: "1.0", proposalRevision: 2 }, {
    grantedScopes: ["records:read"],
    secretStore: createMemorySecretStore(),
    secretReferences: [],
  });

  assert.equal(result.status, "succeeded");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [25]);
  assert.deepEqual(result.attempts.map((attempt) => attempt.status), ["retrying", "succeeded"]);
});
