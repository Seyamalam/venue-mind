import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("project sheets use a real link and a sibling shadcn actions menu", async () => {
  const source = await readFile(new URL("../src/ProjectDashboard.jsx", import.meta.url), "utf8");

  assert.doesNotMatch(source, /role="link"/);
  assert.doesNotMatch(source, /tabIndex=\{0\}/);
  assert.match(source, /className="project-sheet-link" href=\{projectHref\}/);
  assert.match(source, /<DropdownMenu>/);
  assert.match(source, /<DropdownMenuTrigger asChild>/);
  assert.match(source, /aria-label=\{`Project actions: \$\{project\.name\}`\}/);
});

test("the projects route defers the planner, lifecycle, and import engines", async () => {
  const source = await readFile(new URL("../src/ProjectDashboard.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /^import .*domain\/venue-planner\.js/m);
  assert.doesNotMatch(source, /^import .*domain\/project-lifecycle\.js/m);
  assert.doesNotMatch(source, /^import .*interchange\/venue-package\.js/m);
  assert.match(source, /import\("\.\/domain\/venue-planner\.js"\)/);
  assert.match(source, /await import\("\.\/domain\/project-lifecycle\.js"\)/);
  assert.match(source, /await import\("\.\/interchange\/venue-package\.js"\)/);
});
