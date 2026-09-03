import assert from "node:assert/strict";
import test from "node:test";
import { permissionForTool } from "../src/domain/authorization.ts";
import { VENUE_TOOL_CONTRACT_VERSION, venueToolContracts } from "../src/contracts/venue-contracts.ts";
import { createVenueToolService } from "../src/tools/venue-tool-service.ts";

const names = [
  "venue.inspect_live_plan_deviations",
  "venue.record_live_plan_deviation",
  "venue.end_live_plan_deviation",
  "venue.create_post_event_deviation_proposal",
  "venue.export_live_plan_deviations",
];

test("shared Live Plan Deviation contracts preserve supervision and exact boundaries", () => {
  const byName = new Map(venueToolContracts.map((contract) => [contract.name, contract]));
  assert.equal(VENUE_TOOL_CONTRACT_VERSION, "1.6.0");
  assert.deepEqual(names.map((name) => byName.has(name)), [true, true, true, true, true]);
  assert.equal(byName.get(names[0]).authorization.requiredScope, "venue:read");
  assert.equal(byName.get(names[1]).authorization.requiredScope, "venue:operate");
  assert.equal(byName.get(names[2]).authorization.requiredScope, "venue:operate");
  assert.equal(byName.get(names[3]).authorization.requiredScope, "venue:propose");
  assert.equal(byName.get(names[4]).authorization.requiredScope, "venue:export");
  assert.equal(permissionForTool(names[0]), "deviation.read");
  assert.equal(permissionForTool(names[1]), "deviation.record");
  assert.equal(permissionForTool(names[2]), "deviation.record");
  assert.equal(permissionForTool(names[3]), "deviation.propose");
  assert.equal(permissionForTool(names[4]), "deviation.export");
  assert.equal(venueToolContracts.some((contract) => contract.name.includes("approve")), false);
});

test("recording requires Plan-bound Changes, live Constraints, affected objects, and retry identity", () => {
  const contract = venueToolContracts.find(({ name }) => name === "venue.record_live_plan_deviation");
  assert.deepEqual(contract.inputSchema.required, [
    "deviationId",
    "disposition",
    "reasonCode",
    "location",
    "affectedObjectIds",
    "availableConstraintIds",
    "change",
    "idempotencyKey",
  ]);
  assert.equal(contract.inputSchema.additionalProperties, false);
  assert.equal(contract.inputSchema.properties.affectedObjectIds.minItems, 1);
  assert.equal(contract.inputSchema.properties.availableConstraintIds.minItems, 1);
  assert.equal(contract.inputSchema.properties.change.additionalProperties, false);
  assert.ok(contract.errors.includes("DEVIATION_REGISTER_REVISION_CONFLICT"));
});

test("tool service routes every Deviation operation through the supervised adapter", async () => {
  const calls = [];
  const operation = (name) => async (input, context) => {
    calls.push([name, input, context.source]);
    return { status: "ok" };
  };
  const service = createVenueToolService({
    executeCommand() {
      throw new Error("planner fallback must not execute");
    },
    deviationOperations: {
      inspectLivePlanDeviations: operation("inspect"),
      recordLivePlanDeviation: operation("record"),
      endLivePlanDeviation: operation("end"),
      createPostEventDeviationProposal: operation("proposal"),
      exportLivePlanDeviations: operation("export"),
    },
  });
  for (const name of names) await service.execute(name, {}, "webmcp");
  assert.deepEqual(calls.map(([name]) => name), ["inspect", "record", "end", "proposal", "export"]);
  assert.ok(calls.every(([, , source]) => source === "webmcp"));
});
