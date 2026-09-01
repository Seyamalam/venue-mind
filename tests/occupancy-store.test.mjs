import assert from "node:assert/strict";
import test from "node:test";
import { createOccupancyStore } from "../src/persistence/occupancy-store.js";
import { synchronizeOccupancy } from "../src/persistence/occupancy-sync.js";

const storage = () => {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
};
const monitor = (revision = 0) => ({ schemaVersion: 1, id: "occupancy-alpha", projectId: "project-alpha", runbookVersionId: "runbook-alpha-v1", revision, updatedAt: `2026-09-12T12:00:0${revision}.000Z` });
const command = { type: "refresh_live_occupancy", expectedRevision: 0, idempotencyKey: "occupancy-refresh-001", operationId: "occupancy-operation-001" };

test("Live Occupancy recovery cache partitions monitor and ordered outbox by Organization and Project", async () => {
  const backing = storage();
  const alpha = createOccupancyStore({ organizationId: "org-alpha", projectId: "project-alpha", storage: backing, clock: () => "2026-09-12T12:00:00.000Z" });
  const bravo = createOccupancyStore({ organizationId: "org-bravo", projectId: "project-alpha", storage: backing });
  await alpha.saveMonitor(monitor());
  await alpha.enqueue(command);
  await alpha.enqueue(command);
  assert.equal((await alpha.load()).monitor.id, "occupancy-alpha");
  assert.equal((await alpha.listOutbox()).length, 1);
  assert.deepEqual(await bravo.load(), { monitor: null, outbox: [] });
});

test("Live Occupancy synchronization publishes pending commands once and retains conflicts for review", async () => {
  const store = createOccupancyStore({ organizationId: "org-alpha", projectId: "project-alpha", storage: storage(), clock: () => "2026-09-12T12:00:00.000Z" });
  await store.saveMonitor(monitor());
  await store.enqueue(command);
  const remote = { sync: async (_projectId, _monitorId, commands) => ({ acknowledgements: commands.map((value) => ({ idempotencyKey: value.idempotencyKey, status: "applied" })), monitor: monitor(1), projection: { overallStatus: "nominal" } }) };
  const synced = await synchronizeOccupancy({ projectId: "project-alpha", monitorId: "occupancy-alpha", store, remote });
  assert.equal(synced.syncState.state, "online");
  assert.equal(synced.monitor.revision, 1);
  assert.equal((await store.listOutbox()).length, 0);

  await store.enqueue({ ...command, expectedRevision: 1, idempotencyKey: "occupancy-refresh-002" });
  const conflict = await synchronizeOccupancy({ projectId: "project-alpha", monitorId: "occupancy-alpha", store, remote: { sync: async () => ({ acknowledgements: [{ idempotencyKey: "occupancy-refresh-002", status: "conflict", code: "OCCUPANCY_REVISION_CONFLICT" }], monitor: monitor(2), projection: { overallStatus: "stale" } }) } });
  assert.equal(conflict.syncState.state, "conflict");
  assert.equal((await store.listOutbox()).length, 1);
});
