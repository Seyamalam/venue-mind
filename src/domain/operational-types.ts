import type { EmergencyPlan, Point, VenuePlan } from "./geometry.ts";
import type { EventBrief } from "./event-brief.ts";

export type { Point, RoomBoundary } from "./geometry.ts";

export type ActorType = "human" | "agent" | "system";
export type OperationalSource = "studio" | "webmcp" | "mcp" | "system" | "agent-tool";

export type OperationalVenuePlan = VenuePlan;
export type OperationalEmergencyPlan = EmergencyPlan;

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentCategory =
  | "accessibility"
  | "crowd-capacity"
  | "medical"
  | "security"
  | "fire-life-safety"
  | "facilities"
  | "production-av"
  | "catering"
  | "staffing"
  | "transport"
  | "weather"
  | "other";
export type IncidentStatus = "open" | "mitigating" | "resolved" | "closed";
export type IncidentEscalationLevel = "none" | "team" | "venue-command" | "emergency-response";

interface IncidentLocationBase {
  readonly planId: string;
  readonly planVersion: string | number;
  readonly planFingerprint: string;
}
export type IncidentLocation =
  | (IncidentLocationBase & Readonly<{ kind: "plan-object"; planObjectId: string }>)
  | (IncidentLocationBase & Readonly<{ kind: "coordinate"; point: Point }>);
export type IncidentLocationInput =
  Readonly<{ kind: "plan-object"; planObjectId: string }> | Readonly<{ kind: "coordinate"; point: Point }>;
export type IncidentRelatedRef = Readonly<{ kind: "occupancy-alert" | "runbook-task" | "plan-object"; id: string }>;
export interface IncidentOwner {
  readonly roleId: string;
  readonly shiftId?: string;
  readonly staffPostObjectId?: string;
  readonly assignmentId?: string;
}
export interface IncidentHandoff {
  readonly id: string;
  readonly fromOwner: IncidentOwner;
  readonly toOwner: IncidentOwner;
  readonly openActionCodes: readonly string[];
  readonly evidenceRefs: readonly IncidentRelatedRef[];
  readonly handedOffAt: string;
  readonly handedOffBy: string;
}
export interface IncidentEmergencyAction {
  readonly id: string;
  readonly planId: string;
  readonly planVersion: string | number;
  readonly planFingerprint: string;
  readonly emergencyPlanFingerprint: string;
  readonly validationId: string;
  readonly approvalLedgerEntryId: string;
  readonly actionCode: string;
  readonly targetObjectIds: readonly string[];
  readonly scenarioDefinitionId?: string;
  readonly authorityRole: string;
  readonly recordedAt: string;
  readonly recordedBy: string;
}
export interface OperationalIncident {
  schemaVersion: 1;
  id: string;
  revision: number;
  severity: IncidentSeverity;
  category: IncidentCategory;
  summaryCode: string;
  status: IncidentStatus;
  acknowledgement: {
    status: "pending" | "acknowledged";
    acknowledgedAt?: string;
    acknowledgedBy?: string;
    reasonCode?: string;
  };
  escalation: { level: IncidentEscalationLevel; escalatedAt?: string; escalatedBy?: string; reasonCode?: string };
  location: IncidentLocation;
  owner: IncidentOwner | null;
  relatedRefs: IncidentRelatedRef[];
  handoffs: IncidentHandoff[];
  emergencyActions: IncidentEmergencyAction[];
  timestamps: {
    reportedAt: string;
    updatedAt: string;
    acknowledgedAt?: string;
    escalatedAt?: string;
    mitigationStartedAt?: string;
    resolvedAt?: string;
    closedAt?: string;
    reopenedAt?: string;
  };
}
export interface IncidentReceipt {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly inputFingerprint: string;
  readonly operation: string;
  readonly incidentId: string;
  readonly incidentRevision: number;
  readonly ledgerSequence: number;
  readonly acceptedAt: string;
}
export interface IncidentTransition {
  readonly id: string;
  readonly sequence: number;
  readonly type: string;
  readonly incidentId: string;
  readonly fromIncidentRevision: number;
  readonly toIncidentRevision: number;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly source: OperationalSource;
  readonly sessionId: string;
  readonly committedAt: string;
  readonly location: IncidentLocation;
  readonly details: object;
  readonly resultingIncidentFingerprint: string;
  readonly receiptFingerprint: string;
}
export interface IncidentLedgerEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly type: string;
  readonly transitionId: string;
  readonly incidentId: string;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly source: OperationalSource;
  readonly sessionId: string;
  readonly committedAt: string;
  readonly location: IncidentLocation;
  readonly details: object;
  readonly resultingIncidentFingerprint: string;
  readonly receiptFingerprint: string;
  readonly previousHash: string;
  readonly hash: string;
}
export interface IncidentRegister {
  schemaVersion: 1;
  id: string;
  projectId: string;
  runbookVersionId: string;
  source: {
    runbookVersionId: string;
    runbookDefinitionFingerprint: string;
    runbookLedgerHeadHash: string;
    planId: string;
    planVersion: string | number;
    planFingerprint: string;
    validationId: string;
    validationInputFingerprint: string;
    approvalLedgerEntryId: string;
    emergencyPlanFingerprint: string | null;
  };
  baseline: {
    acceptedPlan: OperationalVenuePlan;
    emergencyPlan: OperationalEmergencyPlan | null;
    runbookTaskIds: string[];
    fingerprint: string;
  };
  incidents: OperationalIncident[];
  transitions: IncidentTransition[];
  receipts: IncidentReceipt[];
  ledger: IncidentLedgerEntry[];
  revision: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

export interface IncidentCommandContext {
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly source: OperationalSource;
  readonly sessionId: string;
  readonly idempotencyKey: string;
  readonly committedAt?: string;
}
export interface IncidentMutationCommand extends IncidentCommandContext {
  readonly type: string;
  readonly incidentId: string;
  readonly expectedIncidentRevision: number;
}
export type IncidentMutationResult = Readonly<{
  register: IncidentRegister;
  incident: OperationalIncident;
  receipt: IncidentReceipt;
  duplicate: boolean;
}>;
export interface CreateIncidentRegisterCommand {
  readonly type: "create_incident_register";
  readonly projectId: string;
  readonly runbook: EventDayRunbook;
  readonly createdAt?: string;
  readonly createdBy: string;
  readonly actorType?: ActorType;
}
export interface ReportIncidentCommand extends IncidentCommandContext {
  readonly type: "report_incident";
  readonly incidentId: string;
  readonly severity: IncidentSeverity;
  readonly category: IncidentCategory;
  readonly summaryCode: string;
  readonly location: IncidentLocationInput;
  readonly relatedRefs?: readonly IncidentRelatedRef[];
}
export interface ClassifyIncidentCommand extends IncidentMutationCommand {
  readonly type: "classify_incident";
  readonly severity: IncidentSeverity;
  readonly category: IncidentCategory;
  readonly summaryCode: string;
}
export interface SetIncidentOwnerCommand extends IncidentMutationCommand {
  readonly type: "set_incident_owner";
  readonly owner: IncidentOwner;
}
export interface AcknowledgeIncidentCommand extends IncidentMutationCommand {
  readonly type: "acknowledge_incident";
  readonly reasonCode: string;
}
export interface EscalateIncidentCommand extends IncidentMutationCommand {
  readonly type: "escalate_incident";
  readonly level: Exclude<IncidentEscalationLevel, "none">;
  readonly reasonCode: string;
}
export interface RelocateIncidentCommand extends IncidentMutationCommand {
  readonly type: "relocate_incident";
  readonly location: IncidentLocationInput;
  readonly reasonCode: string;
}
export interface TransitionIncidentStatusCommand extends IncidentMutationCommand {
  readonly type: "transition_incident_status";
  readonly toStatus: IncidentStatus;
  readonly reasonCode?: string;
  readonly resolutionCode?: string;
}
export interface HandoffIncidentCommand extends IncidentMutationCommand {
  readonly type: "handoff_incident";
  readonly fromOwner: IncidentOwner;
  readonly toOwner: IncidentOwner;
  readonly openActionCodes: readonly string[];
  readonly evidenceRefs: readonly IncidentRelatedRef[];
}
export interface RecordIncidentEmergencyActionCommand extends IncidentMutationCommand {
  readonly type: "record_incident_emergency_action";
  readonly actionCode: string;
  readonly targetObjectIds: readonly string[];
  readonly scenarioDefinitionId?: string;
  readonly authorityRole: string;
}
export interface InspectIncidentCommand {
  readonly type: "inspect_incident";
  readonly incidentId: string;
}
export interface InspectIncidentsCommand {
  readonly type: "inspect_incidents";
  readonly status?: IncidentStatus;
  readonly severity?: IncidentSeverity;
  readonly category?: IncidentCategory;
}
export interface ExportIncidentRecordCommand {
  readonly type: "export_incident_record";
  readonly incidentId: string;
  readonly exportedAt?: string;
}
export type IncidentCommand =
  | CreateIncidentRegisterCommand
  | ReportIncidentCommand
  | ClassifyIncidentCommand
  | SetIncidentOwnerCommand
  | AcknowledgeIncidentCommand
  | EscalateIncidentCommand
  | RelocateIncidentCommand
  | TransitionIncidentStatusCommand
  | HandoffIncidentCommand
  | RecordIncidentEmergencyActionCommand
  | InspectIncidentCommand
  | InspectIncidentsCommand
  | ExportIncidentRecordCommand;

export type OccupancyConfidence = "low" | "medium" | "high";
export interface AggregateOccupancySignal {
  readonly sourceId: string;
  readonly sourceType: "registration" | "sensor" | "manual-counter";
  readonly sourceVersion: string;
  readonly kind: "check-in" | "zone-occupancy";
  readonly observedAt: string;
  readonly confidence: OccupancyConfidence;
  readonly readings: readonly Readonly<{ scopeId: string; count: number }>[];
}
export interface OccupancyAlert {
  id: string;
  key: string;
  code: "STALE_SOURCE" | "CONFLICTING_FEEDS" | "THRESHOLD_WARNING" | "CAPACITY_EXCEEDED";
  severity: "warning" | "critical";
  status: "open" | "acknowledged";
  scopeId: string | null;
  sourceIds: readonly string[];
  actual: number;
  threshold: number;
  unit: "seconds" | "persons";
  openedAt: string;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  reasonCode?: string;
}
export interface OccupancySource {
  readonly planId: string;
  readonly planVersion: string | number;
  readonly planFingerprint: string;
  readonly runbookDefinitionFingerprint: string;
  readonly runbookLedgerHeadHash: string;
}
export interface OccupancyScopeBaseline {
  readonly scopeId: string;
  readonly kind: "check-in" | "venue" | "zone";
  readonly label: string;
  readonly target: number;
  readonly capacity: number;
}
export interface OccupancySimulationBaseline {
  readonly runId: string;
  readonly planFingerprint: string;
  readonly expectedPeakByScope: readonly Readonly<{ scopeId: string; count: number }>[];
}
export interface OccupancyBaseline {
  readonly planId: string;
  readonly planVersion: string | number;
  readonly planFingerprint: string;
  readonly attendeeTarget: number;
  readonly scopes: readonly OccupancyScopeBaseline[];
  readonly simulation: OccupancySimulationBaseline | null;
  readonly fingerprint: string;
}
export interface OccupancyPolicy {
  readonly freshAfterSeconds: number;
  readonly staleAfterSeconds: number;
  readonly warningRatio: number;
  readonly conflictTolerancePersons: number;
  readonly conflictToleranceRatio: number;
}
export interface OccupancyFeed extends AggregateOccupancySignal {
  readonly acceptedAt: string;
  readonly signalFingerprint: string;
}
export interface OccupancyObservation extends AggregateOccupancySignal {
  readonly id: string;
  readonly acceptedAt: string;
}
export interface OccupancyReceipt {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly inputFingerprint: string;
  readonly operation: "ingest" | "refresh" | "acknowledge";
  readonly revision: number;
  readonly acceptedAt: string;
}
export type OperationalDetailValue =
  string | number | boolean | null | OperationalDetails | readonly OperationalDetailValue[];
export interface OperationalDetails {
  readonly [key: string]: OperationalDetailValue;
}
export interface OccupancyLedgerEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly sequence: number;
  readonly type: string;
  readonly actorType: ActorType;
  readonly actorId: string;
  readonly source: OperationalSource;
  readonly sessionId: string;
  readonly committedAt: string;
  readonly details: object;
  readonly previousHash: string;
  readonly hash: string;
}
export interface LiveOccupancyMonitor {
  schemaVersion: 1;
  id: string;
  projectId: string;
  runbookVersionId: string;
  source: OccupancySource;
  baseline: OccupancyBaseline;
  policy: OccupancyPolicy;
  feeds: OccupancyFeed[];
  observations: OccupancyObservation[];
  activeAlerts: OccupancyAlert[];
  receipts: OccupancyReceipt[];
  ledger: OccupancyLedgerEntry[];
  revision: number;
  createdAt: string;
  updatedAt: string;
}
export interface OccupancySourceProjection {
  readonly sourceId: string;
  readonly sourceType: AggregateOccupancySignal["sourceType"];
  readonly sourceVersion: string;
  readonly kind: AggregateOccupancySignal["kind"];
  readonly observedAt: string;
  readonly confidence: OccupancyConfidence;
  readonly ageSeconds: number;
  readonly status: "fresh" | "aging" | "stale";
}
export type OccupancyScopeStatus = "unavailable" | "nominal" | "warning" | "exceeded" | "conflicting" | "stale";
export interface OccupancyScopeProjection extends OccupancyScopeBaseline {
  readonly status: OccupancyScopeStatus;
  readonly count: number | null;
  readonly utilization: number | null;
  readonly confidence: OccupancyConfidence;
  readonly sourceIds: readonly string[];
  readonly freshness: "missing" | "fresh" | "aging" | "stale";
  readonly expectedPeak: number | null;
  readonly simulationDelta: number | null;
}
export type OccupancyAlertDescriptor = Omit<
  OccupancyAlert,
  "id" | "status" | "openedAt" | "acknowledgedAt" | "acknowledgedBy" | "reasonCode"
>;
export interface OccupancyProjection {
  readonly monitorId: string;
  readonly runbookVersionId: string;
  readonly evaluatedAt: string;
  readonly overallStatus: OccupancyScopeStatus;
  readonly sources: readonly OccupancySourceProjection[];
  readonly scopes: readonly OccupancyScopeProjection[];
  readonly alerts: readonly OccupancyAlertDescriptor[];
  readonly privacy: Readonly<{ mode: "aggregate-only"; personRecordsStored: false; individualEventsStored: false }>;
}
export interface OccupancyMutationCommandContext extends IncidentCommandContext {
  readonly expectedRevision: number;
  readonly operationId?: string;
  readonly correlationId?: string;
  readonly clientId?: string;
  readonly clientSequence?: number;
  readonly clientOccurredAt?: string;
  readonly deviceOccurredAt?: string;
  readonly deviceId?: string;
}
export interface CreateOccupancyMonitorCommand {
  readonly type?: "create_occupancy_monitor";
  readonly projectId: string;
  readonly runbook: EventDayRunbook;
  readonly plan?: OperationalVenuePlan;
  readonly simulation?: OccupancySimulationBaseline | null;
  readonly policy?: Partial<OccupancyPolicy>;
  readonly createdAt?: string;
  readonly createdBy: string;
}
export interface InspectLiveOccupancyCommand {
  readonly type: "inspect_live_occupancy";
  readonly evaluatedAt?: string;
}
export interface ExportLiveOccupancyCommand {
  readonly type: "export_live_occupancy";
  readonly exportedAt?: string;
}
export interface IngestOccupancySignalCommand extends OccupancyMutationCommandContext {
  readonly type: "ingest_occupancy_signal";
  readonly signal: AggregateOccupancySignal;
}
export interface RefreshLiveOccupancyCommand extends OccupancyMutationCommandContext {
  readonly type: "refresh_live_occupancy";
  readonly evaluatedAt?: string;
}
export interface AcknowledgeOccupancyAlertCommand extends OccupancyMutationCommandContext {
  readonly type: "acknowledge_occupancy_alert";
  readonly alertId: string;
  readonly reasonCode: string;
}
export type OccupancyMutationCommand =
  IngestOccupancySignalCommand | RefreshLiveOccupancyCommand | AcknowledgeOccupancyAlertCommand;
export interface OccupancyMutationResult {
  readonly monitor: LiveOccupancyMonitor;
  readonly projection: OccupancyProjection;
  readonly receipt: OccupancyReceipt;
  readonly duplicate: boolean;
}
export interface OccupancyAuditArtifact {
  readonly filename: string;
  readonly mimeType: "application/json";
  readonly content: string;
}
export type OccupancyCommand =
  | CreateOccupancyMonitorCommand
  | InspectLiveOccupancyCommand
  | ExportLiveOccupancyCommand
  | IngestOccupancySignalCommand
  | RefreshLiveOccupancyCommand
  | AcknowledgeOccupancyAlertCommand;

export type RunbookPhaseKind = "setup" | "doors" | "live-event" | "interval" | "egress" | "breakdown";
export type RunbookWorkstream = "production" | "front-of-house" | "security" | "catering" | "venue-operations";
export type RunbookTaskStatus = "pending" | "in-progress" | "blocked" | "completed" | "skipped";
export interface RunbookOwner {
  roleId: string | null;
  shiftId: string | null;
  staffPostObjectId: string | null;
  assigneeId: string | null;
}
export interface RunbookEvidence {
  readonly code: string;
  readonly ref: string;
}
export interface RunbookPhase {
  id: string;
  kind: RunbookPhaseKind;
  order: number;
  startAt: string;
  endAt: string;
}
export interface RunbookTask {
  id: string;
  key: string;
  phaseId: string;
  order: number;
  code: string;
  workstream: RunbookWorkstream;
  owner: RunbookOwner;
  dependencyTaskIds: string[];
  planObjectIds: string[];
  requiredEvidenceCodes: string[];
  required: boolean;
  status: RunbookTaskStatus;
  revision: number;
  evidence: RunbookEvidence[];
}
export interface RunbookReceipt {
  readonly id: string;
  readonly idempotencyKey: string;
  readonly inputFingerprint: string;
  readonly correlationId: string;
  readonly runbookVersionId: string;
  readonly taskId: string;
  readonly taskRevision: number;
  readonly transitionId: string;
  readonly committedAt: string;
}
export interface RunbookTransition {
  id: string;
  sequence: number;
  taskId: string;
  fromStatus: RunbookTaskStatus;
  toStatus: RunbookTaskStatus;
  fromTaskRevision: number;
  toTaskRevision: number;
  reasonCode: string | null;
  evidence: RunbookEvidence[];
  clientId: string;
  clientSequence: number;
  clientOccurredAt: string;
  committedAt: string;
}
export interface RunbookLedgerEntry {
  id: string;
  schemaVersion: 1;
  sequence: number;
  type: string;
  actorType: ActorType;
  actorId: string;
  source: OperationalSource;
  sessionId: string;
  committedAt: string;
  details: object;
  previousHash: string;
  hash: string;
}
export interface EventDayRunbook {
  schemaVersion: 1;
  id: string;
  versionId: string;
  version: number;
  source: {
    projectId: string;
    planId: string;
    planVersion: string | number;
    planFingerprint: string;
    briefFingerprint: string;
    validationId: string;
    validationInputFingerprint: string;
    approvalLedgerEntryId: string;
    sourceLedgerHeadHash: string;
  };
  baseline: {
    acceptedPlan: OperationalVenuePlan;
    acceptedBrief: EventBrief;
    staffingEvidence: object;
    fingerprint: string;
  };
  definitionFingerprint: string;
  status: "active" | "archived";
  phases: RunbookPhase[];
  tasks: RunbookTask[];
  transitions: RunbookTransition[];
  receipts: RunbookReceipt[];
  ledger: RunbookLedgerEntry[];
  revision: number;
  frozenAt: string;
  frozenBy: string;
}
export interface CreateRunbookCommand {
  readonly type?: "create_runbook_version";
  readonly projectId: string;
  readonly plan: OperationalVenuePlan & Readonly<{ brief?: EventBrief }>;
  readonly brief?: EventBrief;
  readonly validation: Readonly<{ validationId: string; inputFingerprint: string; status: "pass" | "fail" }>;
  readonly sourceLedgerHeadHash: string | null;
  readonly approvalLedgerEntryId: string;
  readonly frozenBy: string;
  readonly frozenAt?: string;
  readonly version?: number;
  readonly phases?: readonly RunbookPhase[];
  readonly tasks?: readonly RunbookTask[];
}
export interface TransitionRunbookTaskCommand extends IncidentCommandContext {
  readonly type: "transition_runbook_task";
  readonly runbookVersionId: string;
  readonly taskId: string;
  readonly expectedTaskRevision: number;
  readonly fromStatus?: RunbookTaskStatus;
  readonly toStatus: RunbookTaskStatus;
  readonly reasonCode?: string;
  readonly evidence: readonly RunbookEvidence[];
  readonly operationId?: string;
  readonly correlationId?: string;
  readonly clientId: string;
  readonly clientSequence: number;
  readonly clientOccurredAt: string;
  readonly deviceOccurredAt?: string;
  readonly deviceId?: string;
}
export interface InspectRunbookCommand {
  readonly type: "inspect_runbook";
}
export interface ListRunbookTasksCommand {
  readonly type: "list_runbook_tasks";
  readonly phaseId?: string;
  readonly roleId?: string;
}
export interface GenerateShiftHandoffCommand {
  readonly type: "generate_shift_handoff";
  readonly outgoingAssignmentId: string | null;
  readonly incomingAssignmentId: string | null;
  readonly roleId: string | null;
  readonly at: string;
}
export interface ExportRunbookCommand {
  readonly type: "export_runbook";
  readonly format?: "json" | "audit";
  readonly exportedAt?: string;
  readonly handoffAt?: string;
}
export type RunbookCommand =
  | CreateRunbookCommand
  | TransitionRunbookTaskCommand
  | InspectRunbookCommand
  | ListRunbookTasksCommand
  | GenerateShiftHandoffCommand
  | ExportRunbookCommand;
