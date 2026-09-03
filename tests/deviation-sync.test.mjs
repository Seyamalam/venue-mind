import assert from "node:assert/strict";
import test from "node:test";
import { synchronizeDeviations } from "../src/persistence/deviation-sync.ts";

const register = (revision) => ({ revision, updatedAt: `2026-09-12T10:0${revision}:00.000Z` });

test("Deviation sync sends ordered commands, refreshes authoritative state, and retains revision conflicts", async () => {
  const calls = [];
  let outbox = [
    { idempotencyKey: "deviation-1", syncStatus: "pending", command: { clientSequence: 1 } },
    { idempotencyKey: "deviation-2", syncStatus: "pending", command: { clientSequence: 2 } },
  ];
  const store = {
    async listOutbox() {
      return outbox;
    },
    async markAttempted(keys) {
      calls.push(["attempted", keys]);
    },
    async saveRegister(value, options) {
      calls.push(["saved", value.revision, options.authoritative]);
    },
    async acknowledge(acknowledgements) {
      calls.push(["acknowledged", acknowledgements.map((item) => item.status)]);
      outbox = [{ ...outbox[1], syncStatus: "conflict" }];
      return { removed: ["deviation-1"], retained: ["deviation-2"], ignored: [] };
    },
  };
  const remote = {
    async sync(projectId, registerId, commands) {
      calls.push(["sync", projectId, registerId, commands.map((command) => command.clientSequence)]);
      return {
        register: register(3),
        acknowledgements: [
          { idempotencyKey: "deviation-1", operationId: "op-1", status: "applied" },
          {
            idempotencyKey: "deviation-2",
            operationId: "op-2",
            status: "conflict",
            code: "DEVIATION_REGISTER_REVISION_CONFLICT",
          },
        ],
      };
    },
  };

  const result = await synchronizeDeviations({
    projectId: "project-alpha",
    registerId: "deviation-register-1",
    store,
    remote,
  });
  assert.deepEqual(calls, [
    ["attempted", ["deviation-1", "deviation-2"]],
    ["sync", "project-alpha", "deviation-register-1", [1, 2]],
    ["saved", 3, true],
    ["acknowledged", ["applied", "conflict"]],
  ]);
  assert.deepEqual(result.syncState, {
    state: "conflict",
    pendingCount: 1,
    conflictCount: 1,
    lastSyncedAt: "2026-09-12T10:03:00.000Z",
  });
});

test("Deviation sync refreshes the authoritative register when there are no local commands", async () => {
  const saved = [];
  const store = {
    async listOutbox() {
      return [];
    },
    async saveRegister(value, options) {
      saved.push([value, options]);
    },
  };
  const remote = {
    async get() {
      return { register: register(4) };
    },
  };
  const result = await synchronizeDeviations({
    projectId: "project-alpha",
    registerId: "deviation-register-1",
    store,
    remote,
  });

  assert.deepEqual(saved, [[register(4), { authoritative: true }]]);
  assert.deepEqual(result.syncState, {
    state: "online",
    pendingCount: 0,
    conflictCount: 0,
    lastSyncedAt: "2026-09-12T10:04:00.000Z",
  });
});
