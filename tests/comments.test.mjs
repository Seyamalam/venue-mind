import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintPlan } from "../src/domain/activity-ledger.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";

const add = (planner, id, anchor, extra = {}) => planner.execute({ type: "add_comment", anchor, body: `Comment ${id}`, actor: "human", actorId: "reviewer-1", idempotencyKey: `comment-add-${id}`, ...extra });

test("comments bind every immutable subject without changing Plan or Proposal state", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const beforePlan = fingerprintPlan(planner.getSnapshot().plan);
  const beforeProposal = structuredClone(planner.getSnapshot().proposal);
  const proposalId = beforeProposal.id;
  const changeId = beforeProposal.changes[0].id;
  const constraintId = planner.getSnapshot().plan.constraints[0].id;

  add(planner, "project", { kind: "project", projectId: "project-summit-forward" });
  add(planner, "plan", { kind: "plan-version", planVersion: "3.2" });
  add(planner, "proposal", { kind: "proposal", proposalId });
  add(planner, "change", { kind: "change", changeId });
  add(planner, "constraint", { kind: "constraint", constraintId });
  add(planner, "coordinate", { kind: "coordinate", planVersion: "3.2", point: { x: 9.1254, y: 6.2 } });

  assert.equal(fingerprintPlan(planner.getSnapshot().plan), beforePlan);
  assert.deepEqual(planner.getSnapshot().proposal, beforeProposal);
  assert.equal(planner.execute({ type: "list_comments", filters: {} }).length, 6);
  assert.deepEqual(planner.execute({ type: "list_comments", filters: { subjectKind: "coordinate" } })[0].anchor.point, { x: 9.125, y: 6.2 });
});

test("comment edit, mentions, resolve, reopen, filters, and audit export preserve history", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const created = add(planner, "decision", { kind: "change", changeId: "chg-center-aisle-width" }, { mentions: ["@ops", "access", "ops"], decisionRelevant: true });
  planner.execute({ type: "edit_comment", commentId: created.commentId, body: "Keep the wider route", mentions: ["ops", "owner"], decisionRelevant: true, actor: "human", actorId: "reviewer-1", idempotencyKey: "comment-edit-1" });
  planner.execute({ type: "set_comment_status", commentId: created.commentId, status: "resolved", actor: "human", actorId: "reviewer-2", idempotencyKey: "comment-resolve-1" });
  assert.equal(planner.execute({ type: "list_comments", filters: { status: "resolved", authorId: "reviewer-1", decisionRelevant: true } }).length, 1);
  planner.execute({ type: "set_comment_status", commentId: created.commentId, status: "open", actor: "human", actorId: "reviewer-2", idempotencyKey: "comment-reopen-1" });

  const comment = planner.getSnapshot().comments[0];
  assert.deepEqual(comment.mentions, ["ops", "owner"]);
  assert.equal(comment.editHistory.length, 1);
  assert.equal(comment.status, "open");
  assert.deepEqual(planner.execute({ type: "get_change_log" }).slice(-3).map((entry) => entry.type), ["comment.edited", "comment.resolved", "comment.reopened"]);

  const audit = JSON.parse(planner.execute({ type: "export_plan", format: "audit" }).content);
  assert.deepEqual(audit.comments.map((item) => item.id), [created.commentId]);
});

test("comment anchors survive branch switches and accepted Plan Versions", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const proposalId = planner.getSnapshot().proposal.id;
  const coordinate = add(planner, "fixed-coordinate", { kind: "coordinate", planVersion: "3.2", point: { x: 12, y: 8 } });
  const proposal = add(planner, "fixed-proposal", { kind: "proposal", proposalId });
  const anchors = structuredClone(planner.getSnapshot().comments.map((comment) => comment.anchor));

  const branch = planner.execute({ type: "create_branch", name: "Comment branch", strategy: "access-first", actor: "human", idempotencyKey: "comment-branch-create" });
  planner.execute({ type: "switch_branch", branchId: "branch-balanced", actor: "human", idempotencyKey: "comment-branch-switch" });
  const current = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: current.id, baseVersion: current.baseVersion, actor: "human", idempotencyKey: "comment-plan-approve" });

  assert.deepEqual(planner.getSnapshot().comments.map((comment) => comment.anchor), anchors);
  assert.equal(planner.getSnapshot().comments.find((comment) => comment.id === coordinate.commentId).anchor.planVersion, "3.2");
  assert.equal(planner.getSnapshot().comments.find((comment) => comment.id === proposal.commentId).anchor.proposalId, proposalId);
  assert.equal(branch.branchId, "branch-2");
  assert.equal(planner.getSnapshot().plan.version, "3.3");
});
