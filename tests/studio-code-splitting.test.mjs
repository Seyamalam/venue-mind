import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const lazyBoundary = (mountedState) => new RegExp(`${mountedState}\\s*&&\\s*(?:\\(\\s*)?<Suspense`);
const prefetchHandler = (loader) =>
  new RegExp(`on(?:PointerEnter|Focus)=\\{\\(\\) => \\{\\s*void ${loader}\\(\\);\\s*\\}\\}`, "g");
const runtimeImport = (moduleName) => new RegExp(`^import\\s+(?!type\\b).*${moduleName}`, "m");
const openSheet = /<Sheet\s+open=\{open\}\s+onOpenChange=/;

test("optional Studio panels load behind React lazy boundaries", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, /^import .*PlanEditor/m);
  assert.match(app, /lazy\(\(\) => import\("\.\/PlanEditor"\)/);
  for (const moduleName of ["CommentsPanel", "ScenarioPanel", "HistoryPanel", "RunbookPanel"]) {
    assert.doesNotMatch(app, runtimeImport(moduleName));
    assert.match(app, new RegExp(`const load${moduleName} = \\(\\) => import\\("\\.\\/${moduleName}"\\)`));
    assert.match(app, new RegExp(`const Lazy${moduleName} = lazy\\(load${moduleName}\\)`));
  }
  assert.match(app, /<Suspense\b/);
});

test("comments and simulations use persistent non-modal shadcn sheets", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  for (const [moduleName, mountedState] of [
    ["CommentsPanel", "commentsMounted"],
    ["ScenarioPanel", "simulationMounted"],
  ]) {
    const panel = await readFile(new URL(`../src/${moduleName}.tsx`, import.meta.url), "utf8");
    assert.match(app, lazyBoundary(mountedState));
    const prefetches = app.match(prefetchHandler(`load${moduleName}`)) ?? [];
    assert.ok(prefetches.some((handler) => handler.startsWith("onPointerEnter=")));
    assert.ok(prefetches.some((handler) => handler.startsWith("onFocus=")));
    assert.match(panel, openSheet);
    assert.match(panel, /showOverlay=\{false\}/);
    assert.match(panel, /<SheetTitle asChild>/);
  }
});

test("Event Day Runbook is lazy, persistent, and opened from the OPS menu", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../src/RunbookPanel.tsx", import.meta.url), "utf8");
  assert.match(app, lazyBoundary("runbookMounted"));
  assert.match(app, /<LazyRunbookPanel/);
  assert.match(app, prefetchHandler("loadRunbookPanel"));
  assert.match(app, /<b>RUNBOOK<\/b>/);
  assert.match(panel, openSheet);
  assert.match(panel, /modal=\{false\}/);
  assert.match(panel, /showOverlay=\{false\}/);
});

test("Studio route avoids a delayed full-page streaming shell", async () => {
  const page = await readFile(new URL("../app/(workspace)/studio/[projectId]/page.tsx", import.meta.url), "utf8");
  const route = await readFile(new URL("../components/routes/studio-route.tsx", import.meta.url), "utf8");
  assert.match(page, /export const instant = false/);
  assert.doesNotMatch(route, /next\/dynamic/);
  await assert.rejects(readFile(new URL("../app/(workspace)/studio/[projectId]/loading.tsx", import.meta.url)), {
    code: "ENOENT",
  });
});

test("Studio human commands use the authenticated account identity", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /const studioActorId = account\?\.user\?\.id \?\? "studio-operator"/);
  assert.doesNotMatch(app, /actorId: "studio-operator"/);
});

test("annotation pins stay in the initial canvas without importing the comments panel", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const editor = await readFile(new URL("../src/PlanEditor.tsx", import.meta.url), "utf8");
  assert.match(app, /from "\.\/AnnotationPins"/);
  assert.match(editor, /from "\.\/AnnotationPins"/);
  assert.doesNotMatch(editor, /from "\.\/CommentsPanel"/);
});

test("plan history uses a non-modal shadcn sheet with accessible tabs", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const history = await readFile(new URL("../src/HistoryPanel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(app, runtimeImport("HistoryPanel"));
  assert.match(app, lazyBoundary("historyMounted"));
  assert.match(app, /<LazyHistoryPanel/);
  const historyPrefetches = app.match(prefetchHandler("loadHistoryPanel")) ?? [];
  assert.ok(historyPrefetches.some((handler) => handler.startsWith("onPointerEnter=")));
  assert.ok(historyPrefetches.some((handler) => handler.startsWith("onFocus=")));
  assert.match(history, openSheet);
  assert.match(history, /showOverlay=\{false\}/);
  assert.match(history, /<Tabs className="history-tabs-shell" value=\{tab\}/);
  for (const value of ["versions", "ledger", "branches", "locks"]) {
    assert.match(history, new RegExp(`<TabsTrigger value="${value}"`));
  }
});

test("plan comparison mode uses a single-select shadcn toggle group", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /<ToggleGroup\s+className="segmented-control"\s+type="single"\s+value=\{viewMode\}/);
  for (const value of ["before", "proposed", "split"]) {
    assert.match(app, new RegExp(`<ToggleGroupItem value="${value}"`));
  }
});

test("sharing panels defer heavy popover bodies until interaction", async () => {
  const controls = await readFile(new URL("../src/SharingControls.tsx", import.meta.url), "utf8");
  const panels = await readFile(new URL("../src/SharingPanels.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(controls, /import .*\bCheckbox\b/);
  assert.doesNotMatch(controls, /import .*\bPopoverContent\b/);
  assert.match(controls, /const loadSharingPanels = \(\) => import\("\.\/SharingPanels"\)/);
  assert.match(controls, lazyBoundary("shareMounted"));
  assert.match(controls, lazyBoundary("notificationMounted"));
  const sharingPrefetches = controls.match(prefetchHandler("loadSharingPanels")) ?? [];
  assert.equal(sharingPrefetches.filter((handler) => handler.startsWith("onPointerEnter=")).length, 2);
  assert.equal(sharingPrefetches.filter((handler) => handler.startsWith("onFocus=")).length, 2);
  assert.match(panels, /import \{ Checkbox \} from "\.\.\/components\/ui\/checkbox"/);
  assert.match(panels, /import \{ PopoverContent \} from "\.\.\/components\/ui\/popover"/);
});
