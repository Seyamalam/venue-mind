import { stableFingerprint } from "./activity-ledger.ts";
import { venueError } from "./errors.ts";

const clone: any = (value: any) => structuredClone(value);
const freeze: any = (value: any) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

const fail: any = (code: any, details: any = {}) => { throw venueError(code, details); };

export const INCIDENT_SEVERITIES = Object.freeze(["low", "medium", "high", "critical"]);
export const INCIDENT_CATEGORIES = Object.freeze(["accessibility", "crowd-capacity", "medical", "security", "fire-life-safety", "facilities", "production-av", "catering", "staffing", "transport", "weather", "other"]);
export const INCIDENT_STATUSES = Object.freeze(["open", "mitigating", "resolved", "closed"]);
export const INCIDENT_ESCALATION_LEVELS = Object.freeze(["none", "team", "venue-command", "emergency-response"]);

const PROHIBITED_FIELD: any = /(?:attendee|person|name|email|phone|contact|address|ticket|barcode|qr|device|medicalrecord|diagnosis|health|patient)/i;
const screenPrivacy: any = (value: any) => {
  if (Array.isArray(value)) return value.forEach(screenPrivacy);
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (PROHIBITED_FIELD.test(key)) fail("INCIDENT_PRIVACY_REJECTED", { field: key });
    screenPrivacy(child);
  }
};

const text: any = (value: any, reason: any) => {
  if (typeof value !== "string" || !value.trim()) fail("INCIDENT_INVALID", { reason });
  return value.trim();
};

const instant: any = (value: any, reason: any) => {
  const timestamp: any = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) fail("INCIDENT_INVALID", { reason });
  return value;
};

const pointOnSegment: any = (point: any, start: any, end: any) => {
  const cross: any = (point.y - start.y) * (end.x - start.x) - (point.x - start.x) * (end.y - start.y);
  if (Math.abs(cross) > 1e-9) return false;
  return point.x >= Math.min(start.x, end.x) && point.x <= Math.max(start.x, end.x) && point.y >= Math.min(start.y, end.y) && point.y <= Math.max(start.y, end.y);
};
const pointInRing: any = (point: any, ring: any) => {
  let inside: any = false;
  for (let index: any = 0, previous: any = ring.length - 1; index < ring.length; previous = index++) {
    const currentPoint: any = ring[index];
    const previousPoint: any = ring[previous];
    if (pointOnSegment(point, previousPoint, currentPoint)) return true;
    if (((currentPoint.y > point.y) !== (previousPoint.y > point.y)) && point.x < ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) / (previousPoint.y - currentPoint.y) + currentPoint.x) inside = !inside;
  }
  return inside;
};
const pointInRoom: any = (point: any, boundary: any) => pointInRing(point, boundary.outer) && !(boundary.holes ?? []).some((hole: any) => pointInRing(point, hole));

const locationContext: any = (register: any, location: any) => {
  const prefix: any = {
    planId: register.source.planId,
    planVersion: register.source.planVersion,
    planFingerprint: register.source.planFingerprint,
  };
  if (location?.kind === "plan-object" && typeof location.planObjectId === "string" && register.baseline.acceptedPlan.objects.some((object: any) => object.id === location.planObjectId)) {
    return { ...prefix, kind: "plan-object", planObjectId: location.planObjectId };
  }
  const point: any = location?.point;
  const boundary: any = register.baseline.acceptedPlan.spatial?.roomBoundary;
  if (location?.kind === "coordinate" && point && Number.isFinite(point.x) && Number.isFinite(point.y) && boundary?.outer?.length >= 3 && pointInRoom(point, boundary)) {
    return { ...prefix, kind: "coordinate", point: { x: point.x, y: point.y } };
  }
  fail("INCIDENT_LOCATION_INVALID", { reason: "location-invalid" });
};

const normalizeRelatedRefs: any = (register: any, refs: any = []) => {
  if (!Array.isArray(refs) || refs.length > 50) fail("INCIDENT_INVALID", { reason: "related-refs-invalid" });
  const supported: any = new Set(["occupancy-alert", "runbook-task", "plan-object"]);
  const result: any = refs.map((ref: any) => {
    if (!ref || !supported.has(ref.kind) || typeof ref.id !== "string" || !ref.id || Object.keys(ref).some((key: any) => !["kind", "id"].includes(key))) fail("INCIDENT_INVALID", { reason: "related-ref-invalid" });
    if (ref.kind === "plan-object" && !register.baseline.acceptedPlan.objects.some((object: any) => object.id === ref.id)) fail("INCIDENT_INVALID", { reason: "related-plan-object-not-found", id: ref.id });
    if (ref.kind === "runbook-task" && !register.baseline.runbookTaskIds.includes(ref.id)) fail("INCIDENT_INVALID", { reason: "related-runbook-task-not-found", id: ref.id });
    return { kind: ref.kind, id: ref.id };
  });
  return [...new Map(result.map((ref: any) => [`${ref.kind}\u0000${ref.id}`, ref])).values()].sort((left: any, right: any) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
};

const appendLedger: any = (register: any, transition: any) => {
  const sequence: any = register.ledger.length + 1;
  const previousHash: any = register.ledger.at(-1)?.hash ?? register.source.runbookLedgerHeadHash;
  const entry: any = {
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

export function createIncidentRegister({ projectId, runbook, createdAt, createdBy }: any) {
  if (!projectId || !runbook?.versionId || runbook.status !== "active" || runbook.source?.projectId !== projectId || !runbook.baseline?.acceptedPlan || !runbook.source?.planFingerprint) fail("INCIDENT_BASELINE_INVALID", { reason: "active-runbook-required" });
  const acceptedPlan: any = clone(runbook.baseline.acceptedPlan);
  const emergencyPlan: any = acceptedPlan.emergencyPlan ?? null;
  const now: any = instant(createdAt ?? new Date().toISOString(), "created-at-invalid");
  const source: any = {
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
  const baseline: any = { acceptedPlan, emergencyPlan: clone(emergencyPlan), runbookTaskIds: runbook.tasks.map((task: any) => task.id).sort() };
  baseline.fingerprint = stableFingerprint("incident-baseline", { source, acceptedPlan, emergencyPlan, runbookTaskIds: baseline.runbookTaskIds });
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

const metadata: any = (command: any) => {
  if (!["human", "agent", "system"].includes(command.actorType)) fail("INCIDENT_INVALID", { reason: "actor-type-invalid" });
  if (!["studio", "webmcp", "mcp", "system", "agent-tool"].includes(command.source)) fail("INCIDENT_INVALID", { reason: "source-invalid" });
  return {
    actorType: command.actorType,
    actorId: text(command.actorId, "actor-id-required"),
    source: command.source,
    sessionId: text(command.sessionId, "session-id-required"),
  };
};

export function reportIncident(register: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  if (!command?.idempotencyKey) fail("IDEMPOTENCY_KEY_REQUIRED", { commandType: "report_incident" });
  screenPrivacy(command);
  const acceptedAt: any = instant(committedAt, "committed-at-invalid");
  const location: any = locationContext(register, command.location);
  if (!INCIDENT_SEVERITIES.includes(command.severity) || !INCIDENT_CATEGORIES.includes(command.category)) fail("INCIDENT_INVALID", { reason: "classification-invalid" });
  if (typeof command.summaryCode !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(command.summaryCode)) fail("INCIDENT_INVALID", { reason: "summary-code-invalid" });
  const relatedRefs: any = normalizeRelatedRefs(register, command.relatedRefs);
  const input: any = {
    incidentId: command.incidentId,
    severity: command.severity,
    category: command.category,
    summaryCode: command.summaryCode,
    location: command.location,
    relatedRefs,
  };
  const inputFingerprint: any = stableFingerprint("incident-report", input);
  const retry: any = register.receipts.find((receipt: any) => receipt.idempotencyKey === command.idempotencyKey);
  if (retry) {
    if (retry.inputFingerprint !== inputFingerprint) fail("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
    return { register, incident: register.incidents.find((incident: any) => incident.id === retry.incidentId), receipt: retry, duplicate: true };
  }
  const incidentId: any = text(command.incidentId, "incident-id-required");
  if (register.incidents.some((incident: any) => incident.id === incidentId)) fail("INCIDENT_ID_CONFLICT", { incidentId });
  const actor: any = metadata(command);
  const incident: any = {
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
  const receipt: any = {
    id: `incident-receipt-${inputFingerprint.slice(-12)}`,
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    operation: "report_incident",
    incidentId,
    incidentRevision: 1,
    ledgerSequence: register.ledger.length + 1,
    acceptedAt,
  };
  const transition: any = {
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
  const next: any = clone(register);
  next.incidents.push(incident);
  next.transitions.push(transition);
  next.revision += 1;
  next.updatedAt = acceptedAt;
  next.ledger.push(appendLedger(next, transition));
  next.receipts.push(receipt);
  return { register: freeze(next), incident: freeze(clone(incident)), receipt: freeze(clone(receipt)), duplicate: false };
}

const requireHuman: any = (command: any, operation: any) => {
  if (command.actorType !== "human") fail("INCIDENT_HUMAN_REQUIRED", { operation, actorType: command.actorType ?? null });
};

const semanticInput: any = (command: any) => Object.fromEntries(Object.entries(command).filter(([key]: any) => !["idempotencyKey", "correlationId", "operationId", "actorType", "actorId", "source", "sessionId", "committedAt"].includes(key)));

const mutateIncident: any = (register: any, command: any, { operation, eventType, committedAt, human = true, mutate }: any) => {
  if (!command?.idempotencyKey) fail("IDEMPOTENCY_KEY_REQUIRED", { commandType: operation });
  if (human) requireHuman(command, operation);
  screenPrivacy(command);
  const acceptedAt: any = instant(committedAt ?? new Date().toISOString(), "committed-at-invalid");
  const inputFingerprint: any = stableFingerprint(`incident-${operation}`, semanticInput(command));
  const retry: any = register.receipts.find((receipt: any) => receipt.idempotencyKey === command.idempotencyKey);
  if (retry) {
    if (retry.inputFingerprint !== inputFingerprint) fail("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey });
    return { register, incident: inspectIncident(register, { incidentId: retry.incidentId }), receipt: retry, duplicate: true };
  }
  const incidentId: any = text(command.incidentId, "incident-id-required");
  const current: any = register.incidents.find((incident: any) => incident.id === incidentId);
  if (!current) fail("INCIDENT_NOT_FOUND", { incidentId });
  if (!Number.isInteger(command.expectedIncidentRevision) || command.expectedIncidentRevision !== current.revision) fail("INCIDENT_REVISION_CONFLICT", { incidentId, expectedIncidentRevision: command.expectedIncidentRevision, currentIncidentRevision: current.revision });
  const actor: any = metadata(command);
  const nextIncident: any = clone(current);
  const details: any = mutate(nextIncident, acceptedAt, actor) ?? {};
  nextIncident.revision += 1;
  nextIncident.timestamps.updatedAt = acceptedAt;
  const receipt: any = {
    id: stableFingerprint("incident-receipt", { registerId: register.id, idempotencyKey: command.idempotencyKey, inputFingerprint }),
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    operation,
    incidentId,
    incidentRevision: nextIncident.revision,
    ledgerSequence: register.ledger.length + 1,
    acceptedAt,
  };
  const transition: any = {
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
    resultingIncidentFingerprint: stableFingerprint("incident-projection", nextIncident),
    receiptFingerprint: stableFingerprint("incident-receipt-evidence", receipt),
  };
  const next: any = clone(register);
  next.incidents = next.incidents.map((incident: any) => incident.id === incidentId ? nextIncident : incident);
  next.transitions.push(transition);
  next.revision += 1;
  next.updatedAt = acceptedAt;
  next.ledger.push(appendLedger(next, transition));
  next.receipts.push(receipt);
  return { register: freeze(next), incident: freeze(clone(nextIncident)), receipt: freeze(clone(receipt)), duplicate: false };
};

const assertMutable: any = (incident: any) => {
  if (incident.status === "closed") fail("INCIDENT_TRANSITION_INVALID", { incidentId: incident.id, reason: "incident-closed" });
};

const normalizeOwner: any = (register: any, owner: any) => {
  const allowed: any = ["roleId", "shiftId", "staffPostObjectId", "assignmentId"];
  if (!owner || typeof owner !== "object" || Array.isArray(owner) || Object.keys(owner).some((key: any) => !allowed.includes(key))) fail("INCIDENT_OWNER_INVALID", { reason: "owner-shape-invalid" });
  const plan: any = register.baseline.acceptedPlan;
  if (!plan.staffing?.roles?.some((role: any) => role.id === owner.roleId)) fail("INCIDENT_OWNER_INVALID", { reason: "role-not-found", roleId: owner.roleId ?? null });
  if (owner.shiftId != null && !plan.staffing?.shifts?.some((shift: any) => shift.id === owner.shiftId)) fail("INCIDENT_OWNER_INVALID", { reason: "shift-not-found", shiftId: owner.shiftId });
  if (owner.staffPostObjectId != null && !plan.objects.some((object: any) => object.id === owner.staffPostObjectId && object.staffPost)) fail("INCIDENT_OWNER_INVALID", { reason: "staff-post-not-found", staffPostObjectId: owner.staffPostObjectId });
  if (owner.assignmentId != null && (typeof owner.assignmentId !== "string" || !/^(?:assignment|staff-ref)-[a-z0-9-]{1,128}$/.test(owner.assignmentId))) fail("INCIDENT_OWNER_INVALID", { reason: "assignment-invalid" });
  return { roleId: owner.roleId, ...(owner.shiftId ? { shiftId: owner.shiftId } : {}), ...(owner.staffPostObjectId ? { staffPostObjectId: owner.staffPostObjectId } : {}), ...(owner.assignmentId ? { assignmentId: owner.assignmentId.trim() } : {}) };
};

const code: any = (value: any, reason: any) => {
  if (typeof value !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(value)) fail("INCIDENT_INVALID", { reason });
  return value;
};
const codes: any = (values: any, reason: any) => {
  if (!Array.isArray(values) || values.length > 50) fail("INCIDENT_INVALID", { reason });
  return [...new Set(values.map((value: any) => code(value, reason)))].sort();
};

export function classifyIncident(register: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  return mutateIncident(register, command, { operation: "classify_incident", eventType: "incident.classified", committedAt, mutate: (incident: any) => {
    assertMutable(incident);
    if (!INCIDENT_SEVERITIES.includes(command.severity) || !INCIDENT_CATEGORIES.includes(command.category)) fail("INCIDENT_INVALID", { reason: "classification-invalid" });
    incident.severity = command.severity;
    incident.category = command.category;
    incident.summaryCode = code(command.summaryCode, "summary-code-invalid");
    return { severity: incident.severity, category: incident.category, summaryCode: incident.summaryCode };
  } });
}

export function setIncidentOwner(register: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  return mutateIncident(register, command, { operation: "set_incident_owner", eventType: "incident.owner_set", committedAt, mutate: (incident: any) => {
    assertMutable(incident);
    const owner: any = normalizeOwner(register, command.owner);
    const previousOwner: any = clone(incident.owner);
    incident.owner = owner;
    return { previousOwner, owner };
  } });
}

export function acknowledgeIncident(register: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  return mutateIncident(register, command, { operation: "acknowledge_incident", eventType: "incident.acknowledged", committedAt, mutate: (incident: any, at: any, actor: any) => {
    assertMutable(incident);
    if (incident.acknowledgement.status !== "pending") fail("INCIDENT_ACKNOWLEDGEMENT_INVALID", { incidentId: incident.id, reason: "already-acknowledged" });
    const reasonCode: any = code(command.reasonCode, "acknowledgement-reason-invalid");
    incident.acknowledgement = { status: "acknowledged", acknowledgedAt: at, acknowledgedBy: actor.actorId, reasonCode };
    incident.timestamps.acknowledgedAt = at;
    return clone(incident.acknowledgement);
  } });
}

export function escalateIncident(register: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  return mutateIncident(register, command, { operation: "escalate_incident", eventType: "incident.escalated", committedAt, mutate: (incident: any, at: any, actor: any) => {
    assertMutable(incident);
    const fromLevel: any = incident.escalation.level;
    if (!INCIDENT_ESCALATION_LEVELS.includes(command.level) || INCIDENT_ESCALATION_LEVELS.indexOf(command.level) <= INCIDENT_ESCALATION_LEVELS.indexOf(fromLevel)) fail("INCIDENT_ESCALATION_INVALID", { incidentId: incident.id, fromLevel, toLevel: command.level });
    const reasonCode: any = code(command.reasonCode, "escalation-reason-invalid");
    incident.escalation = { level: command.level, escalatedAt: at, escalatedBy: actor.actorId, reasonCode };
    incident.timestamps.escalatedAt = at;
    return { fromLevel, ...clone(incident.escalation) };
  } });
}

export function relocateIncident(register: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  return mutateIncident(register, command, { operation: "relocate_incident", eventType: "incident.relocated", committedAt, mutate: (incident: any) => {
    assertMutable(incident);
    const previousLocation: any = clone(incident.location);
    incident.location = locationContext(register, command.location);
    return { previousLocation, location: clone(incident.location), reasonCode: code(command.reasonCode, "relocation-reason-invalid") };
  } });
}

const STATUS_TRANSITIONS: any = Object.freeze({ open: ["mitigating", "resolved"], mitigating: ["resolved"], resolved: ["closed", "open"], closed: ["open"] });
export function transitionIncidentStatus(register: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  return mutateIncident(register, command, { operation: "transition_incident_status", eventType: `incident.status_${String(command.toStatus).replaceAll("-", "_")}`, committedAt, mutate: (incident: any, at: any, actor: any) => {
    const fromStatus: any = incident.status;
    if (!INCIDENT_STATUSES.includes(command.toStatus) || !STATUS_TRANSITIONS[fromStatus]?.includes(command.toStatus)) fail("INCIDENT_TRANSITION_INVALID", { incidentId: incident.id, fromStatus, toStatus: command.toStatus });
    const reopening: any = ["resolved", "closed"].includes(fromStatus) && command.toStatus === "open";
    const resolving: any = command.toStatus === "resolved";
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

export function handoffIncident(register: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  return mutateIncident(register, command, { operation: "handoff_incident", eventType: "incident.handed_off", committedAt, mutate: (incident: any, at: any, actor: any) => {
    if (!["open", "mitigating"].includes(incident.status)) fail("INCIDENT_HANDOFF_INVALID", { incidentId: incident.id, reason: "status-invalid" });
    const fromOwner: any = normalizeOwner(register, command.fromOwner);
    const toOwner: any = normalizeOwner(register, command.toOwner);
    if (!incident.owner || stableFingerprint("incident-owner", incident.owner) !== stableFingerprint("incident-owner", fromOwner)) fail("INCIDENT_HANDOFF_INVALID", { incidentId: incident.id, reason: "outgoing-owner-mismatch" });
    if (stableFingerprint("incident-owner", fromOwner) === stableFingerprint("incident-owner", toOwner)) fail("INCIDENT_HANDOFF_INVALID", { incidentId: incident.id, reason: "owner-unchanged" });
    const handoff: any = { id: stableFingerprint("incident-handoff", { incidentId: incident.id, fromOwner, toOwner, at }), fromOwner, toOwner, openActionCodes: codes(command.openActionCodes, "handoff-action-code-invalid"), evidenceRefs: normalizeRelatedRefs(register, command.evidenceRefs), handedOffAt: at, handedOffBy: actor.actorId };
    incident.owner = toOwner;
    incident.handoffs.push(handoff);
    return handoff;
  } });
}

export function recordIncidentEmergencyAction(register: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  return mutateIncident(register, command, { operation: "record_incident_emergency_action", eventType: "incident.emergency_action_recorded", committedAt, mutate: (incident: any, at: any, actor: any) => {
    if (!["open", "mitigating"].includes(incident.status) || !register.baseline.emergencyPlan || !register.source.emergencyPlanFingerprint) fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "approved-emergency-plan-required" });
    const actionCodes: any = ["EVACUATE", "SHELTER", "CLOSE_EXIT", "OPEN_ALTERNATE_ROUTE", "DISPATCH_FIRST_AID", "CALL_EMERGENCY_SERVICES"];
    if (!actionCodes.includes(command.actionCode)) fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "action-code-invalid" });
    if (!register.baseline.emergencyPlan.authorizedReviewerRoles.includes(command.authorityRole)) fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "authority-role-invalid" });
    const targetObjectIds: any = [...new Set(command.targetObjectIds ?? [])].sort();
    const emergencyObjectIds: any = new Set(register.baseline.acceptedPlan.objects.filter((object: any) => object.emergency || object.exit?.emergency).map((object: any) => object.id));
    if (!targetObjectIds.length || targetObjectIds.some((id: any) => !emergencyObjectIds.has(id))) fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "target-object-invalid" });
    if (command.scenarioDefinitionId && !register.baseline.emergencyPlan.scenarioDefinitions.some((scenario: any) => scenario.id === command.scenarioDefinitionId)) fail("INCIDENT_EMERGENCY_ACTION_INVALID", { incidentId: incident.id, reason: "scenario-not-found" });
    const action: any = { id: stableFingerprint("incident-emergency-action", { incidentId: incident.id, actionCode: command.actionCode, at }), planId: register.source.planId, planVersion: register.source.planVersion, planFingerprint: register.source.planFingerprint, emergencyPlanFingerprint: register.source.emergencyPlanFingerprint, validationId: register.source.validationId, approvalLedgerEntryId: register.source.approvalLedgerEntryId, actionCode: command.actionCode, targetObjectIds, ...(command.scenarioDefinitionId ? { scenarioDefinitionId: command.scenarioDefinitionId } : {}), authorityRole: command.authorityRole, recordedAt: at, recordedBy: actor.actorId };
    incident.emergencyActions.push(action);
    return action;
  } });
}

const ATTACHMENT_KEYS: any = new Set(["id", "kind", "status", "contentType", "byteLength", "sha256", "widthPx", "heightPx", "uploadedBy", "uploadedAt"]);
export function attachIncidentEvidence(register: any, command: any, { committedAt = new Date().toISOString() }: any = {}) {
  return mutateIncident(register, command, { operation: "attach_incident_evidence", eventType: "incident.attachment_attached", committedAt, mutate: (incident: any, at: any, actor: any) => {
    assertMutable(incident);
    const input: any = command.attachment;
    const expectedKind: any = input?.contentType === "application/pdf" ? "document" : "photo";
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((key: any) => !ATTACHMENT_KEYS.has(key)) || input.kind !== expectedKind || input.status !== "available" || !["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(input.contentType) || !Number.isInteger(input.byteLength) || input.byteLength < 1 || input.byteLength > 5 * 1024 * 1024 || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(input.sha256) || input.uploadedBy !== actor.actorId || Date.parse(input.uploadedAt) > Date.parse(at)) fail("INCIDENT_ATTACHMENT_INVALID", { incidentId: incident.id, reason: "attachment-metadata-invalid" });
    if (incident.attachments.some((attachment: any) => attachment.id === input.id)) fail("INCIDENT_ATTACHMENT_INVALID", { incidentId: incident.id, reason: "attachment-id-conflict", attachmentId: input.id });
    for (const dimension of ["widthPx", "heightPx"]) if (input[dimension] != null && (!Number.isInteger(input[dimension]) || input[dimension] < 1 || input[dimension] > 50_000)) fail("INCIDENT_ATTACHMENT_INVALID", { incidentId: incident.id, reason: "attachment-dimension-invalid" });
    const attachment: any = { id: text(input.id, "attachment-id-required"), kind: expectedKind, status: "available", contentType: input.contentType, byteLength: input.byteLength, sha256: input.sha256, ...(input.widthPx ? { widthPx: input.widthPx } : {}), ...(input.heightPx ? { heightPx: input.heightPx } : {}), uploadedBy: input.uploadedBy, uploadedAt: instant(input.uploadedAt, "attachment-uploaded-at-invalid"), attachedAt: at };
    incident.attachments.push(attachment);
    return attachment;
  } });
}

export function inspectIncident(register: any, { incidentId }: any) {
  const incident: any = register.incidents.find((candidate: any) => candidate.id === incidentId);
  if (!incident) fail("INCIDENT_NOT_FOUND", { incidentId });
  return freeze(clone(incident));
}

export function inspectIncidents(register: any, filters: any = {}) {
  if (filters.status && !INCIDENT_STATUSES.includes(filters.status)) fail("INCIDENT_INVALID", { reason: "status-filter-invalid" });
  if (filters.severity && !INCIDENT_SEVERITIES.includes(filters.severity)) fail("INCIDENT_INVALID", { reason: "severity-filter-invalid" });
  if (filters.category && !INCIDENT_CATEGORIES.includes(filters.category)) fail("INCIDENT_INVALID", { reason: "category-filter-invalid" });
  const severityOrder: any = ["critical", "high", "medium", "low"];
  return freeze(register.incidents
    .filter((incident: any) => !filters.status || incident.status === filters.status)
    .filter((incident: any) => !filters.severity || incident.severity === filters.severity)
    .filter((incident: any) => !filters.category || incident.category === filters.category)
    .map(clone)
    .sort((left: any, right: any) => severityOrder.indexOf(left.severity) - severityOrder.indexOf(right.severity) || left.timestamps.reportedAt.localeCompare(right.timestamps.reportedAt) || left.id.localeCompare(right.id)));
}

export function exportIncidentRecord(register: any, { incidentId, exportedAt = new Date().toISOString() }: any) {
  const at: any = instant(exportedAt, "exported-at-invalid");
  const integrity: any = verifyIncidentLedger(register);
  if (integrity.status !== "pass") fail("INCIDENT_LEDGER_INTEGRITY_FAILED", { sequence: integrity.sequence ?? null });
  const incident: any = inspectIncident(register, { incidentId });
  const transitions: any = register.transitions.filter((transition: any) => transition.incidentId === incidentId).map(clone);
  const ledger: any = register.ledger.filter((entry: any) => entry.incidentId === incidentId).map(clone);
  const artifact: any = { schemaVersion: 1, kind: "venuemind-incident-record", exportedAt: at, register: { id: register.id, projectId: register.projectId, runbookVersionId: register.runbookVersionId, revision: register.revision }, source: clone(register.source), incident: clone(incident), transitions, receipts: register.receipts.filter((receipt: any) => receipt.incidentId === incidentId).map(clone), integrity, ledger, privacy: { attendeeRecordsStored: false, contactRecordsStored: false, medicalNarrativeStored: false, attachmentBytesIncluded: false } };
  return { filename: `${incident.id}.incident.json`, mimeType: "application/json", content: JSON.stringify(artifact, null, 2) };
}

export function verifyIncidentLedger(register: any) {
  if (!register || !Array.isArray(register.incidents) || !Array.isArray(register.transitions) || !Array.isArray(register.receipts) || !Array.isArray(register.ledger)) return { status: "fail", reason: "register-shape" };
  const baselineFingerprint: any = stableFingerprint("incident-baseline", { source: register.source, acceptedPlan: register.baseline?.acceptedPlan, emergencyPlan: register.baseline?.emergencyPlan ?? null, runbookTaskIds: register.baseline?.runbookTaskIds });
  if (!register.baseline || register.baseline.fingerprint !== baselineFingerprint || register.runbookVersionId !== register.source?.runbookVersionId) return { status: "fail", reason: "baseline-fingerprint" };
  if (register.revision !== register.transitions.length || register.transitions.length !== register.receipts.length || register.transitions.length !== register.ledger.length) return { status: "fail", reason: "evidence-count" };
  const incidentIds: any = new Set();
  for (const incident of register.incidents) {
    if (!incident?.id || incidentIds.has(incident.id)) return { status: "fail", reason: "incident-id" };
    incidentIds.add(incident.id);
  }
  let previousHash: any = register.source.runbookLedgerHeadHash;
  for (let index: any = 0; index < register.ledger.length; index += 1) {
    const entry: any = register.ledger[index];
    const transition: any = register.transitions[index];
    const receipt: any = register.receipts[index];
    const { hash, ...unsigned } = entry;
    if (entry.sequence !== index + 1 || transition?.sequence !== index + 1 || entry.previousHash !== previousHash || hash !== stableFingerprint("incident-ledger", unsigned)) return { status: "fail", sequence: entry.sequence, reason: "ledger-chain" };
    if (!incidentIds.has(entry.incidentId) || transition.id !== entry.transitionId || transition.incidentId !== entry.incidentId || transition.type !== entry.type || transition.actorType !== entry.actorType || transition.actorId !== entry.actorId || transition.source !== entry.source || transition.sessionId !== entry.sessionId || transition.committedAt !== entry.committedAt || transition.resultingIncidentFingerprint !== entry.resultingIncidentFingerprint || transition.receiptFingerprint !== entry.receiptFingerprint || stableFingerprint("incident-location", transition.location) !== stableFingerprint("incident-location", entry.location) || stableFingerprint("incident-details", transition.details) !== stableFingerprint("incident-details", entry.details)) return { status: "fail", sequence: entry.sequence, reason: "transition-ledger-mismatch" };
    const committedAtMs: any = Date.parse(entry.committedAt);
    if (!["human", "agent", "system"].includes(entry.actorType) || typeof entry.actorId !== "string" || !entry.actorId || typeof entry.sessionId !== "string" || !entry.sessionId || typeof entry.source !== "string" || !entry.source || !Number.isFinite(committedAtMs) || new Date(committedAtMs).toISOString() !== entry.committedAt || !entry.location) return { status: "fail", sequence: entry.sequence, reason: "transition-context" };
    if (entry.location.planId !== register.source.planId || entry.location.planVersion !== register.source.planVersion || entry.location.planFingerprint !== register.source.planFingerprint) return { status: "fail", sequence: entry.sequence, reason: "location-baseline" };
    if (!receipt || receipt.ledgerSequence !== entry.sequence || receipt.incidentId !== entry.incidentId || receipt.incidentRevision !== transition.toIncidentRevision || transition.fromIncidentRevision + 1 !== transition.toIncidentRevision || !receipt.idempotencyKey || !receipt.inputFingerprint || receipt.acceptedAt !== transition.committedAt || transition.receiptFingerprint !== stableFingerprint("incident-receipt-evidence", receipt)) return { status: "fail", sequence: entry.sequence, reason: "receipt-transition-mismatch" };
    previousHash = hash;
  }
  for (const incident of register.incidents) {
    const transitions: any = register.transitions.filter((transition: any) => transition.incidentId === incident.id);
    if (!transitions.length || transitions[0].fromIncidentRevision !== 0 || transitions.at(-1).toIncidentRevision !== incident.revision || transitions.at(-1).resultingIncidentFingerprint !== stableFingerprint("incident-projection", incident)) return { status: "fail", reason: "incident-projection", incidentId: incident.id };
    for (let index = 1; index < transitions.length; index += 1) if (transitions[index].fromIncidentRevision !== transitions[index - 1].toIncidentRevision) return { status: "fail", reason: "incident-revision", incidentId: incident.id };
  }
  return { status: "pass", entries: register.ledger.length, headHash: previousHash };
}
