import assert from "node:assert/strict";
import test from "node:test";
import { permissionForTool } from "../src/domain/authorization.ts";
import { VENUE_TOOL_CONTRACT_VERSION, venueToolContracts } from "../src/contracts/venue-contracts.ts";
import { createVenueToolService } from "../src/tools/venue-tool-service.ts";
import { executeVenueWebMcpTool } from "../src/webmcp/tool-runtime.ts";

const names = [
  "venue.inspect_post_event_review",
  "venue.record_post_event_observation",
  "venue.record_post_event_lesson",
  "venue.create_template_improvement_proposal",
  "venue.export_post_event_report",
];

test("Post-event agent contracts expose evidence capture and reporting without human review", () => {
  const byName = new Map(venueToolContracts.map((contract) => [contract.name, contract]));
  assert.equal(VENUE_TOOL_CONTRACT_VERSION, "1.6.0");
  assert.deepEqual(names.map((name) => byName.has(name)), [true, true, true, true, true]);
  assert.deepEqual(names.map((name) => byName.get(name).authorization.requiredScope), [
    "venue:read", "venue:operate", "venue:operate", "venue:propose", "venue:export",
  ]);
  assert.deepEqual(names.map(permissionForTool), [
    "post-event.read", "post-event.record", "post-event.record", "post-event.propose", "post-event.export",
  ]);
  assert.equal(venueToolContracts.some(({ name }) => name.includes("review_template_improvement")), false);
  assert.equal(byName.get("venue.record_post_event_observation").inputSchema.additionalProperties, false);
  assert.ok(byName.get("venue.record_post_event_observation").inputSchema.required.includes("expectedRevision"));
  assert.equal(byName.get("venue.create_template_improvement_proposal").inputSchema.properties.changes.items.additionalProperties, false);
  assert.equal(byName.get("venue.inspect_post_event_review").outputSchema.properties.review.$ref, "https://venuemind.dev/schemas/post-event-review.schema.json");
});

test("tool service routes all Post-event operations through the dedicated adapter", async () => {
  const calls = [];
  const operation = (label) => async (input, context) => {
    calls.push([label, input, context.source]);
    return { status: "ok" };
  };
  const service = createVenueToolService({
    executeCommand() {
      throw new Error("planner fallback must not execute");
    },
    postEventOperations: {
      inspectPostEventReview: operation("inspect"),
      recordPostEventObservation: operation("observation"),
      recordPostEventLesson: operation("lesson"),
      createTemplateImprovementProposal: operation("proposal"),
      exportPostEventReport: operation("export"),
    },
  });
  for (const name of names) await service.execute(name, {}, "webmcp");
  assert.deepEqual(calls.map(([label]) => label), ["inspect", "observation", "lesson", "proposal", "export"]);
  assert.ok(calls.every(([, , source]) => source === "webmcp"));
});

test("WebMCP preserves Post-event structured content and never invokes Planner fallback", async () => {
  const contract = venueToolContracts.find(({ name }) => name === "venue.inspect_post_event_review");
  const result = await executeVenueWebMcpTool({
    contract,
    planner: {
      execute() {
        throw new Error("planner fallback must not execute");
      },
      recordAuthorizationDenial() {},
    },
    postEventOperations: {
      inspectPostEventReview() {
        return { review: { id: "review-1", revision: 3 }, comparisons: [{ key: "comparison-1" }], integrity: { status: "pass" } };
      },
    },
    correlationIdFactory: () => "corr-post-event",
  });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.data.review.id, "review-1");
  assert.match(result.content[0].text, /Post-event R3 · 1 comparisons/);
});
