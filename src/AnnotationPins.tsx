import type { PinEvent } from "./ui-types";
import type { CommentAnchor, VenueComment } from "./domain/comments";

type CoordinateComment = VenueComment & { anchor: Extract<CommentAnchor, { kind: "coordinate" }> };
const hasCoordinateAnchor = (comment: VenueComment): comment is CoordinateComment =>
  comment.anchor.kind === "coordinate";

type AnnotationPinsProps = {
  comments: VenueComment[];
  planVersion: string;
  maxY: number;
  selectedCommentId?: string | null;
  onSelect: (commentId: string) => void;
};

export function AnnotationPins({ comments, planVersion, maxY, selectedCommentId, onSelect }: AnnotationPinsProps) {
  return (
    <g className="annotation-pins">
      {comments
        .filter(hasCoordinateAnchor)
        .filter((comment) => comment.anchor.planVersion === planVersion)
        .map((comment) => {
          const number = comments.findIndex((item) => item.id === comment.id) + 1;
          const activate = (event: PinEvent) => {
            event.stopPropagation();
            onSelect(comment.id);
          };
          return (
            <g
              className={`annotation-pin is-${comment.status} ${comment.id === selectedCommentId ? "is-selected" : ""}`}
              role="button"
              tabIndex={0}
              aria-label={`Comment ${number}: ${comment.body}`}
              key={comment.id}
              transform={`translate(${comment.anchor.point.x} ${maxY - comment.anchor.point.y})`}
              onPointerDown={(event) => {
                event.stopPropagation();
              }}
              onClick={activate}
              onKeyDown={(event) => {
                if (["Enter", " "].includes(event.key)) activate(event);
              }}
            >
              <circle r=".38" />
              <path d="M-.16 .3 L0 .62 L.16 .3" />
              <text y=".11">{number}</text>
            </g>
          );
        })}
    </g>
  );
}
