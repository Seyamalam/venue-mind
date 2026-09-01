const define = (code, message, remediation) => Object.freeze({ code, message, remediation });

export const errorCatalog = Object.freeze({
  COMMAND_INVALID: define("COMMAND_INVALID", "Venue command requires a type.", "Send one published Venue command with its required fields."),
  COMMAND_UNSUPPORTED: define("COMMAND_UNSUPPORTED", "Venue command is not supported.", "Refresh the command contract and use a published command type."),
  IDEMPOTENCY_KEY_REQUIRED: define("IDEMPOTENCY_KEY_REQUIRED", "Idempotency key is required for mutating commands.", "Retry with one stable idempotency key for this semantic action."),
  IDEMPOTENCY_KEY_CONFLICT: define("IDEMPOTENCY_KEY_CONFLICT", "Idempotency key conflict.", "Use the original command input or generate a new idempotency key."),
  SNAPSHOT_INVALID: define("SNAPSHOT_INVALID", "Invalid VenueMind snapshot.", "Restore a canonical Project schema 10 snapshot containing a Plan, Proposal, and Activity Ledger."),
  PROJECT_SCHEMA_UNSUPPORTED: define("PROJECT_SCHEMA_UNSUPPORTED", "Project schema is unsupported.", "Use a Project schema 10 record."),
  ADJUSTMENT_REQUIRED: define("ADJUSTMENT_REQUIRED", "Adjustment instruction is required.", "Provide a concise operational adjustment."),
  PROPOSAL_NOT_REVIEWABLE: define("PROPOSAL_NOT_REVIEWABLE", "Only a Proposal under review can be changed.", "Create or activate a Proposal with review status before changing it."),
  PROPOSAL_MISMATCH: define("PROPOSAL_MISMATCH", "Proposal ID does not match the active Proposal.", "Inspect the active Proposal and retry with its stable ID."),
  PROPOSAL_EMPTY: define("PROPOSAL_EMPTY", "Proposal contains no executable Changes.", "Keep accepted truth unchanged; create a Proposal only after at least one planning Change exists."),
  PLANNING_EFFECT_INVALID: define("PLANNING_EFFECT_INVALID", "Persisted Planning Effect is invalid.", "Restore a snapshot whose active and historical Proposal Changes conform to the published Planning Effect schema."),
  BRANCH_NAME_REQUIRED: define("BRANCH_NAME_REQUIRED", "Proposal Branch name is required.", "Provide a non-empty Branch name."),
  BRANCH_NOT_FOUND: define("BRANCH_NOT_FOUND", "Proposal Branch not found.", "List Proposal Branches and retry with an existing stable Branch ID."),
  REBASE_CONFLICT: define("REBASE_CONFLICT", "Unresolved Proposal conflicts block rebase.", "Resolve blocking conflicts, then retry the rebase."),
  CONFLICT_NOT_FOUND: define("CONFLICT_NOT_FOUND", "Proposal conflict not found.", "Detect current Proposal conflicts and retry with a stable conflict ID."),
  CONFLICT_RESOLUTION_INVALID: define("CONFLICT_RESOLUTION_INVALID", "Conflict resolution is not valid for this conflict.", "Choose one of the conflict's published resolution options."),
  CONFLICT_HUMAN_REQUIRED: define("CONFLICT_HUMAN_REQUIRED", "Only a human can resolve a Proposal conflict.", "Ask an authorized human operator to choose a conflict outcome in VenueMind Studio."),
  LOCK_CONFLICT: define("LOCK_CONFLICT", "Proposal Change conflicts with an active Lock.", "Remove the locked property mutation or have a human release the applicable Project Lock."),
  LOCK_HUMAN_REQUIRED: define("LOCK_HUMAN_REQUIRED", "Only a human can manage Project Locks.", "Ask an authorized human operator to add or release the Project Lock."),
  LOCK_OBJECT_NOT_FOUND: define("LOCK_OBJECT_NOT_FOUND", "Lock target object not found.", "Inspect stable object IDs and retry with an object in the active Plan."),
  LOCK_TYPE_INVALID: define("LOCK_TYPE_INVALID", "Lock type is invalid.", "Use position, rotation, dimension, deletion, or role."),
  LOCK_NOT_FOUND: define("LOCK_NOT_FOUND", "Project Lock not found.", "Inspect Project Locks and retry with an active stable Lock ID."),
  PLAN_VERSION_CONFLICT: define("PLAN_VERSION_CONFLICT", "Plan version conflict.", "Inspect the latest Plan Version and create or rebase the Proposal before retrying."),
  OPERATIONAL_RESOURCE_FRESHNESS_REQUIRED: define("OPERATIONAL_RESOURCE_FRESHNESS_REQUIRED", "Operational resource freshness proof is required.", "Resolve the latest trusted operational-resource snapshot for this Project before approving the Proposal."),
  OPERATIONAL_RESOURCE_STALE: define("OPERATIONAL_RESOURCE_STALE", "Operational resource evidence is stale.", "Refresh operational resources, rebuild the substitution Proposal, and validate it again."),
  VALIDATION_FAILED: define("VALIDATION_FAILED", "Proposal validation failed.", "Resolve every hard Constraint failure and validate again."),
  WARNING_WAIVER_REQUIRED: define("WARNING_WAIVER_REQUIRED", "Proposal has warnings that require a human Warning Waiver.", "Have a human record a reason-coded waiver for every open warning."),
  EMERGENCY_REVIEW_REQUIRED: define("EMERGENCY_REVIEW_REQUIRED", "Emergency Plan Change requires an authorized human Emergency Review.", "Supply a reviewer ID, authorized reviewer role, and explicit assumption acceptance in VenueMind Studio."),
  EMERGENCY_REVIEW_UNAUTHORIZED: define("EMERGENCY_REVIEW_UNAUTHORIZED", "Emergency reviewer role is not authorized.", "Use a reviewer assigned to one of the Emergency Plan's authorized reviewer roles."),
  WAIVER_HUMAN_REQUIRED: define("WAIVER_HUMAN_REQUIRED", "Only a human can create a Warning Waiver.", "Ask an authorized human operator to record the disposition in VenueMind Studio."),
  WAIVER_AUTHOR_REQUIRED: define("WAIVER_AUTHOR_REQUIRED", "Warning Waiver requires an author ID.", "Supply the authenticated or local operator identity."),
  WAIVER_REASON_INVALID: define("WAIVER_REASON_INVALID", "Warning Waiver requires a supported reason code.", "Choose one reason code from the Warning Waiver contract."),
  WARNING_NOT_WAIVABLE: define("WARNING_NOT_WAIVABLE", "Constraint does not have a waivable warning.", "Validate again and select an open warning Constraint."),
  WARNING_ALREADY_WAIVED: define("WARNING_ALREADY_WAIVED", "Warning is already waived.", "Use the existing Warning Waiver or revise the Proposal before recording another disposition."),
  CONSTRAINT_NOT_FOUND: define("CONSTRAINT_NOT_FOUND", "Constraint not found.", "Inspect the Plan and retry with an existing stable Constraint ID."),
  CONSTRAINT_INVALID: define("CONSTRAINT_INVALID", "Constraint metadata is invalid.", "Conform the Constraint to the published schema and retry."),
  CONSTRAINT_DUPLICATE: define("CONSTRAINT_DUPLICATE", "Constraint ID is duplicated.", "Assign a unique stable ID to every Constraint."),
  CONSTRAINT_EVIDENCE_INVALID: define("CONSTRAINT_EVIDENCE_INVALID", "Constraint evidence is invalid.", "Provide numeric evidence and threshold values required by the evaluator."),
  CONSTRAINT_EVALUATOR_UNSUPPORTED: define("CONSTRAINT_EVALUATOR_UNSUPPORTED", "Constraint evaluator is not supported.", "Use an evaluator published in the Venue Constraint schema."),
  GEOMETRY_INVALID: define("GEOMETRY_INVALID", "Spatial geometry is invalid.", "Correct the reported boundary, Footprint, unit, or operational metadata and validate again."),
  SPATIAL_CHANGE_TARGET_MISSING: define("SPATIAL_CHANGE_TARGET_MISSING", "Spatial Change targets a missing object.", "Inspect stable object IDs and rebuild the Change against the active Plan."),
  SPATIAL_CHANGE_TARGET_EXISTS: define("SPATIAL_CHANGE_TARGET_EXISTS", "Spatial Change would reuse an existing object ID.", "Create a new Project-scoped stable object ID and retry the placement."),
  SPATIAL_CHANGE_UNSUPPORTED: define("SPATIAL_CHANGE_UNSUPPORTED", "Spatial Change operation is not supported.", "Use a published spatial Change operation."),
  TEMPLATE_VERSION_NOT_FOUND: define("TEMPLATE_VERSION_NOT_FOUND", "Template version not found.", "List the template catalog and select a published template ID and version."),
  TEMPLATE_SCHEMA_UNSUPPORTED: define("TEMPLATE_SCHEMA_UNSUPPORTED", "Template schema version is not supported.", "Migrate the template document with a published migration path."),
  TEMPLATE_BINDING_NOT_FOUND: define("TEMPLATE_BINDING_NOT_FOUND", "Project is not bound to this template.", "Inspect the Project Template Binding and retry with its Room Template ID."),
  TEMPLATE_VERSION_CURRENT: define("TEMPLATE_VERSION_CURRENT", "Project already uses this template version.", "Select a newer published Room Template version."),
  COMMENT_INVALID: define("COMMENT_INVALID", "Comment metadata is invalid.", "Provide a non-empty comment body, supported status, and published fields."),
  COMMENT_ANCHOR_INVALID: define("COMMENT_ANCHOR_INVALID", "Comment anchor does not resolve to an immutable VenueMind subject.", "Inspect stable Project, Plan Version, Proposal, Change, Constraint, or coordinate identifiers and retry."),
  COMMENT_AUTHOR_REQUIRED: define("COMMENT_AUTHOR_REQUIRED", "Comment action requires an author ID.", "Supply the authenticated or local author identity."),
  COMMENT_NOT_FOUND: define("COMMENT_NOT_FOUND", "Comment not found.", "List comments and retry with an existing stable Comment ID."),
  PROJECT_NOT_FOUND: define("PROJECT_NOT_FOUND", "Project not found.", "List Projects and retry with an existing stable Project ID."),
  PROJECT_TOOL_UNAVAILABLE: define("PROJECT_TOOL_UNAVAILABLE", "Project tools are unavailable in this session.", "Open VenueMind from a Project-aware host and retry the Project operation."),
  OBJECT_NOT_FOUND: define("OBJECT_NOT_FOUND", "Venue object not found.", "Search objects and retry with an existing stable object ID."),
  VALIDATION_NOT_FOUND: define("VALIDATION_NOT_FOUND", "Validation result not found.", "Validate the current Proposal and retry with its Validation ID."),
  SCENARIO_RUN_NOT_FOUND: define("SCENARIO_RUN_NOT_FOUND", "Scenario Run not found.", "List Scenario Runs and retry with an existing stable Run ID."),
  TOOL_SCOPE_REQUIRED: define("TOOL_SCOPE_REQUIRED", "Tool authorization scope is required.", "Grant the published scope for this tool or use a read-only tool within the current session."),
  AUTHORIZATION_DENIED: define("AUTHORIZATION_DENIED", "The current principal is not authorized for this VenueMind action.", "Use an assigned Organization Membership Role or an active Organization- and Project-scoped Agent Grant containing the required permission."),
  AGENT_GRANT_INVALID: define("AGENT_GRANT_INVALID", "Agent Grant is invalid.", "Issue a complete Organization- and Project-scoped grant with published scopes and a lifetime of one hour or less."),
  TOOL_PAYLOAD_TOO_LARGE: define("TOOL_PAYLOAD_TOO_LARGE", "Tool payload exceeds its published size limit.", "Reduce the requested geometry or export payload and retry within the published byte limit."),
  TOOL_CALL_CANCELLED: define("TOOL_CALL_CANCELLED", "Tool call was cancelled.", "Retry only if the caller still needs the operation, using the same idempotency key for an interrupted mutation."),
  LEDGER_INTEGRITY_FAILED: define("LEDGER_INTEGRITY_FAILED", "Activity Ledger integrity failed.", "Restore an untampered snapshot or recover the last verified Project record."),
  RUNBOOK_SCHEDULE_REQUIRED: define("RUNBOOK_SCHEDULE_REQUIRED", "Event Day Runbook requires an accepted canonical schedule.", "Set and approve an Event Brief schedule with canonical start, end, and timezone values."),
  RUNBOOK_DEFINITION_INVALID: define("RUNBOOK_DEFINITION_INVALID", "Event Day Runbook definition is invalid.", "Correct the reported phase, task, owner, dependency, or accepted-source reference."),
  RUNBOOK_TASK_NOT_FOUND: define("RUNBOOK_TASK_NOT_FOUND", "Runbook task not found.", "Inspect the active Runbook Version and retry with a stable task ID."),
  RUNBOOK_TASK_REVISION_CONFLICT: define("RUNBOOK_TASK_REVISION_CONFLICT", "Runbook task revision conflict.", "Refresh the task projection, review the accepted transition, and retry only if another transition is still required."),
  RUNBOOK_TRANSITION_INVALID: define("RUNBOOK_TRANSITION_INVALID", "Runbook task transition is invalid.", "Use a published task transition and supply a reason-coded human reopen for terminal work."),
  RUNBOOK_DEPENDENCIES_INCOMPLETE: define("RUNBOOK_DEPENDENCIES_INCOMPLETE", "Runbook task dependencies are incomplete.", "Complete every dependency before starting this task."),
  RUNBOOK_EVIDENCE_REQUIRED: define("RUNBOOK_EVIDENCE_REQUIRED", "Runbook task evidence is incomplete.", "Attach every required structured evidence code before completing the task."),
  OCCUPANCY_BASELINE_INVALID: define("OCCUPANCY_BASELINE_INVALID", "Live Occupancy baseline is invalid.", "Create the monitor from one active Event Day Runbook with canonical Plan capacity and event-target evidence."),
  OCCUPANCY_SIGNAL_INVALID: define("OCCUPANCY_SIGNAL_INVALID", "Aggregate Occupancy Signal is invalid.", "Send one bounded aggregate-only signal for the check-in total, venue, or a stable Occupancy Zone."),
  OCCUPANCY_PRIVACY_REJECTED: define("OCCUPANCY_PRIVACY_REJECTED", "Occupancy input contains prohibited person-level data.", "Remove identities, contacts, ticket tokens, device identifiers, and individual event records before ingestion."),
  OCCUPANCY_SIGNAL_OUT_OF_ORDER: define("OCCUPANCY_SIGNAL_OUT_OF_ORDER", "Occupancy Signal is older than the accepted source state.", "Refresh the source cursor and send a newer source version and observed instant."),
  OCCUPANCY_REVISION_CONFLICT: define("OCCUPANCY_REVISION_CONFLICT", "Live Occupancy monitor revision conflict.", "Refresh the monitor and retry only if the aggregate transition is still required."),
  VENUE_INTERNAL_ERROR: define("VENUE_INTERNAL_ERROR", "VenueMind could not complete the operation.", "Retry once; if the error persists, inspect the server log with the correlation ID."),
});

export class VenueError extends Error {
  constructor(code, details = {}, message = null) {
    const entry = errorCatalog[code];
    if (!entry) throw new Error(`Unknown VenueMind error code: ${code}`);
    super(message ?? entry.message);
    this.name = "VenueError";
    this.code = code;
    this.remediation = entry.remediation;
    this.details = Object.freeze({ ...details });
  }
}

export const venueError = (code, details = {}, message = null) => new VenueError(code, details, message);

export const errorPayload = (error) => {
  const normalized = error instanceof VenueError ? error : new VenueError("VENUE_INTERNAL_ERROR");
  return { error: { code: normalized.code, message: normalized.message, remediation: normalized.remediation, details: { ...normalized.details } } };
};
