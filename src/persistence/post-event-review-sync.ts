import type { PostEventReviewRemote } from "./post-event-review-remote.ts";
import type { PostEventReviewStore } from "./post-event-review-store.ts";

interface SynchronizePostEventReviewOptions {
  readonly projectId: string;
  readonly reviewId: string;
  readonly store: PostEventReviewStore;
  readonly remote: PostEventReviewRemote;
}

export async function synchronizePostEventReview({
  projectId,
  reviewId,
  store,
  remote,
}: SynchronizePostEventReviewOptions) {
  if (!projectId.trim() || !reviewId.trim())
    throw new TypeError("Post-Event Review sync requires Project and Review IDs");
  const pending = await store.listOutbox();
  if (!pending.length) {
    const loaded = await remote.get(projectId, reviewId);
    await store.saveReview(loaded.review, { authoritative: true });
    return {
      ...loaded,
      acknowledgements: loaded.acknowledgements ?? [],
      acknowledgement: { removed: [], retained: [], ignored: [] },
      syncState: {
        state: "online" as const,
        pendingCount: 0,
        conflictCount: 0,
        lastSyncedAt: loaded.review.updatedAt,
      },
    };
  }
  await store.markAttempted(pending.map((entry) => entry.idempotencyKey));
  const result = await remote.sync(
    projectId,
    reviewId,
    pending.map((entry) => entry.command),
  );
  const acknowledgements = result.acknowledgements ?? [];
  await store.saveReview(result.review, { authoritative: true });
  const acknowledgement = await store.acknowledge(acknowledgements);
  const remaining = await store.listOutbox();
  const conflictCount = remaining.filter(
    (entry) => entry.syncStatus === "conflict" || entry.syncStatus === "rejected",
  ).length;
  return {
    ...result,
    acknowledgements,
    acknowledgement,
    syncState: {
      state: conflictCount ? ("conflict" as const) : remaining.length ? ("offline" as const) : ("online" as const),
      pendingCount: remaining.length,
      conflictCount,
      lastSyncedAt: result.review.updatedAt,
    },
  };
}
