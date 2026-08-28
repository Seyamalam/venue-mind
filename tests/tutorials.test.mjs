import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { docsPageBySlug } from "../src/docs/content.js";
import { tutorialEvidence, tutorialPages } from "../src/docs/pages/tutorials.js";
import { venueToolContracts } from "../src/contracts/venue-contracts.js";

const requiredTutorials = [
  "first-project",
  "supervised-loop",
  "compare-branches",
  "stale-proposal",
  "audit-plan",
  "mcp-install",
  "webmcp",
  "skills",
  "import-export",
  "offline-recovery",
];

test("every required tutorial is a canonical page with explicit completion and verification", () => {
  assert.deepEqual(tutorialEvidence.map((tutorial) => tutorial.id), requiredTutorials);
  for (const page of tutorialPages) {
    assert.equal(docsPageBySlug[page.slug]?.tutorial.id, page.tutorial.id);
    assert.equal(page.group, "Tutorials");
    assert.ok(page.tutorial.minutes > 0);
    assert.ok(page.sections.some((section) => section.id === "completion"));
    const verification = page.sections.find((section) => section.id === "verify");
    assert.ok(verification);
    assert.equal(verification.blocks.some((block) => block.type === "code" && block.value === page.tutorial.verificationCommand), true);
  }
});

test("every tutorial evidence command names executable test fixtures in the standard suite", async () => {
  for (const tutorial of tutorialEvidence) {
    assert.equal(tutorial.verificationCommand, `node --test ${tutorial.evidenceFiles.join(" ")}`);
    for (const evidenceFile of tutorial.evidenceFiles) {
      const file = new URL(`../${evidenceFile}`, import.meta.url);
      await access(file);
      assert.match(await readFile(file, "utf8"), /test\s*\(/, `${tutorial.id}: ${evidenceFile}`);
    }
  }
});

test("tutorial tool-call examples resolve to published runtime contracts", () => {
  const contracts = new Map(venueToolContracts.map((contract) => [contract.name, contract]));
  let callCount = 0;
  for (const page of tutorialPages) {
    for (const block of page.sections.flatMap((section) => section.blocks)) {
      if (block.type !== "code" || block.language !== "json") continue;
      const example = JSON.parse(block.value);
      assert.ok(contracts.has(example.tool), `${page.slug}: ${example.tool}`);
      assert.equal(typeof example.input, "object");
      callCount += 1;
    }
  }
  assert.ok(callCount >= 18);
});

test("the standalone tutorial verifier covers every distinct evidence fixture", async () => {
  const verifier = await readFile(new URL("../scripts/verify-tutorials.mjs", import.meta.url), "utf8");
  assert.match(verifier, /tutorialEvidence/);
  assert.match(verifier, /--test/);
  assert.equal(new Set(tutorialEvidence.flatMap((tutorial) => tutorial.evidenceFiles)).size, 9);
});

test("generated agent documentation carries every tutorial and its completion command", async () => {
  const full = await readFile(new URL("../public/llms-full.txt", import.meta.url), "utf8");
  for (const page of tutorialPages) {
    assert.match(full, new RegExp(`# ${page.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    assert.match(full, new RegExp(page.tutorial.verificationCommand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
