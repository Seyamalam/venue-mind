import { fingerprintEventBrief, fingerprintPlan, stableFingerprint } from "./activity-ledger.ts";
import { validateConstraints } from "./constraint-engine.ts";
import { venueError } from "./errors.ts";
import { materializeSpatialPlan } from "./spatial-analysis.ts";
import type { VenueErrorCode, VenueErrorDetails } from "./errors.ts";
import type { Point, VenueObject, VenuePlan, VenueProposal } from "./geometry.ts";
import type {
  ActorType,
  CreateDeviationRegisterCommand,
  CreatePostEventDeviationProposalCommand,
  DeviationActorEvidence,
  DeviationDisposition,
  DeviationLedgerEntry,
  DeviationLocation,
  DeviationLocationInput,
  DeviationMutationResult,
  DeviationObjectLineage,
  DeviationOverlay,
  DeviationReceipt,
  DeviationStatus,
  DeviationTransition,
  DeviationValidation,
  EndLivePlanDeviationCommand,
  ExportLivePlanDeviationsCommand,
  InspectLivePlanDeviationsCommand,
  LivePlanDeviation,
  LivePlanDeviationRegister,
  OperationalSource,
  PostEventDeviationRecommendation,
  RecordLivePlanDeviationCommand,
} from "./operational-types.ts";
import type { PlanningChange } from "./planning-effects.ts";

const clone = <Value>(value: Value): Value => structuredClone(value);
const freeze = <Value>(value: Value): Readonly<Value> => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};
const fail = (code: VenueErrorCode, details: VenueErrorDetails = {}): never => {
  throw venueError(code, details);
};
const same = (left: unknown, right: unknown): boolean =>
  stableFingerprint("same", left) === stableFingerprint("same", right);

const nonEmpty = (value: unknown, reason: string): string => {
  if (typeof value !== "string") throw venueError("DEVIATION_INVALID", { reason });
  const normalized = value.trim();
  if (!normalized) throw venueError("DEVIATION_INVALID", { reason });
  return normalized;
};
const reasonCode = (value: unknown, reason: string): string => {
  if (typeof value !== "string") throw venueError("DEVIATION_INVALID", { reason });
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(value)) throw venueError("DEVIATION_INVALID", { reason });
  return value;
};
const instant = (value: string, reason: string): string => {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) fail("DEVIATION_INVALID", { reason });
  return value;
};
const uniqueIds = (value: readonly string[], reason: string, maximum = 100): string[] => {
  if (
    !Array.isArray(value) ||
    value.length > maximum ||
    value.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(value).size !== value.length
  )
    fail("DEVIATION_INVALID", { reason });
  return [...value].sort();
};

const pointOnSegment = (point: Point, start: Point, end: Point): boolean => {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) return false;
  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
};
const pointInRing = (point: Point, ring: readonly Point[]): boolean => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const current = ring[index];
    const prior = ring[previous];
    if (!current || !prior) continue;
    if (pointOnSegment(point, prior, current)) return true;
    if (
      current.y > point.y !== prior.y > point.y &&
      point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x
    )
      inside = !inside;
  }
  return inside;
};
const pointInPlan = (point: Point, plan: VenuePlan): boolean => {
  const boundary = plan.spatial?.roomBoundary;
  return Boolean(
    Number.isFinite(point.x) &&
      Number.isFinite(point.y) &&
      boundary?.outer?.length >= 3 &&
      pointInRing(point, boundary.outer) &&
      !(boundary.holes ?? []).some((hole) => pointInRing(point, hole)),
  );
};

const locationContext = (
  register: LivePlanDeviationRegister,
  input: DeviationLocationInput,
): DeviationLocation => {
  const source = {
    planId: register.source.planId,
    planVersion: register.source.planVersion,
    planFingerprint: register.source.planFingerprint,
  };
  if (
    input?.kind === "plan-object" &&
    typeof input.planObjectId === "string" &&
    register.baseline.acceptedPlan.objects.some((object) => object.id === input.planObjectId)
  )
    return { ...source, kind: "plan-object", planObjectId: input.planObjectId };
  if (input?.kind === "coordinate" && pointInPlan(input.point, register.baseline.acceptedPlan))
    return { ...source, kind: "coordinate", point: { x: input.point.x, y: input.point.y } };
  return fail("DEVIATION_LOCATION_INVALID", { reason: "location-invalid" });
};

const actorEvidence = (
  command: Pick<RecordLivePlanDeviationCommand, "actorType" | "actorId" | "source" | "sessionId">,
  occurredAt: string,
): DeviationActorEvidence => {
  const actorTypes: readonly ActorType[] = ["human", "agent", "system"];
  const sources: readonly OperationalSource[] = ["studio", "webmcp", "mcp", "system", "agent-tool"];
  if (!actorTypes.includes(command.actorType)) fail("DEVIATION_INVALID", { reason: "actor-type-invalid" });
  if (!sources.includes(command.source)) fail("DEVIATION_INVALID", { reason: "source-invalid" });
  return {
    actorType: command.actorType,
    actorId: nonEmpty(command.actorId, "actor-id-required"),
    source: command.source,
    sessionId: nonEmpty(command.sessionId, "session-id-required"),
    occurredAt,
  };
};

const activeChanges = (
  register: LivePlanDeviationRegister,
  excludingDeviationId: string | null = null,
): PlanningChange[] =>
  register.deviations
    .filter((deviation) => deviation.status === "active" && deviation.id !== excludingDeviationId)
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
    .map((deviation) => clone(deviation.change));

const affectedIdsFor = (change: PlanningChange): string[] => {
  if (!change || typeof change !== "object" || !change.id || !Array.isArray(change.spatialEffects))
    fail("DEVIATION_INVALID", { reason: "spatial-change-required" });
  const spatialEffects = change.spatialEffects;
  if (!spatialEffects || spatialEffects.length === 0)
    throw venueError("DEVIATION_INVALID", { reason: "spatial-effects-required" });
  if ((change.planningEffects?.length ?? 0) > 0)
    fail("DEVIATION_INVALID", { reason: "planning-effects-not-operational" });
  if (change.effects && Object.keys(change.effects).length > 0)
    fail("DEVIATION_INVALID", { reason: "metric-effects-not-operational" });
  if (spatialEffects.some((effect) => effect.operation === "update_room_boundary"))
    fail("DEVIATION_INVALID", { reason: "room-boundary-change-not-operational" });
  const ids = [
    ...(change.targetObjectIds ?? []),
    ...spatialEffects.flatMap((effect) => [effect.objectId, effect.object?.id]).filter((id): id is string => !!id),
  ];
  return [...new Set(ids)].sort();
};

const availableConstraintIds = (
  plan: VenuePlan,
  requested: readonly string[],
): { available: string[]; unavailable: string[] } => {
  const available = uniqueIds(requested, "available-constraint-ids-invalid");
  if (available.length === 0) fail("DEVIATION_INVALID", { reason: "available-constraint-required" });
  const all = plan.constraints.map((constraint) => constraint.id).sort();
  const registry = new Set(all);
  const missing = available.filter((id) => !registry.has(id));
  if (missing.length) fail("DEVIATION_CONSTRAINT_UNAVAILABLE", { constraintIds: missing });
  return { available, unavailable: all.filter((id) => !available.includes(id)) };
};

const validateOverlay = (
  register: LivePlanDeviationRegister,
  changes: readonly PlanningChange[],
  requestedConstraintIds: readonly string[],
): { plan: VenuePlan; validation: DeviationValidation } => {
  const constraints = availableConstraintIds(register.baseline.acceptedPlan, requestedConstraintIds);
  const validationPlan = clone({
    ...register.baseline.acceptedPlan,
    constraints: register.baseline.acceptedPlan.constraints.filter((constraint) =>
      constraints.available.includes(constraint.id),
    ),
  });
  const proposal: VenueProposal = {
    id: stableFingerprint("live-deviation-overlay", {
      registerId: register.id,
      changes: changes.map((change) => change.id),
      constraints: constraints.available,
    }),
    baseVersion: String(register.source.planVersion),
    revision: register.revision,
    status: "review",
    goal: "LIVE_PLAN_DEVIATION",
    changes: changes.map(clone),
    waivers: [],
    validation: null,
  };
  const result = validateConstraints({
    plan: validationPlan,
    brief: register.baseline.acceptedBrief,
    proposal,
  });
  const plan = materializeSpatialPlan(register.baseline.acceptedPlan, changes, { allowLockConflicts: true });
  const overlayFingerprint = fingerprintPlan(plan);
  const checks = result.checks.map((check) => ({
    checkId: check.id,
    constraintId: check.constraintId,
    category: check.category,
    severity: check.severity,
    status: check.status,
    affectedObjectIds: [...check.evidence.affectedObjectIds].sort(),
  }));
  return {
    plan,
    validation: {
      validationId: result.validationId,
      inputFingerprint: result.inputFingerprint,
      engineVersion: result.engineVersion,
      overlayFingerprint,
      status: result.status,
      availableConstraintIds: constraints.available,
      unavailableConstraintIds: constraints.unavailable,
      checks,
      blockingIssues: result.blockingIssues,
      warnings: checks.filter((check) => check.status === "warning").length,
    },
  };
};

const objectLineage = (
  beforePlan: VenuePlan,
  afterPlan: VenuePlan,
  affectedObjectIds: readonly string[],
): DeviationObjectLineage[] => {
  const before = new Map(beforePlan.objects.map((object) => [object.id, object]));
  const after = new Map(afterPlan.objects.map((object) => [object.id, object]));
  return affectedObjectIds.map((objectId) => {
    const beforeObject: VenueObject | null = clone(before.get(objectId) ?? null);
    const afterObject: VenueObject | null = clone(after.get(objectId) ?? null);
    if (!beforeObject && !afterObject) fail("DEVIATION_INVALID", { reason: "affected-object-not-found", objectId });
    return {
      objectId,
      beforeObject,
      afterObject,
      beforeFingerprint: beforeObject ? stableFingerprint("venue-object", beforeObject) : null,
      afterFingerprint: afterObject ? stableFingerprint("venue-object", afterObject) : null,
    };
  });
};

const semanticInput = (command: DeviationCommandContextShape): object =>
  Object.fromEntries(
    Object.entries(command).filter(
      ([key]) => !["idempotencyKey", "actorType", "actorId", "source", "sessionId", "committedAt"].includes(key),
    ),
  );
type DeviationCommandContextShape =
  | RecordLivePlanDeviationCommand
  | EndLivePlanDeviationCommand
  | CreatePostEventDeviationProposalCommand;

const stateFingerprint = (register: LivePlanDeviationRegister): string =>
  stableFingerprint("live-deviation-state", {
    registerId: register.id,
    revision: register.revision,
    deviations: register.deviations,
    recommendations: register.recommendations,
  });

const appendLedger = (
  register: LivePlanDeviationRegister,
  transition: DeviationTransition,
): DeviationLedgerEntry => {
  const previousHash = register.ledger.at(-1)?.hash ?? register.source.runbookLedgerHeadHash;
  const entry: Omit<DeviationLedgerEntry, "hash"> = {
    id: `deviation-ledger-${String(register.ledger.length + 1).padStart(6, "0")}`,
    schemaVersion: 1,
    sequence: register.ledger.length + 1,
    type: transition.type,
    transitionId: transition.id,
    deviationId: transition.deviationId,
    actor: clone(transition.actor),
    location: clone(transition.location),
    affectedObjectIds: [...transition.affectedObjectIds],
    details: clone(transition.details),
    resultingStateFingerprint: transition.resultingStateFingerprint,
    receiptFingerprint: transition.receiptFingerprint,
    previousHash,
  };
  return { ...entry, hash: stableFingerprint("deviation-ledger", entry) };
};

export function createLivePlanDeviationRegister({
  projectId,
  runbook,
  createdAt = new Date().toISOString(),
  createdBy,
}: CreateDeviationRegisterCommand): Readonly<LivePlanDeviationRegister> {
  const acceptedPlan = runbook?.baseline?.acceptedPlan;
  const acceptedBrief = runbook?.baseline?.acceptedBrief;
  if (
    !projectId ||
    runbook?.status !== "active" ||
    runbook.source?.projectId !== projectId ||
    !runbook.versionId ||
    !acceptedPlan ||
    !acceptedBrief ||
    fingerprintPlan(acceptedPlan) !== runbook.source.planFingerprint ||
    fingerprintEventBrief(acceptedBrief) !== runbook.source.briefFingerprint
  )
    fail("DEVIATION_BASELINE_INVALID", { reason: "active-runbook-baseline-required" });
  const at = instant(createdAt, "created-at-invalid");
  const source = {
    runbookVersionId: runbook.versionId,
    runbookDefinitionFingerprint: runbook.definitionFingerprint,
    runbookLedgerHeadHash: runbook.ledger.at(-1)?.hash ?? runbook.source.sourceLedgerHeadHash,
    planId: runbook.source.planId,
    planVersion: runbook.source.planVersion,
    planFingerprint: runbook.source.planFingerprint,
    briefFingerprint: runbook.source.briefFingerprint,
    validationId: runbook.source.validationId,
    validationInputFingerprint: runbook.source.validationInputFingerprint,
    approvalLedgerEntryId: runbook.source.approvalLedgerEntryId,
  };
  const baseline = {
    acceptedPlan: clone(acceptedPlan),
    acceptedBrief: clone(acceptedBrief),
    fingerprint: stableFingerprint("live-deviation-baseline", { source, acceptedPlan, acceptedBrief }),
  };
  return freeze({
    schemaVersion: 1,
    id: `deviations-${runbook.versionId}`,
    projectId,
    runbookVersionId: runbook.versionId,
    source,
    baseline,
    deviations: [],
    recommendations: [],
    transitions: [],
    receipts: [],
    ledger: [],
    revision: 0,
    createdAt: at,
    createdBy: nonEmpty(createdBy, "created-by-required"),
    updatedAt: at,
  });
}

const assertRegisterRevision = (
  register: LivePlanDeviationRegister,
  expectedRevision: number,
): void => {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== register.revision)
    fail("DEVIATION_REGISTER_REVISION_CONFLICT", {
      expectedRevision,
      currentRevision: register.revision,
      registerId: register.id,
    });
};

const retryFor = (
  register: LivePlanDeviationRegister,
  command: DeviationCommandContextShape,
  prefix: string,
): { receipt: DeviationReceipt; inputFingerprint: string } | null => {
  if (!command.idempotencyKey) fail("IDEMPOTENCY_KEY_REQUIRED", { commandType: command.type });
  const inputFingerprint = stableFingerprint(prefix, semanticInput(command));
  const receipt = register.receipts.find((candidate) => candidate.idempotencyKey === command.idempotencyKey);
  if (!receipt) return null;
  if (receipt.inputFingerprint !== inputFingerprint)
    fail("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
  return { receipt, inputFingerprint };
};

const mutationResultForRetry = (
  register: LivePlanDeviationRegister,
  receipt: DeviationReceipt,
): DeviationMutationResult => {
  const recommendation = register.recommendations.find(
    (candidate) => candidate.proposalId === receipt.proposalId,
  );
  return freeze({
    register,
    deviation: receipt.deviationId
      ? clone(register.deviations.find((candidate) => candidate.id === receipt.deviationId) ?? null)
      : null,
    proposal: clone(recommendation?.proposal ?? null),
    receipt: clone(receipt),
    duplicate: true,
  });
};

export function recordLivePlanDeviation(
  register: LivePlanDeviationRegister,
  command: RecordLivePlanDeviationCommand,
  { committedAt = command.committedAt ?? new Date().toISOString() }: { committedAt?: string } = {},
): DeviationMutationResult {
  const retry = retryFor(register, command, "live-deviation-record");
  if (retry) return mutationResultForRetry(register, retry.receipt);
  assertRegisterRevision(register, command.expectedRevision);
  const at = instant(committedAt, "committed-at-invalid");
  const actor = actorEvidence(command, at);
  const deviationId = nonEmpty(command.deviationId, "deviation-id-required");
  if (register.deviations.some((deviation) => deviation.id === deviationId))
    fail("DEVIATION_ID_CONFLICT", { deviationId });
  const dispositions: readonly DeviationDisposition[] = ["temporary", "revision-candidate"];
  if (!dispositions.includes(command.disposition)) fail("DEVIATION_INVALID", { reason: "disposition-invalid" });
  const affectedObjectIds = uniqueIds(command.affectedObjectIds, "affected-object-ids-invalid");
  const derivedAffectedObjectIds = affectedIdsFor(command.change);
  if (affectedObjectIds.length === 0 || !same(affectedObjectIds, derivedAffectedObjectIds))
    fail("DEVIATION_INVALID", {
      reason: "affected-objects-mismatch",
      declared: affectedObjectIds,
      derived: derivedAffectedObjectIds,
    });
  const location = locationContext(register, command.location);
  const previousChanges = activeChanges(register);
  const beforePlan = materializeSpatialPlan(register.baseline.acceptedPlan, previousChanges, {
    allowLockConflicts: true,
  });
  const allChanges = [...previousChanges, clone(command.change)];
  const declaredConstraintIds = availableConstraintIds(
    register.baseline.acceptedPlan,
    command.availableConstraintIds,
  ).available;
  const activeConstraintIds = register.deviations
    .filter((deviation) => deviation.status === "active")
    .flatMap((deviation) => deviation.validation.availableConstraintIds);
  const evaluated = validateOverlay(register, allChanges, [
    ...new Set([...activeConstraintIds, ...declaredConstraintIds]),
  ].sort());
  const deviation: LivePlanDeviation = {
    schemaVersion: 1,
    id: deviationId,
    sequence: register.deviations.length + 1,
    revision: 1,
    runbookVersionId: register.runbookVersionId,
    disposition: command.disposition,
    status: "active",
    reasonCode: reasonCode(command.reasonCode, "reason-code-invalid"),
    location,
    affectedObjectIds,
    change: clone(command.change),
    objectLineage: objectLineage(beforePlan, evaluated.plan, affectedObjectIds),
    validation: evaluated.validation,
    authored: actor,
    ended: null,
  };
  const inputFingerprint = stableFingerprint("live-deviation-record", semanticInput(command));
  const nextRevision = register.revision + 1;
  const receipt: DeviationReceipt = {
    id: stableFingerprint("deviation-receipt", { registerId: register.id, inputFingerprint }),
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    operation: "record",
    deviationId,
    proposalId: null,
    deviationRevision: deviation.revision,
    registerRevision: nextRevision,
    ledgerSequence: register.ledger.length + 1,
    acceptedAt: at,
  };
  const nextWithoutTransition: LivePlanDeviationRegister = {
    ...clone(register),
    deviations: [...register.deviations.map(clone), deviation],
    receipts: [...register.receipts.map(clone), receipt],
    revision: nextRevision,
    updatedAt: at,
  };
  const transition: DeviationTransition = {
    id: stableFingerprint("deviation-transition", { registerId: register.id, inputFingerprint }),
    sequence: register.transitions.length + 1,
    type: "deviation.recorded",
    deviationId,
    fromDeviationRevision: 0,
    toDeviationRevision: 1,
    fromRegisterRevision: register.revision,
    toRegisterRevision: nextRevision,
    actor,
    location,
    affectedObjectIds,
    details: {
      disposition: command.disposition,
      reasonCode: deviation.reasonCode,
      validationId: deviation.validation.validationId,
      validationStatus: deviation.validation.status,
      availableConstraintIds: deviation.validation.availableConstraintIds,
      unavailableConstraintIds: deviation.validation.unavailableConstraintIds,
    },
    resultingStateFingerprint: stateFingerprint(nextWithoutTransition),
    receiptFingerprint: stableFingerprint("deviation-receipt-evidence", receipt),
  };
  const next: LivePlanDeviationRegister = {
    ...nextWithoutTransition,
    transitions: [...register.transitions.map(clone), transition],
    ledger: [...register.ledger.map(clone), appendLedger(register, transition)],
  };
  return freeze({ register: next, deviation, proposal: null, receipt, duplicate: false });
}

export function endLivePlanDeviation(
  register: LivePlanDeviationRegister,
  command: EndLivePlanDeviationCommand,
  { committedAt = command.committedAt ?? new Date().toISOString() }: { committedAt?: string } = {},
): DeviationMutationResult {
  const retry = retryFor(register, command, "live-deviation-end");
  if (retry) return mutationResultForRetry(register, retry.receipt);
  assertRegisterRevision(register, command.expectedRevision);
  const current =
    register.deviations.find((deviation) => deviation.id === command.deviationId) ??
    fail("DEVIATION_NOT_FOUND", { deviationId: command.deviationId });
  if (!Number.isInteger(command.expectedDeviationRevision) || command.expectedDeviationRevision !== current.revision)
    fail("DEVIATION_REVISION_CONFLICT", {
      deviationId: current.id,
      expectedDeviationRevision: command.expectedDeviationRevision,
      currentDeviationRevision: current.revision,
    });
  if (current.status !== "active")
    fail("DEVIATION_TRANSITION_INVALID", { deviationId: current.id, fromStatus: current.status, toStatus: "ended" });
  const at = instant(committedAt, "committed-at-invalid");
  const actor = actorEvidence(command, at);
  const endingReasonCode = reasonCode(command.reasonCode, "end-reason-code-invalid");
  const deviation: LivePlanDeviation = {
    ...clone(current),
    revision: current.revision + 1,
    status: "ended",
    ended: { ...actor, reasonCode: endingReasonCode },
  };
  const inputFingerprint = stableFingerprint("live-deviation-end", semanticInput(command));
  const nextRevision = register.revision + 1;
  const receipt: DeviationReceipt = {
    id: stableFingerprint("deviation-receipt", { registerId: register.id, inputFingerprint }),
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    operation: "end",
    deviationId: current.id,
    proposalId: null,
    deviationRevision: deviation.revision,
    registerRevision: nextRevision,
    ledgerSequence: register.ledger.length + 1,
    acceptedAt: at,
  };
  const nextWithoutTransition: LivePlanDeviationRegister = {
    ...clone(register),
    deviations: register.deviations.map((candidate) => (candidate.id === deviation.id ? deviation : clone(candidate))),
    receipts: [...register.receipts.map(clone), receipt],
    revision: nextRevision,
    updatedAt: at,
  };
  const transition: DeviationTransition = {
    id: stableFingerprint("deviation-transition", { registerId: register.id, inputFingerprint }),
    sequence: register.transitions.length + 1,
    type: "deviation.ended",
    deviationId: deviation.id,
    fromDeviationRevision: current.revision,
    toDeviationRevision: deviation.revision,
    fromRegisterRevision: register.revision,
    toRegisterRevision: nextRevision,
    actor,
    location: clone(deviation.location),
    affectedObjectIds: [...deviation.affectedObjectIds],
    details: { reasonCode: endingReasonCode, disposition: deviation.disposition },
    resultingStateFingerprint: stateFingerprint(nextWithoutTransition),
    receiptFingerprint: stableFingerprint("deviation-receipt-evidence", receipt),
  };
  const next: LivePlanDeviationRegister = {
    ...nextWithoutTransition,
    transitions: [...register.transitions.map(clone), transition],
    ledger: [...register.ledger.map(clone), appendLedger(register, transition)],
  };
  return freeze({ register: next, deviation, proposal: null, receipt, duplicate: false });
}

export function createPostEventDeviationProposal(
  register: LivePlanDeviationRegister,
  command: CreatePostEventDeviationProposalCommand,
  { committedAt = command.committedAt ?? new Date().toISOString() }: { committedAt?: string } = {},
): DeviationMutationResult {
  const retry = retryFor(register, command, "live-deviation-post-event-proposal");
  if (retry) return mutationResultForRetry(register, retry.receipt);
  assertRegisterRevision(register, command.expectedRevision);
  const integrity = verifyDeviationLedger(register);
  if (integrity.status !== "pass") fail("DEVIATION_LEDGER_INTEGRITY_FAILED", { sequence: integrity.sequence });
  const selectedIds = uniqueIds(command.deviationIds, "deviation-ids-invalid");
  const selected = selectedIds.map((id) => {
    const deviation = register.deviations.find((candidate) => candidate.id === id);
    if (!deviation) return fail("DEVIATION_NOT_FOUND", { deviationId: id });
    if (deviation.disposition !== "revision-candidate")
      return fail("DEVIATION_INVALID", { reason: "temporary-deviation-not-revision-candidate", deviationId: id });
    if (deviation.status !== "ended")
      return fail("DEVIATION_INVALID", { reason: "active-deviation-not-post-event", deviationId: id });
    return deviation;
  });
  if (selected.length === 0) fail("DEVIATION_POST_EVENT_PROPOSAL_EMPTY");
  if (
    selected.some((deviation) =>
      register.recommendations.some((recommendation) => recommendation.deviationIds.includes(deviation.id)),
    )
  )
    fail("DEVIATION_INVALID", { reason: "deviation-already-recommended" });
  const proposalId = nonEmpty(command.proposalId, "proposal-id-required");
  if (register.recommendations.some((recommendation) => recommendation.proposalId === proposalId))
    fail("DEVIATION_ID_CONFLICT", { proposalId });
  const proposal: VenueProposal = {
    id: proposalId,
    baseVersion: String(register.source.planVersion),
    revision: 1,
    status: "review",
    goal: nonEmpty(command.goal, "proposal-goal-required"),
    changes: selected
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
      .map((deviation, index) => ({
        ...clone(deviation.change),
        number: index + 1,
        lineage: {
          kind: "live-plan-deviation",
          deviationId: deviation.id,
          runbookVersionId: register.runbookVersionId,
          reasonCode: deviation.reasonCode,
          authoredAt: deviation.authored.occurredAt,
          authoredBy: deviation.authored.actorId,
          objectLineage: clone(deviation.objectLineage),
        },
      })),
    waivers: [],
    validation: null,
    lineage: selected.map((deviation) => ({
      kind: "live-plan-deviation",
      deviationId: deviation.id,
      runbookVersionId: register.runbookVersionId,
    })),
  };
  const at = instant(committedAt, "committed-at-invalid");
  const actor = actorEvidence(command, at);
  const recommendation: PostEventDeviationRecommendation = {
    id: stableFingerprint("post-event-deviation-recommendation", {
      registerId: register.id,
      proposalId,
      deviationIds: selectedIds,
    }),
    proposalId,
    proposal: clone(proposal),
    proposalFingerprint: stableFingerprint("proposal", proposal),
    deviationIds: selectedIds,
    created: actor,
  };
  const inputFingerprint = stableFingerprint("live-deviation-post-event-proposal", semanticInput(command));
  const nextRevision = register.revision + 1;
  const receipt: DeviationReceipt = {
    id: stableFingerprint("deviation-receipt", { registerId: register.id, inputFingerprint }),
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    operation: "create-post-event-proposal",
    deviationId: null,
    proposalId,
    deviationRevision: null,
    registerRevision: nextRevision,
    ledgerSequence: register.ledger.length + 1,
    acceptedAt: at,
  };
  const nextWithoutTransition: LivePlanDeviationRegister = {
    ...clone(register),
    recommendations: [...register.recommendations.map(clone), recommendation],
    receipts: [...register.receipts.map(clone), receipt],
    revision: nextRevision,
    updatedAt: at,
  };
  const affectedObjectIds = [...new Set(selected.flatMap((deviation) => deviation.affectedObjectIds))].sort();
  const transition: DeviationTransition = {
    id: stableFingerprint("deviation-transition", { registerId: register.id, inputFingerprint }),
    sequence: register.transitions.length + 1,
    type: "deviation.post_event_proposal_created",
    deviationId: null,
    fromDeviationRevision: null,
    toDeviationRevision: null,
    fromRegisterRevision: register.revision,
    toRegisterRevision: nextRevision,
    actor,
    location: null,
    affectedObjectIds,
    details: {
      proposalId,
      proposalFingerprint: recommendation.proposalFingerprint,
      deviationIds: selectedIds,
      acceptedPlanFingerprint: register.source.planFingerprint,
    },
    resultingStateFingerprint: stateFingerprint(nextWithoutTransition),
    receiptFingerprint: stableFingerprint("deviation-receipt-evidence", receipt),
  };
  const next: LivePlanDeviationRegister = {
    ...nextWithoutTransition,
    transitions: [...register.transitions.map(clone), transition],
    ledger: [...register.ledger.map(clone), appendLedger(register, transition)],
  };
  if (fingerprintPlan(register.baseline.acceptedPlan) !== register.source.planFingerprint)
    fail("DEVIATION_BASELINE_INVALID", { reason: "accepted-plan-mutated" });
  return freeze({ register: next, deviation: null, proposal, receipt, duplicate: false });
}

export function inspectLivePlanDeviations(
  register: LivePlanDeviationRegister,
  filters: Omit<InspectLivePlanDeviationsCommand, "type"> = {},
): readonly LivePlanDeviation[] {
  const statuses: readonly DeviationStatus[] = ["active", "ended"];
  const dispositions: readonly DeviationDisposition[] = ["temporary", "revision-candidate"];
  if (filters.status && !statuses.includes(filters.status)) fail("DEVIATION_INVALID", { reason: "status-filter-invalid" });
  if (filters.disposition && !dispositions.includes(filters.disposition))
    fail("DEVIATION_INVALID", { reason: "disposition-filter-invalid" });
  return freeze(
    register.deviations
      .filter((deviation) => !filters.status || deviation.status === filters.status)
      .filter((deviation) => !filters.disposition || deviation.disposition === filters.disposition)
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
      .map(clone),
  );
}

export function inspectLivePlanOverlay(register: LivePlanDeviationRegister): Readonly<DeviationOverlay> {
  const changes = activeChanges(register);
  const active = register.deviations.filter((deviation) => deviation.status === "active");
  const available = [
    ...new Set(active.flatMap((deviation) => deviation.validation.availableConstraintIds)),
  ].sort();
  const requested = available.length ? available : register.baseline.acceptedPlan.constraints.map(({ id }) => id).sort();
  const evaluated = validateOverlay(register, changes, requested);
  return freeze({
    registerId: register.id,
    registerRevision: register.revision,
    runbookVersionId: register.runbookVersionId,
    acceptedPlanId: register.source.planId,
    acceptedPlanVersion: register.source.planVersion,
    acceptedPlanFingerprint: register.source.planFingerprint,
    activeDeviationIds: active
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
      .map(({ id }) => id),
    overlayPlan: evaluated.plan,
    overlayFingerprint: evaluated.validation.overlayFingerprint,
    validation: evaluated.validation,
  });
}

export function verifyDeviationLedger(register: LivePlanDeviationRegister): Readonly<{
  status: "pass" | "fail";
  entries: number;
  headHash: string | null;
  sequence: number | null;
}> {
  const invalid = (sequence: number | null) => ({
    status: "fail" as const,
    entries: register.ledger.length,
    headHash: null,
    sequence,
  });
  const expectedBaselineFingerprint = stableFingerprint("live-deviation-baseline", {
    source: register.source,
    acceptedPlan: register.baseline.acceptedPlan,
    acceptedBrief: register.baseline.acceptedBrief,
  });
  if (
    fingerprintPlan(register.baseline.acceptedPlan) !== register.source.planFingerprint ||
    fingerprintEventBrief(register.baseline.acceptedBrief) !== register.source.briefFingerprint ||
    register.baseline.fingerprint !== expectedBaselineFingerprint ||
    register.ledger.length !== register.transitions.length ||
    register.ledger.length !== register.receipts.length
  )
    return invalid(null);
  let previousHash = register.source.runbookLedgerHeadHash;
  for (let index = 0; index < register.ledger.length; index += 1) {
    const entry = register.ledger[index];
    const transition = register.transitions[index];
    const receipt = register.receipts[index];
    if (!entry || !transition || !receipt) return invalid(index + 1);
    const { hash, ...unsigned } = entry;
    const expectedUnsigned = { ...unsigned, previousHash };
    const valid =
      entry.schemaVersion === 1 &&
      entry.sequence === index + 1 &&
      entry.previousHash === previousHash &&
      entry.transitionId === transition.id &&
      entry.type === transition.type &&
      entry.resultingStateFingerprint === transition.resultingStateFingerprint &&
      entry.receiptFingerprint === stableFingerprint("deviation-receipt-evidence", receipt) &&
      entry.receiptFingerprint === transition.receiptFingerprint &&
      receipt.ledgerSequence === entry.sequence &&
      receipt.registerRevision === transition.toRegisterRevision &&
      hash === stableFingerprint("deviation-ledger", expectedUnsigned);
    if (!valid) return invalid(index + 1);
    previousHash = hash;
  }
  const finalTransition = register.transitions.at(-1);
  if (finalTransition && finalTransition.resultingStateFingerprint !== stateFingerprint(register))
    return invalid(finalTransition.sequence);
  return {
    status: "pass",
    entries: register.ledger.length,
    headHash: register.ledger.at(-1)?.hash ?? register.source.runbookLedgerHeadHash,
    sequence: null,
  };
}

export function exportLivePlanDeviations(
  register: LivePlanDeviationRegister,
  { exportedAt = new Date().toISOString() }: ExportLivePlanDeviationsCommand,
) {
  const at = instant(exportedAt, "exported-at-invalid");
  const integrity = verifyDeviationLedger(register);
  if (integrity.status !== "pass") fail("DEVIATION_LEDGER_INTEGRITY_FAILED", { sequence: integrity.sequence });
  const overlay = inspectLivePlanOverlay(register);
  const artifact = {
    schemaVersion: 1,
    kind: "venuemind-live-plan-deviations",
    exportedAt: at,
    register: {
      id: register.id,
      projectId: register.projectId,
      runbookVersionId: register.runbookVersionId,
      revision: register.revision,
    },
    approvedPlan: {
      identity: {
        planId: register.source.planId,
        planVersion: register.source.planVersion,
        planFingerprint: register.source.planFingerprint,
      },
      plan: clone(register.baseline.acceptedPlan),
    },
    liveDeviations: register.deviations.map(clone),
    activeOverlay: clone(overlay),
    postEventRecommendedRevisions: register.recommendations.map(clone),
    transitions: register.transitions.map(clone),
    ledger: register.ledger.map(clone),
    integrity,
  };
  return freeze({
    filename: `${register.id}.json`,
    mediaType: "application/json",
    content: JSON.stringify(artifact, null, 2),
    fingerprint: stableFingerprint("live-plan-deviation-export", artifact),
  });
}
