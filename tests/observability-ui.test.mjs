import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Studio health is lazy, non-modal, and uses terse operational labels", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/HealthPanel.tsx", import.meta.url), "utf8");
  assert.match(app, /const LazyHealthPanel = lazy\(loadHealthPanel\)/);
  assert.match(app, />\s*HEALTH <span className="status-dot"/);
  assert.match(panel, /<Sheet[\s\S]+open=\{open\}[\s\S]+modal=\{false\}/);
  for (const label of ["HEALTH", "SAMPLES", "FAIL", "CNFL", "APRV", "METRICS", "ALERTS", "TRACE"])
    assert.match(panel, new RegExp(`(?:>|\")${label}(?:<|\")`));
  assert.doesNotMatch(panel, /Everything is|We noticed|Your project|Learn more|This means/i);
});
