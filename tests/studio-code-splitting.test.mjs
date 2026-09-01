import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("optional Studio panels load behind React lazy boundaries", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  for (const moduleName of ["PlanEditor", "CommentsPanel", "ScenarioPanel"]) {
    assert.doesNotMatch(app, new RegExp(`^import .*${moduleName}\\.jsx`, "m"));
    assert.match(app, new RegExp(`lazy\\(\\(\\) => import\\("\\.\\/${moduleName}\\.jsx"\\)`));
  }
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
  assert.match(app, /<Sheet open=\{historyOpen\}/);
  assert.match(app, /showOverlay=\{false\}/);
  assert.match(app, /<Tabs className="history-tabs-shell" value=\{historyTab\}/);
  for (const value of ["versions", "ledger", "branches", "locks"]) {
    assert.match(app, new RegExp(`<TabsTrigger value="${value}"`));
  }
});

test("plan comparison mode uses a single-select shadcn toggle group", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /<ToggleGroup className="segmented-control" type="single" value=\{viewMode\}/);
  for (const value of ["before", "proposed", "split"]) {
    assert.match(app, new RegExp(`<ToggleGroupItem value="${value}"`));
  }
});
