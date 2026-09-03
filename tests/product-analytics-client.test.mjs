import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductAnalyticsClient,
  loadProductAnalyticsMetrics,
  productAnalyticsEvent,
  productAnalyticsPreference,
  setProductAnalyticsPreference,
} from "../src/analytics/product-analytics-client.ts";

const completion = productAnalyticsEvent("golden-loop.completed", {
  outcome: "completed",
  stage: "approve",
  errorCategory: null,
});

test("analytics is disabled by default and opt-out prevents all requests", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let requests = 0;
  const client = createProductAnalyticsClient({
    organizationId: "org-private",
    storage,
    fetchImpl: async () => {
      requests += 1;
      return new Response(null, { status: 202 });
    },
  });
  assert.equal(productAnalyticsPreference(storage), "disabled");
  assert.equal(await client.capture(completion), false);
  setProductAnalyticsPreference(storage, "enabled");
  assert.equal(await client.capture(completion), true);
  setProductAnalyticsPreference(storage, "disabled");
  assert.equal(await client.capture(completion), false);
  assert.equal(requests, 1);
});

test("capture and abandonment send only the exact content-free event body", async () => {
  const bodies = [];
  const storage = { getItem: () => "enabled", setItem: () => undefined };
  const client = createProductAnalyticsClient({
    organizationId: "org-private",
    storage,
    fetchImpl: async (_input, init) => {
      bodies.push(JSON.parse(init.body));
      return new Response(null, { status: 202 });
    },
  });
  client.markStage("validate");
  assert.equal(await client.abandon(), true);
  assert.equal(await client.abandon(), false);
  assert.deepEqual(Object.keys(bodies[0]).sort(), ["errorCategory", "eventName", "outcome", "schemaVersion", "stage"]);
  assert.doesNotMatch(JSON.stringify(bodies), /org-private|project|user|object|url|geometry|comment|content|credential/i);
});

test("admin metrics decoding rejects expanded responses", async () => {
  const base = {
    schemaVersion: 1,
    windowDays: 30,
    fromDay: "2026-08-05",
    throughDay: "2026-09-03",
    totals: [{ ...completion, count: 2 }],
    interpretation: { purpose: "friction-only", automationAuthority: "none", supervisionPolicy: "unchanged" },
  };
  const metrics = await loadProductAnalyticsMetrics("org-private", async () => Response.json(base));
  assert.equal(metrics.totals[0].count, 2);
  await assert.rejects(
    () => loadProductAnalyticsMetrics("org-private", async () => Response.json({ ...base, projectId: "private" })),
    /PRODUCT_ANALYTICS_METRICS_INVALID/,
  );
});
