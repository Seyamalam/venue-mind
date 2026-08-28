import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const exampleManifest = JSON.parse(await readFile(new URL("public/examples/client/manifest.json", root), "utf8"));
const guideManifest = JSON.parse(await readFile(new URL("public/guides/manifest.json", root), "utf8"));
const migrationManifest = JSON.parse(await readFile(new URL("db/migrations-manifest.json", root), "utf8"));
const generatedPaths = [
  "public/llms.txt",
  "public/llms-full.txt",
  "public/docs-manifest.json",
  "public/reference-manifest.json",
  "public/sitemap.xml",
  "public/robots.txt",
  "public/examples/client/manifest.json",
  ...exampleManifest.files.map((item) => `public/examples/client/${item.path}`),
  "public/guides/manifest.json",
  ...guideManifest.guides.map((item) => `public${item.publicPath}`),
  "db/generated-migrations.ts",
  "db/migrations-manifest.json",
  ...migrationManifest.migrations.map((item) => item.wrangler.slice(1)),
];
const before = new Map(await Promise.all(generatedPaths.map(async (path) => [path, await readFile(new URL(path, root))])));

execFileSync(process.execPath, ["scripts/generate-client-examples.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-db-migrations.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-contributor-guides.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-agent-docs.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-site-metadata.mjs"], { cwd: root, stdio: "inherit" });

const stale = [];
for (const path of generatedPaths) {
  const after = await readFile(new URL(path, root));
  if (!before.get(path).equals(after)) stale.push(path);
}
if (stale.length) {
  throw new Error(`Generated documentation was stale:\n${stale.map((path) => `- ${path}`).join("\n")}\nRun npm run generate:docs and commit the results.`);
}
console.log(`Verified ${generatedPaths.length} generated documentation artifacts without drift`);
