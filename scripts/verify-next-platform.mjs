import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

const routeManifestPaths = Object.freeze({
  docs: ".next/server/app/docs/[[...slug]]/page_client-reference-manifest.js",
  projects: ".next/server/app/(workspace)/projects/page_client-reference-manifest.js",
  settings: ".next/server/app/(workspace)/settings/[[...section]]/page_client-reference-manifest.js",
  share: ".next/server/app/share/[token]/page_client-reference-manifest.js",
  studio: ".next/server/app/(workspace)/studio/[projectId]/page_client-reference-manifest.js",
});

export function parseClientReferenceManifest(source) {
  const assignment = source.match(/\]\s*=\s*(\{.*\});?\s*$/su);
  assert.ok(assignment?.[1], "client-reference manifest assignment missing");
  const parsed = JSON.parse(assignment[1]);
  assert.equal(typeof parsed, "object");
  assert.notEqual(parsed, null);
  return parsed;
}

const modules = (manifest) => Object.keys(manifest.clientModules);

export function extractScriptSources(html) {
  return [...html.matchAll(/<script[^>]+src="([^"]+)"/gu)].map((match) => match[1]);
}

async function clientPayload(htmlPath) {
  const html = await readFile(new URL(htmlPath, root), "utf8");
  const sources = extractScriptSources(html);
  const chunks = await Promise.all(
    sources.map((source) => readFile(new URL(`.next${source.replace(/^\/_next/u, "")}`, root), "utf8")),
  );
  return { sources, code: chunks.join("\n") };
}

export async function verifyNextPlatform() {
  const manifests = Object.fromEntries(
    await Promise.all(
      Object.entries(routeManifestPaths).map(async ([name, path]) => [
        name,
        parseClientReferenceManifest(await readFile(new URL(path, root), "utf8")),
      ]),
    ),
  );
  const routeModules = Object.fromEntries(Object.entries(manifests).map(([name, manifest]) => [name, modules(manifest)]));

  assert.ok(routeModules.studio.some((name) => /components\/routes\/studio-route\.tsx$/u.test(name)));
  const [docsPayload, studioPayload] = await Promise.all([
    clientPayload(".next/server/app/docs.html"),
    clientPayload(".next/server/app/index.html"),
  ]);
  for (const signature of ["inspect_layout", "preview_revision", "validate_layout", "PROJECT_CACHE_CORRUPT"])
    assert.equal(docsPayload.code.includes(signature), false, `docs client bundle includes Studio signature ${signature}`);
  for (const signature of ["inspect_layout", "preview_revision", "validate_layout"])
    assert.equal(studioPayload.code.includes(signature), true, `Studio client bundle omits planner signature ${signature}`);

  const [packageSource, nextSource, workerSource] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("next.config.ts", root), "utf8"),
    readFile(new URL("wrangler.jsonc", root), "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.scripts.dev, "next dev");
  assert.equal(packageJson.scripts["build:next"], "next build");
  assert.equal("vite" in packageJson.dependencies, false);
  assert.equal("vite" in packageJson.devDependencies, false);
  assert.match(nextSource, /VENUEMIND_API_ORIGIN/);
  assert.match(nextSource, /destination: `\$\{apiOrigin\}\/api/);
  assert.doesNotMatch(workerSource, /"assets"|"site"|pages_build_output_dir/u);
  assert.match(workerSource, /"binding": "DB"/);

  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(tracked.filter((path) => /(?:^|\/)vite(?:\.|\/)|\.(?:js|jsx)$/u.test(path)), []);
  assert.equal(tracked.some((path) => /^\.github\/workflows\//u.test(path)), false);

  return {
    schemaVersion: 1,
    routes: {
      docs: { clientAssets: docsPayload.sources.length, studioSignatures: 0 },
      studio: { clientAssets: studioPayload.sources.length, plannerSignatures: 3 },
      manifests: Object.fromEntries(Object.entries(routeModules).map(([name, names]) => [name, names.length])),
    },
    frontend: "next-app-router",
    frontendHost: "vercel",
    persistence: "cloudflare-d1",
    legacyEntrypoints: 0,
  };
}

if (process.argv[1] && new URL(process.argv[1], "file:").href === import.meta.url) {
  const evidence = await verifyNextPlatform();
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
}
