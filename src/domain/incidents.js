import { stableFingerprint } from "./activity-ledger.js";
import { venueError } from "./errors.js";

const clone = (value) => structuredClone(value);
const freeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

const fail = (code, details = {}) => { throw venueError(code, details); };

export const INCIDENT_SEVERITIES = Object.freeze(["low", "medium", "high", "critical"]);
export const INCIDENT_CATEGORIES = Object.freeze(["accessibility", "crowd-capacity", "medical", "security", "fire-life-safety", "facilities", "production-av", "catering", "staffing", "transport", "weather", "other"]);
export const INCIDENT_STATUSES = Object.freeze(["open", "mitigating", "resolved", "closed"]);
export const INCIDENT_ESCALATION_LEVELS = Object.freeze(["none", "team", "venue-command", "emergency-response"]);

const PROHIBITED_FIELD = /(?:attendee|person|name|email|phone|contact|address|ticket|barcode|qr|device|medicalrecord|diagnosis|health|patient)/i;
const screenPrivacy = (value) => {
  if (Array.isArray(value)) return value.forEach(screenPrivacy);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_FIELD.test(key)) fail("INCIDENT_PRIVACY_REJECTED", { field: key });
    screenPrivacy(child);
  }
};

const text = (value, reason) => {
  if (typeof value !== "string" || !value.trim()) fail("INCIDENT_INVALID", { reason });
  return value.trim();
};

const instant = (value, reason) => {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) fail("INCIDENT_INVALID", { reason });
  return value;
};

const pointOnSegment = (point, start, end) => {
  const cross = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) return false;
  return point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x) && point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);
};
const pointInRing = (point, ring) => {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint = ring[index];
    const previousPoint = ring[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    if (((currentPoint.y > point.y) !== (previousPoint.y > point.y)) && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x) inside = !inside;
  }
  return inside;
};
const pointInRoom = (point, boundary) => pointInRing(point, boundary.outer) && !(boundary.holes ?? []).some((hole) => pointInRing(point, hole));

const locationContext = (register, location) => {
  const prefix = {
    planId: register.source.planId,
    planVersion: register.source.planVersion,
    planFingerprint: register.source.planFingerprint,
  };
  if (location?.kind === "plan-object" && typeof location.planObjectId === "string" && register.baseline.acceptedPlan.objects.some((object) => object.id === location.planObjectId)) {
    return { ...prefix, kind: "plan-object", planObjectId: location.planObjectId };
  }
  const point = location?.point;
  const boundary = register.baseline.acceptedPlan.spatial?.roomBoundary;
  if (location?.kind === "coordinate" && point && Number.isFinite(point.x) && Number.isFinite(point.y) && boundary?.outer?.length >= 3 && pointInRoom(point, boundary)) {
    return { ...prefix, kind: "coordinate", point: { x: point.x, y: point.y } };
  }
  fail("INCIDENT_LOCATION_INVALID", { reason: "location-invalid" });
};

const normalizeRelatedRefs = (register, refs = []) => {
  if (!Array.isArray(refs) || refs.length > 50) fail("INCIDENT_INVALID", { reason: "related-refs-invalid" });
  const supported = new Set(["occupancy-alert", "runbook-task", "plan-object"]);
  const result = refs.map((ref) => {
    if (!ref || !supported.has(ref.kind) || typeof ref.id !== "string" || !ref.id || Object.keys(ref).some((key) => !["kind", "id"].includes(key))) fail("INCIDENT_INVALID", { reason: "related-ref-invalid" });
    if (ref.kind === "plan-object" && !register.baseline.acceptedPlan.objects.some((object) => object.id === ref.id)) fail("INCIDENT_INVALID", { reason: "related-plan-object-not-found", id: ref.id });
    if (ref.kind === "runbook-task" && !register.baseline.runbookTaskIds.includes(ref.id)) fail("INCIDENT_INVALID", { reason: "related-runbook-task-not-found", id: ref.id });
    return { kind: ref.kind, id: ref.id };
  });
  return [...new Map(result.map((ref) => [`${ref.kind}\u0000${ref.id}`, ref])).values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
};

const appendLedger = (register, transition) => {
  const sequence = register.ledger.length + 1;
  const previousHash = register.ledger.at(-1)?.hash ?? register.source.runbookLedgerHeadHash;
  const entry = {
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
    previousHash,
  };
  return { ...entry, hash: stableFingerprint("incident-ledger", entry) };
};

export function createIncidentRegister({ projectId, runbook, createdAt, createdBy }) {
  if (!projectId || !runbook?.versionId || runbook.status !== "active" || runbook.source?.projectId !== projectId || !runbook.baseline?.acceptedPlan || !runbook.source?.planFingerprint) fail("INCIDENT_BASELINE_INVALID", { reason: "active-runbook-required" });
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
  const baseline = { acceptedPlan, emergencyPlan: clone(emergencyPlan), runbookTaskIds: runbook.tasks.map((task) => task.id).sort() };
  baseline.fingerprint = stableFingerprint("incident-baseline", { source, acceptedPlan, emergencyPlan });
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

const metadata = (command) => ({
  actorType: command.actorType,
  actorId: text(command.actorId, "actor-id-required"),
  source: text(command.source, "source-required"),
  sessionId: text(command.sessionId, "session-id-required"),
});

export function reportIncident(register, command, { committedAt = new Date().toISOString() } = {}) {
  if (!command?.idempotencyKey) fail("IDEMPOTENCY_KEY_REQUIRED", { commandType: "report_incident" });
  screenPrivacy(command);
  const acceptedAt = instant(committedAt, "committed-at-invalid");
  const location = locationContext(register, command.location);
  if (!INCIDENT_SEVERITIES.includes(command.severity) || !INCIDENT_CATEGORIES.includes(command.category)) fail("INCIDENT_INVALID", { reason: "classification-invalid" });
  if (typeof command.summaryCode !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(command.summaryCode)) fail("INCIDENT_INVALID", { reason: "summary-code-invalid" });
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
    if (retry.inputFingerprint !== inputFingerprint) fail("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
    return { register, incident: register.incidents.find((incident) => incident.id === retry.incidentId), receipt: retry, duplicate: true };
  }
  const incidentId = text(command.incidentId, "incident-id-required");
  if (register.incidents.some((incident) => incident.id === incidentId)) fail("INCIDENT_ID_CONFLICT", { incidentId });
  const actor = metadata(command);
  const incident = {
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
  const transition = {
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
  };
  const next = clone(register);
  next.incidents.push(incident);
  next.transitions.push(transition);
  next.revision += 1;
  next.updatedAt = acceptedAt;
  next.ledger.push(appendLedger(next, transition));
  const receipt = {
    id: `incident-receipt-${inputFingerprint.slice(-12)}`,
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    operation: "report_incident",
    incidentId,
    incidentRevision: 1,
    ledgerSequence: next.ledger.length,
    acceptedAt,
  };
  next.receipts.push(receipt);
  return { register: freeze(next), incident: freeze(clone(incident)), receipt: freeze(clone(receipt)), duplicate: false };
}

const requireHuman = (command, operation) => {
  if (command.actorType !== "human") fail("INCIDENT_HUMAN_REQUIRED", { operation, actorType: command.actorType ?? null });
};

const semanticInput = (command) => Object.fromEntries(Object.entries(command).filter(([key]) => !["idempotencyKey", "correlationId", "operationId", "actorType", "actorId", "source", "sessionId", "committedAt"].includes(key)));

const mutateIncident = (register, command, { operation, eventType, committedAt, human = true, mutate }) => {
  if (!command?.idempotencyKey) fail("IDEMPOTENCY_KEY_REQUIRED", { commandType: operation });
  if (human) requireHuman(command, operation);
  screenPrivacy(command);
  const acceptedAt = instant(committedAt ?? new Date().toISOString(), "committed-at-invalid");
  const inputFingerprint = stableFingerprint(`incident-${operation}`, semanticInput(command));
  const retry = register.receipts.find((receipt) => receipt.idempotencyKey === command.idempotencyKey);
  if (retry) {
    if (retry.inputFingerprint !== inputFingerprint) fail("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
    return { register, incident: inspectIncident(register, { incidentId: retry.incidentId }), receipt: retry, duplicate: true };
  }
  const incidentId = text(command.incidentId, "incident-id-required");
  const current = register.incidents.find((incident) => incident.id === incidentId);
  if (!current) fail("INCIDENT_NOT_FOUND", { incidentId });
  if (!Number.isInteger(command.expectedIncidentRevision) || command.expectedIncidentRevision !== current.revision) fail("INCIDENT_REVISION_CONFLICT", { incidentId, expectedIncidentRevision: command.expectedIncidentRevision, currentIncidentRevision: current.revision });
  const actor = metadata(command);
  const nextIncident = clone(current);
  const details = mutate(nextIncident, acceptedAt, actor) ?? {};
  nextIncident.revision += 1;
  nextIncident.timestamps.updatedAt = acceptedAt;
  const transition = {
    id: stableFingerprint("incident-transition", { registerId: register.id, idempotencyKey: command.idempotencyKey, inputFingerprint }),
    sequence: register.transitions.length + 1,
    type: eventType,
    incidentId,
    fromIncidentRevision: current.revision,
    toIncidentRevision: nextIncident.revision,
    ...actor,
    committedAt: acceptedAt,
    location: clone(nextIncident.location),
    details: clone(details),
  };
  const next = clone(register);
  next.incidents = next.incidents.map((incident) => incident.id === incidentId ? nextIncident : incident);
  next.transitions.push(transition);
  next.revision += 1;
  next.updatedAt = acceptedAt;
  next.ledger.push(appendLedger(next, transition));
  const receipt = {
    id: stableFingerprint("incident-receipt", { registerId: register.id, idempotencyKey: command.idempotencyKey, inputFingerprint }),
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    operation,
    incidentId,
    incidentRevision: nextIncident.revision,
    ledgerSequence: next.ledger.length,
    acceptedAt,
  };
  next.receipts.push(receipt);
  return { register: freeze(next), incident: freeze(clone(nextIncident)), receipt: freeze(clone(receipt)), duplicate: false };
};

const assertMutable = (incident) => {
  if (incident.status === "closed") fail("INCIDENT_TRANSITION_INVALID", { incidentId: incident.id, reason: "incident-closed" });
};

const normalizeOwner = (register, owner) => {
  const allowed = ["roleId", "shiftId", "staffPostObjectId", "assignmentId"];
  if (!owner || typeof owner !== "object" || Array.isArray(owner) || Object.keys(owner).some((key) => !allowed.includes(key))) fail("INCIDENT_OWNER_INVALID", { reason: "owner-shape-invalid" });
  const plan = register.baseline.acceptedPlan;
  if (!plan.staffing?.roles?.some((role) => role.id === owner.roleId)) fail("INCIDENT_OWNER_INVALID", { reason: "role-not-found", roleId: owner.roleId ?? null });
  if (owner.shiftId != null && !plan.staffing?.shifts?.some((shift) => shift.id === owner.shiftId)) fail("INCIDENT_OWNER_INVALID", { reason: "shift-not-found", shiftId: owner.shiftId });
  if (owner.staffPostObjectId != null && !plan.objects.some((object) => object.id === owner.staffPostObjectId && object.staffPost)) fail("INCIDENT_OWNER_INVALID", { reason: "staff-post-not-found", staffPostObjectId: owner.staffPostObjectId });
  if (owner.assignmentId != null && (typeof owner.assignmentId !== "string" || !/^(?:assignment|staff-ref)-[a-z0-9-]{1,128}$/.test(owner.assignmentId))) fail("INCIDENT_OWNER_INVALID", { reason: "assignment-invalid" });
  return { roleId: owner.roleId, ...(owner.shiftId ? { shiftId: owner.shiftId } : {}), ...(owner.staffPostObjectId ? { staffPostObjectId: owner.staffPostObjectId } : {}), ...(owner.assignmentId ? { assignmentId: owner.assignmentId.trim() } : {}) };
};

const code = (value, reason) => {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(value)) fail("INCIDENT_INVALID", { reason });
  return value;
};
const codes = (values, reason) => {
  if (!Array.isArray(values) || values.length > 50) fail("INCIDENT_INVALID", { reason });
  return [...new Set(values.map((value) => code(value, reason)))].sort();
};

export function classifyIncident(register, command, { committedAt = new Date().toISOString() } = {}) {
  return mutateIncident(register, command, { operation: "classify_incident", eventType: "incident.classified", committedAt, mutate: (incident) => {
    assertMutable(incident);
    if (!INCIDENT_SEVERITIES.includes(command.severity) || !INCIDENT_CATEGORIES.includes(command.category)) fail("INCIDENT_INVALID", { reason: "classification-invalid" });
    incident.severity = command.severity;
    incident.category = command.category;
    incident.summaryCode = code(command.summaryCode, "summary-code-invalid");
    return { severity: incident.severity, category: incident.category, summaryCode: incident.summaryCode };
  } });
}

export function setIncidentOwner(register, command, { committedAt = new Date().toISOString() } = {}) {
  return mutateIncident(register, command, { operation: "set_incident_owner", eventType: "incident.owner_set", committedAt, mutate: (incident) => {
    assertMutable(incident);
    const owner = normalizeOwner(register, command.owner);
    const previousOwner = clone(incident.owner);
    incident.owner = owner;
    return { previousOwner, owner };
  } });
}

export function acknowledgeIncident(register, command, { committedAt = new Date().toISOString() } = {}) {
  return mutateIncident(register, command, { operation: "acknowledge_incident", eventType: "incident.acknowledged", committedAt, mutate: (incident, at, actor) => {
    assertMutable(incident);
    if (incident.acknowledgement.status !== "pending") fail("INCIDENT_ACKNOWLEDGEMENT_INVALID", { incidentId: incident.id, reason: "already-acknowledged" });
    const reasonCode = code(command.reasonCode, "acknowledgement-reason-invalid");
    incident.acknowledgement = { status: "acknowledged", acknowledgedAt: at, acknowledgedBy: actor.actorId, reasonCode };
    incident.timestamps.acknowledgedAt = at;
    return clone(incident.acknowledgement);
  } });
}

export function escalateIncident(register, command, { committedAt = new Date().toISOString() } = {}) {
  return mutateIncident(register, command, { operation: "escalate_incident", eventType: "incident.escalated", committedAt, mutate: (incident, at, actor) => {
    assertMutable(incident);
    const fromLevel = incident.escalation.level;
    if (!INCIDENT_ESCALATION_LEVELS.includes(command.level) || INCIDENT_ESCALATION_LEVELS.indexOf(command.level) <= INCIDENT_ESCALATION_LEVELS.indexOf(fromLevel)) fail("INCIDENT_ESCALATION_INVALID", { incidentId: incident.id, fromLevel, toLevel: command.level });
    const reasonCode = code(command.reasonCode, "escalation-reason-invalid");
    incident.escalation = { level: command.level, escalatedAt: at, escalatedBy: actor.actorId, reasonCode };
    incident.timestamps.escalatedAt = at;
    return { fromLevel, ...clone(incident.escalation) };
  } });
}

export function relocateIncident(register, command, { committedAt = new Date().toISOString() } = {}) {
  return mutateIncident(register, command, { operation: "relocate_incident", eventType: "incident.relocated", committedAt, mutate: (incident) => {
    assertMutable(incident);
    const previousLocation = clone(incident.location);
    incident.location = locationContext(register, command.location);
    return { previousLocation, location: clone(incident.location), reasonCode: code(command.reasonCode, "relocation-reason-invalid") };
  } });
}

const STATUS_TRANSITIONS = Object.freeze({ open: ["mitigating", "resolved"], mitigating: ["resolved"], resolved: ["closed", "open"], closed: ["open"] });
export function transitionIncidentStatus(register, command, { committedAt = new Date().toISOString() } = {}) {
  return mutateIncident(register, command, { operation: "transition_incident_status", eventType: `incident.status_${String(command.toStatus).replaceAll("-", "_")}`, committedAt, mutate: (incident, at, actor) => {
    const fromStatus = incident.status;
    if (!INCIDENT_STATUSES.includes(command.toStatus) || !STATUS_TRANSITIONS[fromStatus]?.includes(command.toStatus)) fail("INCIDENT_TRANSITION_INVALID", { incidentId: incident.id, fromStatus, toStatus: command.toStatus });
    const reopening = ["resolved", "closed"].includes(fromStatus) && command.toStatus === "open";
    const resolving = command.toStatus === "resolved";
    if (reopening && command.actorType !== "human") fail("INCIDENT_HUMAN_REQUIRED", { operation: "reopen_incident" });
    if (reopening) code(command.reasonCode, "reopen-reason-invalid");
    if (resolving && (incident.acknowledgement.status !== "acknowledged" || !incident.owner)) fail("INCIDENT_TRANSITION_INVALID", { incidentId: incident.id, reason: "acknowledgement-and-owner-required" });
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
    return { fromStatus, toStatus: command.toStatus, reasonCode: command.reasonCode ?? null, resolutionCode: command.resolutionCode ?? null, changedBy: actor.actorId };
  } });
}

export function handoffIncident(register, command, { committedAt = new Date().toISOString() } = {}) {
  return mutateIncident(register, command, { operation: "handoff_incident", eventType: "incident.handed_off", committedAt, mutate: (incident, at, actor) => {
    if (!["open", "mitigating"].includes(incident.status)) fail("INCIDENT_HANDOFF_INVALID", { incidentId: incident.id, reason: "status-invalid" });
    const fromOwner = normalizeOwner(register, command.fromOwner);
    const toOwner = normalizeOwner(register, command.toOwner);
    if (!incident.owner || stableFingerprint("incident-owner", incident.owner) !== stableFingerprint("incident-owner", fromOwner)) fail("INCIDENT_HANDOFF_INVALID", { incidentId: incident.id, reason: "outgoing-owner-mismatch" });
    if (stableFingerprint("incident-owner", fromOwner) === stableFingerprint("incident-owner", toOwner)) fail("INCIDENT_HANDOFF_INVALID", { incidentId: incident.id, reason: "owner-unchanged" });
    const handoff = { id: stableFingerprint("incident-handoff", { incidentId: incident.id, fromOwner, toOwner, at }), fromOwner, toOwner, openActionCodes: codes(command.openActionCodes, "handoff-action-code-invalid"), evidenceRefs: normalizeRelatedRefs(register, command.evidenceRefs), handedOffAt: at, handedOffBy: actor.actorId };
    incident.owner = toOwner;
    incident.handoffs.push(handoff);
    return handoff;
  } });
}

export function recordIncidentEmergencyAction(register, command, { committedAt = new Date().toISOString() } = {}) {
  return mutateIncident(register, command, { operation: "record_incident_emergency_action", eventType: "incident.emergency_action_recorded", committedAt, mutate: (incident, at, actor) => {
    if (!["open", "mitigating"].includes(incident.status) || !register.baseline.emergencyPlan || !register.source.emergencyPlanFingerprint) fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "approved-emergency-plan-required" });
    const actionCodes = ["EVACUATE", "SHELTER", "CLOSE_EXIT", "OPEN_ALTERNATE_ROUTE", "DISPATCH_FIRST_AID", "CALL_EMERGENCY_SERVICES"];
    if (!actionCodes.includes(command.actionCode)) fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "action-code-invalid" });
    if (!register.baseline.emergencyPlan.authorizedReviewerRoles.includes(command.authorityRole)) fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "authority-role-invalid" });
    const targetObjectIds = [...new Set(command.targetObjectIds ?? [])].sort();
    const emergencyObjectIds = new Set(register.baseline.acceptedPlan.objects.filter((object) => object.emergency || object.exit?.emergency).map((object) => object.id));
    if (!targetObjectIds.length || targetObjectIds.some((id) => !emergencyObjectIds.has(id))) fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "target-object-invalid" });
    if (command.scenarioDefinitionId && !register.baseline.emergencyPlan.scenarioDefinitions.some((scenario) => scenario.id === command.scenarioDefinitionId)) fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "scenario-not-found" });
    const action = { id: stableFingerprint("incident-emergency-action", { incidentId: incident.id, actionCode: command.actionCode, at }), planId: register.source.planId, planVersion: register.source.planVersion, planFingerprint: register.source.planFingerprint, emergencyPlanFingerprint: register.source.emergencyPlanFingerprint, validationId: register.source.validationId, approvalLedgerEntryId: register.source.approvalLedgerEntryId, actionCode: command.actionCode, targetObjectIds, ...(command.scenarioDefinitionId ? { scenarioDefinitionId: command.scenarioDefinitionId } : {}), authorityRole: command.authorityRole, recordedAt: at, recordedBy: actor.actorId };
    incident.emergencyActions.push(action);
    return action;
  } });
}

const ATTACHMENT_KEYS = new Set(["id", "kind", "status", "contentType", "byteLength", "sha256", "widthPx", "heightPx", "uploadedBy", "uploadedAt"]);
export function attachIncidentEvidence(register, command, { committedAt = new Date().toISOString() } = {}) {
  return mutateIncident(register, command, { operation: "attach_incident_evidence", eventType: "incident.attachment_attached", committedAt, mutate: (incident, at, actor) => {
    assertMutable(incident);
    const input = command.attachment;
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key) => !ATTACHMENT_KEYS.has(key)) || input.kind !== "photo" || input.status !== "available" || !["image/jpeg", "image/png", "image/webp"].includes(input.contentType) || !Number.isInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > 8 * 1024 * 1024 || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256) || input.uploadedBy !== actor.actorId || Date.parse(input.uploadedAt) > Date.parse(at)) fail("INCIDENT_ATTACHMENT_INVALID", { incidentId: incident.id, reason: "attachment-metadata-invalid" });
    if (incident.attachments.some((attachment) => attachment.id === input.id)) fail("INCIDENT_ATTACHMENT_INVALID", { incidentId: incident.id, reason: "attachment-id-conflict", attachmentId: input.id });
    for (const dimension of ["widthPx", "heightPx"]) if (input[dimension] != null && (!Number.isInteger(input[dimension]) || input[dimension] < 1 || input[dimension] > 50_000)) fail("INCIDENT_ATTACHMENT_INVALID", { incidentId: incident.id, reason: "attachment-dimension-invalid" });
    const attachment = { id: text(input.id, "attachment-id-required"), kind: "photo", status: "available", contentType: input.contentType, byteLength: input.byteLength, sha256: input.sha256, ...(input.widthPx ? { widthPx: input.widthPx } : {}), ...(input.heightPx ? { heightPx: input.heightPx } : {}), uploadedBy: input.uploadedBy, uploadedAt: instant(input.uploadedAt, "attachment-uploaded-at-invalid"), attachedAt: at };
    incident.attachments.push(attachment);
    return attachment;
  } });
}

export function inspectIncident(register, { incidentId }) {
  const incident = register.incidents.find((candidate) => candidate.id === incidentId);
  if (!incident) fail("INCIDENT_NOT_FOUND", { incidentId });
  return freeze(clone(incident));
}

export function inspectIncidents(register, filters = {}) {
  if (filters.status && !INCIDENT_STATUSES.includes(filters.status)) fail("INCIDENT_INVALID", { reason: "status-filter-invalid" });
  if (filters.severity && !INCIDENT_SEVERITIES.includes(filters.severity)) fail("INCIDENT_INVALID", { reason: "severity-filter-invalid" });
  if (filters.category && !INCIDENT_CATEGORIES.includes(filters.category)) fail("INCIDENT_INVALID", { reason: "category-filter-invalid" });
  const severityOrder = ["critical", "high", "medium", "low"];
  return freeze(register.incidents
    .filter((incident) => !filters.status || incident.status === filters.status)
    .filter((incident) => !filters.severity || incident.severity === filters.severity)
    .filter((incident) => !filters.category || incident.category === filters.category)
    .map(clone)
    .sort((left, right) => severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity) || left.timestamps.reportedAt.localeCompare(right.timestamps.reportedAt) || left.id.localeCompare(right.id)));
}

export function exportIncidentRecord(register, { incidentId, exportedAt = new Date().toISOString() }) {
  const at = instant(exportedAt, "exported-at-invalid");
  const integrity = verifyIncidentLedger(register);
  if (integrity.status !== "pass") fail("INCIDENT_LEDGER_INTEGRITY_FAILED", { sequence: integrity.sequence ?? null });
  const incident = inspectIncident(register, { incidentId });
  const transitions = register.transitions.filter((transition) => transition.incidentId === incidentId).map(clone);
  const ledger = register.ledger.filter((entry) => entry.incidentId === incidentId).map(clone);
  const artifact = { schemaVersion: 1, kind: "venuemind-incident-record", exportedAt: at, register: { id: register.id, projectId: register.projectId, runbookVersionId: register.runbookVersionId, revision: register.revision }, source: clone(register.source), incident: clone(incident), transitions, receipts: register.receipts.filter((receipt) => receipt.incidentId === incidentId).map(clone), integrity, ledger, privacy: { attendeeRecordsStored: false, contactRecordsStored: false, medicalNarrativeStored: false, attachmentBytesIncluded: false } };
  return { filename: `${incident.id}.incident.json`, mimeType: "application/json", content: JSON.stringify(artifact, null, 2) };
}

export function verifyIncidentLedger(register) {
  let previousHash = register.source.runbookLedgerHeadHash;
  for (let index = 0; index < register.ledger.length; index += 1) {
    const entry = register.ledger[index];
    const { hash, ...unsigned } = entry;
    if (entry.sequence !== index + 1 || entry.previousHash !== previousHash || hash !== stableFingerprint("incident-ledger", unsigned)) return { status: "fail", sequence: entry.sequence };
    previousHash = hash;
  }
  return { status: "pass", entries: register.ledger.length, headHash: previousHash };
}
