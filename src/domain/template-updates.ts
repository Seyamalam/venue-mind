import { stableFingerprint } from "./activity-ledger.ts";
import { venueError } from "./errors.ts";
import { getRoomTemplate } from "./venue-templates.ts";
import type { VenueObject, VenuePlan, VenueProposal } from "./geometry.ts";
import type { SpatialMutation } from "./locks.ts";

const clone = <T>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const overridden = (paths: readonly string[], path: string): boolean =>
  paths.some((item) => item === path || path.startsWith(`${item}.`) || item.startsWith(`${path}.`));
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

interface MergeResult {
  value: unknown;
  applied: boolean;
}
const mergeTemplateValue = (
  before: unknown,
  after: unknown,
  current: unknown,
  path: string,
  overrides: readonly string[],
  preserved: Set<string>,
): MergeResult => {
  if (same(before, after)) return { value: clone(current ?? after), applied: false };
  if (overrides.includes(path)) {
    preserved.add(path);
    return { value: clone(current), applied: false };
  }
  if (record(before) && record(after)) {
    const value: Record<string, unknown> = { ...(record(current) ? clone(current) : {}) };
    const currentRecord = record(current) ? current : undefined;
    let applied = false;
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const childPath = `${path}.${key}`;
      const child = mergeTemplateValue(before[key], after[key], currentRecord?.[key], childPath, overrides, preserved);
      if (child.value === undefined) Reflect.deleteProperty(value, key);
      else value[key] = child.value;
      applied = applied || child.applied;
    }
    return { value, applied };
  }
  if (overridden(overrides, path)) {
    for (const item of overrides.filter((item) => item === path || item.startsWith(`${path}.`))) preserved.add(item);
    return { value: clone(current), applied: false };
  }
  return { value: clone(after), applied: true };
};

const metadataFor = (object: VenueObject): Record<string, unknown> => {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(object)) if (!["id", "footprint"].includes(key)) metadata[key] = value;
  return metadata;
};

interface TemplateUpdateOptions {
  templateId?: string | undefined;
  toVersion?: string | undefined;
  actor?: string | undefined;
}
export function createRoomTemplateUpdateProposal(
  plan: VenuePlan,
  { templateId = "", toVersion = "", actor = "agent" }: TemplateUpdateOptions,
): VenueProposal {
  const binding = plan.templateBindings?.room;
  if (!binding || binding.templateId !== templateId)
    throw venueError("TEMPLATE_BINDING_NOT_FOUND", { templateId, planId: plan.id });
  if (binding.version === toVersion) throw venueError("TEMPLATE_VERSION_CURRENT", { templateId, version: toVersion });
  const fromTemplate = getRoomTemplate(templateId, binding.version);
  const toTemplate = getRoomTemplate(templateId, toVersion);
  const fromObjects = new Map(fromTemplate.objects.map((object) => [object.id, object]));
  const toObjects = new Map(toTemplate.objects.map((object) => [object.id, object]));
  const projectObjects = new Map<string, VenueObject>();
  for (const object of plan.objects) {
    const reference = object.templateRef;
    if (reference?.kind === "room-template" && reference.templateId === templateId && reference.templateObjectId)
      projectObjects.set(reference.templateObjectId, object);
  }
  const changes: VenueProposal["changes"] = [];
  const skipped: Array<{ templateObjectId: string; reason: string }> = [];
  const proposalOverrides: Array<{ projectObjectId: string; templateObjectId: string; path: string }> = [];

  for (const templateObjectId of [...new Set([...fromObjects.keys(), ...toObjects.keys()])].sort()) {
    const before = fromObjects.get(templateObjectId);
    const after = toObjects.get(templateObjectId);
    const instance = projectObjects.get(templateObjectId);
    if (!before || !after || !instance) {
      skipped.push({
        templateObjectId,
        reason: !before
          ? "added-object-requires-placement"
          : !after
            ? "deleted-object-requires-review"
            : "unbound-project-instance",
      });
      continue;
    }
    if (same(before, after)) continue;
    const overrides = instance.templateOverrides ?? [];
    const spatialEffects: SpatialMutation[] = [];
    const preservedOverrides = new Set<string>();
    for (const path of overrides) preservedOverrides.add(path);
    if (!same(before.footprint, after.footprint)) {
      const merged = mergeTemplateValue(
        before.footprint,
        after.footprint,
        instance.footprint,
        "footprint",
        overrides,
        preservedOverrides,
      );
      if (merged.applied && record(merged.value) && typeof merged.value.kind === "string")
        spatialEffects.push({ operation: "update_footprint", objectId: instance.id, footprint: merged.value });
    }
    const beforeMetadata = metadataFor(before);
    const afterMetadata = metadataFor(after);
    const values: Record<string, unknown> = {};
    const instanceMetadata = metadataFor(instance);
    for (const key of [...new Set([...Object.keys(beforeMetadata), ...Object.keys(afterMetadata)])].sort()) {
      if (same(beforeMetadata[key], afterMetadata[key])) continue;
      const merged = mergeTemplateValue(
        beforeMetadata[key],
        afterMetadata[key],
        instanceMetadata[key],
        key,
        overrides,
        preservedOverrides,
      );
      if (merged.applied) values[key] = merged.value;
    }
    proposalOverrides.push(
      ...[...preservedOverrides].map((path) => ({ projectObjectId: instance.id, templateObjectId, path })),
    );
    if (spatialEffects.length || Object.keys(values).length) {
      values.templateRef = { ...instance.templateRef, version: toVersion };
      spatialEffects.push({ operation: "update_metadata", objectId: instance.id, values });
    }
    if (spatialEffects.length) {
      const semantic = {
        templateId,
        fromVersion: binding.version,
        toVersion,
        templateObjectId,
        projectObjectId: instance.id,
        spatialEffects,
      };
      changes.push({
        id: stableFingerprint("chg", semantic),
        number: changes.length + 1,
        title: `Update ${instance.label}`,
        shortTitle: `${instance.label} ${toVersion}`,
        metrics: [["Template", `${binding.version} → ${toVersion}`]],
        targetObjectIds: [instance.id],
        spatialEffects,
        effects: { templateVersion: toVersion },
        templateUpdate: {
          templateId,
          templateObjectId,
          fromVersion: binding.version,
          toVersion,
          preservedOverrides: [...preservedOverrides].sort(),
        },
      });
    }
  }

  const proposalSeed = {
    planId: plan.id,
    baseVersion: plan.version,
    templateId,
    fromVersion: binding.version,
    toVersion,
    changeIds: changes.map((change) => change.id),
  };
  return {
    id: stableFingerprint("proposal-template", proposalSeed),
    revision: 1,
    baseVersion: plan.version,
    status: "review",
    goal: `Room template ${binding.version} → ${toVersion}`,
    changes,
    validation: null,
    waivers: [],
    templateUpdate: {
      kind: "room-template",
      templateId,
      fromVersion: binding.version,
      toVersion,
      actor,
      skipped,
      preservedOverrides: proposalOverrides.sort(
        (left, right) =>
          left.projectObjectId.localeCompare(right.projectObjectId) || left.path.localeCompare(right.path),
      ),
    },
  };
}

export function applyApprovedTemplateBinding(plan: VenuePlan, proposal: VenueProposal): VenuePlan {
  if (!proposal.templateUpdate) return plan;
  const update = proposal.templateUpdate;
  if (
    !("templateId" in update) ||
    typeof update.templateId !== "string" ||
    !("toVersion" in update) ||
    typeof update.toVersion !== "string"
  )
    return plan;
  return {
    ...plan,
    templateBindings: {
      ...(plan.templateBindings ?? {}),
      room: { ...(plan.templateBindings?.room ?? {}), templateId: update.templateId, version: update.toVersion },
    },
  };
}
