import test from "node:test";
import assert from "node:assert/strict";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { createIncidentCommandBus } from "../src/domain/incident-command-bus.ts";

const runbook = createEventDayRunbook({
  projectId: "project-summit-forward",
  plan: summitForwardPlan,
  validation: { validationId: "validation-approved", inputFingerprint: "validation-input-approved", status: "pass" },
  sourceLedgerHeadHash: "activity-ledger-head",
  approvalLedgerEntryId: "approval-ledger-entry",
  frozenAt: "2026-09-12T08:00:00.000Z",
  frozenBy: "user-ops",
});

const metadata = (idempotencyKey, expectedIncidentRevision) => ({ idempotencyKey, ...(expectedIncidentRevision == null ? {} : { expectedIncidentRevision }), actorType: "human", actorId: "user-ops", source: "studio", sessionId: "session-event-day" });

test("Incident command bus is the shared create, mutation, inspection, and export seam", () => {
  const changes = [];
  const bus = createIncidentCommandBus({ onChange: (register, event) => changes.push({ register, event }) });
  const created = bus.execute({ type: "create_incident_register", projectId: "project-summit-forward", runbook, createdAt: "2026-09-12T09:00:00.000Z", createdBy: "user-ops", actorType: "human" });
  assert.equal(created.status, "created");
  assert.equal(bus.execute({ type: "create_incident_register", projectId: "project-summit-forward", runbook, createdAt: "2026-09-12T09:00:00.000Z", createdBy: "user-ops", actorType: "human" }).status, "existing");

  const reported = bus.execute({ type: "report_incident", incidentId: "incident-access", severity: "medium", category: "accessibility", summaryCode: "ACCESS_ROUTE_BLOCKED", location: { kind: "plan-object", planObjectId: "obj-accessible-entrance-south" }, relatedRefs: [], committedAt: "2026-09-12T09:05:00.000Z", ...metadata("report-access") });
  assert.equal(reported.incident.id, "incident-access");
  const owner = bus.execute({ type: "set_incident_owner", incidentId: "incident-access", owner: { roleId: "role-access-steward", shiftId: "shift-a", staffPostObjectId: "obj-post-access" }, committedAt: "2026-09-12T09:06:00.000Z", ...metadata("owner-access", 1) });
  assert.equal(owner.incident.revision, 2);
  assert.deepEqual(bus.execute({ type: "inspect_incidents", category: "accessibility" }).map((incident) => incident.id), ["incident-access"]);
  assert.equal(bus.execute({ type: "inspect_incident", incidentId: "incident-access" }).owner.roleId, "role-access-steward");
  assert.equal(JSON.parse(bus.execute({ type: "export_incident_record", incidentId: "incident-access", exportedAt: "2026-09-12T09:07:00.000Z" }).content).incident.revision, 2);
  assert.equal(changes.length, 3);
  assert.deepEqual(changes.map(({ event }) => event.type), ["incident.register.created", "incident.reported", "incident.owner_set"]);
  assert.equal(bus.getSnapshot().revision, 2);
});

test("Incident command bus hydrates recovery state, suppresses duplicate publishes, and rejects unsupported commands", () => {
  const seed = createIncidentCommandBus();
  assert.throws(() => seed.execute({ type: "create_incident_register", projectId: "project-summit-forward", runbook, createdAt: "2026-09-12T09:00:00.000Z", createdBy: "agent-ops", actorType: "agent" }), (error) => error.code === "INCIDENT_HUMAN_REQUIRED");
  seed.execute({ type: "create_incident_register", projectId: "project-summit-forward", runbook, createdAt: "2026-09-12T09:00:00.000Z", createdBy: "user-ops", actorType: "human" });
  const command = { type: "report_incident", incidentId: "incident-security", severity: "high", category: "security", summaryCode: "SECURITY_PERIMETER", location: { kind: "coordinate", point: { x: 10, y: 10 } }, relatedRefs: [], committedAt: "2026-09-12T09:05:00.000Z", ...metadata("report-security") };
  seed.execute(command);

  const events = [];
  const bus = createIncidentCommandBus({ onChange: (_register, event) => events.push(event) });
  bus.hydrate(seed.getSnapshot());
  const retry = bus.execute(command);
  assert.equal(retry.duplicate, true);
  assert.deepEqual(events.map((event) => event.type), ["incident.register.hydrated"]);
  assert.throws(() => bus.execute({ type: "unknown_incident_command" }), (error) => error.code === "COMMAND_UNSUPPORTED");
});
