const value = (input) => JSON.stringify(input ?? null);
const changed = (before, after) => value(before) !== value(after);

export function projectCollaborationEventTypes(before, after) {
  if (!before) return ["project.created"];
  const types = [];
  if (changed(before.snapshot?.comments, after.snapshot?.comments)) types.push("comment.updated");
  if (changed(before.snapshot?.ledger, after.snapshot?.ledger)) types.push("ledger.appended");
  if (changed(before.snapshot?.proposal, after.snapshot?.proposal) || changed(before.snapshot?.branches, after.snapshot?.branches)) types.push("proposal.updated");
  if (before.snapshot?.plan?.version !== after.snapshot?.plan?.version) types.push("approval.committed");
  if (!types.length) types.push("project.updated");
  return types;
}

export function collaborationEventPayload(type, before, after) {
  const payload = { projectId: after.id, revision: after.revision, planId: after.activePlanId, planVersion: after.snapshot?.plan?.version ?? null };
  if (type === "comment.updated") payload.commentIds = (after.snapshot?.comments ?? []).map((comment) => comment.id);
  if (type === "ledger.appended") payload.ledgerEntryIds = (after.snapshot?.ledger ?? []).slice(before?.snapshot?.ledger?.length ?? 0).map((entry) => entry.id);
  if (type === "proposal.updated") payload.proposalId = after.snapshot?.proposal?.id ?? null;
  if (type === "approval.committed") payload.approvedProposalId = before?.snapshot?.proposal?.id ?? null;
  return payload;
}
