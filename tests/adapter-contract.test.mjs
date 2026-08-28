import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AdapterContractError, createSyncCursor, defineAdapter, sha256Checksum } from "../src/integrations/contracts.js";
import { roomInventoryAdapter } from "../src/integrations/adapters/room-inventory-adapter.js";
import { createAdapterRuntime, verifySyncCursor } from "../src/integrations/runtime.js";
import { createMemorySecretStore } from "../src/integrations/secret-store.js";
import { assertReviewableStagingBatch, createExternalIdMapping } from "../src/integrations/staging.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/adapter-room-inventory-v1.json", import.meta.url), "utf8"));
const secretStore = createMemorySecretStore({ "room-inventory/api-token": "test-token", "unrelated/private-key": "denied" });
const authorization = { grantedScopes: ["inventory:read"], secretStore, secretReferences: ["room-inventory/api-token"] };
const clock = () => Date.parse("2026-08-28T12:00:00.000Z");

test("adapter definitions are versioned, capability-scoped, exact contracts", () => {
  const definition = roomInventoryAdapter.definition;
  assert.equal(definition.contractVersion, 1);
  assert.equal(definition.version, "1.0.0");
  assert.deepEqual(definition.scopes.import, ["inventory:read"]);
  assert.equal(Object.isFrozen(definition), true);
  assert.throws(
    () => defineAdapter({ ...definition, typo: true }),
    (error) => error instanceof AdapterContractError && error.code === "ADAPTER_CONTRACT_UNKNOWN_FIELD",
  );
  assert.throws(
    () => defineAdapter({ ...definition, contractVersion: 2 }),
    (error) => error.code === "ADAPTER_CONTRACT_VERSION_UNSUPPORTED",
  );
});

test("Room Inventory import produces checksum-bound Proposal staging without mutating an accepted Plan", async () => {
  const runtime = createAdapterRuntime({ clock });
  const input = { ...structuredClone(fixture), basePlanVersion: "3.3" };
  const before = structuredClone(input);
  const result = await runtime.execute(roomInventoryAdapter, "import", input, authorization);

  assert.equal(result.status, "succeeded");
  assert.equal(result.output.status, "awaiting-review");
  assert.equal(result.output.proposal.status, "draft");
  assert.equal(result.output.proposal.basePlanVersion, "3.3");
  assert.equal(result.output.proposal.requiresHumanApproval, true);
  assert.equal(result.output.proposal.source.checksum, result.output.checksum);
  assert.equal(assertReviewableStagingBatch(result.output), true);
  assert.deepEqual(input, before);
  assert.deepEqual(result.output.changes.map((change) => change.external.externalId), ["vendor-chair-7", "vendor-table-2"]);
  assert.equal(result.output.changes[0].operation, "create");
  assert.equal(result.output.changes[0].proposedVenueObjectId, "obj-import-chair-001");
  assert.equal(result.output.changes[1].operation, "update");
  assert.equal(result.output.changes[1].venueObjectId, "obj-table-existing");
  assert.match(result.output.checksum, /^[0-9a-f]{64}$/);
  assert.match(result.output.syncCursor.checksum, /^[0-9a-f]{64}$/);
  assert.deepEqual(await verifySyncCursor(roomInventoryAdapter.definition, result.output.syncCursor), result.output.syncCursor);
  assert.equal(Object.hasOwn(result.output, "acceptedPlan"), false);
});

test("external IDs remain separate from VenueMind stable IDs", async () => {
  await assert.rejects(
    () => createAdapterRuntime({ clock }).execute(roomInventoryAdapter, "import", { ...structuredClone(fixture), stableIds: { "vendor-chair-7": "vendor-chair-7" } }, authorization),
    (error) => error.code === "ADAPTER_ID_BOUNDARY_VIOLATION",
  );
  const result = await createAdapterRuntime({ clock }).execute(roomInventoryAdapter, "import", structuredClone(fixture), authorization);
  assert.throws(
    () => createExternalIdMapping({ venueObjectId: "vendor-chair-7", external: result.output.changes[0].external, batchId: result.output.id, synchronizedAt: "2026-08-28T12:00:00.000Z" }),
    (error) => error.code === "ADAPTER_ID_BOUNDARY_VIOLATION",
  );
  const mapping = createExternalIdMapping({ venueObjectId: "obj-chair-venue-1", external: result.output.changes[0].external, batchId: result.output.id, synchronizedAt: "2026-08-28T12:00:00.000Z" });
  assert.equal(mapping.venueObjectId, "obj-chair-venue-1");
  assert.equal(mapping.external.externalId, "vendor-chair-7");
});

test("capability scopes and secret references are both enforced", async () => {
  const runtime = createAdapterRuntime({ clock });
  await assert.rejects(
    () => runtime.execute(roomInventoryAdapter, "import", fixture, { ...authorization, grantedScopes: [] }),
    (error) => error.code === "ADAPTER_SCOPE_DENIED" && error.details.missingScopes[0] === "inventory:read",
  );
  await assert.rejects(
    () => runtime.execute(roomInventoryAdapter, "import", fixture, { ...authorization, secretReferences: [] }),
    (error) => error.code === "ADAPTER_SECRET_SCOPE_DENIED",
  );
});

test("sync cursors reject tampering and adapter-version drift", async () => {
  const cursor = await createSyncCursor(roomInventoryAdapter.definition, { opaque: "page-10", sourceVersion: "9" });
  await assert.rejects(() => verifySyncCursor(roomInventoryAdapter.definition, { ...cursor, opaque: "page-11" }), (error) => error.code === "ADAPTER_CHECKSUM_MISMATCH");
  assert.throws(() => verifySyncCursor({ ...roomInventoryAdapter.definition, version: "2.0.0" }, cursor), (error) => error.code === "ADAPTER_CURSOR_INCOMPATIBLE");
});

test("exports include source and adapter versions plus a verified content checksum", async () => {
  const result = await createAdapterRuntime({ clock }).execute(roomInventoryAdapter, "export", {
    planId: "plan-main",
    planVersion: "3.3",
    objects: [{ id: "obj-z", kind: "chair", label: "Z" }, { id: "obj-a", kind: "table", label: "A" }],
  }, { ...authorization, grantedScopes: ["inventory:write"] });
  assert.equal(result.status, "succeeded");
  assert.equal(result.output.adapterVersion, "1.0.0");
  assert.equal(result.output.sourceVersion, "3.3");
  assert.deepEqual(result.output.data.objects.map((object) => object.venueObjectId), ["obj-a", "obj-z"]);
  const { checksum, schemaVersion: _schemaVersion, ...content } = result.output;
  assert.equal(checksum, await sha256Checksum(content));
});

test("synchronization uses the same review boundary and advances an opaque versioned cursor", async () => {
  const first = await createAdapterRuntime({ clock }).execute(roomInventoryAdapter, "synchronize", { ...structuredClone(fixture), basePlanVersion: "3.3" }, { ...authorization, grantedScopes: ["inventory:read"] });
  assert.equal(first.status, "succeeded");
  assert.equal(first.output.status, "awaiting-review");
  assert.equal(first.output.proposal.requiresHumanApproval, true);
  assert.equal(first.output.syncCursor.opaque, "page-43");
  assert.equal(first.output.syncCursor.adapterVersion, roomInventoryAdapter.definition.version);
  assert.deepEqual(await verifySyncCursor(roomInventoryAdapter.definition, first.output.syncCursor), first.output.syncCursor);
});
