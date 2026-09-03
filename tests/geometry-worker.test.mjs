import assert from "node:assert/strict";
import test from "node:test";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { analyzeSpatialPlan } from "../src/domain/spatial-analysis.ts";
import { createGeometryAnalysisClient } from "../src/performance/geometry-worker-client.ts";
import { isGeometryAnalysisRequest, isGeometryAnalysisResponse } from "../src/performance/geometry-worker-protocol.ts";

test("geometry worker protocol rejects malformed messages", () => {
  assert.equal(isGeometryAnalysisRequest({ kind: "analyze-spatial-plan", requestId: "x", input: {} }), false);
  assert.equal(isGeometryAnalysisResponse({ kind: "geometry-analysis-complete", requestId: "x", result: {} }), false);
});

test("geometry analysis client preserves deterministic results in fallback mode", async () => {
  const client = createGeometryAnalysisClient();
  const input = { plan: summitForwardPlan, changes: summitForwardPlan.proposal.changes, brief: summitForwardPlan.brief };
  const expected = analyzeSpatialPlan(input);
  const actual = await client.analyze(input);
  assert.deepEqual(actual, expected);
  client.dispose();
  await assert.rejects(client.analyze(input), /DISPOSED/);
});
