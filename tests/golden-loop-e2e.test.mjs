import assert from "node:assert/strict";
import test from "node:test";
import { venueToolContracts } from "../src/contracts/venue-contracts.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { executeVenueWebMcpTool } from "../src/webmcp/tool-runtime.ts";

const contract = (name) => {
  const value = venueToolContracts.find((candidate) => candidate.name === name);
  assert.ok(value, name);
  return value;
};

const execute = (planner, name, input = {}) =>
  executeVenueWebMcpTool({
    contract: contract(name),
    planner,
    input,
    correlationIdFactory: () => `corr-e2e-${name}`,
  });

test("golden loop crosses WebMCP proposal, deterministic Validation, human Approval, replay, and export", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const acceptedBefore = structuredClone(planner.getSnapshot().plan);
  const inspection = await execute(planner, "venue.inspect_layout");
  const preview = await execute(planner, "venue.preview_revision", {
    goal: "Protect the accessible route and reduce entrance congestion",
    idempotencyKey: "e2e-preview-001",
    correlationId: "corr-e2e-preview-001",
  });
  const validation = await execute(planner, "venue.validate_layout");

  assert.equal(inspection.structuredContent.data.planVersion, "3.2");
  assert.equal(preview.structuredContent.data.requiresHumanApproval, true);
  assert.equal(validation.structuredContent.data.status, "pass");
  assert.deepEqual(planner.getSnapshot().plan, acceptedBefore);

  const proposal = planner.getSnapshot().proposal;
  const approval = planner.execute({
    type: "approve_proposal",
    proposalId: proposal.id,
    baseVersion: proposal.baseVersion,
    actor: "human",
    actorId: "e2e-approver",
    idempotencyKey: "e2e-approval-001",
  });
  assert.equal(approval.status, "approved");
  assert.equal(planner.getSnapshot().plan.version, "3.3");

  const exported = await execute(planner, "venue.export_plan", { format: "json" });
  const replay = await execute(planner, "venue.replay_history");
  assert.match(exported.structuredContent.data.filename, /v3-3\.json$/);
  assert.equal(replay.structuredContent.data.status, "pass");
  assert.ok(planner.getSnapshot().ledger.some((entry) => entry.type === "proposal.approved"));

  const recovered = createVenuePlanner(summitForwardPlan);
  recovered.execute({ type: "restore_snapshot", snapshot: planner.getSnapshot() });
  assert.equal(recovered.getSnapshot().plan.version, "3.3");
  assert.equal(recovered.execute({ type: "replay_history" }).status, "pass");
});

test("failed Approval cannot partially advance Plan, Proposal, or accepted ledger state", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const before = planner.getSnapshot();
  assert.throws(
    () =>
      planner.execute({
        type: "approve_proposal",
        proposalId: before.proposal.id,
        baseVersion: "0.0",
        actor: "human",
        actorId: "e2e-approver",
        idempotencyKey: "e2e-stale-approval",
      }),
    (error) => error.code === "PLAN_VERSION_CONFLICT",
  );
  assert.deepEqual(planner.getSnapshot(), before);
});
