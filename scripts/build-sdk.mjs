#!/usr/bin/env node
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { build } from "esbuild";

const root = path.resolve(new URL("../", import.meta.url).pathname);
const packageRoot = path.join(root, "packages/sdk");
const dist = path.join(packageRoot, "dist");
const entries = ["index", "types", "client", "adapter", "testkit", "sandbox"];

execFileSync(process.execPath, ["scripts/generate-contracts.mjs"], { cwd: root, stdio: "inherit" });
execFileSync(process.execPath, ["scripts/generate-sdk-types.mjs"], { cwd: root, stdio: "inherit" });
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const entry of entries) {
  await build({
    entryPoints: [path.join(packageRoot, "src", `${entry}.ts`)],
    outfile: path.join(dist, `${entry}.js`),
    bundle: true,
    format: "esm",
    platform: entry === "sandbox" ? "node" : "neutral",
    target: "es2022",
    sourcemap: true,
    packages: "external",
  });
}

execFileSync(path.join(root, "node_modules/.bin/tsc"), ["-p", path.join(packageRoot, "tsconfig.json")], { cwd: root, stdio: "inherit" });
await rm(path.join(packageRoot, "schemas"), { recursive: true, force: true });
await cp(path.join(root, "public/schemas"), path.join(packageRoot, "schemas"), { recursive: true });
