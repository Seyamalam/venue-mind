import { useMemo, useState } from "react";
import { Check, X } from "@phosphor-icons/react";

const kinds = ["project", "plan-version", "proposal", "change", "constraint", "coordinate"];
const kindCode = { project: "PRJ", "plan-version": "VER", proposal: "PRO", change: "CHG", constraint: "CON", coordinate: "XY" };

const anchorLabel = (anchor) => anchor.kind === "coordinate"
  ? `${anchor.point.x}, ${anchor.point.y} · v${anchor.planVersion}`
  : anchor.changeId ?? anchor.constraintId ?? anchor.proposalId ?? anchor.planVersion ?? anchor.projectId;

export function CommentsPanel({ state, selectedCommentId, onAdd, onEdit, onStatus, onClose }) {
  const [kind, setKind] = useState("coordinate");
  const [subjectId, setSubjectId] = useState("");
  const [point, setPoint] = useState({ x: 12, y: 8 });
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState("");
  const [decisionRelevant, setDecisionRelevant] = useState(false);
  const [filters, setFilters] = useState({ status: "all", authorId: "all", subjectKind: "all" });
  const authors = useMemo(() => [...new Set(state.comments.map((comment) => comment.authorId))].sort(), [state.comments]);
  const subjectOptionsRaw = kind === "proposal"
    ? state.branches.flatMap((branch) => [branch.proposal, ...(branch.revisions ?? [])]).map((proposal) => ({ id: proposal.id, label: proposal.id }))
    : kind === "change"
      ? state.branches.flatMap((branch) => [branch.proposal, ...(branch.revisions ?? [])]).flatMap((proposal) => proposal.changes.map((change) => ({ id: change.id, label: `${change.shortTitle ?? change.title} · ${change.id}` })))
      : kind === "constraint"
        ? state.plan.constraints.map((constraint) => ({ id: constraint.id, label: `${constraint.label} · ${constraint.id}` }))
        : [];
  const subjectOptions = [...new Map(subjectOptionsRaw.map((option) => [option.id, option])).values()];
  const filtered = state.comments.filter((comment) => (filters.status === "all" || comment.status === filters.status) && (filters.authorId === "all" || comment.authorId === filters.authorId) && (filters.subjectKind === "all" || comment.anchor.kind === filters.subjectKind));

  const anchor = () => {
    if (kind === "project") return { kind, projectId: state.plan.id };
    if (kind === "plan-version") return { kind, planVersion: state.plan.version };
    if (kind === "proposal") return { kind, proposalId: subjectId || state.proposal.id };
    if (kind === "change") return { kind, changeId: subjectId || state.proposal.changes[0]?.id };
    if (kind === "constraint") return { kind, constraintId: subjectId || state.plan.constraints[0]?.id };
    return { kind, planVersion: state.plan.version, point };
  };

  const submit = (event) => {
    event.preventDefault();
    if (!body.trim() || (["proposal", "change", "constraint"].includes(kind) && !subjectOptions.length)) return;
    const result = onAdd({ anchor: anchor(), body, mentions: mentions.split(",").map((value) => value.trim()).filter(Boolean), decisionRelevant });
    if (result) { setBody(""); setMentions(""); setDecisionRelevant(false); }
  };

  return <aside className="comments-panel" aria-label="Comments and annotations">
    <header><div><b>COMMENTS</b><span>{state.comments.filter((comment) => comment.status === "open").length} OPEN</span></div><button type="button" aria-label="Close comments" onClick={onClose}><X size={17} /></button></header>
    <form className="comment-compose" onSubmit={submit}>
      <div className="comment-anchor-fields"><label><span>TYPE</span><select value={kind} onChange={(event) => { setKind(event.target.value); setSubjectId(""); }}>{kinds.map((value) => <option value={value} key={value}>{kindCode[value]}</option>)}</select></label>{subjectOptions.length > 0 && <label className="is-subject"><span>SUBJECT</span><select value={subjectId || subjectOptions[0]?.id} onChange={(event) => setSubjectId(event.target.value)}>{subjectOptions.map((option) => <option value={option.id} key={`${kind}-${option.id}`}>{option.label}</option>)}</select></label>}{kind === "coordinate" && <><label><span>X</span><input type="number" step="0.05" value={point.x} onChange={(event) => setPoint((value) => ({ ...value, x: Number(event.target.value) }))} /></label><label><span>Y</span><input type="number" step="0.05" value={point.y} onChange={(event) => setPoint((value) => ({ ...value, y: Number(event.target.value) }))} /></label></>}</div>
      <textarea aria-label="New comment" placeholder="COMMENT" value={body} onChange={(event) => setBody(event.target.value)} required />
      <div className="comment-compose-meta"><input aria-label="Mentions" placeholder="MENTIONS" value={mentions} onChange={(event) => setMentions(event.target.value)} /><label><input type="checkbox" checked={decisionRelevant} onChange={(event) => setDecisionRelevant(event.target.checked)} /><span>DEC</span></label><button type="submit" disabled={["proposal", "change", "constraint"].includes(kind) && !subjectOptions.length}>ADD</button></div>
    </form>
    <div className="comment-filters"><select aria-label="Comment status filter" value={filters.status} onChange={(event) => setFilters((value) => ({ ...value, status: event.target.value }))}><option value="all">ALL</option><option value="open">OPEN</option><option value="resolved">DONE</option></select><select aria-label="Comment subject filter" value={filters.subjectKind} onChange={(event) => setFilters((value) => ({ ...value, subjectKind: event.target.value }))}><option value="all">SUBJECT</option>{kinds.map((value) => <option value={value} key={value}>{kindCode[value]}</option>)}</select><select aria-label="Comment author filter" value={filters.authorId} onChange={(event) => setFilters((value) => ({ ...value, authorId: event.target.value }))}><option value="all">AUTHOR</option>{authors.map((author) => <option value={author} key={author}>{author}</option>)}</select></div>
    <div className="comment-list">{filtered.map((comment) => <article className={`${comment.id === selectedCommentId ? "is-selected" : ""} is-${comment.status}`} key={comment.id}>
      <div className="comment-index">{String(state.comments.findIndex((item) => item.id === comment.id) + 1).padStart(2, "0")}</div><div className="comment-record"><header><span>{kindCode[comment.anchor.kind]} · {anchorLabel(comment.anchor)}</span>{comment.decisionRelevant && <b>DEC</b>}</header><textarea aria-label={`Edit ${comment.id}`} defaultValue={comment.body} key={`${comment.id}-${comment.updatedAt}`} onBlur={(event) => { if (event.currentTarget.value.trim() !== comment.body) onEdit(comment, { body: event.currentTarget.value }); }} /><input aria-label={`Mentions for ${comment.id}`} defaultValue={comment.mentions.join(", ")} key={`${comment.id}-mentions-${comment.updatedAt}`} placeholder="MENTIONS" onBlur={(event) => { const next = event.currentTarget.value.split(",").map((value) => value.trim()).filter(Boolean); if (JSON.stringify(next) !== JSON.stringify(comment.mentions)) onEdit(comment, { mentions: next }); }} /><footer><span>{comment.authorId} · {comment.createdAt.slice(11, 16)} · E{comment.editHistory.length}</span><button type="button" onClick={() => onStatus(comment.id, comment.status === "open" ? "resolved" : "open")}>{comment.status === "open" ? <><Check size={12} /> DONE</> : "REOPEN"}</button></footer></div>
    </article>)}</div>
  </aside>;
}
