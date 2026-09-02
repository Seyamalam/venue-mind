import { fingerprintPlan } from "./activity-ledger.ts";
import { createVenuePlanner } from "./venue-planner.ts";
import type { ProjectProvenance } from "./project-types.ts";
import type { PlanningEffectBindings } from "./event-brief.ts";
import type { PlanningChange } from "./planning-effects.ts";
import type { PlannerSnapshot } from "./venue-planner.ts";
import type { VenuePlanDocument } from "./geometry.ts";

interface LifecycleProjectRecord {
  id: string;
  name: string;
  activePlanId: string;
  schemaVersion: 10;
  snapshot: PlannerSnapshot;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  deletedAt: string | null;
  recoveryUntil: string | null;
  pinned: boolean;
  lastOpenedAt: string | null;
  provenance?: ProjectProvenance;
}

const clone = <T>(value: T): T => structuredClone(value);
const tokenFor = (projectId: string): string => projectId.replace(/^project-/, "").replace(/[^a-zA-Z0-9-]/g, "-");

export function duplicateProjectRecord(
  source: LifecycleProjectRecord,
  {
    projectId,
    name,
    clock = () => new Date().toISOString(),
  }: { projectId?: string; name?: string; clock?: () => string } = {},
): LifecycleProjectRecord {
  if (!source?.snapshot?.plan || !source.snapshot.brief || !source.snapshot.proposal)
    throw new Error("Source Project requires a complete planner snapshot");
  if (!projectId || projectId === source.id) throw new Error("Duplicate Project requires a new stable Project ID");
  const normalizedName = name?.trim();
  if (!normalizedName) throw new Error("Duplicate Project requires a name");
  const token = tokenFor(projectId);
  const sourcePlan = clone(source.snapshot.plan);
  const sourceBrief = clone(source.snapshot.brief);
  const sourceProposal = clone(source.snapshot.proposal);
  const changeIds = new Map(
    sourceProposal.changes.map((change, index) => [change.id, `chg-${token}-${String(index + 1).padStart(3, "0")}`]),
  );
  const requirementIds = new Map(
    sourceBrief.requirements.map((requirement, index) => [
      requirement.id,
      `req-${token}-${String(index + 1).padStart(3, "0")}`,
    ]),
  );
  const remapRequirementId = (id: string): string => requirementIds.get(id) ?? id;
  const briefId = `brief-${token}`;
  const planningEffectBindings: PlanningEffectBindings | undefined =
    sourceBrief.planningEffectBindings === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(sourceBrief.planningEffectBindings).map(([operation, binding]) => [
            operation,
            { ...binding, targetRequirementId: remapRequirementId(binding.targetRequirementId) },
          ]),
        );
  const remapChange = (change: PlanningChange): PlanningChange => ({
    ...change,
    id: changeIds.get(change.id) ?? change.id,
    ...(change.targetRequirementIds
      ? { targetRequirementIds: change.targetRequirementIds.map(remapRequirementId) }
      : {}),
    ...(change.planningEffects
      ? {
          planningEffects: change.planningEffects.map((effect) => ({
            ...effect,
            targetBriefId: briefId,
            targetRequirementId: remapRequirementId(effect.targetRequirementId),
            requirement: { ...effect.requirement, id: remapRequirementId(effect.requirement.id) },
          })),
        }
      : {}),
    lineage: { duplicatedFromChangeId: change.id, duplicatedFromProjectId: source.id },
  });
  const plan: VenuePlanDocument = {
    ...sourcePlan,
    id: `plan-${token}`,
    version: "1.0",
    event: { ...sourcePlan.event, id: `event-${token}`, name: normalizedName },
    brief: {
      ...sourceBrief,
      id: briefId,
      eventName: normalizedName,
      requirements: sourceBrief.requirements.map((requirement) => ({
        ...requirement,
        id: requirementIds.get(requirement.id) ?? requirement.id,
      })),
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
