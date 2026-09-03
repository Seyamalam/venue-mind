import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeProductAnalyticsEvent,
  productAnalyticsErrorCategory,
  productAnalyticsEventNames,
  productAnalyticsInterpretation,
  productAnalyticsRules,
} from "../src/analytics/product-analytics.ts";

const completion = {
  schemaVersion: 1,
  eventName: "golden-loop.completed",
  outcome: "completed",
  stage: "approve",
  errorCategory: null,
};

test("product analytics taxonomy is exhaustive, exact, and supervision-safe", () => {
  assert.deepEqual(Object.keys(productAnalyticsRules), [...productAnalyticsEventNames]);
  assert.deepEqual(decodeProductAnalyticsEvent(completion), completion);
  assert.deepEqual(productAnalyticsInterpretation, {
    purpose: "friction-only",
    automationAuthority: "none",
    supervisionPolicy: "unchanged",
  });
});

test("product analytics rejects content, identifiers, URLs, free text, and invalid combinations", () => {
  for (const extra of [
    { projectId: "project-private" },
    { userId: "user-private" },
    { objectId: "object-private" },
    { url: "https://private.example.test/studio/project-private" },
    { comment: "private note" },
    { geometry: { x: 1, y: 2 } },
  ])
    assert.throws(() => decodeProductAnalyticsEvent({ ...completion, ...extra }), /PRODUCT_ANALYTICS_EVENT_INVALID/);
  assert.throws(
    () => decodeProductAnalyticsEvent({ ...completion, eventName: "validation.completed", outcome: "completed" }),
    /PRODUCT_ANALYTICS_EVENT_INVALID/,
  );
  assert.throws(
    () => decodeProductAnalyticsEvent({ ...completion, eventName: "product.error", outcome: "error" }),
    /PRODUCT_ANALYTICS_EVENT_INVALID/,
  );
});

test("error classification collapses arbitrary errors into fixed non-content categories", () => {
  assert.equal(productAnalyticsErrorCategory({ code: "PROJECT_REVISION_CONFLICT" }), "conflict");
  assert.equal(productAnalyticsErrorCategory(new Error("private arbitrary message")), "unknown");
});
