import { calendarEventAdapter } from "../../src/integrations/adapters/calendar-event-adapter.ts";
import { createAdapterRuntime } from "../../src/integrations/runtime.ts";
import { createMemorySecretStore } from "../../src/integrations/secret-store.ts";

const runtime = createAdapterRuntime({
  projectContext: {
    projectId: "project-summit-forward-2026",
    brief: {
      id: "brief-summit-forward-2026",
      attendeeTarget: 400,
      schedule: { startAt: "2026-09-18T09:00:00+06:00", endAt: "2026-09-18T17:00:00+06:00", timezone: "Asia/Dhaka" },
      requirements: [
        { id: "req-calendar-attendance", category: "seating" },
        { id: "req-calendar-schedule", category: "staffing" },
      ],
    },
    constraints: [
      { id: "constraint-capacity", category: "capacity" },
      { id: "constraint-peak-congestion", category: "circulation" },
    ],
    planningEffectBindings: {
      set_attendance_target: { targetRequirementId: "req-calendar-attendance", category: "seating", affectedConstraintIds: ["constraint-capacity", "constraint-peak-congestion"] },
      set_event_schedule: { targetRequirementId: "req-calendar-schedule", category: "staffing", affectedConstraintIds: [] },
    },
  },
});
const result = await runtime.execute(calendarEventAdapter, "import", {
  basePlanVersion: "3.3",
  proposalRevision: 2,
  sourceSystem: "calendar-production",
  sourceVersion: "calendar-revision-18",
  projectId: "project-summit-forward-2026",
  briefId: "brief-summit-forward-2026",
  requirementIds: { attendance: "req-calendar-attendance", schedule: "req-calendar-schedule" },
  attendanceConstraintIds: ["constraint-capacity", "constraint-peak-congestion"],
  currentPlanningState: {
    attendeeTarget: 400,
    schedule: { startAt: "2026-09-18T09:00:00+06:00", endAt: "2026-09-18T17:00:00+06:00", timezone: "Asia/Dhaka" },
  },
  event: {
    externalId: "calendar-event-9841",
    sourceVersion: "event-revision-18",
    title: "Summit Forward 2026",
    startAt: "2026-09-18T09:00:00+06:00",
    endAt: "2026-09-18T17:00:00+06:00",
    timezone: "Asia/Dhaka",
    location: { label: "Grand Hall" },
    attendanceTarget: 390,
    organizer: { displayName: "Summit Operations", organization: "Forward Events", role: "Event organizer" },
  },
}, {
  grantedScopes: ["calendar:event:read"],
  secretStore: createMemorySecretStore({ "calendar-events/api-token": "example-only" }),
  secretReferences: ["calendar-events/api-token"],
});

if (result.status !== "succeeded" || result.output.proposal.changes[0]?.planningEffects[0]?.operation !== "set_attendance_target") throw new Error("Calendar event did not create a reviewable attendance Requirement Change");
console.log(JSON.stringify({ status: result.status, projectMapping: result.output.mappings[0].venueObjectId, proposalId: result.output.proposal.id, requiresHumanApproval: true }, null, 2));
