import assert from "node:assert/strict";
import test from "node:test";
import { createWorker } from "../dist/server/index.js";

const account = {
  session: {
    id: "session-private",
    userId: "user-private",
    createdAt: "2026-09-03T12:00:00.000Z",
    expiresAt: "2026-09-04T12:00:00.000Z",
    lastSeenAt: "2026-09-03T12:00:00.000Z",
    revokedAt: null,
  },
  user: {
    id: "user-private",
    email: "private@example.test",
    displayName: "PRIVATE",
    status: "active",
  },
  organizations: [
    {
      id: "org-private",
      name: "PRIVATE",
      slug: "private",
      roles: ["organization-administrator"],
    },
  ],
};

const limitedWorker = (blockedScope) => {
  const buckets = [];
  let downstreamFactories = 0;
  const api = createWorker({
    secureCookies: false,
    clock: () => "2026-09-03T12:00:30.000Z",
    createAccountRepository: () => ({ resolveSession: async () => account }),
    createProjectRepository: () => {
      downstreamFactories += 1;
      return {
        list: async () => [],
        get: async () => null,
        put: async () => {
          throw new Error("DOWNSTREAM_MUTATION_REACHED");
        },
      };
    },
    createRateLimitRepository: () => ({
      consume: async (input) => {
        buckets.push(input);
        return {
          allowed: input.scopeType !== blockedScope,
          count: input.maximum,
          maximum: input.maximum,
          expiresAt: input.expiresAt,
        };
      },
    }),
  });
  return { api, buckets, downstreamFactories: () => downstreamFactories };
};

const projectRequest = () =>
  new Request("https://example.test/api/projects/project-private", {
    method: "PUT",
    headers: {
      cookie: "venuemind_session=session-private",
      "content-type": "application/json",
      "if-none-match": "*",
      "x-venuemind-organization-id": "org-private",
    },
    body: "{}",
  });

test("Worker returns stable 429 and Retry-After for the identity bucket before downstream mutation", async () => {
  const worker = limitedWorker("identity");
  const response = await worker.api.fetch(projectRequest(), { DB: {} });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.deepEqual(await response.json(), {
    error: "API mutation rate limit exceeded",
    code: "RESOURCE_RATE_LIMITED",
    details: { endpointFamily: "project-writes", scope: "identity", windowSeconds: 60 },
  });
  assert.equal(worker.buckets.length, 1);
  assert.equal(worker.buckets[0].scopeType, "identity");
  assert.equal(worker.buckets[0].maximum, 60);
  assert.match(worker.buckets[0].scopeHash, /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(worker.buckets).includes("session-private"), false);
  assert.equal(worker.downstreamFactories(), 0);
});

test("Worker enforces the Organization bucket independently with opaque state", async () => {
  const worker = limitedWorker("organization");
  const response = await worker.api.fetch(projectRequest(), { DB: {} });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "30");
  assert.equal((await response.json()).details.scope, "organization");
  assert.deepEqual(
    worker.buckets.map((bucket) => [bucket.scopeType, bucket.maximum]),
    [
      ["identity", 60],
      ["organization", 600],
    ],
  );
  assert.notEqual(worker.buckets[0].scopeHash, worker.buckets[1].scopeHash);
  assert.equal(JSON.stringify(worker.buckets).includes("org-private"), false);
  assert.equal(worker.downstreamFactories(), 0);
});

test("health GET bypasses all mutation rate buckets", async () => {
  const worker = limitedWorker("identity");
  const response = await worker.api.fetch(new Request("https://example.test/api/health"), { DB: {} });
  assert.equal(response.status, 200);
  assert.equal(worker.buckets.length, 0);
  assert.equal(worker.downstreamFactories(), 0);
});
