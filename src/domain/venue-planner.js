import { normalizePlanGeometry } from "./geometry.js";
import { normalizeConstraints, validateConstraints } from "./constraint-engine.js";
import { createActivityEntry, fingerprintEventBrief, fingerprintPlan, normalizeActivityLedger, replayActivityLedger, sealActivityLedger, stableFingerprint, verifyActivityLedger } from "./activity-ledger.js";
import { detectProposalConflicts } from "./proposal-conflicts.js";
import { eventBriefWithCoverage, normalizeEventBrief } from "./event-brief.js";
import { materializeSpatialPlan } from "./spatial-analysis.js";
import { compareProposalBranches } from "./proposal-comparison.js";
import { venueError } from "./errors.js";
import { assertNoLockConflicts, detectLockConflicts, LOCK_TYPES, normalizeProjectLocks } from "./locks.js";
import { applyApprovedTemplateBinding, createRoomTemplateUpdateProposal } from "./template-updates.js";
import { evaluateInventoryAvailability, listVenueTemplates } from "./venue-templates.js";
import { buildEditingChange, measureObjects } from "./editing-commands.js";
import { createComment, editComment, listComments, normalizeComments, setCommentStatus } from "./comments.js";
import { createPlanExport } from "../interchange/plan-exports.js";
import { compareSimulationResults, createScenarioRunner, exportSimulationRun, normalizeScenarioDefinition, scenarioDefinitionFingerprint, scenarioInputFingerprint, SIMULATION_ENGINE_VERSION } from "./scenario-engine.js";
import { assertVenueCommand, TRUSTED_LOCAL_AUTHORIZATION } from "./authorization.js";
import { assertPlanningEffectBinding, materializeEventBrief, normalizeProposalPlanningEffects, planningEvidenceInvalidations } from "./planning-effects.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

const now = () => new Date().toISOString();

const MUTATING_COMMANDS = new Set([
  "preview_revision",
  "request_adjustment",
  "revert_change",
  "create_branch",
  "recover_unsynchronized_branch",
  "record_share_link_created",
  "record_share_link_revoked",
  "switch_branch",
  "approve_proposal",
  "undo",
  "redo",
  "rebase_proposal",
  "resolve_conflict",
  "update_event_brief",
  "waive_warning",
  "set_object_lock",
  "release_object_lock",
  "preview_template_update",
  "apply_edit",
  "update_branch_metadata",
  "duplicate_branch",
  "archive_branch",
  "restore_branch",
  "record_branch_decision",
  "add_comment",
  "edit_comment",
  "set_comment_status",
]);

const commandFingerprint = (command) => {
  const semanticInput = Object.fromEntries(Object.entries(command).filter(([key]) => !["idempotencyKey", "correlationId"].includes(key)));
  return stableFingerprint("command", semanticInput);
};

const publicReceipt = ({ result: _result, ...receipt }) => clone(receipt);

const resultIds = (result) => Object.fromEntries(Object.entries(result ?? {}).filter(([key, value]) => key.endsWith("Id") && typeof value === "string"));

const incrementVersion = (version) => {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${minor + 1}`;
};

const createInitialState = (initialPlan) => {
  const source = clone(initialPlan);
  const { proposal: proposalTemplate, brief: briefTemplate, ...rawPlan } = source;
  const geometryPlan = normalizePlanGeometry(rawPlan);
  const plan = {
    ...geometryPlan,
    emergencyReviews: Array.isArray(geometryPlan.emergencyReviews) ? geometryPlan.emergencyReviews : [],
    constraints: normalizeConstraints(geometryPlan.constraints),
  };
  const proposal = {
    ...proposalTemplate,
    baseVersion: plan.version,
    status: "review",
    validation: null,
    waivers: [],
  };
  const brief = normalizeEventBrief(briefTemplate);
  assertNoLockConflicts(plan, proposal.changes);
  return {
    plan,
    brief,
    proposal,
    activeBranchId: "branch-balanced",
    branches: [{ id: "branch-balanced", name: "Balanced", notes: "", strategy: "balanced", proposal: clone(proposal), revisions: [], archived: false, decisionStatus: null, createdAt: now(), createdBy: "agent" }],
    projectLocks: [],
    comments: [],
    scenarios: [],
    scenarioRuns: [],
    editHistory: { undo: [], redo: [] },
    ledger: sealActivityLedger([createActivityEntry(1, "plan.opened", "human", { planId: plan.id, version: plan.version, beforePlanVersion: plan.version, afterPlanVersion: plan.version, acceptedPlan: clone(plan), planFingerprint: fingerprintPlan(plan), acceptedBrief: clone(brief), briefFingerprint: fingerprintEventBrief(brief) }, { source: "studio", sessionId: "session-initial" })]),
    receipts: [],
  };
};

const SPATIAL_EVALUATORS = new Set(["accessible_route_graph", "turning_clearance", "accessible_seating", "accessible_seating_sightlines", "door_clearance", "temporary_ramp", "occupancy_capacity", "circulation_graph", "sightline_raycast"]);
const ACCESSIBILITY_INFRASTRUCTURE_EVALUATORS = new Set(["accessible_seating_sightlines", "door_clearance", "temporary_ramp"]);
const ROUTE_KINDS = new Set(["accessible_route", "corridor", "aisle", "service_lane"]);
const hasOperationalMetadata = (object) => Boolean(object?.door || object?.exit || object?.route || object?.restriction);

const enrichProposal = (proposal, fallbackProposal) => {
  if (!proposal) return proposal;
  const fallbackChanges = new Map((fallbackProposal?.changes ?? []).map((change) => [change.id, change]));
  return {
    ...proposal,
    waivers: Array.isArray(proposal.waivers) ? proposal.waivers : [],
    changes: proposal.changes.map((change) => {
      const fallback = fallbackChanges.get(change.id);
      if (!fallback) return change;
      return {
        ...fallback,
        ...change,
        targetObjectIds: change.targetObjectIds ?? fallback.targetObjectIds,
        spatialEffects: change.spatialEffects ?? fallback.spatialEffects,
      };
    }),
  };
};

const normalizeLegacyBriefProof = (proof, snapshotBrief, authorization) => {
  if (!proof) throw venueError("LEGACY_BRIEF_ATTESTATION_REQUIRED", { reason: "accepted-brief-proof-missing", briefFingerprint: fingerprintEventBrief(snapshotBrief) });
  const source = proof.source;
  if (source !== "authenticated-human-attestation") throw venueError("LEGACY_BRIEF_ATTESTATION_REQUIRED", { reason: "accepted-brief-proof-source-invalid" });
  const principal = authorization?.principal;
  const allowedRoles = ["venue-administrator", "organization-administrator"];
  if (!proof.attestationId || !proof.actorId || !allowedRoles.includes(proof.actorRole)
    || principal?.type !== "human" || principal.id !== proof.actorId || !principal.roles?.includes(proof.actorRole)) {
    throw venueError("LEGACY_BRIEF_ATTESTATION_REQUIRED", { reason: "accepted-brief-attestation-invalid" });
  }
  const brief = normalizeEventBrief(proof.brief);
  const trustedBriefFingerprint = fingerprintEventBrief(brief);
  const snapshotBriefFingerprint = fingerprintEventBrief(snapshotBrief);
  if (trustedBriefFingerprint !== snapshotBriefFingerprint) throw venueError("LEDGER_INTEGRITY_FAILED", { migration: { status: "fail", reason: "accepted-brief-proof-mismatch", trustedBriefFingerprint, snapshotBriefFingerprint } }, "Legacy Activity Ledger proof does not match the Event Brief under review.");
  return {
    brief,
    fingerprint: trustedBriefFingerprint,
    evidence: {
      source,
      briefFingerprint: trustedBriefFingerprint,
      ...(proof.attestationId ? { attestationId: proof.attestationId } : {}),
      ...(proof.actorId ? { actorId: proof.actorId } : {}),
      ...(proof.actorRole ? { actorRole: proof.actorRole } : {}),
      ...(proof.challengeId ? { challengeId: proof.challengeId } : {}),
      ...(proof.projectRevision !== undefined ? { projectRevision: proof.projectRevision } : {}),
      ...(proof.legacyLedgerHeadHash ? { legacyLedgerHeadHash: proof.legacyLedgerHeadHash } : {}),
      ...(proof.planSha256 ? { planSha256: proof.planSha256 } : {}),
      ...(proof.briefSha256 ? { briefSha256: proof.briefSha256 } : {}),
      ...(proof.reason ? { reason: proof.reason } : {}),
      ...(proof.idempotencyKey ? { idempotencyKey: proof.idempotencyKey } : {}),
    },
  };
};

const normalizeSnapshot = (snapshot, fallbackPlan, fallbackBrief, fallbackProposal, legacyBriefProof = null, authorization = TRUSTED_LOCAL_AUTHORIZATION) => {
  const normalized = clone(snapshot);
  const originalEmergencyObjectIds = new Set((normalized.plan.objects ?? [])
    .filter((object) => ["fire_exit", "assembly_point", "emergency_access_lane", "fire_equipment", "first_aid", "command_post"].includes(object.kind) || object.emergency)
    .map((object) => object.id));
  const migratedEmergencyPlanning = !normalized.plan.emergencyPlan
    || !Array.isArray(normalized.plan.emergencyReviews)
    || (fallbackPlan.objects ?? []).some((object) => (["fire_exit", "assembly_point", "emergency_access_lane", "fire_equipment", "first_aid", "command_post"].includes(object.kind) || object.emergency) && !originalEmergencyObjectIds.has(object.id))
    || !Array.isArray(normalized.plan.constraints)
    || !normalized.plan.constraints.some((constraint) => constraint.evaluator === "emergency_readiness");
  const migratedSimulationFramework = !Array.isArray(normalized.scenarios) || !Array.isArray(normalized.scenarioRuns);
  let migratedSpatialEvidence = false;
  let migratedOperationalGeometry = false;
  const migratedTypedLocks = normalized.plan.objects.some((object) => !Array.isArray(object.locks));
  let migratedAccessibilityInfrastructure = false;
  let migratedAcceptedBriefProof = false;
  let acceptedBriefMigrationProof = null;
  if (normalized.plan.id === fallbackPlan.id && fallbackPlan.constraints.some((constraint) => SPATIAL_EVALUATORS.has(constraint.evaluator))) {
    const fallbackSpatialChangeIds = new Set((fallbackProposal?.changes ?? []).filter((change) => change.spatialEffects?.length).map((change) => change.id));
    const missingSpatialChangeEvidence = (snapshot.proposal?.changes ?? []).some((change) => fallbackSpatialChangeIds.has(change.id) && !change.spatialEffects?.length);
    const existingObjects = new Map(normalized.plan.objects.map((object) => [object.id, object]));
    const mergedObjects = fallbackPlan.objects.map((fallbackObject) => {
      const existing = existingObjects.get(fallbackObject.id);
      if (!existing) {
        if (hasOperationalMetadata(fallbackObject)) migratedOperationalGeometry = true;
        if (!fallbackObject.door && !fallbackObject.exit && !fallbackObject.restriction
          && (fallbackObject.accessibility || fallbackObject.occupancy || fallbackObject.sightline)) migratedSpatialEvidence = true;
        return clone(fallbackObject);
      }
      const specializedRouteKind = existing.kind === "accessible_route" && ROUTE_KINDS.has(fallbackObject.kind) ? fallbackObject.kind : existing.kind;
      const enriched = {
        ...fallbackObject,
        ...existing,
        kind: specializedRouteKind,
        accessibility: existing.accessibility || fallbackObject.accessibility ? { ...(fallbackObject.accessibility ?? {}), ...(existing.accessibility ?? {}) } : undefined,
        occupancy: existing.occupancy ?? fallbackObject.occupancy,
        sightline: existing.sightline ?? fallbackObject.sightline,
        door: existing.door || fallbackObject.door ? { ...(fallbackObject.door ?? {}), ...(existing.door ?? {}), ...(fallbackObject.door?.clearance || existing.door?.clearance ? { clearance: { ...(fallbackObject.door?.clearance ?? {}), ...(existing.door?.clearance ?? {}) } } : {}) } : undefined,
        exit: existing.exit ?? fallbackObject.exit,
        route: existing.route ?? fallbackObject.route,
        restriction: existing.restriction ?? fallbackObject.restriction,
      };
      if ((!existing.accessibility && fallbackObject.accessibility) || (!existing.occupancy && fallbackObject.occupancy) || (!existing.sightline && fallbackObject.sightline)) migratedSpatialEvidence = true;
      if (specializedRouteKind !== existing.kind || (!existing.door && fallbackObject.door) || (!existing.exit && fallbackObject.exit) || (!existing.route && fallbackObject.route) || (!existing.restriction && fallbackObject.restriction)) migratedOperationalGeometry = true;
      if ((fallbackObject.accessibility?.accessibleSeatSampleIds && !existing.accessibility?.accessibleSeatSampleIds)
        || (fallbackObject.door?.clearance && !existing.door?.clearance)
        || (fallbackObject.ramp && !existing.ramp)) migratedAccessibilityInfrastructure = true;
      return enriched;
    });
    const fallbackIds = new Set(fallbackPlan.objects.map((object) => object.id));
    normalized.plan.objects = [...mergedObjects, ...normalized.plan.objects.filter((object) => !fallbackIds.has(object.id))];
    normalized.plan.occupancy = { ...fallbackPlan.occupancy, ...normalized.plan.occupancy };
    normalized.plan.accessibilityPolicy = { ...fallbackPlan.accessibilityPolicy, ...normalized.plan.accessibilityPolicy };
    normalized.plan.emergencyPlan = { ...fallbackPlan.emergencyPlan, ...normalized.plan.emergencyPlan };
    normalized.plan.emergencyReviews = Array.isArray(normalized.plan.emergencyReviews) ? normalized.plan.emergencyReviews : [];

    const existingConstraints = new Map(normalizeConstraints(normalized.plan.constraints, fallbackPlan.constraints).map((constraint) => [constraint.id, constraint]));
    normalized.plan.constraints = fallbackPlan.constraints.map((fallbackConstraint) => {
      const existing = existingConstraints.get(fallbackConstraint.id);
      if (!existing) {
        if (ACCESSIBILITY_INFRASTRUCTURE_EVALUATORS.has(fallbackConstraint.evaluator)) migratedAccessibilityInfrastructure = true;
        else migratedSpatialEvidence = true;
        return clone(fallbackConstraint);
      }
      if (SPATIAL_EVALUATORS.has(fallbackConstraint.evaluator) && existing.evaluator !== fallbackConstraint.evaluator) {
        migratedSpatialEvidence = true;
        const migrated = clone(fallbackConstraint);
        if (existing.enabled !== undefined) migrated.enabled = existing.enabled;
        return migrated;
      }
      return existing;
    });
    const fallbackConstraintIds = new Set(fallbackPlan.constraints.map((constraint) => constraint.id));
    normalized.plan.constraints.push(...[...existingConstraints.values()].filter((constraint) => !fallbackConstraintIds.has(constraint.id)));
    normalized.proposal = enrichProposal(normalized.proposal, fallbackProposal);
    normalized.branches = (normalized.branches ?? []).map((branch) => ({ ...branch, proposal: enrichProposal(branch.proposal, fallbackProposal) }));
    if ((normalized.proposal.changes ?? []).some((change) => change.spatialEffects?.length)) migratedSpatialEvidence = migratedSpatialEvidence || missingSpatialChangeEvidence;
  }
  normalized.plan = normalizePlanGeometry(normalized.plan, fallbackPlan);
  normalized.plan.emergencyReviews = Array.isArray(normalized.plan.emergencyReviews) ? normalized.plan.emergencyReviews : [];
  normalized.plan.constraints = normalizeConstraints(normalized.plan.constraints, fallbackPlan.constraints);
  // Snapshots and ledger payloads share the JSON-safe project contract. Remove
  // optional properties introduced as `undefined` during enrichment before the
  // accepted Plan is fingerprinted and sealed into migration history.
  normalized.plan = clone(normalized.plan);
  normalized.brief = normalizeEventBrief(normalized.brief, fallbackBrief);
  if (!Array.isArray(normalized.branches) || normalized.branches.length === 0) {
    normalized.activeBranchId = "branch-balanced";
    normalized.branches = [{ id: "branch-balanced", name: "Balanced", notes: "", strategy: "balanced", proposal: clone(normalized.proposal), revisions: [], archived: false, decisionStatus: null, createdAt: now(), createdBy: "system" }];
  }
  normalized.branches = normalized.branches.map((branch) => ({
    ...branch,
    notes: typeof branch.notes === "string" ? branch.notes : "",
    revisions: Array.isArray(branch.revisions) ? branch.revisions : [],
    archived: branch.archived === true,
    decisionStatus: branch.decisionStatus ?? null,
  }));
  try {
    normalized.proposal = normalizeProposalPlanningEffects(normalized.proposal, "proposal");
    normalized.branches = normalized.branches.map((branch, branchIndex) => ({
      ...branch,
      proposal: normalizeProposalPlanningEffects(branch.proposal, `branches[${branchIndex}].proposal`),
      revisions: branch.revisions.map((proposal, revisionIndex) => normalizeProposalPlanningEffects(proposal, `branches[${branchIndex}].revisions[${revisionIndex}]`)),
    }));
  } catch (error) {
    throw venueError("PLANNING_EFFECT_INVALID", { cause: error.message }, "Persisted Planning Effect failed canonical normalization.");
  }
  const proposals = [normalized.proposal, ...normalized.branches.flatMap((branch) => [branch.proposal, ...branch.revisions])];
  for (const proposal of proposals) for (const change of proposal.changes) for (const effect of change.planningEffects ?? []) {
    if (!effect.source?.adapterId) continue;
    try {
      assertPlanningEffectBinding(effect, { brief: normalized.brief, constraints: normalized.plan.constraints });
    } catch (error) {
      throw venueError("PLANNING_EFFECT_INVALID", { operation: effect.operation, targetBriefId: effect.targetBriefId, targetRequirementId: effect.targetRequirementId }, "Persisted adapter Planning Effect is not bound to the server-owned Brief and Constraint registry.");
    }
  }
  if (!Array.isArray(normalized.receipts)) normalized.receipts = [];
  normalized.comments = normalizeComments(normalized.comments ?? []);
  normalized.scenarios = Array.isArray(normalized.scenarios) ? normalized.scenarios.map(normalizeScenarioDefinition) : [];
  normalized.scenarioRuns = Array.isArray(normalized.scenarioRuns) ? normalized.scenarioRuns.map((run) => {
    const scenario = run.scenarioSnapshot ? normalizeScenarioDefinition(run.scenarioSnapshot) : normalized.scenarios.find((item) => item.id === run.scenarioId) ?? null;
    const scenarioFingerprint = run.scenarioFingerprint ?? (scenario ? scenarioDefinitionFingerprint(scenario) : null);
    const normalizeHistoricalResult = (result) => result ? { model: result.model ?? scenario?.model ?? "operations", scenarioFingerprint: result.scenarioFingerprint ?? scenarioFingerprint, ...result } : null;
    return {
      ...run,
      model: run.model ?? scenario?.model ?? "operations",
      scenarioFingerprint,
      ...(scenario ? { scenarioSnapshot: scenario } : {}),
      partialResult: normalizeHistoricalResult(run.partialResult),
      result: normalizeHistoricalResult(run.result),
    };
  }) : [];
  if (!normalized.editHistory || !Array.isArray(normalized.editHistory.undo) || !Array.isArray(normalized.editHistory.redo)) normalized.editHistory = { undo: [], redo: [] };
  normalized.projectLocks = normalizeProjectLocks(normalized.projectLocks ?? [], normalized.plan);
  const legacyLedger = normalized.ledger.every((entry) => !entry.hash && !entry.previousHash && !entry.schemaVersion);
  if (legacyLedger) {
    const proof = normalizeLegacyBriefProof(legacyBriefProof, normalized.brief, authorization);
    normalized.ledger = normalized.ledger.map((entry) => {
      const version = entry.details?.acceptedPlan?.version ?? entry.details?.toVersion ?? entry.details?.version;
      const acceptedPlan = entry.details?.acceptedPlan ?? (version === fallbackPlan.version ? fallbackPlan : version === normalized.plan.version ? normalized.plan : null);
      return acceptedPlan ? { ...entry, details: { ...entry.details, acceptedPlan: clone(acceptedPlan), planFingerprint: fingerprintPlan(acceptedPlan) } } : entry;
    });
    acceptedBriefMigrationProof = proof.evidence;
    migratedAcceptedBriefProof = true;
  } else if (normalized.ledger.every((entry) => !entry.details?.acceptedBrief && !entry.details?.briefFingerprint)) {
    const integrity = verifyActivityLedger(normalized.ledger);
    if (integrity.status !== "pass") throw venueError("LEDGER_INTEGRITY_FAILED", { integrity });
    acceptedBriefMigrationProof = normalizeLegacyBriefProof(legacyBriefProof, normalized.brief, authorization).evidence;
    migratedAcceptedBriefProof = true;
  }
  normalized.ledger = normalizeActivityLedger(normalized.ledger);
  const evidencedProjectLockIds = new Set(normalized.projectLocks.filter((lock) => normalized.ledger.some((entry) => entry.type === "object.lock_added"
    && entry.details?.lockId === lock.id
    && entry.details?.objectId === lock.objectId
    && entry.details?.lockType === lock.type
    && entry.details?.source === lock.source
    && entry.details?.reasonCode === lock.reasonCode
    && entry.details?.authorId === lock.authorId)).map((lock) => lock.id));
  const assertProposalLocks = (proposal) => {
    const conflicts = detectLockConflicts(normalized.plan, proposal.changes, normalized.projectLocks)
      .filter((conflict) => conflict.source !== "project" || !evidencedProjectLockIds.has(conflict.lockId));
    if (conflicts.length) throw venueError("LOCK_CONFLICT", { conflicts, objectIds: [...new Set(conflicts.map((conflict) => conflict.objectId))] });
  };
  assertProposalLocks(normalized.proposal);
  for (const branch of normalized.branches) assertProposalLocks(branch.proposal);
  const migrations = [
    ...(migratedSpatialEvidence ? [{ id: "project-schema-v5-to-v6-spatial-evidence", fromModel: "metric-summary", toModel: "canonical-spatial-evidence" }] : []),
    ...(migratedOperationalGeometry ? [{ id: "project-schema-v6-to-v7-operational-geometry", fromModel: "generic-spatial-objects", toModel: "typed-operational-geometry" }] : []),
    ...(migratedTypedLocks ? [{ id: "project-schema-v7-to-v8-typed-locks", fromModel: "boolean-object-locks", toModel: "typed-property-locks" }] : []),
    ...(migratedAccessibilityInfrastructure ? [{ id: "project-schema-v8-to-v9-accessibility-infrastructure", fromModel: "basic-accessibility-evidence", toModel: "accessible-sightlines-door-clearance-and-ramps" }] : []),
    ...(migratedSimulationFramework ? [{ id: "project-schema-v9-to-v10-simulation-framework", fromModel: "no-simulation-state", toModel: "versioned-scenarios-and-runs" }] : []),
    ...(migratedEmergencyPlanning ? [{ id: "project-schema-v10-emergency-planning", fromModel: "basic-egress-evidence", toModel: "reviewed-emergency-planning" }] : []),
    ...(migratedAcceptedBriefProof ? [{ id: "activity-ledger-v1-accepted-brief-proof", fromModel: "plan-only-accepted-truth", toModel: "plan-and-brief-accepted-truth" }] : []),
  ];
  for (const migration of migrations) {
    const briefProofMigration = migration.id === "activity-ledger-v1-accepted-brief-proof";
    const humanAttestation = briefProofMigration && acceptedBriefMigrationProof?.source === "authenticated-human-attestation";
    normalized.ledger = sealActivityLedger([...normalized.ledger, createActivityEntry(normalized.ledger.length + 1, "schema.migrated", humanAttestation ? "human" : "system", {
      migrationId: migration.id,
      fromModel: migration.fromModel,
      toModel: migration.toModel,
      planId: normalized.plan.id,
      version: normalized.plan.version,
      acceptedPlan: clone(normalized.plan),
      planFingerprint: fingerprintPlan(normalized.plan),
      acceptedBrief: clone(normalized.brief),
      briefFingerprint: fingerprintEventBrief(normalized.brief),
      ...(briefProofMigration ? { briefMigrationProof: clone(acceptedBriefMigrationProof) } : {}),
    }, { actorId: humanAttestation ? acceptedBriefMigrationProof.actorId : "system", actorType: humanAttestation ? "human" : "system", source: humanAttestation ? "studio" : "system", sessionId: humanAttestation ? `legacy-brief-${acceptedBriefMigrationProof.attestationId}` : "schema-migration" })]);
  }
  const replay = replayActivityLedger(normalized.ledger, normalized.plan, normalized.brief);
  if (replay.status !== "pass") throw venueError("LEDGER_INTEGRITY_FAILED", { replay }, "Activity Ledger does not reproduce accepted Plan and Event Brief truth.");
  return normalized;
};

const syncActiveBranch = (state, proposal) => ({
  ...state,
  proposal,
  branches: state.branches.map((branch) => {
    if (branch.id !== state.activeBranchId) return branch;
    const revisions = [...(branch.revisions ?? [])];
    if (branch.proposal?.id !== proposal.id && !revisions.some((revision) => revision.id === branch.proposal?.id)) revisions.push(clone(branch.proposal));
    return { ...branch, proposal: clone(proposal), revisions };
  }),
});

export const validateVenueState = (state) => {
  const changes = state.proposal?.status === "review" ? state.proposal.changes : [];
  const candidateBrief = materializeEventBrief(state.brief, changes);
  const invalidations = planningEvidenceInvalidations(changes);
  const knownConstraintIds = new Set(state.plan.constraints.map((constraint) => constraint.id));
  const unknownConstraintIds = invalidations.affectedConstraintIds.filter((id) => !knownConstraintIds.has(id));
  if (unknownConstraintIds.length) throw venueError("CONSTRAINT_NOT_FOUND", { constraintIds: unknownConstraintIds });
  const validation = validateConstraints({ ...state, brief: candidateBrief });
  const inventoryAvailability = evaluateInventoryAvailability(materializeSpatialPlan(state.plan, state.proposal?.changes ?? [], { projectLocks: state.projectLocks, allowLockConflicts: true }));
  return { ...validation, planningEvidenceInvalidations: invalidations, inventoryAvailability, inventoryWarnings: inventoryAvailability.filter((item) => item.status === "warning").length };
};

const candidateBriefFor = (state) => materializeEventBrief(state.brief, state.proposal?.status === "review" ? state.proposal.changes : []);

const inspection = (state) => ({
  planId: state.plan.id,
  planVersion: state.plan.version,
  event: clone(state.plan.event),
  venue: clone(state.plan.venue),
  templateBindings: clone(state.plan.templateBindings ?? {}),
  inventoryAvailability: evaluateInventoryAvailability(state.plan),
  occupancy: clone(state.plan.occupancy ?? {}),
  staffing: clone(state.plan.staffing ?? null),
  productionPolicy: clone(state.plan.productionPolicy ?? null),
  cateringPolicy: clone(state.plan.cateringPolicy ?? null),
  emergencyPlan: clone(state.plan.emergencyPlan ?? null),
  emergencyReviews: clone(state.plan.emergencyReviews ?? []),
  spatial: clone(state.plan.spatial),
  spatialObjects: state.plan.objects.map(({ id, kind, label, layer, elevationM, footprint, locked, locks, door, exit, route, restriction, ramp, capacity, occupancy, placement, circulation, queue, staffPost, utility, rigging, productionZone, production, catering, emergency, templateRef, resourceBinding, templateOverrides, inventoryCount }) => ({ id, kind, label, layer, elevationM, footprint: clone(footprint), locked, locks: clone([...(locks ?? []), ...state.projectLocks.filter((lock) => lock.objectId === id)]), ...(templateRef ? { templateRef: clone(templateRef), templateOverrides: clone(templateOverrides ?? []) } : {}), ...(resourceBinding ? { resourceBinding: clone(resourceBinding) } : {}), ...(Number.isInteger(inventoryCount) ? { inventoryCount } : {}), ...(Number.isInteger(capacity) ? { capacity } : {}), ...(occupancy ? { occupancy: clone(occupancy) } : {}), ...(placement ? { placement: clone(placement) } : {}), ...(circulation ? { circulation: clone(circulation) } : {}), ...(queue ? { queue: clone(queue) } : {}), ...(staffPost ? { staffPost: clone(staffPost) } : {}), ...(production ? { production: clone(production) } : {}), ...(catering ? { catering: clone(catering) } : {}), ...(emergency ? { emergency: clone(emergency) } : {}), operational: clone({ ...(door ? { door } : {}), ...(exit ? { exit } : {}), ...(route ? { route } : {}), ...(restriction ? { restriction } : {}), ...(ramp ? { ramp } : {}), ...(utility ? { utility } : {}), ...(rigging ? { rigging } : {}), ...(productionZone ? { productionZone } : {}) }) })),
  lockedObjects: state.plan.objects.map((object) => ({ ...object, effectiveLocks: [...(object.locks ?? []), ...state.projectLocks.filter((lock) => lock.objectId === object.id)].filter((lock) => lock.active) })).filter((object) => object.effectiveLocks.length).map(({ id, kind, label, effectiveLocks }) => ({ id, kind, label, locks: clone(effectiveLocks) })),
  projectLocks: clone(state.projectLocks),
  comments: clone(state.comments),
  scenarios: clone(state.scenarios),
  scenarioRuns: clone(state.scenarioRuns.map(({ partialResult: _partialResult, result: _result, ...run }) => run)),
  constraints: clone(state.plan.constraints),
  metrics: clone(state.plan.metrics),
  proposal: state.proposal ? {
    id: state.proposal.id,
    baseVersion: state.proposal.baseVersion,
    revision: state.proposal.revision,
    status: state.proposal.status,
    goal: state.proposal.goal,
    changedItems: state.proposal.changes.length,
    templateUpdate: clone(state.proposal.templateUpdate ?? null),
  } : null,
  activeBranchId: state.activeBranchId,
  proposalBranches: state.branches.map((branch) => ({ id: branch.id, name: branch.name, strategy: branch.strategy, proposalId: branch.proposal.id })),
  commandReceiptCount: state.receipts.length,
  ledgerIntegrity: verifyActivityLedger(state.ledger),
  brief: eventBriefWithCoverage(candidateBriefFor(state), validateVenueState(state), validateVenueState({ ...state, proposal: null })),
});

const formatExport = (state) => {
  const validation = validateVenueState(state);
  const { accessibility, capacity, circulation, sightlines } = validation.spatialEvidence;
  return [
    `VenueMind · ${state.plan.event.name}`,
    `Plan v${state.plan.version}`,
    `Status ${validation.status.toUpperCase()}`,
    `Capacity ${validation.candidateMetrics.attendeeCapacity}`,
    `Accessible route ${accessibility.minimumClearWidthM} m`,
    `Sightlines ${Math.round(sightlines.coverageRatio * 100)}%`,
    `Geometry ${validation.candidateGeometryFingerprint}`,
    `Access graph ${accessibility.graphFingerprint} · ${accessibility.reachableDestinationIds.length} destinations · ${accessibility.minimumClearWidthM} m`,
    `Occupancy ${capacity.effectiveCapacity} effective · ${capacity.operationalLoad}/${capacity.venueMaximum} load`,
    `Capacity scopes ${capacity.sectionCapacities.length} sections · ${capacity.zoneCapacities.length} zones · ${capacity.explanations.length} exceptions`,
    `Egress ${circulation.shortestExitPaths.length} paths · bottleneck ${circulation.bottleneckWidthM} m · index ${circulation.peakCongestionIndex}`,
    `Sightline evidence ${sightlines.evidenceFingerprint} · ${sightlines.sampledSeatIds.length - sightlines.blockedSampleIds.length}/${sightlines.sampledSeatIds.length} clear`,
    `Ledger entries ${state.ledger.length}`,
  ].join("\n");
};

export function createVenuePlanner(initialPlan, { authorization: defaultAuthorization = TRUSTED_LOCAL_AUTHORIZATION, projectId = null, approvalPolicy, adapterPlanningBindings = {}, legacyBriefProof = null } = {}) {
  const durableInitialPlan = Object.keys(adapterPlanningBindings).length && initialPlan?.brief?.planningEffectBindings === undefined
    ? { ...clone(initialPlan), brief: { ...clone(initialPlan.brief), planningEffectBindings: clone(adapterPlanningBindings) } }
    : initialPlan;
  const initialState = createInitialState(durableInitialPlan);
  const fallbackPlan = clone(initialState.plan);
  const fallbackBrief = clone(initialState.brief);
  const fallbackProposal = clone(initialState.proposal);
  let state = initialState;
  let undoStack = [];
  let redoStack = [];
  const listeners = new Set();
  let transaction = null;
  const scenarioRunner = createScenarioRunner();
  const pendingScenarioCommands = new Map();

  const simulationBasisFingerprint = (value) => stableFingerprint("simulation-basis", {
    planVersion: value.plan.version,
    planGeometry: value.plan.spatial.fingerprint,
    proposalId: value.proposal?.id ?? null,
    proposalChanges: value.proposal?.changes ?? [],
  });

  const getSnapshot = () => state;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const publish = (nextState) => {
    if (transaction) {
      transaction.nextState = nextState;
      return;
    }
    if (scenarioRunner.getActive() && simulationBasisFingerprint(state) !== simulationBasisFingerprint(nextState)) scenarioRunner.cancelActive("proposal-changed");
    state = nextState;
    listeners.forEach((listener) => listener());
  };
  const appendLedger = (current, type, actor, details) => [
    ...current.ledger,
    createActivityEntry(current.ledger.length + 1, type, actor, details),
  ];

  const recordAuthorizationDenial = ({ error, actionType, source, sessionId }) => {
    if (error?.code !== "AUTHORIZATION_DENIED") return null;
    const denied = error.details;
    const deniedActorType = ["human", "agent"].includes(denied.principal?.type) ? denied.principal.type : "system";
    const deniedSource = ["studio", "webmcp", "mcp", "system", "agent-tool"].includes(source) ? source : deniedActorType === "agent" ? "agent-tool" : deniedActorType === "human" ? "studio" : "system";
    const entry = createActivityEntry(state.ledger.length + 1, "authorization.denied", deniedActorType, {
        policyDecisionId: denied.id,
        permission: denied.permission,
        reason: denied.reason,
        actionType,
        projectId: denied.projectId,
        grantId: denied.grantId,
        beforePlanVersion: state.plan.version,
        afterPlanVersion: state.plan.version,
      }, {
        actorId: denied.principal?.id ?? "unknown",
        actorType: deniedActorType,
        source: deniedSource,
        sessionId: sessionId ?? "session-unknown",
      });
    publish({ ...state, ledger: sealActivityLedger([...state.ledger, entry]) });
    return entry.id;
  };

  const authorize = (command, options = {}) => {
    const authorization = options.authorization ?? defaultAuthorization;
    try {
      return assertVenueCommand({
        command,
        ...authorization,
        projectId: options.projectId ?? authorization?.projectId ?? projectId,
        approvalPolicy: authorization?.approvalPolicy ?? approvalPolicy,
      });
    } catch (error) {
      if (error?.code !== "AUTHORIZATION_DENIED") throw error;
      recordAuthorizationDenial({ error, actionType: command.type, source: command.source, sessionId: command.sessionId });
      throw error;
    }
  };

  const executeCommand = (command, authorizationContext = defaultAuthorization) => {
    if (!command || typeof command.type !== "string") throw venueError("COMMAND_INVALID");

    if (command.type === "inspect_layout") return inspection(state);
    if (command.type === "inspect_templates") return listVenueTemplates();
    if (command.type === "list_constraints") {
      const validation = validateVenueState(state);
      const checks = new Map(validation.checks.map((check) => [check.constraintId, check]));
      return state.plan.constraints
        .filter((constraint) => !command.category || constraint.category === command.category)
        .filter((constraint) => !command.severity || constraint.severity === command.severity)
        .map((constraint) => ({ ...clone(constraint), evaluation: checks.has(constraint.id) ? clone({ status: checks.get(constraint.id).status, actual: checks.get(constraint.id).actual, threshold: checks.get(constraint.id).threshold, unit: checks.get(constraint.id).unit, waiver: checks.get(constraint.id).waiver ?? null }) : null }));
    }
    if (command.type === "get_validation_evidence") {
      const validation = validateVenueState(state);
      if (command.validationId && command.validationId !== validation.validationId) throw venueError("VALIDATION_NOT_FOUND", { validationId: command.validationId, currentValidationId: validation.validationId });
      const constraintIds = new Set(command.constraintIds ?? []);
      const checks = validation.checks.filter((check) => !constraintIds.size || constraintIds.has(check.constraintId));
      const evidenceFingerprint = stableFingerprint("validation-evidence", { inputFingerprint: validation.inputFingerprint, constraintIds: checks.map((check) => check.constraintId), checks });
      return {
        validationId: validation.validationId,
        inputFingerprint: validation.inputFingerprint,
        engineVersion: validation.engineVersion,
        evaluatedPlanVersion: validation.evaluatedPlanVersion,
        evaluatedProposalId: validation.evaluatedProposalId,
        status: validation.status,
        unresolvedIssues: validation.unresolvedIssues,
        candidateGeometryFingerprint: validation.candidateGeometryFingerprint,
        evidenceFingerprint,
        checks: clone(checks),
        ...(command.includeSpatialEvidence === false ? {} : { spatialEvidence: clone(validation.spatialEvidence) }),
        productionEvidence: clone(validation.productionEvidence),
        cateringEvidence: clone(validation.cateringEvidence),
        emergencyEvidence: clone(validation.emergencyEvidence),
        evidenceFamilyFingerprints: clone(validation.evidenceFamilyFingerprints),
        planningEvidenceInvalidations: clone(validation.planningEvidenceInvalidations),
      };
    }
    if (command.type === "get_object" || command.type === "search_objects") {
      const scope = command.scope ?? "proposal";
      const plan = scope === "accepted" ? state.plan : materializeSpatialPlan(state.plan, state.proposal?.changes ?? [], { projectLocks: state.projectLocks, allowLockConflicts: true });
      const effectiveLocks = (object) => [...(object.locks ?? []), ...state.projectLocks.filter((lock) => lock.objectId === object.id)].filter((lock) => lock.active);
      if (command.type === "get_object") {
        const object = plan.objects.find((item) => item.id === command.objectId);
        if (!object) throw venueError("OBJECT_NOT_FOUND", { objectId: command.objectId, scope });
        return { scope, planId: plan.id, planVersion: plan.version, proposalId: scope === "proposal" ? state.proposal?.id ?? null : null, object: { ...clone(object), effectiveLocks: clone(effectiveLocks(object)) } };
      }
      const query = command.query?.trim().toLowerCase() ?? "";
      const kinds = new Set(command.kinds ?? []);
      const layers = new Set(command.layers ?? []);
      const limit = Math.min(50, Math.max(1, command.limit ?? 20));
      const matches = plan.objects.filter((object) => {
        if (query && ![object.id, object.label, object.kind].some((value) => value?.toLowerCase().includes(query))) return false;
        if (kinds.size && !kinds.has(object.kind)) return false;
        if (layers.size && !layers.has(object.layer)) return false;
        if (command.locked !== undefined && (effectiveLocks(object).length > 0) !== command.locked) return false;
        return true;
      }).sort((left, right) => left.id.localeCompare(right.id));
      return {
        scope,
        planId: plan.id,
        planVersion: plan.version,
        proposalId: scope === "proposal" ? state.proposal?.id ?? null : null,
        total: matches.length,
        limit,
        truncated: matches.length > limit,
        objects: matches.slice(0, limit).map((object) => ({ id: object.id, label: object.label, kind: object.kind, layer: object.layer, elevationM: object.elevationM, footprint: clone(object.footprint), locked: effectiveLocks(object).length > 0, lockIds: effectiveLocks(object).map((lock) => lock.id) })),
      };
    }
    if (command.type === "measure_objects") return measureObjects(materializeSpatialPlan(state.plan, state.proposal?.changes ?? [], { projectLocks: state.projectLocks, allowLockConflicts: true }), command.objectIds);
    if (command.type === "list_comments") return listComments(state, command.filters);
    if (command.type === "list_scenarios") return clone(state.scenarios);
    if (command.type === "list_scenario_runs") return clone(state.scenarioRuns);
    if (command.type === "get_scenario_result") {
      const run = state.scenarioRuns.find((item) => item.id === command.runId);
      if (!run) throw venueError("SCENARIO_RUN_NOT_FOUND", { runId: command.runId });
      const result = clone(run.result ?? run.partialResult);
      if (result && command.includeDensityFrames !== true) delete result.densityFrames;
      return { id: run.id, scenarioId: run.scenarioId, scenarioFingerprint: run.scenarioFingerprint, model: run.model, branchId: run.branchId, planId: run.planId, planVersion: run.planVersion, geometryFingerprint: run.geometryFingerprint, inputFingerprint: run.inputFingerprint, engineVersion: run.engineVersion, status: run.status, progress: run.progress, completedPhaseIds: clone(run.completedPhaseIds), startedAt: run.startedAt, completedAt: run.completedAt, cancellationReason: run.cancellationReason, cacheHit: run.cacheHit ?? false, result };
    }
    if (command.type === "compare_simulations") {
      const left = state.scenarioRuns.find((run) => run.id === command.leftRunId && run.status === "completed")?.result;
      const right = state.scenarioRuns.find((run) => run.id === command.rightRunId && run.status === "completed")?.result;
      if (!left || !right) throw venueError("COMMAND_INVALID", { leftRunId: command.leftRunId, rightRunId: command.rightRunId }, "Simulation comparison requires two completed Run IDs");
      return compareSimulationResults(left, right);
    }
    if (command.type === "export_simulation") {
      const run = state.scenarioRuns.find((item) => item.id === command.runId);
      const scenario = run?.scenarioSnapshot ?? state.scenarios.find((item) => item.id === run?.scenarioId);
      if (!run || !scenario || run.status !== "completed") throw venueError("COMMAND_INVALID", { runId: command.runId }, "Simulation export requires a completed Run ID");
      return exportSimulationRun(scenario, { status: run.status, runId: run.id, result: run.result });
    }
    if (command.type === "validate_layout") return validateVenueState(state);
    if (command.type === "get_change_log") return clone(state.ledger);
    if (command.type === "get_project_brief") return eventBriefWithCoverage(candidateBriefFor(state), validateVenueState(state), validateVenueState({ ...state, proposal: null }));
    if (command.type === "replay_history") return replayActivityLedger(state.ledger, state.plan, state.brief);
    if (command.type === "detect_conflicts") return detectProposalConflicts(state, command.branchId);
    if (command.type === "list_branches") {
      return state.branches.map((branch) => {
        const validation = validateVenueState({ ...state, proposal: branch.proposal });
        const conflictState = detectProposalConflicts(state, branch.id);
        return {
          id: branch.id,
          name: branch.name,
          notes: branch.notes ?? "",
          strategy: branch.strategy,
          active: branch.id === state.activeBranchId,
          archived: branch.archived === true,
          decisionStatus: branch.decisionStatus ?? null,
          revisionCount: (branch.revisions ?? []).length + 1,
          revisions: [...(branch.revisions ?? []), branch.proposal].map((proposal) => ({ proposalId: proposal.id, revision: proposal.revision, status: proposal.status, current: proposal.id === branch.proposal.id })),
          proposalId: branch.proposal.id,
          baseVersion: branch.proposal.baseVersion,
          status: branch.proposal.status,
          changedItems: branch.proposal.changes.length,
          validationStatus: validation.status,
          unresolvedIssues: validation.unresolvedIssues,
          stale: conflictState.stale,
          conflicts: conflictState.conflicts.length,
          blockingConflicts: conflictState.blockingConflicts,
          metrics: validation.candidateMetrics,
        };
      });
    }
    if (command.type === "compare_branches") return compareProposalBranches(state, command.leftBranchId, command.rightBranchId, validateVenueState);
    if (command.type === "export_plan") {
      const format = command.format ?? "json";
      const validation = validateVenueState(state);
      const acceptedValidation = validateVenueState({ ...state, proposal: null });
      const replay = replayActivityLedger(state.ledger, state.plan, state.brief);
      const exportState = {
        ...state,
        brief: eventBriefWithCoverage(candidateBriefFor(state), validation, acceptedValidation),
        receipts: state.receipts.map(publicReceipt),
      };
      const plan = materializeSpatialPlan(state.plan, state.proposal?.changes ?? [], { projectLocks: state.projectLocks, allowLockConflicts: true });
      const jsonPayload = `${JSON.stringify({ ...inspection(state), validation, ledger: state.ledger, commandReceipts: state.receipts.map(publicReceipt), historyReplay: replay }, null, 2)}\n`;
      return createPlanExport(format, { state: exportState, plan, validation, replay, exportedAt: now(), jsonPayload, textPayload: formatExport(state) });
    }

    if (command.type === "restore_snapshot") {
      const snapshot = normalizeSnapshot(command.snapshot, fallbackPlan, fallbackBrief, fallbackProposal, legacyBriefProof, defaultAuthorization);
      if (!snapshot?.plan?.id || !snapshot?.plan?.version || !snapshot?.proposal?.id || !Array.isArray(snapshot?.ledger)) {
        throw venueError("SNAPSHOT_INVALID");
      }
      undoStack = [];
      redoStack = [];
      publish(snapshot);
      return { status: "restored", planId: snapshot.plan.id, planVersion: snapshot.plan.version };
    }

    if (command.type === "add_comment") {
      const comment = createComment(state, command, now());
      publish({ ...state, comments: [...state.comments, comment], ledger: appendLedger(state, "comment.created", command.actor ?? "human", { commentId: comment.id, anchor: comment.anchor, authorId: comment.authorId, mentions: comment.mentions, decisionRelevant: comment.decisionRelevant }) });
      return { status: "open", commentId: comment.id, anchor: clone(comment.anchor) };
    }

    if (command.type === "edit_comment") {
      const result = editComment(state.comments, command, now());
      if (!result.changed) return { status: "noop", commentId: result.comment.id };
      publish({ ...state, comments: result.comments, ledger: appendLedger(state, "comment.edited", command.actor ?? "human", { commentId: result.comment.id, authorId: command.actorId, editNumber: result.comment.editHistory.length, mentions: result.comment.mentions, decisionRelevant: result.comment.decisionRelevant }) });
      return { status: "edited", commentId: result.comment.id, editNumber: result.comment.editHistory.length };
    }

    if (command.type === "set_comment_status") {
      const result = setCommentStatus(state.comments, command, now());
      if (!result.changed) return { status: "noop", commentId: result.comment.id };
      publish({ ...state, comments: result.comments, ledger: appendLedger(state, command.status === "resolved" ? "comment.resolved" : "comment.reopened", command.actor ?? "human", { commentId: result.comment.id, authorId: command.actorId, status: command.status }) });
      return { status: command.status, commentId: result.comment.id };
    }

    if (command.type === "preview_revision") {
      const proposal = {
        ...state.proposal,
        id: `proposal-${state.plan.version.replace(".", "")}-${String.fromCharCode(96 + state.proposal.revision + 1)}`,
        revision: state.proposal.revision + 1,
        baseVersion: state.plan.version,
        status: "review",
        goal: command.goal,
        validation: null,
        waivers: [],
      };
      assertNoLockConflicts(state.plan, proposal.changes, state.projectLocks);
      const next = {
        ...syncActiveBranch(state, proposal),
        ledger: appendLedger(state, "proposal.previewed", command.actor ?? "agent", { proposalId: proposal.id, branchId: state.activeBranchId, baseVersion: proposal.baseVersion, goal: proposal.goal, changeIds: proposal.changes.map((change) => change.id) }),
      };
      publish(next);
      return { proposalId: proposal.id, baseVersion: proposal.baseVersion, revision: proposal.revision, changedItems: proposal.changes.length, requiresHumanApproval: true };
    }

    if (command.type === "preview_template_update") {
      const proposal = createRoomTemplateUpdateProposal(state.plan, { templateId: command.templateId, toVersion: command.toVersion, actor: command.actor ?? "agent" });
      assertNoLockConflicts(state.plan, proposal.changes, state.projectLocks);
      const branchNumber = state.branches.length + 1;
      const branch = { id: `branch-template-${branchNumber}`, name: `Room ${command.toVersion}`, notes: "", strategy: "template-update", proposal: clone(proposal), revisions: [], archived: false, decisionStatus: null, createdAt: now(), createdBy: command.actor ?? "agent" };
      publish({
        ...state,
        proposal,
        activeBranchId: branch.id,
        branches: [...state.branches, branch],
        ledger: appendLedger(state, "template.update_previewed", command.actor ?? "agent", { proposalId: proposal.id, branchId: branch.id, templateId: command.templateId, fromVersion: proposal.templateUpdate.fromVersion, toVersion: command.toVersion, changeIds: proposal.changes.map((change) => change.id), skipped: proposal.templateUpdate.skipped }),
      });
      return { proposalId: proposal.id, branchId: branch.id, baseVersion: proposal.baseVersion, templateId: command.templateId, fromVersion: proposal.templateUpdate.fromVersion, toVersion: command.toVersion, changedItems: proposal.changes.length, preservedOverrides: clone(proposal.templateUpdate.preservedOverrides), requiresHumanApproval: true };
    }

    if (command.type === "apply_edit") {
      const existingChanges = state.proposal.status === "review" && state.proposal.baseVersion === state.plan.version ? state.proposal.changes : [];
      const editingPlan = materializeSpatialPlan(state.plan, existingChanges, { projectLocks: state.projectLocks, allowLockConflicts: true });
      const editingChange = buildEditingChange(editingPlan, command.edit);
      const changes = [...existingChanges, { ...editingChange, number: existingChanges.length + 1 }];
      assertNoLockConflicts(state.plan, changes, state.projectLocks);
      materializeSpatialPlan(state.plan, changes, { projectLocks: state.projectLocks });
      const proposal = {
        ...state.proposal,
        id: `proposal-${state.plan.version.replace(".", "")}-edit-${state.proposal.revision + 1}`,
        revision: state.proposal.revision + 1,
        baseVersion: state.plan.version,
        status: "review",
        goal: "Studio edit",
        changes,
        validation: null,
        waivers: [],
      };
      publish({
        ...syncActiveBranch(state, proposal),
        editHistory: { undo: [...state.editHistory.undo, { change: clone(changes.at(-1)), proposalId: proposal.id }], redo: [] },
        ledger: appendLedger(state, "editor.change_applied", command.actor ?? "human", { proposalId: proposal.id, changeId: changes.at(-1).id, operation: command.edit.operation, objectIds: changes.at(-1).targetObjectIds }),
      });
      return { status: "review", proposalId: proposal.id, changeId: changes.at(-1).id, operation: command.edit.operation, changedItems: changes.length, requiresHumanApproval: true };
    }

    if (command.type === "update_event_brief") {
      const brief = normalizeEventBrief({ ...command.brief, ...(state.brief.planningEffectBindings !== undefined ? { planningEffectBindings: state.brief.planningEffectBindings } : {}) }, state.brief);
      const proposal = { ...state.proposal, validation: null, waivers: [] };
      publish({
        ...syncActiveBranch(state, proposal),
        brief,
        ledger: appendLedger(state, "brief.updated", command.actor ?? "human", { briefId: brief.id, attendeeTarget: brief.attendeeTarget, requirementIds: brief.requirements.map((requirement) => requirement.id), acceptedBrief: clone(brief), briefFingerprint: fingerprintEventBrief(brief) }),
      });
      return { status: "updated", briefId: brief.id, attendeeTarget: brief.attendeeTarget, requirements: brief.requirements.length };
    }

    if (command.type === "request_adjustment") {
      const instruction = command.instruction?.trim();
      if (!instruction) throw venueError("ADJUSTMENT_REQUIRED");
      const proposal = {
        ...state.proposal,
        id: `proposal-${state.plan.version.replace(".", "")}-${String.fromCharCode(96 + state.proposal.revision + 1)}`,
        revision: state.proposal.revision + 1,
        baseVersion: state.plan.version,
        status: "review",
        adjustment: instruction,
        validation: null,
        waivers: [],
      };
      publish({
        ...syncActiveBranch(state, proposal),
        ledger: appendLedger(state, "proposal.adjustment_requested", command.actor ?? "human", { proposalId: proposal.id, instruction }),
      });
      return { proposalId: proposal.id, revision: proposal.revision, status: proposal.status };
    }

    if (command.type === "revert_change") {
      if (state.proposal.status !== "review") throw venueError("PROPOSAL_NOT_REVIEWABLE", { proposalId: state.proposal.id, status: state.proposal.status });
      const change = state.proposal.changes.find((item) => item.id === command.changeId);
      if (!change) return { status: "noop", proposalId: state.proposal.id };
      const proposal = {
        ...state.proposal,
        id: `proposal-${state.plan.version.replace(".", "")}-${String.fromCharCode(96 + state.proposal.revision + 1)}`,
        revision: state.proposal.revision + 1,
        changes: state.proposal.changes.filter((item) => item.id !== command.changeId),
        validation: null,
        waivers: [],
      };
      publish({
        ...syncActiveBranch(state, proposal),
        editHistory: { undo: state.editHistory.undo.filter((item) => item.change.id !== change.id), redo: state.editHistory.redo },
        ledger: appendLedger(state, "proposal.change_reverted", command.actor ?? "human", { proposalId: proposal.id, changeId: change.id }),
      });
      return { status: "reverted", proposalId: proposal.id, changeId: change.id, changedItems: proposal.changes.length };
    }

    if (command.type === "create_branch") {
      const name = command.name?.trim();
      if (!name) throw venueError("BRANCH_NAME_REQUIRED");
      const strategy = command.strategy ?? "balanced";
      const number = state.branches.length + 1;
      const filteredChanges = state.proposal.changes.filter((change) => {
        if (strategy === "access-first") return change.number !== 3;
        if (strategy === "sightlines-first") return change.number !== 2;
        if (strategy === "circulation-first") return [2, 4].includes(change.number);
        return true;
      });
      const proposal = {
        ...clone(state.proposal),
        id: `proposal-${state.plan.version.replace(".", "")}-branch-${number}`,
        revision: 1,
        baseVersion: state.plan.version,
        status: "review",
        goal: command.goal ?? `${name} proposal`,
        changes: filteredChanges,
        validation: null,
        waivers: [],
      };
      assertNoLockConflicts(state.plan, proposal.changes, state.projectLocks);
      const branch = { id: `branch-${number}`, name, notes: "", strategy, proposal, revisions: [], archived: false, decisionStatus: null, createdAt: now(), createdBy: command.actor ?? "human" };
      publish({
        ...state,
        proposal,
        activeBranchId: branch.id,
        branches: [...state.branches, branch],
        ledger: appendLedger(state, "proposal.branch_created", command.actor ?? "human", { branchId: branch.id, proposalId: proposal.id, strategy }),
      });
      return { branchId: branch.id, proposalId: proposal.id, strategy, changedItems: proposal.changes.length };
    }

    if (command.type === "recover_unsynchronized_branch") {
      if (command.actor !== "human") throw venueError("CONFLICT_HUMAN_REQUIRED", { commandType: command.type });
      const sourceProposal = command.proposal;
      if (!sourceProposal?.id || !sourceProposal.baseVersion || !Array.isArray(sourceProposal.changes)) throw venueError("COMMAND_INVALID", { field: "proposal" }, "Recovery requires a complete Proposal");
      const number = state.branches.length + 1;
      const proposal = {
        ...clone(sourceProposal),
        id: `proposal-${state.plan.version.replace(".", "")}-recovery-${number}`,
        status: "review",
        validation: null,
        waivers: [],
        recovery: { sourceProposalId: sourceProposal.id, sourceRecordRevision: command.sourceRevision ?? null, recoveredAt: now() },
      };
      const branch = {
        id: `branch-recovery-${number}`,
        name: command.name?.trim() || `RECOVERY R${command.sourceRevision ?? "LOCAL"}`,
        notes: "",
        strategy: "recovery",
        proposal,
        revisions: [],
        archived: false,
        decisionStatus: null,
        createdAt: now(),
        createdBy: command.actorId ?? "human",
        source: { proposalId: sourceProposal.id, recordRevision: command.sourceRevision ?? null },
      };
      publish({
        ...state,
        branches: [...state.branches, branch],
        ledger: appendLedger(state, "proposal.branch_recovered", "human", { branchId: branch.id, proposalId: proposal.id, sourceProposalId: sourceProposal.id, sourceRecordRevision: command.sourceRevision ?? null, remoteRecordRevision: command.remoteRevision ?? null }),
      });
      return { status: "recovered", branchId: branch.id, proposalId: proposal.id, stale: proposal.baseVersion !== state.plan.version, changedItems: proposal.changes.length };
    }

    if (command.type === "record_share_link_created") {
      if (command.actor !== "human" || !command.shareLinkId || !["read-only", "reviewer"].includes(command.scope) || (command.scope === "reviewer" && !command.proposalId)) throw venueError("COMMAND_INVALID", { commandType: command.type });
      publish({ ...state, ledger: appendLedger(state, "share_link.created", "human", { shareLinkId: command.shareLinkId, scope: command.scope, proposalId: command.proposalId ?? null, expiresAt: command.expiresAt }) });
      return { status: "created", shareLinkId: command.shareLinkId, scope: command.scope, proposalId: command.proposalId ?? null };
    }

    if (command.type === "record_share_link_revoked") {
      if (command.actor !== "human" || !command.shareLinkId) throw venueError("COMMAND_INVALID", { commandType: command.type });
      publish({ ...state, ledger: appendLedger(state, "share_link.revoked", "human", { shareLinkId: command.shareLinkId, reasonCode: command.reasonCode ?? "operator-revoked" }) });
      return { status: "revoked", shareLinkId: command.shareLinkId };
    }

    if (command.type === "update_branch_metadata") {
      const branch = state.branches.find((item) => item.id === command.branchId);
      if (!branch) throw venueError("BRANCH_NOT_FOUND", { branchId: command.branchId });
      const name = command.name === undefined ? branch.name : command.name.trim();
      const notes = command.notes === undefined ? (branch.notes ?? "") : command.notes.trim();
      if (!name) throw venueError("BRANCH_NAME_REQUIRED");
      const branches = state.branches.map((item) => item.id === branch.id ? { ...item, name, notes } : item);
      publish({ ...state, branches, ledger: appendLedger(state, "proposal.branch_metadata_updated", command.actor ?? "human", { branchId: branch.id, name, notes }) });
      return { status: "updated", branchId: branch.id, name, notes };
    }

    if (command.type === "duplicate_branch") {
      const source = state.branches.find((item) => item.id === command.branchId);
      if (!source) throw venueError("BRANCH_NOT_FOUND", { branchId: command.branchId });
      const sourceProposal = command.proposalId
        ? [source.proposal, ...(source.revisions ?? [])].find((proposal) => proposal.id === command.proposalId)
        : source.proposal;
      if (!sourceProposal) throw venueError("PROPOSAL_MISMATCH", { branchId: source.id, receivedProposalId: command.proposalId });
      const number = state.branches.length + 1;
      const name = command.name?.trim() || `${source.name} copy`;
      const proposal = { ...clone(sourceProposal), id: `proposal-${state.plan.version.replace(".", "")}-copy-${number}`, revision: 1, baseVersion: sourceProposal.baseVersion, status: "review", validation: null, waivers: [] };
      assertNoLockConflicts(state.plan, proposal.changes, state.projectLocks);
      const branch = { id: `branch-${number}`, name, notes: source.notes ?? "", strategy: source.strategy, proposal, revisions: [], archived: false, decisionStatus: null, source: { branchId: source.id, proposalId: sourceProposal.id }, createdAt: now(), createdBy: command.actor ?? "human" };
      publish({ ...state, proposal, activeBranchId: branch.id, branches: [...state.branches, branch], ledger: appendLedger(state, "proposal.branch_duplicated", command.actor ?? "human", { branchId: branch.id, sourceBranchId: source.id, sourceProposalId: sourceProposal.id, proposalId: proposal.id }) });
      return { status: "duplicated", branchId: branch.id, proposalId: proposal.id, sourceBranchId: source.id, sourceProposalId: sourceProposal.id };
    }

    if (command.type === "archive_branch") {
      const branch = state.branches.find((item) => item.id === command.branchId);
      if (!branch) throw venueError("BRANCH_NOT_FOUND", { branchId: command.branchId });
      if (branch.archived) return { status: "archived", branchId: branch.id };
      const fallback = state.branches.find((item) => item.id !== branch.id && !item.archived);
      if (branch.id === state.activeBranchId && !fallback) throw venueError("COMMAND_INVALID", { branchId: branch.id, reason: "last-active-branch" });
      const branches = state.branches.map((item) => item.id === branch.id ? { ...item, archived: true } : item);
      publish({ ...state, branches, ...(branch.id === state.activeBranchId ? { activeBranchId: fallback.id, proposal: clone(fallback.proposal) } : {}), ledger: appendLedger(state, "proposal.branch_archived", command.actor ?? "human", { branchId: branch.id }) });
      return { status: "archived", branchId: branch.id, activeBranchId: branch.id === state.activeBranchId ? fallback.id : state.activeBranchId };
    }

    if (command.type === "restore_branch") {
      const branch = state.branches.find((item) => item.id === command.branchId);
      if (!branch) throw venueError("BRANCH_NOT_FOUND", { branchId: command.branchId });
      const branches = state.branches.map((item) => item.id === branch.id ? { ...item, archived: false } : item);
      publish({ ...state, branches, ledger: appendLedger(state, "proposal.branch_restored", command.actor ?? "human", { branchId: branch.id }) });
      return { status: "restored", branchId: branch.id };
    }

    if (command.type === "record_branch_decision") {
      if (command.actor !== "human" || !command.actorId?.trim()) throw venueError("COMMAND_INVALID", { field: "actorId", reason: "human-decision-required" });
      const chosen = state.branches.find((item) => item.id === command.chosenBranchId);
      if (!chosen) throw venueError("BRANCH_NOT_FOUND", { branchId: command.chosenBranchId });
      const rejectedIds = [...new Set(command.rejectedBranchIds ?? [])].filter((id) => id !== chosen.id);
      if (!rejectedIds.length) throw venueError("COMMAND_INVALID", { field: "rejectedBranchIds" });
      for (const branchId of rejectedIds) if (!state.branches.some((item) => item.id === branchId)) throw venueError("BRANCH_NOT_FOUND", { branchId });
      const note = command.note?.trim() ?? "";
      const decisionId = stableFingerprint("decision", { planVersion: state.plan.version, chosenBranchId: chosen.id, rejectedBranchIds: rejectedIds.slice().sort(), note });
      const branches = state.branches.map((item) => ({ ...item, decisionStatus: item.id === chosen.id ? "chosen" : rejectedIds.includes(item.id) ? "rejected" : item.decisionStatus ?? null }));
      publish({ ...state, branches, activeBranchId: chosen.id, proposal: clone(chosen.proposal), ledger: appendLedger(state, "proposal.branch_decision_recorded", "human", { decisionId, chosenBranchId: chosen.id, rejectedBranchIds: rejectedIds, note, comparisonId: command.comparisonId ?? null, actorId: command.actorId.trim() }) });
      return { status: "recorded", decisionId, chosenBranchId: chosen.id, rejectedBranchIds: rejectedIds };
    }

    if (command.type === "switch_branch") {
      const branch = state.branches.find((item) => item.id === command.branchId);
      if (!branch) throw venueError("BRANCH_NOT_FOUND", { branchId: command.branchId });
      if (branch.archived) throw venueError("COMMAND_INVALID", { branchId: branch.id, reason: "branch-archived" });
      assertNoLockConflicts(state.plan, branch.proposal.changes, state.projectLocks);
      publish({
        ...state,
        activeBranchId: branch.id,
        proposal: clone(branch.proposal),
        ledger: appendLedger(state, "proposal.branch_selected", command.actor ?? "human", { branchId: branch.id, proposalId: branch.proposal.id }),
      });
      return { branchId: branch.id, proposalId: branch.proposal.id, status: branch.proposal.status };
    }

    if (command.type === "rebase_proposal") {
      const branch = state.branches.find((item) => item.id === (command.branchId ?? state.activeBranchId));
      if (!branch) throw venueError("BRANCH_NOT_FOUND", { branchId: command.branchId ?? state.activeBranchId });
      const detected = detectProposalConflicts(state, branch.id);
      if (detected.blockingConflicts > 0) throw venueError("REBASE_CONFLICT", { branchId: branch.id, conflictIds: detected.conflicts.filter((conflict) => conflict.blocking).map((conflict) => conflict.id) });
      if (!detected.stale) return { status: "current", branchId: branch.id, proposalId: branch.proposal.id, baseVersion: branch.proposal.baseVersion };
      const rebasedProposal = {
        ...clone(branch.proposal),
        id: `proposal-${state.plan.version.replace(".", "")}-rebase-${branch.proposal.revision + 1}`,
        revision: branch.proposal.revision + 1,
        previousBaseVersion: branch.proposal.baseVersion,
        baseVersion: state.plan.version,
        status: "review",
        validation: null,
        waivers: [],
      };
      assertNoLockConflicts(state.plan, rebasedProposal.changes, state.projectLocks);
      const validation = validateVenueState({ ...state, proposal: rebasedProposal });
      const proposal = { ...rebasedProposal, validation };
      const branches = state.branches.map((item) => item.id === branch.id ? { ...item, proposal } : item);
      publish({
        ...state,
        branches,
        proposal: state.activeBranchId === branch.id ? clone(proposal) : state.proposal,
        ledger: appendLedger(state, "proposal.rebased", command.actor ?? "human", {
          branchId: branch.id,
          proposalId: proposal.id,
          previousProposalId: branch.proposal.id,
          fromVersion: branch.proposal.baseVersion,
          toVersion: state.plan.version,
          conflictIds: detected.conflicts.map((item) => item.id),
          changeIds: proposal.changes.map((change) => change.id),
          validationId: validation.validationId,
        }),
      });
      return { status: "rebased", branchId: branch.id, proposalId: proposal.id, fromVersion: branch.proposal.baseVersion, toVersion: proposal.baseVersion, changedItems: proposal.changes.length, validationStatus: validation.status, validationId: validation.validationId };
    }

    if (command.type === "resolve_conflict") {
      if (command.actor !== "human") throw venueError("CONFLICT_HUMAN_REQUIRED", { actor: command.actor ?? null });
      const branch = state.branches.find((item) => item.id === (command.branchId ?? state.activeBranchId));
      if (!branch) throw venueError("BRANCH_NOT_FOUND", { branchId: command.branchId ?? state.activeBranchId });
      const detected = detectProposalConflicts(state, branch.id);
      const currentConflict = detected.conflicts.find((item) => item.id === command.conflictId);
      if (!currentConflict) throw venueError("CONFLICT_NOT_FOUND", { branchId: branch.id, conflictId: command.conflictId });
      const outcome = command.outcome;
      const outcomeAllowed = (outcome === "keep-plan" && currentConflict.resolutionOptions.some((option) => ["keep-plan", "drop-change"].includes(option)))
        || (outcome === "keep-proposal" && currentConflict.resolutionOptions.includes("keep-proposal"))
        || (outcome === "manual-resolution" && currentConflict.resolutionOptions.some((option) => ["manual-resolution", "revise-proposal"].includes(option)));
      if (!outcomeAllowed) throw venueError("CONFLICT_RESOLUTION_INVALID", { conflictId: currentConflict.id, outcome, resolutionOptions: currentConflict.resolutionOptions });

      const affectedChangeIds = new Set(currentConflict.changeIds);
      let changes = clone(branch.proposal.changes);
      let transformedChangeId = null;
      if (outcome === "keep-plan") changes = changes.filter((change) => !affectedChangeIds.has(change.id));
      if (outcome === "manual-resolution") {
        if (!command.manualChange || !Array.isArray(command.manualChange.targetObjectIds) || !Array.isArray(command.manualChange.spatialEffects)) {
          throw venueError("CONFLICT_RESOLUTION_INVALID", { conflictId: currentConflict.id, outcome, field: "manualChange" });
        }
        const original = changes.find((change) => affectedChangeIds.has(change.id));
        const semanticChange = {
          number: original?.number ?? Math.max(0, ...changes.map((change) => change.number ?? 0)) + 1,
          title: command.manualChange.title?.trim() || original?.title || "Manual resolution",
          shortTitle: command.manualChange.shortTitle?.trim() || original?.shortTitle || "Resolved",
          metrics: clone(command.manualChange.metrics ?? original?.metrics ?? []),
          targetObjectIds: [...new Set(command.manualChange.targetObjectIds)].sort(),
          spatialEffects: clone(command.manualChange.spatialEffects),
          effects: clone(command.manualChange.effects ?? {}),
          lineage: { transformedFromChangeIds: [...affectedChangeIds].sort(), conflictId: currentConflict.id },
        };
        transformedChangeId = stableFingerprint("chg", semanticChange);
        changes = [...changes.filter((change) => !affectedChangeIds.has(change.id)), { id: transformedChangeId, ...semanticChange }].sort((left, right) => left.number - right.number || left.id.localeCompare(right.id));
      }

      const rebased = branch.proposal.baseVersion !== state.plan.version;
      const proposal = {
        ...clone(branch.proposal),
        id: `proposal-${state.plan.version.replace(".", "")}-resolve-${branch.proposal.revision + 1}`,
        revision: branch.proposal.revision + 1,
        previousBaseVersion: rebased ? branch.proposal.baseVersion : branch.proposal.previousBaseVersion,
        baseVersion: rebased ? state.plan.version : branch.proposal.baseVersion,
        status: "review",
        changes,
        validation: null,
        waivers: [],
        lineage: [...(branch.proposal.lineage ?? []), { proposalId: branch.proposal.id, conflictId: currentConflict.id, outcome }],
      };
      assertNoLockConflicts(state.plan, proposal.changes, state.projectLocks);
      const validation = validateVenueState({ ...state, proposal });
      proposal.validation = validation;
      const branches = state.branches.map((item) => item.id === branch.id ? { ...item, proposal } : item);
      const nextState = {
        ...state,
        branches,
        proposal: state.activeBranchId === branch.id ? clone(proposal) : state.proposal,
        ledger: appendLedger(state, "proposal.conflict_resolved", command.actor, {
          branchId: branch.id,
          conflictId: currentConflict.id,
          conflictType: currentConflict.type,
          outcome,
          previousProposalId: branch.proposal.id,
          proposalId: proposal.id,
          droppedChangeIds: outcome === "keep-plan" ? [...affectedChangeIds].sort() : [],
          preservedChangeIds: proposal.changes.filter((change) => !transformedChangeId || change.id !== transformedChangeId).map((change) => change.id).sort(),
          transformedFromChangeIds: transformedChangeId ? [...affectedChangeIds].sort() : [],
          transformedChangeId,
          fromVersion: branch.proposal.baseVersion,
          toVersion: proposal.baseVersion,
          validationId: validation.validationId,
          validationStatus: validation.status,
        }),
      };
      publish(nextState);
      const remaining = detectProposalConflicts(nextState, branch.id);
      return { status: "resolved", branchId: branch.id, proposalId: proposal.id, conflictId: currentConflict.id, outcome, transformedChangeId, validationId: validation.validationId, validationStatus: validation.status, remainingConflicts: remaining.conflicts.length };
    }

    if (command.type === "set_object_lock") {
      if (command.actor !== "human") throw venueError("LOCK_HUMAN_REQUIRED", { actor: command.actor ?? null });
      const authorId = command.actorId?.trim();
      if (!authorId) throw venueError("LOCK_HUMAN_REQUIRED", { field: "actorId" });
      if (!LOCK_TYPES.includes(command.lockType)) throw venueError("LOCK_TYPE_INVALID", { lockType: command.lockType ?? null });
      if (!state.plan.objects.some((object) => object.id === command.objectId)) throw venueError("LOCK_OBJECT_NOT_FOUND", { objectId: command.objectId ?? null });
      const active = state.projectLocks.find((lock) => lock.active && lock.objectId === command.objectId && lock.type === command.lockType);
      if (active) throw venueError("LOCK_CONFLICT", { objectIds: [command.objectId], conflicts: [{ objectId: command.objectId, lockId: active.id, lockType: active.type, source: active.source }] }, `Active ${command.lockType} Lock already exists for ${command.objectId}`);
      const reasonCode = command.reasonCode?.trim();
      if (!reasonCode) throw venueError("LOCK_CONFLICT", { objectId: command.objectId, field: "reasonCode" }, "Project Lock requires a reason code");
      if (command.expiresAt !== undefined && command.expiresAt !== null && Number.isNaN(Date.parse(command.expiresAt))) throw venueError("LOCK_CONFLICT", { objectId: command.objectId, field: "expiresAt" }, "Project Lock expiry must be an ISO timestamp");
      const lock = {
        id: `project-lock-${command.objectId}-${command.lockType}-${String(state.projectLocks.length + 1).padStart(3, "0")}`,
        objectId: command.objectId,
        type: command.lockType,
        source: "project",
        reasonCode,
        authorId,
        createdAt: now(),
        expiresAt: command.expiresAt ?? null,
        active: true,
      };
      const projectLocks = normalizeProjectLocks([...state.projectLocks, lock], state.plan);
      publish({
        ...state,
        projectLocks,
        ledger: appendLedger(state, "object.lock_added", "human", { lockId: lock.id, objectId: lock.objectId, lockType: lock.type, source: lock.source, reasonCode: lock.reasonCode, authorId: lock.authorId, expiresAt: lock.expiresAt }),
      });
      return { status: "locked", lockId: lock.id, objectId: lock.objectId, lockType: lock.type, source: lock.source };
    }

    if (command.type === "release_object_lock") {
      if (command.actor !== "human") throw venueError("LOCK_HUMAN_REQUIRED", { actor: command.actor ?? null });
      const authorId = command.actorId?.trim();
      if (!authorId) throw venueError("LOCK_HUMAN_REQUIRED", { field: "actorId" });
      const existing = state.projectLocks.find((lock) => lock.id === command.lockId && lock.active);
      if (!existing) throw venueError("LOCK_NOT_FOUND", { lockId: command.lockId ?? null });
      const releasedAt = now();
      const projectLocks = normalizeProjectLocks(state.projectLocks.map((lock) => lock.id === existing.id ? { ...lock, active: false, releasedAt, releasedBy: authorId } : lock), state.plan);
      publish({
        ...state,
        projectLocks,
        ledger: appendLedger(state, "object.lock_released", "human", { lockId: existing.id, objectId: existing.objectId, lockType: existing.type, source: existing.source, authorId, releasedAt }),
      });
      return { status: "released", lockId: existing.id, objectId: existing.objectId, lockType: existing.type };
    }

    if (command.type === "waive_warning") {
      if (command.actor !== "human") throw venueError("WAIVER_HUMAN_REQUIRED", { actor: command.actor ?? null });
      const authorId = command.actorId?.trim();
      if (!authorId) throw venueError("WAIVER_AUTHOR_REQUIRED");
      const reasonCodes = new Set(["operational-acceptance", "temporary-condition", "equivalent-control", "owner-approved-deviation"]);
      if (!reasonCodes.has(command.reasonCode)) throw venueError("WAIVER_REASON_INVALID", { reasonCode: command.reasonCode ?? null });
      const validation = validateVenueState(state);
      const check = validation.checks.find((item) => item.constraintId === command.constraintId);
      if (!check) throw venueError("CONSTRAINT_NOT_FOUND", { constraintId: command.constraintId });
      if (check.status !== "warning" || !check.waivable) throw venueError("WARNING_NOT_WAIVABLE", { constraintId: command.constraintId, status: check.status });
      if (check.waiver) throw venueError("WARNING_ALREADY_WAIVED", { constraintId: command.constraintId, waiverId: check.waiver.id });
      const waiver = {
        id: `waiver-${command.constraintId}-${validation.inputFingerprint.slice(-8)}`,
        constraintId: command.constraintId,
        proposalId: state.proposal.id,
        baseVersion: state.plan.version,
        validationInputFingerprint: validation.inputFingerprint,
        authorId,
        reasonCode: command.reasonCode,
        createdAt: now(),
      };
      const proposal = { ...state.proposal, waivers: [...(state.proposal.waivers ?? []), waiver], validation: null };
      publish({
        ...syncActiveBranch(state, proposal),
        ledger: appendLedger(state, "constraint.warning_waived", "human", { waiverId: waiver.id, constraintId: waiver.constraintId, proposalId: waiver.proposalId, baseVersion: waiver.baseVersion, validationInputFingerprint: waiver.validationInputFingerprint, authorId: waiver.authorId, reasonCode: waiver.reasonCode }),
      });
      return { status: "waived", waiverId: waiver.id, constraintId: waiver.constraintId, proposalId: waiver.proposalId, validationInputFingerprint: waiver.validationInputFingerprint };
    }

    if (command.type === "approve_proposal") {
      if (command.actor !== "human") throw venueError("AUTHORIZATION_DENIED", { reason: "approval-human-required", permission: "approval.approve" });
      if (authorizationContext?.principal?.type === "human" && command.actorId !== authorizationContext.principal.id) throw venueError("AUTHORIZATION_DENIED", { reason: "approval-principal-mismatch", permission: "approval.approve" });
      if (command.proposalId !== state.proposal.id) throw venueError("PROPOSAL_MISMATCH", { expectedProposalId: state.proposal.id, receivedProposalId: command.proposalId ?? null });
      if (!Array.isArray(state.proposal.changes) || state.proposal.changes.length === 0) throw venueError("PROPOSAL_EMPTY", { proposalId: state.proposal.id });
      if (command.baseVersion !== state.plan.version || state.proposal.baseVersion !== state.plan.version) throw venueError("PLAN_VERSION_CONFLICT", { expectedVersion: state.plan.version, receivedVersion: command.baseVersion ?? null, proposalBaseVersion: state.proposal.baseVersion });
      assertNoLockConflicts(state.plan, state.proposal.changes, state.projectLocks);
      const validation = validateVenueState(state);
      if (validation.status !== "pass") throw venueError("VALIDATION_FAILED", { validationId: validation.validationId, blockingIssues: validation.blockingIssues });
      if (validation.unwaivedWarnings > 0) throw venueError("WARNING_WAIVER_REQUIRED", { validationId: validation.validationId, constraintIds: validation.checks.filter((check) => check.status === "warning" && !check.waiver).map((check) => check.constraintId) });
      let emergencyReview = null;
      if (validation.emergencyReviewRequired) {
        const reviewerId = command.emergencyReview?.reviewerId?.trim();
        const reviewerRole = command.emergencyReview?.reviewerRole;
        if (!reviewerId || command.emergencyReview?.assumptionsAccepted !== true) throw venueError("EMERGENCY_REVIEW_REQUIRED", { proposalId: state.proposal.id, validationId: validation.validationId, changedObjectIds: validation.emergencyChangedObjectIds, authorizedReviewerRoles: validation.authorizedEmergencyReviewerRoles });
        if (!validation.authorizedEmergencyReviewerRoles.includes(reviewerRole)) throw venueError("EMERGENCY_REVIEW_UNAUTHORIZED", { reviewerId, reviewerRole, authorizedReviewerRoles: validation.authorizedEmergencyReviewerRoles });
        if (authorizationContext?.principal?.type === "human" && (reviewerId !== authorizationContext.principal.id || !(authorizationContext.principal.operationalRoles ?? []).includes(reviewerRole))) throw venueError("EMERGENCY_REVIEW_UNAUTHORIZED", { reviewerId, reviewerRole, reason: "authenticated-reviewer-mismatch", authorizedReviewerRoles: validation.authorizedEmergencyReviewerRoles });
        emergencyReview = {
          id: stableFingerprint("emergency-review", { proposalId: state.proposal.id, validationInputFingerprint: validation.inputFingerprint, reviewerId, reviewerRole }),
          proposalId: state.proposal.id,
          basePlanVersion: state.plan.version,
          validationInputFingerprint: validation.inputFingerprint,
          emergencyEvidenceFingerprint: validation.emergencyEvidence.evidenceFingerprint,
          changedObjectIds: validation.emergencyChangedObjectIds,
          reviewerId,
          reviewerRole,
          assumptionsAccepted: true,
          assumptions: clone(validation.emergencyEvidence.emergencyPlan.assumptions),
          note: command.emergencyReview.note?.trim() ?? "",
          reviewedAt: now(),
        };
      }
      undoStack.push({ plan: clone(state.plan), brief: clone(state.brief) });
      redoStack = [];
      const plan = {
        ...applyApprovedTemplateBinding(materializeSpatialPlan(state.plan, state.proposal.changes, { projectLocks: state.projectLocks }), state.proposal),
        version: incrementVersion(state.plan.version),
        metrics: validation.candidateMetrics,
        waivers: (state.proposal.waivers ?? []).map((waiver) => ({ ...waiver, acceptedPlanVersion: incrementVersion(state.plan.version) })),
        emergencyReviews: [...(state.plan.emergencyReviews ?? []), ...(emergencyReview ? [{ ...emergencyReview, acceptedPlanVersion: incrementVersion(state.plan.version) }] : [])],
      };
      const approvedProposal = { ...state.proposal, status: "approved", validation };
      const brief = materializeEventBrief(state.brief, state.proposal.changes);
      publish({
        ...syncActiveBranch(state, approvedProposal),
        plan,
        brief,
        editHistory: { undo: [], redo: [] },
        ledger: appendLedger(state, "proposal.approved", command.actor ?? "human", { proposalId: state.proposal.id, branchId: state.activeBranchId, changeIds: state.proposal.changes.map((change) => change.id), validationId: validation.validationId, fromVersion: state.plan.version, toVersion: plan.version, ...(emergencyReview ? { emergencyReview: clone({ ...emergencyReview, acceptedPlanVersion: plan.version }) } : {}), acceptedPlan: clone(plan), planFingerprint: fingerprintPlan(plan), acceptedBrief: clone(brief), briefFingerprint: fingerprintEventBrief(brief) }),
      });
      return { planId: plan.id, planVersion: plan.version, proposalId: state.proposal.id, status: "approved", validation };
    }

    if (command.type === "undo") {
      const edit = state.editHistory.undo.at(-1);
      if (edit && state.proposal.status === "review" && state.proposal.changes.some((change) => change.id === edit.change.id)) {
        const changes = state.proposal.changes.filter((change) => change.id !== edit.change.id).map((change, index) => ({ ...change, number: index + 1 }));
        const proposal = { ...state.proposal, id: `proposal-${state.plan.version.replace(".", "")}-edit-undo-${state.proposal.revision + 1}`, revision: state.proposal.revision + 1, changes, validation: null, waivers: [] };
        publish({ ...syncActiveBranch(state, proposal), editHistory: { undo: state.editHistory.undo.slice(0, -1), redo: [...state.editHistory.redo, edit] }, ledger: appendLedger(state, "editor.change_undone", command.actor ?? "human", { proposalId: proposal.id, changeId: edit.change.id, operation: edit.change.editor?.operation ?? null }) });
        return { status: "edit-undone", proposalId: proposal.id, changeId: edit.change.id, changedItems: changes.length };
      }
      const previous = undoStack.pop();
      if (!previous) return { status: "noop", planVersion: state.plan.version };
      redoStack.push({ plan: clone(state.plan), brief: clone(state.brief) });
      const restoredProposal = { ...state.proposal, baseVersion: previous.plan.version, status: "review", validation: null, waivers: [] };
      publish({
        ...syncActiveBranch(state, restoredProposal),
        plan: previous.plan,
        brief: previous.brief,
        editHistory: { undo: [], redo: [] },
        ledger: appendLedger(state, "plan.undone", command.actor ?? "human", { toVersion: previous.plan.version, acceptedPlan: clone(previous.plan), planFingerprint: fingerprintPlan(previous.plan), acceptedBrief: clone(previous.brief), briefFingerprint: fingerprintEventBrief(previous.brief) }),
      });
      return { status: "undone", planVersion: previous.plan.version };
    }

    if (command.type === "redo") {
      const edit = state.editHistory.redo.at(-1);
      if (edit && state.proposal.status === "review") {
        const restoredChange = { ...clone(edit.change), number: state.proposal.changes.length + 1 };
        const changes = [...state.proposal.changes, restoredChange];
        assertNoLockConflicts(state.plan, changes, state.projectLocks);
        materializeSpatialPlan(state.plan, changes, { projectLocks: state.projectLocks });
        const proposal = { ...state.proposal, id: `proposal-${state.plan.version.replace(".", "")}-edit-redo-${state.proposal.revision + 1}`, revision: state.proposal.revision + 1, changes, validation: null, waivers: [] };
        publish({ ...syncActiveBranch(state, proposal), editHistory: { undo: [...state.editHistory.undo, edit], redo: state.editHistory.redo.slice(0, -1) }, ledger: appendLedger(state, "editor.change_redone", command.actor ?? "human", { proposalId: proposal.id, changeId: edit.change.id, operation: edit.change.editor?.operation ?? null }) });
        return { status: "edit-redone", proposalId: proposal.id, changeId: edit.change.id, changedItems: changes.length };
      }
      const next = redoStack.pop();
      if (!next) return { status: "noop", planVersion: state.plan.version };
      undoStack.push({ plan: clone(state.plan), brief: clone(state.brief) });
      const approvedProposalForReplay = { ...state.proposal, baseVersion: next.plan.version, status: "approved" };
      const redoneProposal = { ...approvedProposalForReplay, validation: validateVenueState({ ...state, plan: next.plan, brief: next.brief, proposal: approvedProposalForReplay }) };
      publish({
        ...syncActiveBranch(state, redoneProposal),
        plan: next.plan,
        brief: next.brief,
        editHistory: { undo: [], redo: [] },
        ledger: appendLedger(state, "plan.redone", command.actor ?? "human", { toVersion: next.plan.version, acceptedPlan: clone(next.plan), planFingerprint: fingerprintPlan(next.plan), acceptedBrief: clone(next.brief), briefFingerprint: fingerprintEventBrief(next.brief) }),
      });
      return { status: "redone", planVersion: next.plan.version };
    }

    throw venueError("COMMAND_UNSUPPORTED", { commandType: command.type });
  };

  const executeScenarioCommand = (command) => {
    const idempotencyKey = command.idempotencyKey?.trim();
    if (!idempotencyKey) throw venueError("IDEMPOTENCY_KEY_REQUIRED", { commandType: command.type });
    const commandInputFingerprint = commandFingerprint(command);
    const existing = state.receipts.find((receipt) => receipt.idempotencyKey === idempotencyKey);
    if (existing) {
      if (existing.inputFingerprint !== commandInputFingerprint) throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey, commandType: command.type });
      return { ...clone(existing.result), receipt: publicReceipt(existing) };
    }
    const pending = pendingScenarioCommands.get(idempotencyKey);
    if (pending) {
      if (pending.inputFingerprint !== commandInputFingerprint) throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey, commandType: command.type });
      return pending.promise;
    }

    const scenario = normalizeScenarioDefinition(command.scenario);
    const branch = command.branchId ? state.branches.find((item) => item.id === command.branchId) : state.branches.find((item) => item.id === state.activeBranchId);
    if (!branch) throw venueError("BRANCH_NOT_FOUND", { branchId: command.branchId });
    const plan = materializeSpatialPlan(state.plan, branch.proposal?.changes ?? [], { projectLocks: state.projectLocks, allowLockConflicts: true });
    const inputFingerprint = scenarioInputFingerprint(scenario, plan, branch.id);
    const runId = `simulation-${inputFingerprint.slice(-8)}`;
    const receiptId = `receipt-sim-${commandInputFingerprint.slice(-8)}`;
    const startedAt = now();
    const scenarios = state.scenarios.some((item) => item.id === scenario.id) ? state.scenarios.map((item) => item.id === scenario.id ? clone(scenario) : item) : [...state.scenarios, clone(scenario)];
    const runRecord = { id: runId, scenarioId: scenario.id, scenarioFingerprint: scenarioDefinitionFingerprint(scenario), scenarioSnapshot: clone(scenario), model: scenario.model, branchId: branch.id, planId: plan.id, planVersion: plan.version, geometryFingerprint: plan.spatial.fingerprint, inputFingerprint, engineVersion: SIMULATION_ENGINE_VERSION, status: "queued", progress: 0, completedPhaseIds: [], partialResult: null, result: null, startedAt, completedAt: null, cancellationReason: null };
    const scenarioRuns = [...state.scenarioRuns.filter((run) => run.id !== runId), runRecord];
    publish({ ...state, scenarios, scenarioRuns, ledger: sealActivityLedger(appendLedger(state, "simulation.started", command.actor ?? "agent", { runId, scenarioId: scenario.id, branchId: branch.id, inputFingerprint, engineVersion: runRecord.engineVersion, commandReceiptId: receiptId })) });

    const promise = scenarioRunner.run({ scenario, plan, branchId: branch.id }, {
      onProgress: (update) => publish({ ...state, scenarioRuns: state.scenarioRuns.map((run) => run.id === runId ? { ...run, status: update.status, progress: update.progress, completedPhaseIds: update.completedPhaseIds, partialResult: update.partialResult } : run) }),
    }).then((outcome) => {
      const completedAt = now();
      const terminalRun = { ...state.scenarioRuns.find((run) => run.id === runId), status: outcome.status, progress: outcome.status === "completed" ? 1 : state.scenarioRuns.find((run) => run.id === runId)?.progress ?? 0, result: outcome.result ?? null, partialResult: outcome.partialResult ?? state.scenarioRuns.find((run) => run.id === runId)?.partialResult ?? null, completedAt, cancellationReason: outcome.reason ?? null, cacheHit: outcome.cacheHit };
      const result = { status: outcome.status, runId, scenarioId: scenario.id, branchId: branch.id, inputFingerprint, cacheHit: outcome.cacheHit, ...(outcome.result ? { result: outcome.result } : {}), ...(outcome.partialResult ? { partialResult: outcome.partialResult } : {}), ...(outcome.reason ? { reason: outcome.reason } : {}) };
      const receipt = { id: receiptId, idempotencyKey, commandType: command.type, inputFingerprint: commandInputFingerprint, correlationId: command.correlationId?.trim() || `corr-${commandInputFingerprint.slice(-8)}`, actor: command.actor ?? "agent", resultIds: { runId }, occurredAt: completedAt, result: clone(result) };
      const terminalLedger = appendLedger(state, outcome.status === "completed" ? "simulation.completed" : "simulation.cancelled", command.actor ?? "agent", { runId, scenarioId: scenario.id, branchId: branch.id, inputFingerprint, cacheHit: outcome.cacheHit, reason: outcome.reason ?? null, commandReceiptId: receipt.id, correlationId: receipt.correlationId });
      publish({ ...state, scenarioRuns: state.scenarioRuns.map((run) => run.id === runId ? terminalRun : run), ledger: sealActivityLedger(terminalLedger), receipts: [...state.receipts, receipt] });
      return { ...result, receipt: publicReceipt(receipt) };
    }).finally(() => pendingScenarioCommands.delete(idempotencyKey));
    pendingScenarioCommands.set(idempotencyKey, { inputFingerprint: commandInputFingerprint, promise });
    return promise;
  };

  const execute = (command, options = {}) => {
    if (!command || typeof command.type !== "string") throw venueError("COMMAND_INVALID");
    authorize(command, options);
    if (command.type === "run_scenario") return executeScenarioCommand(command);
    const pending = pendingScenarioCommands.get(command.idempotencyKey?.trim());
    if (pending && pending.inputFingerprint !== commandFingerprint(command)) throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey, commandType: command.type });
    const authorization = options.authorization ?? defaultAuthorization;
    if (!MUTATING_COMMANDS.has(command.type)) return executeCommand(command, authorization);

    const idempotencyKey = command.idempotencyKey?.trim();
    if (!idempotencyKey) throw venueError("IDEMPOTENCY_KEY_REQUIRED", { commandType: command.type });
    const inputFingerprint = commandFingerprint(command);
    const existing = state.receipts.find((receipt) => receipt.idempotencyKey === idempotencyKey);
    if (existing) {
      if (existing.inputFingerprint !== inputFingerprint) throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey, commandType: command.type });
      if (existing.error) throw venueError(existing.error.code, clone(existing.error.details), existing.error.message);
      return { ...clone(existing.result), receipt: publicReceipt(existing) };
    }

    const previousLedgerLength = state.ledger.length;
    transaction = { nextState: null };
    let result;
    try {
      result = executeCommand(command, authorization);
    } catch (error) {
      transaction = null;
      if (error?.code === "AUTHORIZATION_DENIED") {
        recordAuthorizationDenial({ error, actionType: command.type, source: command.source, sessionId: command.sessionId });
        throw error;
      }
      if (error?.code === "LOCK_CONFLICT") {
        const correlationId = command.correlationId?.trim() || `corr-${inputFingerprint.slice(-8)}`;
        const receipt = {
          id: `receipt-${String(state.receipts.length + 1).padStart(4, "0")}`,
          idempotencyKey,
          commandType: command.type,
          inputFingerprint,
          correlationId,
          actor: command.actor ?? "system",
          resultIds: {},
          occurredAt: now(),
          error: { code: error.code, message: error.message, remediation: error.remediation, details: { ...error.details } },
        };
        const entry = createActivityEntry(state.ledger.length + 1, "proposal.lock_rejected", command.actor ?? "system", {
          proposalId: state.proposal?.id ?? null,
          conflictIds: (error.details?.conflicts ?? []).map((conflict) => conflict.id).filter(Boolean),
          conflicts: clone(error.details?.conflicts ?? []),
          beforePlanVersion: state.plan.version,
          afterPlanVersion: state.plan.version,
          commandReceiptId: receipt.id,
          correlationId,
          idempotencyKey,
          inputFingerprint,
        }, {
          actorId: command.actorId ?? command.actor ?? "system",
          actorType: command.actor ?? "system",
          source: command.source ?? (command.actor === "agent" ? "agent-tool" : "studio"),
          sessionId: command.sessionId ?? "session-unknown",
        });
        const details = { ...error.details, commandReceiptId: receipt.id, correlationId };
        receipt.error.details = details;
        publish({ ...state, ledger: sealActivityLedger([...state.ledger, entry]), receipts: [...state.receipts, receipt] });
        throw venueError(error.code, details, error.message);
      }
      throw error;
    }
    const nextState = transaction.nextState ?? state;
    transaction = null;
    const receipt = {
      id: `receipt-${String(state.receipts.length + 1).padStart(4, "0")}`,
      idempotencyKey,
      commandType: command.type,
      inputFingerprint,
      correlationId: command.correlationId?.trim() || `corr-${inputFingerprint.slice(-8)}`,
      actor: command.actor ?? "system",
      resultIds: resultIds(result),
      occurredAt: now(),
      result: clone(result),
    };
    const ledger = nextState.ledger.map((entry, index) => index < previousLedgerLength ? entry : {
      ...entry,
      actorId: command.actorId ?? command.actor ?? entry.actor,
      actorType: command.actor ?? entry.actor,
      source: command.source ?? (command.actor === "agent" ? "agent-tool" : "studio"),
      sessionId: command.sessionId ?? "session-unknown",
      details: {
        ...entry.details,
        beforePlanVersion: state.plan.version,
        afterPlanVersion: nextState.plan.version,
        commandReceiptId: receipt.id,
        correlationId: receipt.correlationId,
        idempotencyKey: receipt.idempotencyKey,
        inputFingerprint: receipt.inputFingerprint,
      },
    });
    publish({ ...nextState, ledger: sealActivityLedger(ledger), receipts: [...state.receipts, receipt] });
    return { ...result, receipt: publicReceipt(receipt) };
  };

  const cancelActive = (reason = "cancelled") => scenarioRunner.cancelActive(reason);

  const getProjectId = () => projectId;
  const getAdapterProjectContext = () => projectId ? clone({ projectId, brief: state.brief, constraints: state.plan.constraints, planningEffectBindings: state.brief.planningEffectBindings ?? {} }) : null;
  return Object.freeze({ getSnapshot, getProjectId, getAdapterProjectContext, subscribe, execute, cancelActive, recordAuthorizationDenial });
}
