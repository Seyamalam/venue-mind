import { venueError } from "./errors.ts";
import {
  createPostEventReview,
  createTemplateImprovementProposal,
  exportPostEventReport,
  inspectPostEventReview,
  recordPostEventLesson,
  recordPostEventObservation,
  reviewTemplateImprovementProposal,
} from "./post-event-review.ts";
import type { PostEventReview, PostEventReviewCommand } from "./post-event-review-types.ts";

const clone = <Value>(value: Value): Value => value == null ? value : structuredClone(value);

export interface PostEventReviewCommandBusOptions {
  readonly initialReview?: PostEventReview | null;
  readonly onChange?: (review: PostEventReview | null, event: object) => void;
}

/** Shared pure-domain command seam. Adapters supply identity, authorization, clocks, and persistence. */
export function createPostEventReviewCommandBus({
  initialReview = null,
  onChange = () => {},
}: PostEventReviewCommandBusOptions = {}) {
  let review: PostEventReview | null = clone(initialReview);
  const listeners = new Set<() => void>();
  const requireReview = (): PostEventReview => review ?? (() => { throw venueError("POST_EVENT_REVIEW_NOT_FOUND"); })();
  const publish = (next: PostEventReview, event: object): void => {
    review = clone(next);
    onChange(clone(review), clone(event));
    listeners.forEach((listener) => listener());
  };
  return Object.freeze({
    getSnapshot: (): PostEventReview | null => clone(review),
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    hydrate(nextReview: PostEventReview | null) {
      review = clone(nextReview);
      onChange(clone(review), { type: "post-event.review.hydrated", reviewId: nextReview?.id ?? null });
      listeners.forEach((listener) => listener());
      return clone(review);
    },
    execute(command: PostEventReviewCommand) {
      if (command.type === "create_post_event_review") {
        if (review) {
          if (review.projectId !== command.projectId || review.runbookVersionId !== command.runbook.versionId)
            throw venueError("POST_EVENT_BASELINE_INVALID", { reason: "review-already-bound", reviewId: review.id });
          return { status: "existing", review: clone(review) };
        }
        const next = createPostEventReview(command);
        publish(next, { type: "post-event.review.created", reviewId: next.id });
        return { status: "created", review: clone(next) };
      }
      const current = requireReview();
      if (command.type === "inspect_post_event_review") return inspectPostEventReview(current);
      if (command.type === "export_post_event_report") return exportPostEventReport(current, command);
      const result = command.type === "record_post_event_observation"
        ? recordPostEventObservation(current, command)
        : command.type === "record_post_event_lesson"
          ? recordPostEventLesson(current, command)
          : command.type === "create_template_improvement_proposal"
            ? createTemplateImprovementProposal(current, command)
            : command.type === "review_template_improvement_proposal"
              ? reviewTemplateImprovementProposal(current, command)
              : (() => { throw venueError("COMMAND_UNSUPPORTED", { commandType: "unknown" }); })();
      if (!result.duplicate) {
        const transition = result.review.transitions.at(-1);
        if (!transition) throw venueError("POST_EVENT_LEDGER_INTEGRITY_FAILED", { reason: "transition-missing" });
        publish(result.review, {
          type: transition.type,
          reviewId: result.review.id,
          subjectId: transition.subjectId,
          transitionId: transition.id,
          receiptId: result.receipt.id,
        });
      }
      return clone(result);
    },
  });
}
