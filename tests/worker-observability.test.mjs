import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryAccountRepository,
  createMemoryObservabilityRepository,
  createWorker,
} from "../dist/server/index.js";

test("Worker propagates safe correlation and exposes bounded authenticated diagnostics", async () => {
  const accounts = createMemoryAccountRepository();
  const repository = createMemoryObservabilityRepository({ clock: () => "2026-09-03T05:00:00.000Z" });
  const lines = [];
  const api = createWorker({
    secureCookies: false,
    clock: () => "2026-09-03T05:00:00.000Z",
    createAccountRepository: () => accounts,
    createProjectRepository: () => ({
      list: async () => [],
      get: async () => null,
      put: async () => {
        throw new Error("unused");
      },
    }),
    createObservabilityRepository: () => repository,
    telemetrySink: { emit: (event) => lines.push(JSON.stringify(event)) },
  });
  const env = { DB: {}, VENUEMIND_AUTH_MODE: "anonymous-demo" };
  const response = await api.fetch(
    new Request("https://example.test/api/projects", {
      headers: { "x-correlation-id": "corr-worker-safe-001", "x-debug-value": "secret@example.test" },
    }),
    env,
  );
  const diagnostics = await api.fetch(new Request("https://example.test/api/diagnostics/health"), env);
  const trace = await api.fetch(new Request("https://example.test/api/diagnostics/traces/corr-worker-safe-001"), env);

  assert.equal(response.headers.get("x-correlation-id"), "corr-worker-safe-001");
  assert.equal(diagnostics.status, 200);
  assert.ok((await diagnostics.json()).metrics.some((metric) => metric.operation === "request"));
  assert.ok((await trace.json()).events.some((event) => event.component === "api"));
  assert.doesNotMatch(lines.join("\n"), /secret@example\.test|x-debug-value|cookie|authorization/i);
});

test("Worker replaces unsafe caller correlation before logging or response", async () => {
  const lines = [];
  const api = createWorker({ telemetrySink: { emit: (event) => lines.push(JSON.stringify(event)) } });
  const response = await api.fetch(
    new Request("https://example.test/api/health", {
      headers: { "x-correlation-id": "email@example.test secret" },
    }),
    { DB: {} },
  );
  assert.match(response.headers.get("x-correlation-id"), /^corr-[0-9a-f-]+$/);
  assert.doesNotMatch(lines.join("\n"), /email@example\.test|secret/);
});
