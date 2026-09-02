import { stableFingerprint } from "./activity-ledger.ts";
import { venueError } from "./errors.ts";
import type { VenueErrorCode, VenueErrorDetails } from "./errors.ts";
import type {
  AcknowledgeIncidentCommand,
  ActorType,
  AttachIncidentEvidenceCommand,
  ClassifyIncidentCommand,
  CreateIncidentRegisterCommand,
  EscalateIncidentCommand,
  ExportIncidentRecordCommand,
  HandoffIncidentCommand,
  IncidentAttachment,
  IncidentCategory,
  IncidentCommandContext,
  IncidentEscalationLevel,
  IncidentHandoff,
  IncidentLedgerEntry,
  IncidentLocation,
  IncidentLocationInput,
  IncidentMutationCommand,
  IncidentMutationResult,
  IncidentOwner,
  IncidentReceipt,
  IncidentRegister,
  IncidentRelatedRef,
  IncidentSeverity,
  IncidentStatus,
  IncidentTransition,
  InspectIncidentCommand,
  InspectIncidentsCommand,
  OperationalIncident,
  OperationalSource,
  Point,
  RecordIncidentEmergencyActionCommand,
  RelocateIncidentCommand,
  ReportIncidentCommand,
  RoomBoundary,
  SetIncidentOwnerCommand,
  TransitionIncidentStatusCommand,
} from "./operational-types.ts";

const clone = <T>(value: T): T => structuredClone(value);
const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);
const freeze = <T>(value: T): Readonly<T> => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

function fail(code: VenueErrorCode, details: VenueErrorDetails = {}): never {
  throw venueError(code, details);
}

export const INCIDENT_SEVERITIES = Object.freeze([
  "low",
  "medium",
  "high",
  "critical",
] as const satisfies readonly IncidentSeverity[]);
export const INCIDENT_CATEGORIES = Object.freeze([
  "accessibility",
  "crowd-capacity",
  "medical",
  "security",
  "fire-life-safety",
  "facilities",
  "production-av",
  "catering",
  "staffing",
  "transport",
  "weather",
  "other",
] as const satisfies readonly IncidentCategory[]);
export const INCIDENT_STATUSES = Object.freeze([
  "open",
  "mitigating",
  "resolved",
  "closed",
] as const satisfies readonly IncidentStatus[]);
export const INCIDENT_ESCALATION_LEVELS = Object.freeze([
  "none",
  "team",
  "venue-command",
  "emergency-response",
] as const satisfies readonly IncidentEscalationLevel[]);

const PROHIBITED_FIELD =
  /(?:attendee|person|name|email|phone|contact|address|ticket|barcode|qr|device|medicalrecord|diagnosis|health|patient)/i;
const screenPrivacy = (value: unknown): void => {
  if (Array.isArray(value)) return value.forEach(screenPrivacy);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_FIELD.test(key)) fail("INCIDENT_PRIVACY_REJECTED", { field: key });
    screenPrivacy(child);
  }
};

const text = (value: unknown, reason: string): string => {
  if (typeof value !== "string" || !value.trim()) fail("INCIDENT_INVALID", { reason });
  return value.trim();
};

const instant = (value: string, reason: string): string => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) fail("INCIDENT_INVALID", { reason });
  return value;
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
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (!currentPoint || !previousPoint) continue;
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    if (
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) +
          currentPoint.x
    )
      inside = !inside;
  }
  return inside;
};
const pointInRoom = (point: Point, boundary: RoomBoundary): boolean =>
  pointInRing(point, boundary.outer) && !(boundary.holes ?? []).some((hole) => pointInRing(point, hole));

const locationContext = (register: IncidentRegister, location: IncidentLocationInput): IncidentLocation => {
  const prefix = {
    planId: register.source.planId,
    planVersion: register.source.planVersion,
    planFingerprint: register.source.planFingerprint,
  };
  if (
    location?.kind === "plan-object" &&
    typeof location.planObjectId === "string" &&
    register.baseline.acceptedPlan.objects.some((object) => object.id === location.planObjectId)
  ) {
    return { ...prefix, kind: "plan-object", planObjectId: location.planObjectId };
  }
  const boundary = register.baseline.acceptedPlan.spatial?.roomBoundary;
  if (
    location.kind === "coordinate" &&
    Number.isFinite(location.point.x) &&
    Number.isFinite(location.point.y) &&
    boundary?.outer?.length >= 3 &&
    pointInRoom(location.point, boundary)
  ) {
    const point = location.point;
    return { ...prefix, kind: "coordinate", point: { x: point.x, y: point.y } };
  }
  fail("INCIDENT_LOCATION_INVALID", { reason: "location-invalid" });
};

const normalizeRelatedRefs = (
  register: IncidentRegister,
  refs: readonly IncidentRelatedRef[] = [],
): IncidentRelatedRef[] => {
  if (!isUnknownArray(refs) || refs.length > 50) fail("INCIDENT_INVALID", { reason: "related-refs-invalid" });
  const supported = new Set(["occupancy-alert", "runbook-task", "plan-object"]);
  const result = refs.map((ref) => {
    if (
      !ref ||
      !supported.has(ref.kind) ||
      typeof ref.id !== "string" ||
      !ref.id ||
      Object.keys(ref).some((key) => !["kind", "id"].includes(key))
    )
      fail("INCIDENT_INVALID", { reason: "related-ref-invalid" });
    if (ref.kind === "plan-object" && !register.baseline.acceptedPlan.objects.some((object) => object.id === ref.id))
      fail("INCIDENT_INVALID", { reason: "related-plan-object-not-found", id: ref.id });
    if (ref.kind === "runbook-task" && !register.baseline.runbookTaskIds.includes(ref.id))
      fail("INCIDENT_INVALID", { reason: "related-runbook-task-not-found", id: ref.id });
    return { kind: ref.kind, id: ref.id };
  });
  return [...new Map(result.map((ref) => [`${ref.kind}\u0000${ref.id}`, ref])).values()].sort(
    (left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
  );
};

const appendLedger = (register: IncidentRegister, transition: IncidentTransition): IncidentLedgerEntry => {
  const sequence = register.ledger.length + 1;
  const previousHash = register.ledger.at(-1)?.hash ?? register.source.runbookLedgerHeadHash;
  const entry: Omit<IncidentLedgerEntry, "hash"> = {
    id: `incident-ledger-${String(sequence).padStart(6, "0")}`,
    schemaVersion: 1,
    sequence,
    type: transition.type,
    transitionId: transition.id,
    incidentId: transition.incidentId,
    actorType: transition.actorType,
    actorId: transition.actorId,
    source: transition.source,
    sessionId: transition.sessionId,
    committedAt: transition.committedAt,
    location: clone(transition.location),
    details: clone(transition.details),
    resultingIncidentFingerprint: transition.resultingIncidentFingerprint,
    receiptFingerprint: transition.receiptFingerprint,
    previousHash,
  };
  return { ...entry, hash: stableFingerprint("incident-ledger", entry) };
};

export function createIncidentRegister({
  projectId,
  runbook,
  createdAt,
  createdBy,
}: CreateIncidentRegisterCommand): Readonly<IncidentRegister> {
  if (
    !projectId ||
    !runbook?.versionId ||
    runbook.status !== "active" ||
    runbook.source?.projectId !== projectId ||
    !runbook.baseline?.acceptedPlan ||
    !runbook.source?.planFingerprint
  )
    fail("INCIDENT_BASELINE_INVALID", { reason: "active-runbook-required" });
  const acceptedPlan = clone(runbook.baseline.acceptedPlan);
  const emergencyPlan = acceptedPlan.emergencyPlan ?? null;
  const now = instant(createdAt ?? new Date().toISOString(), "created-at-invalid");
  const source = {
    runbookVersionId: runbook.versionId,
    runbookDefinitionFingerprint: runbook.definitionFingerprint,
    runbookLedgerHeadHash: runbook.ledger.at(-1)?.hash ?? runbook.source.sourceLedgerHeadHash,
    planId: runbook.source.planId,
    planVersion: runbook.source.planVersion,
    planFingerprint: runbook.source.planFingerprint,
    validationId: runbook.source.validationId,
    validationInputFingerprint: runbook.source.validationInputFingerprint,
    approvalLedgerEntryId: runbook.source.approvalLedgerEntryId,
    emergencyPlanFingerprint: emergencyPlan ? stableFingerprint("emergency-plan", emergencyPlan) : null,
  };
  const baseline: IncidentRegister["baseline"] = {
    acceptedPlan,
    emergencyPlan: clone(emergencyPlan),
    runbookTaskIds: runbook.tasks.map((task) => task.id).sort(),
    fingerprint: "",
  };
  baseline.fingerprint = stableFingerprint("incident-baseline", {
    source,
    acceptedPlan,
    emergencyPlan,
    runbookTaskIds: baseline.runbookTaskIds,
  });
  return freeze({
    schemaVersion: 1,
    id: `incidents-${runbook.versionId}`,
    projectId,
    runbookVersionId: runbook.versionId,
    source,
    baseline,
    incidents: [],
    transitions: [],
    receipts: [],
    ledger: [],
    revision: 0,
    createdAt: now,
    createdBy: text(createdBy, "created-by-required"),
    updatedAt: now,
  });
}

const metadata = (
  command: IncidentCommandContext,
): { actorType: ActorType; actorId: string; source: OperationalSource; sessionId: string } => {
  if (!["human", "agent", "system"].includes(command.actorType))
    fail("INCIDENT_INVALID", { reason: "actor-type-invalid" });
  if (!["studio", "webmcp", "mcp", "system", "agent-tool"].includes(command.source))
    fail("INCIDENT_INVALID", { reason: "source-invalid" });
  return {
    actorType: command.actorType,
    actorId: text(command.actorId, "actor-id-required"),
    source: command.source,
    sessionId: text(command.sessionId, "session-id-required"),
  };
};

export function reportIncident(
  register: IncidentRegister,
  command: ReportIncidentCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): IncidentMutationResult {
  if (!command?.idempotencyKey) fail("IDEMPOTENCY_KEY_REQUIRED", { commandType: "report_incident" });
  screenPrivacy(command);
  const acceptedAt = instant(committedAt, "committed-at-invalid");
  const location = locationContext(register, command.location);
  if (!INCIDENT_SEVERITIES.includes(command.severity) || !INCIDENT_CATEGORIES.includes(command.category))
    fail("INCIDENT_INVALID", { reason: "classification-invalid" });
  if (typeof command.summaryCode !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(command.summaryCode))
    fail("INCIDENT_INVALID", { reason: "summary-code-invalid" });
  const relatedRefs = normalizeRelatedRefs(register, command.relatedRefs);
  const input = {
    incidentId: command.incidentId,
    severity: command.severity,
    category: command.category,
    summaryCode: command.summaryCode,
    location: command.location,
    relatedRefs,
  };
  const inputFingerprint = stableFingerprint("incident-report", input);
  const retry = register.receipts.find((receipt) => receipt.idempotencyKey === command.idempotencyKey);
  if (retry) {
    if (retry.inputFingerprint !== inputFingerprint)
      fail("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
    const incident = register.incidents.find((candidate) => candidate.id === retry.incidentId);
    if (!incident) fail("INCIDENT_NOT_FOUND", { incidentId: retry.incidentId });
    return { register, incident, receipt: retry, duplicate: true };
  }
  const incidentId = text(command.incidentId, "incident-id-required");
  if (register.incidents.some((incident) => incident.id === incidentId)) fail("INCIDENT_ID_CONFLICT", { incidentId });
  const actor = metadata(command);
  const incident: OperationalIncident = {
    schemaVersion: 1,
    id: incidentId,
    revision: 1,
    severity: command.severity,
    category: command.category,
    summaryCode: text(command.summaryCode, "summary-code-required"),
    status: "open",
    acknowledgement: { status: "pending" },
    escalation: { level: "none" },
    location,
    owner: null,
    relatedRefs,
    attachments: [],
    handoffs: [],
    emergencyActions: [],
    timestamps: { reportedAt: acceptedAt, updatedAt: acceptedAt },
  };
  const receipt: IncidentReceipt = {
    id: `incident-receipt-${inputFingerprint.slice(-12)}`,
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    operation: "report_incident",
    incidentId,
    incidentRevision: 1,
    ledgerSequence: register.ledger.length + 1,
    acceptedAt,
  };
  const transition: IncidentTransition = {
    id: `incident-transition-${inputFingerprint.slice(-12)}`,
    sequence: register.transitions.length + 1,
    type: "incident.reported",
    incidentId,
    fromIncidentRevision: 0,
    toIncidentRevision: 1,
    ...actor,
    committedAt: acceptedAt,
    location,
    details: { severity: command.severity, category: command.category, summaryCode: command.summaryCode, relatedRefs },
    resultingIncidentFingerprint: stableFingerprint("incident-projection", incident),
    receiptFingerprint: stableFingerprint("incident-receipt-evidence", receipt),
  };
  const next = clone(register);
  next.incidents.push(incident);
  next.transitions.push(transition);
  next.revision += 1;
  next.updatedAt = acceptedAt;
  next.ledger.push(appendLedger(next, transition));
  next.receipts.push(receipt);
  return {
    register: freeze(next),
    incident: freeze(clone(incident)),
    receipt: freeze(clone(receipt)),
    duplicate: false,
  };
}

const requireHuman = (command: IncidentCommandContext, operation: string): void => {
  if (command.actorType !== "human")
    fail("INCIDENT_HUMAN_REQUIRED", { operation, actorType: command.actorType ?? null });
};

const semanticInput = (command: IncidentMutationCommand): object =>
  Object.fromEntries(
    Object.entries(command).filter(
      ([key]) =>
        ![
          "idempotencyKey",
          "correlationId",
          "operationId",
          "actorType",
          "actorId",
          "source",
          "sessionId",
          "committedAt",
        ].includes(key),
    ),
  );

interface MutationOptions {
  operation: string;
  eventType: string;
  committedAt?: string;
  human?: boolean;
  mutate: (
    incident: OperationalIncident,
    at: string,
    actor: { actorType: ActorType; actorId: string; source: OperationalSource; sessionId: string },
  ) => object | undefined;
}
const mutateIncident = (
  register: IncidentRegister,
  command: IncidentMutationCommand,
  { operation, eventType, committedAt, human = true, mutate }: MutationOptions,
): IncidentMutationResult => {
  if (!command?.idempotencyKey) fail("IDEMPOTENCY_KEY_REQUIRED", { commandType: operation });
  if (human) requireHuman(command, operation);
  screenPrivacy(command);
  const acceptedAt = instant(committedAt ?? new Date().toISOString(), "committed-at-invalid");
  const inputFingerprint = stableFingerprint(`incident-${operation}`, semanticInput(command));
  const retry = register.receipts.find((receipt) => receipt.idempotencyKey === command.idempotencyKey);
  if (retry) {
    if (retry.inputFingerprint !== inputFingerprint)
      fail("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
    return {
      register,
      incident: inspectIncident(register, { incidentId: retry.incidentId }),
      receipt: retry,
      duplicate: true,
    };
  }
  const incidentId = text(command.incidentId, "incident-id-required");
  const current = register.incidents.find((incident) => incident.id === incidentId);
  if (!current) fail("INCIDENT_NOT_FOUND", { incidentId });
  if (!Number.isInteger(command.expectedIncidentRevision) || command.expectedIncidentRevision !== current.revision)
    fail("INCIDENT_REVISION_CONFLICT", {
      incidentId,
      expectedIncidentRevision: command.expectedIncidentRevision,
      currentIncidentRevision: current.revision,
    });
  const actor = metadata(command);
  const nextIncident = clone(current);
  const details = mutate(nextIncident, acceptedAt, actor) ?? {};
  nextIncident.revision += 1;
  nextIncident.timestamps.updatedAt = acceptedAt;
  const receipt: IncidentReceipt = {
    id: stableFingerprint("incident-receipt", {
      registerId: register.id,
      idempotencyKey: command.idempotencyKey,
      inputFingerprint,
    }),
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    operation,
    incidentId,
    incidentRevision: nextIncident.revision,
    ledgerSequence: register.ledger.length + 1,
    acceptedAt,
  };
  const transition: IncidentTransition = {
    id: stableFingerprint("incident-transition", {
      registerId: register.id,
      idempotencyKey: command.idempotencyKey,
      inputFingerprint,
    }),
    sequence: register.transitions.length + 1,
    type: eventType,
    incidentId,
    fromIncidentRevision: current.revision,
    toIncidentRevision: nextIncident.revision,
    ...actor,
    committedAt: acceptedAt,
    location: clone(nextIncident.location),
    details: clone(details),
    resultingIncidentFingerprint: stableFingerprint("incident-projection", nextIncident),
    receiptFingerprint: stableFingerprint("incident-receipt-evidence", receipt),
  };
  const next = clone(register);
  next.incidents = next.incidents.map((incident) => (incident.id === incidentId ? nextIncident : incident));
  next.transitions.push(transition);
  next.revision += 1;
  next.updatedAt = acceptedAt;
  next.ledger.push(appendLedger(next, transition));
  next.receipts.push(receipt);
  return {
    register: freeze(next),
    incident: freeze(clone(nextIncident)),
    receipt: freeze(clone(receipt)),
    duplicate: false,
  };
};

const assertMutable = (incident: OperationalIncident): void => {
  if (incident.status === "closed")
    fail("INCIDENT_TRANSITION_INVALID", { incidentId: incident.id, reason: "incident-closed" });
};

const normalizeOwner = (register: IncidentRegister, owner: IncidentOwner): IncidentOwner => {
  const allowed = ["roleId", "shiftId", "staffPostObjectId", "assignmentId"];
  if (
    !owner ||
    typeof owner !== "object" ||
    Array.isArray(owner) ||
    Object.keys(owner).some((key) => !allowed.includes(key))
  )
    fail("INCIDENT_OWNER_INVALID", { reason: "owner-shape-invalid" });
  const plan = register.baseline.acceptedPlan;
  if (!plan.staffing?.roles?.some((role) => role.id === owner.roleId))
    fail("INCIDENT_OWNER_INVALID", { reason: "role-not-found", roleId: owner.roleId ?? null });
  if (owner.shiftId != null && !plan.staffing?.shifts?.some((shift) => shift.id === owner.shiftId))
    fail("INCIDENT_OWNER_INVALID", { reason: "shift-not-found", shiftId: owner.shiftId });
  if (
    owner.staffPostObjectId != null &&
    !plan.objects.some((object) => object.id === owner.staffPostObjectId && object.staffPost)
  )
    fail("INCIDENT_OWNER_INVALID", { reason: "staff-post-not-found", staffPostObjectId: owner.staffPostObjectId });
  if (
    owner.assignmentId != null &&
    (typeof owner.assignmentId !== "string" || !/^(?:assignment|staff-ref)-[a-z0-9-]{1,128}$/.test(owner.assignmentId))
  )
    fail("INCIDENT_OWNER_INVALID", { reason: "assignment-invalid" });
  return {
    roleId: owner.roleId,
    ...(owner.shiftId ? { shiftId: owner.shiftId } : {}),
    ...(owner.staffPostObjectId ? { staffPostObjectId: owner.staffPostObjectId } : {}),
    ...(owner.assignmentId ? { assignmentId: owner.assignmentId.trim() } : {}),
  };
};

const code = (value: unknown, reason: string): string => {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(value)) fail("INCIDENT_INVALID", { reason });
  return value;
};
const codes = (values: readonly string[], reason: string): string[] => {
  if (!Array.isArray(values) || values.length > 50) fail("INCIDENT_INVALID", { reason });
  return [...new Set(values.map((value) => code(value, reason)))].sort();
};

export function classifyIncident(
  register: IncidentRegister,
  command: ClassifyIncidentCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): IncidentMutationResult {
  return mutateIncident(register, command, {
    operation: "classify_incident",
    eventType: "incident.classified",
    committedAt,
    mutate: (incident) => {
      assertMutable(incident);
      if (!INCIDENT_SEVERITIES.includes(command.severity) || !INCIDENT_CATEGORIES.includes(command.category))
        fail("INCIDENT_INVALID", { reason: "classification-invalid" });
      incident.severity = command.severity;
      incident.category = command.category;
      incident.summaryCode = code(command.summaryCode, "summary-code-invalid");
      return { severity: incident.severity, category: incident.category, summaryCode: incident.summaryCode };
    },
  });
}

export function setIncidentOwner(
  register: IncidentRegister,
  command: SetIncidentOwnerCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): IncidentMutationResult {
  return mutateIncident(register, command, {
    operation: "set_incident_owner",
    eventType: "incident.owner_set",
    committedAt,
    mutate: (incident) => {
      assertMutable(incident);
      const owner = normalizeOwner(register, command.owner);
      const previousOwner = clone(incident.owner);
      incident.owner = owner;
      return { previousOwner, owner };
    },
  });
}

export function acknowledgeIncident(
  register: IncidentRegister,
  command: AcknowledgeIncidentCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): IncidentMutationResult {
  return mutateIncident(register, command, {
    operation: "acknowledge_incident",
    eventType: "incident.acknowledged",
    committedAt,
    mutate: (incident, at, actor) => {
      assertMutable(incident);
      if (incident.acknowledgement.status !== "pending")
        fail("INCIDENT_ACKNOWLEDGEMENT_INVALID", { incidentId: incident.id, reason: "already-acknowledged" });
      const reasonCode = code(command.reasonCode, "acknowledgement-reason-invalid");
      incident.acknowledgement = {
        status: "acknowledged",
        acknowledgedAt: at,
        acknowledgedBy: actor.actorId,
        reasonCode,
      };
      incident.timestamps.acknowledgedAt = at;
      return clone(incident.acknowledgement);
    },
  });
}

export function escalateIncident(
  register: IncidentRegister,
  command: EscalateIncidentCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): IncidentMutationResult {
  return mutateIncident(register, command, {
    operation: "escalate_incident",
    eventType: "incident.escalated",
    committedAt,
    mutate: (incident, at, actor) => {
      assertMutable(incident);
      const fromLevel = incident.escalation.level;
      if (
        !INCIDENT_ESCALATION_LEVELS.includes(command.level) ||
        INCIDENT_ESCALATION_LEVELS.indexOf(command.level) <= INCIDENT_ESCALATION_LEVELS.indexOf(fromLevel)
      )
        fail("INCIDENT_ESCALATION_INVALID", { incidentId: incident.id, fromLevel, toLevel: command.level });
      const reasonCode = code(command.reasonCode, "escalation-reason-invalid");
      incident.escalation = { level: command.level, escalatedAt: at, escalatedBy: actor.actorId, reasonCode };
      incident.timestamps.escalatedAt = at;
      return { fromLevel, ...clone(incident.escalation) };
    },
  });
}

export function relocateIncident(
  register: IncidentRegister,
  command: RelocateIncidentCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): IncidentMutationResult {
  return mutateIncident(register, command, {
    operation: "relocate_incident",
    eventType: "incident.relocated",
    committedAt,
    mutate: (incident) => {
      assertMutable(incident);
      const previousLocation = clone(incident.location);
      incident.location = locationContext(register, command.location);
      return {
        previousLocation,
        location: clone(incident.location),
        reasonCode: code(command.reasonCode, "relocation-reason-invalid"),
      };
    },
  });
}

const STATUS_TRANSITIONS: Readonly<Record<IncidentStatus, readonly IncidentStatus[]>> = Object.freeze({
  open: ["mitigating", "resolved"],
  mitigating: ["resolved"],
  resolved: ["closed", "open"],
  closed: ["open"],
});
export function transitionIncidentStatus(
  register: IncidentRegister,
  command: TransitionIncidentStatusCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): IncidentMutationResult {
  return mutateIncident(register, command, {
    operation: "transition_incident_status",
    eventType: `incident.status_${String(command.toStatus).replaceAll("-", "_")}`,
    committedAt,
    mutate: (incident, at, actor) => {
      const fromStatus = incident.status;
      if (!INCIDENT_STATUSES.includes(command.toStatus) || !STATUS_TRANSITIONS[fromStatus]?.includes(command.toStatus))
        fail("INCIDENT_TRANSITION_INVALID", { incidentId: incident.id, fromStatus, toStatus: command.toStatus });
      const reopening = ["resolved", "closed"].includes(fromStatus) && command.toStatus === "open";
      const resolving = command.toStatus === "resolved";
      if (reopening && command.actorType !== "human") fail("INCIDENT_HUMAN_REQUIRED", { operation: "reopen_incident" });
      if (reopening) code(command.reasonCode, "reopen-reason-invalid");
      if (resolving && (incident.acknowledgement.status !== "acknowledged" || !incident.owner))
        fail("INCIDENT_TRANSITION_INVALID", { incidentId: incident.id, reason: "acknowledgement-and-owner-required" });
      if (resolving) code(command.resolutionCode, "resolution-code-invalid");
      if (command.toStatus === "closed") code(command.reasonCode, "close-reason-invalid");
      incident.status = command.toStatus;
      if (command.toStatus === "mitigating") incident.timestamps.mitigationStartedAt = at;
      if (resolving) incident.timestamps.resolvedAt = at;
      if (command.toStatus === "closed") incident.timestamps.closedAt = at;
      if (reopening) {
        incident.timestamps.reopenedAt = at;
        delete incident.timestamps.closedAt;
        delete incident.timestamps.resolvedAt;
      }
      return {
        fromStatus,
        toStatus: command.toStatus,
        reasonCode: command.reasonCode ?? null,
        resolutionCode: command.resolutionCode ?? null,
        changedBy: actor.actorId,
      };
    },
  });
}

export function handoffIncident(
  register: IncidentRegister,
  command: HandoffIncidentCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): IncidentMutationResult {
  return mutateIncident(register, command, {
    operation: "handoff_incident",
    eventType: "incident.handed_off",
    committedAt,
    mutate: (incident, at, actor) => {
      if (!["open", "mitigating"].includes(incident.status))
        fail("INCIDENT_HANDOFF_INVALID", { incidentId: incident.id, reason: "status-invalid" });
      const fromOwner = normalizeOwner(register, command.fromOwner);
      const toOwner = normalizeOwner(register, command.toOwner);
      if (
        !incident.owner ||
        stableFingerprint("incident-owner", incident.owner) !== stableFingerprint("incident-owner", fromOwner)
      )
        fail("INCIDENT_HANDOFF_INVALID", { incidentId: incident.id, reason: "outgoing-owner-mismatch" });
      if (stableFingerprint("incident-owner", fromOwner) === stableFingerprint("incident-owner", toOwner))
        fail("INCIDENT_HANDOFF_INVALID", { incidentId: incident.id, reason: "owner-unchanged" });
      const handoff: IncidentHandoff = {
        id: stableFingerprint("incident-handoff", { incidentId: incident.id, fromOwner, toOwner, at }),
        fromOwner,
        toOwner,
        openActionCodes: codes(command.openActionCodes, "handoff-action-code-invalid"),
        evidenceRefs: normalizeRelatedRefs(register, command.evidenceRefs),
        handedOffAt: at,
        handedOffBy: actor.actorId,
      };
      incident.owner = toOwner;
      incident.handoffs.push(handoff);
      return handoff;
    },
  });
}

export function recordIncidentEmergencyAction(
  register: IncidentRegister,
  command: RecordIncidentEmergencyActionCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): IncidentMutationResult {
  return mutateIncident(register, command, {
    operation: "record_incident_emergency_action",
    eventType: "incident.emergency_action_recorded",
    committedAt,
    mutate: (incident, at, actor) => {
      if (
        !["open", "mitigating"].includes(incident.status) ||
        !register.baseline.emergencyPlan ||
        !register.source.emergencyPlanFingerprint
      )
        fail("INCIDENT_EMERGENCY_ACTION_INVALID", {
          incidentId: incident.id,
          reason: "approved-emergency-plan-required",
        });
      const emergencyPlan = register.baseline.emergencyPlan;
      const emergencyPlanFingerprint = register.source.emergencyPlanFingerprint;
      const actionCodes = [
        "EVACUATE",
        "SHELTER",
        "CLOSE_EXIT",
        "OPEN_ALTERNATE_ROUTE",
        "DISPATCH_FIRST_AID",
        "CALL_EMERGENCY_SERVICES",
      ];
      if (!actionCodes.includes(command.actionCode))
        fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "action-code-invalid" });
      if (!emergencyPlan.authorizedReviewerRoles.includes(command.authorityRole))
        fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "authority-role-invalid" });
      const targetObjectIds = [...new Set(command.targetObjectIds ?? [])].sort();
      const emergencyObjectIds = new Set(
        register.baseline.acceptedPlan.objects
          .filter((object) => object.emergency || object.exit?.emergency)
          .map((object) => object.id),
      );
      if (!targetObjectIds.length || targetObjectIds.some((id) => !emergencyObjectIds.has(id)))
        fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "target-object-invalid" });
      if (
        command.scenarioDefinitionId &&
        !emergencyPlan.scenarioDefinitions.some((scenario) => scenario.id === command.scenarioDefinitionId)
      )
        fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "scenario-not-found" });
      const action = {
        id: stableFingerprint("incident-emergency-action", {
          incidentId: incident.id,
          actionCode: command.actionCode,
          at,
        }),
        planId: register.source.planId,
        planVersion: register.source.planVersion,
        planFingerprint: register.source.planFingerprint,
        emergencyPlanFingerprint,
        validationId: register.source.validationId,
        approvalLedgerEntryId: register.source.approvalLedgerEntryId,
        actionCode: command.actionCode,
        targetObjectIds,
        ...(command.scenarioDefinitionId ? { scenarioDefinitionId: command.scenarioDefinitionId } : {}),
        authorityRole: command.authorityRole,
        recordedAt: at,
        recordedBy: actor.actorId,
      };
      incident.emergencyActions.push(action);
      return action;
    },
  });
}

const ATTACHMENT_KEYS = new Set([
  "id",
  "kind",
  "status",
  "contentType",
  "byteLength",
  "sha256",
  "widthPx",
  "heightPx",
  "uploadedBy",
  "uploadedAt",
]);
export function attachIncidentEvidence(
  register: IncidentRegister,
  command: AttachIncidentEvidenceCommand,
  { committedAt = new Date().toISOString() }: { committedAt?: string } = {},
): IncidentMutationResult {
  return mutateIncident(register, command, {
    operation: "attach_incident_evidence",
    eventType: "incident.attachment_attached",
    committedAt,
    mutate: (incident, at, actor) => {
      assertMutable(incident);
      const input = command.attachment;
      const expectedKind = input?.contentType === "application/pdf" ? "document" : "photo";
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        Object.keys(input).some((key) => !ATTACHMENT_KEYS.has(key)) ||
        input.kind !== expectedKind ||
        input.status !== "available" ||
        !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(input.contentType) ||
        !Number.isInteger(input.byteLength) ||
        input.byteLength < 1 ||
        input.byteLength > 5 * 1024 * 1024 ||
        typeof input.sha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(input.sha256) ||
        input.uploadedBy !== actor.actorId ||
        Date.parse(input.uploadedAt) > Date.parse(at)
      )
        fail("INCIDENT_ATTACHMENT_INVALID", { incidentId: incident.id, reason: "attachment-metadata-invalid" });
      if (incident.attachments.some((attachment) => attachment.id === input.id))
        fail("INCIDENT_ATTACHMENT_INVALID", {
          incidentId: incident.id,
          reason: "attachment-id-conflict",
          attachmentId: input.id,
        });
      for (const dimension of [input.widthPx, input.heightPx])
        if (dimension != null && (!Number.isInteger(dimension) || dimension < 1 || dimension > 50_000))
          fail("INCIDENT_ATTACHMENT_INVALID", { incidentId: incident.id, reason: "attachment-dimension-invalid" });
      const attachment: IncidentAttachment = {
        id: text(input.id, "attachment-id-required"),
        kind: expectedKind,
        status: "available",
        contentType: input.contentType,
        byteLength: input.byteLength,
        sha256: input.sha256,
        ...(input.widthPx ? { widthPx: input.widthPx } : {}),
        ...(input.heightPx ? { heightPx: input.heightPx } : {}),
        uploadedBy: input.uploadedBy,
        uploadedAt: instant(input.uploadedAt, "attachment-uploaded-at-invalid"),
        attachedAt: at,
      };
      incident.attachments.push(attachment);
      return attachment;
    },
  });
}

export function inspectIncident(
  register: IncidentRegister,
  { incidentId }: Pick<InspectIncidentCommand, "incidentId">,
): Readonly<OperationalIncident> {
  const incident = register.incidents.find((candidate) => candidate.id === incidentId);
  if (!incident) fail("INCIDENT_NOT_FOUND", { incidentId });
  return freeze(clone(incident));
}

export function inspectIncidents(
  register: IncidentRegister,
  filters: Omit<InspectIncidentsCommand, "type"> = {},
): readonly OperationalIncident[] {
  if (filters.status && !INCIDENT_STATUSES.includes(filters.status))
    fail("INCIDENT_INVALID", { reason: "status-filter-invalid" });
  if (filters.severity && !INCIDENT_SEVERITIES.includes(filters.severity))
    fail("INCIDENT_INVALID", { reason: "severity-filter-invalid" });
  if (filters.category && !INCIDENT_CATEGORIES.includes(filters.category))
    fail("INCIDENT_INVALID", { reason: "category-filter-invalid" });
  const severityOrder = ["critical", "high", "medium", "low"];
  return freeze(
    register.incidents
      .filter((incident) => !filters.status || incident.status === filters.status)
      .filter((incident) => !filters.severity || incident.severity === filters.severity)
      .filter((incident) => !filters.category || incident.category === filters.category)
      .map(clone)
      .sort(
        (left, right) =>
          severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity) ||
          left.timestamps.reportedAt.localeCompare(right.timestamps.reportedAt) ||
          left.id.localeCompare(right.id),
      ),
  );
}

export function exportIncidentRecord(
  register: IncidentRegister,
  { incidentId, exportedAt = new Date().toISOString() }: ExportIncidentRecordCommand,
) {
  const at = instant(exportedAt, "exported-at-invalid");
  const integrity = verifyIncidentLedger(register);
  if (integrity.status !== "pass") fail("INCIDENT_LEDGER_INTEGRITY_FAILED", { sequence: integrity.sequence ?? null });
  const incident = inspectIncident(register, { incidentId });
  const transitions = register.transitions.filter((transition) => transition.incidentId === incidentId).map(clone);
  const ledger = register.ledger.filter((entry) => entry.incidentId === incidentId).map(clone);
  const artifact = {
    schemaVersion: 1,
    kind: "venuemind-incident-record",
    exportedAt: at,
    register: {
      id: register.id,
      projectId: register.projectId,
      runbookVersionId: register.runbookVersionId,
      revision: register.revision,
    },
    source: clone(register.source),
    incident: clone(incident),
    transitions,
    receipts: register.receipts.filter((receipt) => receipt.incidentId === incidentId).map(clone),
    integrity,
    ledger,
    privacy: {
      attendeeRecordsStored: false,
      contactRecordsStored: false,
      medicalNarrativeStored: false,
      attachmentBytesIncluded: false,
    },
  };
  return {
    filename: `${incident.id}.incident.json`,
    mimeType: "application/json",
    content: JSON.stringify(artifact, null, 2),
  };
}

export function verifyIncidentLedger(register: IncidentRegister) {
  if (
    !register ||
    !Array.isArray(register.incidents) ||
    !Array.isArray(register.transitions) ||
    !Array.isArray(register.receipts) ||
    !Array.isArray(register.ledger)
  )
    return { status: "fail", reason: "register-shape" };
  const baselineFingerprint = stableFingerprint("incident-baseline", {
    source: register.source,
    acceptedPlan: register.baseline?.acceptedPlan,
    emergencyPlan: register.baseline?.emergencyPlan ?? null,
    runbookTaskIds: register.baseline?.runbookTaskIds,
  });
  if (
    !register.baseline ||
    register.baseline.fingerprint !== baselineFingerprint ||
    register.runbookVersionId !== register.source?.runbookVersionId
  )
    return { status: "fail", reason: "baseline-fingerprint" };
  if (
    register.revision !== register.transitions.length ||
    register.transitions.length !== register.receipts.length ||
    register.transitions.length !== register.ledger.length
  )
    return { status: "fail", reason: "evidence-count" };
  const incidentIds = new Set<string>();
  for (const incident of register.incidents) {
    if (!incident?.id || incidentIds.has(incident.id)) return { status: "fail", reason: "incident-id" };
    incidentIds.add(incident.id);
  }
  let previousHash = register.source.runbookLedgerHeadHash;
  for (let index = 0; index < register.ledger.length; index += 1) {
    const entry = register.ledger[index];
    const transition = register.transitions[index];
    const receipt = register.receipts[index];
    if (!entry || !transition || !receipt) return { status: "fail", sequence: index + 1, reason: "evidence-missing" };
    const { hash, ...unsigned } = entry;
    if (
      entry.sequence !== index + 1 ||
      transition?.sequence !== index + 1 ||
      entry.previousHash !== previousHash ||
      hash !== stableFingerprint("incident-ledger", unsigned)
    )
      return { status: "fail", sequence: entry.sequence, reason: "ledger-chain" };
    if (
      !incidentIds.has(entry.incidentId) ||
      transition.id !== entry.transitionId ||
      transition.incidentId !== entry.incidentId ||
      transition.type !== entry.type ||
      transition.actorType !== entry.actorType ||
      transition.actorId !== entry.actorId ||
      transition.source !== entry.source ||
      transition.sessionId !== entry.sessionId ||
      transition.committedAt !== entry.committedAt ||
      transition.resultingIncidentFingerprint !== entry.resultingIncidentFingerprint ||
      transition.receiptFingerprint !== entry.receiptFingerprint ||
      stableFingerprint("incident-location", transition.location) !==
        stableFingerprint("incident-location", entry.location) ||
      stableFingerprint("incident-details", transition.details) !== stableFingerprint("incident-details", entry.details)
    )
      return { status: "fail", sequence: entry.sequence, reason: "transition-ledger-mismatch" };
    const committedAtMs = Date.parse(entry.committedAt);
    if (
      !["human", "agent", "system"].includes(entry.actorType) ||
      typeof entry.actorId !== "string" ||
      !entry.actorId ||
      typeof entry.sessionId !== "string" ||
      !entry.sessionId ||
      typeof entry.source !== "string" ||
      !entry.source ||
      !Number.isFinite(committedAtMs) ||
      new Date(committedAtMs).toISOString() !== entry.committedAt ||
      !entry.location
    )
      return { status: "fail", sequence: entry.sequence, reason: "transition-context" };
    if (
      entry.location.planId !== register.source.planId ||
      entry.location.planVersion !== register.source.planVersion ||
      entry.location.planFingerprint !== register.source.planFingerprint
    )
      return { status: "fail", sequence: entry.sequence, reason: "location-baseline" };
    if (
      !receipt ||
      receipt.ledgerSequence !== entry.sequence ||
      receipt.incidentId !== entry.incidentId ||
      receipt.incidentRevision !== transition.toIncidentRevision ||
      transition.fromIncidentRevision + 1 !== transition.toIncidentRevision ||
      !receipt.idempotencyKey ||
      !receipt.inputFingerprint ||
      receipt.acceptedAt !== transition.committedAt ||
      transition.receiptFingerprint !== stableFingerprint("incident-receipt-evidence", receipt)
    )
      return { status: "fail", sequence: entry.sequence, reason: "receipt-transition-mismatch" };
    previousHash = hash;
  }
  for (const incident of register.incidents) {
    const transitions = register.transitions.filter((transition) => transition.incidentId === incident.id);
    const firstTransition = transitions[0];
    const lastTransition = transitions.at(-1);
    if (
      !firstTransition ||
      !lastTransition ||
      firstTransition.fromIncidentRevision !== 0 ||
      lastTransition.toIncidentRevision !== incident.revision ||
      lastTransition.resultingIncidentFingerprint !== stableFingerprint("incident-projection", incident)
    )
      return { status: "fail", reason: "incident-projection", incidentId: incident.id };
    for (let index = 1; index < transitions.length; index += 1) {
      const currentTransition = transitions[index];
      const previousTransition = transitions[index - 1];
      if (
        !currentTransition ||
        !previousTransition ||
        currentTransition.fromIncidentRevision !== previousTransition.toIncidentRevision
      )
        return { status: "fail", reason: "incident-revision", incidentId: incident.id };
    }
  }
  return { status: "pass", entries: register.ledger.length, headHash: previousHash };
}
