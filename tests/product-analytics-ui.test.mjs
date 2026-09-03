import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Studio records the bounded golden-loop taxonomy and abandons only on page exit", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  for (const eventName of [
    "golden-loop.completed",
    "validation.completed",
    "adjustment.cycle",
    "branch.compared",
    "export.completed",
    "product.error",
  ])
    assert.match(app, new RegExp(`productAnalyticsEvent\\(\\"${eventName.replace(".", "\\.")}\\"`));
  assert.match(app, /window\.addEventListener\("pagehide", abandon\)/);
  assert.doesNotMatch(app, /return \(\) => \{[\s\S]{0,120}productAnalytics\.abandon\(\)/);
});

test("Settings exposes deterministic opt-in and aggregate admin metrics with terse boundaries", async () => {
  const settings = await readFile(new URL("../src/OrganizationSettings.tsx", import.meta.url), "utf8");
  for (const label of [
    "PRODUCT ANALYTICS",
    "OPT OUT",
    "OPT IN",
    "FRICTION ONLY",
    "AUTH NONE",
    "SUPERVISION UNCHANGED",
  ])
    assert.match(settings, new RegExp(label));
  assert.match(settings, /aria-pressed=\{analyticsPreference === "enabled"\}/);
  assert.match(settings, /loadProductAnalyticsMetrics\(organizationId\)/);
  assert.doesNotMatch(settings, /improve your|personalized|track you|learn more/i);
});
