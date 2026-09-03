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
    sourcemap: false,
    packages: "external",
  });
}

execFileSync(path.join(root, "node_modules/.bin/tsc"), ["-p", path.join(packageRoot, "tsconfig.json")], { cwd: root, stdio: "inherit" });
const declarationRoot = path.join(dist, ".types/packages/sdk/src");
for (const entry of entries) await cp(path.join(declarationRoot, `${entry}.d.ts`), path.join(dist, `${entry}.d.ts`));
await cp(path.join(declarationRoot, "generated"), path.join(dist, "generated"), { recursive: true });
await rm(path.join(dist, ".types"), { recursive: true, force: true });
await rm(path.join(packageRoot, "schemas"), { recursive: true, force: true });
await cp(path.join(root, "public/schemas"), path.join(packageRoot, "schemas"), { recursive: true });
