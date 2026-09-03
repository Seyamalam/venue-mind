import { stableFingerprint } from "./activity-ledger.ts";
import { venueError } from "./errors.ts";

export const HUMAN_ROLES = [
  "viewer",
  "planner",
  "reviewer",
  "approver",
  "safety-officer",
  "venue-administrator",
  "organization-administrator",
] as const;

export const AGENT_SCOPES = [
  "venue:read",
  "venue:propose",
  "venue:comment",
  "venue:simulate",
  "venue:operate",
  "venue:export",
] as const;

export const VENUE_PERMISSIONS = [
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
  "incident.read",
  "incident.report",
  "incident.manage",
  "incident.emergency-act",
  "incident.export",
  "export.plan",
  "export.audit",
  "audit.read",
  "approval.approve",
  "approval.waive",
  "lock.manage",
] as const;

export type HumanRole = (typeof HUMAN_ROLES)[number];
export type AgentScope = (typeof AGENT_SCOPES)[number];
export type VenuePermission = (typeof VENUE_PERMISSIONS)[number];
export type PrincipalType = "human" | "agent" | "system";

const viewer: readonly VenuePermission[] = [
  "project.read",
  "plan.read",
  "proposal.read",
  "comment.read",
  "simulation.read",
  "occupancy.read",
  "incident.read",
];
const planner: readonly VenuePermission[] = [
  ...viewer,
  "proposal.create",
  "proposal.manage",
  "comment.write",
  "simulation.run",
  "occupancy.write",
  "incident.report",
  "incident.manage",
  "export.plan",
];
const reviewer: readonly VenuePermission[] = [
  ...viewer,
  "proposal.review",
  "comment.write",
  "incident.export",
  "export.audit",
  "audit.read",
];
const approver: readonly VenuePermission[] = [...reviewer, "approval.approve", "approval.waive"];
const safetyOfficer: readonly VenuePermission[] = [
  ...new Set<VenuePermission>([
    ...viewer,
    "incident.report",
    "incident.manage",
    "incident.emergency-act",
    "incident.export",
    "audit.read",
  ]),
];
const venueAdministrator: readonly VenuePermission[] = [
  ...new Set<VenuePermission>([
    ...planner,
    ...reviewer,
    ...approver,
    "incident.emergency-act",
    "project.manage",
    "plan.update",
    "lock.manage",
  ]),
];

export const HUMAN_ROLE_PERMISSIONS = Object.freeze({
  viewer: Object.freeze(viewer),
  planner: Object.freeze(planner),
  reviewer: Object.freeze(reviewer),
  approver: Object.freeze(approver),
  "safety-officer": Object.freeze(safetyOfficer),
  "venue-administrator": Object.freeze(venueAdministrator),
  "organization-administrator": VENUE_PERMISSIONS,
} satisfies Readonly<Record<HumanRole, readonly VenuePermission[]>>);

export const AGENT_SCOPE_PERMISSIONS = Object.freeze({
  "venue:read": Object.freeze([
    "project.read",
    "plan.read",
    "proposal.read",
    "comment.read",
    "simulation.read",
    "occupancy.read",
    "incident.read",
    "audit.read",
  ]),
  "venue:propose": Object.freeze(["proposal.create", "proposal.manage"]),
  "venue:comment": Object.freeze(["comment.read", "comment.write"]),
  "venue:simulate": Object.freeze(["simulation.read", "simulation.run"]),
  "venue:operate": Object.freeze(["occupancy.read", "occupancy.write", "incident.read", "incident.report"]),
  "venue:export": Object.freeze(["export.plan", "export.audit", "incident.export"]),
} satisfies Readonly<Record<AgentScope, readonly VenuePermission[]>>);

export const DEFAULT_APPROVAL_POLICY = Object.freeze({
  requiredReviewerRoles: Object.freeze(["approver", "venue-administrator", "organization-administrator"]),
});

export const MAX_AGENT_GRANT_TTL_MS = 60 * 60 * 1000;

export interface HumanPrincipal {
  readonly type: "human";
  readonly id: string;
  readonly organizationId: string | null;
  readonly roles: readonly string[];
  readonly operationalRoles: readonly string[];
}

export interface AgentPrincipal {
  readonly type: "agent";
  readonly id: string;
}

export interface SystemPrincipal {
  readonly type: "system";
  readonly id: string;
}

export type VenuePrincipal = HumanPrincipal | AgentPrincipal | SystemPrincipal;

export interface AgentGrant {
  readonly id: string;
  readonly agentId: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly scopes: readonly AgentScope[];
  readonly issuedBy: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

export interface ApprovalPolicy {
  readonly requiredReviewerRoles: readonly string[];
}

export interface PolicyDecision {
  readonly id: string;
  readonly status: "allow" | "deny";
  readonly reason: string;
  readonly permission: string;
  readonly principal: Readonly<{ type: string; id: string }>;
  readonly projectId: string | null;
  readonly organizationId: string | null;
  readonly grantId: string | null;
  readonly evaluatedAt: string;
}

const policyDecisionDetails = (value: PolicyDecision) => ({
  decisionId: value.id,
  status: value.status,
  reason: value.reason,
  permission: value.permission,
  principal: value.principal,
  projectId: value.projectId,
  organizationId: value.organizationId,
  grantId: value.grantId,
  evaluatedAt: value.evaluatedAt,
});

interface PrincipalInput {
  readonly type?: string;
  readonly id?: string;
  readonly organizationId?: string | null;
  readonly roles?: readonly string[];
  readonly operationalRoles?: readonly string[];
}

interface PermissionEvaluationInput {
  readonly permission: string;
  readonly principal: PrincipalInput | null | undefined;
  readonly grant?: AgentGrant | null;
  readonly delegatedBy?: HumanPrincipal | null;
  readonly organizationId?: string | null;
  readonly projectId?: string | null;
  readonly approvalPolicy?: ApprovalPolicy;
  readonly clock?: () => string;
}

interface DecisionInput {
  readonly status: "allow" | "deny";
  readonly reason: string;
  readonly permission: string;
  readonly principal: PrincipalInput | null | undefined;
  readonly organizationId: string | null;
  readonly projectId: string | null;
  readonly grant: AgentGrant | null;
  readonly evaluatedAt: string;
}

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
} satisfies Readonly<Record<string, VenuePermission>>);

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
  "venue.inspect_incidents": "incident.read",
  "venue.report_incident": "incident.report",
  "venue.export_incident_record": "incident.export",
} satisfies Readonly<Record<string, VenuePermission>>);

const hasOwn = <T extends object>(value: T, key: PropertyKey): key is keyof T => Object.hasOwn(value, key);

export const permissionForCommand = (commandType: string | null | undefined): VenuePermission | null =>
  commandType && hasOwn(COMMAND_PERMISSION, commandType) ? COMMAND_PERMISSION[commandType] : null;

export const permissionForTool = (toolName: string, requiredScope: string | null = null): VenuePermission =>
  (hasOwn(TOOL_PERMISSION, toolName) ? TOOL_PERMISSION[toolName] : undefined) ??
  (requiredScope === "venue:propose"
    ? "proposal.manage"
    : requiredScope === "venue:comment"
      ? "comment.write"
      : requiredScope === "venue:simulate"
        ? "simulation.run"
        : requiredScope === "venue:operate"
          ? "occupancy.write"
          : requiredScope === "venue:export"
            ? "export.plan"
            : "plan.read");

const normalizedRoles = (roles: readonly string[] | null | undefined): string[] => [...new Set(roles ?? [])].sort();
const isHumanRole = (role: string): role is HumanRole => HUMAN_ROLES.some((candidate) => candidate === role);
const isAgentScope = (scope: string): scope is AgentScope => AGENT_SCOPES.some((candidate) => candidate === scope);
const isVenuePermission = (permission: string): permission is VenuePermission =>
  VENUE_PERMISSIONS.some((candidate) => candidate === permission);
const normalizedScopes = (scopes: readonly string[] | null | undefined): string[] => [...new Set(scopes ?? [])].sort();

export function createAgentGrant(
  {
    id,
    agentId,
    organizationId,
    projectId,
    scopes,
    issuedBy,
    issuedAt,
    expiresAt,
  }: {
    id: string;
    agentId: string;
    organizationId: string;
    projectId: string;
    scopes: readonly string[];
    issuedBy: string;
    issuedAt?: string;
    expiresAt: string;
  },
  { clock = () => new Date().toISOString() }: { clock?: () => string } = {},
): AgentGrant {
  const normalizedIssuedAt = issuedAt ?? clock();
  const normalizedExpiresAt = expiresAt;
  const issuedMs = Date.parse(normalizedIssuedAt);
  const expiresMs = Date.parse(normalizedExpiresAt);
  const normalizedId = id.trim();
  const normalizedAgentId = agentId.trim();
  const normalizedOrganizationId = organizationId.trim();
  const normalizedProjectId = projectId.trim();
  const normalizedIssuedBy = issuedBy.trim();
  const normalizedGrantScopes = normalizedScopes(scopes);
  if (!normalizedId || !normalizedAgentId || !normalizedOrganizationId || !normalizedProjectId || !normalizedIssuedBy)
    throw venueError("AGENT_GRANT_INVALID", { reason: "missing-stable-identity" });
  if (normalizedGrantScopes.length === 0 || !normalizedGrantScopes.every(isAgentScope))
    throw venueError("AGENT_GRANT_INVALID", { reason: "unsupported-scope" });
  if (
    !Number.isFinite(issuedMs) ||
    !Number.isFinite(expiresMs) ||
    expiresMs <= issuedMs ||
    expiresMs - issuedMs > MAX_AGENT_GRANT_TTL_MS
  )
    throw venueError("AGENT_GRANT_INVALID", { reason: "invalid-lifetime", maximumTtlMs: MAX_AGENT_GRANT_TTL_MS });
  const normalized: AgentGrant = {
    id: normalizedId,
    agentId: normalizedAgentId,
    organizationId: normalizedOrganizationId,
    projectId: normalizedProjectId,
    scopes: normalizedGrantScopes,
    issuedBy: normalizedIssuedBy,
    issuedAt: normalizedIssuedAt,
    expiresAt: normalizedExpiresAt,
  };
  return Object.freeze(normalized);
}

export const createHumanPrincipal = ({
  id,
  organizationId = null,
  roles,
  operationalRoles = [],
}: {
  id: string;
  organizationId?: string | null;
  roles: readonly string[];
  operationalRoles?: readonly string[];
}): HumanPrincipal =>
  Object.freeze({
    type: "human",
    id: id.trim(),
    organizationId: organizationId?.trim() ?? null,
    roles: Object.freeze(normalizedRoles(roles)),
    operationalRoles: Object.freeze(normalizedRoles(operationalRoles)),
  });

export const createAgentPrincipal = ({ id }: { id: string }): AgentPrincipal =>
  Object.freeze({ type: "agent", id: id.trim() });

export function createShortLivedAgentAuthorization({
  agentId,
  organizationId = "org-local",
  projectId,
  scopes = AGENT_SCOPES,
  issuedBy = "local-host",
  delegatedBy = null,
  ttlMs = 15 * 60 * 1000,
  clock = () => new Date().toISOString(),
}: {
  agentId: string;
  organizationId?: string;
  projectId: string;
  scopes?: readonly string[];
  issuedBy?: string;
  delegatedBy?: HumanPrincipal | null;
  ttlMs?: number;
  clock?: () => string;
}) {
  const issuedAt = clock();
  const expiresAt = new Date(Date.parse(issuedAt) + ttlMs).toISOString();
  const principal = createAgentPrincipal({ id: agentId });
  const grant = createAgentGrant({
    id: stableFingerprint("agent-grant", {
      agentId,
      organizationId,
      projectId,
      scopes: normalizedScopes(scopes),
      issuedBy,
      issuedAt,
      expiresAt,
    }),
    agentId,
    organizationId,
    projectId,
    scopes,
    issuedBy,
    issuedAt,
    expiresAt,
  });
  return Object.freeze({ principal, grant, organizationId, projectId, ...(delegatedBy ? { delegatedBy } : {}) });
}

export const TRUSTED_LOCAL_AUTHORIZATION: Readonly<{ principal: SystemPrincipal }> = Object.freeze({
  principal: Object.freeze({ type: "system", id: "trusted-local-system" }),
});

const decision = ({
  status,
  reason,
  permission,
  principal,
  organizationId,
  projectId,
  grant,
  evaluatedAt,
}: DecisionInput): PolicyDecision => {
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

export function evaluateVenuePermission({
  permission,
  principal,
  grant = null,
  delegatedBy = null,
  organizationId = null,
  projectId = null,
  approvalPolicy = DEFAULT_APPROVAL_POLICY,
  clock = () => new Date().toISOString(),
}: PermissionEvaluationInput): PolicyDecision {
  const evaluatedAt = clock();
  if (!isVenuePermission(permission))
    return decision({
      status: "deny",
      reason: "permission-unknown",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });
  if (principal?.type === "system")
    return decision({
      status: "allow",
      reason: "trusted-system-boundary",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });
  if (!principal?.id?.trim())
    return decision({
      status: "deny",
      reason: "principal-invalid",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });

  if (principal.type === "human") {
    const roles = normalizedRoles(principal.roles);
    if (organizationId && principal.organizationId && principal.organizationId !== organizationId)
      return decision({
        status: "deny",
        reason: "human-organization-mismatch",
        permission,
        principal,
        organizationId,
        projectId,
        grant,
        evaluatedAt,
      });
    if (!roles.every(isHumanRole))
      return decision({
        status: "deny",
        reason: "role-unknown",
        permission,
        principal,
        organizationId,
        projectId,
        grant,
        evaluatedAt,
      });
    const permissions = new Set<VenuePermission>(roles.flatMap((role) => HUMAN_ROLE_PERMISSIONS[role]));
    if (!permissions.has(permission))
      return decision({
        status: "deny",
        reason: "human-role-insufficient",
        permission,
        principal,
        organizationId,
        projectId,
        grant,
        evaluatedAt,
      });
    if (permission === "approval.approve" && !roles.some((role) => approvalPolicy.requiredReviewerRoles.includes(role)))
      return decision({
        status: "deny",
        reason: "approval-reviewer-role-required",
        permission,
        principal,
        organizationId,
        projectId,
        grant,
        evaluatedAt,
      });
    return decision({
      status: "allow",
      reason: "human-role",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });
  }

  if (principal.type !== "agent")
    return decision({
      status: "deny",
      reason: "principal-type-unsupported",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });
  if (grant?.agentId !== principal.id)
    return decision({
      status: "deny",
      reason: "agent-grant-required",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });
  const evaluatedMs = Date.parse(evaluatedAt);
  if (evaluatedMs < Date.parse(grant.issuedAt))
    return decision({
      status: "deny",
      reason: "agent-grant-not-active",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });
  if (evaluatedMs >= Date.parse(grant.expiresAt))
    return decision({
      status: "deny",
      reason: "agent-grant-expired",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });
  if (organizationId && grant.organizationId !== organizationId)
    return decision({
      status: "deny",
      reason: "agent-grant-organization-mismatch",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });
  if (projectId && grant.projectId !== projectId)
    return decision({
      status: "deny",
      reason: "agent-grant-project-mismatch",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });
  const permissions = new Set<VenuePermission>(grant.scopes.flatMap((scope) => AGENT_SCOPE_PERMISSIONS[scope]));
  if (!permissions.has(permission))
    return decision({
      status: "deny",
      reason: "agent-scope-insufficient",
      permission,
      principal,
      organizationId,
      projectId,
      grant,
      evaluatedAt,
    });
  if (delegatedBy) {
    const delegatedDecision = evaluateVenuePermission({
      permission,
      principal: delegatedBy,
      organizationId,
      projectId,
      approvalPolicy,
      clock: () => evaluatedAt,
    });
    if (delegatedDecision.status !== "allow")
      return decision({
        status: "deny",
        reason: "delegating-human-insufficient",
        permission,
        principal,
        organizationId,
        projectId,
        grant,
        evaluatedAt,
      });
  }
  return decision({
    status: "allow",
    reason: "agent-grant",
    permission,
    principal,
    organizationId,
    projectId,
    grant,
    evaluatedAt,
  });
}

export function assertVenuePermission(input: PermissionEvaluationInput): PolicyDecision {
  const result = evaluateVenuePermission(input);
  if (result.status === "deny") throw venueError("AUTHORIZATION_DENIED", policyDecisionDetails(result));
  return result;
}

export function assertVenueCommand({
  command,
  ...context
}: Omit<PermissionEvaluationInput, "permission"> & {
  readonly command: { readonly type?: string | undefined; readonly actor?: string | undefined };
}): PolicyDecision {
  const permission = permissionForCommand(command.type);
  if (!permission) throw venueError("COMMAND_UNSUPPORTED", { commandType: command.type ?? null });
  const result = assertVenuePermission({ ...context, permission });
  const actor = command.actor;
  const principalType = context.principal?.type;
  if (actor && principalType && ["human", "agent"].includes(principalType) && actor !== principalType) {
    const mismatchWithoutId: Omit<PolicyDecision, "id"> = {
      status: "deny",
      reason: "actor-principal-mismatch",
      permission: result.permission,
      principal: result.principal,
      projectId: result.projectId,
      organizationId: result.organizationId,
      grantId: result.grantId,
      evaluatedAt: result.evaluatedAt,
    };
    const mismatch: PolicyDecision = {
      ...mismatchWithoutId,
      id: stableFingerprint("policy-decision", mismatchWithoutId),
    };
    throw venueError("AUTHORIZATION_DENIED", policyDecisionDetails(mismatch));
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
    approvalPolicy: {
      type: "object",
      required: ["requiredReviewerRoles"],
      properties: {
        requiredReviewerRoles: { type: "array", minItems: 1, uniqueItems: true, items: { enum: HUMAN_ROLES } },
      },
      additionalProperties: false,
    },
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
