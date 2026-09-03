import {
  AdapterContractError,
  createSyncCursor,
  defineAdapter,
  sha256Checksum,
  type AdapterDefinition,
} from "../contracts.ts";
import { createVenueAdapter } from "../runtime.ts";

export const roomInventoryAdapterDefinition = defineAdapter({
  contractVersion: 1,
  id: "room-inventory",
  displayName: "Room Inventory",
  version: "1.0.0",
  capabilities: ["import", "export", "synchronize", "webhook"],
  scopes: {
    import: ["inventory:read"],
    export: ["inventory:write"],
    synchronize: ["inventory:read"],
    webhook: ["inventory:webhook"],
  },
  retryPolicy: {
    maxAttempts: 4,
    initialDelayMs: 100,
    maximumDelayMs: 800,
    multiplier: 2,
    retryableCodes: ["ADAPTER_NETWORK_ERROR", "ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"],
  },
  rateLimit: { requests: 30, windowMs: 60_000 },
});

interface RoomInventoryRecord {
  readonly externalId: string;
  readonly sourceVersion: string;
  readonly kind: string;
  readonly label: string;
  readonly layer?: string;
  readonly elevationM?: number;
  readonly capacity?: number | null;
  readonly footprint: unknown;
}
interface RoomInventoryInput {
  readonly sourceSystem: string;
  readonly records: readonly RoomInventoryRecord[];
  readonly mappings: Readonly<Record<string, string>>;
  readonly stableIds: Readonly<Record<string, string>>;
  readonly baseChecksums: Readonly<Record<string, string>>;
  readonly sourceVersion?: string;
  readonly nextCursor?: string;
}
interface ExportObject {
  readonly id: string;
  readonly kind: string;
  readonly label?: string;
  readonly capacity?: number;
  readonly footprint: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const clone = <Value>(value: Value): Value => structuredClone(value);
const requiredString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || !value)
    throw new AdapterContractError("ADAPTER_SOURCE_INVALID", `${label} is required`);
  return value;
};
const optionalString = (value: unknown, label: string): string | undefined =>
  value === undefined ? undefined : requiredString(value, label);
const stringRecord = (value: unknown, label: string): Readonly<Record<string, string>> => {
  if (value === undefined) return {};
  if (!isRecord(value) || !Object.values(value).every((item) => typeof item === "string" && item.length > 0))
    throw new AdapterContractError("ADAPTER_SOURCE_INVALID", `${label} must contain stable string mappings`);
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
};

const normalizeRecord = (value: unknown): RoomInventoryRecord => {
  if (!isRecord(value))
    throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory record must be an object");
  const externalId = requiredString(value["externalId"], "Room Inventory externalId");
  const sourceVersion = requiredString(value["sourceVersion"], "Room Inventory sourceVersion");
  const kind = requiredString(value["kind"], "Room Inventory kind");
  const label = requiredString(value["label"], "Room Inventory label");
  const layer = optionalString(value["layer"], "Room Inventory layer");
  const elevationM = value["elevationM"];
  const capacity = value["capacity"];
  if (elevationM !== undefined && typeof elevationM !== "number")
    throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory elevationM must be numeric");
  if (capacity !== undefined && capacity !== null && typeof capacity !== "number")
    throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory capacity must be numeric");
  if (!isRecord(value["footprint"]))
    throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory footprint is required");
  return {
    externalId,
    sourceVersion,
    kind,
    label,
    footprint: clone(value["footprint"]),
    ...(layer ? { layer } : {}),
    ...(typeof elevationM === "number" ? { elevationM } : {}),
    ...(typeof capacity === "number" || capacity === null ? { capacity } : {}),
  };
};

const normalizeInput = (value: unknown): RoomInventoryInput => {
  if (!isRecord(value))
    throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory input must be an object");
  const records = value["records"] ?? [];
  if (!Array.isArray(records))
    throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory records must be an array");
  const sourceVersion = optionalString(value["sourceVersion"], "Room Inventory sourceVersion");
  const nextCursor = optionalString(value["nextCursor"], "Room Inventory nextCursor");
  return {
    sourceSystem: requiredString(value["sourceSystem"], "Room Inventory sourceSystem"),
    records: records.map(normalizeRecord).sort((left, right) => left.externalId.localeCompare(right.externalId)),
    mappings: stringRecord(value["mappings"], "Room Inventory mappings"),
    stableIds: stringRecord(value["stableIds"], "Room Inventory stable IDs"),
    baseChecksums: stringRecord(value["baseChecksums"], "Room Inventory base checksums"),
    ...(sourceVersion ? { sourceVersion } : {}),
    ...(nextCursor ? { nextCursor } : {}),
  };
};

const normalizeChange = async (
  record: RoomInventoryRecord,
  input: RoomInventoryInput,
  definition: AdapterDefinition,
) => {
  const checksum = await sha256Checksum(record);
  const external = {
    adapterId: definition.id,
    sourceSystem: input.sourceSystem,
    entityType: "room-inventory-record",
    externalId: record.externalId,
    sourceVersion: record.sourceVersion,
    checksum,
  };
  const mapped = input.mappings[record.externalId];
  const proposed = input.stableIds[record.externalId];
  if (!mapped && !proposed)
    throw new AdapterContractError(
      "ADAPTER_STABLE_ID_REQUIRED",
      "New external records require a separately allocated VenueMind stable ID",
      { externalId: record.externalId },
    );
  const values = mapped
    ? { label: record.label, capacity: record.capacity ?? null, footprint: clone(record.footprint) }
    : {
        kind: record.kind,
        label: record.label,
        layer: record.layer ?? "furniture",
        elevationM: record.elevationM ?? 0,
        locked: false,
        capacity: record.capacity ?? null,
        footprint: clone(record.footprint),
      };
  return {
    id: `change-${(await sha256Checksum({ externalId: record.externalId, sourceVersion: record.sourceVersion, checksum })).slice(0, 16)}`,
    operation: mapped ? "update" : "create",
    venueEntityType: "project-object-instance",
    ...(mapped ? { venueObjectId: mapped } : { proposedVenueObjectId: proposed }),
    external,
    values,
    ...(input.baseChecksums[record.externalId] ? { baseChecksum: input.baseChecksums[record.externalId] } : {}),
  };
};

const importRecords = async (inputValue: unknown, definition: AdapterDefinition, synchronizedAt: string) => {
  const input = normalizeInput(inputValue);
  const changes = await Promise.all(input.records.map((record) => normalizeChange(record, input, definition)));
  const sourceVersion =
    input.sourceVersion ??
    input.records
      .map((record) => record.sourceVersion)
      .sort()
      .at(-1) ??
    "empty";
  return {
    sourceSystem: input.sourceSystem,
    sourceVersion,
    synchronizedAt,
    syncCursor: await createSyncCursor(definition, { opaque: input.nextCursor ?? sourceVersion, sourceVersion }),
    changes,
    warnings: [],
  };
};

const normalizeExportObjects = (value: unknown): readonly ExportObject[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ExportObject => {
      if (!isRecord(item))
        throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory export object is invalid");
      return {
        id: requiredString(item["id"], "Venue object ID"),
        kind: requiredString(item["kind"], "Venue object kind"),
        ...(typeof item["label"] === "string" ? { label: item["label"] } : {}),
        ...(typeof item["capacity"] === "number" ? { capacity: item["capacity"] } : {}),
        footprint: clone(item["footprint"]),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
};

export const roomInventoryAdapter = createVenueAdapter(roomInventoryAdapterDefinition, {
  import(input, context) {
    return context.secrets
      .get("room-inventory/api-token")
      .then(() => importRecords(input, roomInventoryAdapterDefinition, context.clock()));
  },
  synchronize(input, context) {
    return context.secrets
      .get("room-inventory/api-token")
      .then(() => importRecords(input, roomInventoryAdapterDefinition, context.clock()));
  },
  export(input, context) {
    return context.secrets.get("room-inventory/api-token").then(() => {
      if (!isRecord(input))
        throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory export input is invalid");
      const sourceSystem = requiredString(input["sourceSystem"], "Room Inventory sourceSystem");
      const planId = requiredString(input["planId"], "Plan ID");
      const planVersion = requiredString(input["planVersion"], "Plan Version");
      const objects = normalizeExportObjects(input["objects"]).map((object) => ({
        venueObjectId: object.id,
        kind: object.kind,
        label: object.label ?? "",
        capacity: object.capacity ?? null,
        footprint: clone(object.footprint),
      }));
      return {
        sourceSystem,
        mediaType: "application/vnd.room-inventory+json",
        sourceVersion: planVersion,
        data: { planId, planVersion, venueEntityType: "project-object-instance", objects },
      };
    });
  },
  webhook(input) {
    if (!isRecord(input)) throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory webhook is invalid");
    return {
      sourceSystem: requiredString(input["sourceSystem"], "Room Inventory webhook sourceSystem"),
      eventId: requiredString(input["id"], "Room Inventory webhook ID"),
      eventType: requiredString(input["type"], "Room Inventory webhook type"),
      occurredAt: requiredString(input["occurredAt"], "Room Inventory webhook occurredAt"),
      sourceVersion: requiredString(input["sourceVersion"], "Room Inventory webhook sourceVersion"),
      payload: clone(input["record"]),
      ...(typeof input["checksum"] === "string" ? { checksum: input["checksum"] } : {}),
    };
  },
});
