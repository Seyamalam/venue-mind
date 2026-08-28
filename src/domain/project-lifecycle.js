import { fingerprintPlan } from "./activity-ledger.js";
import { createVenuePlanner } from "./venue-planner.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const tokenFor = (projectId) => projectId.replace(/^project-/, "").replace(/[^a-zA-Z0-9-]/g, "-");

export function duplicateProjectRecord(source, {
  projectId,
  name,
  clock = () => new Date().toISOString(),
} = {}) {
  if (!source?.snapshot?.plan || !source.snapshot.brief || !source.snapshot.proposal) throw new Error("Source Project requires a complete planner snapshot");
  if (!projectId || projectId === source.id) throw new Error("Duplicate Project requires a new stable Project ID");
  const normalizedName = name?.trim();
  if (!normalizedName) throw new Error("Duplicate Project requires a name");
  const token = tokenFor(projectId);
  const sourcePlan = clone(source.snapshot.plan);
  const sourceBrief = clone(source.snapshot.brief);
  const sourceProposal = clone(source.snapshot.proposal);
  const changeIds = new Map(sourceProposal.changes.map((change, index) => [change.id, `chg-${token}-${String(index + 1).padStart(3, "0")}`]));
  const requirementIds = new Map(sourceBrief.requirements.map((requirement, index) => [requirement.id, `req-${token}-${String(index + 1).padStart(3, "0")}`]));
  const plan = {
    ...sourcePlan,
    id: `plan-${token}`,
    version: "1.0",
    event: { ...sourcePlan.event, id: `event-${token}`, name: normalizedName },
    brief: {
      ...sourceBrief,
      id: `brief-${token}`,
      eventName: normalizedName,
      requirements: sourceBrief.requirements.map((requirement) => ({ ...requirement, id: requirementIds.get(requirement.id) })),
    },
    proposal: {
      ...sourceProposal,
      id: `proposal-${token}-001`,
      revision: 1,
      goal: sourceProposal.goal,
      changes: sourceProposal.changes.map((change) => ({ ...change, id: changeIds.get(change.id), lineage: { duplicatedFromChangeId: change.id, duplicatedFromProjectId: source.id } })),
    },
  };
  const planner = createVenuePlanner(plan);
  const createdAt = clock();
  return {
    id: projectId,
    name: normalizedName,
    activePlanId: plan.id,
    schemaVersion: 10,
    snapshot: planner.getSnapshot(),
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    deletedAt: null,
    recoveryUntil: null,
    pinned: false,
    lastOpenedAt: null,
    provenance: {
      kind: "project-duplicate",
      sourceProjectId: source.id,
      sourcePlanId: source.snapshot.plan.id,
      sourcePlanVersion: source.snapshot.plan.version,
      sourcePlanFingerprint: fingerprintPlan(source.snapshot.plan),
      duplicatedAt: createdAt,
    },
  };
}
