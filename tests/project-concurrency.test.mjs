import assert from "node:assert/strict";
import test from "node:test";
import { parseProjectEtag, projectEtag, reconcileProjectRecords } from "../src/domain/project-concurrency.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { verifyActivityLedger } from "../src/domain/activity-ledger.js";

test("Project ETags are strong, revision-bound, and Project-bound", () => {
  const etag = projectEtag("project alpha/1", 7);
  assert.equal(etag, '"venuemind:project%20alpha%2F1:7"');
  assert.equal(parseProjectEtag(etag, "project alpha/1"), 7);
  assert.equal(parseProjectEtag(etag, "project-bravo"), null);
  assert.equal(parseProjectEtag("W/" + etag, "project alpha/1"), null);
});

test("record reconciliation merges only independent fields", () => {
  const base = { id: "project-1", revision: 1, name: "BASE", activePlanId: "plan-1", snapshot: { proposal: { goal: "BASE" } }, pinned: false };
  const local = { ...structuredClone(base), name: "LOCAL" };
  const remote = { ...structuredClone(base), revision: 2, pinned: true };
  const merged = reconcileProjectRecords({ base, local, remote });
  assert.equal(merged.status, "merged");
  assert.equal(merged.record.name, "LOCAL");
  assert.equal(merged.record.pinned, true);

  const planning = reconcileProjectRecords({
    base,
    local: { ...structuredClone(base), snapshot: { proposal: { goal: "LOCAL" } } },
    remote: { ...structuredClone(base), revision: 2, snapshot: { proposal: { goal: "REMOTE" } } },
  });
  assert.equal(planning.status, "conflict");
  assert.equal(planning.kind, "planning");
});

test("unsynchronized planning work becomes an auditable Proposal recovery branch", () => {
  const remote = createVenuePlanner(summitForwardPlan);
  const local = createVenuePlanner(summitForwardPlan);
  local.execute({ type: "preview_revision", goal: "LOCAL UNSYNC", actor: "human", idempotencyKey: "local-unsync-preview" });
  const localProposal = structuredClone(local.getSnapshot().proposal);
  const result = remote.execute({
    type: "recover_unsynchronized_branch",
    proposal: localProposal,
    sourceRevision: 3,
    remoteRevision: 4,
    actor: "human",
    actorId: "operator-1",
    idempotencyKey: "recover-unsync-001",
  });
  const state = remote.getSnapshot();
  const branch = state.branches.find((item) => item.id === result.branchId);
  assert.equal(branch.strategy, "recovery");
  assert.equal(branch.proposal.recovery.sourceProposalId, localProposal.id);
  assert.equal(branch.proposal.changes.length, localProposal.changes.length);
  assert.equal(state.activeBranchId, "branch-balanced");
  assert.equal(verifyActivityLedger(state.ledger).status, "pass");
  assert.ok(state.ledger.some((entry) => entry.type === "proposal.branch_recovered" && entry.details.sourceRecordRevision === 3));
});
