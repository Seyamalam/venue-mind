import { summitForwardPlan } from "../../../src/domain/summit-forward.ts";
import { createVenuePlanner, validateVenueState } from "../../../src/domain/venue-planner.ts";
import { venueError } from "../../../src/domain/errors.ts";
import { stableFingerprint, verifyActivityLedger } from "../../../src/domain/activity-ledger.ts";
import { createEventDayRunbook } from "../../../src/domain/event-day-runbook.ts";
import { createOccupancyCommandBus } from "../../../src/domain/occupancy-command-bus.ts";
import { createIncidentCommandBus } from "../../../src/domain/incident-command-bus.ts";
import type { VenueToolInput } from "../../../src/contracts/venue-contracts.ts";
import type { AuthorizationDenial, ProjectSummary, ToolAuthorization } from "../../../src/tools/venue-tool-service.ts";
import type {
  AggregateOccupancySignal,
  IncidentCategory,
  IncidentLocationInput,
  IncidentRegister,
  IncidentRelatedRef,
  IncidentSeverity,
  IncidentStatus,
  LiveOccupancyMonitor,
  OccupancyConfidence,
  OccupancyMutationCommandContext,
  OperationalIncident,
  RefreshLiveOccupancyCommand,
} from "../../../src/domain/operational-types.ts";
import type { PlannerCommand, VenuePlanner } from "../../../src/domain/venue-planner.ts";
import type { McpProjectRecord, McpProjectRepository } from "./project-repository.ts";

const DEFAULT_PROJECT_ID = "project-summit-forward";
const clone = <Value>(value: Value): Value => structuredClone(value);
const fingerprint = (value: object): string => JSON.stringify(value);

export interface McpLogger {
  info(event: string, fields: Readonly<Record<string, string | number | boolean | null>>): void;
  error(event: string, fields: Readonly<Record<string, string | number | boolean | null>>): void;
}

interface ProjectSessionOptions {
  readonly repository: McpProjectRepository;
  readonly organizationId?: string;
  readonly clock?: () => string;
  readonly logger?: McpLogger;
}

const requiredString = (value: string | undefined, field: string): string => {
  if (!value?.trim()) throw venueError("COMMAND_INVALID", { field });
  return value;
};

const isOccupancySourceType = (value: string | undefined): value is AggregateOccupancySignal["sourceType"] =>
  value === "registration" || value === "sensor" || value === "manual-counter";
const isOccupancyKind = (value: string | undefined): value is AggregateOccupancySignal["kind"] =>
  value === "check-in" || value === "zone-occupancy";
const isOccupancyConfidence = (value: string | undefined): value is OccupancyConfidence =>
  value === "low" || value === "medium" || value === "high";
const isIncidentStatus = (value: string | undefined): value is IncidentStatus =>
  value === "open" || value === "mitigating" || value === "resolved" || value === "closed";
const isIncidentSeverity = (value: string | undefined): value is IncidentSeverity =>
  value === "low" || value === "medium" || value === "high" || value === "critical";
const isIncidentCategory = (value: string | undefined): value is IncidentCategory =>
  [
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
  ].includes(value ?? "");
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const occupancySignalFromInput = (input: VenueToolInput): AggregateOccupancySignal => {
  if (
    !isOccupancySourceType(input.sourceType) ||
    !isOccupancyKind(input.kind) ||
    !isOccupancyConfidence(input.confidence) ||
    !input.readings
  ) {
    throw venueError("OCCUPANCY_SIGNAL_INVALID", { reason: "signal-fields-invalid" });
  }
  const readings = input.readings.map((reading) => {
    if (typeof reading["scopeId"] !== "string" || typeof reading["count"] !== "number")
      throw venueError("OCCUPANCY_SIGNAL_INVALID", { reason: "reading-invalid" });
    return { scopeId: reading["scopeId"], count: reading["count"] };
  });
  return {
    sourceId: requiredString(input.sourceId, "sourceId"),
    sourceType: input.sourceType,
    sourceVersion: requiredString(input.sourceVersion, "sourceVersion"),
    kind: input.kind,
    observedAt: requiredString(input.observedAt, "observedAt"),
    confidence: input.confidence,
    readings,
  };
};

const incidentLocationFromInput = (value: VenueToolInput["location"]): IncidentLocationInput => {
  if (!value) throw venueError("INCIDENT_LOCATION_INVALID", { reason: "location-required" });
  if (value["kind"] === "plan-object" && typeof value["planObjectId"] === "string")
    return { kind: "plan-object", planObjectId: value["planObjectId"] };
  const point = value["point"];
  if (
    value["kind"] === "coordinate" &&
    isObject(point) &&
    typeof point["x"] === "number" &&
    typeof point["y"] === "number"
  ) {
    return { kind: "coordinate", point: { x: point["x"], y: point["y"] } };
  }
  throw venueError("INCIDENT_LOCATION_INVALID", { reason: "location-fields-invalid" });
};

const incidentRelatedRefsFromInput = (values: VenueToolInput["relatedRefs"]): readonly IncidentRelatedRef[] =>
  (values ?? []).map((value) => {
    const kind = value["kind"];
    if (
      (kind !== "occupancy-alert" && kind !== "runbook-task" && kind !== "plan-object") ||
      typeof value["id"] !== "string"
    ) {
      throw venueError("INCIDENT_INVALID", { reason: "related-ref-invalid" });
    }
    return { kind, id: value["id"] };
  });

const isIncidentList = (value: unknown): value is readonly OperationalIncident[] => Array.isArray(value);

const defaultRecord = (clock: () => string, organizationId: string): McpProjectRecord => {
  const planner = createVenuePlanner(summitForwardPlan, { projectId: DEFAULT_PROJECT_ID });
  const occurredAt = clock();
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

const publicProject = (record: McpProjectRecord, activeProjectId: string): ProjectSummary => ({
  id: record.id,
  name: record.name,
  activePlanId: record.activePlanId,
  planVersion: record.snapshot.plan.version,
  proposalId: record.snapshot.proposal?.id ?? null,
  updatedAt: record.updatedAt,
  active: record.id === activeProjectId,
});

export function createProjectSession({
  repository,
  organizationId = repository.organizationId,
  clock = () => new Date().toISOString(),
  logger,
}: ProjectSessionOptions) {
  let activeProjectId = DEFAULT_PROJECT_ID;
  let activeRecord: McpProjectRecord | null = null;
  let planner: VenuePlanner | null = null;
  let initialization: Promise<McpProjectRecord> | null = null;
  const occupancyMonitors = new Map<string, LiveOccupancyMonitor>();
  const incidentRegisters = new Map<string, IncidentRegister>();

  const requireRecord = (): McpProjectRecord => {
    if (!activeRecord) throw venueError("PROJECT_NOT_FOUND", { projectId: activeProjectId });
    return activeRecord;
  };
  const requirePlanner = (): VenuePlanner => {
    if (!planner) throw venueError("PROJECT_NOT_FOUND", { projectId: activeProjectId });
    return planner;
  };

  const persistIncidentRegister = async (register: IncidentRegister): Promise<void> => {
    activeRecord = await repository.save({
      ...requireRecord(),
      incidentRegister: clone(register),
      updatedAt: clock(),
      lastOpenedAt: clock(),
    });
    incidentRegisters.set(activeProjectId, clone(register));
  };

  const activeRunbookForCurrentProject = () => {
    const snapshot = requirePlanner().getSnapshot();
    const integrity = verifyActivityLedger(snapshot.ledger);
    if (integrity.status !== "pass") throw venueError("LEDGER_INTEGRITY_FAILED", { projectId: activeProjectId });
    const validation = validateVenueState({ ...snapshot, proposal: null });
    if (validation.status !== "pass")
      throw venueError("INCIDENT_REGISTER_NOT_FOUND", {
        projectId: activeProjectId,
        reason: "accepted-plan-not-operational",
      });
    const approval =
      snapshot.ledger
        .slice()
        .reverse()
        .find((entry) => "acceptedPlan" in entry.details) ?? snapshot.ledger.at(-1);
    if (!approval)
      throw venueError("INCIDENT_REGISTER_NOT_FOUND", {
        projectId: activeProjectId,
        reason: "approval-ledger-entry-missing",
      });
    return createEventDayRunbook({
      projectId: activeProjectId,
      plan: snapshot.plan,
      brief: snapshot.brief,
      validation,
      sourceLedgerHeadHash: integrity.headHash,
      approvalLedgerEntryId: approval.id,
      frozenAt: clock(),
      frozenBy: "mcp-host",
    });
  };

  const occupancyBusForCurrentProject = () => {
    const cached = occupancyMonitors.get(activeProjectId) ?? null;
    const bus = createOccupancyCommandBus({ initialMonitor: cached });
    if (cached) return bus;
    const snapshot = requirePlanner().getSnapshot();
    const runbook = activeRunbookForCurrentProject();
    const created = bus.execute({
      type: "create_occupancy_monitor",
      projectId: activeProjectId,
      runbook,
      plan: snapshot.plan,
      createdAt: clock(),
      createdBy: "mcp-host",
    });
    if (!("monitor" in created)) throw venueError("OCCUPANCY_MONITOR_NOT_FOUND", { projectId: activeProjectId });
    occupancyMonitors.set(activeProjectId, created.monitor);
    return bus;
  };

  const incidentBusForCurrentProject = async () => {
    const cached = incidentRegisters.get(activeProjectId) ?? null;
    const bus = createIncidentCommandBus({ initialRegister: cached });
    if (cached) return bus;
    const created = bus.execute({
      type: "create_incident_register",
      projectId: activeProjectId,
      runbook: activeRunbookForCurrentProject(),
      createdAt: clock(),
      createdBy: "mcp-host",
      actorType: "human",
    });
    if (!("register" in created)) throw venueError("INCIDENT_REGISTER_NOT_FOUND", { projectId: activeProjectId });
    await persistIncidentRegister(created.register);
    return bus;
  };

  const occupancyMetadata = (
    input: VenueToolInput,
    type: "ingest" | "refresh",
    revision: number,
  ): OccupancyMutationCommandContext => {
    const identity = input.idempotencyKey ?? `mcp-occupancy-${type}-${Date.now()}`;
    return {
      operationId: `occupancy-operation-${identity}`,
      idempotencyKey: identity,
      correlationId: input.correlationId ?? `mcp-occupancy-${identity}`,
      expectedRevision: revision,
      actorType: "agent",
      actorId: "mcp-agent",
      source: "mcp",
      sessionId: "mcp-session",
      committedAt: clock(),
    };
  };

  const hydrate = async (record: McpProjectRecord): Promise<McpProjectRecord> => {
    const nextPlanner = createVenuePlanner(summitForwardPlan, { projectId: record.id });
    await nextPlanner.execute({ type: "restore_snapshot", snapshot: clone(record.snapshot) });
    activeRecord = clone(record);
    activeProjectId = record.id;
    if (record.incidentRegister) incidentRegisters.set(record.id, clone(record.incidentRegister));
    else incidentRegisters.delete(record.id);
    planner = nextPlanner;
    return record;
  };

  const initialize = (): Promise<McpProjectRecord> => {
    if (!initialization)
      initialization = (async () => {
        let record = await repository.load(DEFAULT_PROJECT_ID);
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

  const current = async () => {
    await initialize();
    return { record: clone(requireRecord()), snapshot: clone(requirePlanner().getSnapshot()) };
  };

  const persistIfChanged = async (before: string): Promise<void> => {
    const snapshot = clone(requirePlanner().getSnapshot());
    if (before === fingerprint(snapshot)) return;
    activeRecord = await repository.save({
      ...requireRecord(),
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
      return (await repository.list())
        .filter((record) => !record.deletedAt)
        .map((record) => publicProject(record, activeProjectId));
    },
    async openProject(projectId: string) {
      await initialize();
      const record = await repository.load(projectId);
      if (!record || record.deletedAt) throw venueError("PROJECT_NOT_FOUND", { projectId });
      await hydrate({ ...record, lastOpenedAt: clock() });
      activeRecord = await repository.save({ ...requireRecord(), lastOpenedAt: clock(), updatedAt: clock() });
      const currentRecord = requireRecord();
      logger?.info("project.opened", {
        organizationId,
        projectId,
        planId: currentRecord.activePlanId,
        planVersion: currentRecord.snapshot.plan.version,
      });
      return publicProject(currentRecord, activeProjectId);
    },
    current,
    async readProject(projectId: string) {
      await initialize();
      const record = await repository.load(projectId);
      if (!record || record.deletedAt) throw venueError("PROJECT_NOT_FOUND", { projectId });
      return clone(record);
    },
    async execute(
      command: PlannerCommand,
      { signal, authorization }: { readonly signal?: AbortSignal; readonly authorization?: ToolAuthorization } = {},
    ) {
      await initialize();
      if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { commandType: command.type });
      const currentPlanner = requirePlanner();
      const before = fingerprint(currentPlanner.getSnapshot());
      let onAbort: (() => void) | undefined;
      if (signal) {
        onAbort = () => currentPlanner.cancelActive("mcp-request-cancelled");
        signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const result = await currentPlanner.execute(command, {
          ...(authorization ? { authorization } : {}),
          projectId: activeProjectId,
        });
        await persistIfChanged(before);
        if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { commandType: command.type });
        return result;
      } finally {
        if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      }
    },
    async inspectLiveOccupancy() {
      await initialize();
      const bus = occupancyBusForCurrentProject();
      return bus.execute({ type: "inspect_live_occupancy", evaluatedAt: clock() });
    },
    async ingestOccupancySignal(input: VenueToolInput) {
      await initialize();
      const bus = occupancyBusForCurrentProject();
      const current = bus.getSnapshot();
      if (!current) throw venueError("OCCUPANCY_MONITOR_NOT_FOUND", { projectId: activeProjectId });
      const result = bus.execute({
        type: "ingest_occupancy_signal",
        signal: occupancySignalFromInput(input),
        ...occupancyMetadata(input, "ingest", current.revision),
      });
      if (!("monitor" in result)) throw venueError("OCCUPANCY_MONITOR_NOT_FOUND", { projectId: activeProjectId });
      occupancyMonitors.set(activeProjectId, result.monitor);
      return result;
    },
    async refreshLiveOccupancy(input: VenueToolInput) {
      await initialize();
      const bus = occupancyBusForCurrentProject();
      const current = bus.getSnapshot();
      if (!current) throw venueError("OCCUPANCY_MONITOR_NOT_FOUND", { projectId: activeProjectId });
      const metadata = occupancyMetadata(input, "refresh", current.revision);
      const command: RefreshLiveOccupancyCommand = {
        type: "refresh_live_occupancy",
        ...metadata,
        evaluatedAt: metadata.committedAt ?? clock(),
      };
      const result = bus.execute(command);
      if (!("monitor" in result)) throw venueError("OCCUPANCY_MONITOR_NOT_FOUND", { projectId: activeProjectId });
      occupancyMonitors.set(activeProjectId, result.monitor);
      return result;
    },
    async exportLiveOccupancy() {
      await initialize();
      return occupancyBusForCurrentProject().execute({ type: "export_live_occupancy", exportedAt: clock() });
    },
    async inspectIncidents(input: VenueToolInput = {}) {
      await initialize();
      const bus = await incidentBusForCurrentProject();
      const register = bus.getSnapshot();
      if (input.incidentId)
        return { register, incident: bus.execute({ type: "inspect_incident", incidentId: input.incidentId }) };
      const incidents = bus.execute({
        type: "inspect_incidents",
        ...(isIncidentStatus(input.status) ? { status: input.status } : {}),
        ...(isIncidentSeverity(input.severity) ? { severity: input.severity } : {}),
        ...(isIncidentCategory(input.category) ? { category: input.category } : {}),
      });
      if (!isIncidentList(incidents)) throw venueError("INCIDENT_REGISTER_NOT_FOUND", { projectId: activeProjectId });
      return { register, incidents: incidents.slice(0, input.limit ?? 50) };
    },
    async reportIncident(input: VenueToolInput) {
      await initialize();
      const bus = await incidentBusForCurrentProject();
      const identity = requiredString(input.idempotencyKey, "idempotencyKey");
      const incidentId = `incident-${stableFingerprint("mcp-incident-id", { projectId: activeProjectId, identity }).slice(-16)}`;
      if (!isIncidentSeverity(input.severity) || !isIncidentCategory(input.category))
        throw venueError("INCIDENT_INVALID", { reason: "classification-invalid" });
      const result = bus.execute({
        type: "report_incident",
        incidentId,
        severity: input.severity,
        category: input.category,
        summaryCode: requiredString(input.summaryCode, "summaryCode"),
        location: incidentLocationFromInput(input.location),
        relatedRefs: incidentRelatedRefsFromInput(input.relatedRefs),
        idempotencyKey: identity,
        actorType: "agent",
        actorId: "mcp-agent",
        source: "mcp",
        sessionId: "mcp-session",
        committedAt: clock(),
      });
      if (!("register" in result)) throw venueError("INCIDENT_REGISTER_NOT_FOUND", { projectId: activeProjectId });
      await persistIncidentRegister(result.register);
      return result;
    },
    async exportIncidentRecord(input: VenueToolInput) {
      await initialize();
      return (await incidentBusForCurrentProject()).execute({
        type: "export_incident_record",
        incidentId: requiredString(input.incidentId, "incidentId"),
        exportedAt: clock(),
      });
    },
    async recordAuthorizationDenial(input: AuthorizationDenial) {
      await initialize();
      const currentPlanner = requirePlanner();
      const before = fingerprint(currentPlanner.getSnapshot());
      const ledgerEntryId = currentPlanner.recordAuthorizationDenial(input);
      await persistIfChanged(before);
      return ledgerEntryId;
    },
  });
}

export type ProjectSession = ReturnType<typeof createProjectSession>;
