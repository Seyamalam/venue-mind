import assert from "node:assert/strict";
import test from "node:test";
import { createWorker } from "../dist/server/index.js";
import { VENUE_RESOURCE_LIMITS } from "../src/security/resource-limits.ts";

const projectUrl = "https://example.test/api/projects/project-resource-limit";

const createResourceWorker = () => {
  let mutations = 0;
  const api = createWorker({
    secureCookies: false,
    createAccountRepository: () => {
      throw new Error("ACCOUNT_REPOSITORY_MUST_NOT_BE_REACHED");
    },
    createProjectRepository: () => ({
      list: async () => [],
      get: async () => null,
      put: async () => {
        mutations += 1;
        throw new Error("PROJECT_REPOSITORY_MUST_NOT_MUTATE");
      },
    }),
  });
  return { api, mutations: () => mutations };
};

const request = (body, headers = {}) =>
  new Request(projectUrl, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-none-match": "*", ...headers },
    body,
  });

test("Worker rejects API JSON resource overruns with stable safe 413 metadata before repositories", async (t) => {
  const cases = [];

  let nested = { leaf: true };
  for (let index = 0; index <= VENUE_RESOURCE_LIMITS.maximumJsonDepth; index += 1) nested = { child: nested };
  cases.push({ resource: "depth", body: JSON.stringify(nested) });

  cases.push({
    resource: "nodes",
    body: JSON.stringify(
      Array.from({ length: 100 }, () => Array.from({ length: 1_000 }, () => 0)),
    ),
  });
  cases.push({
    resource: "array-items",
    body: JSON.stringify(Array.from({ length: VENUE_RESOURCE_LIMITS.maximumArrayItems + 1 }, () => 0)),
  });
  cases.push({
    resource: "object-keys",
    body: JSON.stringify(
      Object.fromEntries(
        Array.from({ length: VENUE_RESOURCE_LIMITS.maximumObjectKeys + 1 }, (_, index) => [`key${index}`, index]),
      ),
    ),
  });

  for (const value of cases) {
    await t.test(value.resource, async () => {
      const worker = createResourceWorker();
      const response = await worker.api.fetch(request(value.body), { DB: {} });
      const payload = await response.json();
      assert.equal(response.status, 413);
      assert.equal(payload.code, "RESOURCE_LIMIT_EXCEEDED");
      assert.deepEqual(Object.keys(payload.details).sort(), ["actual", "maximum", "resource", "surface"]);
      assert.equal(payload.details.surface, "api-request");
      assert.equal(payload.details.resource, value.resource);
      assert.equal(Number.isSafeInteger(payload.details.actual), true);
      assert.equal(Number.isSafeInteger(payload.details.maximum), true);
      assert.equal(worker.mutations(), 0);
    });
  }

  await t.test("bytes", async () => {
    const worker = createResourceWorker();
    const response = await worker.api.fetch(
      request("{}", { "content-length": String(VENUE_RESOURCE_LIMITS.apiRequestBytes + 1) }),
      { DB: {} },
    );
    const payload = await response.json();
    assert.equal(response.status, 413);
    assert.equal(payload.code, "RESOURCE_LIMIT_EXCEEDED");
    assert.deepEqual(payload.details, {
      surface: "api-request",
      resource: "bytes",
      actual: VENUE_RESOURCE_LIMITS.apiRequestBytes + 1,
      maximum: VENUE_RESOURCE_LIMITS.apiRequestBytes,
    });
    assert.equal(worker.mutations(), 0);
  });
});

test("Worker distinguishes malformed JSON as a safe 400 before repositories", async () => {
  const worker = createResourceWorker();
  const response = await worker.api.fetch(request('{"broken":'), { DB: {} });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Invalid JSON body", code: "INVALID_JSON" });
  assert.equal(worker.mutations(), 0);
});
