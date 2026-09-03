import assert from "node:assert/strict";
import test from "node:test";
import {
  createMemoryAccountRepository,
  createMemoryProductAnalyticsRepository,
  createWorker,
} from "../dist/server/index.js";

const NOW = "2026-09-03T12:00:00.000Z";
const completion = {
  schemaVersion: 1,
  eventName: "golden-loop.completed",
  outcome: "completed",
  stage: "approve",
  errorCategory: null,
};

test("Worker records only exact aggregate events and exposes metrics to organization administrators", async () => {
  const accounts = createMemoryAccountRepository();
  const analytics = createMemoryProductAnalyticsRepository({ clock: () => NOW });
  const api = createWorker({
    secureCookies: false,
    clock: () => NOW,
    createAccountRepository: () => accounts,
    createProductAnalyticsRepository: () => analytics,
    telemetrySink: { emit: () => undefined },
  });
  const env = { DB: {}, VENUEMIND_AUTH_MODE: "anonymous-demo" };
  const sessionResponse = await api.fetch(new Request("https://example.test/api/session"), env);
  const session = await sessionResponse.json();
  const cookie = sessionResponse.headers.get("set-cookie").split(";")[0];
  const headers = {
    cookie,
    "content-type": "application/json",
    "x-venuemind-organization-id": session.activeOrganizationId,
  };
  for (let count = 0; count < 2; count += 1) {
    const response = await api.fetch(
      new Request("https://example.test/api/analytics/events", {
        method: "POST",
        headers,
        body: JSON.stringify(completion),
      }),
      env,
    );
    assert.equal(response.status, 202);
  }
  const invalid = await api.fetch(
    new Request("https://example.test/api/analytics/events", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...completion, projectId: "project-private" }),
    }),
    env,
  );
  assert.equal(invalid.status, 400);
  const response = await api.fetch(
    new Request("https://example.test/api/analytics/metrics?days=30", { headers }),
    env,
  );
  const metrics = await response.json();
  assert.equal(response.status, 200);
  assert.equal(metrics.totals[0].count, 2);
  assert.deepEqual(metrics.interpretation, {
    purpose: "friction-only",
    automationAuthority: "none",
    supervisionPolicy: "unchanged",
  });
  assert.doesNotMatch(
    JSON.stringify(metrics),
    /project-private|projectId|userId|objectId|scopeHash|url|geometry|comment|content|credential/i,
  );
});

test("Worker denies analytics metrics to non-administrators", async () => {
  const analytics = createMemoryProductAnalyticsRepository({ clock: () => NOW });
  const account = {
    session: { id: "session-viewer", userId: "user-viewer", expiresAt: "2026-09-04T12:00:00.000Z" },
    user: { id: "user-viewer", email: "viewer@example.test", displayName: "Viewer" },
    organizations: [{ id: "org-alpha", name: "Alpha", slug: "alpha", roles: ["viewer"] }],
  };
  const api = createWorker({
    clock: () => NOW,
    createAccountRepository: () => ({ resolveSession: async () => account }),
    createProductAnalyticsRepository: () => analytics,
    telemetrySink: { emit: () => undefined },
  });
  const response = await api.fetch(
    new Request("https://example.test/api/analytics/metrics", {
      headers: { cookie: "venuemind_session=session-viewer", "x-venuemind-organization-id": "org-alpha" },
    }),
    { DB: {} },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, "ANALYTICS_READ_DENIED");
});
