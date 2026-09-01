import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("optional Studio panels load behind React lazy boundaries", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  for (const moduleName of ["PlanEditor", "CommentsPanel", "ScenarioPanel"]) {
    assert.doesNotMatch(app, new RegExp(`^import .*${moduleName}\\.jsx`, "m"));
    assert.match(app, new RegExp(`lazy\\(\\(\\) => import\\("\\.\\/${moduleName}\\.jsx"\\)`));
  }
  assert.doesNotMatch(app, /^import .*HistoryPanel\.jsx/m);
  assert.match(app, /const loadHistoryPanel = \(\) => import\("\.\/HistoryPanel\.jsx"\)/);
  assert.match(app, /const LazyHistoryPanel = lazy\(loadHistoryPanel\)/);
  assert.match(app, /<Suspense\b/);
});

test("annotation pins stay in the initial canvas without importing the comments panel", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const editor = await readFile(new URL("../src/PlanEditor.jsx", import.meta.url), "utf8");
  assert.match(app, /from "\.\/AnnotationPins\.jsx"/);
  assert.match(editor, /from "\.\/AnnotationPins\.jsx"/);
  assert.doesNotMatch(editor, /from "\.\/CommentsPanel\.jsx"/);
});

test("plan history uses a non-modal shadcn sheet with accessible tabs", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const history = await readFile(new URL("../src/HistoryPanel.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /^import .*HistoryPanel\.jsx/m);
  assert.match(app, /historyMounted && <Suspense/);
  assert.match(app, /<LazyHistoryPanel/);
  assert.match(app, /onPointerEnter=\{loadHistoryPanel\}/);
  assert.match(app, /onFocus=\{loadHistoryPanel\}/);
  assert.match(history, /<Sheet open=\{open\} onOpenChange=/);
  assert.match(history, /showOverlay=\{false\}/);
  assert.match(history, /<Tabs className="history-tabs-shell" value=\{tab\}/);
  for (const value of ["versions", "ledger", "branches", "locks"]) {
    assert.match(history, new RegExp(`<TabsTrigger value="${value}"`));
  }
});

test("plan comparison mode uses a single-select shadcn toggle group", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /<ToggleGroup className="segmented-control" type="single" value=\{viewMode\}/);
  for (const value of ["before", "proposed", "split"]) {
    assert.match(app, new RegExp(`<ToggleGroupItem value="${value}"`));
  }
});

test("sharing panels defer heavy popover bodies until interaction", async () => {
  const controls = await readFile(new URL("../src/SharingControls.jsx", import.meta.url), "utf8");
  const panels = await readFile(new URL("../src/SharingPanels.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(controls, /import .*\bCheckbox\b/);
  assert.doesNotMatch(controls, /import .*\bPopoverContent\b/);
  assert.match(controls, /const loadSharingPanels = \(\) => import\("\.\/SharingPanels\.jsx"\)/);
  assert.match(controls, /shareMounted && <Suspense/);
  assert.match(controls, /notificationMounted && <Suspense/);
  assert.equal((controls.match(/onPointerEnter=\{loadSharingPanels\}/g) ?? []).length, 2);
  assert.equal((controls.match(/onFocus=\{loadSharingPanels\}/g) ?? []).length, 2);
  assert.match(panels, /import \{ Checkbox \} from "\.\.\/components\/ui\/checkbox"/);
  assert.match(panels, /import \{ PopoverContent \} from "\.\.\/components\/ui\/popover"/);
});
