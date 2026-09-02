import { venueError } from "./errors.ts";
import type { Point, VenuePlan, VenueProposal } from "./geometry.ts";
import type { ActivityLedgerEntry } from "./activity-ledger.ts";

export type CommentSubjectKind = "project" | "plan-version" | "proposal" | "change" | "constraint" | "coordinate";
export type CommentAnchor =
  | { kind: "project"; planId: string; projectId: string }
  | { kind: "plan-version"; planId: string; planVersion: string }
  | { kind: "proposal"; planId: string; proposalId: string }
  | { kind: "change"; planId: string; proposalId: string; changeId: string }
  | { kind: "constraint"; planId: string; constraintId: string }
  | { kind: "coordinate"; planId: string; planVersion: string; point: Point };
export interface VenueComment {
  id: string;
  anchor: CommentAnchor;
  body: string;
  mentions: string[];
  decisionRelevant: boolean;
  status: "open" | "resolved";
  authorId: string;
  authorType: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  editHistory: Array<{
    body: string;
    mentions: string[];
    decisionRelevant: boolean;
    editedAt: string;
    editedBy: string;
  }>;
}
interface CommentState {
  plan: VenuePlan;
  proposal: VenueProposal;
  branches?: Array<{ proposal: VenueProposal; revisions?: VenueProposal[] }>;
  ledger: ActivityLedgerEntry[];
  comments: VenueComment[];
}
export interface RawAnchor {
  kind?: unknown;
  projectId?: unknown;
  planVersion?: unknown;
  proposalId?: unknown;
  changeId?: unknown;
  constraintId?: unknown;
  point?: { x?: unknown; y?: unknown };
}
export interface CommentCommand {
  actorId?: string | undefined;
  actor?: string | undefined;
  anchor?: object | undefined;
  body?: string | undefined;
  mentions?: readonly string[] | undefined;
  decisionRelevant?: boolean | undefined;
  commentId?: string | undefined;
  status?: "open" | "resolved" | undefined;
}
export interface CommentFilters {
  status?: VenueComment["status"] | undefined;
  authorId?: string | undefined;
  subjectKind?: CommentSubjectKind | undefined;
  decisionRelevant?: boolean | undefined;
}
const isComment = (input: unknown): input is VenueComment =>
  input !== null &&
  typeof input === "object" &&
  !Array.isArray(input) &&
  "id" in input &&
  typeof input.id === "string" &&
  "status" in input &&
  typeof input.status === "string";

const clone = <T>(value: T): T => structuredClone(value);
const SUBJECT_KINDS = new Set(["project", "plan-version", "proposal", "change", "constraint", "coordinate"]);
const STATUSES = new Set(["open", "resolved"]);
const isSubjectKind = (value: unknown): value is CommentSubjectKind =>
  typeof value === "string" && SUBJECT_KINDS.has(value);
const isCommentStatus = (value: unknown): value is VenueComment["status"] =>
  typeof value === "string" && STATUSES.has(value);
const rawAnchor = (value: object | undefined): RawAnchor => value ?? {};
const stringOr = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);
const commentFilters = (value: object): CommentFilters => {
  const filters: CommentFilters = {};
  if ("status" in value && isCommentStatus(value.status)) filters.status = value.status;
  if ("authorId" in value && typeof value.authorId === "string") filters.authorId = value.authorId;
  if ("subjectKind" in value && isSubjectKind(value.subjectKind)) filters.subjectKind = value.subjectKind;
  if ("decisionRelevant" in value && typeof value.decisionRelevant === "boolean")
    filters.decisionRelevant = value.decisionRelevant;
  return filters;
};

const proposals = (state: CommentState): VenueProposal[] => {
  const values = [state.proposal];
  for (const branch of state.branches ?? []) values.push(branch.proposal, ...(branch.revisions ?? []));
  return values.filter(Boolean);
};

const knownPlanVersions = (state: CommentState): Set<string> =>
  new Set([
    state.plan.version,
    ...state.ledger
      .map((entry) => entry.details.acceptedPlan?.version)
      .filter((version): version is string => typeof version === "string"),
  ]);

const normalizeMentions = (mentions: readonly string[] = []): string[] =>
  [...new Set(mentions.map((mention) => String(mention).trim().replace(/^@/, "")).filter(Boolean))].sort();
const normalizeBody = (body: unknown): string => {
  const value = stringOr(body, "").trim();
  if (!value || value.length > 5000) throw venueError("COMMENT_INVALID", { field: "body", maximum: 5000 });
  return value;
};

export function normalizeCommentAnchor(state: CommentState, anchor: RawAnchor): CommentAnchor {
  const kind = anchor?.kind;
  if (!isSubjectKind(kind))
    throw venueError("COMMENT_ANCHOR_INVALID", { kind: typeof kind === "string" ? kind : null });
  const base = { planId: state.plan.id };
  if (kind === "project") return { ...base, kind, projectId: stringOr(anchor.projectId, state.plan.id) };
  if (kind === "plan-version") {
    const planVersion = stringOr(anchor.planVersion, state.plan.version);
    if (!knownPlanVersions(state).has(planVersion)) throw venueError("COMMENT_ANCHOR_INVALID", { kind, planVersion });
    return { ...base, kind, planVersion };
  }
  if (kind === "proposal") {
    const proposalId = stringOr(anchor.proposalId, "");
    if (!proposals(state).some((proposal) => proposal.id === proposalId))
      throw venueError("COMMENT_ANCHOR_INVALID", { kind, proposalId });
    return { ...base, kind, proposalId };
  }
  if (kind === "change") {
    const changeId = stringOr(anchor.changeId, "");
    const proposal = proposals(state).find((item) => item.changes.some((change) => change.id === changeId));
    if (!proposal) throw venueError("COMMENT_ANCHOR_INVALID", { kind, changeId });
    return { ...base, kind, proposalId: proposal.id, changeId };
  }
  if (kind === "constraint") {
    const constraintId = stringOr(anchor.constraintId, "");
    if (!state.plan.constraints.some((constraint) => constraint.id === constraintId))
      throw venueError("COMMENT_ANCHOR_INVALID", { kind, constraintId });
    return { ...base, kind, constraintId };
  }
  const planVersion = stringOr(anchor.planVersion, state.plan.version);
  const point = { x: Number(anchor.point?.x), y: Number(anchor.point?.y) };
  if (!knownPlanVersions(state).has(planVersion) || !Number.isFinite(point.x) || !Number.isFinite(point.y))
    throw venueError("COMMENT_ANCHOR_INVALID", { kind, planVersion, point });
  return {
    ...base,
    kind: "coordinate",
    planVersion,
    point: { x: Math.round(point.x * 1000) / 1000, y: Math.round(point.y * 1000) / 1000 },
  };
}

export function normalizeComments(comments: readonly unknown[] = []): VenueComment[] {
  if (!Array.isArray(comments)) throw venueError("SNAPSHOT_INVALID", { field: "comments" });
  const ids = new Set();
  return comments.map((comment) => {
    if (!isComment(comment)) throw venueError("SNAPSHOT_INVALID", { field: "comments" });
    if (
      !comment?.id ||
      ids.has(comment.id) ||
      !STATUSES.has(comment.status) ||
      !SUBJECT_KINDS.has(comment.anchor?.kind)
    )
      throw venueError("SNAPSHOT_INVALID", { field: "comments", commentId: comment?.id ?? null });
    ids.add(comment.id);
    return {
      ...clone(comment),
      mentions: normalizeMentions(comment.mentions),
      editHistory: Array.isArray(comment.editHistory) ? clone(comment.editHistory) : [],
      decisionRelevant: comment.decisionRelevant,
    };
  });
}

export function createComment(
  state: CommentState,
  command: CommentCommand,
  occurredAt = new Date().toISOString(),
): VenueComment {
  const authorId = command.actorId?.trim();
  if (!authorId) throw venueError("COMMENT_AUTHOR_REQUIRED");
  const number = state.comments.length + 1;
  return {
    id: `comment-${String(number).padStart(4, "0")}`,
    anchor: normalizeCommentAnchor(state, rawAnchor(command.anchor)),
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

export function editComment(comments: VenueComment[], command: CommentCommand, occurredAt = new Date().toISOString()) {
  const existing = comments.find((comment) => comment.id === command.commentId);
  if (!existing) throw venueError("COMMENT_NOT_FOUND", { commentId: command.commentId });
  const actorId = command.actorId?.trim();
  if (!actorId) throw venueError("COMMENT_AUTHOR_REQUIRED");
  const body = normalizeBody(command.body);
  const mentions = normalizeMentions(command.mentions ?? existing.mentions);
  const decisionRelevant = command.decisionRelevant ?? existing.decisionRelevant;
  if (
    body === existing.body &&
    JSON.stringify(mentions) === JSON.stringify(existing.mentions) &&
    decisionRelevant === existing.decisionRelevant
  )
    return { comments, comment: existing, changed: false };
  const history = [
    ...existing.editHistory,
    {
      body: existing.body,
      mentions: clone(existing.mentions),
      decisionRelevant: existing.decisionRelevant,
      editedAt: occurredAt,
      editedBy: actorId,
    },
  ];
  const comment = { ...existing, body, mentions, decisionRelevant, editHistory: history, updatedAt: occurredAt };
  return { comments: comments.map((item) => (item.id === comment.id ? comment : item)), comment, changed: true };
}

export function setCommentStatus(
  comments: VenueComment[],
  command: CommentCommand,
  occurredAt = new Date().toISOString(),
) {
  const existing = comments.find((comment) => comment.id === command.commentId);
  if (!existing) throw venueError("COMMENT_NOT_FOUND", { commentId: command.commentId });
  const actorId = command.actorId?.trim();
  if (!actorId) throw venueError("COMMENT_AUTHOR_REQUIRED");
  const status = command.status;
  if (!isCommentStatus(status)) throw venueError("COMMENT_INVALID", { field: "status", status: status ?? null });
  if (existing.status === status) return { comments, comment: existing, changed: false };
  const comment: VenueComment = {
    ...existing,
    status,
    updatedAt: occurredAt,
    resolvedAt: status === "resolved" ? occurredAt : null,
    resolvedBy: status === "resolved" ? actorId : null,
  };
  return { comments: comments.map((item) => (item.id === comment.id ? comment : item)), comment, changed: true };
}

export function listComments(state: CommentState, input: object = {}): VenueComment[] {
  const filters = commentFilters(input);
  return clone(
    state.comments.filter(
      (comment) =>
        (!filters.status || comment.status === filters.status) &&
        (!filters.authorId || comment.authorId === filters.authorId) &&
        (!filters.subjectKind || comment.anchor.kind === filters.subjectKind) &&
        (filters.decisionRelevant === undefined || comment.decisionRelevant === filters.decisionRelevant),
    ),
  );
}
