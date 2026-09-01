import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fingerprintPlan } from "../src/domain/activity-ledger.js";
import { createEmptyVenuePlan } from "../src/domain/empty-project.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { AdapterContractError, createSyncCursor, defineAdapter, normalizeAdapterChange, sha256Checksum } from "../src/integrations/contracts.js";
import { roomInventoryAdapter } from "../src/integrations/adapters/room-inventory-adapter.js";
import { createMemoryProcessedBatchStore } from "../src/integrations/processed-batch-store.js";
import { createAdapterRuntime, verifySyncCursor } from "../src/integrations/runtime.js";
import { createMemorySecretStore } from "../src/integrations/secret-store.js";
import { assertReviewableStagingBatch, createExternalIdMapping, loadAdapterProposalForReview } from "../src/integrations/staging.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/adapter-room-inventory-v1.json", import.meta.url), "utf8"));
const exportFixture = JSON.parse(await readFile(new URL("./fixtures/adapter-room-inventory-export-v1.json", import.meta.url), "utf8"));
const secretStore = createMemorySecretStore({ "room-inventory/api-token": "test-token", "unrelated/private-key": "denied" });
const authorization = { grantedScopes: ["inventory:read"], secretStore, secretReferences: ["room-inventory/api-token"] };
const clock = () => Date.parse("2026-08-28T12:00:00.000Z");

test("adapter definitions are versioned, capability-scoped, exact contracts", () => {
  const definition = roomInventoryAdapter.definition;
  assert.equal(definition.contractVersion, 1);
  assert.equal(definition.version, "1.0.0");
  assert.deepEqual(definition.scopes.import, ["inventory:read"]);
  assert.equal(Object.isFrozen(definition), true);
  assert.throws(() => defineAdapter({ ...definition, typo: true }), (error) => error instanceof AdapterContractError && error.code === "ADAPTER_CONTRACT_UNKNOWN_FIELD");
  assert.throws(() => defineAdapter({ ...definition, contractVersion: 2 }), (error) => error.code === "ADAPTER_CONTRACT_VERSION_UNSUPPORTED");
});

test("Room Inventory import creates one canonical checksum-bound Proposal for an exact Plan Version", async () => {
  const runtime = createAdapterRuntime({ clock });
  const input = structuredClone(fixture);
  const before = structuredClone(input);
  const result = await runtime.execute(roomInventoryAdapter, "import", input, authorization);

  assert.equal(result.status, "succeeded");
  assert.equal(result.output.status, "awaiting-review");
  assert.deepEqual(Object.keys(result.output.proposal).sort(), ["baseVersion", "changes", "goal", "id", "revision", "status", "validation", "waivers"]);
  assert.equal(result.output.proposal.status, "review");
  assert.equal(result.output.proposal.baseVersion, "3.3");
  assert.equal(result.output.proposal.revision, 2);
  assert.match(result.output.proposal.id, /^proposal-adapter-[0-9a-f]{16}$/);
  assert.equal(await assertReviewableStagingBatch(result.output, null, { requireProjectContext: false }), true);
  assert.deepEqual(input, before);
  assert.deepEqual(result.output.mappings.map((mapping) => mapping.external.externalId), ["vendor-chair-7", "vendor-table-2"]);
  assert.ok(result.output.proposal.changes.every((change) => change.spatialEffects.length > 0));
  assert.deepEqual(result.output.proposal.changes[0].spatialEffects.map((effect) => effect.operation), ["add_object"]);
  assert.deepEqual(result.output.proposal.changes[1].spatialEffects.map((effect) => effect.operation), ["update_footprint", "update_metadata"]);
  assert.equal(result.output.sourceSystem, "room-inventory-prod");
  assert.equal(result.output.sourceVersion, "inventory-42");
  assert.equal(result.output.synchronizedAt, "2026-08-28T12:00:00.000Z");
  assert.match(result.output.checksum, /^[0-9a-f]{64}$/);
  assert.match(result.output.syncCursor.checksum, /^[0-9a-f]{64}$/);
  assert.deepEqual(await verifySyncCursor(roomInventoryAdapter.definition, result.output.syncCursor), result.output.syncCursor);
  assert.equal(Object.hasOwn(result.output, "acceptedPlan"), false);
});

test("an imported canonical Proposal enters the planner review and Approval path without changing accepted truth", async () => {
  const planner = createVenuePlanner(createEmptyVenuePlan({ projectId: "project-adapter-review", name: "Adapter review" }));
  const planBefore = planner.getSnapshot().plan;
  const input = { ...structuredClone(fixture), basePlanVersion: "1.0", proposalRevision: 2, mappings: {}, records: [structuredClone(fixture.records.find((record) => record.externalId === "vendor-chair-7"))] };
  const result = await createAdapterRuntime({ clock }).execute(roomInventoryAdapter, "import", input, authorization);
  const loaded = await loadAdapterProposalForReview(planner, result.output);

  assert.equal(loaded.status, "review");
  assert.equal(loaded.proposalId, result.output.proposal.id);
  assert.equal(fingerprintPlan(planner.getSnapshot().plan), fingerprintPlan(planBefore));
  assert.equal(planner.getSnapshot().plan.objects.length, 0);
  assert.equal(planner.execute({ type: "validate_layout" }).status, "pass");

  const proposal = planner.getSnapshot().proposal;
  const approval = planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "approve-adapter-import" });
  assert.equal(approval.status, "approved");
  assert.equal(planner.getSnapshot().plan.objects.some((object) => object.id === "obj-import-chair-001"), true);
  assert.equal(planner.getSnapshot().ledger.at(-1).type, "proposal.approved");
});

test("repeating an identical import is duplicate-safe and stores one staging result", async () => {
  const processedBatchStore = createMemoryProcessedBatchStore();
  const runtime = createAdapterRuntime({ clock, processedBatchStore });
  const first = await runtime.execute(roomInventoryAdapter, "import", structuredClone(fixture), authorization);
  const second = await runtime.execute(roomInventoryAdapter, "import", structuredClone(fixture), authorization);
  assert.equal(first.status, "succeeded");
  assert.equal(second.status, "duplicate");
  assert.equal(second.output.id, first.output.id);
  assert.equal(second.output.proposal.id, first.output.proposal.id);
  assert.deepEqual(second.attempts, []);
  assert.equal(processedBatchStore.list().length, 1);
});

test("external IDs remain separate and mappings retain complete source evidence", async () => {
  await assert.rejects(() => createAdapterRuntime({ clock }).execute(roomInventoryAdapter, "import", { ...structuredClone(fixture), stableIds: { "vendor-chair-7": "vendor-chair-7" } }, authorization), (error) => error.code === "ADAPTER_ID_BOUNDARY_VIOLATION");
  const result = await createAdapterRuntime({ clock }).execute(roomInventoryAdapter, "import", structuredClone(fixture), authorization);
  const evidence = result.output.mappings[0];
  assert.throws(() => createExternalIdMapping({ ...evidence, venueObjectId: evidence.external.externalId }), (error) => error.code === "ADAPTER_ID_BOUNDARY_VIOLATION");
  assert.equal(evidence.venueEntityType, "project-object-instance");
  assert.equal(evidence.sourceSystem, "room-inventory-prod");
  assert.equal(evidence.sourceVersion, evidence.external.sourceVersion);
  assert.equal(evidence.synchronizedAt, "2026-08-28T12:00:00.000Z");
  assert.equal(evidence.checksum, evidence.external.checksum);
  assert.match(evidence.checksum, /^[0-9a-f]{64}$/);
});

test("Inventory Item Template and Project Object Instance identities cannot be conflated", async () => {
  assert.throws(() => normalizeAdapterChange({
    id: "change-template",
    operation: "create",
    venueEntityType: "inventory-item-template",
    proposedVenueObjectId: "inventory-template-chair",
    external: { adapterId: "room-inventory", sourceSystem: "room-inventory-prod", entityType: "room-inventory-record", externalId: "vendor-chair-7", sourceVersion: "42", checksum: "a".repeat(64) },
    values: { label: "Chair template" },
  }, roomInventoryAdapter.definition), (error) => error.code === "ADAPTER_ENTITY_TYPE_UNSUPPORTED");
});

test("capability scopes and secret references are both enforced", async () => {
  const runtime = createAdapterRuntime({ clock });
  await assert.rejects(() => runtime.execute(roomInventoryAdapter, "import", fixture, { ...authorization, grantedScopes: [] }), (error) => error.code === "ADAPTER_SCOPE_DENIED" && error.details.missingScopes[0] === "inventory:read");
  await assert.rejects(() => runtime.execute(roomInventoryAdapter, "import", fixture, { ...authorization, secretReferences: [] }), (error) => error.code === "ADAPTER_SECRET_SCOPE_DENIED");
});

test("sync cursors reject tampering and adapter-version drift", async () => {
  const cursor = await createSyncCursor(roomInventoryAdapter.definition, { opaque: "page-10", sourceVersion: "9" });
  await assert.rejects(() => verifySyncCursor(roomInventoryAdapter.definition, { ...cursor, opaque: "page-11" }), (error) => error.code === "ADAPTER_CHECKSUM_MISMATCH");
  assert.throws(() => verifySyncCursor({ ...roomInventoryAdapter.definition, version: "2.0.0" }, cursor), (error) => error.code === "ADAPTER_CURSOR_INCOMPATIBLE");
});

test("export fixture includes source and adapter versions plus a verified checksum", async () => {
  const result = await createAdapterRuntime({ clock }).execute(roomInventoryAdapter, "export", structuredClone(exportFixture), { ...authorization, grantedScopes: ["inventory:write"] });
  assert.equal(result.status, "succeeded");
  assert.equal(result.output.adapterVersion, "1.0.0");
  assert.equal(result.output.sourceSystem, exportFixture.sourceSystem);
  assert.equal(result.output.sourceVersion, "3.3");
  assert.equal(result.output.data.venueEntityType, "project-object-instance");
  assert.deepEqual(result.output.data.objects.map((object) => object.venueObjectId), ["obj-a", "obj-z"]);
  const { checksum, schemaVersion: _schemaVersion, ...content } = result.output;
  assert.equal(checksum, await sha256Checksum(content));
});

test("synchronization uses the same canonical Proposal boundary and advances a versioned cursor", async () => {
  const first = await createAdapterRuntime({ clock }).execute(roomInventoryAdapter, "synchronize", structuredClone(fixture), authorization);
  assert.equal(first.status, "succeeded");
  assert.equal(first.output.proposal.status, "review");
  assert.equal(first.output.proposal.baseVersion, "3.3");
  assert.equal(first.output.syncCursor.opaque, "page-43");
  assert.equal(first.output.syncCursor.adapterVersion, roomInventoryAdapter.definition.version);
  assert.deepEqual(await verifySyncCursor(roomInventoryAdapter.definition, first.output.syncCursor), first.output.syncCursor);
});
