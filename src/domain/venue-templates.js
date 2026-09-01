import { venueError } from "./errors.js";

const clone = (value) => JSON.parse(JSON.stringify(value));

export const TEMPLATE_SCHEMA_VERSION = 1;

const rectangle = (x, y, width, depth, rotationDegrees = 0) => ({ kind: "rectangle", center: { x, y }, width, depth, rotationDegrees });
const line = (x1, y1, x2, y2, width) => ({ kind: "line", start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, width });

const roomObject = (id, kind, label, layer, footprint, metadata = {}) => ({ id, kind, label, layer, elevationM: 0, footprint, ...metadata });

const harborviewObjects = (routeWidthM) => [
  roomObject("roomobj-fire-exit-east", "fire_exit", "East fire exit", "safety", line(29.9, 8.5, 29.9, 11.5, 0.2), { exit: { clearWidthM: 3, emergency: true, capacityPersons: 450 } }),
  roomObject("roomobj-column-southwest", "column", "Southwest column", "architecture", { kind: "circle", center: { x: 8, y: 4 }, radius: 0.45 }, { elevationM: 4.5 }),
  roomObject("roomobj-power-west", "utility_point", "West power", "architecture", rectangle(2, 3, 0.3, 0.3), { utility: { type: "power", circuitId: "circuit-west-63a", rating: "63A", voltage: 230, maxWatts: 43600, powerKw: 43.6 } }),
  roomObject("roomobj-rigging-center", "rigging_point", "Center rigging", "production", { kind: "circle", center: { x: 15, y: 10 }, radius: 0.15 }, { elevationM: 8, rigging: { safeWorkingLoadKg: 1000 } }),
  roomObject("roomobj-production-zone", "restricted_zone", "Production clearance", "safety", rectangle(4, 18, 6, 2), { restriction: { access: "staff-only", reasonCode: "production-clearance", blocksPlacement: true } }),
  roomObject("roomobj-main-route", "corridor", "Main access spine", "access", line(15, 0.5, 15, 10, routeWidthM), { route: { direction: "bidirectional", accessible: true, purpose: "primary-access" } }),
];

const genericBoundary = (width, depth) => ({ outer: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }], holes: [] });

const starterRoom = (slug, name, useCase, width, depth, capacity) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  kind: "room-template",
  id: `room-template-${slug}`,
  version: "1.0.0",
  name,
  useCase,
  unit: "m",
  boundary: genericBoundary(width, depth),
  capacity,
  objects: [
    roomObject(`roomobj-${slug}-exit`, "fire_exit", "Primary exit", "safety", line(width - 0.1, depth / 2 - 1, width - 0.1, depth / 2 + 1, 0.2), { exit: { clearWidthM: 2, emergency: true, capacityPersons: capacity } }),
    roomObject(`roomobj-${slug}-power`, "utility_point", "Power", "architecture", rectangle(1, 1, 0.25, 0.25), { utility: { type: "power", circuitId: `circuit-${slug}-32a`, rating: "32A", voltage: 230, maxWatts: 22000, powerKw: 22 } }),
    roomObject(`roomobj-${slug}-rigging`, "rigging_point", "Rigging", "production", { kind: "circle", center: { x: width / 2, y: depth / 2 }, radius: 0.15 }, { elevationM: 6, rigging: { safeWorkingLoadKg: 500 } }),
  ],
});

const inventory = (slug, name, category, dimensions, availability, metadata = {}) => ({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  kind: "inventory-item-template",
  id: `inventory-template-${slug}`,
  version: "1.0.0",
  name,
  category,
  dimensions,
  weightKg: metadata.weightKg ?? 0,
  power: { watts: metadata.watts ?? 0, connector: metadata.connector ?? "none" },
  capacity: metadata.capacity ?? 0,
  cost: { amount: metadata.cost ?? 0, currency: "USD", basis: metadata.basis ?? "day" },
  availability: { total: availability, unavailable: metadata.unavailable ?? 0 },
});

const roomTemplates = [
  {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    kind: "room-template",
    id: "room-template-harborview-main-hall",
    version: "1.0.0",
    name: "Harborview Main Hall",
    useCase: "conference",
    unit: "m",
    boundary: genericBoundary(30, 20),
    capacity: 450,
    objects: harborviewObjects(1.219),
  },
  {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    kind: "room-template",
    id: "room-template-harborview-main-hall",
    version: "1.1.0",
    name: "Harborview Main Hall",
    useCase: "conference",
    unit: "m",
    boundary: genericBoundary(30, 20),
    capacity: 450,
    objects: harborviewObjects(1.829),
  },
  starterRoom("conference", "Conference hall", "conference", 24, 16, 300),
  starterRoom("concert", "Concert hall", "concert", 36, 24, 800),
  starterRoom("banquet", "Banquet hall", "banquet", 24, 18, 260),
  starterRoom("exhibition", "Exhibition hall", "exhibition", 40, 28, 1000),
  starterRoom("classroom", "Classroom", "classroom", 14, 10, 60),
  starterRoom("community-event", "Community hall", "community-event", 20, 14, 180),
];

const venueTemplates = [
  { schemaVersion: TEMPLATE_SCHEMA_VERSION, kind: "venue-template", id: "venue-template-harborview", version: "1.0.0", name: "Harborview Convention Center", roomTemplateIds: ["room-template-harborview-main-hall"] },
  ...["conference", "concert", "banquet", "exhibition", "classroom", "community-event"].map((slug) => ({ schemaVersion: TEMPLATE_SCHEMA_VERSION, kind: "venue-template", id: `venue-template-${slug}-starter`, version: "1.0.0", name: `${slug.replaceAll("-", " ")} starter venue`, roomTemplateIds: [`room-template-${slug}`] })),
];

const inventoryTemplates = [
  inventory("banquet-chair", "Banquet chair", "seating", { widthM: 0.5, depthM: 0.55, heightM: 0.9 }, 500, { weightKg: 5, capacity: 1, cost: 4 }),
  inventory("round-table", "Round table", "furniture", { diameterM: 1.8, heightM: 0.75 }, 60, { weightKg: 32, capacity: 10, cost: 28 }),
  inventory("crowd-barrier", "Crowd barrier", "barriers", { widthM: 2.5, depthM: 0.5, heightM: 1.1 }, 120, { weightKg: 18, cost: 12 }),
  inventory("stage-deck", "Stage deck", "staging", { widthM: 2, depthM: 1, heightM: 0.4 }, 80, { weightKg: 48, capacity: 8, cost: 45 }),
  inventory("line-array", "Line array cabinet", "av", { widthM: 0.75, depthM: 0.55, heightM: 1.1 }, 24, { weightKg: 42, watts: 1600, connector: "powerCON", cost: 180 }),
  inventory("laser-projector", "Laser projector", "av", { widthM: 0.55, depthM: 0.65, heightM: 0.25 }, 8, { weightKg: 25, watts: 1200, connector: "powerCON", cost: 420 }),
  inventory("projection-screen-5m", "5 m projection screen", "av", { widthM: 5, depthM: 0.15, heightM: 3 }, 4, { weightKg: 82, connector: "none", cost: 260 }),
  inventory("broadcast-camera", "Broadcast camera", "av", { widthM: 0.35, depthM: 0.55, heightM: 1.7 }, 10, { weightKg: 18, watts: 180, connector: "NEMA 5-15", cost: 300 }),
  inventory("av-control-console", "AV control console", "av", { widthM: 3, depthM: 1.5, heightM: 0.75 }, 4, { weightKg: 95, watts: 600, connector: "NEMA 5-15", cost: 380 }),
  inventory("cable-loom-25m", "25 m protected cable loom", "av", { widthM: 25, depthM: 0.1, heightM: 0.03 }, 20, { weightKg: 14, connector: "mixed", cost: 55 }),
  inventory("buffet-station", "Buffet station", "catering", { widthM: 1.8, depthM: 0.8, heightM: 0.9 }, 20, { weightKg: 38, watts: 1200, connector: "NEMA 5-15", capacity: 80, cost: 90 }),
  inventory("mobile-bar", "Mobile bar", "catering", { widthM: 1.5, depthM: 0.7, heightM: 0.9 }, 12, { weightKg: 44, watts: 350, connector: "NEMA 5-15", capacity: 60, cost: 110 }),
  inventory("wayfinding-sign", "Wayfinding sign", "signage", { widthM: 0.6, depthM: 0.6, heightM: 1.8 }, 75, { weightKg: 8, cost: 10 }),
  inventory("queue-stanchion", "Queue stanchion", "queue", { widthM: 0.35, depthM: 0.35, heightM: 1 }, 160, { weightKg: 9, cost: 8 }),
];

export const venueTemplateCatalog = Object.freeze({
  schemaVersion: TEMPLATE_SCHEMA_VERSION,
  venueTemplates: Object.freeze(venueTemplates),
  roomTemplates: Object.freeze(roomTemplates),
  inventoryTemplates: Object.freeze(inventoryTemplates),
});

const findVersion = (items, id, version) => items.find((item) => item.id === id && item.version === version);

export const listVenueTemplates = () => clone(venueTemplateCatalog);

export const getRoomTemplate = (id, version) => {
  const template = findVersion(roomTemplates, id, version);
  if (!template) throw venueError("TEMPLATE_VERSION_NOT_FOUND", { templateKind: "room-template", templateId: id, version });
  return clone(template);
};

export const getInventoryTemplate = (id, version) => {
  const template = findVersion(inventoryTemplates, id, version);
  if (!template) throw venueError("TEMPLATE_VERSION_NOT_FOUND", { templateKind: "inventory-item-template", templateId: id, version });
  return clone(template);
};

export function assertCurrentTemplateDocument(document) {
  if (document?.schemaVersion !== TEMPLATE_SCHEMA_VERSION) throw venueError("TEMPLATE_SCHEMA_UNSUPPORTED", { templateId: document?.id ?? null, schemaVersion: document?.schemaVersion ?? null, supportedSchemaVersion: TEMPLATE_SCHEMA_VERSION });
  return clone(document);
}

export function evaluateInventoryAvailability(plan) {
  const demand = new Map();
  for (const object of plan.objects ?? []) {
    const reference = object.templateRef;
    if (reference?.kind !== "inventory-item-template") continue;
    const key = `${reference.templateId}@${reference.version}`;
    demand.set(key, (demand.get(key) ?? 0) + (object.inventoryCount ?? 1));
  }
  return [...demand.entries()].map(([key, requested]) => {
    const separator = key.lastIndexOf("@");
    const templateId = key.slice(0, separator);
    const version = key.slice(separator + 1);
    const template = getInventoryTemplate(templateId, version);
    const available = Math.max(0, template.availability.total - template.availability.unavailable);
    return { id: `inventory-${templateId}-${version}`, templateId, version, requested, available, status: requested > available ? "warning" : "available", shortage: Math.max(0, requested - available) };
  }).sort((left, right) => left.templateId.localeCompare(right.templateId));
}
