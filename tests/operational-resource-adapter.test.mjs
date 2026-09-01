import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fingerprintPlan } from "../src/domain/activity-ledger.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { sha256Checksum } from "../src/integrations/contracts.js";
import { createAdapterRuntime } from "../src/integrations/runtime.js";
import { createMemorySecretStore } from "../src/integrations/secret-store.js";
import {
  assertOperationalResourceSnapshot,
  createOperationalSubstitutionStagingBatch,
  normalizeOperationalResourceAdapterInput,
  operationalResourceAdapter,
} from "../src/integrations/adapters/operational-resource-adapter.js";
import { assertReviewableStagingBatch, loadAdapterProposalForReview } from "../src/integrations/staging.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/adapter-operational-resources-v1.json", import.meta.url), "utf8"));
const clock = () => Date.parse("2026-09-01T12:00:00.000Z");
const secretStore = createMemorySecretStore({ "operational-resources/api-token": "test-token" });

const template = (templateId) => ({ templateId, version: "1.0.0" });

const createPlanAndContext = async () => {
  const objects = [
    { id: "obj-seating", templateRef: { kind: "inventory-item-template", ...template("inventory-template-banquet-chair") }, resourceBinding: { schemaVersion: 1, kind: "inventory", resourceId: "resource-chair-main", quantity: 400 } },
    { id: "obj-projector", templateRef: { kind: "inventory-item-template", ...template("inventory-template-laser-projector") }, resourceBinding: { schemaVersion: 1, kind: "av", resourceId: "resource-projector-primary", quantity: 1 } },
    { id: "obj-power-west", resourceBinding: { schemaVersion: 1, kind: "power", resourceId: "resource-circuit-west", quantity: 1 } },
    { id: "obj-buffet", templateRef: { kind: "inventory-item-template", ...template("inventory-template-buffet-station") }, resourceBinding: { schemaVersion: 1, kind: "catering", resourceId: "resource-buffet-east", quantity: 1 } },
    { id: "obj-post-security", resourceBinding: { schemaVersion: 1, kind: "staffing", resourceId: "resource-staff-001", quantity: 1 } },
  ];
  const plan = { id: "plan-resource-test", version: "3.3", objects };
  const checksum = async (id) => sha256Checksum(objects.find((item) => item.id === id));
  const context = {
    project: {
      projectId: "project-resource-test",
      planVersion: plan.version,
      planFingerprint: fingerprintPlan(plan),
      eventWindow: { startAt: "2026-09-12T10:00:00.000Z", endAt: "2026-09-12T12:00:00.000Z" },
      currentReservationRef: "reservation-current",
    },
    resourceMappings: [
      { family: "inventory", externalId: "pool-chair-main", resourceId: "resource-chair-main", binding: { templateRef: template("inventory-template-banquet-chair") } },
      { family: "av", externalId: "projector-primary", resourceId: "resource-projector-primary", binding: { templateRef: template("inventory-template-laser-projector") } },
      { family: "av", externalId: "projector-backup", resourceId: "resource-projector-backup", binding: { templateRef: template("inventory-template-laser-projector") } },
      { family: "power", externalId: "circuit-west", resourceId: "resource-circuit-west", binding: { utilityObjectId: "obj-power-west", circuitId: "circuit-west-63a" } },
      { family: "power", externalId: "circuit-east", resourceId: "resource-circuit-east", binding: { utilityObjectId: "obj-power-east", circuitId: "circuit-east-32a" } },
      { family: "catering", externalId: "buffet-east", resourceId: "resource-buffet-east", binding: { templateRef: template("inventory-template-buffet-station") } },
    ],
    roleMappings: [{ externalId: "security", roleId: "role-security" }],
    shiftMappings: [{ externalId: "event-shift", shiftId: "shift-event" }],
    personnelMappings: [
      { externalPersonId: "person-001", staffRef: "staff-ref-8f3a4b5c6d7e8091a2b3c4d5e6f70819", resourceId: "resource-staff-001" },
      { externalPersonId: "person-002", staffRef: "staff-ref-91a2b3c4d5e6f70819a2b3c4d5e6f708", resourceId: "resource-staff-002" },
    ],
    reservationMappings: [
      { externalId: "event-current", reservationRef: "reservation-current" },
      { externalId: "event-other", reservationRef: "reservation-other" },
    ],
    demands: [
      { demandId: "demand-chair", family: "inventory", resourceId: "resource-chair-main", quantity: 400, targetObjectIds: ["obj-seating"], requirements: { templateRef: template("inventory-template-banquet-chair") }, baseObjectChecksum: await checksum("obj-seating") },
      { demandId: "demand-projector", family: "av", resourceId: "resource-projector-primary", quantity: 1, targetObjectIds: ["obj-projector"], requirements: { templateRef: template("inventory-template-laser-projector"), equipmentType: "projector", powerWatts: 1200, voltage: 230, connector: "powercon" }, baseObjectChecksum: await checksum("obj-projector") },
      { demandId: "demand-power", family: "power", resourceId: "resource-circuit-west", quantity: 1, targetObjectIds: ["obj-power-west"], requirements: { voltage: 230, requiredWatts: 20000, connector: "powercon" }, baseObjectChecksum: await checksum("obj-power-west") },
      { demandId: "demand-buffet", family: "catering", resourceId: "resource-buffet-east", quantity: 1, targetObjectIds: ["obj-buffet"], requirements: { templateRef: template("inventory-template-buffet-station"), type: "buffet", servers: 4, serviceRatePerServerMinute: 3, queueCapacityPersons: 24, accessibleServicePoint: true }, baseObjectChecksum: await checksum("obj-buffet") },
      { demandId: "demand-security", family: "staffing", resourceId: "resource-staff-001", quantity: 1, targetObjectIds: ["obj-post-security"], requirements: { roleId: "role-security", shiftId: "shift-event" }, baseObjectChecksum: await checksum("obj-post-security") },
    ],
  };
  return { plan, context };
};

const execute = async (source = fixture, contextOverride = null) => {
  const { context } = await createPlanAndContext();
  const authorization = { grantedScopes: ["operational-resources:read"], secretStore, secretReferences: ["operational-resources/api-token"], trustedAdapterContexts: { "operational-resources": contextOverride ?? context } };
  return createAdapterRuntime({ clock }).execute(operationalResourceAdapter, "import", structuredClone(source), authorization);
};

test("operational aggregate imports inventory, AV, power, catering, and privacy-safe staffing evidence", async () => {
  const result = await execute();
  assert.equal(result.status, "succeeded");
  assert.equal(result.output.status, "attention-required");
  assert.deepEqual(new Set(result.output.resources.map((item) => item.family)), new Set(["inventory", "av", "power", "catering", "staffing"]));
  assert.equal(result.output.staffing.roles[0].roleId, "role-security");
  assert.equal(result.output.staffing.shifts[0].shiftId, "shift-event");
  assert.equal(result.output.staffing.assignments.length, 2);
  assert.equal(result.output.privacy.rawPersonnelIdentityStored, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /person-001|person-002/);
  assert.doesNotMatch(serialized, /externalPersonId/);
  assert.match(result.output.checksum, /^[0-9a-f]{64}$/);
});

test("staffing availability remains scoped to the exact personnel role and shift assignment", async () => {
  const source = structuredClone(fixture);
  source.staffing.assignments[0].bookings = [];
  source.staffing.roles.push({ externalId: "usher", sourceVersion: "77", availableHeadcount: 4, skills: ["guest-support"] });
  source.staffing.shifts.push({ externalId: "night-shift", sourceVersion: "77", startAt: "2026-09-12T18:00:00.000Z", endAt: "2026-09-12T22:00:00.000Z" });
  source.staffing.assignments.push({ externalPersonId: "person-001", sourceVersion: "77", roleExternalId: "usher", shiftExternalId: "night-shift", status: "unavailable", bookings: [] });
  const { context } = await createPlanAndContext();
  context.roleMappings.push({ externalId: "usher", roleId: "role-usher" });
  context.shiftMappings.push({ externalId: "night-shift", shiftId: "shift-night" });

  const snapshot = (await execute(source, context)).output;
  assert.equal(snapshot.conflicts.some((item) => item.demandId === "demand-security"), false);
  const staff = snapshot.resources.find((item) => item.resourceId === "resource-staff-001");
  assert.deepEqual(staff.capability.assignments.map((item) => [item.roleId, item.shiftId, item.status]), [
    ["role-security", "shift-event", "available"],
    ["role-usher", "shift-night", "unavailable"],
  ]);
});

test("unavailable and double-booked resources create exact conflicts without silently selecting an option", async () => {
  const snapshot = (await execute()).output;
  const projector = snapshot.conflicts.find((item) => item.demandId === "demand-projector");
  const power = snapshot.conflicts.find((item) => item.demandId === "demand-power");
  const staff = snapshot.conflicts.find((item) => item.demandId === "demand-security");
  assert.equal(projector.reason, "unavailable");
  assert.deepEqual(projector.targetObjectIds, ["obj-projector"]);
  assert.equal(power.reason, "double-booked");
  assert.deepEqual(power.bookingRefs, ["booking-power-other"]);
  assert.equal(staff.reason, "double-booked");
  assert.ok(projector.substitutionOptionIds.length > 0);
  assert.deepEqual(power.substitutionOptionIds, []);
  assert.deepEqual(staff.substitutionOptionIds, []);
  assert.equal(Object.hasOwn(snapshot, "selectedOptionId"), false);
  assert.ok(snapshot.substitutionOptions.every((item) => item.requiresHumanApproval));
});

test("trusted current reservations are excluded and half-open endpoint bookings do not conflict", async () => {
  const source = structuredClone(fixture);
  source.inventory[0].total = 400;
  source.inventory[0].unavailable = 0;
  source.inventory[0].bookings.push({ externalId: "booking-chair-adjacent", startAt: "2026-09-12T08:00:00.000Z", endAt: "2026-09-12T10:00:00.000Z", quantity: 400, reservationExternalId: "event-other" });
  const snapshot = (await execute(source)).output;
  assert.equal(snapshot.conflicts.some((item) => item.demandId === "demand-chair"), false);
});

test("collection order does not change prepared invocation identity or snapshot checksum", async () => {
  const ordered = structuredClone(fixture);
  ordered.inventory[0].bookings.push({ externalId: "booking-chair-adjacent", startAt: "2026-09-12T08:00:00.000Z", endAt: "2026-09-12T09:00:00.000Z", quantity: 1, reservationExternalId: "event-other" });
  ordered.staffing.roles[0].skills.push("crowd-control");
  ordered.staffing.assignments[0].bookings.push({ externalId: "booking-staff-adjacent", startAt: "2026-09-12T08:00:00.000Z", endAt: "2026-09-12T09:00:00.000Z", quantity: 1, reservationExternalId: "event-other" });
  const first = await execute(ordered);
  const permuted = structuredClone(ordered);
  permuted.avEquipment.reverse();
  permuted.powerCircuits.reverse();
  permuted.staffing.assignments.reverse();
  permuted.powerCircuits[0].connectors.reverse();
  permuted.inventory[0].bookings.reverse();
  permuted.staffing.roles[0].skills.reverse();
  permuted.staffing.assignments[0].bookings.reverse();
  const second = await execute(permuted);
  assert.equal(second.invocationId, first.invocationId);
  assert.equal(second.output.checksum, first.output.checksum);
  assert.deepEqual(second.output, first.output);
});

test("personnel source IDs are dropped before runtime identity and unsafe identities or fields do not leak", async () => {
  const baseline = await execute();
  const remappedSource = structuredClone(fixture);
  remappedSource.staffing.assignments[0].externalPersonId = "provider-person-009";
  const { context: remappedContext } = await createPlanAndContext();
  remappedContext.personnelMappings[0].externalPersonId = "provider-person-009";
  const remapped = await execute(remappedSource, remappedContext);
  assert.equal(remapped.invocationId, baseline.invocationId);
  assert.equal(remapped.output.checksum, baseline.output.checksum);

  const source = structuredClone(fixture);
  source.staffing.assignments[0].externalPersonId = "alice@example.test";
  const { context } = await createPlanAndContext();
  context.personnelMappings[0].externalPersonId = "alice@example.test";
  await assert.rejects(() => execute(source, context), (error) => {
    const serialized = JSON.stringify(error);
    return error.code === "ADAPTER_SOURCE_INVALID" && !serialized.includes("alice@example.test");
  });
  const unknown = structuredClone(fixture);
  unknown.staffing.assignments[0]["bob@example.test"] = "hidden";
  await assert.rejects(() => execute(unknown), (error) => error.code === "ADAPTER_CONTRACT_UNKNOWN_FIELD" && !JSON.stringify(error.details).includes("bob@example.test"));
});

test("semantic result validation rejects a forged checksum-valid conflict", async () => {
  const { context } = await createPlanAndContext();
  const prepared = await normalizeOperationalResourceAdapterInput("import", structuredClone(fixture), context);
  const snapshot = (await execute()).output;
  const forged = structuredClone(snapshot);
  forged.conflicts[0].availableQuantity += 1;
  const { id: _id, checksum: _checksum, ...content } = forged;
  forged.checksum = await sha256Checksum(content);
  forged.id = `operational-resource-snapshot-${forged.checksum.slice(0, 16)}`;
  await assert.rejects(() => assertOperationalResourceSnapshot(forged, { capability: "import", preparedInput: prepared }), (error) => error.code === "ADAPTER_SOURCE_MISMATCH");
});

test("explicit compatible selection creates a canonical same-object staging Proposal without mutating accepted Plan", async () => {
  const { plan } = await createPlanAndContext();
  const before = structuredClone(plan);
  const snapshot = (await execute()).output;
  const conflict = snapshot.conflicts.find((item) => item.demandId === "demand-projector");
  const optionId = conflict.substitutionOptionIds[0];
  const resolveLatestSnapshot = async () => snapshot;
  await assert.rejects(() => createOperationalSubstitutionStagingBatch({ snapshot, conflictId: conflict.id, acceptedPlan: plan, proposalRevision: 2, resolveLatestSnapshot }), (error) => error.code === "ADAPTER_SUBSTITUTION_SELECTION_REQUIRED");
  await assert.rejects(() => createOperationalSubstitutionStagingBatch({ snapshot, conflictId: conflict.id, optionId, acceptedPlan: plan, proposalRevision: 2 }), (error) => error.code === "ADAPTER_SNAPSHOT_PROVENANCE_REQUIRED");
  const batch = await createOperationalSubstitutionStagingBatch({ snapshot, conflictId: conflict.id, optionId, acceptedPlan: plan, proposalRevision: 2, resolveLatestSnapshot });
  assert.equal(await assertReviewableStagingBatch(batch, null, { requireProjectContext: false }), true);
  assert.equal(batch.proposal.status, "review");
  assert.deepEqual(batch.proposal.changes[0].targetObjectIds, ["obj-projector"]);
  assert.equal(batch.proposal.changes[0].spatialEffects[0].operation, "update_metadata");
  assert.equal(batch.proposal.changes[0].spatialEffects[0].values.resourceBinding.resourceId, "resource-projector-backup");
  assert.deepEqual(Object.keys(batch.proposal.changes[0].spatialEffects[0].values.resourceBinding).sort(), ["kind", "quantity", "resourceId", "schemaVersion"]);
  assert.equal(batch.proposal.changes[0].effects.adapterEvidence.sourceId, snapshot.id);
  assert.equal(batch.proposal.changes[0].effects.adapterEvidence.sourceChecksum, snapshot.checksum);
  assert.deepEqual(batch.mappings.map((mapping) => mapping.venueEntityType).sort(), ["project", "project-object-instance"]);
  assert.equal(await assertReviewableStagingBatch(batch, { projectId: "project-resource-test" }), true);
  assert.deepEqual(plan, before);
});

test("persisted v1 SHA-256 Plan evidence remains valid during canonical fingerprint migration", async () => {
  const { plan, context } = await createPlanAndContext();
  context.project.planFingerprint = await sha256Checksum(plan);
  const snapshot = (await execute(fixture, context)).output;
  const conflict = snapshot.conflicts.find((item) => item.demandId === "demand-projector");
  const batch = await createOperationalSubstitutionStagingBatch({ snapshot, conflictId: conflict.id, optionId: conflict.substitutionOptionIds[0], acceptedPlan: plan, proposalRevision: 2, resolveLatestSnapshot: async () => snapshot });
  assert.equal(batch.proposal.status, "review");
  assert.equal(batch.proposal.changes[0].spatialEffects[0].values.resourceBinding.resourceId, "resource-projector-backup");
});

test("substitution preview preserves the accepted binding family and quantity", async () => {
  const { plan, context } = await createPlanAndContext();
  const object = plan.objects.find((item) => item.id === "obj-projector");

  object.resourceBinding.kind = "inventory";
  context.project.planFingerprint = fingerprintPlan(plan);
  context.demands.find((item) => item.demandId === "demand-projector").baseObjectChecksum = await sha256Checksum(object);
  const kindSnapshot = (await execute(fixture, context)).output;
  const kindConflict = kindSnapshot.conflicts.find((item) => item.demandId === "demand-projector");
  await assert.rejects(() => createOperationalSubstitutionStagingBatch({ snapshot: kindSnapshot, conflictId: kindConflict.id, optionId: kindConflict.substitutionOptionIds[0], acceptedPlan: plan, proposalRevision: 2, resolveLatestSnapshot: async () => kindSnapshot }), (error) => error.code === "ADAPTER_SUBSTITUTION_STALE");

  const { plan: quantityPlan, context: quantityContext } = await createPlanAndContext();
  const quantityObject = quantityPlan.objects.find((item) => item.id === "obj-projector");
  const quantityDemand = quantityContext.demands.find((item) => item.demandId === "demand-projector");
  quantityDemand.quantity = 2;
  quantityDemand.baseObjectChecksum = await sha256Checksum(quantityObject);
  quantityContext.project.planFingerprint = fingerprintPlan(quantityPlan);
  const quantitySource = structuredClone(fixture);
  quantitySource.avEquipment.find((item) => item.externalId === "projector-backup").total = 2;
  const quantitySnapshot = (await execute(quantitySource, quantityContext)).output;
  const quantityConflict = quantitySnapshot.conflicts.find((item) => item.demandId === "demand-projector");
  await assert.rejects(() => createOperationalSubstitutionStagingBatch({ snapshot: quantitySnapshot, conflictId: quantityConflict.id, optionId: quantityConflict.substitutionOptionIds[0], acceptedPlan: quantityPlan, proposalRevision: 2, resolveLatestSnapshot: async () => quantitySnapshot }), (error) => error.code === "ADAPTER_SUBSTITUTION_STALE");
});

test("trusted mappings enforce exact fields and separate external IDs from VenueMind IDs", async () => {
  const { context } = await createPlanAndContext();
  context.resourceMappings[0].binding.untrusted = true;
  await assert.rejects(() => execute(fixture, context), (error) => error.code === "ADAPTER_CONTRACT_UNKNOWN_FIELD");

  const { context: collided } = await createPlanAndContext();
  collided.resourceMappings[0].resourceId = collided.resourceMappings[0].externalId;
  await assert.rejects(() => execute(fixture, collided), (error) => error.code === "ADAPTER_ID_BOUNDARY_VIOLATION");

  const { context: crossRowCollision } = await createPlanAndContext();
  crossRowCollision.resourceMappings[1].externalId = crossRowCollision.resourceMappings[0].resourceId;
  await assert.rejects(() => execute(fixture, crossRowCollision), (error) => error.code === "ADAPTER_ID_BOUNDARY_VIOLATION");

  const { context: reservationCollision } = await createPlanAndContext();
  reservationCollision.reservationMappings[1].reservationRef = reservationCollision.reservationMappings[0].reservationRef;
  await assert.rejects(() => execute(fixture, reservationCollision), (error) => error.code === "ADAPTER_RESOURCE_MAPPING_INVALID");

  const { context: personalStaffRef } = await createPlanAndContext();
  personalStaffRef.personnelMappings[0].staffRef = "alice-smith";
  await assert.rejects(() => execute(fixture, personalStaffRef), (error) => error.code === "ADAPTER_ID_BOUNDARY_VIOLATION");

  const { context: readableStaffRef } = await createPlanAndContext();
  readableStaffRef.personnelMappings[0].staffRef = "staff-ref-alice-smith";
  await assert.rejects(() => execute(fixture, readableStaffRef), (error) => error.code === "ADAPTER_ID_BOUNDARY_VIOLATION");

  const { context: objectIdCollision } = await createPlanAndContext();
  objectIdCollision.resourceMappings[0].externalId = objectIdCollision.demands[0].targetObjectIds[0];
  await assert.rejects(() => execute(fixture, objectIdCollision), (error) => error.code === "ADAPTER_ID_BOUNDARY_VIOLATION");
});

test("stale Plans, forged option ownership, and incompatible candidates fail closed", async () => {
  const { plan } = await createPlanAndContext();
  const snapshot = (await execute()).output;
  const conflict = snapshot.conflicts.find((item) => item.demandId === "demand-projector");
  const optionId = conflict.substitutionOptionIds[0];
  const resolveLatestSnapshot = async () => snapshot;
  const newerSource = structuredClone(fixture);
  newerSource.sourceVersion = "resource-79";
  newerSource.nextCursor = "resource-80";
  const newerSnapshot = (await execute(newerSource)).output;
  await assert.rejects(() => createOperationalSubstitutionStagingBatch({ snapshot, conflictId: conflict.id, optionId, acceptedPlan: plan, proposalRevision: 2, resolveLatestSnapshot: async () => newerSnapshot }), (error) => error.code === "ADAPTER_SOURCE_MISMATCH");
  await assert.rejects(() => createOperationalSubstitutionStagingBatch({ snapshot, conflictId: conflict.id, optionId, acceptedPlan: { ...plan, version: "3.4" }, proposalRevision: 2, resolveLatestSnapshot }), (error) => error.code === "ADAPTER_BASE_PLAN_VERSION_CONFLICT");
  await assert.rejects(() => createOperationalSubstitutionStagingBatch({ snapshot, conflictId: conflict.id, optionId: "resource-option-forged0000", acceptedPlan: plan, proposalRevision: 2, resolveLatestSnapshot }), (error) => error.code === "ADAPTER_SUBSTITUTION_INVALID");

  const incompatible = structuredClone(fixture);
  incompatible.avEquipment.find((item) => item.externalId === "projector-backup").connector = "incompatible";
  const incompatibleSnapshot = (await execute(incompatible)).output;
  assert.deepEqual(incompatibleSnapshot.conflicts.find((item) => item.demandId === "demand-projector").substitutionOptionIds, []);
});

test("an unavailable approved projector reaches validated human Approval and an auditable Resource Binding", async () => {
  const seeded = structuredClone(summitForwardPlan);
  seeded.objects.find((object) => object.id === "obj-projector-center").resourceBinding = { schemaVersion: 1, kind: "av", resourceId: "resource-projector-primary", quantity: 1 };
  let latestSnapshotEvidence = null;
  const planner = createVenuePlanner(seeded, { projectId: "project-resource-test", operationalResourceFreshnessVerifier: () => latestSnapshotEvidence });
  const baseline = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: baseline.id, baseVersion: baseline.baseVersion, actor: "human", idempotencyKey: "accept-resource-baseline" });
  const accepted = planner.getSnapshot();
  const { context } = await createPlanAndContext();
  const projector = accepted.plan.objects.find((object) => object.id === "obj-projector-center");
  context.project.planVersion = accepted.plan.version;
  context.project.planFingerprint = fingerprintPlan(accepted.plan);
  context.demands = [{
    demandId: "demand-projector",
    family: "av",
    resourceId: "resource-projector-primary",
    quantity: 1,
    targetObjectIds: [projector.id],
    requirements: { templateRef: template("inventory-template-laser-projector"), equipmentType: "projector", powerWatts: 1200, voltage: 230, connector: "powercon" },
    baseObjectChecksum: await sha256Checksum(projector),
  }];
  const authorization = { grantedScopes: ["operational-resources:read"], secretStore, secretReferences: ["operational-resources/api-token"], trustedAdapterContexts: { "operational-resources": context } };
  const snapshot = (await createAdapterRuntime({ clock }).execute(operationalResourceAdapter, "import", structuredClone(fixture), authorization)).output;
  latestSnapshotEvidence = { snapshotId: snapshot.id, snapshotChecksum: snapshot.checksum };
  const conflict = snapshot.conflicts.find((item) => item.demandId === "demand-projector");
  const batch = await createOperationalSubstitutionStagingBatch({ snapshot, conflictId: conflict.id, optionId: conflict.substitutionOptionIds[0], acceptedPlan: accepted.plan, proposalRevision: accepted.proposal.revision + 1, resolveLatestSnapshot: async () => snapshot });

  const unverifiedPlanner = createVenuePlanner(seeded, { projectId: "project-resource-test" });
  const unverifiedBaseline = unverifiedPlanner.getSnapshot().proposal;
  unverifiedPlanner.execute({ type: "approve_proposal", proposalId: unverifiedBaseline.id, baseVersion: unverifiedBaseline.baseVersion, actor: "human", idempotencyKey: "accept-unverified-resource-baseline" });
  await loadAdapterProposalForReview(unverifiedPlanner, batch);
  unverifiedPlanner.execute({ type: "validate_layout" });
  const unverifiedProposal = unverifiedPlanner.getSnapshot().proposal;
  assert.throws(() => unverifiedPlanner.execute({ type: "approve_proposal", proposalId: unverifiedProposal.id, baseVersion: unverifiedProposal.baseVersion, actor: "human", idempotencyKey: "approval-without-resource-freshness" }), (error) => error.code === "OPERATIONAL_RESOURCE_FRESHNESS_REQUIRED");

  const booleanVerifiedPlanner = createVenuePlanner(seeded, { projectId: "project-resource-test", operationalResourceFreshnessVerifier: () => true });
  const booleanBaseline = booleanVerifiedPlanner.getSnapshot().proposal;
  booleanVerifiedPlanner.execute({ type: "approve_proposal", proposalId: booleanBaseline.id, baseVersion: booleanBaseline.baseVersion, actor: "human", idempotencyKey: "accept-boolean-resource-baseline" });
  await loadAdapterProposalForReview(booleanVerifiedPlanner, batch);
  booleanVerifiedPlanner.execute({ type: "validate_layout" });
  const booleanProposal = booleanVerifiedPlanner.getSnapshot().proposal;
  assert.throws(() => booleanVerifiedPlanner.execute({ type: "approve_proposal", proposalId: booleanProposal.id, baseVersion: booleanProposal.baseVersion, actor: "human", idempotencyKey: "reject-unbound-boolean-freshness" }), (error) => error.code === "OPERATIONAL_RESOURCE_STALE");

  await loadAdapterProposalForReview(planner, batch);
  assert.equal(planner.getSnapshot().plan.objects.find((object) => object.id === projector.id).resourceBinding.resourceId, "resource-projector-primary");
  const validation = planner.execute({ type: "validate_layout" });
  assert.equal(validation.status, "pass");
  const proposal = planner.getSnapshot().proposal;
  latestSnapshotEvidence = { snapshotId: "operational-resource-snapshot-newer", snapshotChecksum: "f".repeat(64) };
  assert.throws(() => planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "reject-stale-resource-substitution" }), (error) => error.code === "OPERATIONAL_RESOURCE_STALE");
  latestSnapshotEvidence = { snapshotId: snapshot.id, snapshotChecksum: snapshot.checksum };
  const approved = planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", idempotencyKey: "approve-resource-substitution" });
  assert.equal(approved.status, "approved");
  assert.equal(planner.getSnapshot().plan.objects.find((object) => object.id === projector.id).resourceBinding.resourceId, "resource-projector-backup");
  assert.equal(planner.getSnapshot().ledger.at(-1).type, "proposal.approved");
  assert.equal(planner.getSnapshot().ledger.at(-1).details.operationalResourceEvidence[0].sourceChecksum, snapshot.checksum);
  assert.equal(planner.getSnapshot().ledger.at(-1).details.acceptedPlan.objects.find((object) => object.id === projector.id).resourceBinding.resourceId, "resource-projector-backup");
});
