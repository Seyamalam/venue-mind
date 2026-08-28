import { venueError } from "./errors.js";

export const LOCK_TYPES = Object.freeze(["position", "rotation", "dimension", "deletion", "role"]);
export const LOCK_SOURCES = Object.freeze(["venue-template", "project"]);

const clone = (value) => JSON.parse(JSON.stringify(value));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const legacyLocks = (objectId) => LOCK_TYPES.map((type) => ({
  id: `lock-${objectId}-${type}`,
  objectId,
  type,
  source: "venue-template",
  reasonCode: "legacy-protected",
  authorId: "venue-template",
  active: true,
}));

const assertLock = (value, objectId, expectedSource = null) => {
  const lock = { ...value, objectId: value?.objectId ?? objectId, active: value?.active ?? true };
  if (!lock.id || lock.objectId !== objectId || !LOCK_TYPES.includes(lock.type) || !LOCK_SOURCES.includes(lock.source)
    || (expectedSource && lock.source !== expectedSource) || !lock.reasonCode || !lock.authorId || typeof lock.active !== "boolean") {
    throw venueError("LOCK_CONFLICT", { objectId, lockId: lock.id ?? null }, `Invalid Lock metadata for object ${objectId}`);
  }
  if (lock.createdAt !== undefined && Number.isNaN(Date.parse(lock.createdAt))) throw venueError("LOCK_CONFLICT", { objectId, lockId: lock.id, field: "createdAt" }, `Invalid Lock timestamp for object ${objectId}`);
  if (lock.expiresAt !== undefined && lock.expiresAt !== null && Number.isNaN(Date.parse(lock.expiresAt))) throw venueError("LOCK_CONFLICT", { objectId, lockId: lock.id, field: "expiresAt" }, `Invalid Lock expiry for object ${objectId}`);
  return clone(lock);
};

export function normalizeObjectLocks(object, fallback = null) {
  const source = object.locks ?? fallback?.locks ?? ((object.locked ?? fallback?.locked) ? legacyLocks(object.id) : []);
  if (!Array.isArray(source)) throw venueError("LOCK_CONFLICT", { objectId: object.id, field: "locks" }, `Object ${object.id} Locks must be an array`);
  const ids = new Set();
  const locks = source.map((value) => {
    const lock = assertLock(value, object.id);
    if (ids.has(lock.id)) throw venueError("LOCK_CONFLICT", { objectId: object.id, lockId: lock.id }, `Duplicate Lock ID for object ${object.id}`);
    ids.add(lock.id);
    return clone(lock);
  });
  return { ...object, locks, locked: locks.some((lock) => lock.active) };
}

export function normalizeProjectLocks(locks = [], plan = null) {
  if (!Array.isArray(locks)) throw venueError("LOCK_CONFLICT", { field: "projectLocks" }, "Project Locks must be an array");
  const objectIds = plan ? new Set((plan.objects ?? []).map((object) => object.id)) : null;
  const ids = new Set();
  return locks.map((value) => {
    const objectId = value?.objectId;
    if (!objectId || (objectIds && !objectIds.has(objectId))) throw venueError("LOCK_OBJECT_NOT_FOUND", { objectId: objectId ?? null });
    const lock = assertLock(value, objectId, "project");
    if (ids.has(lock.id)) throw venueError("LOCK_CONFLICT", { objectId, lockId: lock.id }, `Duplicate Project Lock ID: ${lock.id}`);
    ids.add(lock.id);
    return lock;
  }).sort((left, right) => left.objectId.localeCompare(right.objectId) || LOCK_TYPES.indexOf(left.type) - LOCK_TYPES.indexOf(right.type) || left.id.localeCompare(right.id));
}

const mutationTypes = (object, effect) => {
  if (effect.operation === "delete_object") return ["deletion"];
  if (effect.operation === "update_metadata") return Object.keys(effect.values ?? {}).length ? ["role"] : [];
  if (effect.operation !== "update_footprint") return [];
  const patch = effect.footprint ?? {};
  const current = object.footprint ?? {};
  const types = [];
  if (["center", "start", "end", "points"].some((key) => key in patch && !same(patch[key], current[key]))) types.push("position");
  if ("rotationDegrees" in patch && !same(patch.rotationDegrees, current.rotationDegrees)) types.push("rotation");
  if (["width", "depth", "radius"].some((key) => key in patch && !same(patch[key], current[key]))) types.push("dimension");
  return types;
};

export function detectLockConflicts(plan, changes = [], projectLocks = []) {
  const objects = new Map((plan.objects ?? []).map((object) => [object.id, normalizeObjectLocks(object)]));
  const normalizedProjectLocks = normalizeProjectLocks(projectLocks, plan);
  const conflicts = [];
  for (const change of changes) {
    const effectObjectIds = new Set((change.spatialEffects ?? []).map((effect) => effect.objectId));
    const effects = [
      ...(change.spatialEffects ?? []),
      ...(change.targetObjectIds ?? []).filter((objectId) => !effectObjectIds.has(objectId)).map((objectId) => ({ operation: "unspecified_mutation", objectId })),
    ];
    for (const effect of effects) {
      const object = objects.get(effect.objectId);
      if (!object) continue;
      const types = effect.operation === "unspecified_mutation" ? LOCK_TYPES : mutationTypes(object, effect);
      const locks = [...object.locks, ...normalizedProjectLocks.filter((lock) => lock.objectId === object.id)].filter((lock) => lock.active && types.includes(lock.type));
      for (const lock of locks) conflicts.push({ id: `lock-conflict-${change.id}-${lock.id}`, changeId: change.id, objectId: object.id, lockId: lock.id, lockType: lock.type, source: lock.source, operation: effect.operation });
    }
  }
  return conflicts.sort((left, right) => left.objectId.localeCompare(right.objectId)
    || LOCK_TYPES.indexOf(left.lockType) - LOCK_TYPES.indexOf(right.lockType)
    || left.changeId.localeCompare(right.changeId)
    || left.lockId.localeCompare(right.lockId));
}

export function assertNoLockConflicts(plan, changes = [], projectLocks = []) {
  const conflicts = detectLockConflicts(plan, changes, projectLocks);
  if (conflicts.length) throw venueError("LOCK_CONFLICT", { conflicts, objectIds: [...new Set(conflicts.map((conflict) => conflict.objectId))] });
  return conflicts;
}
