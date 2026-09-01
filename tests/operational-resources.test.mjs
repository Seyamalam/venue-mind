import assert from "node:assert/strict";
import test from "node:test";
import { bookingOverlaps, normalizePreparedOperationalResourceInput, reconcileOperationalResources, resourceSatisfiesDemand } from "../src/domain/operational-resources.js";

const EVENT = { startAt: "2026-09-12T10:00:00.000Z", endAt: "2026-09-12T12:00:00.000Z" };
const templateRef = { templateId: "inventory-template-laser-projector", version: "1.0.0" };
const capability = (connector = "powercon") => ({ templateRef, equipmentType: "projector", powerWatts: 1200, voltage: 230, connector });
const source = (externalId, checksum) => ({ entityType: "av-resource", externalId, sourceVersion: "77", checksum });
const booking = (bookingRef, startAt, endAt, reservationRef = "reservation-other") => ({ bookingRef, startAt, endAt, quantity: 1, reservationRef });

const prepared = (overrides = {}) => ({
  sourceSystem: "venue-ops-prod",
  sourceVersion: "resource-77",
  nextCursor: "resource-78",
  project: { projectId: "project-resource-test", planVersion: "3.3", planFingerprint: "plan-dddddddd", eventWindow: EVENT, currentReservationRef: "reservation-current" },
  resources: [
    { resourceId: "resource-primary", family: "av", status: "unavailable", total: 1, unavailable: 1, bookings: [], capability: capability(), source: source("projector-primary", "a".repeat(64)) },
    { resourceId: "resource-backup", family: "av", status: "available", total: 1, unavailable: 0, bookings: [], capability: capability(), source: source("projector-backup", "b".repeat(64)) },
  ],
  staffing: { roles: [], shifts: [], assignments: [] },
  demands: [{ demandId: "demand-projector", family: "av", resourceId: "resource-primary", quantity: 1, targetObjectIds: ["obj-projector"], requirements: capability(), baseObjectChecksum: "c".repeat(64) }],
  ...overrides,
});

test("booking overlap uses half-open windows", () => {
  assert.equal(bookingOverlaps(booking("overlap", "2026-09-12T09:59:59.000Z", "2026-09-12T10:00:01.000Z"), EVENT), true);
  assert.equal(bookingOverlaps(booking("before", "2026-09-12T08:00:00.000Z", "2026-09-12T10:00:00.000Z"), EVENT), false);
  assert.equal(bookingOverlaps(booking("after", "2026-09-12T12:00:00.000Z", "2026-09-12T13:00:00.000Z"), EVENT), false);
});

test("pure reconciliation creates deterministic conflicts and explicit compatible options", async () => {
  const first = await reconcileOperationalResources(prepared());
  const second = await reconcileOperationalResources(prepared({ resources: prepared().resources.toReversed() }));
  assert.equal(first.status, "attention-required");
  assert.equal(first.conflicts[0].reason, "unavailable");
  assert.match(first.conflicts[0].id, /^resource-conflict-[0-9a-f]{16}$/);
  assert.match(first.substitutionOptions[0].id, /^resource-option-[0-9a-f]{16}$/);
  assert.equal(first.substitutionOptions[0].replacementResourceId, "resource-backup");
  assert.deepEqual(second, first);
  assert.equal(Object.hasOwn(first, "selectedOptionId"), false);
});

test("prepared v1 evidence accepts legacy SHA-256 and current canonical Plan fingerprints", () => {
  assert.equal(normalizePreparedOperationalResourceInput(prepared()).project.planFingerprint, "plan-dddddddd");
  const legacy = prepared();
  legacy.project.planFingerprint = "d".repeat(64);
  assert.equal(normalizePreparedOperationalResourceInput(legacy).project.planFingerprint, "d".repeat(64));
});

test("self bookings and endpoint-adjacent bookings do not reduce availability", async () => {
  const input = prepared();
  input.resources[0] = { ...input.resources[0], status: "available", unavailable: 0, bookings: [
    booking("self", EVENT.startAt, EVENT.endAt, "reservation-current"),
    booking("adjacent", "2026-09-12T08:00:00.000Z", EVENT.startAt),
  ] };
  const result = await reconcileOperationalResources(input);
  assert.equal(result.status, "reconciled");
  assert.deepEqual(result.conflicts, []);
});

test("other overlapping bookings are double-booked and preserve opaque booking evidence", async () => {
  const input = prepared();
  input.resources[0] = { ...input.resources[0], status: "available", unavailable: 0, bookings: [booking("other-overlap", EVENT.startAt, EVENT.endAt)] };
  const result = await reconcileOperationalResources(input);
  assert.equal(result.conflicts[0].reason, "double-booked");
  assert.deepEqual(result.conflicts[0].bookingRefs, ["other-overlap"]);
});

test("incompatible resources do not become substitution options", async () => {
  const input = prepared();
  input.resources[1].capability = capability("incompatible");
  const normalized = normalizePreparedOperationalResourceInput(input);
  assert.equal(resourceSatisfiesDemand(normalized.resources.find((item) => item.resourceId === "resource-backup"), normalized.demands[0]), false);
  const result = await reconcileOperationalResources(normalized);
  assert.deepEqual(result.conflicts[0].substitutionOptionIds, []);
  assert.deepEqual(result.substitutionOptions, []);
});

test("an incompatible primary binding produces explicit metadata conflict evidence", async () => {
  const input = prepared();
  input.resources[0] = { ...input.resources[0], status: "available", unavailable: 0, capability: capability("incompatible") };
  const result = await reconcileOperationalResources(input);
  assert.equal(result.conflicts[0].reason, "incompatible-metadata");
  assert.equal(result.summary.incompatibleMetadata, 1);
});

test("aggregate reconciliation reserves finite primary and replacement capacity", async () => {
  const input = prepared();
  input.resources = [
    { ...input.resources[0], resourceId: "resource-primary-a" },
    { ...input.resources[0], resourceId: "resource-primary-b", source: source("projector-primary-b", "e".repeat(64)) },
    { ...input.resources[1], total: 1 },
  ];
  input.demands = [
    { ...input.demands[0], demandId: "demand-a", resourceId: "resource-primary-a", targetObjectIds: ["obj-projector-a"] },
    { ...input.demands[0], demandId: "demand-b", resourceId: "resource-primary-b", targetObjectIds: ["obj-projector-b"] },
  ];
  const result = await reconcileOperationalResources(input);
  assert.equal(result.conflicts.length, 2);
  assert.equal(result.conflicts[0].substitutionOptionIds.length + result.conflicts[1].substitutionOptionIds.length, 1);
  assert.equal(result.substitutionOptions.filter((option) => option.replacementResourceId === "resource-backup").length, 1);

  const balanced = prepared();
  balanced.resources = [
    { ...balanced.resources[0], resourceId: "resource-primary-a" },
    { ...balanced.resources[0], resourceId: "resource-primary-b", source: source("projector-primary-b", "e".repeat(64)) },
    balanced.resources[1],
    { ...balanced.resources[1], resourceId: "resource-backup-b", source: source("projector-backup-b", "f".repeat(64)) },
  ];
  balanced.demands = [
    { ...balanced.demands[0], demandId: "demand-a", resourceId: "resource-primary-a", targetObjectIds: ["obj-projector-a"] },
    { ...balanced.demands[0], demandId: "demand-b", resourceId: "resource-primary-b", targetObjectIds: ["obj-projector-b"] },
  ];
  const balancedResult = await reconcileOperationalResources(balanced);
  assert.deepEqual(balancedResult.conflicts.map((conflict) => conflict.substitutionOptionIds.length), [1, 1]);
  assert.equal(new Set(balancedResult.substitutionOptions.map((option) => option.replacementResourceId)).size, 2);

  const packed = prepared();
  packed.resources = [
    { ...packed.resources[0], resourceId: "resource-primary-large", total: 3, unavailable: 3 },
    { ...packed.resources[0], resourceId: "resource-primary-medium-a", total: 2, unavailable: 2, source: source("projector-primary-medium-a", "3".repeat(64)) },
    { ...packed.resources[0], resourceId: "resource-primary-medium-b", total: 2, unavailable: 2, source: source("projector-primary-medium-b", "4".repeat(64)) },
    { ...packed.resources[1], resourceId: "resource-backup-a", total: 4, source: source("projector-backup-a", "5".repeat(64)) },
    { ...packed.resources[1], resourceId: "resource-backup-b", total: 3, source: source("projector-backup-b", "6".repeat(64)) },
  ];
  packed.demands = [
    { ...packed.demands[0], demandId: "demand-large", resourceId: "resource-primary-large", quantity: 3, targetObjectIds: ["obj-projector-large"] },
    { ...packed.demands[0], demandId: "demand-medium-a", resourceId: "resource-primary-medium-a", quantity: 2, targetObjectIds: ["obj-projector-medium-a"] },
    { ...packed.demands[0], demandId: "demand-medium-b", resourceId: "resource-primary-medium-b", quantity: 2, targetObjectIds: ["obj-projector-medium-b"] },
  ];
  const packedResult = await reconcileOperationalResources(packed);
  assert.equal(packedResult.substitutionOptions.length, 3);
  const packedLoads = Object.groupBy(packedResult.substitutionOptions, (option) => option.replacementResourceId);
  assert.deepEqual(Object.fromEntries(Object.entries(packedLoads).map(([resourceId, options]) => [resourceId, options.reduce((sum, option) => sum + option.quantity, 0)])), { "resource-backup-a": 4, "resource-backup-b": 3 });

  const shortfall = prepared();
  shortfall.resources = [
    { ...shortfall.resources[0], resourceId: "resource-short", status: "available", unavailable: 0, total: 1 },
    { ...shortfall.resources[0], resourceId: "resource-primary-b", source: source("projector-primary-b", "e".repeat(64)) },
    shortfall.resources[1],
  ];
  shortfall.demands = [
    { ...shortfall.demands[0], demandId: "demand-short", resourceId: "resource-short", quantity: 2, targetObjectIds: ["obj-projector-short"] },
    { ...shortfall.demands[0], demandId: "demand-b", resourceId: "resource-primary-b", targetObjectIds: ["obj-projector-b"] },
  ];
  const shortfallResult = await reconcileOperationalResources(shortfall);
  assert.equal(shortfallResult.substitutionOptions.some((option) => option.replacementResourceId === "resource-short"), false);

  const shared = prepared();
  shared.resources[0] = { ...shared.resources[0], status: "available", unavailable: 0 };
  shared.demands = [
    { ...shared.demands[0], demandId: "demand-first", targetObjectIds: ["obj-projector-a"] },
    { ...shared.demands[0], demandId: "demand-second", targetObjectIds: ["obj-projector-b"] },
  ];
  const sharedResult = await reconcileOperationalResources(shared);
  assert.equal(sharedResult.conflicts.length, 1);
  assert.equal(sharedResult.conflicts[0].reason, "capacity-shortfall");
  assert.equal(sharedResult.conflicts[0].availableQuantity, 0);
});

test("only single-target object substitutions are advertised", async () => {
  const input = prepared();
  input.demands[0].targetObjectIds = ["obj-projector-a", "obj-projector-b"];
  const result = await reconcileOperationalResources(input);
  assert.deepEqual(result.substitutionOptions, []);
  assert.deepEqual(result.conflicts[0].substitutionOptionIds, []);
});

test("staffing capability preserves exact role and shift pairs", () => {
  const resource = { family: "staffing", capability: { assignments: [{ roleId: "role-security", shiftId: "shift-day" }, { roleId: "role-usher", shiftId: "shift-night" }] } };
  assert.equal(resourceSatisfiesDemand(resource, { family: "staffing", requirements: { roleId: "role-security", shiftId: "shift-night" } }), false);
  assert.equal(resourceSatisfiesDemand(resource, { family: "staffing", requirements: { roleId: "role-security", shiftId: "shift-day" } }), true);
});

test("an unavailable staffing assignment is isolated and classified by its exact role and shift", async () => {
  const staffRef = "staff-ref-11111111111111111111111111111111";
  const resourceId = "resource-staff-a";
  const input = prepared({
    resources: [{ resourceId, family: "staffing", status: "available", total: 1, unavailable: 0, bookings: [], capability: { assignments: [
      { roleId: "role-security", shiftId: "shift-event", status: "available", bookings: [] },
      { roleId: "role-usher", shiftId: "shift-event", status: "unavailable", bookings: [] },
    ] }, source: { entityType: "staff-assignment", sourceVersion: "77", checksum: "a".repeat(64) } }],
    staffing: {
      roles: [
        { roleId: "role-security", availableHeadcount: 1, skills: [], sourceChecksum: "b".repeat(64) },
        { roleId: "role-usher", availableHeadcount: 1, skills: [], sourceChecksum: "c".repeat(64) },
      ],
      shifts: [{ shiftId: "shift-event", ...EVENT, sourceChecksum: "d".repeat(64) }],
      assignments: [
        { assignmentId: "staff-assignment-security", staffRef, roleId: "role-security", shiftId: "shift-event", resourceId, sourceChecksum: "e".repeat(64) },
        { assignmentId: "staff-assignment-usher", staffRef, roleId: "role-usher", shiftId: "shift-event", resourceId, sourceChecksum: "f".repeat(64) },
      ],
    },
    demands: [{ demandId: "demand-usher", family: "staffing", resourceId, quantity: 1, targetObjectIds: ["obj-post-usher"], requirements: { roleId: "role-usher", shiftId: "shift-event" }, baseObjectChecksum: "1".repeat(64) }],
  });

  const result = await reconcileOperationalResources(input);
  assert.equal(result.conflicts[0].reason, "unavailable");
  assert.equal(result.conflicts[0].availableQuantity, 0);
});

test("staffing reconciliation reserves aggregate role headcount", async () => {
  const staffSource = (checksum) => ({ entityType: "staff-assignment", sourceVersion: "77", checksum });
  const staffResource = (resourceId, checksum) => ({ resourceId, family: "staffing", status: "available", total: 1, unavailable: 0, bookings: [], capability: { assignments: [{ roleId: "role-security", shiftId: "shift-event" }] }, source: staffSource(checksum) });
  const input = prepared({
    resources: [staffResource("resource-staff-a", "a".repeat(64)), staffResource("resource-staff-b", "b".repeat(64))],
    staffing: {
      roles: [{ roleId: "role-security", availableHeadcount: 1, skills: [], sourceChecksum: "c".repeat(64) }],
      shifts: [{ shiftId: "shift-event", ...EVENT, sourceChecksum: "d".repeat(64) }],
      assignments: [
        { assignmentId: "staff-assignment-a", staffRef: "staff-ref-11111111111111111111111111111111", roleId: "role-security", shiftId: "shift-event", resourceId: "resource-staff-a", sourceChecksum: "e".repeat(64) },
        { assignmentId: "staff-assignment-b", staffRef: "staff-ref-22222222222222222222222222222222", roleId: "role-security", shiftId: "shift-event", resourceId: "resource-staff-b", sourceChecksum: "f".repeat(64) },
      ],
    },
    demands: [
      { demandId: "demand-staff-a", family: "staffing", resourceId: "resource-staff-a", quantity: 1, targetObjectIds: ["obj-post-a"], requirements: { roleId: "role-security", shiftId: "shift-event" }, baseObjectChecksum: "1".repeat(64) },
      { demandId: "demand-staff-b", family: "staffing", resourceId: "resource-staff-b", quantity: 1, targetObjectIds: ["obj-post-b"], requirements: { roleId: "role-security", shiftId: "shift-event" }, baseObjectChecksum: "2".repeat(64) },
    ],
  });
  const result = await reconcileOperationalResources(input);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].demandId, "demand-staff-b");
  assert.equal(result.conflicts[0].reason, "capacity-shortfall");
  assert.deepEqual(result.conflicts[0].substitutionOptionIds, []);
});

test("prepared contracts reject unknown fields without echoing their names", () => {
  const input = prepared();
  input.resources[0]["alice@example.test"] = "secret";
  assert.throws(() => normalizePreparedOperationalResourceInput(input), (error) => error.code === "ADAPTER_CONTRACT_UNKNOWN_FIELD" && !JSON.stringify(error.details).includes("alice@example.test"));
});
