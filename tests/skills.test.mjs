import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { VENUE_TOOL_CONTRACT_VERSION } from "../src/contracts/venue-contracts.js";
import { validateSkills } from "../scripts/validate-skills.mjs";

const readJson = async (file) => JSON.parse(await readFile(new URL(file, import.meta.url), "utf8"));

test("all VenueMind skills are versioned, evaluated, and contract-compatible", async () => {
  const { manifest, evaluation, metrics } = await validateSkills();
  assert.equal(manifest.packages.length, 6);
  assert.equal(manifest.toolContractVersion, VENUE_TOOL_CONTRACT_VERSION);
  assert.equal(evaluation.cases.length, 12);
  assert.equal(metrics.toolSelectionAccuracy, 1);
  assert.equal(metrics.unnecessaryCallRate, 0);
});

test("skill evaluations cover the authority and evidence attacks", async () => {
  const evaluation = await readJson("../skills/evals/cases.json");
  const tags = new Set(evaluation.cases.flatMap((item) => item.tags));
  assert.deepEqual(
    [...tags].filter((tag) => tag !== "normal" && tag !== "adversarial").sort(),
    ["ignored-locks", "missing-evidence", "premature-approval", "stale-versions"],
  );
  for (const item of evaluation.cases) {
    assert.ok(item.forbiddenTools.includes("venue.approve_proposal"));
    assert.ok(item.invariants.includes("stopsBeforeApproval"));
    assert.ok(item.invariants.includes("preservesAcceptedPlan"));
    assert.ok(item.requiredEvidence.length > 0);
  }
});

test("packaged skills include source-equal manifests and evaluation metrics", async () => {
  const sourceManifest = await readJson("../skills/manifest.json");
  const packagedManifest = await readJson("../dist/skills/manifest.json");
  const metrics = await readJson("../dist/skills/evaluation-metrics.json");
  assert.deepEqual(packagedManifest, sourceManifest);
  assert.equal(metrics.packages, sourceManifest.packages.length);
  assert.equal(metrics.toolSelectionAccuracy, 1);
  assert.equal(metrics.unnecessaryCallRate, 0);
});
