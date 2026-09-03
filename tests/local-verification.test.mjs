import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { findGithubActionWorkflows, inspectLockfile } from "../scripts/check-install.mjs";
import { inspectTextFormat, isGeneratedArtifact } from "../scripts/check-format.mjs";
import { LocalVerificationError, runLocalVerification } from "../scripts/local-verification.mjs";
import { LOCAL_VERIFICATION_PHASES } from "../scripts/local-verification-plan.mjs";
import { selectTestFiles } from "../scripts/run-test-group.mjs";
import { inspectSecrets } from "../scripts/scan-secrets.mjs";

test("the local plan covers every required source, security, build, and test boundary", () => {
  const ids = LOCAL_VERIFICATION_PHASES.map(({ id }) => id);
  assert.deepEqual(ids, [
    "install-preconditions",
    "format",
    "lint",
    "typecheck",
    "generated-drift",
    "skill-validation",
    "dependency-scan",
    "secret-scan",
    "hosting-config",
    "vercel-build",
    "frontend-platform",
    "worker-build",
    "mcp-build",
    "sdk-build",
    "skills-build",
    "migration-tests",
    "browser-contract-tests",
    "all-tests",
  ]);
  assert.equal(new Set(ids).size, ids.length);
});

test("lockfile checks reject drift, unverified registries, and missing integrity", () => {
  const manifest = { name: "fixture", version: "1.0.0", dependencies: { zod: "1.0.0" }, devDependencies: {} };
  const valid = {
    lockfileVersion: 3,
    packages: {
      "": { ...manifest },
      "node_modules/zod": {
        version: "1.0.0",
        resolved: "https://registry.npmjs.org/zod/-/zod-1.0.0.tgz",
        integrity: "sha512-fixture",
      },
    },
  };
  assert.deepEqual(inspectLockfile(manifest, valid), []);
  const invalid = structuredClone(valid);
  invalid.packages[""].dependencies.zod = "2.0.0";
  invalid.packages["node_modules/zod"].resolved = "http://example.test/zod.tgz";
  delete invalid.packages["node_modules/zod"].integrity;
  assert.deepEqual(inspectLockfile(manifest, invalid), [
    "package.json dependencies do not match package-lock.json",
    "node_modules/zod is not pinned to the npm registry over HTTPS",
    "node_modules/zod has no sha512 integrity record",
  ]);
});

test("GitHub Action workflows are rejected while an absent workflow directory is valid", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "venuemind-workflows-"));
  t.after(async () => (await import("node:fs/promises")).rm(root, { recursive: true, force: true }));
  assert.deepEqual(await findGithubActionWorkflows(root), []);
  await mkdir(path.join(root, ".github", "workflows"), { recursive: true });
  await writeFile(path.join(root, ".github", "workflows", "ci.yml"), "name: forbidden\n");
  assert.deepEqual(await findGithubActionWorkflows(root), ["ci.yml"]);
});

test("format checks fail closed while generated outputs remain a separate drift boundary", () => {
  assert.deepEqual(inspectTextFormat("src/good.ts", "export const good = true;\n"), []);
  assert.deepEqual(inspectTextFormat("src/bad.ts", `const value = true; \r\n${"<".repeat(7)} branch`), [
    "src/bad.ts: CRLF line endings",
    "src/bad.ts: trailing whitespace",
    "src/bad.ts: merge-conflict marker",
    "src/bad.ts: missing final newline",
  ]);
  assert.equal(isGeneratedArtifact("public/llms.txt"), true);
  assert.equal(isGeneratedArtifact("db/generated-migrations.ts"), true);
  assert.equal(isGeneratedArtifact("src/domain/venue-planner.ts"), false);
});

test("secret signatures report only location and rule, never the credential value", () => {
  const credential = `gh${"p"}_${"a".repeat(36)}`;
  const findings = inspectSecrets("fixture.env", `TOKEN=${credential}\n`);
  assert.deepEqual(findings, [{ file: "fixture.env", line: 1, rule: "github-token" }]);
  assert.equal(JSON.stringify(findings).includes(credential), false);
  assert.deepEqual(inspectSecrets(".env.example", "TOKEN=replace-me\n"), []);
});

test("migration test selection is sorted, exhaustive by convention, and fail-closed", () => {
  const files = ["z.test.mjs", "incident-migration.test.mjs", "database-migrations.test.mjs", "helper.mjs"];
  assert.deepEqual(selectTestFiles("migrations", files), ["database-migrations.test.mjs", "incident-migration.test.mjs"]);
  assert.deepEqual(selectTestFiles("all", files), ["database-migrations.test.mjs", "incident-migration.test.mjs", "z.test.mjs"]);
  assert.throws(() => selectTestFiles("unknown", files), /Unknown test group/);
});

test("a failed phase stops execution and preserves redacted local evidence", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "venuemind-verification-"));
  t.after(async () => (await import("node:fs/promises")).rm(root, { recursive: true, force: true }));
  const phases = [
    { id: "first", label: "First", executable: process.execPath, args: ["first.mjs"] },
    { id: "second", label: "Second", executable: process.execPath, args: ["second.mjs"] },
    { id: "third", label: "Third", executable: process.execPath, args: ["third.mjs"] },
  ];
  const executed = [];
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 8, 3, 12, 0, 0, tick++ * 10));
  let caught;
  try {
    await runLocalVerification({
      root,
      artifactRoot: path.join(root, ".artifacts", "local-verification"),
      phases,
      now,
      execute: async ({ phase, logPath }) => {
        executed.push(phase.id);
        await writeFile(logPath, `checked ${phase.id}\n`, { flag: "a" });
        return phase.id === "second" ? 7 : 0;
      },
    });
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof LocalVerificationError);
  assert.deepEqual(executed, ["first", "second"]);
  assert.deepEqual(caught.summary.phases.map(({ status }) => status), ["passed", "failed", "skipped"]);
  const saved = JSON.parse(await readFile(path.join(root, caught.summary.runDirectory, "summary.json"), "utf8"));
  assert.equal(saved.status, "failed");
  assert.equal(saved.phases[1].exitCode, 7);
  assert.match(await readFile(path.join(root, saved.phases[1].log), "utf8"), /checked second/);
  const latest = JSON.parse(await readFile(path.join(root, ".artifacts", "local-verification", "latest.json"), "utf8"));
  assert.equal(latest.summary, `${caught.summary.runDirectory}/summary.json`);
});

test("documentation defines one local-only completion command and no CI milestone", async () => {
  const root = path.resolve(new URL("../", import.meta.url).pathname);
  const [guide, readme, todo] = await Promise.all([
    readFile(path.join(root, "docs/local-verification.md"), "utf8"),
    readFile(path.join(root, "README.md"), "utf8"),
    readFile(path.join(root, "todo.md"), "utf8"),
  ]);
  for (const boundary of ["npm run verify:local", "Vercel Next.js", "Cloudflare Worker", "MCP server", "SDK", "migration", "browser", ".artifacts/local-verification"]) {
    assert.match(guide, new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(readme, /npm run verify:local/);
  assert.match(todo, /## 11\.2 Local verification/);
  assert.doesNotMatch(todo, /\bCI\b/);
  assert.doesNotMatch(guide, /live Safari or Firefox execution is verified/i);
});
