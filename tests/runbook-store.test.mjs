import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRunbookPersistenceAdapter, createRunbookStore } from "../src/persistence/runbook-store.ts";

const makeRunbook = (revision = 0) => ({ schemaVersion: 1, id: "runbook-project-plan", versionId: "runbook-project-plan-v1", revision, version: 1, frozenAt: "2026-09-11T20:00:00.000Z", source: { projectId: "project-summit-forward" }, tasks: [] });

const command = (sequence, overrides = {}) => ({
  type: "transition_runbook_task",
  runbookVersionId: "runbook-project-plan-v1",
  taskId: `runbook-task-${sequence}`,
  expectedTaskRevision: 0,
  toStatus: "in-progress",
  evidence: [],
  operationId: `operation-${sequence}`,
  idempotencyKey: `idempotency-${sequence}`,
  correlationId: `correlation-${sequence}`,
  clientId: "tablet-ops",
  clientSequence: sequence,
  clientOccurredAt: "2026-09-12T12:00:00.000Z",
  actorType: "human",
  actorId: "user-ops",
  source: "studio",
  sessionId: "session-event-day",
  ...overrides,
});

test("memory fallback hydrates cached Runbook and ordered outbox across store restarts", async () => {
  const adapter = createMemoryRunbookPersistenceAdapter();
  const first = createRunbookStore({ adapter, clock: () => "2026-09-12T11:00:00.000Z" });
  await first.saveRunbook(makeRunbook());
  await first.enqueue(command(3));
  await first.enqueue(command(1));
  await first.enqueue(command(2));

  const restarted = createRunbookStore({ adapter, clock: () => "2026-09-12T11:05:00.000Z" });
  const hydrated = await restarted.hydrate("runbook-project-plan-v1");

  assert.equal(restarted.persistenceKind, "memory");
  assert.equal(hydrated.runbook.versionId, "runbook-project-plan-v1");
  assert.deepEqual(hydrated.outbox.map((entry) => entry.command.clientSequence), [1, 2, 3]);
  assert.deepEqual(hydrated.outbox.map((entry) => entry.command.operationId), ["operation-1", "operation-2", "operation-3"]);
  const byProject = await restarted.hydrateProject("project-summit-forward");
  assert.equal(byProject.runbook.versionId, "runbook-project-plan-v1");
  assert.equal(byProject.outbox.length, 3);
});

test("exact enqueue retries reuse the stable command while semantic key conflicts fail", async () => {
  const adapter = createMemoryRunbookPersistenceAdapter();
  const store = createRunbookStore({ adapter });
  const first = await store.enqueue(command(1));
  const restarted = createRunbookStore({ adapter });
  const retry = await restarted.enqueue(command(1, { correlationId: "correlation-retry" }));

  assert.equal(retry.id, first.id);
  assert.equal(retry.command.operationId, "operation-1");
  assert.equal((await restarted.listOutbox("runbook-project-plan-v1")).length, 1);
  await assert.rejects(
    () => restarted.enqueue(command(1, { operationId: "operation-retry" })),
    (error) => error.code === "IDEMPOTENCY_KEY_CONFLICT",
  );
  await assert.rejects(
    () => restarted.enqueue(command(1, { toStatus: "blocked" })),
    (error) => error.code === "IDEMPOTENCY_KEY_CONFLICT",
  );
});

test("one client sequence identifies exactly one ordered operation", async () => {
  const store = createRunbookStore({ adapter: createMemoryRunbookPersistenceAdapter() });
  await store.enqueue(command(1));
  await assert.rejects(
    () => store.enqueue(command(1, { taskId: "runbook-task-other", idempotencyKey: "idempotency-other", operationId: "operation-other" })),
    (error) => error.code === "COMMAND_INVALID" && error.details.reason === "runbook-client-sequence-conflict",
  );
});

test("acknowledgements remove only applied outcomes and retain conflicts and rejections", async () => {
  const adapter = createMemoryRunbookPersistenceAdapter();
  const store = createRunbookStore({ adapter, clock: () => "2026-09-12T11:10:00.000Z" });
  for (const sequence of [1, 2, 3, 4]) await store.enqueue(command(sequence));
  await store.markAttempted("runbook-project-plan-v1", ["idempotency-1", "idempotency-2", "idempotency-3", "idempotency-4"]);

  const result = await store.acknowledge("runbook-project-plan-v1", [
    { idempotencyKey: "idempotency-1", status: "applied", receiptId: "receipt-1" },
    { idempotencyKey: "idempotency-2", status: "already-applied", receiptId: "receipt-2" },
    { idempotencyKey: "idempotency-3", status: "conflict", code: "RUNBOOK_TASK_REVISION_CONFLICT" },
    { idempotencyKey: "idempotency-4", status: "rejected", code: "RUNBOOK_TRANSITION_INVALID" },
  ], { runbook: makeRunbook(2) });

  assert.deepEqual(result.removed, ["idempotency-1", "idempotency-2"]);
  assert.deepEqual(result.retained, ["idempotency-3", "idempotency-4"]);
  assert.deepEqual(result.outbox.map((entry) => entry.syncStatus), ["conflict", "rejected"]);
  assert.equal(result.outbox[0].attempts, 1);

  const restarted = createRunbookStore({ adapter });
  const hydrated = await restarted.hydrate("runbook-project-plan-v1");
  assert.equal(hydrated.runbook.revision, 2);
  assert.deepEqual(hydrated.outbox.map((entry) => entry.idempotencyKey), ["idempotency-3", "idempotency-4"]);
  assert.equal(hydrated.outbox[0].lastResult.code, "RUNBOOK_TASK_REVISION_CONFLICT");
});

test("unknown acknowledgements are ignored and an older response cannot replace a newer cache", async () => {
  const adapter = createMemoryRunbookPersistenceAdapter();
  const store = createRunbookStore({ adapter });
  await store.saveRunbook(makeRunbook(5));
  await store.enqueue(command(1));

  const result = await store.acknowledge("runbook-project-plan-v1", [
    { idempotencyKey: "missing-operation", status: "applied" },
    { idempotencyKey: "idempotency-1", status: "pending" },
  ], { runbook: makeRunbook(4) });

  assert.deepEqual(result.ignored, ["missing-operation", "idempotency-1"]);
  assert.equal((await store.hydrate("runbook-project-plan-v1")).runbook.revision, 5);
  assert.equal(result.outbox.length, 1);
});

test("store selects the test-safe memory fallback when IndexedDB is unavailable", async () => {
  const store = createRunbookStore({ indexedDB: null });
  assert.equal(store.persistenceKind, "memory");
  await store.enqueue(command(1));
  assert.equal((await store.listOutbox("runbook-project-plan-v1")).length, 1);
});
