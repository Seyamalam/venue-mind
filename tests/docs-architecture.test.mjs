import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { docsPageBySlug, docsPages, publicDocsWorkflows } from "../src/docs/content.ts";
import { buildDocsNavigation, buildTableOfContents, getDocsNeighbors } from "../src/docs/navigation.ts";
import { buildDocsSearchIndex, nextSearchSelection, searchDocs } from "../src/docs/search.ts";
import { venueToolContracts } from "../src/contracts/venue-contracts.ts";

const publicFile = (pathname) => new URL(`../public${pathname}`, import.meta.url);
const docsLinks = docsPages.flatMap((page) => page.sections.flatMap((section) => section.blocks
  .filter((block) => block.type === "links")
  .flatMap((block) => block.items.map((item) => item.href))));

function assertDocsHref(href) {
  const url = new URL(href, "https://venuemind.test");
  const slug = url.pathname === "/docs" || url.pathname === "/docs/" ? "overview" : url.pathname.replace(/^\/docs\//, "");
  const page = docsPageBySlug[slug];
  assert.ok(page, `Missing docs page for ${href}`);
  if (url.hash) assert.ok(page.sections.some((section) => section.id === url.hash.slice(1)), `Missing anchor for ${href}`);
}

test("every page has stable public metadata, unique paths, and unique anchors", () => {
  assert.equal(new Set(docsPages.map((page) => page.canonicalPath)).size, docsPages.length);
  for (const page of docsPages) {
    assert.equal(typeof page.title, "string");
    assert.equal(typeof page.description, "string");
    assert.match(page.canonicalPath, /^\/docs(?:\/[a-z0-9-]+)?$/);
    assert.ok(page.audience.length > 0);
    assert.match(page.lastReviewedVersion, /^VenueMind /);
    assert.ok(page.compatibility.length > 0);
    assert.equal(new Set(page.sections.map((section) => section.id)).size, page.sections.length, `${page.slug} duplicate anchor`);
    assert.deepEqual(buildTableOfContents(page).map((item) => item.id), page.sections.map((section) => section.id));
  }
});

test("generated navigation and previous-next order cover every visible docs page exactly once", () => {
  const navigation = buildDocsNavigation(docsPages);
  const entries = navigation.flatMap((group) => group.pages);
  const visiblePages = docsPages.filter((page) => !page.navigation?.hidden);
  assert.deepEqual(entries.map((entry) => entry.slug), visiblePages.map((page) => page.slug));
  assert.equal(new Set(entries.map((entry) => entry.href)).size, visiblePages.length);
  for (const page of docsPages) {
    const sequence = page.navigation?.hidden
      ? docsPages.filter((candidate) => candidate.navigation?.hidden && candidate.navigation.collection === page.navigation.collection)
      : visiblePages;
    const index = sequence.findIndex((candidate) => candidate.slug === page.slug);
    const neighbors = getDocsNeighbors(docsPages, page.slug);
    assert.equal(neighbors.previous?.slug ?? null, sequence[index - 1]?.slug ?? null);
    assert.equal(neighbors.next?.slug ?? null, sequence[index + 1]?.slug ?? null);
  }
});

test("all structured documentation links resolve to a page, anchor, or published file", async () => {
  for (const href of [...docsLinks, ...publicDocsWorkflows.map((workflow) => workflow.href)]) {
    if (href.startsWith("/docs")) assertDocsHref(href);
    else if (href.startsWith("/")) await access(publicFile(href));
  }
});

test("every public contract, tool, skill, and workflow is reachable within two docs actions", async () => {
  const navigationPaths = new Set(buildDocsNavigation(docsPages).flatMap((group) => group.pages.map((page) => page.href)));
  for (const page of docsPages.filter((candidate) => !candidate.navigation?.hidden)) assert.ok(navigationPaths.has(page.canonicalPath));
  for (const page of docsPages.filter((candidate) => candidate.navigation?.hidden)) {
    const parent = docsPageBySlug[page.navigation.parentSlug];
    assert.ok(parent, `${page.slug} missing parent`);
    assert.ok(navigationPaths.has(parent.canonicalPath), `${page.slug} parent missing from navigation`);
    const parentLinks = new Set(parent.sections.flatMap((section) => section.blocks
      .filter((block) => block.type === "links")
      .flatMap((block) => block.items.map((item) => item.href))));
    assert.ok(parentLinks.has(page.canonicalPath), `${page.slug} missing from parent index`);
  }

  const toolIndex = docsPageBySlug["reference-tools"];
  const toolLinks = new Set(toolIndex.sections.flatMap((section) => section.blocks.flatMap((block) => block.type === "links" ? block.items.map((item) => item.href) : [])));
  for (const tool of venueToolContracts) {
    const path = `/docs/reference-tool-${tool.name.replaceAll(".", "-").replaceAll("_", "-")}`;
    assert.ok(toolLinks.has(path), tool.name);
  }

  const skillsManifest = JSON.parse(await readFile(new URL("../skills/manifest.json", import.meta.url), "utf8"));
  const skillTitles = new Set(docsPageBySlug.skills.sections.map((section) => section.title));
  for (const skill of skillsManifest.packages) assert.ok(skillTitles.has(skill.name), skill.name);

  const schemaFiles = (await readdir(new URL("../public/schemas/", import.meta.url))).filter((name) => name.endsWith(".json"));
  const contractHrefs = new Set(docsPageBySlug.contracts.sections.flatMap((section) => section.blocks
    .filter((block) => block.type === "links")
    .flatMap((block) => block.items.map((item) => item.href))));
  for (const file of schemaFiles) assert.ok(contractHrefs.has(`/schemas/${file}`), file);
  for (const workflow of publicDocsWorkflows) assertDocsHref(workflow.href);
});

test("search indexes every heading and supports wrapped keyboard selection", () => {
  const index = buildDocsSearchIndex(docsPages);
  assert.equal(index.length, docsPages.length + docsPages.reduce((total, page) => total + page.sections.length, 0));
  assert.equal(searchDocs(index, "temporary ramp")[0].href, "/docs/concepts#access-infrastructure");
  assert.equal(searchDocs(index, "venue.preview_revision").some((result) => result.href === "/docs/reference-tool-venue-preview-revision"), true);
  assert.equal(nextSearchSelection(-1, "ArrowDown", 3), 0);
  assert.equal(nextSearchSelection(2, "ArrowDown", 3), 0);
  assert.equal(nextSearchSelection(0, "ArrowUp", 3), 2);
  assert.equal(nextSearchSelection(-1, "ArrowDown", 0), -1);
});

test("generated public metadata contains every canonical docs route", async () => {
  const manifest = JSON.parse(await readFile(publicFile("/docs-manifest.json"), "utf8"));
  const searchIndex = JSON.parse(await readFile(publicFile("/docs-search.json"), "utf8"));
  const sitemap = await readFile(publicFile("/sitemap.xml"), "utf8");
  const robots = await readFile(publicFile("/robots.txt"), "utf8");
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.pages.map((page) => page.canonicalPath), docsPages.map((page) => page.canonicalPath));
  assert.equal(searchIndex.schemaVersion, 1);
  assert.deepEqual(searchIndex.entries, buildDocsSearchIndex(docsPages));
  for (const page of docsPages) assert.match(sitemap, new RegExp(`${page.canonicalPath.replaceAll("/", "\\/")}<`));
  assert.match(robots, /Sitemap: https:\/\/venue-mind-jet\.vercel\.app\/sitemap\.xml/);
});

test("Next docs keep content on the server and isolate search in shadcn primitives", async () => {
  const pageSource = await readFile(new URL("../app/docs/[[...slug]]/page.tsx", import.meta.url), "utf8");
  const contentSource = await readFile(new URL("../components/docs/docs-page.tsx", import.meta.url), "utf8");
  const triggerSource = await readFile(new URL("../components/docs/docs-interactions.tsx", import.meta.url), "utf8");
  const paletteSource = await readFile(new URL("../components/docs/docs-search-palette.tsx", import.meta.url), "utf8");
  const copySource = await readFile(new URL("../components/docs/docs-copy-buttons.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(pageSource, /DocsApp|DocsRoute|ssr:\s*false/);
  assert.match(triggerSource, /dynamic\(loadDocsSearchPalette/);
  assert.match(triggerSource, /import\("@\/components\/docs\/docs-search-palette"\)/);
  assert.doesNotMatch(triggerSource, /components\/ui\/(?:dialog|command)/);
  assert.match(triggerSource, /on(?:Focus|PointerEnter)=\{\(\) => \{ void loadDocsSearchPalette\(\); \}\}/);
  assert.match(triggerSource, /fetch\("\/docs-search\.json"/);
  assert.match(paletteSource, /from "@\/components\/ui\/dialog"/);
  assert.match(paletteSource, /from "@\/components\/ui\/command"/);
  for (const primitive of ["DialogContent", "CommandInput", "CommandList", "CommandItem"]) {
    assert.match(paletteSource, new RegExp(`<${primitive}\\b`));
  }
  assert.match(paletteSource, /shouldFilter=\{false\}/);
  assert.match(paletteSource, /\bloop\b/);
  assert.doesNotMatch(copySource, /components\/ui\/(?:dialog|command)|docs-search-palette/);
  assert.match(contentSource, /docs-copy-buttons/);
});
