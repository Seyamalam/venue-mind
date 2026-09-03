import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createScenarioRunner, SIMULATION_ENGINE_VERSION } from "../src/domain/scenario-engine.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const fixture = JSON.parse(
  await readFile(new URL("./fixtures/simulation-determinism-v1.json", import.meta.url), "utf8"),
);

test("versioned simulation fixture remains byte-stable for its seed, engine, Scenario, and geometry", async () => {
  assert.equal(fixture.engineVersion, SIMULATION_ENGINE_VERSION);
  const result = (
    await createScenarioRunner().run({
      scenario: fixture.scenario,
      plan: summitForwardPlan,
      branchId: "branch-balanced",
    })
  ).result;
  assert.deepEqual(JSON.parse(JSON.stringify(result)), fixture.expected);
});
