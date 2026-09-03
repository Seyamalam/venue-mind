import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { VENUE_TOOL_CONTRACT_VERSION } from "../src/contracts/venue-contracts.ts";
import { VERSION_REFERENCE } from "../src/docs/reference-data.ts";

const root = new URL("../", import.meta.url);
const parse = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const semver = /^\d+\.\d+\.\d+$/u;

export async function verifyRelease() {
  const [versions, environments, manifest, product, mcp, sdk, skills, migrations] = await Promise.all([
    parse("release/versions.json"),
    parse("release/environments.json"),
    parse("release/manifest.json"),
    parse("package.json"),
    parse("packages/mcp-server/package.json"),
    parse("packages/sdk/package.json"),
    parse("skills/manifest.json"),
    parse("db/migrations-manifest.json"),
  ]);
  for (const [surface, version] of Object.entries({
    product: versions.product,
    toolContract: versions.toolContract,
    mcpServer: versions.mcpServer,
    sdk: versions.sdk,
    ...versions.skills,
  })) assert.match(version, semver, `${surface} does not use semantic versioning`);

  assert.equal(product.version, versions.product);
  assert.equal(mcp.version, versions.mcpServer);
  assert.equal(sdk.version, versions.sdk);
  assert.equal(skills.toolContractVersion, versions.toolContract);
  assert.equal(skills.mcpServerVersion, versions.mcpServer);
  assert.deepEqual(Object.fromEntries(skills.packages.map(({ name, version }) => [name, version])), versions.skills);
  assert.equal(VENUE_TOOL_CONTRACT_VERSION, versions.toolContract);
  const references = new Map(VERSION_REFERENCE.map(({ surface, current }) => [surface, current]));
  assert.equal(references.get("Project record"), String(versions.projectSchema));
  assert.equal(references.get("Tool contracts"), versions.toolContract);
  assert.equal(references.get("MCP server"), versions.mcpServer);
  assert.equal(references.get("TypeScript SDK"), versions.sdk);
  assert.equal(migrations.schemaVersion, 1);
  assert.equal(migrations.databaseSchemaVersion, migrations.migrations.at(-1)?.version);
  for (const migration of migrations.migrations) assert.match(migration.checksum, /^[a-f0-9]{64}$/u);

  const configured = environments.environments;
  assert.deepEqual(Object.keys(configured), ["preview", "staging", "production"]);
  assert.equal(configured.preview.dataClass, "synthetic-only");
  assert.equal(configured.staging.dataClass, "synthetic-only");
  assert.equal(configured.production.dataClass, "customer");
  assert.equal(configured.staging.promotionSource, "preview");
  assert.equal(configured.production.promotionSource, "staging");
  assert.notEqual(configured.staging.database, configured.production.database);
  assert.equal(JSON.stringify(environments).match(/(?:token|password|secret|private[_-]?key)/giu), null);

  assert.deepEqual(manifest.release, versions);
  assert.deepEqual(manifest.environments, environments);
  for (const [path, expected] of Object.entries(manifest.artifacts))
    assert.equal(sha256(await readFile(new URL(path, root))), expected, `${path} checksum does not match the release manifest`);
  return {
    schemaVersion: 1,
    version: versions.product,
    projectSchema: versions.projectSchema,
    toolContract: versions.toolContract,
    databaseSchema: migrations.databaseSchemaVersion,
    environments: Object.keys(configured),
    artifactCount: Object.keys(manifest.artifacts).length,
    status: "pass",
  };
}

if (process.argv[1] && new URL(process.argv[1], "file:").href === import.meta.url)
  process.stdout.write(`${JSON.stringify(await verifyRelease(), null, 2)}\n`);
