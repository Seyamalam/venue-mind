import test from "node:test";
import assert from "node:assert/strict";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import {
  acknowledgeIncident,
  attachIncidentEvidence,
  classifyIncident,
  createIncidentRegister,
  escalateIncident,
  exportIncidentRecord,
  handoffIncident,
  inspectIncident,
  inspectIncidents,
  recordIncidentEmergencyAction,
  relocateIncident,
  reportIncident,
  setIncidentOwner,
  transitionIncidentStatus,
  verifyIncidentLedger,
} from "../src/domain/incidents.js";

const makeRunbook = () => createEventDayRunbook({
  projectId: "project-summit-forward",
  plan: summitForwardPlan,
  validation: { validationId: "validation-approved", inputFingerprint: "validation-input-approved", status: "pass" },
  sourceLedgerHeadHash: "activity-ledger-head",
  approvalLedgerEntryId: "approval-ledger-entry",
  frozenAt: "2026-09-12T08:00:00.000Z",
  frozenBy: "user-ops",
});

const humanMetadata = (idempotencyKey, expectedIncidentRevision) => ({
  idempotencyKey,
  ...(expectedIncidentRevision === undefined ? {} : { expectedIncidentRevision }),
  actorType: "human",
  actorId: "user-ops",
  source: "studio",
  sessionId: "session-event-day",
});

const report = (overrides = {}) => ({
  incidentId: "incident-east-exit",
  severity: "high",
  category: "fire-life-safety",
  summaryCode: "EXIT_OBSTRUCTED",
  location: { kind: "plan-object", planObjectId: "obj-fire-exit-east" },
  relatedRefs: [{ kind: "plan-object", id: "obj-fire-exit-east" }],
  ...humanMetadata("incident-report-east-exit"),
  ...overrides,
});

test("Incident Register freezes the accepted Runbook baseline and reports one located Incident", () => {
  const runbook = makeRunbook();
  const register = createIncidentRegister({
    projectId: "project-summit-forward",
    runbook,
    createdAt: "2026-09-12T09:00:00.000Z",
    createdBy: "user-ops",
  });
  const result = reportIncident(register, report(), { committedAt: "2026-09-12T09:05:00.000Z" });

  assert.equal(register.source.planVersion, summitForwardPlan.version);
  assert.equal(register.source.runbookVersionId, runbook.versionId);
  assert.equal(result.incident.status, "open");
  assert.equal(result.incident.acknowledgement.status, "pending");
  assert.equal(result.incident.escalation.level, "none");
  assert.equal(result.incident.revision, 1);
  assert.equal(result.register.revision, 1);
  assert.equal(result.register.transitions.length, 1);
  assert.equal(result.register.receipts.length, 1);
  assert.equal(result.register.ledger.length, 1);
  assert.deepEqual(result.register.ledger[0].location, {
    planId: summitForwardPlan.id,
    planVersion: summitForwardPlan.version,
    planFingerprint: runbook.source.planFingerprint,
    kind: "plan-object",
    planObjectId: "obj-fire-exit-east",
  });
  assert.equal(result.register.ledger[0].actorId, "user-ops");
  assert.equal(result.register.ledger[0].committedAt, "2026-09-12T09:05:00.000Z");
  assert.equal(verifyIncidentLedger(result.register).status, "pass");
});

test("Incident reports accept in-room coordinates and exact agent retries without duplicating evidence", () => {
  const register = createIncidentRegister({ projectId: "project-summit-forward", runbook: makeRunbook(), createdAt: "2026-09-12T09:00:00.000Z", createdBy: "user-ops" });
  const command = report({
    incidentId: "incident-queue",
    severity: "medium",
    category: "crowd-capacity",
    summaryCode: "QUEUE_SPILLBACK",
    location: { kind: "coordinate", point: { x: 18, y: 9 } },
    relatedRefs: [],
    actorType: "agent",
    actorId: "agent-ops",
    source: "webmcp",
  });
  const first = reportIncident(register, command, { committedAt: "2026-09-12T09:05:00.000Z" });
  const retry = reportIncident(first.register, command, { committedAt: "2026-09-12T09:06:00.000Z" });

  assert.equal(retry.duplicate, true);
  assert.equal(retry.register.transitions.length, 1);
  assert.equal(retry.register.ledger.length, 1);
  assert.equal(retry.incident.location.kind, "coordinate");
  assert.deepEqual(retry.incident.location.point, { x: 18, y: 9 });
});

test("Incident reporting rejects unsafe classification, location, identity fields, and ID reuse", () => {
  const register = createIncidentRegister({ projectId: "project-summit-forward", runbook: makeRunbook(), createdAt: "2026-09-12T09:00:00.000Z", createdBy: "user-ops" });
  assert.throws(() => reportIncident(register, report({ severity: "urgent" })), (error) => error.code === "INCIDENT_INVALID");
  assert.throws(() => reportIncident(register, report({ location: { kind: "coordinate", point: { x: -100, y: -100 } } })), (error) => error.code === "INCIDENT_LOCATION_INVALID");
  assert.throws(() => reportIncident(register, report({ attendeeName: "Private Person" })), (error) => error.code === "INCIDENT_PRIVACY_REJECTED" && error.details.field === "attendeeName");
  const first = reportIncident(register, report(), { committedAt: "2026-09-12T09:05:00.000Z" });
  assert.throws(() => reportIncident(first.register, report({ idempotencyKey: "different-key" })), (error) => error.code === "INCIDENT_ID_CONFLICT");
  assert.throws(() => reportIncident(first.register, report({ severity: "critical" })), (error) => error.code === "IDEMPOTENCY_KEY_CONFLICT");
});

test("authorized humans classify, own, acknowledge, escalate, relocate, hand off, evidence, act, resolve, close, and export one Incident", () => {
  let register = createIncidentRegister({ projectId: "project-summit-forward", runbook: makeRunbook(), createdAt: "2026-09-12T09:00:00.000Z", createdBy: "user-ops" });
  ({ register } = reportIncident(register, report(), { committedAt: "2026-09-12T09:05:00.000Z" }));
  const apply = (operation, input, at) => {
    const result = operation(register, { incidentId: "incident-east-exit", ...input, ...humanMetadata(input.idempotencyKey, register.incidents[0].revision) }, { committedAt: at });
    register = result.register;
    return result;
  };
  apply(classifyIncident, { severity: "critical", category: "fire-life-safety", summaryCode: "EXIT_BLOCKED_CRITICAL", idempotencyKey: "classify-1" }, "2026-09-12T09:06:00.000Z");
  const firstOwner = { roleId: "role-security", shiftId: "shift-a", staffPostObjectId: "obj-post-exit", assignmentId: "assignment-security-east" };
  apply(setIncidentOwner, { owner: firstOwner, idempotencyKey: "owner-1" }, "2026-09-12T09:07:00.000Z");
  apply(acknowledgeIncident, { reasonCode: "OPS_OWNER_CONFIRMED", idempotencyKey: "ack-1" }, "2026-09-12T09:08:00.000Z");
  apply(escalateIncident, { level: "venue-command", reasonCode: "EXIT_CAPACITY_AT_RISK", idempotencyKey: "escalate-1" }, "2026-09-12T09:09:00.000Z");
  apply(relocateIncident, { location: { kind: "coordinate", point: { x: 29, y: 10 } }, reasonCode: "OBSTRUCTION_MOVED", idempotencyKey: "relocate-1" }, "2026-09-12T09:10:00.000Z");
  const secondOwner = { roleId: "role-security", shiftId: "shift-b", staffPostObjectId: "obj-post-exit", assignmentId: "assignment-security-late" };
  apply(handoffIncident, { fromOwner: firstOwner, toOwner: secondOwner, openActionCodes: ["KEEP_EXIT_CLEAR"], evidenceRefs: [{ kind: "plan-object", id: "obj-fire-exit-east" }], idempotencyKey: "handoff-1" }, "2026-09-12T09:11:00.000Z");
  apply(attachIncidentEvidence, { attachment: { id: "attachment-exit-1", kind: "photo", status: "available", contentType: "image/jpeg", byteLength: 2048, sha256: "a".repeat(64), widthPx: 1200, heightPx: 800, uploadedBy: "user-ops", uploadedAt: "2026-09-12T09:11:30.000Z" }, idempotencyKey: "attachment-1" }, "2026-09-12T09:12:00.000Z");
  apply(recordIncidentEmergencyAction, { actionCode: "CLOSE_EXIT", targetObjectIds: ["obj-fire-exit-east"], scenarioDefinitionId: "scenario-blocked-east-exit", authorityRole: "venue-administrator", idempotencyKey: "emergency-1" }, "2026-09-12T09:13:00.000Z");
  apply(transitionIncidentStatus, { toStatus: "mitigating", reasonCode: "CONTROL_IN_PLACE", idempotencyKey: "status-1" }, "2026-09-12T09:14:00.000Z");
  apply(transitionIncidentStatus, { toStatus: "resolved", resolutionCode: "EXIT_CLEARED", idempotencyKey: "status-2" }, "2026-09-12T09:15:00.000Z");
  apply(transitionIncidentStatus, { toStatus: "closed", reasonCode: "POST_EVENT_REVIEW_COMPLETE", idempotencyKey: "status-3" }, "2026-09-12T09:16:00.000Z");

  const incident = inspectIncident(register, { incidentId: "incident-east-exit" });
  assert.equal(incident.status, "closed");
  assert.equal(incident.revision, 12);
  assert.equal(incident.acknowledgement.acknowledgedBy, "user-ops");
  assert.equal(incident.escalation.level, "venue-command");
  assert.deepEqual(incident.owner, secondOwner);
  assert.equal(incident.handoffs.length, 1);
  assert.equal(incident.attachments.length, 1);
  assert.equal("storageKey" in incident.attachments[0], false);
  assert.equal(incident.emergencyActions[0].emergencyPlanFingerprint, register.source.emergencyPlanFingerprint);
  assert.equal(register.transitions.length, 12);
  assert.equal(register.receipts.length, 12);
  assert.equal(register.ledger.length, 12);
  assert.equal(register.ledger.every((entry) => entry.actorId && entry.committedAt && entry.location && entry.transitionId), true);
  assert.equal(verifyIncidentLedger(register).status, "pass");
  assert.deepEqual(inspectIncidents(register, { status: "closed", severity: "critical" }).map((item) => item.id), ["incident-east-exit"]);
  const exported = exportIncidentRecord(register, { incidentId: incident.id, exportedAt: "2026-09-12T09:20:00.000Z" });
  const artifact = JSON.parse(exported.content);
  assert.equal(artifact.kind, "venuemind-incident-record");
  assert.equal(artifact.incident.id, incident.id);
  assert.equal(artifact.integrity.status, "pass");
  assert.equal(artifact.transitions.length, 12);
  assert.equal(artifact.ledger.length, 12);
});

test("agents cannot exercise human Incident authority", () => {
  let register = createIncidentRegister({ projectId: "project-summit-forward", runbook: makeRunbook(), createdAt: "2026-09-12T09:00:00.000Z", createdBy: "user-ops" });
  ({ register } = reportIncident(register, report({ actorType: "agent", actorId: "agent-ops", source: "webmcp" }), { committedAt: "2026-09-12T09:05:00.000Z" }));
  assert.throws(() => acknowledgeIncident(register, { incidentId: "incident-east-exit", reasonCode: "ACK", ...humanMetadata("agent-ack", 1), actorType: "agent", actorId: "agent-ops", source: "webmcp" }), (error) => error.code === "INCIDENT_HUMAN_REQUIRED");
  assert.equal(register.transitions.length, 1);
});

test("Incident mutations reject stale revisions and exact retries preserve one transition", () => {
  let register = createIncidentRegister({ projectId: "project-summit-forward", runbook: makeRunbook(), createdAt: "2026-09-12T09:00:00.000Z", createdBy: "user-ops" });
  ({ register } = reportIncident(register, report(), { committedAt: "2026-09-12T09:05:00.000Z" }));
  const command = { incidentId: "incident-east-exit", owner: { roleId: "role-security" }, ...humanMetadata("owner-retry", 1) };
  const first = setIncidentOwner(register, command, { committedAt: "2026-09-12T09:06:00.000Z" });
  const retry = setIncidentOwner(first.register, command, { committedAt: "2026-09-12T09:07:00.000Z" });
  assert.equal(retry.duplicate, true);
  assert.equal(retry.register.transitions.length, 2);
  assert.equal(retry.register.ledger.length, 2);
  assert.throws(() => classifyIncident(first.register, { incidentId: "incident-east-exit", severity: "critical", category: "security", summaryCode: "SECURITY_RISK", ...humanMetadata("stale-classify", 1) }), (error) => error.code === "INCIDENT_REVISION_CONFLICT" && error.details.currentIncidentRevision === 2);
  assert.throws(() => transitionIncidentStatus(first.register, { incidentId: "incident-east-exit", toStatus: "resolved", resolutionCode: "CLEARED", ...humanMetadata("resolve-before-ack", 2) }), (error) => error.code === "INCIDENT_TRANSITION_INVALID" && error.details.reason === "acknowledgement-and-owner-required");
});

test("Incident export fails closed when its global ledger is tampered", () => {
  const initial = createIncidentRegister({ projectId: "project-summit-forward", runbook: makeRunbook(), createdAt: "2026-09-12T09:00:00.000Z", createdBy: "user-ops" });
  const { register } = reportIncident(initial, report(), { committedAt: "2026-09-12T09:05:00.000Z" });
  const tampered = structuredClone(register);
  tampered.ledger[0].details.summaryCode = "ALTERED";
  assert.equal(verifyIncidentLedger(tampered).status, "fail");
  assert.throws(() => exportIncidentRecord(tampered, { incidentId: "incident-east-exit", exportedAt: "2026-09-12T09:10:00.000Z" }), (error) => error.code === "INCIDENT_LEDGER_INTEGRITY_FAILED");
});
