import assert from "node:assert/strict";
import test from "node:test";
import { createIncidentStore, createMemoryIncidentPersistenceAdapter } from "../src/persistence/incident-store.ts";

const command = (clientSequence, idempotencyKey, summary = `Issue ${clientSequence}`) => ({
  type: "create_incident",
  projectId: "project-alpha",
  incidentId: `incident-${clientSequence}`,
  summary,
  operationId: `operation-${clientSequence}`,
  idempotencyKey,
  clientId: "browser-a",
  clientSequence,
});

test("Incident browser recovery preserves ordered retry-safe commands", async () => {
  const adapter = createMemoryIncidentPersistenceAdapter();
  const store = createIncidentStore({ organizationId: "org-alpha", projectId: "project-alpha", adapter, clock: () => "2026-09-12T10:00:00.000Z" });
  await store.saveState({ schemaVersion: 1, organizationId: "org-alpha", projectId: "project-alpha", revision: 1, incidents: [{ id: "incident-existing" }], handoffs: [], updatedAt: "2026-09-12T09:59:00.000Z" });

  await store.enqueue(command(2, "incident-command-2"));
  const first = await store.enqueue(command(1, "incident-command-1"));
  const duplicate = await store.enqueue(command(1, "incident-command-1"));

  assert.equal(duplicate.id, first.id);
  assert.deepEqual((await store.listOutbox()).map((entry) => entry.command.clientSequence), [1, 2]);
  assert.deepEqual((await store.hydrate()).incidents.map((incident) => incident.id), ["incident-existing"]);
  await assert.rejects(() => store.enqueue(command(1, "incident-command-1", "Changed input")), (error) => error.code === "IDEMPOTENCY_KEY_CONFLICT");
});

test("Incident browser recovery quarantines an invalid cached projection without dropping its outbox", async () => {
  const scopeKey = "org-alpha::project-alpha";
  const pending = command(1, "incident-recovery-command");
  const adapter = createMemoryIncidentPersistenceAdapter({
    states: [{ scopeKey, schemaVersion: 1, organizationId: "org-alpha", projectId: "project-alpha", revision: 1, incidents: "invalid", handoffs: [] }],
    outbox: [{ id: `${scopeKey}::incident-recovery-command`, scopeKey, schemaVersion: 1, idempotencyKey: pending.idempotencyKey, inputFingerprint: "stored", command: pending, attempts: 0, enqueuedAt: "2026-09-12T10:00:00.000Z" }],
  });
  const store = createIncidentStore({ organizationId: "org-alpha", projectId: "project-alpha", adapter, clock: () => "2026-09-12T10:05:00.000Z" });

  const hydrated = await store.hydrate();

  assert.equal(hydrated.state, null);
  assert.equal(hydrated.register, null);
  assert.equal(hydrated.recovery.code, "INCIDENT_CACHE_INVALID");
  assert.equal(hydrated.outbox.length, 1);
  assert.equal((await adapter.listRecovery(scopeKey)).length, 1);
});

test("Incident store uses the test-safe memory fallback when IndexedDB is unavailable", async () => {
  const store = createIncidentStore({ organizationId: "org-alpha", projectId: "project-alpha", indexedDB: null });
  assert.equal(store.persistenceKind, "memory");
  await store.enqueue(command(1, "incident-memory-fallback"));
  assert.equal((await store.listOutbox()).length, 1);
});

test("Incident store caches the authoritative Incident Register source shape", async () => {
  const store = createIncidentStore({ organizationId: "org-alpha", projectId: "project-alpha", adapter: createMemoryIncidentPersistenceAdapter() });
  const register = {
    schemaVersion: 1,
    id: "incident-register-1",
    projectId: "project-alpha",
    runbookVersionId: "runbook-alpha-v1",
    revision: 3,
    incidents: [{ id: "incident-alpha", handoffs: [{ id: "handoff-1" }] }],
    ledger: [],
    updatedAt: "2026-09-12T10:10:00.000Z",
  };

  assert.deepEqual(await store.saveRegister(register), register);
  const hydrated = await store.hydrate();
  assert.deepEqual(hydrated.register, register);
  assert.deepEqual(hydrated.handoffs, [{ id: "handoff-1", incidentId: "incident-alpha" }]);
});

test("Incident store gives humans an explicit way to discard retained conflicts", async () => {
  const store = createIncidentStore({ organizationId: "org-alpha", projectId: "project-alpha", adapter: createMemoryIncidentPersistenceAdapter(), clock: () => "2026-09-12T12:00:00.000Z" });
  const command = { type: "report_incident", operationId: "op-conflict", idempotencyKey: "incident-conflict", clientId: "studio-a", clientSequence: 1 };
  await store.enqueue(command);
  await store.acknowledge([{ idempotencyKey: command.idempotencyKey, status: "conflict", code: "INCIDENT_REVISION_CONFLICT" }]);
  assert.equal((await store.listOutbox())[0].syncStatus, "conflict");
  assert.deepEqual(await store.discardConflicts(), ["incident-conflict"]);
  assert.deepEqual(await store.listOutbox(), []);
});
