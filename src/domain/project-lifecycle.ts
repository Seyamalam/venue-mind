import { fingerprintPlan } from "./activity-ledger.ts";
import { createVenuePlanner } from "./venue-planner.ts";

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const tokenFor: any = (projectId: any) => projectId.replace(/^project-/, "").replace(/[^a-zA-Z0-9-]/g, "-");

export function duplicateProjectRecord(source: any, {
  projectId,
  name,
  clock = () => new Date().toISOString(),
}: any = {}) {
  if (!source?.snapshot?.plan || !source.snapshot.brief || !source.snapshot.proposal) throw new Error("Source Project requires a complete planner snapshot");
  if (!projectId || projectId === source.id) throw new Error("Duplicate Project requires a new stable Project ID");
  const normalizedName: any = name?.trim();
  if (!normalizedName) throw new Error("Duplicate Project requires a name");
  const token: any = tokenFor(projectId);
  const sourcePlan: any = clone(source.snapshot.plan);
  const sourceBrief: any = clone(source.snapshot.brief);
  const sourceProposal: any = clone(source.snapshot.proposal);
  const changeIds: any = new Map(sourceProposal.changes.map((change: any, index: any) => [change.id, `chg-${token}-${String(index + 1).padStart(3, "0")}`]));
  const requirementIds: any = new Map(sourceBrief.requirements.map((requirement: any, index: any) => [requirement.id, `req-${token}-${String(index + 1).padStart(3, "0")}`]));
  const remapRequirementId: any = (id: any) => requirementIds.get(id) ?? id;
  const briefId: any = `brief-${token}`;
  const planningEffectBindings: any = sourceBrief.planningEffectBindings === undefined ? undefined : Object.fromEntries(Object.entries(sourceBrief.planningEffectBindings).map(([operation, binding]: any) => [operation, { ...binding, targetRequirementId: remapRequirementId(binding.targetRequirementId) }]));
  const remapChange: any = (change: any) => ({
    ...change,
    id: changeIds.get(change.id),
    ...(Array.isArray(change.targetRequirementIds) ? { targetRequirementIds: change.targetRequirementIds.map(remapRequirementId) } : {}),
    ...(Array.isArray(change.planningEffects) ? {
      planningEffects: change.planningEffects.map((effect: any) => ({
        ...effect,
        targetBriefId: briefId,
        targetRequirementId: remapRequirementId(effect.targetRequirementId),
        requirement: { ...effect.requirement, id: remapRequirementId(effect.requirement.id) },
      })),
    } : {}),
    lineage: { duplicatedFromChangeId: change.id, duplicatedFromProjectId: source.id },
  });
  const plan: any = {
    ...sourcePlan,
    id: `plan-${token}`,
    version: "1.0",
    event: { ...sourcePlan.event, id: `event-${token}`, name: normalizedName },
    brief: {
      ...sourceBrief,
      id: briefId,
      eventName: normalizedName,
      requirements: sourceBrief.requirements.map((requirement: any) => ({ ...requirement, id: requirementIds.get(requirement.id) })),
      ...(planningEffectBindings !== undefined ? { planningEffectBindings } : {}),
    },
    proposal: {
      ...sourceProposal,
      id: `proposal-${token}-001`,
      revision: 1,
      goal: sourceProposal.goal,
      changes: sourceProposal.changes.map(remapChange),
    },
  };
  const planner: any = createVenuePlanner(plan);
  const createdAt: any = clock();
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
