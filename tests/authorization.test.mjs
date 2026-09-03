import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_SCOPE_PERMISSIONS,
  AGENT_SCOPES,
  createAgentGrant,
  createAgentPrincipal,
  createHumanPrincipal,
  createShortLivedAgentAuthorization,
  evaluateVenuePermission,
  HUMAN_ROLE_PERMISSIONS,
  HUMAN_ROLES,
  permissionForCommand,
  permissionForTool,
  VENUE_PERMISSIONS,
} from "../src/domain/authorization.ts";
import { venueCommandSchema, venueToolContracts } from "../src/contracts/venue-contracts.ts";
import { verifyActivityLedger } from "../src/domain/activity-ledger.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { createVenueToolService } from "../src/tools/venue-tool-service.ts";

const NOW = "2026-08-27T10:00:00.000Z";
const LATER = "2026-08-27T10:30:00.000Z";
const EXPIRED = "2026-08-27T11:00:00.000Z";
const clock =
  (value = LATER) =>
  () =>
    value;

const grant = (scopes, overrides = {}) =>
  createAgentGrant({
    id: `grant-${scopes.join("-") || "none"}`,
    agentId: "agent-1",
    organizationId: "org-alpha",
    projectId: "project-summit-forward",
    scopes,
    issuedBy: "venue-admin-1",
    issuedAt: NOW,
    expiresAt: EXPIRED,
    ...overrides,
  });

test("human authorization matrix grants exactly each documented role permission", () => {
  for (const role of HUMAN_ROLES) {
    const principal = createHumanPrincipal({ id: `human-${role}`, roles: [role] });
    const expected = new Set(HUMAN_ROLE_PERMISSIONS[role]);
    for (const permission of VENUE_PERMISSIONS) {
      const result = evaluateVenuePermission({
        permission,
        principal,
        projectId: "project-summit-forward",
        clock: clock(),
      });
      assert.equal(result.status, expected.has(permission) ? "allow" : "deny", `${role} ${permission}`);
    }
  }
});

test("every planner command and published tool resolves through the authorization matrix", () => {
  const commandTypes = venueCommandSchema.oneOf.flatMap(
    (schema) => schema.properties.type.enum ?? [schema.properties.type.const],
  );
  for (const commandType of commandTypes)
    assert.ok(VENUE_PERMISSIONS.includes(permissionForCommand(commandType)), commandType);

  const principal = createAgentPrincipal({ id: "agent-1" });
  for (const contract of venueToolContracts) {
    const permission = permissionForTool(contract.name, contract.authorization.requiredScope);
    const activeGrant = grant([contract.authorization.requiredScope], { id: `grant-${contract.name}` });
    const result = evaluateVenuePermission({
      permission,
      principal,
      grant: activeGrant,
      projectId: "project-summit-forward",
      clock: clock(),
    });
    assert.equal(result.status, "allow", `${contract.name} ${permission}`);
  }
  assert.equal(
    venueToolContracts.some((contract) => /approve|delete_project/.test(contract.name)),
    false,
  );
});

test("Agent Grant scope matrix remains separate from every human-only permission", () => {
  const principal = createAgentPrincipal({ id: "agent-1" });
  const humanOnly = new Set([
    "project.manage",
    "plan.update",
    "proposal.review",
    "approval.approve",
    "approval.waive",
    "lock.manage",
    "incident.manage",
    "incident.emergency-act",
  ]);
  for (const scope of AGENT_SCOPES) {
    const activeGrant = grant([scope]);
    const expected = new Set(AGENT_SCOPE_PERMISSIONS[scope]);
    for (const permission of VENUE_PERMISSIONS) {
      const result = evaluateVenuePermission({
        permission,
        principal,
        grant: activeGrant,
        projectId: "project-summit-forward",
        clock: clock(),
      });
      assert.equal(result.status, expected.has(permission) ? "allow" : "deny", `${scope} ${permission}`);
      if (humanOnly.has(permission)) assert.equal(result.status, "deny");
    }
  }
});

test("Agent Grants are short-lived and bound to one Organization and Project", () => {
  const principal = createAgentPrincipal({ id: "agent-1" });
  const activeGrant = grant(["venue:read"]);
  assert.equal(
    evaluateVenuePermission({
      permission: "plan.read",
      principal,
      grant: activeGrant,
      organizationId: "org-alpha",
      projectId: "project-summit-forward",
      clock: clock(),
    }).status,
    "allow",
  );
  assert.equal(
    evaluateVenuePermission({
      permission: "plan.read",
      principal,
      grant: activeGrant,
      organizationId: "org-bravo",
      projectId: "project-summit-forward",
      clock: clock(),
    }).reason,
    "agent-grant-organization-mismatch",
  );
  assert.equal(
    evaluateVenuePermission({
      permission: "plan.read",
      principal,
      grant: activeGrant,
      projectId: "project-other",
      clock: clock(),
    }).reason,
    "agent-grant-project-mismatch",
  );
  assert.equal(
    evaluateVenuePermission({
      permission: "plan.read",
      principal,
      grant: activeGrant,
      projectId: "project-summit-forward",
      clock: clock(EXPIRED),
    }).reason,
    "agent-grant-expired",
  );
  assert.throws(
    () => grant(["venue:read"], { expiresAt: "2026-08-27T12:00:00.001Z" }),
    (error) => error.code === "AGENT_GRANT_INVALID",
  );
});

test("delegated WebMCP authority cannot exceed the signed-in human role", () => {
  const delegatedBy = createHumanPrincipal({ id: "viewer-1", organizationId: "org-alpha", roles: ["viewer"] });
  const authorization = createShortLivedAgentAuthorization({
    agentId: "webmcp-agent",
    organizationId: "org-alpha",
    projectId: "project-summit-forward",
    scopes: AGENT_SCOPES,
    issuedBy: "viewer-1",
    delegatedBy,
    ttlMs: 60 * 60 * 1000,
    clock: clock(NOW),
  });
  assert.equal(
    evaluateVenuePermission({ ...authorization, permission: "plan.read", clock: clock(LATER) }).status,
    "allow",
  );
  assert.equal(
    evaluateVenuePermission({ ...authorization, permission: "incident.report", clock: clock(LATER) }).reason,
    "delegating-human-insufficient",
  );
  assert.equal(
    evaluateVenuePermission({ ...authorization, permission: "incident.export", clock: clock(LATER) }).reason,
    "delegating-human-insufficient",
  );
});

test("planner denies insufficient roles without changing Plan truth and records sanitized evidence", () => {
  const planner = createVenuePlanner(summitForwardPlan, { projectId: "project-summit-forward" });
  const authorization = { principal: createHumanPrincipal({ id: "viewer-1", roles: ["viewer"] }), clock: clock() };
  const before = structuredClone(planner.getSnapshot());
  assert.throws(
    () =>
      planner.execute(
        {
          type: "preview_revision",
          goal: "secret-layout-intent",
          secret: "never-ledger-this",
          actor: "human",
          idempotencyKey: "viewer-preview",
        },
        { authorization, projectId: "project-summit-forward" },
      ),
    (error) => error.code === "AUTHORIZATION_DENIED" && error.details.permission === "proposal.create",
  );
  const after = planner.getSnapshot();
  assert.deepEqual(after.plan, before.plan);
  assert.deepEqual(after.proposal, before.proposal);
  assert.equal(after.ledger.length, before.ledger.length + 1);
  assert.equal(after.ledger.at(-1).type, "authorization.denied");
  assert.equal(after.ledger.at(-1).details.permission, "proposal.create");
  assert.doesNotMatch(JSON.stringify(after.ledger.at(-1)), /secret-layout-intent|never-ledger-this/);
  assert.equal(verifyActivityLedger(after.ledger).status, "pass");
});

test("Approval policy rejects planners and permits an authenticated approver", () => {
  const planner = createVenuePlanner(summitForwardPlan, { projectId: "project-summit-forward" });
  const plannerAuthorization = {
    principal: createHumanPrincipal({ id: "planner-1", roles: ["planner"] }),
    clock: clock(),
  };
  const approverAuthorization = {
    principal: createHumanPrincipal({ id: "approver-1", roles: ["approver"] }),
    clock: clock(),
  };
  const proposal = planner.getSnapshot().proposal;
  assert.throws(
    () =>
      planner.execute(
        {
          type: "approve_proposal",
          proposalId: proposal.id,
          baseVersion: proposal.baseVersion,
          actor: "human",
          actorId: "planner-1",
          idempotencyKey: "planner-approval",
        },
        { authorization: plannerAuthorization, projectId: "project-summit-forward" },
      ),
    (error) => error.code === "AUTHORIZATION_DENIED" && error.details.permission === "approval.approve",
  );
  const approved = planner.execute(
    {
      type: "approve_proposal",
      proposalId: proposal.id,
      baseVersion: proposal.baseVersion,
      actor: "human",
      actorId: "approver-1",
      idempotencyKey: "approver-approval",
    },
    { authorization: approverAuthorization, projectId: "project-summit-forward" },
  );
  assert.equal(approved.status, "approved");
  assert.equal(planner.getSnapshot().ledger.at(-1).actorId, "approver-1");
});

test("agent proposal scope cannot be converted into Approval authority", () => {
  const planner = createVenuePlanner(summitForwardPlan, { projectId: "project-summit-forward" });
  const authorization = {
    principal: createAgentPrincipal({ id: "agent-1" }),
    grant: grant(["venue:read", "venue:propose"]),
    clock: clock(),
  };
  const preview = planner.execute(
    { type: "preview_revision", goal: "Improve entrance flow", actor: "agent", idempotencyKey: "agent-preview" },
    { authorization, projectId: "project-summit-forward" },
  );
  assert.equal(preview.requiresHumanApproval, true);
  assert.throws(
    () =>
      planner.execute(
        {
          type: "approve_proposal",
          proposalId: preview.proposalId,
          baseVersion: preview.baseVersion,
          actor: "agent",
          idempotencyKey: "agent-approval",
        },
        { authorization, projectId: "project-summit-forward" },
      ),
    (error) => error.code === "AUTHORIZATION_DENIED" && error.details.permission === "approval.approve",
  );
});

test("tool service enforces Agent Grants and filters Project discovery", async () => {
  const authorization = {
    principal: createAgentPrincipal({ id: "agent-1" }),
    grant: grant(["venue:read"]),
    projectId: "project-summit-forward",
    clock: clock(),
  };
  let executed = false;
  const denials = [];
  const service = createVenueToolService({
    executeCommand: async () => {
      executed = true;
    },
    projectOperations: {
      listProjects: async () => ({
        source: "test",
        projects: [{ id: "project-summit-forward" }, { id: "project-secret" }],
      }),
      openProject: async (projectId) => ({ id: projectId }),
    },
    authorization,
    recordAuthorizationDenial: (input) => denials.push(input),
  });
  const projects = await service.execute("venue.list_projects");
  assert.deepEqual(
    projects.projects.map((project) => project.id),
    ["project-summit-forward"],
  );
  await assert.rejects(
    () => service.execute("venue.preview_revision", { goal: "Try", idempotencyKey: "denied-tool" }),
    (error) => error.code === "AUTHORIZATION_DENIED",
  );
  assert.equal(executed, false);
  assert.equal(denials.length, 1);
  await assert.rejects(
    () => service.execute("venue.open_project", { projectId: "project-secret" }),
    (error) => error.code === "AUTHORIZATION_DENIED" && error.details.reason === "agent-grant-project-mismatch",
  );
});
