import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import { createWorker } from "../worker/index.ts";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { verifyDeviationLedger } from "../src/domain/live-plan-deviations.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

class SqliteStatement {
  constructor(database, sql, values = []) {
    this.database = database;
    this.sql = sql;
    this.values = values;
  }
  bind(...values) {
    return new SqliteStatement(this.database, this.sql, values);
  }
  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }
  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }
  async run() {
    return this.database.prepare(this.sql).run(...this.values);
  }
}
class SqliteD1 {
  constructor() {
    this.database = new DatabaseSync(":memory:");
    this.database.exec("PRAGMA foreign_keys=ON");
  }
  prepare(sql) {
    return new SqliteStatement(this.database, sql);
  }
  async batch(statements) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.database.close();
  }
}

const runbook = createEventDayRunbook({
  projectId: "project-alpha",
  plan: summitForwardPlan,
  validation: { validationId: "validation-routes", inputFingerprint: "validation-input-routes", status: "pass" },
  sourceLedgerHeadHash: "activity-ledger-routes",
  approvalLedgerEntryId: "approval-routes",
  frozenAt: "2026-09-12T10:00:00.000Z",
  frozenBy: "user-seyam",
});

async function harness() {
  const db = new SqliteD1();
  await applyDatabaseMigrations(db);
  await db.batch([
    db
      .prepare("INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind("user-seyam", "test", "operator", "operator@example.test", "active", "2026-09-12T10:00:00.000Z", "2026-09-12T10:00:00.000Z"),
    db
      .prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind("org-alpha", "ALPHA", "alpha", "user-seyam", "2026-09-12T10:00:00.000Z", "2026-09-12T10:00:00.000Z"),
    db
      .prepare("INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind("project-alpha", "org-alpha", "ALPHA", summitForwardPlan.id, "2026-09-12T10:00:00.000Z", "2026-09-12T10:00:00.000Z"),
    db
      .prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)")
      .bind("project-alpha", 10, "{}", "2026-09-12T10:00:00.000Z"),
  ]);
  let now = "2026-09-12T11:00:00.000Z";
  const identities = {
    operator: ["user-seyam", ["planner", "venue-administrator"]],
    safety: ["user-safety", ["safety-officer"]],
    viewer: ["user-viewer", ["viewer"]],
    approver: ["user-approver", ["approver"]],
  };
  const api = createWorker({
    clock: () => now,
    secureCookies: false,
    identityProvider: {
      authenticate: (request) => {
        const subject = request.headers.get("x-test-identity");
        return subject
          ? { provider: "test", subject, email: `${subject}@example.test`, displayName: subject.toUpperCase() }
          : null;
      },
    },
    createAccountRepository: () => ({
      resolveSession: async () => null,
      provision: async (identity) => ({
        user: {
          id: identities[identity.subject][0],
          email: identity.email,
          displayName: identity.displayName,
          status: "active",
        },
        organizations: [{ id: "org-alpha", name: "ALPHA", slug: "alpha", roles: identities[identity.subject][1] }],
      }),
      createSession: async (userId) => ({
        id: `session-${userId}`,
        userId,
        createdAt: now,
        expiresAt: "2026-09-13T00:00:00.000Z",
        lastSeenAt: now,
        revokedAt: null,
      }),
    }),
    createProjectRepository: () => ({
      list: async () => [],
      get: async (organizationId, projectId) =>
        organizationId === "org-alpha" && projectId === "project-alpha"
          ? { id: projectId, organizationId, name: "ALPHA", revision: 1 }
          : null,
      put: async () => {
        throw new Error("unused");
      },
    }),
  });
  const request = (path, { identity = "operator", method = "GET", body } = {}) =>
    api.fetch(
      new Request(`https://example.test${path}`, {
        method,
        headers: {
          accept: "application/json",
          "x-test-identity": identity,
          "x-venuemind-organization-id": "org-alpha",
          ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { DB: db },
    );
  return { db, request, setNow: (value) => (now = value) };
}

const recordCommand = (overrides = {}) => ({
  type: "record_live_plan_deviation",
  deviationId: "deviation-east-exit",
  disposition: "revision-candidate",
  reasonCode: "LIVE_EGRESS_CONTROL",
  location: { kind: "plan-object", planObjectId: "obj-fire-exit-east" },
  affectedObjectIds: ["obj-fire-exit-east"],
  availableConstraintIds: ["constraint-emergency-readiness"],
  change: {
    id: "change-live-egress",
    title: "Control east exit",
    targetObjectIds: ["obj-fire-exit-east"],
    spatialEffects: [
      {
        operation: "update_metadata",
        objectId: "obj-fire-exit-east",
        values: { label: "East exit — controlled" },
      },
    ],
  },
  idempotencyKey: "route-record-001",
  operationId: "route-operation-001",
  expectedRevision: 0,
  ...overrides,
});

test("Deviation routes create, sync, reload, propose, and export one tenant-scoped register", async (t) => {
  const { db, request, setNow } = await harness();
  t.after(() => db.close());
  assert.equal((await request("/api/projects/project-alpha/runbooks", { method: "POST", body: { runbook } })).status, 201);
  const collection = "/api/projects/project-alpha/deviation-registers";
  assert.equal(
    (await request(collection, { identity: "viewer", method: "POST", body: { runbookVersionId: runbook.versionId } })).status,
    403,
  );
  assert.equal(
    (await request(collection, { method: "POST", body: { runbookVersionId: runbook.versionId, actorId: "forged" } })).status,
    400,
  );
  const createdResponse = await request(collection, {
    method: "POST",
    body: { runbookVersionId: runbook.versionId },
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  const item = `${collection}/${encodeURIComponent(created.register.id)}`;

  setNow("2026-09-12T11:01:00.000Z");
  const synced = await (
    await request(`${item}/commands:sync`, {
      method: "POST",
      body: { commands: [recordCommand(), recordCommand()] },
    })
  ).json();
  assert.deepEqual(synced.acknowledgements.map(({ status }) => status), ["applied", "already-applied"]);
  assert.equal(synced.register.deviations[0].authored.actorType, "human");
  assert.equal(synced.register.deviations[0].authored.actorId, "user-seyam");
  assert.equal(synced.register.deviations[0].authored.sessionId, "session-user-seyam");
  assert.equal(synced.register.deviations[0].authored.occurredAt, "2026-09-12T11:01:00.000Z");
  assert.equal(synced.overlay.overlayPlan.objects.find(({ id }) => id === "obj-fire-exit-east").label, "East exit — controlled");

  setNow("2026-09-12T17:55:00.000Z");
  const ended = await (
    await request(`${item}/commands:sync`, {
      method: "POST",
      body: {
        commands: [
          {
            type: "end_live_plan_deviation",
            deviationId: "deviation-east-exit",
            expectedRevision: 1,
            expectedDeviationRevision: 1,
            reasonCode: "EVENT_ENDED",
            idempotencyKey: "route-end-001",
          },
        ],
      },
    })
  ).json();
  assert.equal(ended.acknowledgements[0].status, "applied");

  setNow("2026-09-12T18:00:00.000Z");
  const proposed = await (
    await request(`${item}/commands:sync`, {
      method: "POST",
      body: {
        commands: [
          {
            type: "create_post_event_deviation_proposal",
            proposalId: "proposal-post-event-egress",
            goal: "Retain the egress control",
            deviationIds: ["deviation-east-exit"],
            expectedRevision: 2,
            idempotencyKey: "route-proposal-001",
          },
        ],
      },
    })
  ).json();
  assert.equal(proposed.acknowledgements[0].status, "applied");
  assert.equal(proposed.acknowledgements[0].proposal.status, "review");

  const loaded = await (await request(item, { identity: "viewer" })).json();
  assert.equal(loaded.register.revision, 3);
  assert.equal(verifyDeviationLedger(loaded.register).status, "pass");
  const exported = await (await request(`${item}/export`, { identity: "approver" })).json();
  const artifact = JSON.parse(exported.artifact.content);
  assert.equal(artifact.approvedPlan.identity.planFingerprint, runbook.source.planFingerprint);
  assert.equal(artifact.liveDeviations.length, 1);
  assert.equal(artifact.postEventRecommendedRevisions.length, 1);
  assert.equal(artifact.integrity.status, "pass");
});

test("Deviation routes reject forged actor/time fields, malformed nested payloads, stale writes, and role overreach", async (t) => {
  const { db, request } = await harness();
  t.after(() => db.close());
  await request("/api/projects/project-alpha/runbooks", { method: "POST", body: { runbook } });
  const collection = "/api/projects/project-alpha/deviation-registers";
  const created = await (
    await request(collection, { method: "POST", body: { runbookVersionId: runbook.versionId } })
  ).json();
  const item = `${collection}/${encodeURIComponent(created.register.id)}`;
  const response = await (
    await request(`${item}/commands:sync`, {
      method: "POST",
      body: {
        commands: [
          recordCommand({ actorType: "agent", actorId: "forged-agent", committedAt: "1999-01-01T00:00:00.000Z" }),
          recordCommand({
            idempotencyKey: "route-bad-location",
            location: { kind: "plan-object", planObjectId: "obj-fire-exit-east", label: "forged" },
          }),
          recordCommand({ idempotencyKey: "route-valid", operationId: "route-valid" }),
          recordCommand({ deviationId: "deviation-stale", idempotencyKey: "route-stale", expectedRevision: 0 }),
        ],
      },
    })
  ).json();
  assert.deepEqual(response.acknowledgements.map(({ status }) => status), ["rejected", "rejected", "applied", "conflict"]);
  assert.equal(response.register.deviations.length, 1);

  const safetyProposal = await (
    await request(`${item}/commands:sync`, {
      identity: "safety",
      method: "POST",
      body: {
        commands: [
          {
            type: "create_post_event_deviation_proposal",
            proposalId: "proposal-unauthorized",
            goal: "Unauthorized",
            deviationIds: ["deviation-east-exit"],
            expectedRevision: 1,
            idempotencyKey: "route-unauthorized-proposal",
          },
        ],
      },
    })
  ).json();
  assert.equal(safetyProposal.acknowledgements[0].status, "rejected");
  assert.equal(safetyProposal.acknowledgements[0].code, "AUTHORIZATION_DENIED");
  assert.equal((await request(`${item}/commands:sync`, { identity: "viewer", method: "POST", body: { commands: [] } })).status, 403);
  assert.equal((await request(`${item}/export`, { identity: "viewer" })).status, 403);
});
