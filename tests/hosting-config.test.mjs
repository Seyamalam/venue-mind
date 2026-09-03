import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import nextConfig from "../next.config.ts";
import { verifyHostingConfig } from "../scripts/verify-hosting-config.mjs";

test("production hosting keeps one frontend and one durable API boundary", async () => {
  assert.deepEqual(await verifyHostingConfig(), {
    schemaVersion: 1,
    frontend: {
      provider: "vercel",
      framework: "nextjs",
      origin: "https://venue-mind-jet.vercel.app",
    },
    api: { provider: "cloudflare-workers", service: "venue-mind-api" },
    database: {
      provider: "cloudflare-d1",
      name: "venue-mind-production",
      migrationDirectory: "db/wrangler",
    },
    staging: { service: "venue-mind-api-staging", database: "venue-mind-staging" },
    objectStorage: "disabled",
    securityHeaderCount: 8,
  });
});

test("security and public-contract cache policies fail closed", async () => {
  const configured = (await nextConfig.headers?.()) ?? [];
  const global = configured.find(({ source }) => source === "/:path*");
  assert.ok(global);
  const headers = new Map(global.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  const csp = headers.get("content-security-policy") ?? "";
  assert.doesNotMatch(csp, /unsafe-eval/u);
  assert.match(csp, /default-src 'self'/u);
  assert.match(csp, /frame-ancestors 'none'/u);
  assert.match(csp, /object-src 'none'/u);
  assert.equal(headers.get("permissions-policy"), "camera=(), geolocation=(), microphone=(), payment=(), usb=()");

  for (const source of ["/llms.txt", "/llms-full.txt", "/schemas/:path*", "/guides/:path*"]) {
    const route = configured.find((entry) => entry.source === source);
    assert.ok(route, `${source} is missing its explicit cache policy`);
    assert.match(route.headers.at(0)?.value ?? "", /s-maxage=3600/u);
  }
});

test("production smoke check exercises public routes and an opt-in durable golden loop", async () => {
  const source = await readFile(new URL("../scripts/smoke-production.mjs", import.meta.url), "utf8");
  for (const signature of [
    '"/docs"',
    '"/llms.txt"',
    '"/llms-full.txt"',
    '"/schemas/venue-command.schema.json"',
    'type: "inspect_layout"',
    'type: "preview_revision"',
    'type: "validate_layout"',
    'type: "approve_proposal"',
    'type: "export_plan"',
    'const browserTwo = new CookieJar',
    '"x-venuemind-create-only": "1"',
    '"x-venuemind-expected-revision": String(existing.revision)',
  ])
    assert.match(source, new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(source, /const mutate = process\.argv\.includes\("--write"\)/u);
  assert.match(source, /if \(saved\.status !== 200 && saved\.status !== 201\)/u);
  assert.match(source, /assert\.equal\(durable\.snapshot\.plan\.version, approval\.planVersion\)/u);
});
