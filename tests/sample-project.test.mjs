import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { isSampleProject, resolveStudioProjectId, SAMPLE_PROJECT_ROUTE } from "../src/domain/sample-project.ts";

test("guest sample identity is stable within an Organization and distinct across Organizations", () => {
  const first = resolveStudioProjectId(SAMPLE_PROJECT_ROUTE, "org-guest-one");
  const second = resolveStudioProjectId(SAMPLE_PROJECT_ROUTE, "org-guest-two");
  assert.notEqual(first, second);
  assert.notEqual(first, SAMPLE_PROJECT_ROUTE);
  assert.equal(first, resolveStudioProjectId(SAMPLE_PROJECT_ROUTE, "org-guest-one"));
  assert.equal(isSampleProject(first, "org-guest-one"), true);
  assert.equal(isSampleProject(first, "org-guest-two"), false);
  assert.equal(resolveStudioProjectId(first, "org-guest-one"), first);
  assert.equal(resolveStudioProjectId("project-customer", "org-guest-one"), "project-customer");
  assert.throws(() => resolveStudioProjectId(SAMPLE_PROJECT_ROUTE, ""), TypeError);
});

test("Studio resolves the sample after WorkspaceGate supplies the Organization", async () => {
  const runtime = await readFile(new URL("../components/routes/studio-runtime.tsx", import.meta.url), "utf8");
  assert.match(runtime, /resolveStudioProjectId\(projectId, workspace\.organizationId\)/);
});
