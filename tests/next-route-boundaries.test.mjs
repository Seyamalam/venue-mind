import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("App Router segments own error and loading boundaries", async () => {
  for (const path of [
    "app/(workspace)/error.tsx",
    "app/(workspace)/studio/[projectId]/error.tsx",
    "app/docs/error.tsx",
    "app/share/error.tsx",
    "app/(workspace)/settings/[[...section]]/loading.tsx",
  ]) await access(new URL(path, root));

  for (const path of ["app/global-error.tsx", "app/(workspace)/error.tsx", "app/(workspace)/studio/[projectId]/error.tsx", "app/docs/error.tsx", "app/share/error.tsx"]) {
    assert.match(await read(path), /from "@\/components\/ui\/button"/);
  }
});

test("private workspaces and docs publish route-owned metadata", async () => {
  const [rootLayout, docsLayout, docsPage, settingsPage, studioPage] = await Promise.all([
    read("app/layout.tsx"),
    read("app/docs/layout.tsx"),
    read("app/docs/[[...slug]]/page.tsx"),
    read("app/(workspace)/settings/[[...section]]/page.tsx"),
    read("app/(workspace)/studio/[projectId]/page.tsx"),
  ]);
  assert.match(rootLayout, /process\.env\.VENUEMIND_PUBLIC_ORIGIN/);
  assert.match(docsLayout, /%s · VenueMind Docs/);
  assert.match(docsPage, /openGraph:/);
  assert.match(docsPage, /twitter:/);
  assert.match(settingsPage, /robots: \{ index: false, follow: false \}/);
  assert.match(studioPage, /robots: \{ index: false, follow: false \}/);
});
