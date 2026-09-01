import { venueError } from "./errors.ts";

export const LOCK_TYPES = Object.freeze(["position", "rotation", "dimension", "deletion", "role"]);
export const LOCK_SOURCES = Object.freeze(["venue-template", "project"]);

const clone: any = (value: any) => JSON.parse(JSON.stringify(value));
const same: any = (left: any, right: any) => JSON.stringify(left) === JSON.stringify(right);

const assertLock: any = (value: any, objectId: any, expectedSource: any = null) => {
  const lock: any = { ...value, objectId: value?.objectId ?? objectId, active: value?.active ?? true };
  if (!lock.id || lock.objectId !== objectId || !LOCK_TYPES.includes(lock.type) || !LOCK_SOURCES.includes(lock.source)
    || (expectedSource && lock.source !== expectedSource) || !lock.reasonCode || !lock.authorId || typeof lock.active !== "boolean") {
    throw venueError("LOCK_CONFLICT", { objectId, lockId: lock.id ?? null }, `Invalid Lock metadata for object ${objectId}`);
  }
  if (lock.createdAt !== undefined && Number.isNaN(Date.parse(lock.createdAt))) throw venueError("LOCK_CONFLICT", { objectId, lockId: lock.id, field: "createdAt" }, `Invalid Lock timestamp for object ${objectId}`);
  if (lock.expiresAt !== undefined && lock.expiresAt !== null && Number.isNaN(Date.parse(lock.expiresAt))) throw venueError("LOCK_CONFLICT", { objectId, lockId: lock.id, field: "expiresAt" }, `Invalid Lock expiry for object ${objectId}`);
  return clone(lock);
};

export function normalizeObjectLocks(object: any, fallback: any = null) {
  const source: any = object.locks ?? fallback?.locks ?? [];
  if (!Array.isArray(source)) throw venueError("LOCK_CONFLICT", { objectId: object.id, field: "locks" }, `Object ${object.id} Locks must be an array`);
  const ids: any = new Set();
  const locks: any = source.map((value: any) => {
    const lock: any = assertLock(value, object.id);
    if (ids.has(lock.id)) throw venueError("LOCK_CONFLICT", { objectId: object.id, lockId: lock.id }, `Duplicate Lock ID for object ${object.id}`);
    ids.add(lock.id);
    return clone(lock);
  });
  return { ...object, locks, locked: locks.some((lock: any) => lock.active) };
}

export function normalizeProjectLocks(locks: any = [], plan: any = null) {
  if (!Array.isArray(locks)) throw venueError("LOCK_CONFLICT", { field: "projectLocks" }, "Project Locks must be an array");
  const objectIds: any = plan ? new Set((plan.objects ?? []).map((object: any) => object.id)) : null;
  const ids: any = new Set();
  return locks.map((value: any) => {
    const objectId: any = value?.objectId;
    if (!objectId || (objectIds && !objectIds.has(objectId))) throw venueError("LOCK_OBJECT_NOT_FOUND", { objectId: objectId ?? null });
    const lock: any = assertLock(value, objectId, "project");
    if (ids.has(lock.id)) throw venueError("LOCK_CONFLICT", { objectId, lockId: lock.id }, `Duplicate Project Lock ID: ${lock.id}`);
    ids.add(lock.id);
    return lock;
  }).sort((left: any, right: any) => left.objectId.localeCompare(right.objectId) || LOCK_TYPES.indexOf(left.type) - LOCK_TYPES.indexOf(right.type) || left.id.localeCompare(right.id));
}

const mutationTypes: any = (object: any, effect: any) => {
  if (effect.operation === "delete_object") return ["deletion"];
  if (effect.operation === "update_metadata") return Object.keys(effect.values ?? {}).length ? ["role"] : [];
  if (effect.operation !== "update_footprint") return [];
  const patch: any = effect.footprint ?? {};
  const current: any = object.footprint ?? {};
  const types: any[] = [];
  if (["center", "start", "end", "points"].some((key: any) => key in patch && !same(patch[key], current[key]))) types.push("position");
  if ("rotationDegrees" in patch && !same(patch.rotationDegrees, current.rotationDegrees)) types.push("rotation");
  if (["width", "depth", "radius"].some((key: any) => key in patch && !same(patch[key], current[key]))) types.push("dimension");
  return types;
};

export function detectLockConflicts(plan: any, changes: any = [], projectLocks: any = []) {
  const objects: any = new Map((plan.objects ?? []).map((object: any) => [object.id, normalizeObjectLocks(object)]));
  const normalizedProjectLocks: any = normalizeProjectLocks(projectLocks, plan);
  const conflicts: any[] = [];
  for (const change of changes) {
    const effectObjectIds: any = new Set((change.spatialEffects ?? []).map((effect: any) => effect.objectId));
    const effects: any = [
      ...(change.spatialEffects ?? []),
      ...(change.targetObjectIds ?? []).filter((objectId: any) => !effectObjectIds.has(objectId)).map((objectId: any) => ({ operation: "unspecified_mutation", objectId })),
    ];
    for (const effect of effects) {
      const object: any = objects.get(effect.objectId);
      if (!object) continue;
      const types: any = effect.operation === "unspecified_mutation" ? LOCK_TYPES : mutationTypes(object, effect);
      const locks: any = [...object.locks, ...normalizedProjectLocks.filter((lock: any) => lock.objectId === object.id)].filter((lock: any) => lock.active && types.includes(lock.type));
      for (const lock of locks) conflicts.push({ id: `lock-conflict-${change.id}-${lock.id}`, changeId: change.id, objectId: object.id, lockId: lock.id, lockType: lock.type, source: lock.source, operation: effect.operation });
    }
  }
  return conflicts.sort((left: any, right: any) => left.objectId.localeCompare(right.objectId)
    || LOCK_TYPES.indexOf(left.lockType) - LOCK_TYPES.indexOf(right.lockType)
    || left.changeId.localeCompare(right.changeId)
    || left.lockId.localeCompare(right.lockId));
}

export function assertNoLockConflicts(plan: any, changes: any = [], projectLocks: any = []) {
  const conflicts: any = detectLockConflicts(plan, changes, projectLocks);
  if (conflicts.length) throw venueError("LOCK_CONFLICT", { conflicts, objectIds: [...new Set(conflicts.map((conflict: any) => conflict.objectId))] });
  return conflicts;
}
