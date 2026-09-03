import test from "node:test";
import assert from "node:assert/strict";
import { createProjectStore } from "../src/persistence/project-store.ts";

const createStorage = () => {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    key: (index) => [...values.keys()][index] ?? null,
  };
};

const recordInput = {
  id: "project-summit-forward",
  name: "SummitForward 2026",
  activePlanId: "plan-summit-forward-2026",
  snapshot: {
    plan: { id: "plan-summit-forward-2026", version: "3.2" },
    proposal: { id: "proposal-32-a" },
    ledger: [],
    receipts: [{ correlationId: "corr-save-001" }],
  },
  createdAt: "2026-08-27T00:00:00.000Z",
};

const createRevisionServer = (initial) => {
  let remote = structuredClone(initial);
  return {
    read: () => structuredClone(remote),
    fetch: async (_url, init = {}) => {
      if (init.method !== "PUT")
        return remote
          ? Response.json(remote, { headers: { etag: `"venuemind:${remote.id}:${remote.revision}"` } })
          : Response.json({ error: "missing" }, { status: 404 });
      const input = JSON.parse(init.body);
      if (init.headers["if-none-match"] === "*") {
        if (remote)
          return Response.json({ code: "PROJECT_ID_CONFLICT", details: { current: remote } }, { status: 409 });
        remote = { ...input, revision: 1 };
        return Response.json(remote, { status: 201 });
      }
      const expected = `"venuemind:${remote.id}:${remote.revision}"`;
      if (init.headers["if-match"] !== expected)
        return Response.json(
          {
            code: "PROJECT_REVISION_CONFLICT",
            details: { current: remote, currentRevision: remote.revision, currentEtag: expected },
          },
          { status: 412 },
        );
      remote = { ...input, revision: remote.revision + 1 };
      return Response.json(remote);
    },
  };
};

test("remote project storage is authoritative and cached for recovery", async () => {
  const storage = createStorage();
  let remoteRecord = null;
  const store = createProjectStore({
    storage,
    clock: () => "2026-08-27T01:00:00.000Z",
    fetchImpl: async (url, init = {}) => {
      if (init.method === "PUT") {
        assert.equal(init.headers["x-correlation-id"], "corr-save-001");
        remoteRecord = JSON.parse(init.body);
        return Response.json(remoteRecord);
      }
      return remoteRecord ? Response.json(remoteRecord) : Response.json({ error: "missing" }, { status: 404 });
    },
  });

  const saved = await store.save(recordInput);
  const loaded = await store.load(recordInput.id);

  assert.equal(saved.source, "remote");
  assert.equal(saved.record.schemaVersion, 10);
  assert.equal(loaded.source, "remote");
  assert.deepEqual(loaded.record, remoteRecord);
  assert.ok(storage.getItem("venuemind.organization.org-local.project.project-summit-forward"));
});

test("Project metadata lifecycle preserves the snapshot", async () => {
  const storage = createStorage();
  let remoteRecord = null;
  const store = createProjectStore({
    storage,
    clock: () => "2026-08-27T01:00:00.000Z",
    fetchImpl: async (_url, init = {}) => {
      if (init.method === "PUT") {
        remoteRecord = JSON.parse(init.body);
        return Response.json(remoteRecord);
      }
      return remoteRecord ? Response.json(remoteRecord) : Response.json({ error: "missing" }, { status: 404 });
    },
  });
  await store.save(recordInput);
  const originalSnapshot = structuredClone(remoteRecord.snapshot);

  await store.rename(recordInput.id, "SummitForward Copy");
  await store.pin(recordInput.id, true);
  await store.archive(recordInput.id, true);
  assert.equal(remoteRecord.name, "SummitForward Copy");
  assert.equal(remoteRecord.pinned, true);
  assert.equal(remoteRecord.archivedAt, "2026-08-27T01:00:00.000Z");
  assert.deepEqual(remoteRecord.snapshot, originalSnapshot);

  await store.archive(recordInput.id, false);
  assert.equal(remoteRecord.deletedAt, null);
  assert.equal(remoteRecord.recoveryUntil, null);
  assert.equal(remoteRecord.archivedAt, null);
  assert.deepEqual(remoteRecord.snapshot, originalSnapshot);
});

test("Project deletion purges every local Project key before explicitly acknowledging the server directive", async () => {
  const storage = createStorage();
  const remote = {
    ...recordInput,
    organizationId: "org-local",
    schemaVersion: 10,
    revision: 4,
    updatedAt: "2026-08-27T01:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    recoveryUntil: null,
    pinned: false,
    lastOpenedAt: null,
  };
  const calls = [];
  const evidence = {
    schemaVersion: 1,
    id: "project-deletion-1",
    projectId: remote.id,
    projectRevision: 5,
    status: "recoverable",
    recoveryUntil: "2026-09-03T01:00:00.000Z",
    cacheDirective: {
      id: "cache-delete-1",
      action: "delete-project-cache",
      issuedAt: "2026-08-27T01:00:00.000Z",
      acknowledgedAt: null,
      acknowledgedBy: null,
    },
  };
  const store = createProjectStore({
    storage,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (String(url).endsWith("/deletion/cache-ack"))
        return Response.json({ ...evidence, cacheDirective: { ...evidence.cacheDirective, acknowledgedAt: "2026-08-27T01:00:01.000Z", acknowledgedBy: "user-1" } });
      if (init.method === "DELETE") return Response.json(evidence, { status: 202 });
      return Response.json(remote);
    },
  });
  await store.load(remote.id);
  storage.setItem(`venuemind.organization.org-local.recovery.${remote.id}.4.1`, "recovery");
  await assert.rejects(() => store.deleteProject(remote.id, "WRONG"), (error) => error.code === "PROJECT_CONFIRMATION_MISMATCH");
  const result = await store.deleteProject(remote.id, remote.name);
  assert.equal(result.cacheDirective.acknowledgedAt, "2026-08-27T01:00:01.000Z");
  assert.equal(calls.find((call) => call.init.method === "DELETE").init.headers["if-match"], '"venuemind:project-summit-forward:4"');
  assert.deepEqual(JSON.parse(calls.find((call) => call.init.method === "DELETE").init.body), { reasonCode: "USER_REQUEST" });
  assert.deepEqual(JSON.parse(calls.at(-1).init.body), { deletionRequestId: "project-deletion-1", directiveId: "cache-delete-1" });
  assert.equal(storage.length, 0);
});

test("local recovery storage remains available when the project endpoint is offline", async () => {
  const storage = createStorage();
  const store = createProjectStore({
    storage,
    clock: () => "2026-08-27T01:00:00.000Z",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });

  assert.equal((await store.save(recordInput)).source, "local");
  const loaded = await store.load(recordInput.id);
  assert.equal(loaded.source, "local");
  assert.equal(loaded.record.schemaVersion, 10);
  assert.equal(loaded.record.snapshot.plan.version, "3.2");
  assert.equal(store.inspectRecovery(recordInput.id).status, "pass");
});

test("an interrupted browser commit recovers the verified autosave journal", async () => {
  const storage = createStorage();
  const primaryKey = "venuemind.organization.org-local.project.project-summit-forward";
  let interruptPrimary = true;
  const interruptedStorage = {
    ...storage,
    get length() {
      return storage.length;
    },
    setItem(key, value) {
      if (key === primaryKey && interruptPrimary) {
        interruptPrimary = false;
        throw new Error("injected-tab-crash");
      }
      storage.setItem(key, value);
    },
  };
  const offline = async () => {
    throw new Error("offline");
  };
  const first = createProjectStore({ storage: interruptedStorage, fetchImpl: offline });
  assert.equal((await first.save(recordInput)).source, "local");
  assert.equal(storage.getItem(primaryKey), null);
  assert.ok(storage.getItem("venuemind.organization.org-local.autosave.project-summit-forward"));

  const restarted = createProjectStore({ storage, fetchImpl: offline });
  const loaded = await restarted.load(recordInput.id);
  assert.equal(loaded.record.snapshot.plan.version, "3.2");
  assert.equal(restarted.inspectRecovery(recordInput.id).status, "pass");
  assert.ok(storage.getItem(primaryKey));
  assert.equal(storage.getItem("venuemind.organization.org-local.autosave.project-summit-forward"), null);
});

test("corrupted browser recovery is quarantined without exposing its payload", async () => {
  const storage = createStorage();
  const primaryKey = "venuemind.organization.org-local.project.project-summit-forward";
  storage.setItem(primaryKey, '{"snapshot":{"secret":"do-not-copy"}}');
  const store = createProjectStore({
    storage,
    fetchImpl: async () => {
      throw new Error("offline");
    },
    clock: () => "2026-09-03T10:00:00.000Z",
  });
  const loaded = await store.load(recordInput.id);
  assert.equal(loaded.record, null);
  assert.equal(loaded.integrity.status, "quarantined");
  assert.equal(storage.getItem(primaryKey), null);
  const quarantine = storage.getItem("venuemind.organization.org-local.quarantine.project-summit-forward");
  assert.ok(quarantine);
  assert.doesNotMatch(quarantine, /do-not-copy/);
  assert.equal(store.inspectRecovery(recordInput.id).status, "quarantined");
});

test("network interruption remains local and a later retry commits the exact recovery", async () => {
  const storage = createStorage();
  let online = false;
  let remote = null;
  let writes = 0;
  const store = createProjectStore({
    storage,
    clock: () => "2026-09-03T10:00:00.000Z",
    fetchImpl: async (_url, init = {}) => {
      if (!online) throw new Error("injected-network-interruption");
      if (init.method === "PUT") {
        writes += 1;
        remote = { ...JSON.parse(init.body), revision: 1 };
        return Response.json(remote, { status: 201 });
      }
      return remote ? Response.json(remote) : Response.json({ code: "PROJECT_NOT_FOUND" }, { status: 404 });
    },
  });
  const local = await store.save(recordInput);
  assert.equal(local.source, "local");
  assert.equal(writes, 0);
  online = true;
  const retried = await store.save({ ...recordInput, snapshot: local.record.snapshot });
  assert.equal(retried.source, "remote");
  assert.equal(writes, 1);
  assert.equal(remote.snapshot.plan.version, "3.2");
});

test("import commit creates a missing Project and refuses to overwrite an existing ID", async () => {
  const storage = createStorage();
  let remoteRecord = null;
  const store = createProjectStore({
    storage,
    clock: () => "2026-08-27T01:00:00.000Z",
    fetchImpl: async (_url, init = {}) => {
      if (init.method === "PUT") {
        if (remoteRecord && init.headers["if-none-match"] === "*")
          return Response.json({ error: "Project already exists" }, { status: 409 });
        remoteRecord = JSON.parse(init.body);
        return Response.json(remoteRecord, { status: 201 });
      }
      return remoteRecord ? Response.json(remoteRecord) : Response.json({ error: "missing" }, { status: 404 });
    },
  });

  const imported = {
    ...recordInput,
    organizationId: "org-local",
    schemaVersion: 10,
    updatedAt: "2026-08-27T01:00:00.000Z",
    archivedAt: null,
    deletedAt: null,
    recoveryUntil: null,
    pinned: false,
    lastOpenedAt: null,
    provenance: {
      sourceFormat: "venuemind-project",
      formatVersion: 1,
      packageId: "package-abc",
      payloadSha256: "a".repeat(64),
      exportedAt: "2026-08-27T00:30:00.000Z",
      importedAt: "2026-08-27T01:00:00.000Z",
      originalProjectId: recordInput.id,
      source: {},
    },
  };
  const created = await store.importProject(imported);

  assert.equal(created.status, "created");
  assert.equal(created.record.provenance.packageId, "package-abc");
  await assert.rejects(
    () => store.importProject(imported),
    (error) => error.code === "PROJECT_ID_CONFLICT",
  );
});

test("independent stale edits reconcile with a three-way merge", async () => {
  const base = {
    ...recordInput,
    organizationId: "org-local",
    schemaVersion: 10,
    revision: 1,
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
  const server = createRevisionServer(base);
  const tabA = createProjectStore({
    storage: createStorage(),
    fetchImpl: server.fetch,
    clock: () => "2026-08-27T01:00:00.000Z",
  });
  const tabB = createProjectStore({
    storage: createStorage(),
    fetchImpl: server.fetch,
    clock: () => "2026-08-27T02:00:00.000Z",
  });
  await tabA.load(base.id);
  await tabB.load(base.id);

  await tabA.save({ ...recordInput, name: "RENAMED" });
  const localSnapshot = structuredClone(recordInput.snapshot);
  localSnapshot.proposal.goal = "TAB B LAYOUT";
  const merged = await tabB.save({ ...recordInput, snapshot: localSnapshot });

  assert.equal(merged.source, "remote");
  assert.equal(merged.reconciliation.status, "merged");
  assert.equal(merged.record.revision, 3);
  assert.equal(merged.record.name, "RENAMED");
  assert.equal(merged.record.snapshot.proposal.goal, "TAB B LAYOUT");
});

test("overlapping stale planning edits fail visibly and preserve local recovery state", async () => {
  const base = {
    ...recordInput,
    organizationId: "org-local",
    schemaVersion: 10,
    revision: 1,
    updatedAt: "2026-08-27T00:00:00.000Z",
  };
  const server = createRevisionServer(base);
  const tabA = createProjectStore({
    storage: createStorage(),
    fetchImpl: server.fetch,
    clock: () => "2026-08-27T01:00:00.000Z",
  });
  const tabB = createProjectStore({
    storage: createStorage(),
    fetchImpl: server.fetch,
    clock: () => "2026-08-27T02:00:00.000Z",
  });
  await tabA.load(base.id);
  await tabB.load(base.id);
  const snapshotA = structuredClone(base.snapshot);
  snapshotA.proposal.goal = "TAB A LAYOUT";
  const snapshotB = structuredClone(base.snapshot);
  snapshotB.proposal.goal = "TAB B LAYOUT";
  await tabA.save({ ...recordInput, snapshot: snapshotA });

  await assert.rejects(
    () => tabB.save({ ...recordInput, snapshot: snapshotB }),
    (error) => {
      assert.equal(error.code, "PROJECT_REVISION_CONFLICT");
      assert.equal(error.conflict.kind, "planning");
      assert.deepEqual(error.conflict.overlappingFields, ["snapshot"]);
      assert.deepEqual(error.conflict.resolutions, ["recover-proposal-branch", "use-remote"]);
      return true;
    },
  );
  assert.equal(tabB.listRecoveries(base.id).length, 1);
  assert.equal(server.read().snapshot.proposal.goal, "TAB A LAYOUT");
});
