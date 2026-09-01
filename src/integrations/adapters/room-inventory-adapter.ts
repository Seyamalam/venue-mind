import { AdapterContractError, createSyncCursor, defineAdapter, sha256Checksum } from "../contracts.ts";
import { createVenueAdapter } from "../runtime.ts";

const clone = (value: any) => structuredClone(value);

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
  retryPolicy: { maxAttempts: 4, initialDelayMs: 100, maximumDelayMs: 800, multiplier: 2, retryableCodes: ["ADAPTER_NETWORK_ERROR", "ADAPTER_RATE_LIMITED", "ADAPTER_UPSTREAM_UNAVAILABLE"] },
  rateLimit: { requests: 30, windowMs: 60_000 },
});

const normalizeRecord = async (record: any, input: any, definition: any) => {
  if (!record || typeof record !== "object" || typeof record.externalId !== "string" || typeof record.sourceVersion !== "string") throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory record requires externalId and sourceVersion");
  const checksum = await sha256Checksum(record);
  const external: any = { adapterId: definition.id, sourceSystem: input.sourceSystem, entityType: "room-inventory-record", externalId: record.externalId, sourceVersion: record.sourceVersion, checksum };
  const mapped = input.mappings?.[record.externalId];
  const proposed = input.stableIds?.[record.externalId];
  if (!mapped && !proposed) throw new AdapterContractError("ADAPTER_STABLE_ID_REQUIRED", "New external records require a separately allocated VenueMind stable ID", { externalId: record.externalId });
  const values = mapped
    ? { label: record.label, capacity: record.capacity ?? null, footprint: clone(record.footprint) }
    : { kind: record.kind, label: record.label, layer: record.layer ?? "furniture", elevationM: record.elevationM ?? 0, locked: false, capacity: record.capacity ?? null, footprint: clone(record.footprint) };
  return {
    id: `change-${await sha256Checksum({ externalId: record.externalId, sourceVersion: record.sourceVersion, checksum }).then((value: any) => value.slice(0, 16))}`,
    operation: mapped ? "update" : "create",
    venueEntityType: "project-object-instance",
    ...(mapped ? { venueObjectId: mapped } : { proposedVenueObjectId: proposed }),
    external,
    values,
    ...(input.baseChecksums?.[record.externalId] ? { baseChecksum: input.baseChecksums[record.externalId] } : {}),
  };
};

const importRecords = async (input: any, definition: any, synchronizedAt: any) => {
  if (typeof input.sourceSystem !== "string" || !input.sourceSystem) throw new AdapterContractError("ADAPTER_SOURCE_INVALID", "Room Inventory sourceSystem is required");
  const records = [...(input.records ?? [])].sort((left: any, right: any) => left.externalId.localeCompare(right.externalId));
  const changes = await Promise.all(records.map((record: any) => normalizeRecord(record, input, definition)));
  const sourceVersion = input.sourceVersion ?? records.map((record: any) => record.sourceVersion).sort().at(-1) ?? "empty";
  return { sourceSystem: input.sourceSystem, sourceVersion, synchronizedAt, syncCursor: await createSyncCursor(definition, { opaque: input.nextCursor ?? sourceVersion, sourceVersion }), changes, warnings: [] };
};

export const roomInventoryAdapter = createVenueAdapter(roomInventoryAdapterDefinition, {
  async import(input: any, context: any) {
    await context.secrets.get("room-inventory/api-token");
    return importRecords(input, roomInventoryAdapterDefinition, context.clock());
  },
  async synchronize(input: any, context: any) {
    await context.secrets.get("room-inventory/api-token");
    return importRecords(input, roomInventoryAdapterDefinition, context.clock());
  },
  async export(input: any, context: any) {
    await context.secrets.get("room-inventory/api-token");
    const objects = [...(input.objects ?? [])].sort((left: any, right: any) => left.id.localeCompare(right.id)).map((object: any) => ({ venueObjectId: object.id, kind: object.kind, label: object.label, capacity: object.capacity ?? null, footprint: clone(object.footprint) }));
    return { sourceSystem: input.sourceSystem, mediaType: "application/vnd.room-inventory+json", sourceVersion: input.planVersion, data: { planId: input.planId, planVersion: input.planVersion, venueEntityType: "project-object-instance", objects } };
  },
  async webhook(input: any) {
    return { sourceSystem: input.sourceSystem, eventId: input.id, eventType: input.type, occurredAt: input.occurredAt, sourceVersion: input.sourceVersion, payload: clone(input.record), ...(input.checksum ? { checksum: input.checksum } : {}) };
  },
});
