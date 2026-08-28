import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import worker, { createWorker } from "../dist/server/index.js";

test("serves existing static assets without a fallback", async () => {
  const calls = [];
  const response = await worker.fetch(new Request("https://example.test/assets/app.js"), {
    ASSETS: {
      fetch: async (request) => {
        calls.push(new URL(request.url).pathname);
        return new Response("asset", { status: 200 });
      },
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/assets/app.js"]);
});

test("falls back to index.html for an unknown app route", async () => {
  const calls = [];
  const response = await worker.fetch(
    new Request("https://example.test/flow/step-two?source=share", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async (request) => {
          const url = new URL(request.url);
          calls.push(url.pathname + url.search);
          return new Response(url.pathname === "/index.html" ? "app" : "missing", {
            status: url.pathname === "/index.html" ? 200 : 404,
          });
        },
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["/flow/step-two?source=share", "/index.html"]);
});

test("does not turn missing API or write requests into the app shell", async () => {
  for (const [request, expectedAssetCalls, expectedStatus] of [
    [new Request("https://example.test/api/missing", { headers: { accept: "application/json" } }), 0, 401],
    [new Request("https://example.test/flow", { method: "POST", headers: { accept: "text/html" } }), 1, 404],
  ]) {
    let calls = 0;
    const response = await worker.fetch(request, {
      ASSETS: {
        fetch: async () => {
          calls += 1;
          return new Response("missing", { status: 404 });
        },
      },
    });

    assert.equal(response.status, expectedStatus);
    assert.equal(calls, expectedAssetCalls);
  }
});

test("persists and retrieves project state through the project repository seam", async () => {
  const records = new Map();
  const user = { id: "user-test", email: "test@example.com", displayName: "Test", status: "active" };
  const organizations = [{ id: "org-test", name: "Test", slug: "test", roles: ["organization-administrator"] }];
  const projectWorker = createWorker({
    secureCookies: false,
    identityProvider: { authenticate: () => ({ provider: "test", subject: "subject-test", email: user.email, displayName: user.displayName }) },
    createAccountRepository: () => ({
      resolveSession: async () => null,
      provision: async () => ({ user, organizations }),
      createSession: async () => ({ id: "session-test", userId: user.id, createdAt: "2026-08-27T00:00:00.000Z", expiresAt: "2026-08-28T00:00:00.000Z", lastSeenAt: "2026-08-27T00:00:00.000Z", revokedAt: null }),
    }),
    createProjectRepository: () => ({
      list: async (organizationId) => [...records.values()].filter((record) => record.organizationId === organizationId),
      get: async (organizationId, id) => records.get(`${organizationId}:${id}`) ?? null,
      put: async (organizationId, record, { createOnly = false, expectedRevision = null } = {}) => {
        const key = `${organizationId}:${record.id}`;
        const existing = records.get(key);
        if ((createOnly && existing) || (!createOnly && (!existing || existing.revision !== expectedRevision))) throw new Error("PROJECT_REVISION_CONFLICT");
        const saved = { ...record, revision: existing ? existing.revision + 1 : 1 };
        records.set(key, saved);
        return saved;
      },
    }),
  });
  const env = { ASSETS: { fetch: async () => new Response("missing", { status: 404 }) }, DB: {} };
  const record = {
    id: "project-summit-forward",
    name: "SummitForward 2026",
    activePlanId: "plan-summit-forward-2026",
    schemaVersion: 10,
    snapshot: { plan: { version: "3.2" }, proposal: {}, ledger: [] },
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };

  const saved = await projectWorker.fetch(new Request("https://example.test/api/projects/project-summit-forward", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-correlation-id": "corr-worker-001", "if-none-match": "*" },
    body: JSON.stringify(record),
  }), env);
  const loaded = await projectWorker.fetch(new Request("https://example.test/api/projects/project-summit-forward"), env);
  const listed = await projectWorker.fetch(new Request("https://example.test/api/projects"), env);

  assert.equal(saved.status, 201);
  assert.equal(saved.headers.get("x-correlation-id"), "corr-worker-001");
  assert.deepEqual(await loaded.json(), { ...record, organizationId: "org-test", revision: 1 });
  assert.equal((await listed.json()).projects.length, 1);

  const staleSchema = await projectWorker.fetch(new Request("https://example.test/api/projects/project-legacy", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...record, id: "project-legacy", schemaVersion: 9 }),
  }), env);
  assert.equal(staleSchema.status, 400);

  const conflict = await projectWorker.fetch(new Request("https://example.test/api/projects/project-summit-forward", {
    method: "PUT",
    headers: { "content-type": "application/json", "if-none-match": "*" },
    body: JSON.stringify(record),
  }), env);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "PROJECT_ID_CONFLICT");
});

test("emits the files required by Sites packaging", async () => {
  await access(new URL("../dist/client/index.html", import.meta.url));
  await access(new URL("../dist/server/index.js", import.meta.url));
  await access(new URL("../dist/.openai/hosting.json", import.meta.url));
});
