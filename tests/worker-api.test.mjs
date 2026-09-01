import assert from "node:assert/strict";
import test from "node:test";
import worker, { createMemoryAccountRepository, createWorker } from "../dist/server/index.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";

test("exposes an unauthenticated API health check and no frontend", async () => {
  const env = { DB: {} };
  const health = await worker.fetch(new Request("https://example.test/api/health"), env);
  const frontend = await worker.fetch(new Request("https://example.test/"), env);

  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: "ok", service: "venue-mind-api" });
  assert.equal(frontend.status, 404);
  assert.equal((await frontend.json()).code, "API_ROUTE_REQUIRED");
});

test("accepts mutations only from the configured Vercel origin", async () => {
  const accounts = createMemoryAccountRepository();
  const api = createWorker({ secureCookies: false, createAccountRepository: () => accounts });
  const env = { DB: {}, VENUEMIND_AUTH_MODE: "anonymous-demo", VENUEMIND_APP_ORIGINS: "https://venue-mind-jet.vercel.app" };
  const allowed = await api.fetch(new Request("https://api.example.test/api/session/revoke", { method: "POST", headers: { origin: "https://venue-mind-jet.vercel.app" } }), env);
  const denied = await api.fetch(new Request("https://api.example.test/api/session/revoke", { method: "POST", headers: { origin: "https://attacker.example" } }), env);

  assert.equal(allowed.status, 200);
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).code, "ORIGIN_DENIED");
});

test("persists and retrieves project state through the API repository seam", async () => {
  const records = new Map();
  const user = { id: "user-test", email: "test@example.com", displayName: "Test", status: "active" };
  const organizations = [{ id: "org-test", name: "Test", slug: "test", roles: ["organization-administrator"] }];
  const api = createWorker({
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
  const env = { DB: {} };
  const planner = createVenuePlanner(summitForwardPlan);
  const record = {
    id: "project-summit-forward",
    name: "SummitForward 2026",
    activePlanId: planner.getSnapshot().plan.id,
    schemaVersion: 10,
    snapshot: structuredClone(planner.getSnapshot()),
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };

  const saved = await api.fetch(new Request("https://example.test/api/projects/project-summit-forward", {
    method: "PUT",
    headers: { "content-type": "application/json", "x-correlation-id": "corr-worker-001", "if-none-match": "*" },
    body: JSON.stringify(record),
  }), env);
  const loaded = await api.fetch(new Request("https://example.test/api/projects/project-summit-forward"), env);
  const listed = await api.fetch(new Request("https://example.test/api/projects"), env);

  assert.equal(saved.status, 201);
  assert.equal(saved.headers.get("x-correlation-id"), "corr-worker-001");
  assert.deepEqual(await loaded.json(), { ...record, organizationId: "org-test", revision: 1 });
  assert.equal((await listed.json()).projects.length, 1);

  const conflict = await api.fetch(new Request("https://example.test/api/projects/project-summit-forward", {
    method: "PUT",
    headers: { "content-type": "application/json", "if-none-match": "*" },
    body: JSON.stringify(record),
  }), env);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "PROJECT_ID_CONFLICT");
});
