import { stableFingerprint } from "./activity-ledger.ts";
import { venueError } from "./errors.ts";
import { getRoomTemplate } from "./venue-templates.ts";

const clone: any = (value: any) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
const same: any = (left: any, right: any) => JSON.stringify(left) === JSON.stringify(right);
const overridden: any = (paths: any, path: any) => paths.some((item: any) => item === path || path.startsWith(`${item}.`) || item.startsWith(`${path}.`));
const record: any = (value: any) => value && typeof value === "object" && !Array.isArray(value);

const mergeTemplateValue: any = (before: any, after: any, current: any, path: any, overrides: any, preserved: any) => {
  if (same(before, after)) return { value: clone(current ?? after), applied: false };
  if (overrides.includes(path)) {
    preserved.add(path);
    return { value: clone(current), applied: false };
  }
  if (record(before) && record(after)) {
    const value: any = { ...(record(current) ? clone(current) : {}) };
    let applied: any = false;
    for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const childPath: any = `${path}.${key}`;
      const child: any = mergeTemplateValue(before[key], after[key], current?.[key], childPath, overrides, preserved);
      if (child.value === undefined) delete value[key];
      else value[key] = child.value;
      applied = applied || child.applied;
    }
    return { value, applied };
  }
  if (overridden(overrides, path)) {
    for (const item of overrides.filter((item: any) => item === path || item.startsWith(`${path}.`))) preserved.add(item);
    return { value: clone(current), applied: false };
  }
  return { value: clone(after), applied: true };
};

const metadataFor: any = (object: any) => Object.fromEntries(Object.entries(object).filter(([key]: any) => !["id", "footprint"].includes(key)));

export function createRoomTemplateUpdateProposal(plan: any, { templateId, toVersion, actor = "agent" }: any) {
  const binding: any = plan.templateBindings?.room;
  if (!binding || binding.templateId !== templateId) throw venueError("TEMPLATE_BINDING_NOT_FOUND", { templateId, planId: plan.id });
  if (binding.version === toVersion) throw venueError("TEMPLATE_VERSION_CURRENT", { templateId, version: toVersion });
  const fromTemplate: any = getRoomTemplate(templateId, binding.version);
  const toTemplate: any = getRoomTemplate(templateId, toVersion);
  const fromObjects: any = new Map(fromTemplate.objects.map((object: any) => [object.id, object]));
  const toObjects: any = new Map(toTemplate.objects.map((object: any) => [object.id, object]));
  const projectObjects: any = new Map((plan.objects ?? []).filter((object: any) => object.templateRef?.kind === "room-template" && object.templateRef.templateId === templateId).map((object: any) => [object.templateRef.templateObjectId, object]));
  const changes: any[] = [];
  const skipped: any[] = [];
  const proposalOverrides: any[] = [];

  for (const templateObjectId of [...new Set([...fromObjects.keys(), ...toObjects.keys()])].sort()) {
    const before: any = fromObjects.get(templateObjectId);
    const after: any = toObjects.get(templateObjectId);
    const instance: any = projectObjects.get(templateObjectId);
    if (!before || !after || !instance) {
      skipped.push({ templateObjectId, reason: !before ? "added-object-requires-placement" : !after ? "deleted-object-requires-review" : "unbound-project-instance" });
      continue;
    }
    if (same(before, after)) continue;
    const overrides: any = instance.templateOverrides ?? [];
    const spatialEffects: any[] = [];
    const preservedOverrides: any = new Set();
    for (const path of overrides) preservedOverrides.add(path);
    if (!same(before.footprint, after.footprint)) {
      const merged: any = mergeTemplateValue(before.footprint, after.footprint, instance.footprint, "footprint", overrides, preservedOverrides);
      if (merged.applied) spatialEffects.push({ operation: "update_footprint", objectId: instance.id, footprint: merged.value });
    }
    const beforeMetadata: any = metadataFor(before);
    const afterMetadata: any = metadataFor(after);
    const values: Record<string, any> = {};
    for (const key of [...new Set([...Object.keys(beforeMetadata), ...Object.keys(afterMetadata)])].sort()) {
      if (same(beforeMetadata[key], afterMetadata[key])) continue;
      const merged: any = mergeTemplateValue(beforeMetadata[key], afterMetadata[key], instance[key], key, overrides, preservedOverrides);
      if (merged.applied) values[key] = merged.value;
    }
    proposalOverrides.push(...[...preservedOverrides].map((path: any) => ({ projectObjectId: instance.id, templateObjectId, path })));
    if (spatialEffects.length || Object.keys(values).length) {
      values.templateRef = { ...instance.templateRef, version: toVersion };
      spatialEffects.push({ operation: "update_metadata", objectId: instance.id, values });
    }
    if (spatialEffects.length) {
      const semantic: any = { templateId, fromVersion: binding.version, toVersion, templateObjectId, projectObjectId: instance.id, spatialEffects };
      changes.push({
        id: stableFingerprint("chg", semantic),
        number: changes.length + 1,
        title: `Update ${instance.label}`,
        shortTitle: `${instance.label} ${toVersion}`,
        metrics: [["Template", `${binding.version} → ${toVersion}`]],
        targetObjectIds: [instance.id],
        spatialEffects,
        effects: { templateVersion: toVersion },
        templateUpdate: { templateId, templateObjectId, fromVersion: binding.version, toVersion, preservedOverrides: [...preservedOverrides].sort() },
      });
    }
  }

  const proposalSeed: any = { planId: plan.id, baseVersion: plan.version, templateId, fromVersion: binding.version, toVersion, changeIds: changes.map((change: any) => change.id) };
  return {
    id: stableFingerprint("proposal-template", proposalSeed),
    revision: 1,
    baseVersion: plan.version,
    status: "review",
    goal: `Room template ${binding.version} → ${toVersion}`,
    changes,
    validation: null,
    waivers: [],
    templateUpdate: { kind: "room-template", templateId, fromVersion: binding.version, toVersion, actor, skipped, preservedOverrides: proposalOverrides.sort((left: any, right: any) => left.projectObjectId.localeCompare(right.projectObjectId) || left.path.localeCompare(right.path)) },
  };
}

export function applyApprovedTemplateBinding(plan: any, proposal: any) {
  if (!proposal.templateUpdate) return plan;
  const update: any = proposal.templateUpdate;
  return {
    ...plan,
    templateBindings: {
      ...(plan.templateBindings ?? {}),
      room: { ...(plan.templateBindings?.room ?? {}), templateId: update.templateId, version: update.toVersion },
    },
  };
}
