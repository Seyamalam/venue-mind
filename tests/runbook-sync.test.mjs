import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRunbookPersistenceAdapter, createRunbookStore } from "../src/persistence/runbook-store.js";
import { synchronizeRunbook } from "../src/persistence/runbook-sync.js";

const runbook = (revision = 1) => ({ schemaVersion: 1, id: "runbook-project-plan", versionId: "runbook-project-plan-v1", version: 1, revision, frozenAt: "2026-09-11T20:00:00.000Z", source: { projectId: "project-a" }, tasks: [] });
const command = (sequence) => ({ type: "transition_runbook_task", runbookVersionId: "runbook-project-plan-v1", taskId: `task-${sequence}`, expectedTaskRevision: 0, fromStatus: "pending", toStatus: "in-progress", evidence: [], operationId: `operation-${sequence}`, idempotencyKey: `idempotency-${sequence}`, correlationId: `correlation-${sequence}`, clientId: "tablet-a", clientSequence: sequence, clientOccurredAt: "2026-09-12T12:00:00.000Z", actorType: "human", actorId: "user-a", source: "studio", sessionId: "session-a" });

test("Runbook synchronization ensures the remote baseline before flushing the ordered outbox", async () => {
  const calls = [];
  const store = createRunbookStore({ adapter: createMemoryRunbookPersistenceAdapter() });
  await store.saveRunbook(runbook());
  await store.enqueue(command(2));
  await store.enqueue(command(1));
  const authoritative = runbook(3);
  const result = await synchronizeRunbook({
    projectId: "project-a",
    runbook: runbook(),
    store,
    clock: () => "2026-09-12T12:05:00.000Z",
    remote: {
      async create(_projectId, value) { calls.push(["create", value.versionId]); return { runbook: value }; },
      async sync(_projectId, versionId, commands) {
        calls.push(["sync", versionId, commands.map((item) => item.clientSequence)]);
        return { runbook: authoritative, acknowledgements: commands.map((item) => ({ idempotencyKey: item.idempotencyKey, status: "applied" })) };
      },
    },
  });

  assert.deepEqual(calls, [["create", "runbook-project-plan-v1"], ["sync", "runbook-project-plan-v1", [1, 2]]]);
  assert.equal(result.runbook.revision, 3);
  assert.deepEqual(result.syncState, { state: "online", pendingCount: 0, conflictCount: 0, lastSyncedAt: "2026-09-12T12:05:00.000Z" });
  assert.equal((await store.listOutbox("runbook-project-plan-v1")).length, 0);
  assert.equal((await store.hydrate("runbook-project-plan-v1")).runbook.revision, 3);
});

test("Runbook synchronization retains rejected commands and reports conflict state", async () => {
  const store = createRunbookStore({ adapter: createMemoryRunbookPersistenceAdapter() });
  await store.enqueue(command(1));
  const result = await synchronizeRunbook({
    projectId: "project-a",
    runbook: runbook(),
    store,
    remote: {
      async create(_projectId, value) { return { runbook: value }; },
      async sync() { return { runbook: runbook(2), acknowledgements: [{ idempotencyKey: "idempotency-1", status: "conflict", code: "RUNBOOK_TASK_REVISION_CONFLICT" }] }; },
    },
  });
  assert.equal(result.syncState.state, "conflict");
  assert.equal(result.syncState.pendingCount, 1);
  assert.equal(result.syncState.conflictCount, 1);
  assert.equal((await store.listOutbox("runbook-project-plan-v1"))[0].syncStatus, "conflict");
});
