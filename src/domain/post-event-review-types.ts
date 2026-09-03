import type { VenueProposal } from "./geometry.ts";
import type {
  ActorType,
  EventDayRunbook,
  IncidentRegister,
  LiveOccupancyMonitor,
  LivePlanDeviationRegister,
  OccupancyProjection,
  OperationalSource,
} from "./operational-types.ts";
import type { PlanningChange } from "./planning-effects.ts";
import type { ScenarioRun } from "./venue-planner.ts";

export type PostEventOutcomeFamily = "occupancy" | "queue" | "flow" | "incidents";
export type PostEventComparisonStatus = "matched" | "better" | "worse" | "insufficient-evidence";
export type PostEventMetric =
  | "peak-persons"
  | "utilization-ratio"
  | "average-wait-seconds"
  | "p95-wait-seconds"
  | "maximum-queue-persons"
  | "abandonment-ratio"
  | "clearance-seconds"
  | "peak-congestion-index"
  | "backlog-persons"
  | "incident-count"
  | "resolution-seconds";
export type PostEventMetricUnit = "persons" | "ratio" | "seconds" | "index" | "incidents";
export type PostEventScope = Readonly<{
  kind: "venue" | "occupancy-zone" | "queue" | "route" | "incident-category";
  id: string;
}>;
export type PostEventEvidenceKind =
  | "accepted-plan"
  | "runbook"
  | "occupancy-monitor"
  | "occupancy-projection"
  | "incident-register"
  | "deviation-register"
  | "scenario-run";
export interface PostEventEvidenceRef {
  readonly kind: PostEventEvidenceKind;
  readonly id: string;
  readonly fingerprint: string;
}
export interface PostEventActorEvidence {
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly source: OperationalSource;
  readonly sessionId: string;
  readonly occurredAt: string;
}
export interface PostEventPrediction {
  readonly key: string;
  readonly family: PostEventOutcomeFamily;
  readonly metric: PostEventMetric;
  readonly scope: PostEventScope;
  readonly value: number;
  readonly unit: PostEventMetricUnit;
  readonly betterWhen: "lower" | "higher" | "target";
  readonly tolerance: Readonly<{ absolute: number; relative: number }>;
  readonly evidenceRefs: readonly PostEventEvidenceRef[];
}
export interface PostEventObservation {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly predictionKey: string;
  readonly family: PostEventOutcomeFamily;
  readonly metric: PostEventMetric;
  readonly scope: PostEventScope;
  readonly value: number | null;
  readonly unit: PostEventMetricUnit;
  readonly confidence: "measured" | "estimated" | "unavailable";
  readonly evidenceRefs: readonly PostEventEvidenceRef[];
  readonly recorded: PostEventActorEvidence;
}
export interface PostEventComparison {
  readonly key: string;
  readonly prediction: PostEventPrediction;
  readonly observation: PostEventObservation | null;
  readonly status: PostEventComparisonStatus;
  readonly delta: number | null;
  readonly tolerance: number;
  readonly comparisonFingerprint: string;
}
export interface PostEventLesson {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly comparisonKey: string;
  readonly family: PostEventOutcomeFamily;
  readonly lessonCode: string;
  readonly findingCode: string;
  readonly recommendedActionCode: string;
  readonly requirementIds: readonly string[];
  readonly constraintIds: readonly string[];
  readonly recorded: PostEventActorEvidence;
}
export interface TemplateImprovementChangeTrace {
  readonly changeId: string;
  readonly lessonIds: readonly string[];
  readonly comparisonKeys: readonly string[];
  readonly observationIds: readonly string[];
}
export interface TemplateImprovementProposal {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly revision: number;
  readonly status: "pending-human-review" | "approved-recommendation" | "rejected";
  readonly target: Readonly<{ kind: "venue" | "room"; templateId: string; version: string }>;
  readonly proposal: VenueProposal;
  readonly traces: readonly TemplateImprovementChangeTrace[];
  readonly created: PostEventActorEvidence;
  readonly review:
    | (PostEventActorEvidence & Readonly<{ decision: "approved" | "rejected"; reasonCode: string }>)
    | null;
  readonly publicationStatus: "not-published";
}
export interface PostEventReviewReceipt {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly inputFingerprint: string;
  readonly operation: "record-observation" | "record-lesson" | "create-template-proposal" | "review-template-proposal";
  readonly subjectId: string;
  readonly aggregateRevision: number;
  readonly ledgerSequence: number;
  readonly acceptedAt: string;
}
export interface PostEventReviewTransition {
  readonly id: string;
  readonly sequence: number;
  readonly type:
    | "post-event.observation-recorded"
    | "post-event.lesson-recorded"
    | "post-event.template-proposal-created"
    | "post-event.template-proposal-reviewed";
  readonly subjectId: string;
  readonly fromRevision: number;
  readonly toRevision: number;
  readonly actor: PostEventActorEvidence;
  readonly details: Readonly<Record<string, string | number | boolean | null | readonly string[]>>;
  readonly resultingStateFingerprint: string;
  readonly receiptFingerprint: string;
}
export interface PostEventReviewLedgerEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly type: PostEventReviewTransition["type"];
  readonly transitionId: string;
  readonly subjectId: string;
  readonly actor: PostEventActorEvidence;
  readonly details: PostEventReviewTransition["details"];
  readonly resultingStateFingerprint: string;
  readonly receiptFingerprint: string;
  readonly previousHash: string;
  readonly hash: string;
}
export interface PostEventReview {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly projectId: string;
  readonly runbookVersionId: string;
  readonly source: Readonly<{
    planId: string;
    planVersion: string | number;
    planFingerprint: string;
    runbookFingerprint: string;
    runbookLedgerHeadHash: string;
    occupancyMonitorFingerprint: string;
    occupancyProjectionFingerprint: string;
    occupancyLedgerHeadHash: string;
    incidentRegisterFingerprint: string;
    incidentLedgerHeadHash: string;
    deviationRegisterFingerprint: string;
    deviationLedgerHeadHash: string;
    scenarioRunFingerprints: Readonly<Record<string, string>>;
  }>;
  readonly baseline: Readonly<{
    runbook: EventDayRunbook;
    occupancyMonitor: LiveOccupancyMonitor;
    occupancyProjection: OccupancyProjection;
    incidentRegister: IncidentRegister;
    deviationRegister: LivePlanDeviationRegister;
    scenarioRuns: readonly ScenarioRun[];
    fingerprint: string;
  }>;
  readonly predictions: readonly PostEventPrediction[];
  readonly observations: readonly PostEventObservation[];
  readonly lessons: readonly PostEventLesson[];
  readonly templateProposals: readonly TemplateImprovementProposal[];
  readonly transitions: readonly PostEventReviewTransition[];
  readonly receipts: readonly PostEventReviewReceipt[];
  readonly ledger: readonly PostEventReviewLedgerEntry[];
  readonly revision: number;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
}
export interface PostEventReviewCommandContext {
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly source: OperationalSource;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly expectedRevision: number;
  readonly committedAt?: string;
}
export interface CreatePostEventReviewCommand {
  readonly type: "create_post_event_review";
  readonly projectId: string;
  readonly runbook: EventDayRunbook;
  readonly occupancyMonitor: LiveOccupancyMonitor;
  readonly occupancyProjection: OccupancyProjection;
  readonly incidentRegister: IncidentRegister;
  readonly deviationRegister: LivePlanDeviationRegister;
  readonly scenarioRuns: readonly ScenarioRun[];
  readonly predictions: readonly PostEventPrediction[];
  readonly createdAt?: string;
  readonly createdBy: string;
}
export interface RecordPostEventObservationCommand extends PostEventReviewCommandContext {
  readonly type: "record_post_event_observation";
  readonly observationId: string;
  readonly predictionKey: string;
  readonly value: number | null;
  readonly confidence: PostEventObservation["confidence"];
  readonly evidenceRefs: readonly PostEventEvidenceRef[];
}
export interface RecordPostEventLessonCommand extends PostEventReviewCommandContext {
  readonly type: "record_post_event_lesson";
  readonly lessonId: string;
  readonly comparisonKey: string;
  readonly lessonCode: string;
  readonly findingCode: string;
  readonly recommendedActionCode: string;
  readonly requirementIds: readonly string[];
  readonly constraintIds: readonly string[];
}
export interface CreateTemplateImprovementProposalCommand extends PostEventReviewCommandContext {
  readonly type: "create_template_improvement_proposal";
  readonly proposalId: string;
  readonly goal: string;
  readonly target: TemplateImprovementProposal["target"];
  readonly changes: readonly PlanningChange[];
  readonly changeLessonLinks: readonly Readonly<{ changeId: string; lessonIds: readonly string[] }>[];
}
export interface ReviewTemplateImprovementProposalCommand extends PostEventReviewCommandContext {
  readonly type: "review_template_improvement_proposal";
  readonly proposalId: string;
  readonly expectedProposalRevision: number;
  readonly decision: "approved" | "rejected";
  readonly reasonCode: string;
}
export interface InspectPostEventReviewCommand {
  readonly type: "inspect_post_event_review";
}
export interface ExportPostEventReportCommand {
  readonly type: "export_post_event_report";
  readonly format: "json" | "text";
  readonly exportedAt?: string;
}
export type PostEventReviewCommand =
  | CreatePostEventReviewCommand
  | RecordPostEventObservationCommand
  | RecordPostEventLessonCommand
  | CreateTemplateImprovementProposalCommand
  | ReviewTemplateImprovementProposalCommand
  | InspectPostEventReviewCommand
  | ExportPostEventReportCommand;
export interface PostEventReviewMutationResult {
  readonly review: PostEventReview;
  readonly subject: PostEventObservation | PostEventLesson | TemplateImprovementProposal;
  readonly receipt: PostEventReviewReceipt;
  readonly duplicate: boolean;
}
