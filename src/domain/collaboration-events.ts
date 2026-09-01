const value: any = (input: any) => JSON.stringify(input ?? null);
const changed: any = (before: any, after: any) => value(before) !== value(after);

export function projectCollaborationEventTypes(before: any, after: any) {
  if (!before) return ["project.created"];
  const types: any[] = [];
  if (changed(before.snapshot?.comments, after.snapshot?.comments)) types.push("comment.updated");
  if (changed(before.snapshot?.ledger, after.snapshot?.ledger)) types.push("ledger.appended");
  if (changed(before.snapshot?.proposal, after.snapshot?.proposal) || changed(before.snapshot?.branches, after.snapshot?.branches)) types.push("proposal.updated");
  if (before.snapshot?.plan?.version !== after.snapshot?.plan?.version) types.push("approval.committed");
  if (!types.length) types.push("project.updated");
  return types;
}

export function collaborationEventPayload(type: any, before: any, after: any) {
  const payload: any = { projectId: after.id, revision: after.revision, planId: after.activePlanId, planVersion: after.snapshot?.plan?.version ?? null };
  if (type === "comment.updated") payload.commentIds = (after.snapshot?.comments ?? []).map((comment: any) => comment.id);
  if (type === "ledger.appended") payload.ledgerEntryIds = (after.snapshot?.ledger ?? []).slice(before?.snapshot?.ledger?.length ?? 0).map((entry: any) => entry.id);
  if (type === "proposal.updated") payload.proposalId = after.snapshot?.proposal?.id ?? null;
  if (type === "approval.committed") payload.approvedProposalId = before?.snapshot?.proposal?.id ?? null;
  return payload;
}
