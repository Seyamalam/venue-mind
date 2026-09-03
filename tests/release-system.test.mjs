import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildReleaseArtifacts } from "../scripts/generate-release-artifacts.mjs";
import { verifyRelease } from "../scripts/verify-release.mjs";

test("reviewed release notes deterministically generate the changelog and checksum manifest", async () => {
  const first = await buildReleaseArtifacts();
  const second = await buildReleaseArtifacts();
  assert.deepEqual(second, first);
  assert.equal(first.changelog, await readFile(new URL("../CHANGELOG.md", import.meta.url), "utf8"));
  assert.equal(first.manifest, await readFile(new URL("../release/manifest.json", import.meta.url), "utf8"));
});

test("every release surface, environment, migration, and artifact checksum agrees", async () => {
  const report = await verifyRelease();
  assert.equal(report.status, "pass");
  assert.equal(report.version, "1.0.0");
  assert.equal(report.projectSchema, 10);
  assert.equal(report.toolContract, "1.6.0");
  assert.deepEqual(report.environments, ["preview", "staging", "production"]);
  assert.ok(report.artifactCount >= 8);
});
