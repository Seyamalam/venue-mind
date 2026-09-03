import assert from "node:assert/strict";
import test from "node:test";
import { extractScriptSources, parseClientReferenceManifest } from "../scripts/verify-next-platform.mjs";

test("route-manifest parser rejects missing or malformed build evidence", () => {
  assert.throws(() => parseClientReferenceManifest("{}"), /assignment missing/);
  assert.throws(() => parseClientReferenceManifest("route] = {nope};"), SyntaxError);
});

test("route-manifest parser exposes exact route client modules", () => {
  const source = 'globalThis.__RSC_MANIFEST["/docs"] = {"clientModules":{"[project]/docs-search.tsx":{}},"entryJSFiles":{}};';
  const manifest = parseClientReferenceManifest(source);
  assert.deepEqual(Object.keys(manifest.clientModules), ["[project]/docs-search.tsx"]);
});

test("route HTML exposes exact emitted client assets", () => {
  assert.deepEqual(
    extractScriptSources('<script async src="/_next/a.js"></script><link href="/_next/a.css"><script src="/_next/b.js"></script>'),
    ["/_next/a.js", "/_next/b.js"],
  );
});
