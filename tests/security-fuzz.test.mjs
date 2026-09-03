import assert from "node:assert/strict";
import test from "node:test";
import * as z from "zod/v4";
import { venueToolContracts } from "../src/contracts/venue-contracts.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { executeVenueWebMcpTool } from "../src/webmcp/tool-runtime.ts";

const applyEdit = venueToolContracts.find(({ name }) => name === "venue.apply_edit");
assert.ok(applyEdit);

const invalidToolPayload = (index) => {
  const variants = [
    { edit: { operation: "move", objectIds: ["obj-av-desk"], delta: { x: Number.NaN, y: 1 } }, idempotencyKey: `fuzz-${index}` },
    { edit: { operation: "move", objectIds: [], delta: { x: 1, y: 1 } }, idempotencyKey: `fuzz-${index}` },
    { edit: { operation: "rotate", objectIds: ["obj-av-desk"], rotationDegrees: Number.POSITIVE_INFINITY }, idempotencyKey: `fuzz-${index}` },
    { edit: { operation: "delete", objectIds: [""] }, idempotencyKey: `fuzz-${index}` },
    { edit: { operation: "not-an-operation" }, idempotencyKey: `fuzz-${index}` },
    { edit: null, idempotencyKey: `fuzz-${index}` },
    { edit: { operation: "move", objectIds: ["obj-av-desk"], delta: { x: 1, y: 1 }, injected: true }, idempotencyKey: `fuzz-${index}` },
    { edit: { operation: "move", objectIds: ["obj-av-desk"], delta: { x: 1, y: 1 } }, idempotencyKey: "" },
  ];
  return variants[index % variants.length];
};

test("bounded tool-input fuzzing rejects malformed editor commands before accepted or proposed state changes", () => {
  const schema = z.fromJSONSchema(applyEdit.inputSchema);
  const planner = createVenuePlanner(summitForwardPlan);
  const baseline = planner.getSnapshot();
  for (let index = 0; index < 128; index += 1) {
    const payload = invalidToolPayload(index);
    assert.equal(schema.safeParse(payload).success, false, `schema fuzz ${index}`);
    assert.deepEqual(planner.getSnapshot().plan, baseline.plan, `accepted Plan changed for fuzz ${index}`);
    assert.deepEqual(planner.getSnapshot().proposal, baseline.proposal, `Proposal changed for fuzz ${index}`);
  }
});

test("WebMCP resource limits reject oversized fuzz payloads before planner mutation", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const baseline = planner.getSnapshot();
  for (let index = 0; index < 16; index += 1) {
    const result = await executeVenueWebMcpTool({
      contract: applyEdit,
      planner,
      input: {
        edit: { operation: "place", object: { id: `obj-fuzz-${index}`, kind: "table", notes: "x".repeat(270_000 + index) } },
        idempotencyKey: `oversized-fuzz-${index}`,
      },
      correlationIdFactory: () => `corr-oversized-fuzz-${index}`,
    });
    assert.equal(result.structuredContent.error.code, "TOOL_PAYLOAD_TOO_LARGE");
    assert.deepEqual(planner.getSnapshot().plan, baseline.plan, `accepted Plan changed for fuzz ${index}`);
    assert.deepEqual(planner.getSnapshot().proposal, baseline.proposal, `Proposal changed for fuzz ${index}`);
  }
});

test("bounded geometry fuzzing fails closed without altering the canonical fixture", () => {
  const canonical = structuredClone(summitForwardPlan);
  const invalidFootprints = [
    { kind: "rectangle", center: { x: 10, y: 10 }, width: Number.NaN, depth: 2, rotationDegrees: 0 },
    { kind: "rectangle", center: { x: 10, y: 10 }, width: 2, depth: Number.POSITIVE_INFINITY, rotationDegrees: 0 },
    { kind: "circle", center: { x: -1000, y: -1000 }, radius: 1 },
    { kind: "circle", center: { x: 10, y: 10 }, radius: 0 },
    { kind: "line", start: { x: 1, y: 1 }, end: { x: 1, y: 1 }, width: 0 },
    {
      kind: "polygon",
      points: [
        { x: 5, y: 5 },
        { x: 9, y: 9 },
        { x: 5, y: 9 },
        { x: 9, y: 5 },
      ],
      rotationDegrees: 0,
    },
  ];
  for (let index = 0; index < 96; index += 1) {
    const candidate = structuredClone(canonical);
    candidate.objects[0].footprint = structuredClone(invalidFootprints[index % invalidFootprints.length]);
    assert.throws(() => createVenuePlanner(candidate), undefined, `geometry fuzz ${index}`);
    assert.deepEqual(summitForwardPlan, canonical, `canonical fixture changed for fuzz ${index}`);
  }
});
