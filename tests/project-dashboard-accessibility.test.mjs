import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("project sheets use a real link and a sibling shadcn actions menu", async () => {
  const source = await readFile(new URL("../src/ProjectDashboard.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /role="link"/);
  assert.doesNotMatch(source, /tabIndex=\{0\}/);
  assert.match(source, /<a\s+[\s\S]{0,240}?className="project-sheet-link"[\s\S]{0,120}?href=\{projectHref\}/);
  assert.match(source, /<DropdownMenu>/);
  assert.match(source, /<DropdownMenuTrigger asChild>/);
  assert.match(source, /aria-label=\{`Project actions: \$\{project\.name\}`\}/);
});

test("the projects route defers the planner, lifecycle, and import engines", async () => {
  const source = await readFile(new URL("../src/ProjectDashboard.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import\s+(?!type\b).*domain\/venue-planner/m);
  assert.doesNotMatch(source, /^import\s+(?!type\b).*domain\/project-lifecycle/m);
  assert.doesNotMatch(source, /^import\s+(?!type\b).*interchange\/venue-package/m);
  assert.match(source, /import\("\.\/domain\/venue-planner"\)/);
  assert.match(source, /await import\("\.\/domain\/project-lifecycle"\)/);
  assert.match(source, /await import\("\.\/interchange\/venue-package"\)/);
});

test("rename and delete use controlled shadcn dialogs instead of browser prompts", async () => {
  const source = await readFile(new URL("../src/ProjectDashboard.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /window\.prompt/);
  assert.match(source, /<Dialog\s+open=\{Boolean\(renameTarget\)\}/);
  assert.match(source, /<AlertDialog\s+open=\{Boolean\(deleteTarget\)\}/);
  assert.match(source, /value=\{renameValue\}\s+onChange=/);
  assert.match(source, /value=\{deleteConfirmation\}\s+onChange=/);
  assert.match(source, /deleteConfirmation !== deleteTarget\?\.name/);
});
