import { summitForwardPlan } from "../../../src/domain/summit-forward.js";
import { createVenuePlanner } from "../../../src/domain/venue-planner.js";
import { venueError } from "../../../src/domain/errors.js";

const DEFAULT_PROJECT_ID = "project-summit-forward";
const clone = (value) => structuredClone(value);
const fingerprint = (value) => JSON.stringify(value);

const defaultRecord = (clock, organizationId) => {
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

const publicProject = (record, activeProjectId) => ({
  id: record.id,
  name: record.name,
  activePlanId: record.activePlanId,
  planVersion: record.snapshot.plan.version,
  proposalId: record.snapshot.proposal?.id ?? null,
  updatedAt: record.updatedAt,
  active: record.id === activeProjectId,
});

export function createProjectSession({ repository, organizationId = repository?.organizationId ?? "org-local", clock = () => new Date().toISOString(), logger } = {}) {
  if (!repository) throw new TypeError("Project session requires a repository Adapter");
  let activeProjectId = DEFAULT_PROJECT_ID;
  let activeRecord = null;
  let planner = null;
  let initialization = null;

  const hydrate = async (record) => {
    const nextPlanner = createVenuePlanner(summitForwardPlan, { projectId: record.id });
    await nextPlanner.execute({ type: "restore_snapshot", snapshot: clone(record.snapshot) });
    activeRecord = clone(record);
    activeProjectId = record.id;
    planner = nextPlanner;
    return record;
  };

  const initialize = () => {
    if (!initialization) initialization = (async () => {
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
    return { record: clone(activeRecord), snapshot: clone(planner.getSnapshot()) };
  };

  const persistIfChanged = async (before) => {
    const snapshot = clone(planner.getSnapshot());
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
      return (await repository.list()).filter((record) => !record.deletedAt).map((record) => publicProject(record, activeProjectId));
    },
    async openProject(projectId) {
      await initialize();
      const record = await repository.load(projectId);
      if (!record || record.deletedAt) throw venueError("PROJECT_NOT_FOUND", { projectId });
      await hydrate({ ...record, lastOpenedAt: clock() });
      activeRecord = await repository.save({ ...activeRecord, lastOpenedAt: clock(), updatedAt: clock() });
      logger?.info("project.opened", { organizationId, projectId, planId: activeRecord.activePlanId, planVersion: activeRecord.snapshot.plan.version });
      return publicProject(activeRecord, activeProjectId);
    },
    current,
    async readProject(projectId) {
      await initialize();
      const record = await repository.load(projectId);
      if (!record || record.deletedAt) throw venueError("PROJECT_NOT_FOUND", { projectId });
      return clone(record);
    },
    async execute(command, { signal, authorization } = {}) {
      await initialize();
      if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { commandType: command.type });
      const before = fingerprint(planner.getSnapshot());
      let onAbort;
      if (signal) {
        onAbort = () => planner.cancelActive("mcp-request-cancelled");
        signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const result = await planner.execute(command, { authorization, organizationId, projectId: activeProjectId });
        await persistIfChanged(before);
        if (signal?.aborted) throw venueError("TOOL_CALL_CANCELLED", { commandType: command.type });
        return result;
      } finally {
        if (onAbort) signal.removeEventListener("abort", onAbort);
      }
    },
    async recordAuthorizationDenial(input) {
      await initialize();
      const before = fingerprint(planner.getSnapshot());
      const ledgerEntryId = planner.recordAuthorizationDenial(input);
      await persistIfChanged(before);
      return ledgerEntryId;
    },
  });
}
