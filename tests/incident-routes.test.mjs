import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { verifyIncidentLedger } from "../src/domain/incidents.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { applyDatabaseMigrations } from "../worker/database-migrations.ts";
import { createWorker } from "../worker/index.ts";

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
  validation: {
    validationId: "validation-incident-routes",
    inputFingerprint: "validation-input-incident-routes",
    status: "pass",
  },
  sourceLedgerHeadHash: "activity-ledger-incident-routes",
  approvalLedgerEntryId: "approval-incident-routes",
  frozenAt: "2026-09-12T10:00:00.000Z",
  frozenBy: "user-seyam",
});

async function harness() {
  const db = new SqliteD1();
  await applyDatabaseMigrations(db);
  await db.batch([
    db
      .prepare(
        "INSERT INTO users (id,identity_provider,provider_subject,email,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      )
      .bind(
        "user-seyam",
        "test",
        "operator",
        "operator@example.test",
        "active",
        "2026-09-12T10:00:00.000Z",
        "2026-09-12T10:00:00.000Z",
      ),
    db
      .prepare("INSERT INTO organizations (id,name,slug,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?)")
      .bind("org-alpha", "ALPHA", "alpha", "user-seyam", "2026-09-12T10:00:00.000Z", "2026-09-12T10:00:00.000Z"),
    db
      .prepare(
        "INSERT INTO projects (id,organization_id,name,active_plan_id,created_at,updated_at) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        "project-alpha",
        "org-alpha",
        "ALPHA",
        summitForwardPlan.id,
        "2026-09-12T10:00:00.000Z",
        "2026-09-12T10:00:00.000Z",
      ),
    db
      .prepare("INSERT INTO project_states (project_id,schema_version,snapshot_json,updated_at) VALUES (?,?,?,?)")
      .bind("project-alpha", 10, "{}", "2026-09-12T10:00:00.000Z"),
  ]);
  let now = "2026-09-12T11:00:00.000Z";
  const identities = {
    operator: ["user-seyam", ["organization-administrator", "venue-administrator"]],
    viewer: ["user-viewer", ["viewer"]],
    approver: ["user-approver", ["approver"]],
  };
  const api = createWorker({
    clock: () => now,
    secureCookies: false,
    identityProvider: {
      authenticate: (request) =>
        request.headers.get("x-test-identity")
          ? {
              provider: "test",
              subject: request.headers.get("x-test-identity"),
              email: `${request.headers.get("x-test-identity")}@example.test`,
              displayName: request.headers.get("x-test-identity").toUpperCase(),
            }
          : null,
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
  return {
    db,
    request,
    setNow: (value) => {
      now = value;
    },
  };
}

test("Incident routes create, report, manage, reload, and export one auditable register", async (t) => {
  const { db, request, setNow } = await harness();
  t.after(() => db.close());
  assert.equal(
    (await request("/api/projects/project-alpha/runbooks", { method: "POST", body: { runbook } })).status,
    201,
  );
  const collection = "/api/projects/project-alpha/incident-registers";
  assert.equal(
    (await request(collection, { identity: "viewer", method: "POST", body: { runbookVersionId: runbook.versionId } }))
      .status,
    403,
  );
  const createdResponse = await request(collection, { method: "POST", body: { runbookVersionId: runbook.versionId } });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.equal(created.register.runbookVersionId, runbook.versionId);
  const item = `${collection}/${encodeURIComponent(created.register.id)}`;

  setNow("2026-09-12T11:01:00.000Z");
  const report = {
    type: "report_incident",
    incidentId: "incident-east-exit",
    severity: "high",
    category: "fire-life-safety",
    summaryCode: "EXIT_OBSTRUCTED",
    location: { kind: "plan-object", planObjectId: "obj-fire-exit-east" },
    relatedRefs: [{ kind: "plan-object", id: "obj-fire-exit-east" }],
    idempotencyKey: "route-report-001",
    operationId: "route-operation-001",
  };
  const reported = await (
    await request(`${item}/commands:sync`, { method: "POST", body: { commands: [report, report] } })
  ).json();
  assert.deepEqual(
    reported.acknowledgements.map((value) => value.status),
    ["applied", "already-applied"],
  );
  assert.equal(reported.register.incidents[0].location.planFingerprint, runbook.source.planFingerprint);

  setNow("2026-09-12T11:02:00.000Z");
  const managed = await (
    await request(`${item}/commands:sync`, {
      method: "POST",
      body: {
        commands: [
          {
            type: "set_incident_owner",
            incidentId: "incident-east-exit",
            owner: { roleId: "role-security" },
            expectedIncidentRevision: 1,
            idempotencyKey: "route-owner-001",
          },
          {
            type: "acknowledge_incident",
            incidentId: "incident-east-exit",
            reasonCode: "OPS_OWNER_CONFIRMED",
            expectedIncidentRevision: 2,
            idempotencyKey: "route-ack-001",
          },
          {
            type: "escalate_incident",
            incidentId: "incident-east-exit",
            level: "venue-command",
            reasonCode: "EXIT_CAPACITY_AT_RISK",
            expectedIncidentRevision: 3,
            idempotencyKey: "route-escalate-001",
          },
        ],
      },
    })
  ).json();
  assert.deepEqual(
    managed.acknowledgements.map((value) => value.status),
    ["applied", "applied", "applied"],
  );
  assert.equal(managed.register.incidents[0].acknowledgement.status, "acknowledged");
  assert.equal(managed.register.incidents[0].escalation.level, "venue-command");

  setNow("2026-09-12T11:02:30.000Z");
  const agentReported = await (
    await request(`${item}/commands:sync`, {
      method: "POST",
      body: {
        commands: [
          {
            type: "report_incident",
            incidentId: "incident-agent-report",
            severity: "medium",
            category: "facilities",
            summaryCode: "POWER_FEED_UNSTABLE",
            location: { kind: "plan-object", planObjectId: "obj-first-aid-north" },
            relatedRefs: [],
            idempotencyKey: "route-agent-report-001",
            actorType: "agent",
            actorId: "webmcp-agent",
            source: "webmcp",
          },
        ],
      },
    })
  ).json();
  const agentTransition = agentReported.register.transitions.find(
    (transition) => transition.incidentId === "incident-agent-report",
  );
  assert.deepEqual(
    { actorType: agentTransition.actorType, actorId: agentTransition.actorId, source: agentTransition.source },
    { actorType: "human", actorId: "user-seyam", source: "webmcp" },
  );

  setNow("2026-09-12T11:04:00.000Z");
  const emergency = await (
    await request(`${item}/commands:sync`, {
      method: "POST",
      body: {
        commands: [
          {
            type: "record_incident_emergency_action",
            incidentId: "incident-east-exit",
            actionCode: "CLOSE_EXIT",
            targetObjectIds: ["obj-fire-exit-east"],
            scenarioDefinitionId: "scenario-blocked-east-exit",
            authorityRole: "safety-officer",
            expectedIncidentRevision: managed.register.incidents.find(
              (incident) => incident.id === "incident-east-exit",
            ).revision,
            idempotencyKey: "route-emergency-001",
          },
        ],
      },
    })
  ).json();
  assert.equal(emergency.acknowledgements[0].status, "applied");
  assert.equal(
    emergency.register.incidents.find((incident) => incident.id === "incident-east-exit").emergencyActions[0]
      .authorityRole,
    "venue-administrator",
  );

  const loaded = await (await request(item)).json();
  assert.equal(verifyIncidentLedger(loaded.register).status, "pass");
  const exported = await (await request(`${item}/incidents/incident-east-exit/export`)).json();
  assert.equal(JSON.parse(exported.artifact.content).integrity.status, "pass");
  assert.equal((await request(`${item}/incidents/incident-east-exit/export`, { identity: "approver" })).status, 200);
});

test("Incident routes keep privileged response actions human-only", async (t) => {
  const { db, request } = await harness();
  t.after(() => db.close());
  await request("/api/projects/project-alpha/runbooks", { method: "POST", body: { runbook } });
  const collection = "/api/projects/project-alpha/incident-registers";
  const created = await (
    await request(collection, { method: "POST", body: { runbookVersionId: runbook.versionId } })
  ).json();
  const item = `${collection}/${encodeURIComponent(created.register.id)}`;
  assert.equal(
    (await request(`${item}/commands:sync`, { identity: "viewer", method: "POST", body: { commands: [] } })).status,
    403,
  );
  assert.equal((await request(`${item}/export?incidentId=missing`, { identity: "viewer" })).status, 403);
});
