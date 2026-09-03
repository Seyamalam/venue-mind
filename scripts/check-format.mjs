#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkedExtensions = new Set([".css", ".cjs", ".js", ".json", ".jsx", ".md", ".mjs", ".sql", ".ts", ".tsx", ".yaml", ".yml"]);
const generatedPrefixes = ["db/wrangler/", "docs/reference/", "packages/sdk/src/generated/", "public/"];
const generatedFiles = new Set(["db/generated-migrations.ts", "db/migrations-manifest.json", "worker-configuration.d.ts"]);

export const isGeneratedArtifact = (relativePath) =>
  generatedFiles.has(relativePath) || generatedPrefixes.some((prefix) => relativePath.startsWith(prefix));

export function inspectTextFormat(relativePath, source) {
  const issues = [];
  if (source.startsWith("\uFEFF")) issues.push("byte-order mark");
  if (source.includes("\r")) issues.push("CRLF line endings");
  if (source.includes("\t")) issues.push("tab indentation");
  if (/[ \t]+$/m.test(source)) issues.push("trailing whitespace");
  const conflictStart = "<".repeat(7);
  const conflictMiddle = "=".repeat(7);
  const conflictEnd = ">".repeat(7);
  if (source.split("\n").some((line) => [conflictStart, conflictMiddle, conflictEnd].some((marker) => line.startsWith(marker)))) {
    issues.push("merge-conflict marker");
  }
  if (source.length > 0 && !source.endsWith("\n")) issues.push("missing final newline");
  return issues.map((issue) => `${relativePath}: ${issue}`);
}

export function trackedSourcePaths(root = projectRoot) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .filter((relativePath) => checkedExtensions.has(path.extname(relativePath)))
    .filter((relativePath) => !isGeneratedArtifact(relativePath))
    .sort();
}

async function main() {
  const paths = trackedSourcePaths();
  const issues = (
    await Promise.all(paths.map(async (relativePath) => inspectTextFormat(relativePath, await readFile(path.join(projectRoot, relativePath), "utf8"))))
  ).flat();
  if (issues.length) throw new Error(`Format check failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
  console.log(`Verified source format for ${paths.length} tracked files; generated artifacts are checked by regeneration`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
