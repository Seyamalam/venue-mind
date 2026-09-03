import assert from "node:assert/strict";
import test from "node:test";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { createLivePlanDeviationRegister } from "../src/domain/live-plan-deviations.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import {
  createDeviationStore,
  createMemoryDeviationPersistenceAdapter,
} from "../src/persistence/deviation-store.ts";

const register = (revision = 0) => {
  const runbook = createEventDayRunbook({
    projectId: "project-summit-forward",
    plan: summitForwardPlan,
    validation: { validationId: "validation-approved", inputFingerprint: "validation-input", status: "pass" },
    sourceLedgerHeadHash: "activity-ledger-head",
    approvalLedgerEntryId: "approval-ledger-entry",
    frozenAt: "2026-09-12T08:00:00.000Z",
    frozenBy: "user-ops",
  });
  return {
    ...createLivePlanDeviationRegister({
      type: "create_deviation_register",
      projectId: "project-summit-forward",
      runbook,
      createdAt: "2026-09-12T09:00:00.000Z",
      createdBy: "user-ops",
    }),
    revision,
    updatedAt: `2026-09-12T09:${String(revision).padStart(2, "0")}:00.000Z`,
  };
};

const command = (clientSequence, idempotencyKey, reasonCode = "LIVE_EGRESS_CONTROL") => ({
  type: "record_live_plan_deviation",
  projectId: "project-summit-forward",
  deviationId: `deviation-${clientSequence}`,
  disposition: "temporary",
  reasonCode,
  location: { kind: "plan-object", planObjectId: "obj-fire-exit-east" },
  affectedObjectIds: ["obj-fire-exit-east"],
  availableConstraintIds: ["constraint-emergency-readiness"],
  change: { id: `change-${clientSequence}` },
  expectedRevision: 0,
  actorType: "human",
  actorId: "user-ops",
  source: "studio",
  sessionId: "session-event-day",
  operationId: `operation-${clientSequence}`,
  correlationId: `correlation-${clientSequence}`,
  clientId: "browser-a",
  clientSequence,
  clientOccurredAt: "2026-09-12T09:05:00.000Z",
  idempotencyKey,
});

const options = (adapter) => ({
  organizationId: "org-alpha",
  projectId: "project-summit-forward",
  registerId: register().id,
  adapter,
  clock: () => "2026-09-12T10:00:00.000Z",
});

test("Deviation browser persistence keeps an immutable ordered and exactly idempotent outbox", async () => {
  const store = createDeviationStore(options(createMemoryDeviationPersistenceAdapter()));
  await store.enqueue(command(2, "deviation-command-2"));
  const original = command(1, "deviation-command-1");
  const first = await store.enqueue(original);
  original.reasonCode = "MUTATED_AFTER_ENQUEUE";
  const retry = await store.enqueue(command(1, "deviation-command-1"));

  assert.equal(retry.id, first.id);
  assert.deepEqual((await store.listOutbox()).map((entry) => entry.command.clientSequence), [1, 2]);
  assert.equal((await store.listOutbox())[0].command.reasonCode, "LIVE_EGRESS_CONTROL");
  await assert.rejects(
    () => store.enqueue(command(1, "deviation-command-1", "DIFFERENT_REASON")),
    (error) => error.code === "IDEMPOTENCY_KEY_CONFLICT",
  );
  await assert.rejects(
    () => store.enqueue({ ...command(1, "different-key"), operationId: "different-operation" }),
    (error) => error.code === "COMMAND_INVALID" && error.details.reason === "deviation-client-sequence-conflict",
  );
});

test("Deviation conflicts remain recoverable while successful commands leave the outbox", async () => {
  const store = createDeviationStore(options(createMemoryDeviationPersistenceAdapter()));
  await store.enqueue(command(1, "deviation-applied"));
  await store.enqueue(command(2, "deviation-conflict"));
  await store.markAttempted(["deviation-applied", "deviation-conflict"]);
  const result = await store.acknowledge([
    { idempotencyKey: "deviation-applied", operationId: "operation-1", status: "applied" },
    {
      idempotencyKey: "deviation-conflict",
      operationId: "operation-2",
      status: "conflict",
      code: "DEVIATION_REGISTER_REVISION_CONFLICT",
      details: { currentRevision: 3 },
    },
  ]);

  assert.deepEqual(result, { removed: ["deviation-applied"], retained: ["deviation-conflict"], ignored: [] });
  const retained = await store.listOutbox();
  assert.equal(retained.length, 1);
  assert.equal(retained[0].syncStatus, "conflict");
  assert.equal(retained[0].attempts, 1);
  assert.deepEqual(await store.discardConflicts(), ["deviation-conflict"]);
});

test("Deviation authoritative refresh replaces an optimistic cache while ordinary saves remain monotonic", async () => {
  const store = createDeviationStore(options(createMemoryDeviationPersistenceAdapter()));
  await store.saveRegister(register(5));
  assert.equal((await store.saveRegister(register(3))).revision, 5);
  assert.equal((await store.saveRegister(register(3), { authoritative: true })).revision, 3);
  assert.equal((await store.hydrate()).register.revision, 3);
});

test("Deviation cache recovery quarantines corrupt state without dropping pending commands", async () => {
  const initial = register();
  const key = `org-alpha::project-summit-forward::${encodeURIComponent(initial.id)}`;
  const pending = command(1, "deviation-recovery-command");
  const adapter = createMemoryDeviationPersistenceAdapter({
    registers: [{ ...initial, scopeKey: key, organizationId: "org-alpha", deviations: "invalid" }],
  });
  const store = createDeviationStore(options(adapter));
  await store.enqueue(pending);
  const hydrated = await store.hydrate();

  assert.equal(hydrated.register, null);
  assert.equal(hydrated.recovery.code, "DEVIATION_CACHE_INVALID");
  assert.equal(hydrated.outbox.length, 1);
  assert.equal((await adapter.listRecovery(key)).length, 1);
});

test("Deviation store falls back to memory when IndexedDB is unavailable", async () => {
  const store = createDeviationStore({
    organizationId: "org-alpha",
    projectId: "project-summit-forward",
    registerId: register().id,
    indexedDB: null,
  });
  assert.equal(store.persistenceKind, "memory");
  await store.enqueue(command(1, "memory-fallback"));
  assert.equal((await store.listOutbox()).length, 1);
});
