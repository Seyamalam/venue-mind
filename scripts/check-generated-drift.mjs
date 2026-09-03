import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const exampleManifest = JSON.parse(await readFile(new URL("public/examples/client/manifest.json", root), "utf8"));
const guideManifest = JSON.parse(await readFile(new URL("public/guides/manifest.json", root), "utf8"));
const migrationManifest = JSON.parse(await readFile(new URL("db/migrations-manifest.json", root), "utf8"));
const schemaPaths = (await readdir(new URL("public/schemas/", root))).filter((name) => name.endsWith(".json")).sort().map((name) => `public/schemas/${name}`);
const sdkGeneratedPaths = (await readdir(new URL("packages/sdk/src/generated/", root))).filter((name) => name.endsWith(".ts")).sort().map((name) => `packages/sdk/src/generated/${name}`);
const generatedPaths = [
  ...schemaPaths,
  ...sdkGeneratedPaths,
  "docs/reference/sdk-api.json",
  "public/sdk-api.json",
  "docs/reference/webmcp-tools.json",
  "public/venue-tools.json",
  "public/examples/venue-tool-examples.json",
  "public/tool-error-catalog.json",
  "public/error-catalog.json",
  "public/examples/venue-template-catalog.json",
  "public/authorization-policy.json",
  "public/examples/planner-snapshot.json",
  "public/examples/venuemind-project-package.json",
  "public/llms.txt",
  "public/llms-full.txt",
  "public/docs-manifest.json",
  "public/docs-search.json",
  "public/reference-manifest.json",
  "public/sitemap.xml",
  "public/robots.txt",
  "public/examples/client/manifest.json",
  ...exampleManifest.files.map((item) => `public/examples/client/${item.path}`),
  "public/guides/manifest.json",
  ...guideManifest.guides.map((item) => `public${item.publicPath}`),
  "public/third-party-licenses.json",
  "public/THIRD_PARTY_NOTICES.txt",
  "public/LICENSE.txt",
  "db/generated-migrations.ts",
  "db/migrations-manifest.json",
  ...migrationManifest.migrations.map((item) => item.wrangler.slice(1)),
];
const before = new Map(await Promise.all(generatedPaths.map(async (path) => [path, await readFile(new URL(path, root))])));

execFileSync(process.execPath, ["scripts/generate-contracts.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-sdk-types.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-client-examples.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-db-migrations.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-contributor-guides.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-license-notices.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-agent-docs.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-site-metadata.mjs"], { cwd: root, stdio: "inherit" });

const stale = [];
for (const path of generatedPaths) {
  const after = await readFile(new URL(path, root));
  if (!before.get(path).equals(after)) stale.push(path);
}
if (stale.length) {
  throw new Error(`Generated artifacts were stale:\n${stale.map((path) => `- ${path}`).join("\n")}\nRun npm run generate:contracts and npm run generate:docs, then commit the results.`);
}
console.log(`Verified ${generatedPaths.length} generated artifacts without drift`);
