#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function selectTestFiles(mode, names) {
  const testFiles = names.filter((name) => name.endsWith(".test.mjs")).sort();
  if (mode === "all") return testFiles;
  if (mode === "migrations") {
    return testFiles.filter((name) => name === "database-migrations.test.mjs" || name.endsWith("-migration.test.mjs"));
  }
  throw new Error(`Unknown test group: ${mode}`);
}

async function main() {
  const mode = process.argv[2];
  const files = selectTestFiles(mode, await readdir(path.join(projectRoot, "tests")));
  if (files.length === 0) throw new Error(`Test group ${mode} selected no files`);
  const result = spawnSync(process.execPath, ["--test", ...files.map((name) => path.join("tests", name))], {
    cwd: projectRoot,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Test group ${mode} terminated by ${result.signal}`);
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
