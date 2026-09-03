import { venueError } from "../src/domain/errors.ts";
import type { Footprint, Point, SpatialLayer, VenueObject } from "../src/domain/geometry.ts";
import type { FootprintPatch, SpatialMutation } from "../src/domain/locks.ts";
import type {
  CreatePostEventDeviationProposalCommand,
  DeviationLocationInput,
  EndLivePlanDeviationCommand,
  RecordLivePlanDeviationCommand,
} from "../src/domain/operational-types.ts";
import type { PlanningChange } from "../src/domain/planning-effects.ts";

type TrustedDeviationCommand =
  | RecordLivePlanDeviationCommand
  | EndLivePlanDeviationCommand
  | CreatePostEventDeviationProposalCommand;
export interface TrustedDeviationIdentity {
  readonly actorId: string;
  readonly sessionId: string;
  readonly committedAt: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const invalid = (reason: string, field?: string): never => {
  throw venueError("DEVIATION_INVALID", { reason, ...(field ? { field } : {}) });
};
const exact = (value: unknown, allowed: readonly string[], field: string): Record<string, unknown> => {
  if (!isRecord(value)) return invalid("object-required", field);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unexpected.length) return invalid("unknown-fields", field);
  return value;
};
const string = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) return invalid("field-required", field);
  return value.trim();
};
const integer = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    return invalid("non-negative-integer-required", field);
  return value;
};
const finite = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return invalid("finite-number-required", field);
  return value;
};
const boolean = (value: unknown, field: string): boolean => {
  if (typeof value !== "boolean") return invalid("boolean-required", field);
  return value;
};
const strings = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value)) return invalid("list-required", field);
  return value.map((item, index) => string(item, `${field}[${index}]`));
};
const point = (value: unknown, field: string): Point => {
  const record = exact(value, ["x", "y"], field);
  return { x: finite(record["x"], `${field}.x`), y: finite(record["y"], `${field}.y`) };
};
const points = (value: unknown, field: string): Point[] => {
  if (!Array.isArray(value)) return invalid("point-list-required", field);
  return value.map((item, index) => point(item, `${field}[${index}]`));
};

const footprint = (value: unknown, field: string): Footprint => {
  const record = exact(
    value,
    ["kind", "center", "width", "depth", "rotationDegrees", "radius", "start", "end", "points"],
    field,
  );
  if (record["kind"] === "rectangle")
    return {
      kind: "rectangle",
      center: point(record["center"], `${field}.center`),
      width: finite(record["width"], `${field}.width`),
      depth: finite(record["depth"], `${field}.depth`),
      rotationDegrees: finite(record["rotationDegrees"], `${field}.rotationDegrees`),
    };
  if (record["kind"] === "circle")
    return {
      kind: "circle",
      center: point(record["center"], `${field}.center`),
      radius: finite(record["radius"], `${field}.radius`),
    };
  if (record["kind"] === "line")
    return {
      kind: "line",
      start: point(record["start"], `${field}.start`),
      end: point(record["end"], `${field}.end`),
      width: finite(record["width"], `${field}.width`),
    };
  if (record["kind"] === "polygon")
    return {
      kind: "polygon",
      points: points(record["points"], `${field}.points`),
      rotationDegrees: finite(record["rotationDegrees"], `${field}.rotationDegrees`),
    };
  return invalid("footprint-kind-invalid", `${field}.kind`);
};

const footprintPatch = (value: unknown, field: string): FootprintPatch => {
  const record = exact(
    value,
    ["kind", "center", "width", "depth", "rotationDegrees", "radius", "start", "end", "points"],
    field,
  );
  const kind = record["kind"];
  if (kind !== undefined && kind !== "rectangle" && kind !== "circle" && kind !== "line" && kind !== "polygon")
    return invalid("footprint-kind-invalid", `${field}.kind`);
  const parsed: Record<string, unknown> = {};
  if (kind !== undefined) parsed["kind"] = kind;
  if (record["center"] !== undefined) parsed["center"] = point(record["center"], `${field}.center`);
  if (record["start"] !== undefined) parsed["start"] = point(record["start"], `${field}.start`);
  if (record["end"] !== undefined) parsed["end"] = point(record["end"], `${field}.end`);
  if (record["points"] !== undefined) parsed["points"] = points(record["points"], `${field}.points`);
  for (const key of ["width", "depth", "rotationDegrees", "radius"] as const)
    if (record[key] !== undefined) parsed[key] = finite(record[key], `${field}.${key}`);
  return parsed;
};

const spatialLayers: readonly SpatialLayer[] = [
  "architecture",
  "furniture",
  "access",
  "production",
  "catering",
  "safety",
  "annotations",
];
const layer = (value: unknown, field: string): SpatialLayer => {
  const result = spatialLayers.find((candidate) => candidate === value);
  return result ?? invalid("spatial-layer-invalid", field);
};
const stringOrUndefined = (value: unknown, field: string): string | undefined =>
  value === undefined ? undefined : string(value, field);
const numberOrUndefined = (value: unknown, field: string): number | undefined =>
  value === undefined ? undefined : finite(value, field);
const booleanOrUndefined = (value: unknown, field: string): boolean | undefined =>
  value === undefined ? undefined : boolean(value, field);

const circulation = (value: unknown, field: string): NonNullable<VenueObject["circulation"]> => {
  const record = exact(
    value,
    [
      "role",
      "capacityPersonsPerMinute",
      "capacityPersons",
      "demandPersons",
      "clearWidthM",
      "carCapacityPersons",
      "cycleSeconds",
      "servesZoneIds",
      "blocksPath",
      "blocksExitApproach",
    ],
    field,
  );
  const role = record["role"];
  if (role !== undefined && role !== "queue" && role !== "checkpoint") return invalid("circulation-role-invalid", field);
  return {
    ...(role === undefined ? {} : { role }),
    ...Object.fromEntries(
      [
        "capacityPersonsPerMinute",
        "capacityPersons",
        "demandPersons",
        "clearWidthM",
        "carCapacityPersons",
        "cycleSeconds",
      ].flatMap((key) => {
        const result = numberOrUndefined(record[key], `${field}.${key}`);
        return result === undefined ? [] : [[key, result]];
      }),
    ),
    ...(record["servesZoneIds"] === undefined
      ? {}
      : { servesZoneIds: strings(record["servesZoneIds"], `${field}.servesZoneIds`) }),
    ...(record["blocksPath"] === undefined
      ? {}
      : { blocksPath: boolean(record["blocksPath"], `${field}.blocksPath`) }),
    ...(record["blocksExitApproach"] === undefined
      ? {}
      : { blocksExitApproach: boolean(record["blocksExitApproach"], `${field}.blocksExitApproach`) }),
  };
};
const route = (value: unknown, field: string): NonNullable<VenueObject["route"]> => {
  const record = exact(value, ["direction", "accessible", "purpose", "staffOnly"], field);
  if (record["direction"] !== "one-way" && record["direction"] !== "bidirectional")
    return invalid("route-direction-invalid", `${field}.direction`);
  return {
    direction: record["direction"],
    accessible: boolean(record["accessible"], `${field}.accessible`),
    purpose: string(record["purpose"], `${field}.purpose`),
    ...(record["staffOnly"] === undefined ? {} : { staffOnly: boolean(record["staffOnly"], `${field}.staffOnly`) }),
  };
};
const restriction = (value: unknown, field: string): NonNullable<VenueObject["restriction"]> => {
  const record = exact(value, ["access", "reasonCode", "blocksPlacement"], field);
  if (record["access"] !== "prohibited" && record["access"] !== "staff-only" && record["access"] !== "conditional")
    return invalid("restriction-access-invalid", `${field}.access`);
  return {
    access: record["access"],
    reasonCode: string(record["reasonCode"], `${field}.reasonCode`),
    blocksPlacement: boolean(record["blocksPlacement"], `${field}.blocksPlacement`),
  };
};
const exit = (value: unknown, field: string): NonNullable<VenueObject["exit"]> => {
  const record = exact(value, ["clearWidthM", "emergency", "capacityPersons"], field);
  return {
    clearWidthM: finite(record["clearWidthM"], `${field}.clearWidthM`),
    emergency: boolean(record["emergency"], `${field}.emergency`),
    capacityPersons: finite(record["capacityPersons"], `${field}.capacityPersons`),
  };
};
const emergency = (value: unknown, field: string): NonNullable<VenueObject["emergency"]> => {
  const record = exact(
    value,
    [
      "type",
      "capacityPersons",
      "designatedExitObjectIds",
      "responderOnly",
      "equipmentClass",
      "coverageRadiusM",
      "clearanceM",
      "accessible",
      "backupPowerMinutes",
      "powerSourceCircuitId",
    ],
    field,
  );
  return {
    type: string(record["type"], `${field}.type`),
    ...(numberOrUndefined(record["capacityPersons"], `${field}.capacityPersons`) === undefined
      ? {}
      : { capacityPersons: finite(record["capacityPersons"], `${field}.capacityPersons`) }),
    ...(record["designatedExitObjectIds"] === undefined
      ? {}
      : { designatedExitObjectIds: strings(record["designatedExitObjectIds"], `${field}.designatedExitObjectIds`) }),
    ...(booleanOrUndefined(record["responderOnly"], `${field}.responderOnly`) === undefined
      ? {}
      : { responderOnly: boolean(record["responderOnly"], `${field}.responderOnly`) }),
    ...(stringOrUndefined(record["equipmentClass"], `${field}.equipmentClass`) === undefined
      ? {}
      : { equipmentClass: string(record["equipmentClass"], `${field}.equipmentClass`) }),
    ...(numberOrUndefined(record["coverageRadiusM"], `${field}.coverageRadiusM`) === undefined
      ? {}
      : { coverageRadiusM: finite(record["coverageRadiusM"], `${field}.coverageRadiusM`) }),
    ...(numberOrUndefined(record["clearanceM"], `${field}.clearanceM`) === undefined
      ? {}
      : { clearanceM: finite(record["clearanceM"], `${field}.clearanceM`) }),
    ...(booleanOrUndefined(record["accessible"], `${field}.accessible`) === undefined
      ? {}
      : { accessible: boolean(record["accessible"], `${field}.accessible`) }),
    ...(numberOrUndefined(record["backupPowerMinutes"], `${field}.backupPowerMinutes`) === undefined
      ? {}
      : { backupPowerMinutes: finite(record["backupPowerMinutes"], `${field}.backupPowerMinutes`) }),
    ...(stringOrUndefined(record["powerSourceCircuitId"], `${field}.powerSourceCircuitId`) === undefined
      ? {}
      : { powerSourceCircuitId: string(record["powerSourceCircuitId"], `${field}.powerSourceCircuitId`) }),
  };
};
const occupancy = (value: unknown, field: string): NonNullable<VenueObject["occupancy"]> => {
  const record = exact(
    value,
    ["expected", "maximum", "minimumCapacity", "maximumCapacity", "zoneId", "excludesUsableArea"],
    field,
  );
  const zoneId = record["zoneId"];
  if (zoneId !== undefined && zoneId !== null && typeof zoneId !== "string") return invalid("zone-id-invalid", field);
  return {
    ...(numberOrUndefined(record["expected"], `${field}.expected`) === undefined
      ? {}
      : { expected: finite(record["expected"], `${field}.expected`) }),
    ...(numberOrUndefined(record["maximum"], `${field}.maximum`) === undefined
      ? {}
      : { maximum: finite(record["maximum"], `${field}.maximum`) }),
    ...(numberOrUndefined(record["minimumCapacity"], `${field}.minimumCapacity`) === undefined
      ? {}
      : { minimumCapacity: finite(record["minimumCapacity"], `${field}.minimumCapacity`) }),
    ...(numberOrUndefined(record["maximumCapacity"], `${field}.maximumCapacity`) === undefined
      ? {}
      : { maximumCapacity: finite(record["maximumCapacity"], `${field}.maximumCapacity`) }),
    ...(zoneId === undefined ? {} : { zoneId }),
    ...(booleanOrUndefined(record["excludesUsableArea"], `${field}.excludesUsableArea`) === undefined
      ? {}
      : { excludesUsableArea: boolean(record["excludesUsableArea"], `${field}.excludesUsableArea`) }),
  };
};

const metadata = (value: unknown, field: string): Partial<VenueObject> => {
  const record = exact(
    value,
    ["label", "layer", "elevationM", "capacity", "circulation", "route", "restriction", "exit", "emergency", "occupancy", "groupId"],
    field,
  );
  const groupId = record["groupId"];
  if (groupId !== undefined && groupId !== null && typeof groupId !== "string") return invalid("group-id-invalid", field);
  return {
    ...(record["label"] === undefined ? {} : { label: string(record["label"], `${field}.label`) }),
    ...(record["layer"] === undefined ? {} : { layer: layer(record["layer"], `${field}.layer`) }),
    ...(record["elevationM"] === undefined ? {} : { elevationM: finite(record["elevationM"], `${field}.elevationM`) }),
    ...(record["capacity"] === undefined ? {} : { capacity: finite(record["capacity"], `${field}.capacity`) }),
    ...(record["circulation"] === undefined ? {} : { circulation: circulation(record["circulation"], `${field}.circulation`) }),
    ...(record["route"] === undefined ? {} : { route: route(record["route"], `${field}.route`) }),
    ...(record["restriction"] === undefined ? {} : { restriction: restriction(record["restriction"], `${field}.restriction`) }),
    ...(record["exit"] === undefined ? {} : { exit: exit(record["exit"], `${field}.exit`) }),
    ...(record["emergency"] === undefined ? {} : { emergency: emergency(record["emergency"], `${field}.emergency`) }),
    ...(record["occupancy"] === undefined ? {} : { occupancy: occupancy(record["occupancy"], `${field}.occupancy`) }),
    ...(groupId === undefined ? {} : { groupId }),
  };
};
const venueObject = (value: unknown, field: string): VenueObject => {
  const record = exact(
    value,
    ["id", "kind", "footprint", "label", "layer", "elevationM", "capacity", "circulation", "route", "restriction", "exit", "emergency", "occupancy", "groupId"],
    field,
  );
  const meta = metadata(
    Object.fromEntries(Object.entries(record).filter(([key]) => !["id", "kind", "footprint"].includes(key))),
    field,
  );
  return {
    id: string(record["id"], `${field}.id`),
    kind: string(record["kind"], `${field}.kind`),
    footprint: footprint(record["footprint"], `${field}.footprint`),
    ...meta,
  };
};

const spatialMutation = (value: unknown, field: string): SpatialMutation => {
  if (!isRecord(value) || typeof value["operation"] !== "string") return invalid("spatial-operation-required", field);
  if (value["operation"] === "update_footprint") {
    const record = exact(value, ["operation", "objectId", "footprint"], field);
    return {
      operation: "update_footprint",
      objectId: string(record["objectId"], `${field}.objectId`),
      footprint: footprintPatch(record["footprint"], `${field}.footprint`),
    };
  }
  if (value["operation"] === "update_metadata") {
    const record = exact(value, ["operation", "objectId", "values"], field);
    return {
      operation: "update_metadata",
      objectId: string(record["objectId"], `${field}.objectId`),
      values: metadata(record["values"], `${field}.values`),
    };
  }
  if (value["operation"] === "delete_object") {
    const record = exact(value, ["operation", "objectId"], field);
    return { operation: "delete_object", objectId: string(record["objectId"], `${field}.objectId`) };
  }
  if (value["operation"] === "add_object") {
    const record = exact(value, ["operation", "object"], field);
    return { operation: "add_object", object: venueObject(record["object"], `${field}.object`) };
  }
  return invalid("spatial-operation-unsupported", field);
};

const planningChange = (value: unknown, field: string): PlanningChange => {
  const record = exact(value, ["id", "title", "shortTitle", "label", "targetObjectIds", "spatialEffects"], field);
  if (!Array.isArray(record["spatialEffects"])) return invalid("spatial-effects-required", `${field}.spatialEffects`);
  return {
    id: string(record["id"], `${field}.id`),
    ...(record["title"] === undefined ? {} : { title: string(record["title"], `${field}.title`) }),
    ...(record["shortTitle"] === undefined
      ? {}
      : { shortTitle: string(record["shortTitle"], `${field}.shortTitle`) }),
    ...(record["label"] === undefined ? {} : { label: string(record["label"], `${field}.label`) }),
    targetObjectIds: strings(record["targetObjectIds"], `${field}.targetObjectIds`),
    spatialEffects: record["spatialEffects"].map((item, index) =>
      spatialMutation(item, `${field}.spatialEffects[${index}]`),
    ),
  };
};

export const decodeDeviationPlanningChange = (value: unknown, field = "change"): PlanningChange =>
  planningChange(value, field);
const location = (value: unknown, field: string): DeviationLocationInput => {
  if (!isRecord(value)) return invalid("location-invalid", field);
  if (value["kind"] === "plan-object") {
    const record = exact(value, ["kind", "planObjectId"], field);
    return { kind: "plan-object", planObjectId: string(record["planObjectId"], `${field}.planObjectId`) };
  }
  if (value["kind"] === "coordinate") {
    const record = exact(value, ["kind", "point"], field);
    return { kind: "coordinate", point: point(record["point"], `${field}.point`) };
  }
  return invalid("location-invalid", field);
};

export function decodeDeviationMutationCommand(
  value: unknown,
  identity: TrustedDeviationIdentity,
): TrustedDeviationCommand {
  if (!isRecord(value) || typeof value["type"] !== "string") return invalid("command-type-required", "type");
  const common = {
    actorType: "human" as const,
    actorId: identity.actorId,
    source: "studio" as const,
    sessionId: identity.sessionId,
    committedAt: identity.committedAt,
  };
  if (value["type"] === "record_live_plan_deviation") {
    const record = exact(
      value,
      [
        "type",
        "deviationId",
        "disposition",
        "reasonCode",
        "location",
        "affectedObjectIds",
        "availableConstraintIds",
        "change",
        "idempotencyKey",
        "expectedRevision",
        "operationId",
      ],
      "command",
    );
    if (record["disposition"] !== "temporary" && record["disposition"] !== "revision-candidate")
      return invalid("disposition-invalid", "disposition");
    return {
      ...common,
      type: "record_live_plan_deviation",
      deviationId: string(record["deviationId"], "deviationId"),
      disposition: record["disposition"],
      reasonCode: string(record["reasonCode"], "reasonCode"),
      location: location(record["location"], "location"),
      affectedObjectIds: strings(record["affectedObjectIds"], "affectedObjectIds"),
      availableConstraintIds: strings(record["availableConstraintIds"], "availableConstraintIds"),
      change: planningChange(record["change"], "change"),
      idempotencyKey: string(record["idempotencyKey"], "idempotencyKey"),
      expectedRevision: integer(record["expectedRevision"], "expectedRevision"),
    };
  }
  if (value["type"] === "end_live_plan_deviation") {
    const record = exact(
      value,
      ["type", "deviationId", "expectedRevision", "expectedDeviationRevision", "reasonCode", "idempotencyKey", "operationId"],
      "command",
    );
    return {
      ...common,
      type: "end_live_plan_deviation",
      deviationId: string(record["deviationId"], "deviationId"),
      expectedRevision: integer(record["expectedRevision"], "expectedRevision"),
      expectedDeviationRevision: integer(record["expectedDeviationRevision"], "expectedDeviationRevision"),
      reasonCode: string(record["reasonCode"], "reasonCode"),
      idempotencyKey: string(record["idempotencyKey"], "idempotencyKey"),
    };
  }
  if (value["type"] === "create_post_event_deviation_proposal") {
    const record = exact(
      value,
      ["type", "proposalId", "goal", "deviationIds", "expectedRevision", "idempotencyKey", "operationId"],
      "command",
    );
    return {
      ...common,
      type: "create_post_event_deviation_proposal",
      proposalId: string(record["proposalId"], "proposalId"),
      goal: string(record["goal"], "goal"),
      deviationIds: strings(record["deviationIds"], "deviationIds"),
      expectedRevision: integer(record["expectedRevision"], "expectedRevision"),
      idempotencyKey: string(record["idempotencyKey"], "idempotencyKey"),
    };
  }
  throw venueError("COMMAND_UNSUPPORTED", { commandType: value["type"] });
}

export function decodeDeviationCreateBody(value: unknown): string {
  const body = exact(value, ["runbookVersionId"], "body");
  return string(body["runbookVersionId"], "runbookVersionId");
}

export function decodeDeviationSyncBody(value: unknown): readonly unknown[] {
  const body = exact(value, ["commands"], "body");
  if (!Array.isArray(body["commands"]) || body["commands"].length > 100)
    return invalid("commands-invalid", "commands");
  return body["commands"];
}
