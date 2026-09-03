import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import nextConfig from "../next.config.ts";

const root = new URL("../", import.meta.url);

export async function verifyHostingConfig() {
  const [workerSource, vercelSource] = await Promise.all([
    readFile(new URL("wrangler.jsonc", root), "utf8"),
    readFile(new URL("vercel.json", root), "utf8"),
  ]);
  const worker = JSON.parse(workerSource);
  const vercel = JSON.parse(vercelSource);
  const database = worker.d1_databases?.find(({ binding }) => binding === "DB");
  const staging = worker.env?.staging;
  const stagingDatabase = staging?.d1_databases?.find(({ binding }) => binding === "DB");

  assert.equal(vercel.framework, "nextjs");
  assert.equal(vercel.buildCommand, "npm run build:vercel");
  assert.equal(worker.name, "venue-mind-api");
  assert.equal(worker.main, "dist/server/index.js");
  assert.ok(database);
  assert.equal(database.database_name, "venue-mind-production");
  assert.match(database.database_id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
  assert.equal(database.migrations_dir, "db/wrangler");
  assert.equal(worker.vars.VENUEMIND_APP_ORIGINS, "https://venue-mind-jet.vercel.app");
  assert.equal(worker.vars.VENUEMIND_AUTH_MODE, "anonymous-demo");
  assert.equal("r2_buckets" in worker, false);
  assert.equal("assets" in worker, false);
  assert.equal("pages_build_output_dir" in worker, false);
  assert.equal(staging?.name, "venue-mind-api-staging");
  assert.equal(stagingDatabase?.database_name, "venue-mind-staging");
  assert.match(stagingDatabase?.database_id ?? "", /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u);
  assert.equal(stagingDatabase?.migrations_dir, "db/wrangler");
  assert.notEqual(stagingDatabase?.database_id, database.database_id);
  assert.equal(staging?.vars?.VENUEMIND_AUTH_MODE, "anonymous-demo");
  assert.equal("r2_buckets" in staging, false);
  assert.equal("assets" in staging, false);

  const headers = await nextConfig.headers?.();
  const global = headers?.find(({ source }) => source === "/:path*")?.headers ?? [];
  const byName = new Map(global.map(({ key, value }) => [key.toLowerCase(), value]));
  assert.match(byName.get("content-security-policy") ?? "", /frame-ancestors 'none'/u);
  assert.match(byName.get("content-security-policy") ?? "", /object-src 'none'/u);
  assert.match(byName.get("content-security-policy") ?? "", /venue-mind-api\.seyamalam41\.workers\.dev/u);
  assert.equal(byName.get("x-content-type-options"), "nosniff");
  assert.equal(byName.get("x-frame-options"), "DENY");
  assert.match(byName.get("strict-transport-security") ?? "", /max-age=63072000/u);
  assert.ok(headers?.some(({ source, headers: routeHeaders }) => source === "/schemas/:path*" && routeHeaders.some(({ key }) => key === "Cache-Control")));

  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).trim().split("\n");
  assert.equal(tracked.some((path) => /^\.github\/workflows\//u.test(path)), false);
  assert.equal(tracked.some((path) => /(?:^|\/)wrangler\.(?:toml|jsonc)$/u.test(path) && path !== "wrangler.jsonc"), false);

  return {
    schemaVersion: 1,
    frontend: { provider: "vercel", framework: "nextjs", origin: worker.vars.VENUEMIND_APP_ORIGINS },
    api: { provider: "cloudflare-workers", service: worker.name },
    database: { provider: "cloudflare-d1", name: database.database_name, migrationDirectory: database.migrations_dir },
    staging: { service: staging.name, database: stagingDatabase.database_name },
    objectStorage: "disabled",
    securityHeaderCount: global.length,
  };
}

if (process.argv[1] && new URL(process.argv[1], "file:").href === import.meta.url)
  process.stdout.write(`${JSON.stringify(await verifyHostingConfig(), null, 2)}\n`);
