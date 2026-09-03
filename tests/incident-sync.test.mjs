import assert from "node:assert/strict";
import test from "node:test";
import { synchronizeIncidents } from "../src/persistence/incident-sync.ts";

const register = (revision = 2) => ({
  schemaVersion: 1,
  id: "incident-register-1",
  projectId: "project-alpha",
  runbookVersionId: "runbook-alpha-v1",
  revision,
  incidents: [],
  ledger: [],
  updatedAt: `2026-09-12T10:0${revision}:00.000Z`,
});

test("Incident sync sends the ordered outbox and retains conflicts for recovery", async () => {
  const calls = [];
  let outbox = [
    { idempotencyKey: "incident-1", command: { clientId: "browser-a", clientSequence: 1, type: "report_incident" } },
    {
      idempotencyKey: "incident-2",
      command: { clientId: "browser-a", clientSequence: 2, type: "acknowledge_incident" },
    },
  ];
  const store = {
    async listOutbox() {
      return outbox;
    },
    async markAttempted(keys) {
      calls.push(["attempted", keys]);
    },
    async saveRegister(value) {
      calls.push(["saved", value.revision]);
    },
    async acknowledge(acknowledgements) {
      calls.push(["acknowledged", acknowledgements.map((item) => item.status)]);
      outbox = outbox.filter(
        (entry) => acknowledgements.find((item) => item.idempotencyKey === entry.idempotencyKey)?.status !== "applied",
      );
      return { removed: ["incident-1"], retained: ["incident-2"], ignored: [] };
    },
  };
  const remote = {
    async sync(projectId, registerId, commands) {
      calls.push(["sync", projectId, registerId, commands.map((command) => command.clientSequence)]);
      return {
        register: register(3),
        acknowledgements: [
          { idempotencyKey: "incident-1", status: "applied" },
          { idempotencyKey: "incident-2", status: "conflict", code: "INCIDENT_REVISION_CONFLICT" },
        ],
      };
    },
  };

  const result = await synchronizeIncidents({
    projectId: "project-alpha",
    registerId: "incident-register-1",
    store,
    remote,
  });

  assert.deepEqual(calls, [
    ["attempted", ["incident-1", "incident-2"]],
    ["sync", "project-alpha", "incident-register-1", [1, 2]],
    ["saved", 3],
    ["acknowledged", ["applied", "conflict"]],
  ]);
  assert.deepEqual(result.syncState, { state: "conflict", pendingCount: 1, lastSyncedAt: "2026-09-12T10:03:00.000Z" });
  assert.deepEqual(result.acknowledgement.retained, ["incident-2"]);
});

test("Incident sync refreshes the authoritative register when the outbox is empty", async () => {
  const saved = [];
  const store = {
    async listOutbox() {
      return [];
    },
    async saveRegister(value) {
      saved.push(value);
    },
  };
  const remote = {
    async get(projectId, registerId) {
      return { projectId, registerId, register: register(4) };
    },
  };

  const result = await synchronizeIncidents({
    projectId: "project-alpha",
    registerId: "incident-register-1",
    store,
    remote,
  });

  assert.deepEqual(saved, [register(4)]);
  assert.deepEqual(result.syncState, { state: "online", pendingCount: 0, lastSyncedAt: "2026-09-12T10:04:00.000Z" });
});
