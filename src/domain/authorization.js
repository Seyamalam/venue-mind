import { stableFingerprint } from "./activity-ledger.js";
import { venueError } from "./errors.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

export const HUMAN_ROLES = Object.freeze([
  "viewer",
  "planner",
  "reviewer",
  "approver",
  "venue-administrator",
  "organization-administrator",
]);

export const AGENT_SCOPES = Object.freeze([
  "venue:read",
  "venue:propose",
  "venue:comment",
  "venue:simulate",
  "venue:operate",
  "venue:export",
]);

export const VENUE_PERMISSIONS = Object.freeze([
  "project.read",
  "project.manage",
  "plan.read",
  "plan.update",
  "proposal.read",
  "proposal.create",
  "proposal.manage",
  "proposal.review",
  "comment.read",
  "comment.write",
  "simulation.read",
  "simulation.run",
  "occupancy.read",
  "occupancy.write",
  "export.plan",
  "export.audit",
  "audit.read",
  "approval.approve",
  "approval.waive",
  "lock.manage",
]);

const viewer = ["project.read", "plan.read", "proposal.read", "comment.read", "simulation.read", "occupancy.read"];
const planner = [...viewer, "proposal.create", "proposal.manage", "comment.write", "simulation.run", "occupancy.write", "export.plan"];
const reviewer = [...viewer, "proposal.review", "comment.write", "export.audit", "audit.read"];
const approver = [...reviewer, "approval.approve", "approval.waive"];
const venueAdministrator = [...new Set([...planner, ...reviewer, ...approver, "project.manage", "plan.update", "lock.manage"])] ;

export const HUMAN_ROLE_PERMISSIONS = Object.freeze({
  viewer: Object.freeze(viewer),
  planner: Object.freeze(planner),
  reviewer: Object.freeze(reviewer),
  approver: Object.freeze(approver),
  "venue-administrator": Object.freeze(venueAdministrator),
  "organization-administrator": VENUE_PERMISSIONS,
});

export const AGENT_SCOPE_PERMISSIONS = Object.freeze({
  "venue:read": Object.freeze(["project.read", "plan.read", "proposal.read", "comment.read", "simulation.read", "occupancy.read", "audit.read"]),
  "venue:propose": Object.freeze(["proposal.create", "proposal.manage"]),
  "venue:comment": Object.freeze(["comment.read", "comment.write"]),
  "venue:simulate": Object.freeze(["simulation.read", "simulation.run"]),
  "venue:operate": Object.freeze(["occupancy.read", "occupancy.write"]),
  "venue:export": Object.freeze(["export.plan", "export.audit"]),
});

export const DEFAULT_APPROVAL_POLICY = Object.freeze({
  requiredReviewerRoles: Object.freeze(["approver", "venue-administrator", "organization-administrator"]),
});

export const MAX_AGENT_GRANT_TTL_MS = 60 * 60 * 1000;

const COMMAND_PERMISSION = Object.freeze({
  inspect_layout: "plan.read",
  inspect_templates: "plan.read",
  list_constraints: "plan.read",
  get_validation_evidence: "plan.read",
  get_object: "plan.read",
  search_objects: "plan.read",
  measure_objects: "plan.read",
  validate_layout: "plan.read",
  get_project_brief: "plan.read",
  list_branches: "proposal.read",
  compare_branches: "proposal.read",
  detect_conflicts: "proposal.read",
  list_comments: "comment.read",
  list_scenarios: "simulation.read",
  list_scenario_runs: "simulation.read",
  get_scenario_result: "simulation.read",
  compare_simulations: "simulation.read",
  get_change_log: "audit.read",
  replay_history: "audit.read",
  export_plan: "export.plan",
  export_simulation: "export.plan",
  restore_snapshot: "project.manage",
  update_event_brief: "proposal.manage",
  preview_revision: "proposal.create",
  preview_template_update: "proposal.create",
  apply_edit: "proposal.manage",
  request_adjustment: "proposal.manage",
  revert_change: "proposal.manage",
  create_branch: "proposal.create",
  recover_unsynchronized_branch: "proposal.manage",
  record_share_link_created: "project.manage",
  record_share_link_revoked: "project.manage",
  update_branch_metadata: "proposal.manage",
  duplicate_branch: "proposal.create",
  archive_branch: "proposal.manage",
  restore_branch: "proposal.manage",
  switch_branch: "proposal.manage",
  rebase_proposal: "proposal.manage",
  add_comment: "comment.write",
  edit_comment: "comment.write",
  set_comment_status: "comment.write",
  run_scenario: "simulation.run",
  record_branch_decision: "proposal.review",
  resolve_conflict: "proposal.review",
  approve_proposal: "approval.approve",
  waive_warning: "approval.waive",
  set_object_lock: "lock.manage",
  release_object_lock: "lock.manage",
  undo: "plan.update",
  redo: "plan.update",
});

const TOOL_PERMISSION = Object.freeze({
  "venue.list_projects": "project.read",
  "venue.open_project": "project.read",
  "venue.get_change_log": "audit.read",
  "venue.replay_history": "audit.read",
  "venue.export_audit_package": "export.audit",
  "venue.list_comments": "comment.read",
  "venue.add_comment": "comment.write",
  "venue.edit_comment": "comment.write",
  "venue.set_comment_status": "comment.write",
  "venue.list_scenarios": "simulation.read",
  "venue.list_scenario_runs": "simulation.read",
  "venue.get_scenario_result": "simulation.read",
  "venue.run_scenario": "simulation.run",
  "venue.compare_simulations": "simulation.read",
  "venue.export_simulation": "export.plan",
  "venue.export_plan": "export.plan",
  "venue.inspect_live_occupancy": "occupancy.read",
  "venue.ingest_occupancy_signal": "occupancy.write",
  "venue.refresh_live_occupancy": "occupancy.write",
  "venue.export_live_occupancy": "export.audit",
});

export const permissionForCommand = (commandType) => COMMAND_PERMISSION[commandType] ?? null;

export const permissionForTool = (toolName, requiredScope = null) => TOOL_PERMISSION[toolName]
  ?? (requiredScope === "venue:propose" ? "proposal.manage"
    : requiredScope === "venue:comment" ? "comment.write"
      : requiredScope === "venue:simulate" ? "simulation.run"
        : requiredScope === "venue:operate" ? "occupancy.write"
        : requiredScope === "venue:export" ? "export.plan"
          : "plan.read");

const normalizedRoles = (roles) => [...new Set((roles ?? []).map(String))].sort();
const normalizedScopes = (scopes) => [...new Set((scopes ?? []).map(String))].sort();

export function createAgentGrant({ id, agentId, organizationId, projectId, scopes, issuedBy, issuedAt, expiresAt }, { clock = () => new Date().toISOString() } = {}) {
  const normalizedIssuedAt = issuedAt ?? clock();
  const normalizedExpiresAt = expiresAt;
  const issuedMs = Date.parse(normalizedIssuedAt);
  const expiresMs = Date.parse(normalizedExpiresAt);
  const normalized = {
    id: String(id ?? "").trim(),
    agentId: String(agentId ?? "").trim(),
    organizationId: String(organizationId ?? "").trim(),
    projectId: String(projectId ?? "").trim(),
    scopes: normalizedScopes(scopes),
    issuedBy: String(issuedBy ?? "").trim(),
    issuedAt: normalizedIssuedAt,
    expiresAt: normalizedExpiresAt,
  };
  if (!normalized.id || !normalized.agentId || !normalized.organizationId || !normalized.projectId || !normalized.issuedBy) throw venueError("AGENT_GRANT_INVALID", { reason: "missing-stable-identity" });
  if (normalized.scopes.length === 0 || normalized.scopes.some((scope) => !AGENT_SCOPES.includes(scope))) throw venueError("AGENT_GRANT_INVALID", { reason: "unsupported-scope" });
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs) || expiresMs <= issuedMs || expiresMs - issuedMs > MAX_AGENT_GRANT_TTL_MS) throw venueError("AGENT_GRANT_INVALID", { reason: "invalid-lifetime", maximumTtlMs: MAX_AGENT_GRANT_TTL_MS });
  return Object.freeze(normalized);
}

export const createHumanPrincipal = ({ id, organizationId = null, roles, operationalRoles = [] }) => Object.freeze({
  type: "human",
  id: String(id ?? "").trim(),
  organizationId: organizationId == null ? null : String(organizationId).trim(),
  roles: Object.freeze(normalizedRoles(roles)),
  operationalRoles: Object.freeze(normalizedRoles(operationalRoles)),
});

export const createAgentPrincipal = ({ id }) => Object.freeze({ type: "agent", id: String(id ?? "").trim() });

export function createShortLivedAgentAuthorization({ agentId, organizationId = "org-local", projectId, scopes = AGENT_SCOPES, issuedBy = "local-host", ttlMs = 15 * 60 * 1000, clock = () => new Date().toISOString() }) {
  const issuedAt = clock();
  const expiresAt = new Date(Date.parse(issuedAt) + ttlMs).toISOString();
  const principal = createAgentPrincipal({ id: agentId });
  const grant = createAgentGrant({
    id: stableFingerprint("agent-grant", { agentId, organizationId, projectId, scopes: normalizedScopes(scopes), issuedBy, issuedAt, expiresAt }),
    agentId,
    organizationId,
    projectId,
    scopes,
    issuedBy,
    issuedAt,
    expiresAt,
  });
  return Object.freeze({ principal, grant, organizationId, projectId });
}

export const TRUSTED_LOCAL_AUTHORIZATION = Object.freeze({ principal: Object.freeze({ type: "system", id: "trusted-local-system" }) });

const decision = ({ status, reason, permission, principal, organizationId, projectId, grant, evaluatedAt }) => {
  const result = {
    status,
    reason,
    permission,
    principal: { type: principal?.type ?? "unknown", id: principal?.id ?? "unknown" },
    projectId: projectId ?? null,
    organizationId: organizationId ?? null,
    grantId: grant?.id ?? null,
    evaluatedAt,
  };
  return Object.freeze({ ...result, id: stableFingerprint("policy-decision", result) });
};

export function evaluateVenuePermission({ permission, principal, grant = null, organizationId = null, projectId = null, approvalPolicy = DEFAULT_APPROVAL_POLICY, clock = () => new Date().toISOString() }) {
  const evaluatedAt = clock();
  if (!VENUE_PERMISSIONS.includes(permission)) return decision({ status: "deny", reason: "permission-unknown", permission, principal, organizationId, projectId, grant, evaluatedAt });
  if (principal?.type === "system") return decision({ status: "allow", reason: "trusted-system-boundary", permission, principal, organizationId, projectId, grant, evaluatedAt });
  if (!principal?.id?.trim()) return decision({ status: "deny", reason: "principal-invalid", permission, principal, organizationId, projectId, grant, evaluatedAt });

  if (principal.type === "human") {
    const roles = normalizedRoles(principal.roles);
    if (organizationId && principal.organizationId && principal.organizationId !== organizationId) return decision({ status: "deny", reason: "human-organization-mismatch", permission, principal, organizationId, projectId, grant, evaluatedAt });
    if (roles.some((role) => !HUMAN_ROLES.includes(role))) return decision({ status: "deny", reason: "role-unknown", permission, principal, organizationId, projectId, grant, evaluatedAt });
    const permissions = new Set(roles.flatMap((role) => HUMAN_ROLE_PERMISSIONS[role] ?? []));
    if (!permissions.has(permission)) return decision({ status: "deny", reason: "human-role-insufficient", permission, principal, organizationId, projectId, grant, evaluatedAt });
    if (permission === "approval.approve" && !roles.some((role) => approvalPolicy.requiredReviewerRoles.includes(role))) return decision({ status: "deny", reason: "approval-reviewer-role-required", permission, principal, organizationId, projectId, grant, evaluatedAt });
    return decision({ status: "allow", reason: "human-role", permission, principal, organizationId, projectId, grant, evaluatedAt });
  }

  if (principal.type !== "agent") return decision({ status: "deny", reason: "principal-type-unsupported", permission, principal, organizationId, projectId, grant, evaluatedAt });
  if (!grant || grant.agentId !== principal.id) return decision({ status: "deny", reason: "agent-grant-required", permission, principal, organizationId, projectId, grant, evaluatedAt });
  const evaluatedMs = Date.parse(evaluatedAt);
  if (evaluatedMs < Date.parse(grant.issuedAt)) return decision({ status: "deny", reason: "agent-grant-not-active", permission, principal, organizationId, projectId, grant, evaluatedAt });
  if (evaluatedMs >= Date.parse(grant.expiresAt)) return decision({ status: "deny", reason: "agent-grant-expired", permission, principal, organizationId, projectId, grant, evaluatedAt });
  if (organizationId && grant.organizationId !== organizationId) return decision({ status: "deny", reason: "agent-grant-organization-mismatch", permission, principal, organizationId, projectId, grant, evaluatedAt });
  if (projectId && grant.projectId !== projectId) return decision({ status: "deny", reason: "agent-grant-project-mismatch", permission, principal, organizationId, projectId, grant, evaluatedAt });
  const permissions = new Set(grant.scopes.flatMap((scope) => AGENT_SCOPE_PERMISSIONS[scope] ?? []));
  if (!permissions.has(permission)) return decision({ status: "deny", reason: "agent-scope-insufficient", permission, principal, organizationId, projectId, grant, evaluatedAt });
  return decision({ status: "allow", reason: "agent-grant", permission, principal, organizationId, projectId, grant, evaluatedAt });
}

export function assertVenuePermission(input) {
  const result = evaluateVenuePermission(input);
  if (result.status === "deny") throw venueError("AUTHORIZATION_DENIED", clone(result));
  return result;
}

export function assertVenueCommand({ command, ...context }) {
  const permission = permissionForCommand(command?.type);
  if (!permission) throw venueError("COMMAND_UNSUPPORTED", { commandType: command?.type ?? null });
  const result = assertVenuePermission({ ...context, permission });
  const actor = command?.actor;
  const principalType = context.principal?.type;
  if (actor && ["human", "agent"].includes(principalType) && actor !== principalType) {
    const { id: _priorDecisionId, ...prior } = result;
    const mismatch = { ...prior, status: "deny", reason: "actor-principal-mismatch" };
    mismatch.id = stableFingerprint("policy-decision", mismatch);
    throw venueError("AUTHORIZATION_DENIED", mismatch);
  }
  return result;
}

export const agentGrantSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/agent-grant.schema.json",
  title: "VenueMind Agent Grant",
  type: "object",
  required: ["id", "agentId", "organizationId", "projectId", "scopes", "issuedBy", "issuedAt", "expiresAt"],
  properties: {
    id: { type: "string", minLength: 1 },
    agentId: { type: "string", minLength: 1 },
    organizationId: { type: "string", minLength: 1 },
    projectId: { type: "string", minLength: 1 },
    scopes: { type: "array", minItems: 1, uniqueItems: true, items: { enum: AGENT_SCOPES } },
    issuedBy: { type: "string", minLength: 1 },
    issuedAt: { type: "string", format: "date-time" },
    expiresAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
};

export const authorizationPolicySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/authorization-policy.schema.json",
  title: "VenueMind Authorization Policy",
  type: "object",
  required: ["humanRoles", "agentScopes", "permissions", "rolePermissions", "agentScopePermissions", "approvalPolicy"],
  properties: {
    humanRoles: { type: "array", items: { enum: HUMAN_ROLES }, uniqueItems: true },
    agentScopes: { type: "array", items: { enum: AGENT_SCOPES }, uniqueItems: true },
    permissions: { type: "array", items: { enum: VENUE_PERMISSIONS }, uniqueItems: true },
    rolePermissions: { type: "object" },
    agentScopePermissions: { type: "object" },
    approvalPolicy: { type: "object", required: ["requiredReviewerRoles"], properties: { requiredReviewerRoles: { type: "array", minItems: 1, uniqueItems: true, items: { enum: HUMAN_ROLES } } }, additionalProperties: false },
  },
  additionalProperties: false,
};

export const venueAuthorizationPolicy = Object.freeze({
  humanRoles: HUMAN_ROLES,
  agentScopes: AGENT_SCOPES,
  permissions: VENUE_PERMISSIONS,
  rolePermissions: HUMAN_ROLE_PERMISSIONS,
  agentScopePermissions: AGENT_SCOPE_PERMISSIONS,
  approvalPolicy: DEFAULT_APPROVAL_POLICY,
});
