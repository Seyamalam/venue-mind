import { useMemo, useState, type FormEvent } from "react";
import { Check, X } from "@phosphor-icons/react";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../components/ui/select";
import { Sheet, SheetContent, SheetTitle } from "../components/ui/sheet";
import { Textarea } from "../components/ui/textarea";
import type { CommentsState, DomainRecord, ValueCallback, ValueOption, VoidCallback } from "./ui-types";

const kinds = ["project", "plan-version", "proposal", "change", "constraint", "coordinate"];
const kindCode: Record<string, string> = { project: "PRJ", "plan-version": "VER", proposal: "PRO", change: "CHG", constraint: "CON", coordinate: "XY" };

const anchorLabel = (anchor: DomainRecord) => anchor.kind === "coordinate"
  ? `${anchor.point.x}, ${anchor.point.y} · v${anchor.planVersion}`
  : anchor.changeId ?? anchor.constraintId ?? anchor.proposalId ?? anchor.planVersion ?? anchor.projectId;

type CommentSelectProps = { label: string; value: string; onValueChange: ValueCallback; options: ValueOption[] };

function CommentSelect({ label, value, onValueChange, options }: CommentSelectProps) {
  return <Select key={`${label}:${options.map((option) => option.value).join("|")}`} value={value} onValueChange={onValueChange}>
    <SelectTrigger aria-label={label}><span className="select-current-value">{options.find((option) => option.value === value)?.label}</span></SelectTrigger>
    <SelectContent position="popper" align="start" sideOffset={4}>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>;
}

type CommentsPanelProps = {
  open: boolean; state: CommentsState; selectedCommentId?: string | null;
  onAdd: (input: DomainRecord) => unknown;
  onEdit: (comment: DomainRecord, changes: DomainRecord) => unknown;
  onStatus: (commentId: string, status: string) => unknown;
  onClose: VoidCallback;
};

export function CommentsPanel({ open, state, selectedCommentId, onAdd, onEdit, onStatus, onClose }: CommentsPanelProps) {
  const [kind, setKind] = useState("coordinate");
  const [subjectId, setSubjectId] = useState("");
  const [point, setPoint] = useState({ x: 12, y: 8 });
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState("");
  const [decisionRelevant, setDecisionRelevant] = useState(false);
  const [filters, setFilters] = useState({ status: "all", authorId: "all", subjectKind: "all" });
  const authors = useMemo(() => [...new Set(state.comments.map((comment) => String(comment.authorId)))].sort(), [state.comments]);
  const subjectOptionsRaw: Array<{ id: string; label: string }> = kind === "proposal"
    ? state.branches.flatMap((branch) => [branch.proposal, ...(branch.revisions ?? [])]).map((proposal) => ({ id: proposal.id, label: proposal.id }))
    : kind === "change"
      ? state.branches.flatMap((branch) => [branch.proposal, ...(branch.revisions ?? [])]).flatMap((proposal) => proposal.changes.map((change: DomainRecord) => ({ id: change.id, label: `${change.shortTitle ?? change.title} · ${change.id}` })))
      : kind === "constraint"
        ? state.plan.constraints.map((constraint: DomainRecord) => ({ id: constraint.id, label: `${constraint.label} · ${constraint.id}` }))
        : [];
  const subjectOptions = [...new Map<string, { id: string; label: string }>(subjectOptionsRaw.map((option) => [option.id, option])).values()];
  const filtered = state.comments.filter((comment) => (filters.status === "all" || comment.status === filters.status) && (filters.authorId === "all" || comment.authorId === filters.authorId) && (filters.subjectKind === "all" || comment.anchor.kind === filters.subjectKind));

  const anchor = () => {
    if (kind === "project") return { kind, projectId: state.plan.id };
    if (kind === "plan-version") return { kind, planVersion: state.plan.version };
    if (kind === "proposal") return { kind, proposalId: subjectId || state.proposal.id };
    if (kind === "change") return { kind, changeId: subjectId || state.proposal.changes[0]?.id };
    if (kind === "constraint") return { kind, constraintId: subjectId || state.plan.constraints[0]?.id };
    return { kind, planVersion: state.plan.version, point };
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!body.trim() || (["proposal", "change", "constraint"].includes(kind) && !subjectOptions.length)) return;
    const result = onAdd({ anchor: anchor(), body, mentions: mentions.split(",").map((value) => value.trim()).filter(Boolean), decisionRelevant });
    if (result) { setBody(""); setMentions(""); setDecisionRelevant(false); }
  };

  return <Sheet open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} modal={false}>
    <SheetContent className="comments-panel !h-auto !gap-0 !p-0 sm:!max-w-none" side="right" showOverlay={false} showCloseButton={false} aria-label="Comments and annotations">
    <header><div><SheetTitle asChild><b>COMMENTS</b></SheetTitle><span>{state.comments.filter((comment) => comment.status === "open").length} OPEN</span></div><Button variant="ghost" size="icon-xs" type="button" aria-label="Close comments" onClick={onClose}><X size={17} /></Button></header>
    <form className="comment-compose" onSubmit={submit}>
      <div className="comment-anchor-fields"><div className="comment-anchor-field"><span>TYPE</span><CommentSelect label="Comment type" value={kind} onValueChange={(value) => { setKind(value); setSubjectId(""); }} options={kinds.map((value) => ({ value, label: kindCode[value] }))} /></div>{subjectOptions.length > 0 && <div className="comment-anchor-field is-subject"><span>SUBJECT</span><CommentSelect label="Comment subject" value={subjectId || subjectOptions[0]?.id} onValueChange={setSubjectId} options={subjectOptions.map((option) => ({ value: option.id, label: option.label }))} /></div>}{kind === "coordinate" && <><label><span>X</span><Input type="number" step="0.05" value={point.x} onChange={(event) => setPoint((value) => ({ ...value, x: Number(event.target.value) }))} /></label><label><span>Y</span><Input type="number" step="0.05" value={point.y} onChange={(event) => setPoint((value) => ({ ...value, y: Number(event.target.value) }))} /></label></>}</div>
      <Textarea aria-label="New comment" placeholder="COMMENT" value={body} onChange={(event) => setBody(event.target.value)} required />
      <div className="comment-compose-meta"><Input aria-label="Mentions" placeholder="MENTIONS" value={mentions} onChange={(event) => setMentions(event.target.value)} /><label><Checkbox checked={decisionRelevant} onCheckedChange={(checked) => setDecisionRelevant(checked === true)} aria-label="Decision relevant" /><span>DEC</span></label><Button type="submit" disabled={["proposal", "change", "constraint"].includes(kind) && !subjectOptions.length}>ADD</Button></div>
    </form>
    <div className="comment-filters"><CommentSelect label="Comment status filter" value={filters.status} onValueChange={(status) => setFilters((value) => ({ ...value, status }))} options={[{ value: "all", label: "ALL" }, { value: "open", label: "OPEN" }, { value: "resolved", label: "DONE" }]} /><CommentSelect label="Comment subject filter" value={filters.subjectKind} onValueChange={(subjectKind) => setFilters((value) => ({ ...value, subjectKind }))} options={[{ value: "all", label: "SUBJECT" }, ...kinds.map((value) => ({ value, label: kindCode[value] }))]} /><CommentSelect label="Comment author filter" value={filters.authorId} onValueChange={(authorId) => setFilters((value) => ({ ...value, authorId }))} options={[{ value: "all", label: "AUTHOR" }, ...authors.map((author) => ({ value: author, label: author }))]} /></div>
    <div className="comment-list">{filtered.map((comment) => <article className={`${comment.id === selectedCommentId ? "is-selected" : ""} is-${comment.status}`} key={comment.id}>
      <div className="comment-index">{String(state.comments.findIndex((item) => item.id === comment.id) + 1).padStart(2, "0")}</div><div className="comment-record"><header><span>{kindCode[comment.anchor.kind]} · {anchorLabel(comment.anchor)}</span>{comment.decisionRelevant && <b>DEC</b>}</header><Textarea aria-label={`Edit ${comment.id}`} defaultValue={comment.body} key={`${comment.id}-${comment.updatedAt}`} onBlur={(event) => { if (event.currentTarget.value.trim() !== comment.body) onEdit(comment, { body: event.currentTarget.value }); }} /><Input aria-label={`Mentions for ${comment.id}`} defaultValue={comment.mentions.join(", ")} key={`${comment.id}-mentions-${comment.updatedAt}`} placeholder="MENTIONS" onBlur={(event) => { const next = event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean); if (JSON.stringify(next) !== JSON.stringify(comment.mentions)) onEdit(comment, { mentions: next }); }} /><footer><span>{comment.authorId} · {comment.createdAt.slice(11, 16)} · E{comment.editHistory.length}</span><Button variant="ghost" size="xs" type="button" onClick={() => onStatus(comment.id, comment.status === "open" ? "resolved" : "open")}>{comment.status === "open" ? <><Check size={12} /> DONE</> : "REOPEN"}</Button></footer></div>
    </article>)}</div>
    </SheetContent>
  </Sheet>;
}
