#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const equalRecords = (left = {}, right = {}) =>
  JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());

export function inspectLockfile(packageManifest, lockfile) {
  const issues = [];
  const lockedRoot = lockfile?.packages?.[""];
  if (lockfile?.lockfileVersion !== 3) issues.push("package-lock.json must use lockfileVersion 3");
  if (!lockedRoot) return [...issues, "package-lock.json is missing its root package record"];
  if (lockedRoot.name !== packageManifest.name || lockedRoot.version !== packageManifest.version) {
    issues.push("package.json name/version do not match the lockfile root");
  }
  for (const field of ["dependencies", "devDependencies"]) {
    if (!equalRecords(packageManifest[field], lockedRoot[field])) {
      issues.push(`package.json ${field} do not match package-lock.json`);
    }
  }
  for (const [packagePath, record] of Object.entries(lockfile.packages)) {
    if (!packagePath || !packagePath.startsWith("node_modules/")) continue;
    if (typeof record.version !== "string" || record.version.length === 0) {
      issues.push(`${packagePath} has no locked version`);
    }
    if (record.inBundle === true) continue;
    if (typeof record.resolved !== "string" || !record.resolved.startsWith("https://registry.npmjs.org/")) {
      issues.push(`${packagePath} is not pinned to the npm registry over HTTPS`);
    }
    if (typeof record.integrity !== "string" || !record.integrity.startsWith("sha512-")) {
      issues.push(`${packagePath} has no sha512 integrity record`);
    }
  }
  return issues;
}

export async function findGithubActionWorkflows(root = projectRoot) {
  try {
    return (await readdir(path.join(root, ".github", "workflows"))).filter((name) => /\.ya?ml$/i.test(name)).sort();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
}

async function main() {
  const [packageManifest, lockfile, workflows] = await Promise.all([
    readFile(path.join(projectRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(projectRoot, "package-lock.json"), "utf8").then(JSON.parse),
    findGithubActionWorkflows(),
  ]);
  const issues = inspectLockfile(packageManifest, lockfile);
  if (workflows.length) issues.push(`GitHub Actions are forbidden: ${workflows.join(", ")}`);
  if (issues.length) throw new Error(`Install preconditions failed:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);

  const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
  execFileSync(
    npmExecutable,
    ["ci", "--dry-run", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"],
    { cwd: projectRoot, stdio: "inherit" },
  );
  execFileSync(npmExecutable, ["ls", "--all", "--omit=optional", "--json"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 32 * 1024 * 1024,
  });
  console.log(`Verified lockfile, disposable install tree, and local-only workflow policy`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
