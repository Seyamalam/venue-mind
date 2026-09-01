import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Next routes own only the CSS required by their runtime", async () => {
  const [workspaceLayout, shareLayout, studio, review, gate] = await Promise.all([
    read("../app/(workspace)/layout.tsx"),
    read("../app/share/layout.tsx"),
    read("../src/App.jsx"),
    read("../src/SharedReview.jsx"),
    read("../src/auth/WorkspaceGate.jsx"),
  ]);

  assert.doesNotMatch(workspaceLayout, /src\/styles\.css/);
  assert.doesNotMatch(shareLayout, /src\/styles\.css/);
  assert.match(studio, /import "\.\/styles\.css"/);
  assert.match(review, /import "\.\/shared-review\.css"/);
  assert.match(gate, /import "\.\/workspace-gate\.css"/);
});
