import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelUrl = new URL("../src/OccupancyPanel.jsx", import.meta.url);
const stylesUrl = new URL("../src/styles.css", import.meta.url);

test("Live Occupancy uses one non-modal shadcn operational surface with no raw controls or narrative copy", async () => {
  const source = await readFile(panelUrl, "utf8");
  for (const component of ["Badge", "Button", "Empty", "Field", "Input", "Progress", "ScrollArea", "Select", "Separator", "Sheet", "Tabs"]) assert.match(source, new RegExp(`\\b${component}\\b`), component);
  assert.match(source, /<Sheet open=\{open\}/);
  assert.match(source, /modal=\{false\}/);
  assert.match(source, /showOverlay=\{false\}/);
  assert.match(source, /<SheetTitle asChild>/);
  assert.match(source, /<SheetDescription className="sr-only">COUNTS · ALERTS · LEDGER<\/SheetDescription>/);
  assert.match(source, /<SelectGroup>/);
  assert.doesNotMatch(source, /<(button|input|select|textarea)\b/);
  assert.doesNotMatch(source, /Get started|You can|Please |This monitor|Create a monitor to|Track attendees/i);
});

test("Live Occupancy exposes exact operational states, aggregate input, acknowledgements, sync, and export", async () => {
  const source = await readFile(panelUrl, "utf8");
  for (const status of ["unavailable", "nominal", "warning", "exceeded", "conflicting", "stale"]) assert.match(source, new RegExp(`\\b${status}\\b`));
  for (const view of ["scopes", "sources", "alerts", "ledger"]) assert.match(source, new RegExp(`<TabsTrigger value="${view}">`));
  for (const action of ["onCreate", "onIngest", "onRefresh", "onAcknowledge", "onSync", "onExport"]) assert.match(source, new RegExp(`\\b${action}\\b`));
  assert.match(source, /onIngest\?\.\(\{ sourceId, sourceType, kind, confidence, readings:/);
  assert.match(source, /onAcknowledge\?\.\(\{ alertId: alert\.id, reasonCode:/);
  assert.match(source, /role=\{projection\.overallStatus === "exceeded" \? "alert" : "status"\}/);
  assert.match(source, /aria-live=\{projection\.overallStatus === "exceeded" \? "assertive" : "polite"\}/);
});

test("Live Occupancy panel is lazy, opened from OPS, and viewport safe", async () => {
  const [app, styles] = await Promise.all([readFile(new URL("../src/App.jsx", import.meta.url), "utf8"), readFile(stylesUrl, "utf8")]);
  assert.match(app, /const loadOccupancyPanel = \(\) => import\("\.\/OccupancyPanel\.jsx"\)/);
  assert.match(app, /const LazyOccupancyPanel = lazy\(loadOccupancyPanel\)/);
  assert.match(app, /occupancyMounted && <Suspense/);
  assert.match(app, /<b>OCCUPANCY<\/b>/);
  assert.match(styles, /\.occupancy-panel \{[^}]*width: min\(480px, calc\(100vw - 32px\)\)/s);
  assert.match(styles, /@media \(max-width: 880px\) \{[^}]*\.occupancy-panel/s);
  assert.match(styles, /@media \(pointer: coarse\) \{[^}]*\.occupancy-panel :is\(/s);
});
