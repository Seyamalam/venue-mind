import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createFileProjectRepository, createMemoryProjectRepository, createVenueMindMcpServer } from "../packages/mcp-server/dist/index.js";
import { venueToolContracts } from "../src/contracts/venue-contracts.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const silentLogger = { info() {}, error() {} };

const withClient = async (run, { repository = createMemoryProjectRepository() } = {}) => {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createVenueMindMcpServer({ repository, logger: silentLogger });
  const client = new Client({ name: "venuemind-test", version: "0.1.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    await run(client);
  } finally {
    await client.close();
    await server.close();
  }
};

test("standalone MCP server exposes the shared VenueMind tool contracts", async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.equal(tools.length, venueToolContracts.length);
    assert.deepEqual(tools.map((tool) => tool.name).sort(), venueToolContracts.map((tool) => tool.name).sort());
    assert.ok(tools.some((tool) => tool.name === "venue.list_projects"));
    assert.ok(tools.some((tool) => tool.name === "venue.open_project"));
    assert.ok(tools.some((tool) => tool.name === "venue.inspect_templates"));
    assert.ok(tools.some((tool) => tool.name === "venue.preview_template_update"));
    assert.ok(tools.some((tool) => tool.name === "venue.apply_edit"));
    assert.ok(tools.some((tool) => tool.name === "venue.measure_objects"));
    assert.ok(tools.some((tool) => tool.name === "venue.duplicate_proposal_branch"));
    assert.ok(tools.some((tool) => tool.name === "venue.archive_proposal_branch"));
    assert.ok(tools.some((tool) => tool.name === "venue.add_comment"));
    assert.ok(tools.some((tool) => tool.name === "venue.list_comments"));
    assert.ok(tools.some((tool) => tool.name === "venue.get_project_brief"));
    assert.ok(tools.some((tool) => tool.name === "venue.inspect_layout"));
    assert.ok(tools.some((tool) => tool.name === "venue.create_proposal_branch"));
    assert.ok(tools.some((tool) => tool.name === "venue.compare_proposal_branches"));
    assert.ok(tools.some((tool) => tool.name === "venue.export_plan"));
    assert.ok(tools.some((tool) => tool.name === "venue.run_scenario"));
    assert.ok(tools.some((tool) => tool.name === "venue.compare_simulations"));
    assert.ok(tools.some((tool) => tool.name === "venue.replay_history"));
    assert.ok(tools.some((tool) => tool.name === "venue.detect_proposal_conflicts"));
    assert.ok(tools.some((tool) => tool.name === "venue.rebase_proposal"));
    assert.ok(tools.some((tool) => tool.name === "venue.get_validation_evidence"));
    assert.ok(tools.some((tool) => tool.name === "venue.get_scenario_result"));
    assert.ok(tools.some((tool) => tool.name === "venue.export_audit_package"));
    assert.ok(tools.some((tool) => tool.name === "venue.inspect_live_occupancy"));
    assert.ok(tools.some((tool) => tool.name === "venue.ingest_occupancy_signal"));
    assert.ok(tools.some((tool) => tool.name === "venue.refresh_live_occupancy"));
    assert.ok(tools.some((tool) => tool.name === "venue.export_live_occupancy"));
    assert.equal(tools.some((tool) => tool.name === "venue.acknowledge_occupancy_alert"), false);
    assert.ok(tools.some((tool) => tool.name === "venue.inspect_incidents"));
    assert.ok(tools.some((tool) => tool.name === "venue.report_incident"));
    assert.ok(tools.some((tool) => tool.name === "venue.export_incident_record"));
    assert.equal(tools.some((tool) => /acknowledge_incident|escalate_incident|handoff_incident|attach_incident/.test(tool.name)), false);
  });
});

test("standalone MCP executes the aggregate Live Occupancy loop with agent acknowledgement excluded", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", actorId: "seed-approver", idempotencyKey: "seed-approved-occupancy" });
  const snapshot = planner.getSnapshot();
  const now = new Date().toISOString();
  const repository = createMemoryProjectRepository([{ id: "project-summit-forward", organizationId: "org-local", name: "SummitForward 2026", activePlanId: snapshot.plan.id, schemaVersion: 10, snapshot, createdAt: now, updatedAt: now, archivedAt: null, deletedAt: null, recoveryUntil: null, pinned: true, lastOpenedAt: now }]);
  await withClient(async (client) => {
    const before = await client.callTool({ name: "venue.inspect_live_occupancy", arguments: {} });
    const signal = await client.callTool({ name: "venue.ingest_occupancy_signal", arguments: { sourceId: "door-a", sourceType: "manual-counter", sourceVersion: "counter-v1", kind: "zone-occupancy", observedAt: new Date().toISOString(), confidence: "high", readings: [{ scopeId: "venue", count: 310 }], idempotencyKey: "mcp-occupancy-1" } });
    const refreshed = await client.callTool({ name: "venue.refresh_live_occupancy", arguments: { idempotencyKey: "mcp-occupancy-refresh-1" } });
    const exported = await client.callTool({ name: "venue.export_live_occupancy", arguments: {} });

    assert.match(before.content[0].text, /aggregate-only/);
    assert.match(signal.content[0].text, /"revision": 1/);
    assert.match(refreshed.content[0].text, /"revision": 2/);
    assert.match(exported.content[0].text, /venuemind-live-occupancy-audit/);
  }, { repository });
});

test("standalone MCP reports and exports a Plan-anchored Incident without response authority", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const proposal = planner.getSnapshot().proposal;
  planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: proposal.baseVersion, actor: "human", actorId: "seed-approver", idempotencyKey: "seed-approved-incidents" });
  const snapshot = planner.getSnapshot();
  const now = new Date().toISOString();
  const repository = createMemoryProjectRepository([{ id: "project-summit-forward", organizationId: "org-local", name: "SummitForward 2026", activePlanId: snapshot.plan.id, schemaVersion: 10, snapshot, createdAt: now, updatedAt: now, archivedAt: null, deletedAt: null, recoveryUntil: null, pinned: true, lastOpenedAt: now }]);
  await withClient(async (client) => {
    const before = await client.callTool({ name: "venue.inspect_incidents", arguments: { status: "open" } });
    const reported = await client.callTool({ name: "venue.report_incident", arguments: { severity: "high", category: "fire-life-safety", summaryCode: "EXIT_OBSTRUCTED", location: { kind: "plan-object", planObjectId: "obj-fire-exit-east" }, relatedRefs: [{ kind: "plan-object", id: "obj-fire-exit-east" }], idempotencyKey: "mcp-incident-1" } });
    const incidentId = JSON.parse(reported.content[0].text).incident.id;
    const retried = await client.callTool({ name: "venue.report_incident", arguments: { severity: "high", category: "fire-life-safety", summaryCode: "EXIT_OBSTRUCTED", location: { kind: "plan-object", planObjectId: "obj-fire-exit-east" }, relatedRefs: [{ kind: "plan-object", id: "obj-fire-exit-east" }], idempotencyKey: "mcp-incident-1" } });
    const exported = await client.callTool({ name: "venue.export_incident_record", arguments: { incidentId } });

    assert.match(before.content[0].text, /"incidents": \[\]/);
    assert.match(reported.content[0].text, /EXIT_OBSTRUCTED/);
    assert.match(retried.content[0].text, /"duplicate": true/);
    assert.match(exported.content[0].text, /venuemind-incident-record/);
    assert.equal((await client.listTools()).tools.some((tool) => /acknowledge_incident|escalate_incident|handoff_incident/.test(tool.name)), false);
  }, { repository });
});

test("expanded shared tools expose bounded object, Constraint, evidence, Scenario, adjustment, and audit operations", async () => {
  await withClient(async (client) => {
    const constraints = await client.callTool({ name: "venue.list_constraints", arguments: { category: "accessibility" } });
    const validation = await client.callTool({ name: "venue.validate_layout", arguments: {} });
    const validationId = JSON.parse(validation.content[0].text).validationId;
    const evidence = await client.callTool({ name: "venue.get_validation_evidence", arguments: { validationId, constraintIds: ["constraint-accessible-route"], includeSpatialEvidence: false } });
    const object = await client.callTool({ name: "venue.get_object", arguments: { objectId: "obj-av-desk", scope: "proposal" } });
    const search = await client.callTool({ name: "venue.search_objects", arguments: { query: "route", layers: ["access"], limit: 3 } });
    const adjustment = await client.callTool({ name: "venue.request_adjustment", arguments: { instruction: "Increase rear clearance", idempotencyKey: "mcp-expanded-adjustment", correlationId: "mcp-expanded" } });
    const simulation = await client.callTool({ name: "venue.run_scenario", arguments: { scenario: { id: "scenario-expanded", name: "Expanded tools", seed: 17, horizonSeconds: 600, sampleCount: 16, inputs: { population: 200, arrivalRatePerMinute: 15, serviceRatePerMinute: 8, servers: 2 } }, branchId: "branch-balanced", idempotencyKey: "mcp-expanded-scenario" } });
    const runId = JSON.parse(simulation.content[0].text).runId;
    const scenarioResult = await client.callTool({ name: "venue.get_scenario_result", arguments: { runId } });
    const audit = await client.callTool({ name: "venue.export_audit_package", arguments: {} });

    assert.match(constraints.content[0].text, /constraint-accessible-route/);
    assert.doesNotMatch(evidence.content[0].text, /"spatialEvidence"/);
    assert.match(object.content[0].text, /obj-av-desk/);
    assert.match(object.content[0].text, /effectiveLocks/);
    assert.equal(JSON.parse(search.content[0].text).objects.length, 3);
    assert.match(adjustment.content[0].text, /proposal-/);
    assert.match(scenarioResult.content[0].text, new RegExp(runId));
    assert.doesNotMatch(scenarioResult.content[0].text, /"densityFrames"/);
    assert.match(audit.content[0].text, /venuemind-audit/);
    assert.equal((await client.listTools()).tools.some((tool) => /approve|delete_project/.test(tool.name)), false);
  });
});

test("MCP tools execute the same planning workflow and keep approval human-only", async () => {
  await withClient(async (client) => {
    const inspection = await client.callTool({ name: "venue.inspect_layout", arguments: {} });
    const brief = await client.callTool({ name: "venue.get_project_brief", arguments: {} });
    const preview = await client.callTool({ name: "venue.preview_revision", arguments: { goal: "Reduce entrance congestion", idempotencyKey: "mcp-preview-001", correlationId: "mcp-test-001" } });
    const comment = await client.callTool({ name: "venue.add_comment", arguments: { anchor: { kind: "coordinate", planVersion: "3.2", point: { x: 12, y: 8 } }, body: "Review route intersection", mentions: ["ops"], decisionRelevant: true, authorId: "agent-reviewer", idempotencyKey: "mcp-comment-001", correlationId: "mcp-test-comment" } });
    const comments = await client.callTool({ name: "venue.list_comments", arguments: { status: "open", subjectKind: "coordinate" } });
    const branches = await client.callTool({ name: "venue.list_proposal_branches", arguments: {} });
    const comparison = await client.callTool({ name: "venue.compare_proposal_branches", arguments: { leftBranchId: "branch-balanced", rightBranchId: "branch-balanced" } });
    const exportResult = await client.callTool({ name: "venue.export_plan", arguments: { format: "svg" } });
    const simulation = await client.callTool({ name: "venue.run_scenario", arguments: { scenario: { id: "scenario-mcp", name: "MCP scenario", seed: 42, horizonSeconds: 1800, sampleCount: 32, inputs: { population: 400, arrivalRatePerMinute: 30, serviceRatePerMinute: 10, servers: 3 } }, branchId: "branch-balanced", idempotencyKey: "mcp-scenario-001", correlationId: "mcp-scenario-corr" } });
    const flowSimulation = await client.callTool({ name: "venue.run_scenario", arguments: { scenario: { model: "ingress-egress", id: "scenario-mcp-flow", name: "MCP flow", seed: 42, horizonSeconds: 1800, sampleCount: 32, inputs: { population: 400, arrivalRatePerMinute: 30, serviceRatePerMinute: 10, servers: 3 }, ingressEgress: { mode: "normal", mobilityProfiles: [{ id: "standard", share: .92, speedFactor: 1, accessibleRouteRequired: false }, { id: "access", share: .08, speedFactor: .68, accessibleRouteRequired: true }] } }, branchId: "branch-balanced", idempotencyKey: "mcp-scenario-flow-001", correlationId: "mcp-scenario-flow-corr" } });
    const queueSimulation = await client.callTool({ name: "venue.run_scenario", arguments: { scenario: { model: "queue", id: "scenario-mcp-queue", name: "MCP queue", seed: 42, horizonSeconds: 900, sampleCount: 32, inputs: { population: 400, arrivalRatePerMinute: 24, serviceRatePerMinute: 6, servers: 3 }, queue: { category: "registration", bufferAreaM2: 12, abandonment: { enabled: true, meanPatienceSeconds: 480 }, priorityLanes: [{ id: "access", arrivalShare: .08, servers: 1, serviceRatePerServerMinute: 6 }] } }, branchId: "branch-balanced", idempotencyKey: "mcp-scenario-queue-001", correlationId: "mcp-scenario-queue-corr" } });
    const simulationRuns = await client.callTool({ name: "venue.list_scenario_runs", arguments: {} });
    const replay = await client.callTool({ name: "venue.replay_history", arguments: {} });
    const ledger = await client.callTool({ name: "venue.get_change_log", arguments: {} });
    const toolNames = (await client.listTools()).tools.map((tool) => tool.name);

    assert.match(inspection.content[0].text, /plan-summit-forward-2026/);
    assert.match(brief.content[0].text, /req-accessible-route/);
    assert.match(preview.content[0].text, /requiresHumanApproval/);
    assert.match(preview.content[0].text, /receipt-0001/);
    assert.match(comment.content[0].text, /comment-0001/);
    assert.match(comments.content[0].text, /Review route intersection/);
    assert.match(branches.content[0].text, /Balanced/);
    assert.match(comparison.content[0].text, /comparison-/);
    assert.match(exportResult.content[0].text, /summitforward-2026-v3-2\.svg/);
    assert.match(exportResult.content[0].text, /layer-architecture/);
    assert.match(simulation.content[0].text, /simulation-result/);
    assert.match(flowSimulation.content[0].text, /ingress-egress/);
    assert.match(flowSimulation.content[0].text, /densityFrames/);
    assert.match(flowSimulation.content[0].text, /accessibleRouteClearanceSeconds/);
    assert.match(queueSimulation.content[0].text, /"model": "queue"/);
    assert.match(queueSimulation.content[0].text, /proposal-option/);
    assert.match(queueSimulation.content[0].text, /spatially-valid/);
    assert.match(simulationRuns.content[0].text, /scenario-mcp/);
    assert.match(replay.content[0].text, /ledgerHeadHash/);
    assert.match(ledger.content[0].text, /"source": "mcp"/);
    assert.equal(toolNames.includes("venue.approve_proposal"), false);
  });
});

test("MCP failures return the stable VenueMind error envelope", async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: "venue.compare_proposal_branches", arguments: { leftBranchId: "branch-balanced", rightBranchId: "branch-missing" } });
    const payload = JSON.parse(result.content[0].text);

    assert.equal(result.isError, true);
    assert.equal(payload.error.code, "BRANCH_NOT_FOUND");
    assert.match(payload.error.remediation, /branch/i);
    assert.equal(payload.error.details.branchId, "branch-missing");
  });
});

test("MCP publishes Project resources, templates, prompts, compatibility metadata, and progress", async () => {
  await withClient(async (client) => {
    const resources = await client.listResources();
    const templates = await client.listResourceTemplates();
    const prompts = await client.listPrompts();
    const currentProject = await client.readResource({ uri: "venuemind://current/project" });
    const currentPlan = await client.readResource({ uri: "venuemind://current/plan" });
    const currentProposal = await client.readResource({ uri: "venuemind://current/proposal" });
    const capabilities = await client.readResource({ uri: "venuemind://server/capabilities" });
    const prompt = await client.getPrompt({ name: "venuemind.supervised_planning", arguments: { goal: "reduce entrance congestion" } });
    const progress = [];
    await client.callTool({ name: "venue.validate_layout", arguments: {} }, { onprogress: (update) => progress.push(update) });

    assert.ok(resources.resources.some((resource) => resource.uri === "venuemind://current/project"));
    assert.ok(resources.resources.some((resource) => resource.uri === "venuemind://schemas/index"));
    assert.ok(templates.resourceTemplates.some((template) => template.uriTemplate === "venuemind://projects/{projectId}"));
    assert.ok(templates.resourceTemplates.some((template) => template.uriTemplate.includes("{planVersion}")));
    assert.ok(prompts.prompts.some((item) => item.name === "venuemind.supervised_planning"));
    assert.ok(prompts.prompts.some((item) => item.name === "venuemind.audit_plan"));
    assert.match(currentProject.contents[0].text, /project-summit-forward/);
    assert.match(currentPlan.contents[0].text, /plan-summit-forward-2026/);
    assert.match(currentProposal.contents[0].text, /proposal-/);
    assert.match(capabilities.contents[0].text, /human-only/);
    assert.match(prompt.messages[0].content.text, /stop for human Approval/);
    assert.deepEqual(progress.map((update) => update.progress), [0, 1]);
  });
});

test("official MCP clients can complete the durable supervised loop across server restarts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "venuemind-mcp-test-"));
  try {
    const repository = createFileProjectRepository({ directory });
    const seedPlanner = createVenuePlanner(summitForwardPlan);
    const seedProposal = seedPlanner.getSnapshot().proposal;
    seedPlanner.execute({ type: "approve_proposal", proposalId: seedProposal.id, baseVersion: seedProposal.baseVersion, actor: "human", actorId: "seed-approver", idempotencyKey: "seed-durable-incidents" });
    const seedSnapshot = seedPlanner.getSnapshot();
    const seededAt = new Date().toISOString();
    await repository.save({ id: "project-summit-forward", organizationId: "org-local", name: "SummitForward 2026", activePlanId: seedSnapshot.plan.id, schemaVersion: 10, snapshot: seedSnapshot, createdAt: seededAt, updatedAt: seededAt, archivedAt: null, deletedAt: null, recoveryUntil: null, pinned: true, lastOpenedAt: seededAt });
    await withClient(async (client) => {
      const projects = await client.callTool({ name: "venue.list_projects", arguments: {} });
      const opened = await client.callTool({ name: "venue.open_project", arguments: { projectId: "project-summit-forward" } });
      const inspected = await client.callTool({ name: "venue.inspect_layout", arguments: {} });
      const incident = await client.callTool({ name: "venue.report_incident", arguments: { severity: "medium", category: "facilities", summaryCode: "DURABLE_POWER_RISK", location: { kind: "plan-object", planObjectId: "obj-first-aid-north" }, relatedRefs: [], idempotencyKey: "mcp-durable-incident" } });
      const branch = await client.callTool({ name: "venue.create_proposal_branch", arguments: { name: "Durable access", strategy: "access-first", goal: "Protect accessible arrival", idempotencyKey: "mcp-durable-branch", correlationId: "mcp-durable" } });
      const preview = await client.callTool({ name: "venue.preview_revision", arguments: { goal: "Protect accessible arrival", idempotencyKey: "mcp-durable-preview", correlationId: "mcp-durable" } });
      const validation = await client.callTool({ name: "venue.validate_layout", arguments: {} });
      const ledger = await client.callTool({ name: "venue.get_change_log", arguments: {} });
      const exported = await client.callTool({ name: "venue.export_plan", arguments: { format: "json" } });

      assert.match(projects.content[0].text, /project-summit-forward/);
      assert.match(opened.content[0].text, /"active": true/);
      assert.match(inspected.content[0].text, /plan-summit-forward-2026/);
      assert.match(branch.content[0].text, /branch-/);
      assert.match(preview.content[0].text, /requiresHumanApproval/);
      assert.match(validation.content[0].text, /validationId/);
      assert.match(ledger.content[0].text, /proposal.previewed/);
      assert.match(incident.content[0].text, /DURABLE_POWER_RISK/);
      assert.match(exported.content[0].text, /\.json/);
      assert.equal((await client.listTools()).tools.some((tool) => tool.name === "venue.approve_proposal"), false);
    }, { repository });

    await withClient(async (client) => {
      await client.callTool({ name: "venue.open_project", arguments: { projectId: "project-summit-forward" } });
      const proposal = await client.readResource({ uri: "venuemind://current/proposal" });
      const ledger = await client.callTool({ name: "venue.get_change_log", arguments: {} });
      const incidents = await client.callTool({ name: "venue.inspect_incidents", arguments: { status: "open" } });
      assert.match(proposal.contents[0].text, /Protect accessible arrival/);
      assert.match(ledger.content[0].text, /mcp-durable/);
      assert.match(incidents.content[0].text, /DURABLE_POWER_RISK/);
    }, { repository: createFileProjectRepository({ directory }) });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
