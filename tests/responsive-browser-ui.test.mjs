import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("Studio has desktop edit, tablet decision, and mobile read-only boundaries", async () => {
  const [app, styles] = await Promise.all([read("../src/App.tsx"), read("../src/styles.css")]);
  assert.match(app, /const canEditLayout = workspaceViewport === "desktop"/);
  assert.match(app, /const canDecideProposal = workspaceViewport !== "mobile"/);
  assert.match(app, /data-workspace-mode={workspaceViewport}/);
  assert.match(app, /workspaceViewport === "mobile" && <span className="read-only-chip">READ ONLY/);
  assert.match(app, /canEditLayout && \(/);
  assert.match(app, /canDecideProposal\s*&&\s*\(?\s*<div className="decision-actions">/);
  assert.match(styles, /@media \(min-width: 768px\) and \(max-width: 1023px\)/);
  assert.match(styles, /grid-template-columns: minmax\(288px, 38vw\) minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /\.workspace-mobile :is\(\.decision-actions/);
  assert.match(styles, /\.workspace-tablet \.top-actions > \.edit-button/);
});

test("docs, dashboard, Studio, and shared review define narrow, coarse-pointer, and print behavior", async () => {
  const files = await Promise.all([
    read("../src/docs.css"),
    read("../src/project-dashboard.css"),
    read("../src/styles.css"),
    read("../src/shared-review.css"),
  ]);
  for (const source of files) {
    assert.match(source, /@media \(max-width:/);
    assert.match(source, /@media \(pointer: coarse\)/);
    assert.match(source, /@media print/);
  }
});

test("narrow docs and dashboard keep primary content clear of navigation chrome", async () => {
  const [docsPage, docsStyles, dashboardStyles] = await Promise.all([
    read("../components/docs/docs-page.tsx"),
    read("../src/docs.css"),
    read("../src/project-dashboard.css"),
  ]);
  assert.match(docsPage, /<Link href=\{\{ pathname: "\/docs" \}\} className="docs-brand">/);
  assert.match(docsPage, /<Link href=\{\{ pathname: "\/docs\/quickstart" \}\} className="docs-cta">/);
  assert.doesNotMatch(docsPage, /href=\{\{ pathname: "\/docs\/\[\[\.\.\.slug\]\]"/);
  assert.match(docsStyles, /@media \(max-width: 720px\)[\s\S]*\.docs-nav \{ display: none; \}/);
  assert.match(
    dashboardStyles,
    /@media \(max-width: 620px\)[\s\S]*\.projects-header nav \.organization-select, \.projects-header nav \.projects-source \{ display: none; \}/,
  );
});

test("touch targets remain at least 44px and mobile comments/editing are unavailable", async () => {
  const styles = await read("../src/styles.css");
  assert.match(styles, /@media \(pointer: coarse\)[\s\S]*min-height: 44px/);
  assert.match(styles, /\.proposal-shape \{[\s\S]*min-width: 44px;[\s\S]*min-height: 44px/);
  assert.match(
    styles,
    /\.workspace-mobile \.top-actions > \.comments-button,[\s\S]*\.workspace-mobile \.top-actions > \.edit-button/,
  );
  assert.match(styles, /\.workspace-mobile \.comments-panel \{\s*display: none/);
});

test("unsupported WebMCP is a non-failing fallback and local product controls remain mounted", async () => {
  const app = await read("../src/App.tsx");
  assert.match(app, /errorCode: "WEBMCP_UNSUPPORTED"/);
  assert.match(app, /state: "unregistered"/);
  assert.doesNotMatch(
    app,
    /state: "failed",\s*registered: 0,\s*total: venueToolContracts.length,\s*errorCode: "WEBMCP_UNSUPPORTED"/,
  );
  assert.match(app, /<main className="workspace">/);
});

test("clipboard operations use the shared native-to-legacy fallback", async () => {
  const [app, sharing, settings] = await Promise.all([
    read("../src/App.tsx"),
    read("../src/SharingControls.tsx"),
    read("../src/OrganizationSettings.tsx"),
  ]);
  for (const source of [app, sharing, settings]) assert.match(source, /writeClipboardText/);
  for (const source of [app, sharing, settings]) assert.doesNotMatch(source, /navigator\.clipboard\?\.writeText/);
});
