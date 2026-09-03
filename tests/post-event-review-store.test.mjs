import assert from "node:assert/strict";
import test from "node:test";
import { recordPostEventObservation } from "../src/domain/post-event-review.ts";
import {
  createMemoryPostEventReviewPersistenceAdapter,
  createPostEventReviewStore,
} from "../src/persistence/post-event-review-store.ts";
import {
  makePostEventReviewFixture,
  observationCommand,
  projectId,
} from "./post-event-review-persistence-fixture.mjs";

const organizationId = "org-alpha";
const clock = () => "2026-09-12T19:00:00.000Z";
const options = (adapter) => ({
  organizationId,
  projectId,
  reviewId: makePostEventReviewFixture().review.id,
  adapter,
  clock,
});
const revisedReview = () => {
  const { review, planEvidence } = makePostEventReviewFixture();
  return recordPostEventObservation(review, {
    type: "record_post_event_observation",
    observationId: "observation-authoritative",
    predictionKey: review.predictions[0].key,
    value: 405,
    confidence: "measured",
    evidenceRefs: [planEvidence],
    expectedRevision: 0,
    actorType: "human",
    actorId: "user-ops",
    source: "studio",
    sessionId: "session-review",
    idempotencyKey: "authoritative-observation",
    committedAt: "2026-09-12T18:10:00.000Z",
  }).review;
};

test("Post-Event Review persistence keeps an immutable, ordered, and exactly idempotent outbox", async () => {
  const store = createPostEventReviewStore(options(createMemoryPostEventReviewPersistenceAdapter()));
  await store.enqueue(observationCommand(2, "post-event-command-2"));
  const original = observationCommand(1, "post-event-command-1");
  const first = await store.enqueue(original);
  original.value = 999;
  const retry = await store.enqueue(observationCommand(1, "post-event-command-1"));

  assert.equal(retry.id, first.id);
  assert.deepEqual((await store.listOutbox()).map((entry) => entry.command.clientSequence), [1, 2]);
  assert.equal((await store.listOutbox())[0].command.value, 400);
  await assert.rejects(
    () => store.enqueue(observationCommand(1, "post-event-command-1", 450)),
    (error) => error.code === "IDEMPOTENCY_KEY_CONFLICT",
  );
  await assert.rejects(
    () => store.enqueue({ ...observationCommand(1, "different-key"), operationId: "different-operation" }),
    (error) => error.code === "COMMAND_INVALID" && error.details.reason === "post-event-review-client-sequence-conflict",
  );
});

test("Post-Event Review conflicts remain recoverable until explicitly discarded", async () => {
  const store = createPostEventReviewStore(options(createMemoryPostEventReviewPersistenceAdapter()));
  await store.enqueue(observationCommand(1, "post-event-applied"));
  await store.enqueue(observationCommand(2, "post-event-conflict"));
  await store.markAttempted(["post-event-applied", "post-event-conflict"]);
  const result = await store.acknowledge([
    { idempotencyKey: "post-event-applied", operationId: "operation-1", status: "applied" },
    {
      idempotencyKey: "post-event-conflict",
      operationId: "operation-2",
      status: "conflict",
      code: "POST_EVENT_REVISION_CONFLICT",
      details: { currentRevision: 3 },
    },
  ]);

  assert.deepEqual(result, { removed: ["post-event-applied"], retained: ["post-event-conflict"], ignored: [] });
  const retained = await store.listOutbox();
  assert.equal(retained.length, 1);
  assert.equal(retained[0].syncStatus, "conflict");
  assert.equal(retained[0].attempts, 1);
  assert.deepEqual(await store.discardConflicts(), ["post-event-conflict"]);
});

test("Post-Event Review authoritative refresh replaces optimistic state while ordinary saves stay monotonic", async () => {
  const store = createPostEventReviewStore(options(createMemoryPostEventReviewPersistenceAdapter()));
  const baseline = makePostEventReviewFixture().review;
  const revised = revisedReview();
  await store.saveReview(revised);
  assert.equal((await store.saveReview(baseline)).revision, 1);
  assert.equal((await store.saveReview(baseline, { authoritative: true })).revision, 0);
  assert.equal((await store.hydrate()).review.revision, 0);
});

test("Post-Event Review cache recovery quarantines corrupt state without dropping pending commands", async () => {
  const { review } = makePostEventReviewFixture();
  const key = `${organizationId}::${projectId}::${encodeURIComponent(review.id)}`;
  const stored = {
    schemaVersion: 1,
    scopeKey: key,
    organizationId,
    projectId,
    reviewId: review.id,
    review: { ...review, predictions: "invalid" },
  };
  const adapter = createMemoryPostEventReviewPersistenceAdapter({ reviews: [stored] });
  const store = createPostEventReviewStore(options(adapter));
  await store.enqueue(observationCommand(1, "post-event-recovery-command"));
  const hydrated = await store.hydrate();

  assert.equal(hydrated.review, null);
  assert.equal(hydrated.recovery.code, "POST_EVENT_REVIEW_CACHE_INVALID");
  assert.equal(hydrated.outbox.length, 1);
  assert.equal((await adapter.listRecovery(key)).length, 1);
});

test("Post-Event Review store falls back to memory when IndexedDB is unavailable", async () => {
  const store = createPostEventReviewStore({
    organizationId,
    projectId,
    reviewId: makePostEventReviewFixture().review.id,
    indexedDB: null,
  });
  assert.equal(store.persistenceKind, "memory");
  await store.enqueue(observationCommand(1, "post-event-memory-fallback"));
  assert.equal((await store.listOutbox()).length, 1);
});
