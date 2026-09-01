import assert from "node:assert/strict";
import test from "node:test";
import { assertAdapterConformance, createMemoryProcessedBatchStore } from "@venuemind/sdk/testkit";
import { exampleAuthorization, exampleInventoryAdapter } from "../dist/index.js";

const input = {
  basePlanVersion: "3.2",
  proposalRevision: 1,
  pages: [
    { items: [], nextCursor: null, sourceVersion: "fixture-v1" },
  ],
};

test("packed SDK example adapter passes the conformance boundary", async () => {
  const results = await assertAdapterConformance({
    adapter: exampleInventoryAdapter,
    authorization: exampleAuthorization,
    runtimeOptions: {
      clock: () => Date.parse("2026-08-27T00:00:00.000Z"),
      sleep: async () => {},
      processedBatchStore: createMemoryProcessedBatchStore(),
    },
    cases: [
      { name: "first import", capability: "import", input, expectedStatus: "succeeded" },
      { name: "exact duplicate", capability: "import", input, expectedStatus: "duplicate" },
    ],
  });
  assert.equal(results.length, 2);
  assert.equal(results[0].result.output.status, "no-changes");
  assert.equal(results[1].result.output.checksum, results[0].result.output.checksum);
});
