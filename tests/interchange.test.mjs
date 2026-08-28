import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fingerprintPlan } from "../src/domain/activity-ledger.js";
import { createEmptyVenuePlan } from "../src/domain/empty-project.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { exportProjectPackage, previewProjectImport } from "../src/interchange/venue-package.js";
import { createProjectStore } from "../src/persistence/project-store.js";

const clock = () => "2026-08-27T02:00:00.000Z";

const projectRecord = () => {
  const planner = createVenuePlanner(summitForwardPlan);
  return {
    id: "project-summit-forward",
    name: "SummitForward 2026",
    activePlanId: planner.getSnapshot().plan.id,
    schemaVersion: 10,
    snapshot: structuredClone(planner.getSnapshot()),
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T01:00:00.000Z",
  };
};

test("VenueMind Interchange Package round-trips stable IDs, geometry, Constraints, versions, and ledger fingerprints", async () => {
  const record = projectRecord();
  const exported = await exportProjectPackage(record, { clock });
  const preview = await previewProjectImport(exported.content, { clock });

  assert.equal(exported.format, "venuemind-project");
  assert.match(exported.package.manifest.payloadSha256, /^[0-9a-f]{64}$/);
  assert.equal(exported.package.manifest.payloadBytes, new TextEncoder().encode(exported.payload).byteLength);
  assert.equal(preview.status, "ready");
  assert.equal(preview.integrity.checksum, "pass");
  assert.equal(preview.integrity.ledger, "pass");
  assert.equal(preview.integrity.replay, "pass");
  assert.equal(preview.migration.fromSchemaVersion, 10);
  assert.equal(preview.migration.toSchemaVersion, 10);
  assert.deepEqual(preview.migration.actions, []);
  assert.equal(fingerprintPlan(preview.record.snapshot.plan), fingerprintPlan(record.snapshot.plan));
  assert.deepEqual(preview.record.snapshot.plan.objects.map((object) => object.id), record.snapshot.plan.objects.map((object) => object.id));
  assert.deepEqual(preview.record.snapshot.plan.constraints.map((constraint) => constraint.id), record.snapshot.plan.constraints.map((constraint) => constraint.id));
  assert.equal(preview.record.snapshot.plan.spatial.fingerprint, record.snapshot.plan.spatial.fingerprint);
  assert.equal(preview.record.snapshot.plan.objects.find((object) => object.id === "obj-door-south-access").door.clearWidthM, 1.8);
  assert.equal(preview.record.snapshot.plan.objects.find((object) => object.id === "obj-restricted-production").restriction.reasonCode, "production-clearance");
  assert.equal(preview.record.snapshot.plan.version, record.snapshot.plan.version);
  assert.equal(preview.record.snapshot.ledger.at(-1).hash, record.snapshot.ledger.at(-1).hash);
  assert.equal(preview.record.provenance.packageId, exported.package.manifest.packageId);
  assert.equal(preview.record.provenance.payloadSha256, exported.package.manifest.payloadSha256);
});

test("Import Preview rejects unknown envelope fields and checksum tampering", async () => {
  const exported = await exportProjectPackage(projectRecord(), { clock });
  const unknown = structuredClone(exported.package);
  unknown.deleteProject = true;
  await assert.rejects(() => previewProjectImport(JSON.stringify(unknown), { clock }), (error) => error.code === "IMPORT_UNKNOWN_FIELD");

  const tampered = structuredClone(exported.package);
  tampered.project.name = "Tampered";
  await assert.rejects(() => previewProjectImport(JSON.stringify(tampered), { clock }), (error) => error.code === "IMPORT_CHECKSUM_MISMATCH");

  const sourceTampered = structuredClone(exported.package);
  sourceTampered.manifest.source.application = "Unverified importer";
  await assert.rejects(() => previewProjectImport(JSON.stringify(sourceTampered), { clock }), (error) => error.code === "IMPORT_MANIFEST_CHECKSUM_MISMATCH");
});

test("Import Preview rejects malformed geometry, duplicate stable IDs, and locked Proposal mutations", async () => {
  const malformed = projectRecord();
  malformed.snapshot.plan.objects.find((object) => object.id === "obj-av-desk").footprint.center.x = 200;
  const malformedPackage = await exportProjectPackage(malformed, { clock });
  await assert.rejects(() => previewProjectImport(malformedPackage.content, { clock }), (error) => error.code === "IMPORT_GEOMETRY_INVALID");

  const duplicate = projectRecord();
  duplicate.snapshot.plan.objects.push(structuredClone(duplicate.snapshot.plan.objects[0]));
  const duplicatePackage = await exportProjectPackage(duplicate, { clock });
  await assert.rejects(() => previewProjectImport(duplicatePackage.content, { clock }), (error) => error.code === "IMPORT_DUPLICATE_ID");

  const locked = projectRecord();
  locked.snapshot.proposal.changes[0].targetObjectIds = ["obj-stage-west"];
  locked.snapshot.branches[0].proposal = structuredClone(locked.snapshot.proposal);
  const lockedPackage = await exportProjectPackage(locked, { clock });
  await assert.rejects(() => previewProjectImport(lockedPackage.content, { clock }), (error) => error.code === "LOCK_CONFLICT");
});

test("Import Preview migrates a v5 metric-summary Project to schema v10 with an explicit report", async () => {
  const legacy = projectRecord();
  legacy.schemaVersion = 5;
  delete legacy.snapshot.scenarios;
  delete legacy.snapshot.scenarioRuns;
  const evidenceIds = new Set(["obj-accessible-entrance-south", "obj-restroom-accessible", "obj-seating-west", "obj-seating-east", "obj-route-main", "obj-route-stage", "obj-route-seating-west", "obj-route-seating-east", "obj-route-exit-east", "obj-door-south-access", "obj-restricted-production"]);
  legacy.snapshot.plan.objects = legacy.snapshot.plan.objects.filter((object) => !evidenceIds.has(object.id));
  for (const object of legacy.snapshot.plan.objects) delete object.locks;
  for (const object of legacy.snapshot.plan.objects) {
    if (object.accessibility) delete object.accessibility.accessibleSeatSampleIds;
    if (object.door) delete object.door.clearance;
  }
  legacy.snapshot.plan.constraints = legacy.snapshot.plan.constraints.filter((constraint) => !["accessible_seating_sightlines", "door_clearance", "temporary_ramp"].includes(constraint.evaluator));
  legacy.snapshot.plan.constraints = legacy.snapshot.plan.constraints.map((constraint) => {
    if (constraint.id === "constraint-accessible-route") return { ...constraint, evaluator: "minimum_metric", parameters: { metric: "accessibleRouteWidthFt", comparator: "gte", threshold: 6, unit: "ft" } };
    return constraint;
  }).filter((constraint) => !["constraint-turning-clearance", "constraint-accessible-seating"].includes(constraint.id));
  for (const change of legacy.snapshot.proposal.changes) {
    delete change.targetObjectIds;
    delete change.spatialEffects;
  }
  legacy.snapshot.branches[0].proposal = structuredClone(legacy.snapshot.proposal);

  const exported = await exportProjectPackage(legacy, { clock });
  const preview = await previewProjectImport(exported.content, { clock });

  assert.equal(preview.migration.fromSchemaVersion, 5);
  assert.equal(preview.migration.toSchemaVersion, 10);
  assert.deepEqual(preview.migration.actions, ["project-schema-v5-to-v6-spatial-evidence", "project-schema-v6-to-v7-operational-geometry", "project-schema-v7-to-v8-typed-locks", "project-schema-v8-to-v9-accessibility-infrastructure", "project-schema-v9-to-v10-simulation-framework"]);
  assert.equal(preview.record.schemaVersion, 10);
  assert.equal(preview.record.snapshot.plan.objects.some((object) => object.id === "obj-route-main"), true);
  assert.equal(preview.record.snapshot.ledger.at(-1).type, "schema.migrated");
  assert.equal(preview.integrity.replay, "pass");
});

test("Import Preview enforces the package input-size boundary before parsing", async () => {
  await assert.rejects(
    () => previewProjectImport("x".repeat(2_000_001), { clock }),
    (error) => error.code === "IMPORT_TOO_LARGE",
  );
});

test("Interchange preserves branch-scoped Warning Waivers and their ledger evidence", async () => {
  const initial = structuredClone(summitForwardPlan);
  initial.constraints.push({ id: "constraint-import-warning", checkId: "check-import-warning", evaluator: "minimum_metric", label: "Preferred capacity", category: "capacity", severity: "warning", waivable: true, scope: { kind: "plan" }, parameters: { metric: "attendeeCapacity", comparator: "gte", threshold: 450, unit: "attendees" }, remediation: "Record an operational disposition." });
  const planner = createVenuePlanner(initial);
  planner.execute({ type: "waive_warning", constraintId: "constraint-import-warning", reasonCode: "owner-approved-deviation", actor: "human", actorId: "operator-import", idempotencyKey: "waive-import-warning" });
  const record = projectRecord();
  record.snapshot = structuredClone(planner.getSnapshot());
  const exported = await exportProjectPackage(record, { clock });
  const preview = await previewProjectImport(exported.content, { clock });
  const waiver = preview.record.snapshot.proposal.waivers[0];

  assert.equal(waiver.constraintId, "constraint-import-warning");
  assert.equal(waiver.authorId, "operator-import");
  assert.equal(waiver.reasonCode, "owner-approved-deviation");
  assert.equal(preview.record.snapshot.branches[0].proposal.waivers[0].id, waiver.id);
  assert.equal(preview.record.snapshot.ledger.some((entry) => entry.type === "constraint.warning_waived" && entry.details.waiverId === waiver.id), true);
  assert.equal(preview.integrity.replay, "pass");
});

test("Interchange preserves human Project Locks and their audit evidence", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const added = planner.execute({ type: "set_object_lock", objectId: "obj-av-desk", lockType: "position", reasonCode: "operator-hold", actor: "human", actorId: "operator-import", idempotencyKey: "lock-import-av" });
  const record = projectRecord();
  record.snapshot = structuredClone(planner.getSnapshot());
  const exported = await exportProjectPackage(record, { clock });
  const preview = await previewProjectImport(exported.content, { clock });

  assert.equal(preview.record.snapshot.projectLocks[0].id, added.lockId);
  assert.equal(preview.record.snapshot.projectLocks[0].source, "project");
  assert.equal(preview.record.snapshot.ledger.some((entry) => entry.type === "object.lock_added" && entry.details.lockId === added.lockId), true);
  assert.equal(preview.integrity.replay, "pass");
});

test("geometry-v1 fixture survives save, export, import, and reload without geometry drift", async () => {
  const fixture = JSON.parse(await readFile(new URL("./fixtures/geometry-v1-operational.json", import.meta.url), "utf8"));
  const initial = createEmptyVenuePlan({ projectId: "project-geometry-v1", name: "Geometry v1" });
  initial.spatial = fixture;
  initial.objects = fixture.objects;
  const planner = createVenuePlanner(initial);
  const memory = new Map();
  const storage = {
    get length() { return memory.size; },
    key(index) { return [...memory.keys()][index] ?? null; },
    getItem(key) { return memory.get(key) ?? null; },
    setItem(key, value) { memory.set(key, value); },
  };
  const store = createProjectStore({ fetchImpl: async () => { throw new Error("offline"); }, storage, clock });
  const saved = await store.save({ id: "project-geometry-v1", name: "Geometry v1", activePlanId: planner.getSnapshot().plan.id, snapshot: structuredClone(planner.getSnapshot()) });
  const loaded = await store.load(saved.record.id);
  const exported = await exportProjectPackage(loaded.record, { clock });
  const preview = await previewProjectImport(exported.content, { clock });
  const reloaded = createVenuePlanner(initial);
  reloaded.execute({ type: "restore_snapshot", snapshot: preview.record.snapshot });

  assert.equal(loaded.record.schemaVersion, 10);
  assert.equal(preview.integrity.replay, "pass");
  assert.equal(fingerprintPlan(reloaded.getSnapshot().plan), fingerprintPlan(planner.getSnapshot().plan));
  assert.deepEqual(reloaded.getSnapshot().plan.spatial, planner.getSnapshot().plan.spatial);
  assert.deepEqual(reloaded.getSnapshot().plan.objects, planner.getSnapshot().plan.objects);
  assert.equal(reloaded.getSnapshot().plan.objects.find((object) => object.id === "obj-fixture-table-rotated").footprint.rotationDegrees, 33.3);
  assert.equal(reloaded.getSnapshot().plan.objects.find((object) => object.id === "obj-fixture-restricted-irregular").footprint.points.length, 5);
});
