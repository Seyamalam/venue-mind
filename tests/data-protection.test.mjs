import assert from "node:assert/strict";
import test from "node:test";
import {
  DATA_COLLECTION_BOUNDARIES,
  DEFAULT_RETENTION_RULES,
  createOrganizationRetentionPolicy,
  projectDeletionTargets,
  safeLogRecord,
} from "../src/security/data-protection.ts";

const policy = createOrganizationRetentionPolicy({
  organizationId: "org-alpha",
  operationalSensitiveDays: 365,
  securityEvidenceDays: 400,
  projectRecoveryDays: 7,
  updatedAt: "2026-09-03T00:00:00.000Z",
  updatedBy: "user-admin",
});

test("retention policy bounds every organization-controlled window", () => {
  assert.equal(policy.schemaVersion, 1);
  assert.equal(DEFAULT_RETENTION_RULES["secret-reference"].stores.length, 0);
  assert.throws(
    () => createOrganizationRetentionPolicy({ ...policy, operationalSensitiveDays: 10 }),
    /RETENTION_POLICY_INVALID:operationalSensitiveDays/,
  );
  assert.throws(
    () => createOrganizationRetentionPolicy({ ...policy, projectRecoveryDays: 31 }),
    /RETENTION_POLICY_INVALID:projectRecoveryDays/,
  );
});

test("deletion targets cover primary, cache, on-demand export, and backup expectations", () => {
  assert.deepEqual(projectDeletionTargets("2026-09-03T00:00:00.000Z", policy), [
    { store: "d1-primary", action: "expire", dueAt: "2026-09-10T00:00:00.000Z", verification: "project-cascade-absent" },
    { store: "browser-cache", action: "purge-now", dueAt: "2026-09-03T00:00:00.000Z", verification: "project-cache-absent" },
    { store: "on-demand-export", action: "user-managed", dueAt: null, verification: "export-not-server-stored" },
    { store: "backup", action: "expire", dueAt: "2026-10-10T00:00:00.000Z", verification: "backup-window-expired" },
  ]);
});

test("safe logs exclude payloads, secrets, contact identity, geometry, and nested values", () => {
  const output = safeLogRecord({
    event: "command.failed",
    code: "REVISION_CONFLICT",
    correlationId: "corr-1",
    durationMs: 12,
    email: "operator@example.test",
    token: "secret",
    snapshot: { objects: [{ id: "chair-1" }] },
    details: { reason: "private" },
  });
  assert.deepEqual(output, {
    event: "command.failed",
    code: "REVISION_CONFLICT",
    correlationId: "corr-1",
    durationMs: 12,
  });
  assert.doesNotMatch(JSON.stringify(output), /operator|secret|chair-1|private/);
});

test("collection boundaries retain aggregate operations and reject person-level storage", () => {
  assert.deepEqual(DATA_COLLECTION_BOUNDARIES, {
    attendeeRecords: false,
    individualOccupancyEvents: false,
    rawIntegrationCredentials: false,
    serverStoredExports: false,
    aggregateOccupancyOnly: true,
    opaqueSecretReferencesOnly: true,
    productAnalyticsDefaultEnabled: false,
    productAnalyticsAggregateOnly: true,
    productAnalyticsIdentityStored: false,
    productAnalyticsContentStored: false,
  });
  assert.equal(DEFAULT_RETENTION_RULES["product-analytics"].activeDays, 180);
  assert.equal(DEFAULT_RETENTION_RULES["product-analytics"].deletedRecoveryDays, 0);
});
