import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("../", import.meta.url).pathname);

test("packed SDK installs, typechecks, imports, and runs the example adapter suite", async (context) => {
  const temporary = await mkdtemp(path.join(tmpdir(), "venuemind-sdk-consumer-"));
  context.after(() => rm(temporary, { recursive: true, force: true }));
  const packOutput = execFileSync("npm", ["pack", path.join(root, "packages/sdk"), "--pack-destination", temporary, "--json"], { cwd: root, encoding: "utf8" });
  const [manifest] = JSON.parse(packOutput);
  const tarball = path.join(temporary, manifest.filename);
  const packedPaths = manifest.files.map(({ path: itemPath }) => itemPath);
  assert.ok(packedPaths.includes("dist/index.js"));
  assert.ok(packedPaths.includes("dist/index.d.ts"));
  assert.ok(packedPaths.includes("schemas/planner-snapshot.schema.json"));
  assert.ok(packedPaths.includes("fixtures/manifest.json"));
  assert.equal(packedPaths.some((itemPath) => itemPath.startsWith("src/")), false);
  assert.equal(packedPaths.some((itemPath) => itemPath.endsWith(".map")), false);

  const consumer = path.join(temporary, "consumer");
  await cp(path.join(root, "examples/sdk-adapter"), consumer, { recursive: true });
  const packageJsonPath = path.join(consumer, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  packageJson.dependencies["@venuemind/sdk"] = `file:${tarball}`;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
  execFileSync("npm", ["install", "--ignore-scripts", "--no-package-lock"], { cwd: consumer, stdio: "pipe" });
  execFileSync(path.join(root, "node_modules/.bin/tsc"), ["-p", "tsconfig.json"], { cwd: consumer, stdio: "pipe" });
  execFileSync(process.execPath, ["--test", "test/contract.test.mjs"], { cwd: consumer, stdio: "pipe" });

  const installedPackage = path.join(consumer, "node_modules/@venuemind/sdk");
  for (const entry of ["index", "types", "client", "adapter", "testkit", "sandbox"]) {
    const distributionSource = await readFile(path.join(installedPackage, "dist", `${entry}.js`), "utf8");
    assert.equal(distributionSource.includes(root), false, `${entry}.js leaks the repository path`);
    assert.equal(distributionSource.includes("../../../src/"), false, `${entry}.js leaks a private source path`);
  }

  for (const entry of ["@venuemind/sdk", "@venuemind/sdk/client", "@venuemind/sdk/adapter", "@venuemind/sdk/testkit", "@venuemind/sdk/sandbox"]) {
    const probe = `import(${JSON.stringify(entry)}).then(() => process.exit(0))`;
    execFileSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: consumer, stdio: "pipe" });
  }

  const fixtureProbe = `import("@venuemind/sdk/fixtures/inventory-page-empty.json", { with: { type: "json" } }).then(({ default: fixture }) => {
    if (fixture.sourceVersion !== "fixture-v1" || !Array.isArray(fixture.items)) process.exit(1);
  })`;
  execFileSync(process.execPath, ["--input-type=module", "-e", fixtureProbe], { cwd: consumer, stdio: "pipe" });
});
