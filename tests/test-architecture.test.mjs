import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("../", import.meta.url).pathname);

const expectedBoundaryIds = Object.freeze([
  "planner-command",
  "constraint-geometry",
  "authorization",
  "generated-command-schema",
  "webmcp",
  "mcp-stdio",
  "browser-project-recovery",
  "worker-http",
  "d1-project-transaction",
  "runbook",
  "live-occupancy",
  "incident-register",
  "deviation-register",
  "post-event-review",
  "collaboration",
  "share-lifecycle",
  "interchange-import",
  "adapter-staging",
  "webhook-receipt",
  "operational-resource-reconciliation"
]);

const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const exactKeys = (value, expected) => {
  assert.ok(isRecord(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
};

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

test("fast domain suite is explicitly isolated from UI, persistence, Worker, and network imports", async () => {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  const command = packageJson.scripts["test:domain"];
  assert.equal(typeof command, "string");
  const files = [...command.matchAll(/tests\/[a-z0-9-]+\.test\.mjs/g)].map(([file]) => file);
  assert.deepEqual(files, [
    "tests/venue-planner.test.mjs",
    "tests/editing-commands.test.mjs",
    "tests/locks.test.mjs",
    "tests/geometry-properties.test.mjs",
    "tests/scenario-engine.test.mjs",
    "tests/simulation-fixtures.test.mjs"
  ]);
  for (const file of files) {
    const source = await readFile(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /from\s+["'](?:react|next|\.\.\/src\/(?:persistence|webmcp)|\.\.\/worker)/, file);
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/, file);
  }
});

test("production mutation boundary matrix is exact and points to executable rollback evidence", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(root, "tests/fixtures/production-boundary-failures.json"), "utf8"),
  );
  exactKeys(manifest, ["schemaVersion", "boundaries"]);
  assert.equal(manifest.schemaVersion, 1);
  assert.ok(Array.isArray(manifest.boundaries));
  assert.deepEqual(manifest.boundaries.map(({ id }) => id), expectedBoundaryIds);
  assert.equal(new Set(manifest.boundaries.map(({ id }) => id)).size, expectedBoundaryIds.length);

  for (const boundary of manifest.boundaries) {
    exactKeys(boundary, ["id", "evidenceFile", "evidenceTest", "invariant"]);
    assert.match(boundary.evidenceFile, /^tests\/[a-z0-9-]+\.test\.mjs$/);
    assert.equal(typeof boundary.invariant, "string");
    assert.ok(boundary.invariant.length >= 24);
    const source = await readFile(path.join(root, boundary.evidenceFile), "utf8");
    assert.match(
      source,
      new RegExp(`test\\("${escapeRegExp(boundary.evidenceTest)}"`),
      `${boundary.id} has no executable test named ${boundary.evidenceTest}`,
    );
  }
});
