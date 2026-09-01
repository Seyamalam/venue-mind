import { summitForwardPlan } from "../../../src/domain/summit-forward.ts";
import { createVenuePlanner, validateVenueState } from "../../../src/domain/venue-planner.ts";
import { venueError } from "../../../src/domain/errors.ts";
import { stableFingerprint, verifyActivityLedger } from "../../../src/domain/activity-ledger.ts";
import { createEventDayRunbook } from "../../../src/domain/event-day-runbook.ts";
import { createOccupancyCommandBus } from "../../../src/domain/occupancy-command-bus.ts";
import { createIncidentCommandBus } from "../../../src/domain/incident-command-bus.ts";

const DEFAULT_PROJECT_ID: any = "project-summit-forward";
const clone: any = (value: any) => structuredClone(value);
const fingerprint: any = (value: any) => JSON.stringify(value);

const defaultRecord: any = (clock: any, organizationId: any) => {
  const planner: any = createVenuePlanner(summitForwardPlan, { projectId: DEFAULT_PROJECT_ID });
  const occurredAt: any = clock();
  return {
    id: DEFAULT_PROJECT_ID,
    organizationId,
    name: "SummitForward 2026",
    activePlanId: summitForwardPlan.id,
    schemaVersion: 10,
    snapshot: clone(planner.getSnapshot()),
    createdAt: occurredAt,
    updatedAt: occurredAt,
    archivedAt: null,
    deletedAt: null,
    recoveryUntil: null,
    pinned: true,
    lastOpenedAt: occurredAt,
  };
};

const publicProject: any = (record: any, activeProjectId: any) => ({
  id: record.id,
  name: record.name,
  activePlanId: record.activePlanId,
  planVersion: record.snapshot.plan.version,
  proposalId: record.snapshot.proposal?.id ?? null,
  updatedAt: record.updatedAt,
  active: record.id === activeProjectId,
});

export function createProjectSession({ repository, organizationId = repository?.organizationId ?? "org-local", clock = () => new Date().toISOString(), logger }: any = {}) {
  if (!repository) throw new TypeError("Project session requires a repository Adapter");
  let activeProjectId: any = DEFAULT_PROJECT_ID;
  let activeRecord: any = null;
  let planner: any = null;
  let initialization: any = null;
  const occupancyMonitors: any = new Map();
  const incidentRegisters: any = new Map();

  const persistIncidentRegister: any = async (register: any) => {
    activeRecord = await repository.save({
      ...activeRecord,
      incidentRegister: clone(register),
      updatedAt: clock(),
      lastOpenedAt: clock(),
    });
    incidentRegisters.set(activeProjectId, clone(register));
  };

  const activeRunbookForCurrentProject: any = () => {
    const snapshot: any = planner.getSnapshot();
    const integrity: any = verifyActivityLedger(snapshot.ledger);
    if (integrity.status !== "pass") throw venueError("LEDGER_INTEGRITY_FAILED", { projectId: activeProjectId });
    const validation: any = validateVenueState({ ...snapshot, proposal: null });
    if (validation.status !== "pass") throw venueError("INCIDENT_REGISTER_NOT_FOUND", { projectId: activeProjectId, reason: "accepted-plan-not-operational" });
    const approval: any = snapshot.ledger.slice().reverse().find((entry: any) => entry.details?.acceptedPlan?.id === snapshot.plan.id) ?? snapshot.ledger.at(-1);
    return createEventDayRunbook({ projectId: activeProjectId, plan: snapshot.plan, brief: snapshot.brief, validation, sourceLedgerHeadHash: integrity.headHash, approvalLedgerEntryId: approval.id, frozenAt: clock(), frozenBy: "mcp-host" });
  };

  const occupancyBusForCurrentProject: any = () => {
    const cached: any = occupancyMonitors.get(activeProjectId) ?? null;
    const bus: any = createOccupancyCommandBus({ initialMonitor: cached });
    if (cached) return bus;
    const snapshot: any = planner.getSnapshot();
    const runbook: any = activeRunbookForCurrentProject();
    const created: any = bus.execute({ type: "create_occupancy_monitor", projectId: activeProjectId, runbook, plan: snapshot.plan, createdAt: clock(), createdBy: "mcp-host" });
    occupancyMonitors.set(activeProjectId, created.monitor);
    return bus;
  };

  const incidentBusForCurrentProject: any = async () => {
    const cached: any = incidentRegisters.get(activeProjectId) ?? null;
    const bus: any = createIncidentCommandBus({ initialRegister: cached });
    if (cached) return bus;
    const created: any = bus.execute({ type: "create_incident_register", projectId: activeProjectId, runbook: activeRunbookForCurrentProject(), createdAt: clock(), createdBy: "mcp-host", actorType: "human" });
    await persistIncidentRegister(created.register);
    return bus;
  };

  const occupancyMetadata: any = (input: any, type: any, revision: any) => {
    const identity: any = input.idempotencyKey ?? `mcp-occupancy-${type}-${Date.now()}`;
    return { operationId: `occupancy-operation-${identity}`, idempotencyKey: identity, correlationId: input.correlationId ?? `mcp-occupancy-${identity}`, expectedRevision: revision, actorType: "agent", actorId: "mcp-agent", source: "mcp", sessionId: "mcp-session", committedAt: clock() };
  };

  const hydrate: any = async (record: any) => {
    const nextPlanner: any = createVenuePlanner(summitForwardPlan, { projectId: record.id });
    await nextPlanner.execute({ type: "restore_snapshot", snapshot: clone(record.snapshot) });
    activeRecord = clone(record);
    activeProjectId = record.id;
    if (record.incidentRegister) incidentRegisters.set(record.id, clone(record.incidentRegister));
    else incidentRegisters.delete(record.id);
    planner = nextPlanner;
    return record;
  };

  const initialize: any = () => {
    if (!initialization) initialization = (async () => {
      let record: any = await repository.load(DEFAULT_PROJECT_ID);
      if (!record) {
        record = defaultRecord(clock, organizationId);
        await repository.save(record);
        logger?.info("project.seeded", { organizationId, projectId: record.id });
      }
      await hydrate(record);
      return record;
    })();
    return initialization;
  };

  const current: any = async () => {
    await initialize();
    return { record: clone(activeRecord), snapshot: clone(planner.getSnapshot()) };
  };

  const persistIfChanged: any = async (before: any) => {
    const snapshot: any = clone(planner.getSnapshot());
    if (before === fingerprint(snapshot)) return;
    activeRecord = await repository.save({
      ...activeRecord,
      activePlanId: snapshot.plan.id,
      schemaVersion: 10,
      snapshot,
      updatedAt: clock(),
      lastOpenedAt: clock(),
    });
  };

  return Object.freeze({
    initialize,
    async listProjects() {
      await initialize();
      return (await repository.list()).filter((record: any) => !record.deletedAt).map((record: any) => publicProject(record, activeProjectId));
    },
    async openProject(projectId: any) {
      await initialize();
      const record: any = await repository.load(projectId);
      if (!record || record.deletedAt) throw venueError("PROJECT_NOT_FOUND", { projectId });
      await hydrate({ ...record, lastOpenedAt: clock() });
      activeRecord = await repository.save({ ...activeRecord, lastOpenedAt: clock(), updatedAt: clock() });
      logger?.info("project.opened", { organizationId, projectId, planId: activeRecord.activePlanId, planVersion: activeRecord.snapshot.plan.version });
      return publicProject(activeRecord, activeProjectId);
    },
    current,
    async readProject(projectId: any) {
      await initialize();
      const record: any = await repository.load(projectId);
      if (!record || record.deletedAt) throw venueError("PROJECT_NOT_FOUND", { projectId });
      return clone(record);
    },
    async execute(command: any, { signal, authorization }: any = {}) {
      await initialize();
      if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { commandType: command.type });
      const before: any = fingerprint(planner.getSnapshot());
      let onAbort: any;
      if (signal) {
        onAbort = () => planner.cancelActive("mcp-request-cancelled");
        signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const result: any = await planner.execute(command, { authorization, organizationId, projectId: activeProjectId });
        await persistIfChanged(before);
        if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { commandType: command.type });
        return result;
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
    },
    async inspectLiveOccupancy() {
      await initialize();
      const bus: any = occupancyBusForCurrentProject();
      return bus.execute({ type: "inspect_live_occupancy", evaluatedAt: clock() });
    },
    async ingestOccupancySignal(input: any) {
      await initialize();
      const bus: any = occupancyBusForCurrentProject();
      const current: any = bus.getSnapshot();
      const result: any = bus.execute({ type: "ingest_occupancy_signal", signal: { sourceId: input.sourceId, sourceType: input.sourceType, sourceVersion: input.sourceVersion, kind: input.kind, observedAt: input.observedAt, confidence: input.confidence, readings: input.readings }, ...occupancyMetadata(input, "ingest", current.revision) });
      occupancyMonitors.set(activeProjectId, result.monitor);
      return result;
    },
    async refreshLiveOccupancy(input: any) {
      await initialize();
      const bus: any = occupancyBusForCurrentProject();
      const current: any = bus.getSnapshot();
      const command: any = { type: "refresh_live_occupancy", ...occupancyMetadata(input, "refresh", current.revision) };
      command.evaluatedAt = command.committedAt;
      const result: any = bus.execute(command);
      occupancyMonitors.set(activeProjectId, result.monitor);
      return result;
    },
    async exportLiveOccupancy() {
      await initialize();
      return occupancyBusForCurrentProject().execute({ type: "export_live_occupancy", exportedAt: clock() });
    },
    async inspectIncidents(input: any = {}) {
      await initialize();
      const bus: any = await incidentBusForCurrentProject();
      const register: any = bus.getSnapshot();
      if (input.incidentId) return { register, incident: bus.execute({ type: "inspect_incident", incidentId: input.incidentId }) };
      return { register, incidents: bus.execute({ type: "inspect_incidents", status: input.status, severity: input.severity, category: input.category }).slice(0, input.limit ?? 50) };
    },
    async reportIncident(input: any) {
      await initialize();
      const bus: any = await incidentBusForCurrentProject();
      const identity: any = input.idempotencyKey;
      const incidentId: any = `incident-${stableFingerprint("mcp-incident-id", { projectId: activeProjectId, identity }).slice(-16)}`;
      const result: any = bus.execute({ type: "report_incident", incidentId, severity: input.severity, category: input.category, summaryCode: input.summaryCode, location: input.location, relatedRefs: input.relatedRefs ?? [], idempotencyKey: identity, operationId: `incident-operation-${identity}`, correlationId: input.correlationId ?? `mcp-incident-${identity}`, actorType: "agent", actorId: "mcp-agent", source: "mcp", sessionId: "mcp-session", committedAt: clock() });
      await persistIncidentRegister(result.register);
      return result;
    },
    async exportIncidentRecord(input: any) {
      await initialize();
      return (await incidentBusForCurrentProject()).execute({ type: "export_incident_record", incidentId: input.incidentId, exportedAt: clock() });
    },
    async recordAuthorizationDenial(input: any) {
      await initialize();
      const before: any = fingerprint(planner.getSnapshot());
      const ledgerEntryId: any = planner.recordAuthorizationDenial(input);
      await persistIfChanged(before);
      return ledgerEntryId;
    },
  });
}
