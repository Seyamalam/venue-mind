import test from "node:test";
import assert from "node:assert/strict";
import { VENUE_TOOL_CONTRACT_VERSION, venueToolContracts } from "../src/contracts/venue-contracts.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { registerVenueTools } from "../src/webmcp/register-venue-tools.ts";
import { executeVenueWebMcpTool } from "../src/webmcp/tool-runtime.ts";

const contract = (name) => venueToolContracts.find((item) => item.name === name);

class FakeModelContext {
  tools = new Map();

  async registerTool(definition, { signal } = {}) {
    if (this.tools.has(definition.name)) throw new DOMException("Duplicate tool", "InvalidStateError");
    this.tools.set(definition.name, definition);
    signal?.addEventListener("abort", () => this.tools.delete(definition.name), { once: true });
  }
}

test("WebMCP registers every versioned contract and publishes lifecycle progress", async () => {
  const modelContext = new FakeModelContext();
  const controller = new AbortController();
  const lifecycle = [];
  await registerVenueTools(modelContext, createVenuePlanner(summitForwardPlan), controller.signal, {
    onLifecycle: (state) => lifecycle.push(state),
  });

  assert.equal(modelContext.tools.size, venueToolContracts.length);
  assert.equal(lifecycle[0].state, "registering");
  assert.deepEqual(lifecycle.at(-1), {
    state: "ready",
    registered: venueToolContracts.length,
    total: venueToolContracts.length,
    errorCode: null,
  });
  assert.equal(
    venueToolContracts.every((item) => item.contractVersion === VENUE_TOOL_CONTRACT_VERSION),
    true,
  );
  assert.equal(
    venueToolContracts.every(
      (item) =>
        item.authorization.requiredScope.startsWith("venue:") &&
        item.limits.maximumInputBytes > 0 &&
        item.limits.maximumOutputBytes > 0,
    ),
    true,
  );
  assert.match(modelContext.tools.get("venue.inspect_layout").description, /Contract 1\.6\.0\./);

  controller.abort();
  assert.equal(modelContext.tools.size, 0);
  assert.equal(lifecycle.at(-1).state, "unregistered");
});

test("WebMCP invocation returns a compact summary plus bounded structured content", async () => {
  const modelContext = new FakeModelContext();
  const controller = new AbortController();
  await registerVenueTools(modelContext, createVenuePlanner(summitForwardPlan), controller.signal);
  const result = await modelContext.tools.get("venue.inspect_layout").execute({}, {});

  assert.match(result.content[0].text, /Plan plan-summit-forward-2026 v3\.2/);
  assert.equal(result.structuredContent.contractVersion, "1.6.0");
  assert.equal(result.structuredContent.authorizationScope, "venue:read");
  assert.match(result.structuredContent.correlationId, /^corr-webmcp-/);
  assert.equal(result.structuredContent.data.planId, "plan-summit-forward-2026");
});

test("WebMCP fresh-load workflow reaches validated export without direct Plan mutation", async () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const acceptedPlan = structuredClone(planner.getSnapshot().plan);
  const modelContext = new FakeModelContext();
  const controller = new AbortController();
  await registerVenueTools(modelContext, planner, controller.signal);
  const inspection = await modelContext.tools.get("venue.inspect_layout").execute();
  const preview = await modelContext.tools.get("venue.preview_revision").execute({
    goal: "Reduce entrance congestion",
    idempotencyKey: "webmcp-golden-preview",
    correlationId: "corr-webmcp-golden",
  });
  const validation = await modelContext.tools.get("venue.validate_layout").execute();
  const exported = await modelContext.tools.get("venue.export_plan").execute({ format: "pdf-emergency" });

  assert.equal(inspection.structuredContent.data.planVersion, "3.2");
  assert.equal(preview.structuredContent.data.requiresHumanApproval, true);
  assert.equal(validation.structuredContent.data.status, "pass");
  assert.match(exported.content[0].text, /Export pdf-emergency/);
  assert.match(exported.structuredContent.data.filename, /-emergency\.pdf$/);
  assert.deepEqual(planner.getSnapshot().plan, acceptedPlan);
  controller.abort();
});

test("WebMCP preserves caller correlation and planner idempotency metadata", async () => {
  const result = await executeVenueWebMcpTool({
    contract: contract("venue.preview_revision"),
    planner: createVenuePlanner(summitForwardPlan),
    input: {
      goal: "Reduce entrance congestion",
      idempotencyKey: "webmcp-preview-001",
      correlationId: "corr-webmcp-test-001",
    },
  });

  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.correlationId, "corr-webmcp-test-001");
  assert.equal(result.structuredContent.data.receipt.correlationId, "corr-webmcp-test-001");
  assert.equal(result.structuredContent.data.receipt.idempotencyKey, "webmcp-preview-001");
});

test("WebMCP denies missing scopes with a stable error envelope", async () => {
  const result = await executeVenueWebMcpTool({
    contract: contract("venue.preview_revision"),
    planner: createVenuePlanner(summitForwardPlan),
    input: { goal: "Change layout", idempotencyKey: "scope-denied" },
    grantedScopes: ["venue:read"],
    correlationIdFactory: () => "corr-scope-denied",
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error.code, "TOOL_SCOPE_REQUIRED");
  assert.equal(result.structuredContent.error.details.requiredScope, "venue:propose");
  assert.equal(result.structuredContent.correlationId, "corr-scope-denied");
});

test("WebMCP rejects oversized geometry input and observes invocation cancellation", async () => {
  const oversized = await executeVenueWebMcpTool({
    contract: contract("venue.apply_edit"),
    planner: createVenuePlanner(summitForwardPlan),
    input: {
      edit: { operation: "place", object: { id: "obj-large", kind: "table", notes: "x".repeat(270000) } },
      idempotencyKey: "oversized-edit",
    },
    correlationIdFactory: () => "corr-oversized",
  });
  const controller = new AbortController();
  controller.abort();
  const cancelled = await executeVenueWebMcpTool({
    contract: contract("venue.inspect_layout"),
    planner: createVenuePlanner(summitForwardPlan),
    signal: controller.signal,
    correlationIdFactory: () => "corr-cancelled",
  });

  assert.equal(oversized.structuredContent.error.code, "TOOL_PAYLOAD_TOO_LARGE");
  assert.equal(oversized.structuredContent.error.details.direction, "input");
  assert.equal(cancelled.structuredContent.error.code, "TOOL_CALL_CANCELLED");
});

test("WebMCP redacts sensitive Project metadata before returning it", async () => {
  const planner = {
    execute: () => ({
      planId: "plan-sensitive",
      planVersion: "1.0",
      objects: [],
      proposal: { status: "review" },
      contactEmail: "operator@example.test",
      nested: { accessToken: "token-value", publicCode: "safe" },
    }),
  };
  const result = await executeVenueWebMcpTool({
    contract: contract("venue.inspect_layout"),
    planner,
    correlationIdFactory: () => "corr-redaction",
  });

  assert.equal(result.structuredContent.data.contactEmail, "[REDACTED]");
  assert.equal(result.structuredContent.data.nested.accessToken, "[REDACTED]");
  assert.equal(result.structuredContent.data.nested.publicCode, "safe");
  assert.equal(JSON.stringify(result).includes("operator@example.test"), false);
  assert.equal(JSON.stringify(result).includes("token-value"), false);
});

test("WebMCP can unregister and register again on page reload", async () => {
  const modelContext = new FakeModelContext();
  const first = new AbortController();
  await registerVenueTools(modelContext, createVenuePlanner(summitForwardPlan), first.signal);
  first.abort();
  const second = new AbortController();
  const result = await registerVenueTools(modelContext, createVenuePlanner(summitForwardPlan), second.signal);

  assert.equal(result.state, "ready");
  assert.equal(modelContext.tools.size, venueToolContracts.length);
  second.abort();
});

test("WebMCP Project tools use the same shared contracts through a scoped Project Adapter", async () => {
  const modelContext = new FakeModelContext();
  const controller = new AbortController();
  const calls = [];
  const projectOperations = {
    listProjects: async () => ({
      source: "test",
      projects: [{ id: "project-summit-forward", name: "SummitForward 2026", active: true }],
    }),
    openProject: async (projectId) => {
      calls.push(projectId);
      return { status: "active", project: { id: projectId } };
    },
  };
  await registerVenueTools(modelContext, createVenuePlanner(summitForwardPlan), controller.signal, {
    projectOperations,
  });
  const listed = await modelContext.tools.get("venue.list_projects").execute();
  const opened = await modelContext.tools.get("venue.open_project").execute({ projectId: "project-summit-forward" });

  assert.equal(listed.structuredContent.data.projects[0].id, "project-summit-forward");
  assert.equal(opened.structuredContent.data.status, "active");
  assert.deepEqual(calls, ["project-summit-forward"]);
  controller.abort();
});

test("WebMCP Live Occupancy tools share aggregate operational commands and exclude acknowledgement", async () => {
  const modelContext = new FakeModelContext();
  const calls = [];
  const occupancyOperations = {
    inspectLiveOccupancy: async () => ({ monitor: { revision: 2 }, projection: { overallStatus: "warning" } }),
    ingestOccupancySignal: async (input) => {
      calls.push(["ingest", input]);
      return { monitor: { revision: 3 }, projection: { overallStatus: "nominal" } };
    },
    refreshLiveOccupancy: async (input) => {
      calls.push(["refresh", input]);
      return { monitor: { revision: 4 }, projection: { overallStatus: "stale" } };
    },
    exportLiveOccupancy: async () => ({
      filename: "occupancy.audit.json",
      mimeType: "application/json",
      content: "{}",
    }),
  };
  await registerVenueTools(modelContext, createVenuePlanner(summitForwardPlan), new AbortController().signal, {
    occupancyOperations,
  });
  const inspected = await modelContext.tools.get("venue.inspect_live_occupancy").execute({});
  const ingested = await modelContext.tools.get("venue.ingest_occupancy_signal").execute({
    sourceId: "door-a",
    sourceType: "manual-counter",
    sourceVersion: "v7",
    kind: "zone-occupancy",
    observedAt: "2026-09-01T10:00:00.000Z",
    confidence: "high",
    readings: [{ scopeId: "venue", count: 310 }],
    idempotencyKey: "webmcp-occupancy-1",
  });
  const refreshed = await modelContext.tools
    .get("venue.refresh_live_occupancy")
    .execute({ idempotencyKey: "webmcp-occupancy-refresh-1" });
  const exported = await modelContext.tools.get("venue.export_live_occupancy").execute({});

  assert.equal(inspected.structuredContent.data.projection.overallStatus, "warning");
  assert.equal(ingested.structuredContent.data.monitor.revision, 3);
  assert.equal(refreshed.structuredContent.data.projection.overallStatus, "stale");
  assert.equal(exported.structuredContent.data.filename, "occupancy.audit.json");
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["ingest", "refresh"],
  );
  assert.equal(modelContext.tools.has("venue.acknowledge_occupancy_alert"), false);
});

test("WebMCP Incident tools share inspection, reporting, and export while response authority stays human", async () => {
  const modelContext = new FakeModelContext();
  const calls = [];
  const incidentOperations = {
    inspectIncidents: async (input) => {
      calls.push(["inspect", input]);
      return { register: { id: "incidents-runbook-1" }, incidents: [] };
    },
    reportIncident: async (input) => {
      calls.push(["report", input]);
      return { register: { id: "incidents-runbook-1" }, incident: { id: "incident-1", revision: 1 } };
    },
    exportIncidentRecord: async (input) => {
      calls.push(["export", input]);
      return { filename: "incident-1.incident.json", mimeType: "application/json", content: "{}" };
    },
  };
  await registerVenueTools(modelContext, createVenuePlanner(summitForwardPlan), new AbortController().signal, {
    incidentOperations,
  });
  const inspected = await modelContext.tools.get("venue.inspect_incidents").execute({ status: "open" });
  const reported = await modelContext.tools.get("venue.report_incident").execute({
    severity: "high",
    category: "crowd-capacity",
    summaryCode: "QUEUE_SPILLBACK",
    location: { kind: "coordinate", point: { x: 12, y: 8 } },
    idempotencyKey: "webmcp-incident-1",
  });
  const exported = await modelContext.tools.get("venue.export_incident_record").execute({ incidentId: "incident-1" });

  assert.equal(inspected.structuredContent.data.register.id, "incidents-runbook-1");
  assert.equal(reported.structuredContent.data.incident.id, "incident-1");
  assert.equal(exported.structuredContent.data.filename, "incident-1.incident.json");
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ["inspect", "report", "export"],
  );
  for (const prohibited of [
    "acknowledge_incident",
    "escalate_incident",
    "handoff_incident",
    "record_incident_emergency_action",
  ])
    assert.equal(modelContext.tools.has(`venue.${prohibited}`), false);
});
