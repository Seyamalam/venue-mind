import { stableFingerprint } from "./activity-ledger.ts";
import { venueError } from "./errors.ts";
import type { Footprint, Point, RoomBoundary, VenueObject, VenuePlan } from "./geometry.ts";
import type { PlanningChange } from "./planning-effects.ts";
import type { SpatialMutation } from "./locks.ts";

export interface SnapProfile {
  enabled?: boolean;
  sizeM?: number;
  toleranceM?: number;
}
export type EditingOperation =
  | "apply-layout"
  | "move"
  | "rotate"
  | "resize"
  | "delete"
  | "group"
  | "ungroup"
  | "edit-zone-vertices"
  | "align"
  | "distribute"
  | "duplicate"
  | "paste"
  | "place"
  | "create-zone";
export interface EditingCommand {
  operation: EditingOperation;
  objectIds?: string[];
  label?: string;
  shortLabel?: string;
  metrics?: Array<[string, string]>;
  roomBoundary?: RoomBoundary;
  objects?: VenueObject[];
  object?: VenueObject;
  delta?: Point;
  snap?: SnapProfile;
  rotationDegrees?: number;
  dimensions?: { width?: number; depth?: number; radius?: number };
  groupId?: string;
  points?: Point[];
  axis?: "x" | "y";
  edge?: "min" | "max" | "center";
  value?: number;
  newObjectIds?: string[];
  labels?: string[];
  offset?: Point;
}

const clone = <T>(value: T): T => structuredClone(value);
const round = (value: number): number => Math.round(value * 1000) / 1000;

const centerOf = (footprint: Footprint): Point => {
  if (footprint.kind === "rectangle" || footprint.kind === "circle") return clone(footprint.center);
  if (footprint.kind === "line")
    return { x: (footprint.start.x + footprint.end.x) / 2, y: (footprint.start.y + footprint.end.y) / 2 };
  const points = footprint.points;
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
};

const translate = (footprint: Footprint, dx: number, dy: number): Footprint => {
  const point = ({ x, y }: Point): Point => ({ x: round(x + dx), y: round(y + dy) });
  if (footprint.kind === "rectangle" || footprint.kind === "circle")
    return { ...clone(footprint), center: point(footprint.center) };
  if (footprint.kind === "line")
    return { ...clone(footprint), start: point(footprint.start), end: point(footprint.end) };
  return { ...clone(footprint), points: footprint.points.map(point) };
};

const objectMap = (plan: VenuePlan): Map<string, VenueObject> =>
  new Map(plan.objects.map((object) => [object.id, object]));
const requireObjects = (plan: VenuePlan, objectIds: readonly string[] | undefined): VenueObject[] => {
  const byId = objectMap(plan);
  const objects = [...new Set(objectIds ?? [])].map((id) => byId.get(id));
  if (!objects.length || objects.some((object) => !object))
    throw venueError("SPATIAL_CHANGE_TARGET_MISSING", { objectIds: objectIds ?? [] });
  return objects.filter((object): object is VenueObject => object !== undefined);
};

export function snapCoordinate(
  value: number,
  { enabled = true, sizeM = 0.25, toleranceM = 0.08 }: SnapProfile = {},
): number {
  if (!enabled) return round(value);
  const target = Math.round(value / sizeM) * sizeM;
  return round(Math.abs(target - value) <= toleranceM ? target : value);
}

export const snapPoint = (point: Point, profile?: SnapProfile): Point => ({
  x: snapCoordinate(point.x, profile),
  y: snapCoordinate(point.y, profile),
});

const change = (
  edit: EditingCommand,
  targetObjectIds: string[],
  spatialEffects: SpatialMutation[],
  label: string,
): PlanningChange => {
  const semantic = { operation: edit.operation, targetObjectIds: [...targetObjectIds].sort(), spatialEffects };
  const displayLabel = edit.label?.trim() || label;
  return {
    id: stableFingerprint("chg", semantic),
    number: 0,
    title: displayLabel,
    shortTitle: edit.shortLabel?.trim() || displayLabel,
    metrics: clone(edit.metrics ?? []),
    targetObjectIds: [...targetObjectIds],
    spatialEffects,
    effects: { editorOperation: edit.operation },
    editor: { operation: edit.operation, input: clone(edit), fingerprint: stableFingerprint("edit", edit) },
  };
};

export function buildEditingChange(plan: VenuePlan, edit: EditingCommand): PlanningChange {
  if (!edit?.operation) throw venueError("COMMAND_INVALID", { field: "edit.operation" });
  const objects = ["place", "create-zone", "paste", "apply-layout"].includes(edit.operation)
    ? []
    : requireObjects(plan, edit.objectIds);

  if (edit.operation === "apply-layout") {
    if (!edit.roomBoundary?.outer?.length || !Array.isArray(edit.objects))
      throw venueError("COMMAND_INVALID", { field: "edit.roomBoundary" });
    const existing = new Set(plan.objects.map((object) => object.id));
    if (edit.objects.some((object) => !object.id || existing.has(object.id)))
      throw venueError("SPATIAL_CHANGE_TARGET_EXISTS", { objectIds: edit.objects.map((object) => object.id) });
    return change(
      edit,
      edit.objects.map((object) => object.id),
      [
        { operation: "update_room_boundary", roomBoundary: clone(edit.roomBoundary) },
        ...edit.objects.map((object) => ({ operation: "add_object", object: clone(object) })),
      ],
      `Layout ${edit.objects.length}`,
    );
  }

  if (edit.operation === "move") {
    const dx = Number(edit.delta?.x ?? 0);
    const dy = Number(edit.delta?.y ?? 0);
    const effects = objects.map((object) => {
      const moved = translate(object.footprint, dx, dy);
      if (moved.kind === "rectangle" || moved.kind === "circle") moved.center = snapPoint(moved.center, edit.snap);
      return { operation: "update_footprint", objectId: object.id, footprint: moved };
    });
    return change(
      edit,
      objects.map((object) => object.id),
      effects,
      `Move ${objects.length}`,
    );
  }

  if (edit.operation === "rotate") {
    const degrees = ((Number(edit.rotationDegrees) % 360) + 360) % 360;
    const effects: SpatialMutation[] = objects.map((object) => {
      if (object.footprint.kind !== "rectangle" && object.footprint.kind !== "polygon")
        throw venueError("COMMAND_INVALID", { field: "edit.rotationDegrees", objectId: object.id });
      return {
        operation: "update_footprint",
        objectId: object.id,
        footprint: { ...clone(object.footprint), rotationDegrees: degrees },
      };
    });
    return change(
      edit,
      objects.map((object) => object.id),
      effects,
      `Rotate ${objects.length}`,
    );
  }

  if (edit.operation === "resize") {
    const dimensions = Object.fromEntries(
      Object.entries(edit.dimensions ?? {})
        .filter(([key, value]) => ["width", "depth", "radius"].includes(key) && Number(value) > 0)
        .map(([key, value]) => [key, round(Number(value))]),
    );
    if (!Object.keys(dimensions).length) throw venueError("COMMAND_INVALID", { field: "edit.dimensions" });
    const effects: SpatialMutation[] = objects.map((object) => {
      const footprint = clone(object.footprint);
      if (footprint.kind === "circle" && typeof dimensions["radius"] === "number")
        footprint.radius = dimensions["radius"];
      if (footprint.kind === "rectangle") {
        if (typeof dimensions["width"] === "number") footprint.width = dimensions["width"];
        if (typeof dimensions["depth"] === "number") footprint.depth = dimensions["depth"];
      }
      if (footprint.kind === "line" && typeof dimensions["width"] === "number") footprint.width = dimensions["width"];
      return { operation: "update_footprint", objectId: object.id, footprint };
    });
    return change(
      edit,
      objects.map((object) => object.id),
      effects,
      `Resize ${objects.length}`,
    );
  }

  if (edit.operation === "delete")
    return change(
      edit,
      objects.map((object) => object.id),
      objects.map((object) => ({ operation: "delete_object", objectId: object.id })),
      `Delete ${objects.length}`,
    );

  if (["group", "ungroup"].includes(edit.operation)) {
    const groupId = edit.operation === "group" ? edit.groupId : null;
    if (edit.operation === "group" && !groupId) throw venueError("COMMAND_INVALID", { field: "edit.groupId" });
    const assignedGroupId = edit.operation === "group" && groupId ? groupId : null;
    return change(
      edit,
      objects.map((object) => object.id),
      objects.map((object) => ({
        operation: "update_metadata",
        objectId: object.id,
        values: { groupId: assignedGroupId },
      })),
      `${edit.operation === "group" ? "Group" : "Ungroup"} ${objects.length}`,
    );
  }

  if (edit.operation === "edit-zone-vertices") {
    const zone = objects[0];
    if (!zone) throw venueError("COMMAND_INVALID", { field: "edit.objectIds" });
    if (zone.kind !== "restricted_zone" || !Array.isArray(edit.points) || edit.points.length < 3)
      throw venueError("COMMAND_INVALID", { field: "edit.points" });
    return change(
      edit,
      [zone.id],
      [
        {
          operation: "update_footprint",
          objectId: zone.id,
          footprint: {
            kind: "polygon",
            points: edit.points.map((point) => snapPoint(point, edit.snap)),
            rotationDegrees: 0,
          },
        },
      ],
      "Edit zone",
    );
  }

  if (["align", "distribute"].includes(edit.operation)) {
    if (objects.length < 2) throw venueError("COMMAND_INVALID", { field: "edit.objectIds", minimum: 2 });
    const axis = edit.axis === "y" ? "y" : "x";
    const centers = objects.map((object) => ({ object, center: centerOf(object.footprint) }));
    let targets: Map<string, number>;
    if (edit.operation === "align") {
      const target =
        edit.value ??
        (edit.edge === "max"
          ? Math.max(...centers.map((item) => item.center[axis]))
          : edit.edge === "min"
            ? Math.min(...centers.map((item) => item.center[axis]))
            : centers.reduce((sum, item) => sum + item.center[axis], 0) / centers.length);
      targets = new Map(centers.map((item) => [item.object.id, target]));
    } else {
      const ordered = centers
        .slice()
        .sort((left, right) => left.center[axis] - right.center[axis] || left.object.id.localeCompare(right.object.id));
      const first = ordered[0];
      const last = ordered.at(-1);
      if (!first || !last) throw venueError("COMMAND_INVALID", { field: "edit.objectIds", minimum: 2 });
      const start = first.center[axis];
      const step = (last.center[axis] - start) / (ordered.length - 1);
      targets = new Map(ordered.map((item, index) => [item.object.id, start + step * index]));
    }
    const effects = centers.map((item) => {
      const target = targets.get(item.object.id);
      if (target === undefined) throw venueError("COMMAND_INVALID", { field: "edit.objectIds" });
      const delta = target - item.center[axis];
      return {
        operation: "update_footprint",
        objectId: item.object.id,
        footprint: translate(item.object.footprint, axis === "x" ? delta : 0, axis === "y" ? delta : 0),
      };
    });
    return change(
      edit,
      objects.map((object) => object.id),
      effects,
      `${edit.operation === "align" ? "Align" : "Distribute"} ${objects.length}`,
    );
  }

  if (["duplicate", "paste"].includes(edit.operation)) {
    const sourceObjects = edit.operation === "paste" ? clone(edit.objects ?? []) : objects;
    const newObjectIds = edit.newObjectIds ?? [];
    if (!sourceObjects.length || newObjectIds.length !== sourceObjects.length)
      throw venueError("COMMAND_INVALID", { field: "edit.newObjectIds" });
    const existing = new Set(plan.objects.map((object) => object.id));
    const added = sourceObjects.map((object, index) => {
      const newObjectId = newObjectIds[index];
      if (!newObjectId) throw venueError("COMMAND_INVALID", { field: "edit.newObjectIds" });
      if (existing.has(newObjectId)) throw venueError("SPATIAL_CHANGE_TARGET_EXISTS", { objectId: newObjectId });
      return {
        ...clone(object),
        id: newObjectId,
        label: edit.labels?.[index] ?? `${object.label ?? object.kind} copy`,
        locked: false,
        locks: [],
        footprint: translate(object.footprint, edit.offset?.x ?? 0.5, edit.offset?.y ?? 0.5),
        ...(object.templateRef ? { templateRef: clone(object.templateRef) } : {}),
      };
    });
    return change(
      edit,
      added.map((object) => object.id),
      added.map((object) => ({ operation: "add_object", object })),
      `${edit.operation === "paste" ? "Paste" : "Duplicate"} ${added.length}`,
    );
  }

  if (["place", "create-zone"].includes(edit.operation)) {
    const object = edit.object ? clone(edit.object) : null;
    if (!object?.id || plan.objects.some((item) => item.id === object.id))
      throw venueError("SPATIAL_CHANGE_TARGET_EXISTS", { objectId: object?.id ?? null });
    if (edit.operation === "create-zone") {
      object.kind = "restricted_zone";
      object.layer = "safety";
      object.restriction = object.restriction ?? {
        access: "conditional",
        reasonCode: "project-zone",
        blocksPlacement: true,
      };
    }
    return change(
      edit,
      [object.id],
      [{ operation: "add_object", object }],
      edit.operation === "create-zone" ? "Create zone" : `Place ${object.label ?? "object"}`,
    );
  }

  throw venueError("COMMAND_UNSUPPORTED", { editorOperation: edit.operation });
}

export function measureObjects(
  plan: VenuePlan,
  objectIds: readonly string[],
): {
  objectIds: string[];
  centers: Array<{ objectId: string; point: Point }>;
  distances: Array<{ fromObjectId: string; toObjectId: string; distanceM: number }>;
} {
  const objects = requireObjects(plan, objectIds);
  const centers = objects.map((object) => ({ objectId: object.id, point: centerOf(object.footprint) }));
  const distances: Array<{ fromObjectId: string; toObjectId: string; distanceM: number }> = [];
  for (let index = 0; index < centers.length; index += 1)
    for (let next = index + 1; next < centers.length; next += 1) {
      const from = centers[index];
      const to = centers[next];
      if (!from || !to) continue;
      const dx = to.point.x - from.point.x;
      const dy = to.point.y - from.point.y;
      distances.push({ fromObjectId: from.objectId, toObjectId: to.objectId, distanceM: round(Math.hypot(dx, dy)) });
    }
  return { objectIds: objects.map((object) => object.id), centers, distances };
}
