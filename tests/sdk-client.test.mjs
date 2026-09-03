import assert from "node:assert/strict";
import test from "node:test";
import { createVenueMindClient } from "../packages/sdk/dist/client.js";

test("typed client delegates every namespace to the canonical tool seam", async () => {
  const calls = [];
  const transport = {
    async callTool(name, input, options) {
      calls.push({ name, input, signal: options?.signal ?? null });
      if (name === "venue.list_projects") return {
        source: "repository",
        projects: [{ id: "project-main", name: "Main", activePlanId: "plan-main", planVersion: "3.3", active: true }],
      };
      if (name === "venue.open_project") return {
        status: "active",
        project: { id: input.projectId, name: "Main", activePlanId: "plan-main", planVersion: "3.3", active: true },
      };
      if (name === "venue.inspect_layout") return { planId: "plan-main" };
      if (name === "venue.preview_revision") return { proposalId: "proposal-next" };
      if (name === "venue.validate_layout") return { status: "pass" };
      if (name === "venue.get_change_log") return [];
      if (name === "venue.inspect_live_plan_deviations") return { register: { revision: 0 }, deviations: [], overlay: {} };
      if (name === "venue.record_live_plan_deviation") return { register: { revision: 1 }, deviation: { id: input.deviationId } };
      if (name === "venue.end_live_plan_deviation") return { register: { revision: 2 }, deviation: { id: input.deviationId, status: "ended" } };
      if (name === "venue.create_post_event_deviation_proposal") return { register: { revision: 3 }, proposal: { id: input.proposalId } };
      if (name === "venue.export_live_plan_deviations") return { filename: "deviations.json", mediaType: "application/json" };
      if (name === "venue.inspect_post_event_review") return { review: { revision: 0 }, comparisons: [], integrity: { status: "pass" } };
      if (name === "venue.record_post_event_observation") return { review: { revision: 1 }, subject: { id: input.observationId } };
      if (name === "venue.record_post_event_lesson") return { review: { revision: 2 }, subject: { id: input.lessonId } };
      if (name === "venue.create_template_improvement_proposal") return { review: { revision: 3 }, subject: { id: input.proposalId } };
      if (name === "venue.export_post_event_report") return { filename: `post-event.${input.format === "text" ? "txt" : "json"}` };
      return { format: input.format ?? "audit" };
    },
  };
  const client = createVenueMindClient({ transport });
  const controller = new AbortController();

  const projectList = await client.projects.list();
  const projectOpen = await client.projects.open("project-main");
  await client.plans.inspect();
  await client.proposals.preview({ goal: "Protect access", idempotencyKey: "preview-001" });
  await client.validations.run({ signal: controller.signal });
  await client.ledger.list();
  await client.deviations.inspect({ status: "active" });
  await client.deviations.record({
    deviationId: "deviation-1",
    disposition: "temporary",
    reasonCode: "LIVE_CONTROL",
    location: { kind: "plan-object", planObjectId: "obj-exit" },
    affectedObjectIds: ["obj-exit"],
    availableConstraintIds: ["constraint-egress"],
    change: { id: "change-1", targetObjectIds: ["obj-exit"], spatialEffects: [{}] },
    idempotencyKey: "record-1",
  });
  await client.deviations.end({
    deviationId: "deviation-1",
    expectedDeviationRevision: 1,
    reasonCode: "CONTROL_RELEASED",
    idempotencyKey: "end-1",
  });
  await client.deviations.createPostEventProposal({
    proposalId: "proposal-post-event",
    goal: "Retain event-day learning",
    deviationIds: ["deviation-1"],
    idempotencyKey: "proposal-1",
  });
  await client.postEvent.inspect();
  await client.postEvent.recordObservation({
    observationId: "observation-1",
    predictionKey: "occupancy:peak-persons:venue:venue",
    value: 438,
    confidence: "measured",
    evidenceRefs: [{ kind: "accepted-plan", id: "plan-main", fingerprint: "plan-fingerprint" }],
    expectedRevision: 0,
    idempotencyKey: "observation-1",
  });
  await client.postEvent.recordLesson({
    lessonId: "lesson-1",
    comparisonKey: "occupancy:peak-persons:venue:venue",
    lessonCode: "CAPACITY_BUFFER",
    findingCode: "PEAK_ABOVE_MODEL",
    recommendedActionCode: "INCREASE_BUFFER",
    requirementIds: ["requirement-1"],
    constraintIds: ["constraint-1"],
    expectedRevision: 1,
    idempotencyKey: "lesson-1",
  });
  await client.postEvent.createTemplateImprovementProposal({
    proposalId: "template-proposal-1",
    goal: "Increase buffer",
    target: { kind: "room", templateId: "room-template-1", version: "1.0.0" },
    changes: [{ id: "change-1", effects: { capacityBuffer: 20 } }],
    changeLessonLinks: [{ changeId: "change-1", lessonIds: ["lesson-1"] }],
    expectedRevision: 2,
    idempotencyKey: "template-proposal-1",
  });
  await client.postEvent.exportReport("text");
  await client.exports.plan("svg");
  await client.exports.audit();
  await client.exports.deviations();

  assert.deepEqual(calls.map(({ name }) => name), [
    "venue.list_projects",
    "venue.open_project",
    "venue.inspect_layout",
    "venue.preview_revision",
    "venue.validate_layout",
    "venue.get_change_log",
    "venue.inspect_live_plan_deviations",
    "venue.record_live_plan_deviation",
    "venue.end_live_plan_deviation",
    "venue.create_post_event_deviation_proposal",
    "venue.inspect_post_event_review",
    "venue.record_post_event_observation",
    "venue.record_post_event_lesson",
    "venue.create_template_improvement_proposal",
    "venue.export_post_event_report",
    "venue.export_plan",
    "venue.export_audit_package",
    "venue.export_live_plan_deviations",
  ]);
  assert.deepEqual(calls[1].input, { projectId: "project-main" });
  assert.deepEqual(calls[14].input, { format: "text" });
  assert.deepEqual(calls[15].input, { format: "svg" });
  assert.equal(calls[4].signal, controller.signal);
  assert.deepEqual(projectList, {
    source: "repository",
    projects: [{ id: "project-main", name: "Main", activePlanId: "plan-main", planVersion: "3.3", active: true }],
  });
  assert.deepEqual(projectOpen, {
    status: "active",
    project: { id: "project-main", name: "Main", activePlanId: "plan-main", planVersion: "3.3", active: true },
  });
  assert.equal("approve" in client, false);
  assert.ok(Object.isFrozen(client));
});

test("client rejects an invalid transport before any tool call", () => {
  assert.throws(() => createVenueMindClient({ transport: {} }), /requires a transport/);
});
