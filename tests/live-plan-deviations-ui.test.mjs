import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelUrl = new URL("../src/DeviationPanel.tsx", import.meta.url);
const appUrl = new URL("../src/App.tsx", import.meta.url);
const stylesUrl = new URL("../src/styles.css", import.meta.url);

test("Deviation Studio is lazy, non-modal, prop-driven, and stable-ID scoped", async () => {
  const [panel, app] = await Promise.all([readFile(panelUrl, "utf8"), readFile(appUrl, "utf8")]);

  for (const component of [
    "Badge",
    "Button",
    "Empty",
    "Field",
    "Input",
    "ScrollArea",
    "Select",
    "Separator",
    "Sheet",
    "Tabs",
    "ToggleGroup",
  ])
    assert.match(panel, new RegExp(`\\b${component}\\b`), component);
  assert.match(panel, /<Sheet open=\{open\}/);
  assert.match(panel, /modal=\{false\}/);
  assert.match(panel, /showOverlay=\{false\}/);
  assert.match(panel, /<SheetTitle asChild>/);
  assert.match(panel, /<SheetDescription className="sr-only">RECORD · LIVE · LEDGER<\/SheetDescription>/);
  assert.match(panel, /data-deviation-id=\{item\.id\}/);
  assert.match(panel, /data-ledger-id=\{entry\.id\}/);
  assert.match(panel, /<code>\{item\.id\}<\/code>/);
  assert.doesNotMatch(panel, /<(button|input|select|textarea)\b/);
  assert.doesNotMatch(panel, /Get started|You can|Please |This panel|Record a deviation to|Track changes/i);

  assert.match(app, /const loadDeviationPanel = \(\) => import\("\.\/DeviationPanel"\)/);
  assert.match(app, /const LazyDeviationPanel = lazy\(loadDeviationPanel\)/);
  assert.match(app, /deviationMounted\s*&&\s*\(\s*<Suspense/);
  assert.match(app, /<b>DEVIATIONS<\/b>/);
  assert.match(app, /<LazyDeviationPanel/);
});

test("Deviation Studio exposes record, end, post-event, recovery, sync, conflict, and export actions", async () => {
  const [panel, app] = await Promise.all([readFile(panelUrl, "utf8"), readFile(appUrl, "utf8")]);

  for (const action of [
    "onRecord",
    "onEnd",
    "onPostEvent",
    "onRecover",
    "onDiscardConflicts",
    "onSync",
    "onExport",
  ])
    assert.match(panel, new RegExp(`\\b${action}\\b`), action);
  for (const label of ["RECOVER", "DISCARD", "SYNC", "RECORD", "END", "POST-EVENT"])
    assert.match(panel, new RegExp(`>\\s*${label}\\s*<`), label);
  assert.match(panel, /onEnd\?\.\(\{\s*deviationId: item\.id,\s*expectedDeviationRevision: item\.revision,/);
  assert.match(panel, /onPostEvent\?\.\(endedCandidates\)/);
  assert.match(panel, /data-invalid=\{invalid && !objectId\}/);
  assert.match(panel, /aria-invalid=\{invalid && !reasonCode\(reason\)\}/);

  for (const command of [
    "record_live_plan_deviation",
    "end_live_plan_deviation",
    "create_post_event_deviation_proposal",
    "export_live_plan_deviations",
  ])
    assert.match(app, new RegExp(command), command);
  assert.match(app, /stableFingerprint\("live-deviation-id"/);
  assert.match(app, /location: \{ kind: "plan-object", planObjectId: input\.objectId \}/);
  assert.match(app, /availableConstraintIds: register\.baseline\.acceptedPlan\.constraints\.map/);
  assert.match(app, /deviationStore\.discardConflicts\(\)/);
  assert.match(app, /synchronizeDeviations\(\{/);
  assert.match(app, /deviationRemote\.export/);
});

test("Deviation Studio is viewport-safe and preserves coarse-pointer targets", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  assert.match(styles, /\.deviation-panel \{[^}]*width: min\(480px, calc\(100vw - 32px\)\)/s);
  assert.match(styles, /@media \(max-width: 880px\) \{[^}]*\.deviation-panel/s);
  assert.match(styles, /@media \(pointer: coarse\) \{[^}]*\.deviation-panel/s);
  assert.match(styles, /\.deviation-tabs \{[^}]*grid-template-rows: auto minmax\(0, 1fr\)/s);
});
