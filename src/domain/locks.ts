import { venueError } from "./errors.ts";
import type { Footprint, RoomBoundary, VenueObject } from "./geometry.ts";

export const LOCK_TYPES = Object.freeze(["position", "rotation", "dimension", "deletion", "role"] as const);
export const LOCK_SOURCES = Object.freeze(["venue-template", "project"] as const);

export type LockType = (typeof LOCK_TYPES)[number];
export type LockSource = (typeof LOCK_SOURCES)[number];
export interface ObjectLock {
  id: string;
  objectId: string;
  type: LockType;
  source: LockSource;
  reasonCode: string;
  authorId: string;
  active: boolean;
  createdAt?: string;
  expiresAt?: string | null;
}
export type FootprintPatch = Partial<Footprint>;
export interface LockableObject {
  id: string;
  footprint?: FootprintPatch;
  locks?: ObjectLock[];
  locked?: boolean;
}
export interface LockablePlan {
  objects?: LockableObject[];
}
export interface SpatialMutation {
  operation: string;
  objectId?: string;
  object?: VenueObject;
  roomBoundary?: RoomBoundary;
  values?: Partial<VenueObject>;
  footprint?: FootprintPatch;
}
export interface LockAwareChange {
  id: string;
  targetObjectIds?: string[];
  spatialEffects?: SpatialMutation[];
}

interface RawLock extends Record<string, unknown> {
  id?: unknown;
  objectId?: unknown;
  type?: unknown;
  source?: unknown;
  reasonCode?: unknown;
  authorId?: unknown;
  active?: unknown;
  createdAt?: unknown;
  expiresAt?: unknown;
}
const isRecord = (input: unknown): input is RawLock =>
  Boolean(input) && typeof input === "object" && !Array.isArray(input);

const clone = <T>(value: T): T => structuredClone(value);
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);
const isLockType = (value: unknown): value is LockType =>
  value === "position" || value === "rotation" || value === "dimension" || value === "deletion" || value === "role";
const isLockSource = (value: unknown): value is LockSource => value === "venue-template" || value === "project";

const assertLock = (value: unknown, objectId: string, expectedSource: LockSource | null = null): ObjectLock => {
  if (!isRecord(value)) throw venueError("LOCK_CONFLICT", { objectId }, `Invalid Lock metadata for object ${objectId}`);
  const id = value.id;
  const targetObjectId = value.objectId ?? objectId;
  const type = value.type;
  const source = value.source;
  const reasonCode = value.reasonCode;
  const authorId = value.authorId;
  const active = value.active ?? true;
  const createdAt = value.createdAt;
  const expiresAt = value.expiresAt;
  if (
    typeof id !== "string" ||
    targetObjectId !== objectId ||
    typeof type !== "string" ||
    !(LOCK_TYPES as readonly string[]).includes(type) ||
    typeof source !== "string" ||
    !(LOCK_SOURCES as readonly string[]).includes(source) ||
    (expectedSource && source !== expectedSource) ||
    typeof reasonCode !== "string" ||
    !reasonCode ||
    typeof authorId !== "string" ||
    !authorId ||
    typeof active !== "boolean"
  ) {
    throw venueError(
      "LOCK_CONFLICT",
      { objectId, lockId: typeof id === "string" ? id : null },
      `Invalid Lock metadata for object ${objectId}`,
    );
  }
  if (createdAt !== undefined && typeof createdAt !== "string")
    throw venueError("LOCK_CONFLICT", { objectId, lockId: id, field: "createdAt" });
  if (expiresAt !== undefined && expiresAt !== null && typeof expiresAt !== "string")
    throw venueError("LOCK_CONFLICT", { objectId, lockId: id, field: "expiresAt" });
  if (createdAt !== undefined && Number.isNaN(Date.parse(createdAt)))
    throw venueError(
      "LOCK_CONFLICT",
      { objectId, lockId: id, field: "createdAt" },
      `Invalid Lock timestamp for object ${objectId}`,
    );
  if (expiresAt !== undefined && expiresAt !== null && Number.isNaN(Date.parse(expiresAt)))
    throw venueError(
      "LOCK_CONFLICT",
      { objectId, lockId: id, field: "expiresAt" },
      `Invalid Lock expiry for object ${objectId}`,
    );
  if (!isLockType(type) || !isLockSource(source)) throw venueError("LOCK_CONFLICT", { objectId, lockId: id });
  return clone({
    id,
    objectId,
    type,
    source,
    reasonCode,
    authorId,
    active,
    ...(createdAt ? { createdAt } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  });
};

export function normalizeObjectLocks<T extends LockableObject>(
  object: T,
  fallback: LockableObject | null = null,
): T & { locks: ObjectLock[]; locked: boolean } {
  const source = object.locks ?? fallback?.locks ?? [];
  if (!Array.isArray(source))
    throw venueError(
      "LOCK_CONFLICT",
      { objectId: object.id, field: "locks" },
      `Object ${object.id} Locks must be an array`,
    );
  const ids = new Set();
  const locks = source.map((value) => {
    const lock = assertLock(value, object.id);
    if (ids.has(lock.id))
      throw venueError(
        "LOCK_CONFLICT",
        { objectId: object.id, lockId: lock.id },
        `Duplicate Lock ID for object ${object.id}`,
      );
    ids.add(lock.id);
    return clone(lock);
  });
  return { ...object, locks, locked: locks.some((lock) => lock.active) };
}

export function normalizeProjectLocks(locks: readonly unknown[] = [], plan: LockablePlan | null = null): ObjectLock[] {
  if (!Array.isArray(locks))
    throw venueError("LOCK_CONFLICT", { field: "projectLocks" }, "Project Locks must be an array");
  const objectIds = plan ? new Set((plan.objects ?? []).map((object) => object.id)) : null;
  const ids = new Set();
  return locks
    .map((value) => {
      const objectId = isRecord(value) && typeof value.objectId === "string" ? value.objectId : null;
      if (!objectId || (objectIds && !objectIds.has(objectId)))
        throw venueError("LOCK_OBJECT_NOT_FOUND", { objectId: objectId ?? null });
      const lock = assertLock(value, objectId, "project");
      if (ids.has(lock.id))
        throw venueError("LOCK_CONFLICT", { objectId, lockId: lock.id }, `Duplicate Project Lock ID: ${lock.id}`);
      ids.add(lock.id);
      return lock;
    })
    .sort(
      (left, right) =>
        left.objectId.localeCompare(right.objectId) ||
        LOCK_TYPES.indexOf(left.type) - LOCK_TYPES.indexOf(right.type) ||
        left.id.localeCompare(right.id),
    );
}

const mutationTypes = (object: LockableObject, effect: SpatialMutation): LockType[] => {
  if (effect.operation === "delete_object") return ["deletion"];
  if (effect.operation === "update_metadata") return Object.keys(effect.values ?? {}).length ? ["role"] : [];
  if (effect.operation !== "update_footprint") return [];
  const patch = effect.footprint ?? {};
  const current = object.footprint ?? {};
  const types: LockType[] = [];
  if ("center" in patch && (!("center" in current) || !same(patch.center, current.center))) types.push("position");
  if ("start" in patch && (!("start" in current) || !same(patch.start, current.start))) types.push("position");
  if ("points" in patch && (!("points" in current) || !same(patch.points, current.points))) types.push("position");
  if (
    "rotationDegrees" in patch &&
    (!("rotationDegrees" in current) || !same(patch.rotationDegrees, current.rotationDegrees))
  )
    types.push("rotation");
  if (
    ("width" in patch && (!("width" in current) || !same(patch.width, current.width))) ||
    ("depth" in patch && (!("depth" in current) || !same(patch.depth, current.depth))) ||
    ("radius" in patch && (!("radius" in current) || !same(patch.radius, current.radius)))
  )
    types.push("dimension");
  return types;
};

export function detectLockConflicts(
  plan: LockablePlan,
  changes: readonly LockAwareChange[] = [],
  projectLocks: readonly unknown[] = [],
) {
  const objects = new Map((plan.objects ?? []).map((object) => [object.id, normalizeObjectLocks(object)]));
  const normalizedProjectLocks = normalizeProjectLocks(projectLocks, plan);
  const conflicts: Array<{
    id: string;
    changeId: string;
    objectId: string;
    lockId: string;
    lockType: LockType;
    source: LockSource;
    operation: string;
  }> = [];
  for (const change of changes) {
    const effectObjectIds = new Set(
      (change.spatialEffects ?? [])
        .map((effect) => effect.objectId)
        .filter((id): id is string => typeof id === "string"),
    );
    const effects = [
      ...(change.spatialEffects ?? []),
      ...(change.targetObjectIds ?? [])
        .filter((objectId) => !effectObjectIds.has(objectId))
        .map((objectId) => ({ operation: "unspecified_mutation", objectId })),
    ];
    for (const effect of effects) {
      if (!effect.objectId) continue;
      const object = objects.get(effect.objectId);
      if (!object) continue;
      const types = effect.operation === "unspecified_mutation" ? LOCK_TYPES : mutationTypes(object, effect);
      const locks = [...object.locks, ...normalizedProjectLocks.filter((lock) => lock.objectId === object.id)].filter(
        (lock) => lock.active && types.includes(lock.type),
      );
      for (const lock of locks)
        conflicts.push({
          id: `lock-conflict-${change.id}-${lock.id}`,
          changeId: change.id,
          objectId: object.id,
          lockId: lock.id,
          lockType: lock.type,
          source: lock.source,
          operation: effect.operation,
        });
    }
  }
  return conflicts.sort(
    (left, right) =>
      left.objectId.localeCompare(right.objectId) ||
      LOCK_TYPES.indexOf(left.lockType) - LOCK_TYPES.indexOf(right.lockType) ||
      left.changeId.localeCompare(right.changeId) ||
      left.lockId.localeCompare(right.lockId),
  );
}

export function assertNoLockConflicts(
  plan: LockablePlan,
  changes: readonly LockAwareChange[] = [],
  projectLocks: readonly unknown[] = [],
) {
  const conflicts = detectLockConflicts(plan, changes, projectLocks);
  if (conflicts.length)
    throw venueError("LOCK_CONFLICT", {
      conflicts,
      objectIds: [...new Set(conflicts.map((conflict) => conflict.objectId))],
    });
  return conflicts;
}
