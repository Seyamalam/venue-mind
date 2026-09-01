#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { build } from "esbuild";

await mkdir("packages/mcp-server/dist", { recursive: true });
await build({
  entryPoints: ["packages/mcp-server/src/index.ts"],
  outfile: "packages/mcp-server/dist/index.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  packages: "external",
  sourcemap: true,
});
