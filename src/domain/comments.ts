import { venueError } from "./errors.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const SUBJECT_KINDS: any = new Set(["project", "plan-version", "proposal", "change", "constraint", "coordinate"]);
const STATUSES: any = new Set(["open", "resolved"]);

const proposals: any = (state: any) => {
  const values: any = [state.proposal];
  for (const branch of state.branches ?? []) values.push(branch.proposal, ...(branch.revisions ?? []));
  return values.filter(Boolean);
};

const knownPlanVersions: any = (state: any) => new Set([
  state.plan.version,
  ...state.ledger.map((entry: any) => entry.details?.acceptedPlan?.version).filter(Boolean),
]);

const normalizeMentions: any = (mentions: any = []) => [...new Set(mentions.map((mention: any) => String(mention).trim().replace(/^@/, "")).filter(Boolean))].sort();
const normalizeBody: any = (body: any) => {
  const value: any = String(body ?? "").trim();
  if (!value || value.length > 5000) throw venueError("COMMENT_INVALID", { field: "body", maximum: 5000 });
  return value;
};

export function normalizeCommentAnchor(state: any, anchor: any) {
  if (!SUBJECT_KINDS.has(anchor?.kind)) throw venueError("COMMENT_ANCHOR_INVALID", { kind: anchor?.kind ?? null });
  const base: any = { kind: anchor.kind, planId: state.plan.id };
  if (anchor.kind === "project") return { ...base, projectId: String(anchor.projectId ?? state.plan.id) };
  if (anchor.kind === "plan-version") {
    const planVersion: any = String(anchor.planVersion ?? state.plan.version);
    if (!knownPlanVersions(state).has(planVersion)) throw venueError("COMMENT_ANCHOR_INVALID", { kind: anchor.kind, planVersion });
    return { ...base, planVersion };
  }
  if (anchor.kind === "proposal") {
    const proposalId: any = String(anchor.proposalId ?? "");
    if (!proposals(state).some((proposal: any) => proposal.id === proposalId)) throw venueError("COMMENT_ANCHOR_INVALID", { kind: anchor.kind, proposalId });
    return { ...base, proposalId };
  }
  if (anchor.kind === "change") {
    const changeId: any = String(anchor.changeId ?? "");
    const proposal: any = proposals(state).find((item: any) => item.changes.some((change: any) => change.id === changeId));
    if (!proposal) throw venueError("COMMENT_ANCHOR_INVALID", { kind: anchor.kind, changeId });
    return { ...base, proposalId: proposal.id, changeId };
  }
  if (anchor.kind === "constraint") {
    const constraintId: any = String(anchor.constraintId ?? "");
    if (!state.plan.constraints.some((constraint: any) => constraint.id === constraintId)) throw venueError("COMMENT_ANCHOR_INVALID", { kind: anchor.kind, constraintId });
    return { ...base, constraintId };
  }
  const planVersion: any = String(anchor.planVersion ?? state.plan.version);
  const point: any = { x: Number(anchor.point?.x), y: Number(anchor.point?.y) };
  if (!knownPlanVersions(state).has(planVersion) || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw venueError("COMMENT_ANCHOR_INVALID", { kind: anchor.kind, planVersion, point });
  return { ...base, planVersion, point: { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 } };
}

export function normalizeComments(comments: any = []) {
  if (!Array.isArray(comments)) throw venueError("SNAPSHOT_INVALID", { field: "comments" });
  const ids: any = new Set();
  return comments.map((comment: any) => {
    if (!comment?.id || ids.has(comment.id) || !STATUSES.has(comment.status) || !SUBJECT_KINDS.has(comment.anchor?.kind)) throw venueError("SNAPSHOT_INVALID", { field: "comments", commentId: comment?.id ?? null });
    ids.add(comment.id);
    return { ...clone(comment), mentions: normalizeMentions(comment.mentions), editHistory: Array.isArray(comment.editHistory) ? clone(comment.editHistory) : [], decisionRelevant: comment.decisionRelevant === true };
  });
}

export function createComment(state: any, command: any, occurredAt: any = new Date().toISOString()) {
  const authorId: any = command.actorId?.trim();
  if (!authorId) throw venueError("COMMENT_AUTHOR_REQUIRED");
  const number: any = state.comments.length + 1;
  return {
    id: `comment-${String(number).padStart(4, "0")}`,
    anchor: normalizeCommentAnchor(state, command.anchor),
    body: normalizeBody(command.body),
    mentions: normalizeMentions(command.mentions),
    decisionRelevant: command.decisionRelevant === true,
    status: "open",
    authorId,
    authorType: command.actor ?? "human",
    createdAt: occurredAt,
    updatedAt: occurredAt,
    resolvedAt: null,
    resolvedBy: null,
    editHistory: [],
  };
}

export function editComment(comments: any, command: any, occurredAt: any = new Date().toISOString()) {
  const existing: any = comments.find((comment: any) => comment.id === command.commentId);
  if (!existing) throw venueError("COMMENT_NOT_FOUND", { commentId: command.commentId });
  if (!command.actorId?.trim()) throw venueError("COMMENT_AUTHOR_REQUIRED");
  const body: any = normalizeBody(command.body);
  const mentions: any = normalizeMentions(command.mentions ?? existing.mentions);
  const decisionRelevant: any = command.decisionRelevant ?? existing.decisionRelevant;
  if (body === existing.body && JSON.stringify(mentions) === JSON.stringify(existing.mentions) && decisionRelevant === existing.decisionRelevant) return { comments, comment: existing, changed: false };
  const history: any = [...existing.editHistory, { body: existing.body, mentions: clone(existing.mentions), decisionRelevant: existing.decisionRelevant, editedAt: occurredAt, editedBy: command.actorId.trim() }];
  const comment: any = { ...existing, body, mentions, decisionRelevant, editHistory: history, updatedAt: occurredAt };
  return { comments: comments.map((item: any) => item.id === comment.id ? comment : item), comment, changed: true };
}

export function setCommentStatus(comments: any, command: any, occurredAt: any = new Date().toISOString()) {
  const existing: any = comments.find((comment: any) => comment.id === command.commentId);
  if (!existing) throw venueError("COMMENT_NOT_FOUND", { commentId: command.commentId });
  if (!command.actorId?.trim()) throw venueError("COMMENT_AUTHOR_REQUIRED");
  if (!STATUSES.has(command.status)) throw venueError("COMMENT_INVALID", { field: "status", status: command.status });
  if (existing.status === command.status) return { comments, comment: existing, changed: false };
  const comment: any = { ...existing, status: command.status, updatedAt: occurredAt, resolvedAt: command.status === "resolved" ? occurredAt : null, resolvedBy: command.status === "resolved" ? command.actorId.trim() : null };
  return { comments: comments.map((item: any) => item.id === comment.id ? comment : item), comment, changed: true };
}

export function listComments(state: any, filters: any = {}) {
  return clone(state.comments.filter((comment: any) => (
    (!filters.status || comment.status === filters.status)
    && (!filters.authorId || comment.authorId === filters.authorId)
    && (!filters.subjectKind || comment.anchor.kind === filters.subjectKind)
    && (filters.decisionRelevant === undefined || comment.decisionRelevant === filters.decisionRelevant)
  )));
}
