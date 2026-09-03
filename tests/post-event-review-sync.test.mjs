import assert from "node:assert/strict";
import test from "node:test";
import { synchronizePostEventReview } from "../src/persistence/post-event-review-sync.ts";

const review = (revision) => ({ revision, updatedAt: `2026-09-12T19:0${revision}:00.000Z` });

test("Post-Event Review sync preserves order, refreshes authority, and retains revision conflicts", async () => {
  const calls = [];
  let outbox = [
    { idempotencyKey: "review-1", syncStatus: "pending", command: { clientSequence: 1 } },
    { idempotencyKey: "review-2", syncStatus: "pending", command: { clientSequence: 2 } },
  ];
  const store = {
    async listOutbox() { return outbox; },
    async markAttempted(keys) { calls.push(["attempted", keys]); },
    async saveReview(value, options) { calls.push(["saved", value.revision, options.authoritative]); },
    async acknowledge(acknowledgements) {
      calls.push(["acknowledged", acknowledgements.map((item) => item.status)]);
      outbox = [{ ...outbox[1], syncStatus: "conflict" }];
      return { removed: ["review-1"], retained: ["review-2"], ignored: [] };
    },
  };
  const remote = {
    async sync(projectId, reviewId, commands) {
      calls.push(["sync", projectId, reviewId, commands.map((command) => command.clientSequence)]);
      return {
        review: review(3),
        acknowledgements: [
          { idempotencyKey: "review-1", operationId: "operation-1", status: "applied" },
          { idempotencyKey: "review-2", operationId: "operation-2", status: "conflict", code: "POST_EVENT_REVISION_CONFLICT" },
        ],
      };
    },
  };

  const result = await synchronizePostEventReview({ projectId: "project-alpha", reviewId: "review-1", store, remote });
  assert.deepEqual(calls, [
    ["attempted", ["review-1", "review-2"]],
    ["sync", "project-alpha", "review-1", [1, 2]],
    ["saved", 3, true],
    ["acknowledged", ["applied", "conflict"]],
  ]);
  assert.deepEqual(result.syncState, {
    state: "conflict",
    pendingCount: 1,
    conflictCount: 1,
    lastSyncedAt: "2026-09-12T19:03:00.000Z",
  });
});

test("Post-Event Review sync performs an authoritative refresh with an empty outbox", async () => {
  const saved = [];
  const store = {
    async listOutbox() { return []; },
    async saveReview(value, options) { saved.push([value, options]); },
  };
  const remote = { async get() { return { review: review(4) }; } };
  const result = await synchronizePostEventReview({ projectId: "project-alpha", reviewId: "review-1", store, remote });

  assert.deepEqual(saved, [[review(4), { authoritative: true }]]);
  assert.deepEqual(result.syncState, {
    state: "online",
    pendingCount: 0,
    conflictCount: 0,
    lastSyncedAt: "2026-09-12T19:04:00.000Z",
  });
});
