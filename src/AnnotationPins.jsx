export function AnnotationPins({ comments, planVersion, maxY, selectedCommentId, onSelect }) {
  return <g className="annotation-pins">{comments.filter((comment) => comment.anchor.kind === "coordinate" && comment.anchor.planVersion === planVersion).map((comment) => {
    const number = comments.findIndex((item) => item.id === comment.id) + 1;
    const activate = (event) => { event.stopPropagation(); onSelect(comment.id); };
    return <g className={`annotation-pin is-${comment.status} ${comment.id === selectedCommentId ? "is-selected" : ""}`} role="button" tabIndex="0" aria-label={`Comment ${number}: ${comment.body}`} key={comment.id} transform={`translate(${comment.anchor.point.x} ${maxY - comment.anchor.point.y})`} onPointerDown={(event) => event.stopPropagation()} onClick={activate} onKeyDown={(event) => { if (["Enter", " "].includes(event.key)) activate(event); }}><circle r=".38" /><path d="M-.16 .3 L0 .62 L.16 .3" /><text y=".11">{number}</text></g>;
  })}</g>;
}
