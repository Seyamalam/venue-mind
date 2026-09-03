import { fingerprintEventBrief, fingerprintPlan, stableFingerprint } from "./activity-ledger.ts";
import { venueError } from "./errors.ts";
import { verifyRunbookLedger } from "./event-day-runbook.ts";
import { verifyIncidentLedger } from "./incidents.ts";
import { verifyDeviationLedger } from "./live-plan-deviations.ts";
import { verifyOccupancyLedger } from "./live-occupancy.ts";
import type { VenueErrorCode, VenueErrorDetails } from "./errors.ts";
import type { PlanningChange } from "./planning-effects.ts";
import type {
  CreatePostEventReviewCommand,
  CreateTemplateImprovementProposalCommand,
  PostEventActorEvidence,
  PostEventComparison,
  PostEventEvidenceKind,
  PostEventEvidenceRef,
  PostEventLesson,
  PostEventMetric,
  PostEventMetricUnit,
  PostEventObservation,
  PostEventPrediction,
  PostEventReview,
  PostEventReviewCommandContext,
  PostEventReviewLedgerEntry,
  PostEventReviewMutationResult,
  PostEventReviewReceipt,
  PostEventReviewTransition,
  RecordPostEventLessonCommand,
  RecordPostEventObservationCommand,
  ReviewTemplateImprovementProposalCommand,
  TemplateImprovementProposal,
} from "./post-event-review-types.ts";

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
const text = (value: string, reason: string): string => {
  const result = typeof value === "string" ? value.trim() : "";
  return result || fail("POST_EVENT_INVALID", { reason });
};
const code = (value: string, reason: string): string => {
  const result = text(value, reason);
  return /^[A-Z][A-Z0-9_]{1,63}$/.test(result)
    ? result
    : fail("POST_EVENT_INVALID", { reason });
};
const instant = (value: string, reason: string): string => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value
    ? value
    : fail("POST_EVENT_INVALID", { reason });
};
const unique = (values: readonly string[], reason: string, maximum = 100): string[] => {
  if (
    !Array.isArray(values) ||
    values.length > maximum ||
    values.some((value) => typeof value !== "string" || !value.trim()) ||
    new Set(values).size !== values.length
  )
    fail("POST_EVENT_INVALID", { reason });
  return [...values].sort();
};

const metricContracts: Readonly<Record<PostEventMetric, Readonly<{ family: PostEventPrediction["family"]; unit: PostEventMetricUnit }>>> = {
  "peak-persons": { family: "occupancy", unit: "persons" },
  "utilization-ratio": { family: "occupancy", unit: "ratio" },
  "average-wait-seconds": { family: "queue", unit: "seconds" },
  "p95-wait-seconds": { family: "queue", unit: "seconds" },
  "maximum-queue-persons": { family: "queue", unit: "persons" },
  "abandonment-ratio": { family: "queue", unit: "ratio" },
  "clearance-seconds": { family: "flow", unit: "seconds" },
  "peak-congestion-index": { family: "flow", unit: "index" },
  "backlog-persons": { family: "flow", unit: "persons" },
  "incident-count": { family: "incidents", unit: "incidents" },
  "resolution-seconds": { family: "incidents", unit: "seconds" },
};

const predictionKey = (prediction: Pick<PostEventPrediction, "family" | "metric" | "scope">): string =>
  `${prediction.family}:${prediction.metric}:${prediction.scope.kind}:${prediction.scope.id}`;

const evidenceFingerprint = (kind: PostEventEvidenceKind, value: object): string =>
  stableFingerprint(`post-event-${kind}`, value);

const evidenceCatalog = (review: Pick<PostEventReview, "source" | "baseline">): Map<string, string> => {
  const catalog = new Map<string, string>();
  catalog.set(`accepted-plan\0${review.source.planId}`, review.source.planFingerprint);
  catalog.set(`runbook\0${review.baseline.runbook.versionId}`, review.source.runbookFingerprint);
  catalog.set(`occupancy-monitor\0${review.baseline.occupancyMonitor.id}`, review.source.occupancyMonitorFingerprint);
  catalog.set(
    `occupancy-projection\0${review.baseline.occupancyMonitor.id}`,
    review.source.occupancyProjectionFingerprint,
  );
  catalog.set(`incident-register\0${review.baseline.incidentRegister.id}`, review.source.incidentRegisterFingerprint);
  catalog.set(`deviation-register\0${review.baseline.deviationRegister.id}`, review.source.deviationRegisterFingerprint);
  Object.entries(review.source.scenarioRunFingerprints).forEach(([id, fingerprint]) =>
    catalog.set(`scenario-run\0${id}`, fingerprint),
  );
  return catalog;
};

const normalizeEvidenceRefs = (
  refs: readonly PostEventEvidenceRef[],
  catalog: ReadonlyMap<string, string>,
): PostEventEvidenceRef[] => {
  if (!Array.isArray(refs) || refs.length === 0 || refs.length > 50)
    fail("POST_EVENT_EVIDENCE_INVALID", { reason: "evidence-required" });
  const normalized = refs.map((ref) => {
    const key = `${ref.kind}\0${ref.id}`;
    if (!catalog.has(key) || catalog.get(key) !== ref.fingerprint)
      fail("POST_EVENT_EVIDENCE_INVALID", { reason: "evidence-not-in-frozen-baseline", kind: ref.kind, id: ref.id });
    return clone(ref);
  });
  if (new Set(normalized.map((ref) => `${ref.kind}\0${ref.id}`)).size !== normalized.length)
    fail("POST_EVENT_EVIDENCE_INVALID", { reason: "duplicate-evidence-ref" });
  return normalized.sort((left, right) =>
    `${left.kind}\0${left.id}`.localeCompare(`${right.kind}\0${right.id}`),
  );
};

const normalizePrediction = (
  prediction: PostEventPrediction,
  catalog: ReadonlyMap<string, string>,
): PostEventPrediction => {
  const contract = metricContracts[prediction.metric];
  const expectedKey = predictionKey(prediction);
  if (
    !contract ||
    contract.family !== prediction.family ||
    contract.unit !== prediction.unit ||
    prediction.key !== expectedKey ||
    !prediction.scope?.id?.trim() ||
    !Number.isFinite(prediction.value) ||
    !["lower", "higher", "target"].includes(prediction.betterWhen) ||
    !Number.isFinite(prediction.tolerance?.absolute) ||
    prediction.tolerance.absolute < 0 ||
    !Number.isFinite(prediction.tolerance?.relative) ||
    prediction.tolerance.relative < 0 ||
    prediction.tolerance.relative > 1
  )
    fail("POST_EVENT_INVALID", { reason: "prediction-invalid", predictionKey: prediction.key });
  const evidenceRefs = normalizeEvidenceRefs(prediction.evidenceRefs, catalog);
  if (evidenceRefs.some(({ kind }) => !["accepted-plan", "runbook", "scenario-run"].includes(kind)))
    fail("POST_EVENT_EVIDENCE_INVALID", { reason: "prediction-must-use-pre-event-evidence", predictionKey: prediction.key });
  return {
    ...clone(prediction),
    scope: { ...prediction.scope, id: prediction.scope.id.trim() },
    evidenceRefs,
  };
};

const actorEvidence = (command: PostEventReviewCommandContext, occurredAt: string): PostEventActorEvidence => {
  if (!["human", "agent", "system"].includes(command.actorType))
    fail("POST_EVENT_INVALID", { reason: "actor-type-invalid" });
  if (!["studio", "webmcp", "mcp", "system", "agent-tool"].includes(command.source))
    fail("POST_EVENT_INVALID", { reason: "source-invalid" });
  return {
    actorType: command.actorType,
    actorId: text(command.actorId, "actor-id-required"),
    source: command.source,
    sessionId: text(command.sessionId, "session-id-required"),
    occurredAt,
  };
};

const stateFingerprint = (review: PostEventReview): string =>
  stableFingerprint("post-event-state", {
    id: review.id,
    source: review.source,
    baselineFingerprint: review.baseline.fingerprint,
    predictions: review.predictions,
    observations: review.observations,
    lessons: review.lessons,
    templateProposals: review.templateProposals,
    revision: review.revision,
  });

const baselineFingerprint = (review: Pick<PostEventReview, "source" | "baseline">): string =>
  stableFingerprint("post-event-baseline", {
    source: review.source,
    runbook: review.baseline.runbook,
    occupancyMonitor: review.baseline.occupancyMonitor,
    occupancyProjection: review.baseline.occupancyProjection,
    incidentRegister: review.baseline.incidentRegister,
    deviationRegister: review.baseline.deviationRegister,
    scenarioRuns: review.baseline.scenarioRuns,
  });

const assertRevision = (review: PostEventReview, expectedRevision: number): void => {
  if (!Number.isInteger(expectedRevision) || expectedRevision !== review.revision)
    fail("POST_EVENT_REVISION_CONFLICT", {
      reviewId: review.id,
      expectedRevision,
      currentRevision: review.revision,
    });
};

type MutatingCommandShape = PostEventReviewCommandContext & Readonly<{ type: string }>;

const semanticInput = (command: MutatingCommandShape): object => {
  const { committedAt: _committedAt, expectedRevision: _expectedRevision, ...semantic } = command;
  return semantic;
};

const operationFor = (
  command: RecordPostEventObservationCommand | RecordPostEventLessonCommand | CreateTemplateImprovementProposalCommand | ReviewTemplateImprovementProposalCommand,
): PostEventReviewReceipt["operation"] => {
  if (command.type === "record_post_event_observation") return "record-observation";
  if (command.type === "record_post_event_lesson") return "record-lesson";
  if (command.type === "create_template_improvement_proposal") return "create-template-proposal";
  return "review-template-proposal";
};

const transitionTypeFor = (
  command: RecordPostEventObservationCommand | RecordPostEventLessonCommand | CreateTemplateImprovementProposalCommand | ReviewTemplateImprovementProposalCommand,
): PostEventReviewTransition["type"] => {
  if (command.type === "record_post_event_observation") return "post-event.observation-recorded";
  if (command.type === "record_post_event_lesson") return "post-event.lesson-recorded";
  if (command.type === "create_template_improvement_proposal") return "post-event.template-proposal-created";
  return "post-event.template-proposal-reviewed";
};

const inputFingerprintFor = (command: MutatingCommandShape): string =>
  stableFingerprint(`post-event-command:${command.type}`, semanticInput(command));

const retryFor = (
  review: PostEventReview,
  command: MutatingCommandShape,
): PostEventReviewReceipt | null => {
  if (!command.idempotencyKey) fail("IDEMPOTENCY_KEY_REQUIRED", { commandType: command.type });
  const receipt = review.receipts.find((candidate) => candidate.idempotencyKey === command.idempotencyKey);
  if (!receipt) return null;
  if (receipt.inputFingerprint !== inputFingerprintFor(command))
    fail("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
  return receipt;
};

const subjectForReceipt = (review: PostEventReview, receipt: PostEventReviewReceipt) => {
  if (receipt.operation === "record-observation")
    return review.observations.find(({ id }) => id === receipt.subjectId) ?? fail("POST_EVENT_INVALID", { reason: "receipt-subject-missing" });
  if (receipt.operation === "record-lesson")
    return review.lessons.find(({ id }) => id === receipt.subjectId) ?? fail("POST_EVENT_INVALID", { reason: "receipt-subject-missing" });
  return review.templateProposals.find(({ id }) => id === receipt.subjectId) ?? fail("POST_EVENT_INVALID", { reason: "receipt-subject-missing" });
};

const appendMutation = (
  review: PostEventReview,
  command: RecordPostEventObservationCommand | RecordPostEventLessonCommand | CreateTemplateImprovementProposalCommand | ReviewTemplateImprovementProposalCommand,
  subject: PostEventObservation | PostEventLesson | TemplateImprovementProposal,
  update: Pick<PostEventReview, "observations" | "lessons" | "templateProposals">,
  details: PostEventReviewTransition["details"],
  committedAt: string,
): PostEventReviewMutationResult => {
  const actor = actorEvidence(command, committedAt);
  const inputFingerprint = inputFingerprintFor(command);
  const nextRevision = review.revision + 1;
  const receipt: PostEventReviewReceipt = {
    id: stableFingerprint("post-event-receipt", { reviewId: review.id, inputFingerprint }),
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    operation: operationFor(command),
    subjectId: subject.id,
    aggregateRevision: nextRevision,
    ledgerSequence: review.ledger.length + 1,
    acceptedAt: committedAt,
  };
  const nextWithoutTransition: PostEventReview = {
    ...clone(review),
    ...clone(update),
    receipts: [...review.receipts.map(clone), receipt],
    revision: nextRevision,
    updatedAt: committedAt,
  };
  const transition: PostEventReviewTransition = {
    id: stableFingerprint("post-event-transition", { reviewId: review.id, inputFingerprint }),
    sequence: review.transitions.length + 1,
    type: transitionTypeFor(command),
    subjectId: subject.id,
    fromRevision: review.revision,
    toRevision: nextRevision,
    actor,
    details: clone(details),
    resultingStateFingerprint: stateFingerprint(nextWithoutTransition),
    receiptFingerprint: stableFingerprint("post-event-receipt-evidence", receipt),
  };
  const previousHash = review.ledger.at(-1)?.hash ?? review.source.deviationLedgerHeadHash;
  const unsigned: Omit<PostEventReviewLedgerEntry, "hash"> = {
    id: `post-event-ledger-${String(review.ledger.length + 1).padStart(6, "0")}`,
    schemaVersion: 1,
    sequence: review.ledger.length + 1,
    type: transition.type,
    transitionId: transition.id,
    subjectId: subject.id,
    actor: clone(actor),
    details: clone(details),
    resultingStateFingerprint: transition.resultingStateFingerprint,
    receiptFingerprint: transition.receiptFingerprint,
    previousHash,
  };
  const ledger = { ...unsigned, hash: stableFingerprint("post-event-ledger", unsigned) };
  const next: PostEventReview = {
    ...nextWithoutTransition,
    transitions: [...review.transitions.map(clone), transition],
    ledger: [...review.ledger.map(clone), ledger],
  };
  return freeze({ review: next, subject, receipt, duplicate: false });
};

export function createPostEventReview({
  projectId,
  runbook,
  occupancyMonitor,
  occupancyProjection,
  incidentRegister,
  deviationRegister,
  scenarioRuns,
  predictions,
  createdAt = new Date().toISOString(),
  createdBy,
}: CreatePostEventReviewCommand): Readonly<PostEventReview> {
  const at = instant(createdAt, "created-at-invalid");
  const plan = runbook?.baseline?.acceptedPlan;
  const brief = runbook?.baseline?.acceptedBrief;
  const runbookIntegrity = verifyRunbookLedger(runbook);
  const occupancyIntegrity = verifyOccupancyLedger(occupancyMonitor);
  const incidentIntegrity = verifyIncidentLedger(incidentRegister);
  const deviationIntegrity = verifyDeviationLedger(deviationRegister);
  if (
    !projectId ||
    !plan ||
    !brief ||
    runbook.source.projectId !== projectId ||
    fingerprintPlan(plan) !== runbook.source.planFingerprint ||
    fingerprintEventBrief(brief) !== runbook.source.briefFingerprint ||
    runbook.baseline.fingerprint !== stableFingerprint("runbook-baseline", {
      acceptedPlan: plan,
      acceptedBrief: brief,
      staffingEvidence: runbook.baseline.staffingEvidence,
    }) ||
    runbookIntegrity.status !== "pass" ||
    occupancyIntegrity.status !== "pass" ||
    incidentIntegrity.status !== "pass" ||
    deviationIntegrity.status !== "pass" ||
    occupancyMonitor.projectId !== projectId ||
    incidentRegister.projectId !== projectId ||
    deviationRegister.projectId !== projectId ||
    occupancyMonitor.runbookVersionId !== runbook.versionId ||
    incidentRegister.runbookVersionId !== runbook.versionId ||
    deviationRegister.runbookVersionId !== runbook.versionId ||
    occupancyProjection.monitorId !== occupancyMonitor.id ||
    occupancyProjection.runbookVersionId !== runbook.versionId ||
    !Number.isFinite(Date.parse(occupancyProjection.evaluatedAt)) ||
    occupancyMonitor.source.planId !== runbook.source.planId ||
    occupancyMonitor.source.planVersion !== runbook.source.planVersion ||
    occupancyMonitor.source.planFingerprint !== runbook.source.planFingerprint ||
    occupancyMonitor.source.runbookDefinitionFingerprint !== runbook.definitionFingerprint ||
    occupancyMonitor.source.runbookLedgerHeadHash !== (runbookIntegrity.headHash ?? runbook.source.sourceLedgerHeadHash) ||
    occupancyMonitor.baseline.fingerprint !== stableFingerprint("occupancy-baseline", {
      planId: occupancyMonitor.baseline.planId,
      planVersion: occupancyMonitor.baseline.planVersion,
      planFingerprint: occupancyMonitor.baseline.planFingerprint,
      attendeeTarget: occupancyMonitor.baseline.attendeeTarget,
      scopes: occupancyMonitor.baseline.scopes,
      simulation: occupancyMonitor.baseline.simulation,
    }) ||
    incidentRegister.source.planId !== runbook.source.planId ||
    incidentRegister.source.planVersion !== runbook.source.planVersion ||
    incidentRegister.source.planFingerprint !== runbook.source.planFingerprint ||
    incidentRegister.source.runbookDefinitionFingerprint !== runbook.definitionFingerprint ||
    incidentRegister.source.runbookLedgerHeadHash !== (runbookIntegrity.headHash ?? runbook.source.sourceLedgerHeadHash) ||
    deviationRegister.source.planId !== runbook.source.planId ||
    deviationRegister.source.planVersion !== runbook.source.planVersion ||
    deviationRegister.source.planFingerprint !== runbook.source.planFingerprint
    || deviationRegister.source.runbookDefinitionFingerprint !== runbook.definitionFingerprint
    || deviationRegister.source.runbookLedgerHeadHash !== (runbookIntegrity.headHash ?? runbook.source.sourceLedgerHeadHash)
  )
    fail("POST_EVENT_BASELINE_INVALID", { reason: "source-lineage-mismatch" });
  if (new Set(scenarioRuns.map(({ id }) => id)).size !== scenarioRuns.length)
    fail("POST_EVENT_BASELINE_INVALID", { reason: "scenario-run-ids-invalid" });
  for (const run of scenarioRuns) {
    if (
      !run.id ||
      !run.inputFingerprint ||
      run.status !== "completed" ||
      run.planId !== plan.id ||
      run.planVersion !== String(plan.version) ||
      !run.completedAt ||
      !run.result
    )
      fail("POST_EVENT_BASELINE_INVALID", { reason: "scenario-run-not-completed-for-accepted-plan", runId: run.id });
  }
  const source: PostEventReview["source"] = {
    planId: plan.id,
    planVersion: plan.version,
    planFingerprint: runbook.source.planFingerprint,
    runbookFingerprint: evidenceFingerprint("runbook", runbook),
    runbookLedgerHeadHash: runbookIntegrity.headHash ?? runbook.source.sourceLedgerHeadHash,
    occupancyMonitorFingerprint: evidenceFingerprint("occupancy-monitor", occupancyMonitor),
    occupancyProjectionFingerprint: evidenceFingerprint("occupancy-projection", occupancyProjection),
    occupancyLedgerHeadHash: occupancyIntegrity.headHash ?? occupancyMonitor.source.runbookLedgerHeadHash,
    incidentRegisterFingerprint: evidenceFingerprint("incident-register", incidentRegister),
    incidentLedgerHeadHash: incidentIntegrity.headHash ?? incidentRegister.source.runbookLedgerHeadHash,
    deviationRegisterFingerprint: evidenceFingerprint("deviation-register", deviationRegister),
    deviationLedgerHeadHash: deviationIntegrity.headHash ?? deviationRegister.source.runbookLedgerHeadHash,
    scenarioRunFingerprints: Object.fromEntries(
      scenarioRuns
        .map((run) => [run.id, evidenceFingerprint("scenario-run", run)] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
  const baselineSeed = {
    runbook: clone(runbook),
    occupancyMonitor: clone(occupancyMonitor),
    occupancyProjection: clone(occupancyProjection),
    incidentRegister: clone(incidentRegister),
    deviationRegister: clone(deviationRegister),
    scenarioRuns: scenarioRuns.map(clone).sort((left, right) => left.id.localeCompare(right.id)),
  };
  const catalog = evidenceCatalog({ source, baseline: { ...baselineSeed, fingerprint: "" } });
  if (!Array.isArray(predictions) || predictions.length === 0)
    fail("POST_EVENT_INVALID", { reason: "prediction-required" });
  const normalizedPredictions = predictions.map((prediction) => normalizePrediction(prediction, catalog));
  if (new Set(normalizedPredictions.map(({ key }) => key)).size !== normalizedPredictions.length)
    fail("POST_EVENT_INVALID", { reason: "prediction-key-conflict" });
  const baselineWithoutFingerprint = clone(baselineSeed);
  const baseline = {
    ...baselineWithoutFingerprint,
    fingerprint: stableFingerprint("post-event-baseline", {
      source,
      ...baselineWithoutFingerprint,
    }),
  };
  const review: PostEventReview = {
    schemaVersion: 1,
    id: `post-event-${runbook.versionId}`,
    projectId,
    runbookVersionId: runbook.versionId,
    source,
    baseline,
    predictions: normalizedPredictions.sort((left, right) => left.key.localeCompare(right.key)),
    observations: [],
    lessons: [],
    templateProposals: [],
    transitions: [],
    receipts: [],
    ledger: [],
    revision: 0,
    createdAt: at,
    createdBy: text(createdBy, "created-by-required"),
    updatedAt: at,
  };
  return freeze(review);
}

export function comparePostEventOutcomes(review: PostEventReview): readonly PostEventComparison[] {
  return freeze(review.predictions.map((prediction) => {
    const observation = review.observations.find(({ predictionKey: key }) => key === prediction.key) ?? null;
    const tolerance = Math.max(prediction.tolerance.absolute, Math.abs(prediction.value) * prediction.tolerance.relative);
    const delta = observation?.value == null ? null : observation.value - prediction.value;
    let status: PostEventComparison["status"] = "insufficient-evidence";
    if (delta !== null && observation?.confidence !== "unavailable") {
      if (Math.abs(delta) <= tolerance) status = "matched";
      else if (prediction.betterWhen === "target") status = "worse";
      else if (prediction.betterWhen === "lower") status = delta < 0 ? "better" : "worse";
      else status = delta > 0 ? "better" : "worse";
    }
    const comparisonSeed = { key: prediction.key, prediction, observation, status, delta, tolerance };
    return { ...clone(comparisonSeed), comparisonFingerprint: stableFingerprint("post-event-comparison", comparisonSeed) };
  }).sort((left, right) => left.key.localeCompare(right.key)));
}

export function recordPostEventObservation(
  review: PostEventReview,
  command: RecordPostEventObservationCommand,
  { committedAt = command.committedAt ?? new Date().toISOString() }: { committedAt?: string } = {},
): PostEventReviewMutationResult {
  const retry = retryFor(review, command);
  if (retry) return freeze({ review, subject: clone(subjectForReceipt(review, retry)), receipt: clone(retry), duplicate: true });
  assertRevision(review, command.expectedRevision);
  const id = text(command.observationId, "observation-id-required");
  if (review.observations.some((candidate) => candidate.id === id || candidate.predictionKey === command.predictionKey))
    fail("POST_EVENT_OBSERVATION_CONFLICT", { observationId: id, predictionKey: command.predictionKey });
  const prediction = review.predictions.find(({ key }) => key === command.predictionKey) ??
    fail("POST_EVENT_COMPARISON_NOT_FOUND", { comparisonKey: command.predictionKey });
  const isUnavailable = command.confidence === "unavailable";
  if (
    !["measured", "estimated", "unavailable"].includes(command.confidence) ||
    (isUnavailable && command.value !== null) ||
    (!isUnavailable && (command.value === null || !Number.isFinite(command.value)))
  )
    fail("POST_EVENT_INVALID", { reason: "observation-value-confidence-mismatch" });
  const at = instant(committedAt, "committed-at-invalid");
  const observation: PostEventObservation = {
    schemaVersion: 1,
    id,
    predictionKey: prediction.key,
    family: prediction.family,
    metric: prediction.metric,
    scope: clone(prediction.scope),
    value: command.value,
    unit: prediction.unit,
    confidence: command.confidence,
    evidenceRefs: normalizeEvidenceRefs(command.evidenceRefs, evidenceCatalog(review)),
    recorded: actorEvidence(command, at),
  };
  return appendMutation(
    review,
    command,
    observation,
    { observations: [...review.observations.map(clone), observation], lessons: review.lessons, templateProposals: review.templateProposals },
    { predictionKey: prediction.key, family: prediction.family, metric: prediction.metric, confidence: observation.confidence },
    at,
  );
}

export function recordPostEventLesson(
  review: PostEventReview,
  command: RecordPostEventLessonCommand,
  { committedAt = command.committedAt ?? new Date().toISOString() }: { committedAt?: string } = {},
): PostEventReviewMutationResult {
  const retry = retryFor(review, command);
  if (retry) return freeze({ review, subject: clone(subjectForReceipt(review, retry)), receipt: clone(retry), duplicate: true });
  assertRevision(review, command.expectedRevision);
  const lessonId = text(command.lessonId, "lesson-id-required");
  if (review.lessons.some(({ id }) => id === lessonId)) fail("POST_EVENT_INVALID", { reason: "lesson-id-conflict", lessonId });
  const comparison = comparePostEventOutcomes(review).find(({ key }) => key === command.comparisonKey) ??
    fail("POST_EVENT_COMPARISON_NOT_FOUND", { comparisonKey: command.comparisonKey });
  const requirementIds = unique(command.requirementIds, "requirement-ids-invalid");
  const constraintIds = unique(command.constraintIds, "constraint-ids-invalid");
  const requirementCatalog = new Set(review.baseline.runbook.baseline.acceptedBrief.requirements.map(({ id }) => id));
  const constraintCatalog = new Set(review.baseline.runbook.baseline.acceptedPlan.constraints.map(({ id }) => id));
  if (requirementIds.some((id) => !requirementCatalog.has(id)) || constraintIds.some((id) => !constraintCatalog.has(id)))
    fail("POST_EVENT_INVALID", { reason: "lesson-link-not-in-frozen-baseline" });
  if (requirementIds.length === 0 && constraintIds.length === 0)
    fail("POST_EVENT_INVALID", { reason: "lesson-link-required" });
  const at = instant(committedAt, "committed-at-invalid");
  const lesson: PostEventLesson = {
    schemaVersion: 1,
    id: lessonId,
    comparisonKey: comparison.key,
    family: comparison.prediction.family,
    lessonCode: code(command.lessonCode, "lesson-code-invalid"),
    findingCode: code(command.findingCode, "finding-code-invalid"),
    recommendedActionCode: code(command.recommendedActionCode, "recommended-action-code-invalid"),
    requirementIds,
    constraintIds,
    recorded: actorEvidence(command, at),
  };
  return appendMutation(
    review,
    command,
    lesson,
    { observations: review.observations, lessons: [...review.lessons.map(clone), lesson], templateProposals: review.templateProposals },
    { comparisonKey: lesson.comparisonKey, family: lesson.family, requirementIds, constraintIds },
    at,
  );
}

const boundTemplate = (
  review: PostEventReview,
  target: TemplateImprovementProposal["target"],
): TemplateImprovementProposal["target"] => {
  const binding = review.baseline.runbook.baseline.acceptedPlan.templateBindings?.[target.kind];
  if (!binding || binding.templateId !== target.templateId || binding.version !== target.version)
    fail("POST_EVENT_TEMPLATE_PROPOSAL_INVALID", { reason: "template-not-in-frozen-plan" });
  return clone(target);
};

const validateChanges = (changes: readonly PlanningChange[]): PlanningChange[] => {
  if (!Array.isArray(changes) || changes.length === 0 || changes.length > 100)
    fail("POST_EVENT_TEMPLATE_PROPOSAL_INVALID", { reason: "changes-required" });
  if (changes.some((change) => !change?.id?.trim()) || new Set(changes.map(({ id }) => id)).size !== changes.length)
    fail("POST_EVENT_TEMPLATE_PROPOSAL_INVALID", { reason: "change-ids-invalid" });
  return changes.map(clone);
};

export function createTemplateImprovementProposal(
  review: PostEventReview,
  command: CreateTemplateImprovementProposalCommand,
  { committedAt = command.committedAt ?? new Date().toISOString() }: { committedAt?: string } = {},
): PostEventReviewMutationResult {
  const retry = retryFor(review, command);
  if (retry) return freeze({ review, subject: clone(subjectForReceipt(review, retry)), receipt: clone(retry), duplicate: true });
  assertRevision(review, command.expectedRevision);
  const proposalId = text(command.proposalId, "proposal-id-required");
  if (review.templateProposals.some(({ id }) => id === proposalId))
    fail("POST_EVENT_TEMPLATE_PROPOSAL_INVALID", { reason: "proposal-id-conflict", proposalId });
  const changes = validateChanges(command.changes);
  if (!Array.isArray(command.changeLessonLinks) || command.changeLessonLinks.length !== changes.length)
    fail("POST_EVENT_TEMPLATE_PROPOSAL_INVALID", { reason: "every-change-needs-one-trace" });
  const comparisonByKey = new Map(comparePostEventOutcomes(review).map((comparison) => [comparison.key, comparison]));
  const linksByChange = new Map(command.changeLessonLinks.map((link) => [link.changeId, link.lessonIds]));
  if (linksByChange.size !== changes.length || changes.some(({ id }) => !linksByChange.has(id)))
    fail("POST_EVENT_TEMPLATE_PROPOSAL_INVALID", { reason: "change-trace-mismatch" });
  const traces = changes.map(({ id: changeId }) => {
    const lessonIds = unique(linksByChange.get(changeId) ?? [], "lesson-ids-invalid");
    if (!lessonIds.length) fail("POST_EVENT_TEMPLATE_PROPOSAL_INVALID", { reason: "change-lesson-required", changeId });
    const lessons = lessonIds.map((lessonId) =>
      review.lessons.find(({ id }) => id === lessonId) ?? fail("POST_EVENT_LESSON_NOT_FOUND", { lessonId }),
    );
    const comparisons = lessons.map((lesson) => comparisonByKey.get(lesson.comparisonKey) ??
      fail("POST_EVENT_COMPARISON_NOT_FOUND", { comparisonKey: lesson.comparisonKey }));
    if (comparisons.some((comparison) => comparison.status === "insufficient-evidence" || !comparison.observation))
      fail("POST_EVENT_TEMPLATE_PROPOSAL_INVALID", { reason: "observed-evidence-required", changeId });
    return {
      changeId,
      lessonIds,
      comparisonKeys: unique(comparisons.map(({ key }) => key), "comparison-keys-invalid"),
      observationIds: unique(comparisons.flatMap(({ observation }) => observation ? [observation.id] : []), "observation-ids-invalid"),
    };
  });
  const at = instant(committedAt, "committed-at-invalid");
  const actor = actorEvidence(command, at);
  const proposal: TemplateImprovementProposal = {
    schemaVersion: 1,
    id: proposalId,
    revision: 1,
    status: "pending-human-review",
    target: boundTemplate(review, command.target),
    proposal: {
      id: proposalId,
      baseVersion: String(review.source.planVersion),
      revision: 1,
      status: "review",
      goal: text(command.goal, "proposal-goal-required"),
      changes: changes.map((change, index) => ({
        ...change,
        number: index + 1,
        lineage: { kind: "post-event-review", reviewId: review.id, lessonIds: traces[index]?.lessonIds ?? [] },
      })),
      waivers: [],
      validation: null,
      lineage: [{ kind: "post-event-review", reviewId: review.id, baselineFingerprint: review.baseline.fingerprint }],
    },
    traces,
    created: actor,
    review: null,
    publicationStatus: "not-published",
  };
  return appendMutation(
    review,
    command,
    proposal,
    { observations: review.observations, lessons: review.lessons, templateProposals: [...review.templateProposals.map(clone), proposal] },
    { targetKind: proposal.target.kind, templateId: proposal.target.templateId, templateVersion: proposal.target.version, changeIds: changes.map(({ id }) => id).sort() },
    at,
  );
}

export function reviewTemplateImprovementProposal(
  review: PostEventReview,
  command: ReviewTemplateImprovementProposalCommand,
  { committedAt = command.committedAt ?? new Date().toISOString() }: { committedAt?: string } = {},
): PostEventReviewMutationResult {
  const retry = retryFor(review, command);
  if (retry) return freeze({ review, subject: clone(subjectForReceipt(review, retry)), receipt: clone(retry), duplicate: true });
  assertRevision(review, command.expectedRevision);
  if (command.actorType !== "human") fail("POST_EVENT_HUMAN_REQUIRED", { proposalId: command.proposalId });
  const current = review.templateProposals.find(({ id }) => id === command.proposalId) ??
    fail("POST_EVENT_TEMPLATE_PROPOSAL_NOT_FOUND", { proposalId: command.proposalId });
  if (!Number.isInteger(command.expectedProposalRevision) || current.revision !== command.expectedProposalRevision)
    fail("POST_EVENT_REVISION_CONFLICT", { proposalId: current.id, expectedProposalRevision: command.expectedProposalRevision, currentProposalRevision: current.revision });
  if (current.status !== "pending-human-review")
    fail("POST_EVENT_REVIEW_TRANSITION_INVALID", { proposalId: current.id, fromStatus: current.status });
  if (!["approved", "rejected"].includes(command.decision))
    fail("POST_EVENT_REVIEW_TRANSITION_INVALID", { proposalId: current.id, decision: command.decision });
  const at = instant(committedAt, "committed-at-invalid");
  const actor = actorEvidence(command, at);
  const proposal: TemplateImprovementProposal = {
    ...clone(current),
    revision: current.revision + 1,
    status: command.decision === "approved" ? "approved-recommendation" : "rejected",
    review: { ...actor, decision: command.decision, reasonCode: code(command.reasonCode, "review-reason-code-invalid") },
    publicationStatus: "not-published",
  };
  return appendMutation(
    review,
    command,
    proposal,
    { observations: review.observations, lessons: review.lessons, templateProposals: review.templateProposals.map((candidate) => candidate.id === proposal.id ? proposal : clone(candidate)) },
    { decision: command.decision, reasonCode: proposal.review?.reasonCode ?? null, publicationStatus: proposal.publicationStatus },
    at,
  );
}

export function inspectPostEventReview(review: PostEventReview) {
  return freeze({
    review: clone(review),
    comparisons: comparePostEventOutcomes(review),
    integrity: verifyPostEventReviewLedger(review),
  });
}

export function verifyPostEventReviewLedger(review: PostEventReview): Readonly<{
  status: "pass" | "fail";
  entries: number;
  headHash: string | null;
  sequence: number | null;
}> {
  const invalid = (sequence: number | null) => ({ status: "fail" as const, entries: review.ledger.length, headHash: null, sequence });
  if (
    review.baseline.fingerprint !== baselineFingerprint(review) ||
    review.source.planFingerprint !== fingerprintPlan(review.baseline.runbook.baseline.acceptedPlan) ||
    review.source.runbookFingerprint !== evidenceFingerprint("runbook", review.baseline.runbook) ||
    review.source.occupancyMonitorFingerprint !== evidenceFingerprint("occupancy-monitor", review.baseline.occupancyMonitor) ||
    review.source.occupancyProjectionFingerprint !== evidenceFingerprint("occupancy-projection", review.baseline.occupancyProjection) ||
    review.source.incidentRegisterFingerprint !== evidenceFingerprint("incident-register", review.baseline.incidentRegister) ||
    review.source.deviationRegisterFingerprint !== evidenceFingerprint("deviation-register", review.baseline.deviationRegister) ||
    verifyRunbookLedger(review.baseline.runbook).status !== "pass" ||
    verifyOccupancyLedger(review.baseline.occupancyMonitor).status !== "pass" ||
    verifyIncidentLedger(review.baseline.incidentRegister).status !== "pass" ||
    verifyDeviationLedger(review.baseline.deviationRegister).status !== "pass" ||
    !same(review.source.scenarioRunFingerprints, Object.fromEntries(review.baseline.scenarioRuns
      .map((run) => [run.id, evidenceFingerprint("scenario-run", run)] as const)
      .sort(([a], [b]) => a.localeCompare(b)))) ||
    review.ledger.length !== review.transitions.length ||
    review.ledger.length !== review.receipts.length ||
    review.revision !== review.ledger.length
  ) return invalid(null);
  let previousHash = review.source.deviationLedgerHeadHash;
  for (let index = 0; index < review.ledger.length; index += 1) {
    const entry = review.ledger[index];
    const transition = review.transitions[index];
    const receipt = review.receipts[index];
    if (!entry || !transition || !receipt) return invalid(index + 1);
    const { hash, ...unsigned } = entry;
    if (
      entry.sequence !== index + 1 ||
      transition.sequence !== index + 1 ||
      entry.previousHash !== previousHash ||
      entry.transitionId !== transition.id ||
      entry.type !== transition.type ||
      entry.subjectId !== transition.subjectId ||
      entry.resultingStateFingerprint !== transition.resultingStateFingerprint ||
      entry.receiptFingerprint !== transition.receiptFingerprint ||
      entry.receiptFingerprint !== stableFingerprint("post-event-receipt-evidence", receipt) ||
      receipt.ledgerSequence !== entry.sequence ||
      receipt.aggregateRevision !== transition.toRevision ||
      hash !== stableFingerprint("post-event-ledger", { ...unsigned, previousHash })
    ) return invalid(index + 1);
    previousHash = hash;
  }
  const last = review.transitions.at(-1);
  if (last && last.resultingStateFingerprint !== stateFingerprint(review)) return invalid(last.sequence);
  return { status: "pass", entries: review.ledger.length, headHash: review.ledger.at(-1)?.hash ?? review.source.deviationLedgerHeadHash, sequence: null };
}

export function exportPostEventReport(
  review: PostEventReview,
  { format, exportedAt = new Date().toISOString() }: { format: "json" | "text"; exportedAt?: string },
) {
  const at = instant(exportedAt, "exported-at-invalid");
  const integrity = verifyPostEventReviewLedger(review);
  if (integrity.status !== "pass") fail("POST_EVENT_LEDGER_INTEGRITY_FAILED", { sequence: integrity.sequence });
  const comparisons = comparePostEventOutcomes(review);
  const report = {
    schemaVersion: 1,
    kind: "venuemind-post-event-review",
    exportedAt: at,
    identity: { reviewId: review.id, projectId: review.projectId, runbookVersionId: review.runbookVersionId, revision: review.revision },
    source: clone(review.source),
    predictions: review.predictions.map(clone),
    observations: review.observations.map(clone),
    comparisons: comparisons.map(clone),
    lessons: review.lessons.map(clone),
    templateImprovementRecommendations: review.templateProposals.map(clone),
    integrity,
    ledger: review.ledger.map(clone),
  };
  if (format === "json")
    return freeze({ filename: `${review.id}.json`, mimeType: "application/json", content: JSON.stringify(report, null, 2) });
  const lines = [
    `POST-EVENT REVIEW ${review.id}`,
    `PROJECT ${review.projectId}`,
    `RUNBOOK ${review.runbookVersionId}`,
    `REVISION ${review.revision}`,
    `INTEGRITY ${integrity.status.toUpperCase()} ${integrity.headHash ?? "NONE"}`,
    "",
    "OUTCOMES",
    ...comparisons.map((comparison) => `${comparison.key} | ${comparison.status.toUpperCase()} | predicted=${comparison.prediction.value} ${comparison.prediction.unit} | observed=${comparison.observation?.value ?? "UNAVAILABLE"}`),
    "",
    "LESSONS",
    ...review.lessons.map((lesson) => `${lesson.id} | ${lesson.findingCode} | ${lesson.recommendedActionCode}`),
    "",
    "TEMPLATE RECOMMENDATIONS",
    ...review.templateProposals.map((proposal) => `${proposal.id} | ${proposal.status.toUpperCase()} | ${proposal.publicationStatus.toUpperCase()}`),
  ];
  return freeze({ filename: `${review.id}.txt`, mimeType: "text/plain", content: lines.join("\n") });
}
