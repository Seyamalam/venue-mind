import { errorCatalog } from "../domain/errors.js";
import { RFC3339_INSTANT_PATTERN_SOURCE } from "../domain/event-schedule.js";
import { CANONICAL_UTC_TIMESTAMP_PATTERN_SOURCE } from "../domain/timestamps.js";
import { CALENDAR_WEBHOOK_EVENT_TYPES } from "../integrations/adapters/calendar-event-adapter.js";
import { NON_CONTACT_LABEL_PATTERN_SOURCE } from "../integrations/privacy.js";

const emptyObject = { type: "object", properties: {}, additionalProperties: false };
const mutationMetadataProperties = {
  idempotencyKey: { type: "string", minLength: 1, description: "Unique retry key for this semantic command." },
  correlationId: { type: "string", minLength: 1, description: "Optional caller correlation identifier." },
};
const commandExecutionMetadataProperties = {
  ...mutationMetadataProperties,
  source: { enum: ["studio", "webmcp", "mcp", "system", "agent-tool"] },
  sessionId: { type: "string", minLength: 1 },
  actorId: { type: "string", minLength: 1 },
};

const pointSchema = {
  type: "object",
  required: ["x", "y"],
  properties: { x: { type: "number" }, y: { type: "number" } },
  additionalProperties: false,
};

const footprintSchema = {
  oneOf: [
    {
      type: "object",
      required: ["kind", "center", "width", "depth", "rotationDegrees"],
      properties: {
        kind: { const: "rectangle" },
        center: pointSchema,
        width: { type: "number", exclusiveMinimum: 0 },
        depth: { type: "number", exclusiveMinimum: 0 },
        rotationDegrees: { type: "number", minimum: 0, exclusiveMaximum: 360 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["kind", "center", "radius"],
      properties: {
        kind: { const: "circle" },
        center: pointSchema,
        radius: { type: "number", exclusiveMinimum: 0 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["kind", "start", "end", "width"],
      properties: {
        kind: { const: "line" },
        start: pointSchema,
        end: pointSchema,
        width: { type: "number", exclusiveMinimum: 0 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["kind", "points", "rotationDegrees"],
      properties: {
        kind: { const: "polygon" },
        points: { type: "array", minItems: 3, items: pointSchema },
        rotationDegrees: { type: "number", minimum: 0, exclusiveMaximum: 360 },
      },
      additionalProperties: false,
    },
  ],
};

const doorMetadataSchema = {
  type: "object",
  required: ["clearWidthM", "swing", "accessible"],
  properties: {
    clearWidthM: { type: "number", exclusiveMinimum: 0 },
    swing: { enum: ["inward", "outward", "sliding", "revolving"] },
    accessible: { type: "boolean" },
    clearance: {
      type: "object",
      required: ["side", "depthM", "latchSideM"],
      properties: { side: { enum: ["left", "right", "both"] }, depthM: { type: "number", exclusiveMinimum: 0 }, latchSideM: { type: "number", exclusiveMinimum: 0 } },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const rampMetadataSchema = {
  type: "object",
  required: ["riseM", "runM", "clearWidthM", "landingLengthM", "edgeProtectionHeightM", "handrails"],
  properties: {
    riseM: { type: "number", exclusiveMinimum: 0 }, runM: { type: "number", exclusiveMinimum: 0 }, clearWidthM: { type: "number", exclusiveMinimum: 0 }, landingLengthM: { type: "number", exclusiveMinimum: 0 }, edgeProtectionHeightM: { type: "number", minimum: 0 }, handrails: { type: "boolean" },
  },
  additionalProperties: false,
};

const exitMetadataSchema = {
  type: "object",
  required: ["clearWidthM", "emergency", "capacityPersons"],
  properties: {
    clearWidthM: { type: "number", exclusiveMinimum: 0 },
    emergency: { type: "boolean" },
    capacityPersons: { type: "integer", minimum: 1 },
  },
  additionalProperties: false,
};

const routeMetadataSchema = {
  type: "object",
  required: ["direction", "accessible", "purpose"],
  properties: {
    direction: { enum: ["one-way", "bidirectional"] },
    accessible: { type: "boolean" },
    purpose: { type: "string", minLength: 1 },
    staffOnly: { type: "boolean" },
  },
  additionalProperties: false,
};

const restrictionMetadataSchema = {
  type: "object",
  required: ["access", "reasonCode", "blocksPlacement"],
  properties: {
    access: { enum: ["prohibited", "staff-only", "conditional"] },
    reasonCode: { type: "string", minLength: 1 },
    blocksPlacement: { type: "boolean" },
  },
  additionalProperties: false,
};

const occupancyPolicySchema = {
  type: "object",
  required: ["venueMaximum", "staff", "performers", "vendors", "sections", "zones"],
  properties: {
    venueMaximum: { type: "integer", minimum: 0 },
    staff: { type: "integer", minimum: 0 },
    performers: { type: "integer", minimum: 0 },
    vendors: { type: "integer", minimum: 0 },
    densityM2PerAttendee: { type: "number", exclusiveMinimum: 0 },
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["objectId", "zoneId", "minimumCapacity", "maximumCapacity"],
        properties: { objectId: { type: "string", minLength: 1 }, zoneId: { type: ["string", "null"] }, minimumCapacity: { type: "integer", minimum: 0 }, maximumCapacity: { type: "integer", minimum: 0 } },
        additionalProperties: false,
      },
    },
    zones: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "label", "sectionObjectIds", "minimumCapacity", "maximumCapacity"],
        properties: { id: { type: "string", minLength: 1 }, label: { type: "string", minLength: 1 }, sectionObjectIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } }, minimumCapacity: { type: "integer", minimum: 0 }, maximumCapacity: { type: "integer", minimum: 0 } },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const placementMetadataSchema = {
  type: "object",
  required: ["collisionMode"],
  properties: { collisionMode: { const: "solid" } },
  additionalProperties: false,
};

const circulationMetadataSchema = {
  type: "object",
  properties: {
    blocksPath: { type: "boolean" },
    blocksExitApproach: { type: "boolean" },
    role: { enum: ["queue", "checkpoint"] },
    demandPersons: { type: "integer", minimum: 0 },
    capacityPersons: { type: "integer", minimum: 0 },
    capacityPersonsPerMinute: { type: "number", exclusiveMinimum: 0 },
    clearWidthM: { type: "number", exclusiveMinimum: 0 },
    carCapacityPersons: { type: "integer", minimum: 1 },
    cycleSeconds: { type: "number", exclusiveMinimum: 0 },
    servesZoneIds: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
  },
  additionalProperties: false,
};

const queueMetadataSchema = {
  type: "object",
  required: ["category", "servers", "serviceRatePerServerMinute", "priorityLaneCount"],
  properties: {
    category: { enum: ["registration", "security", "cloakroom", "food", "beverage", "restroom", "merchandise", "transport"] },
    servers: { type: "integer", minimum: 1 },
    serviceRatePerServerMinute: { type: "number", exclusiveMinimum: 0 },
    priorityLaneCount: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
};

const staffPostMetadataSchema = {
  type: "object",
  required: ["coverageZoneObjectIds", "assignments"],
  properties: {
    coverageZoneObjectIds: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    assignments: { type: "array", minItems: 1, items: { type: "object", required: ["shiftId", "roleId", "count"], properties: { shiftId: { type: "string", minLength: 1 }, roleId: { type: "string", minLength: 1 }, count: { type: "integer", minimum: 1 } }, additionalProperties: false } },
  },
  additionalProperties: false,
};

const utilityMetadataSchema = {
  type: "object",
  required: ["type", "circuitId", "voltage", "maxWatts"],
  properties: { type: { const: "power" }, circuitId: { type: "string", minLength: 1 }, rating: { type: "string" }, voltage: { type: "number", exclusiveMinimum: 0 }, maxWatts: { type: "number", exclusiveMinimum: 0 }, powerKw: { type: "number", exclusiveMinimum: 0 } },
  additionalProperties: false,
};

const riggingMetadataSchema = {
  type: "object",
  required: ["safeWorkingLoadKg"],
  properties: { safeWorkingLoadKg: { type: "number", exclusiveMinimum: 0 } },
  additionalProperties: false,
};

const productionZoneMetadataSchema = {
  type: "object",
  required: ["access"],
  properties: { access: { enum: ["crew-only", "performer-only", "mixed"] } },
  additionalProperties: false,
};

const productionMetadataSchema = {
  type: "object",
  required: ["equipmentType"],
  properties: {
    equipmentType: { enum: ["screen", "projector", "speaker", "camera", "control-desk", "cable-route", "power-distribution", "rigged-equipment"] },
    targetObjectId: { type: "string", minLength: 1 }, targetObjectIds: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } }, targetZoneObjectIds: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    sourceObjectId: { type: "string", minLength: 1 }, circuitId: { type: "string", minLength: 1 }, riggingPointId: { type: "string", minLength: 1 },
    viewableWidthM: { type: "number", exclusiveMinimum: 0 }, viewableHeightM: { type: "number", exclusiveMinimum: 0 }, throwRatioMin: { type: "number", exclusiveMinimum: 0 }, throwRatioMax: { type: "number", exclusiveMinimum: 0 },
    powerWatts: { type: "number", minimum: 0 }, weightKg: { type: "number", minimum: 0 }, requiresRigging: { type: "boolean" },
    aimPoint: pointSchema, coverageRangeM: { type: "number", exclusiveMinimum: 0 }, coverageAngleDegrees: { type: "number", exclusiveMinimum: 0, maximum: 360 },
    minimumDistanceM: { type: "number", minimum: 0 }, maximumDistanceM: { type: "number", exclusiveMinimum: 0 }, cableType: { type: "string", minLength: 1 }, crossingTreatment: { enum: ["none", "overhead", "cable-ramp", "floor-channel"] },
  },
  additionalProperties: false,
};

const cateringMetadataSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: { enum: ["bar", "buffet", "service-counter", "kitchen", "prep", "waste", "water", "queue-zone", "replenishment-route"] },
    servers: { type: "integer", minimum: 1 },
    serviceRatePerServerMinute: { type: "number", exclusiveMinimum: 0 },
    demandShare: { type: "number", exclusiveMinimum: 0, maximum: 1 },
    queueZoneObjectId: { type: "string", minLength: 1 },
    queueBufferPersons: { type: "integer", minimum: 0 },
    accessibleServicePoint: { type: "boolean" },
    serviceHeightM: { type: "number", exclusiveMinimum: 0 },
    dietaryOptions: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    allergenLabels: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    replenishmentSourceObjectId: { type: "string", minLength: 1 },
    waterSourceObjectId: { type: "string", minLength: 1 },
    sourceObjectId: { type: "string", minLength: 1 },
    targetObjectIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } },
    crossingControl: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

const emergencyMetadataSchema = {
  type: "object",
  required: ["type"],
  properties: {
    type: { enum: ["assembly-point", "emergency-access-lane", "fire-equipment", "first-aid", "command-post"] },
    capacityPersons: { type: "integer", minimum: 1 },
    designatedExitObjectIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } },
    responderOnly: { type: "boolean" },
    equipmentClass: { type: "string", minLength: 1 },
    coverageRadiusM: { type: "number", exclusiveMinimum: 0 },
    clearanceM: { type: "number", exclusiveMinimum: 0 },
    accessible: { type: "boolean" },
    powerSourceCircuitId: { type: "string", minLength: 1 },
    backupPowerMinutes: { type: "number", minimum: 0 },
  },
  additionalProperties: false,
};

const emergencyReviewSchema = {
  type: "object",
  required: ["id", "proposalId", "basePlanVersion", "acceptedPlanVersion", "validationInputFingerprint", "emergencyEvidenceFingerprint", "changedObjectIds", "reviewerId", "reviewerRole", "assumptionsAccepted", "assumptions", "note", "reviewedAt"],
  properties: {
    id: { type: "string", pattern: "^emergency-review-" }, proposalId: { type: "string", minLength: 1 }, basePlanVersion: { type: "string", minLength: 1 }, acceptedPlanVersion: { type: "string", minLength: 1 }, validationInputFingerprint: { type: "string", pattern: "^input-" }, emergencyEvidenceFingerprint: { type: "string", pattern: "^emergency-planning-" }, changedObjectIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } }, reviewerId: { type: "string", minLength: 1 }, reviewerRole: { enum: ["safety-officer", "venue-administrator"] }, assumptionsAccepted: { const: true }, assumptions: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } }, note: { type: "string" }, reviewedAt: { type: "string", format: "date-time" },
  },
  additionalProperties: false,
};

const templateRefSchema = {
  type: "object",
  required: ["kind", "templateId", "version"],
  properties: {
    kind: { enum: ["venue-template", "room-template", "inventory-item-template"] },
    templateId: { type: "string", minLength: 1 },
    templateObjectId: { type: "string", minLength: 1 },
    version: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
  },
  additionalProperties: false,
};

export const venueTemplateCatalogSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/venue-template-catalog.schema.json",
  title: "VenueMind Venue Template Catalog",
  type: "object",
  required: ["schemaVersion", "venueTemplates", "roomTemplates", "inventoryTemplates"],
  properties: {
    schemaVersion: { const: 1 },
    venueTemplates: { type: "array", items: { type: "object", required: ["schemaVersion", "kind", "id", "version", "name", "roomTemplateIds"], properties: { schemaVersion: { const: 1 }, kind: { const: "venue-template" }, id: { type: "string" }, version: { type: "string" }, name: { type: "string" }, roomTemplateIds: { type: "array", items: { type: "string" } } }, additionalProperties: false } },
    roomTemplates: { type: "array", items: { type: "object", required: ["schemaVersion", "kind", "id", "version", "name", "unit", "boundary", "objects"], properties: { schemaVersion: { const: 1 }, kind: { const: "room-template" }, id: { type: "string" }, version: { type: "string" }, name: { type: "string" }, useCase: { enum: ["conference", "concert", "banquet", "exhibition", "classroom", "community-event"] }, unit: { const: "m" }, boundary: { type: "object" }, capacity: { type: "integer", minimum: 0 }, objects: { type: "array", items: { type: "object" } } }, additionalProperties: false } },
    inventoryTemplates: { type: "array", items: { type: "object", required: ["schemaVersion", "kind", "id", "version", "name", "category", "dimensions", "weightKg", "power", "capacity", "cost", "availability"], properties: { schemaVersion: { const: 1 }, kind: { const: "inventory-item-template" }, id: { type: "string" }, version: { type: "string" }, name: { type: "string" }, category: { enum: ["furniture", "seating", "barriers", "staging", "av", "catering", "signage", "queue"] }, dimensions: { type: "object" }, weightKg: { type: "number", minimum: 0 }, power: { type: "object", required: ["watts", "connector"] }, capacity: { type: "integer", minimum: 0 }, cost: { type: "object", required: ["amount", "currency", "basis"] }, availability: { type: "object", required: ["total", "unavailable"], properties: { total: { type: "integer", minimum: 0 }, unavailable: { type: "integer", minimum: 0 } }, additionalProperties: false } }, additionalProperties: false } },
  },
  additionalProperties: false,
};

export const spatialGeometrySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/spatial-geometry.schema.json",
  title: "VenueMind Spatial Geometry",
  type: "object",
  required: ["schemaVersion", "unit", "units", "layers", "coordinateSystem", "precision", "roomBoundary", "fingerprint"],
  properties: {
    schemaVersion: { const: 1 },
    unit: { const: "m" },
    units: {
      type: "object",
      required: ["length", "area", "angle", "time"],
      properties: { length: { const: "m" }, area: { const: "m2" }, angle: { const: "deg" }, time: { const: "s" } },
      additionalProperties: false,
    },
    layers: {
      type: "array",
      prefixItems: [
        { const: "architecture" },
        { const: "furniture" },
        { const: "access" },
        { const: "production" },
        { const: "catering" },
        { const: "safety" },
        { const: "annotations" },
      ],
      minItems: 7,
      maxItems: 7,
    },
    coordinateSystem: {
      type: "object",
      required: ["origin", "xAxis", "yAxis", "rotationDirection"],
      properties: {
        origin: { const: "southwest" },
        xAxis: { const: "east" },
        yAxis: { const: "north" },
        rotationDirection: { const: "clockwise" },
      },
      additionalProperties: false,
    },
    precision: {
      type: "object",
      required: ["distance", "angle"],
      properties: { distance: { const: 3 }, angle: { const: 1 } },
      additionalProperties: false,
    },
    roomBoundary: {
      type: "object",
      required: ["outer", "holes"],
      properties: {
        outer: { type: "array", minItems: 3, items: pointSchema },
        holes: { type: "array", items: { type: "array", minItems: 3, items: pointSchema } },
      },
      additionalProperties: false,
    },
    fingerprint: { type: "string", pattern: "^geom-[0-9a-f]{8}$" },
  },
  $defs: { point: pointSchema, footprint: footprintSchema },
  additionalProperties: false,
};

export const venueConstraintSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/venue-constraint.schema.json",
  title: "VenueMind Constraint",
  type: "object",
  required: ["id", "checkId", "evaluator", "label", "category", "severity", "waivable", "scope", "parameters", "remediation"],
  properties: {
    id: { type: "string", minLength: 1 },
    checkId: { type: "string", minLength: 1 },
    evaluator: { enum: ["minimum_metric", "maximum_metric", "protected_objects_unchanged", "accessible_route_graph", "turning_clearance", "accessible_seating", "accessible_seating_sightlines", "door_clearance", "temporary_ramp", "occupancy_capacity", "circulation_graph", "sightline_raycast", "production_readiness", "catering_readiness", "emergency_readiness"] },
    label: { type: "string", minLength: 1 },
    category: { type: "string", minLength: 1 },
    severity: { enum: ["error", "warning"] },
    waivable: { type: "boolean" },
    enabled: { type: "boolean", default: true },
    scope: {
      type: "object",
      required: ["kind"],
      properties: { kind: { enum: ["plan", "zone", "object"] }, id: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
    parameters: { type: "object", additionalProperties: true },
    policy: {
      type: "object",
      required: ["source", "jurisdiction", "effectiveDate"],
      properties: { source: { type: "string" }, jurisdiction: { type: "string" }, effectiveDate: { type: "string", format: "date" } },
      additionalProperties: false,
    },
    remediation: { type: "string", minLength: 1 },
  },
  allOf: [
    { if: { properties: { severity: { const: "error" } }, required: ["severity"] }, then: { properties: { waivable: { const: false } } } },
    { if: { properties: { severity: { const: "warning" } }, required: ["severity"] }, then: { properties: { waivable: { const: true } } } },
  ],
  additionalProperties: false,
};

export const warningWaiverSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/warning-waiver.schema.json",
  title: "VenueMind Warning Waiver",
  type: "object",
  required: ["id", "constraintId", "proposalId", "baseVersion", "validationInputFingerprint", "authorId", "reasonCode", "createdAt"],
  properties: {
    id: { type: "string", pattern: "^waiver-[a-z0-9-]+-[0-9a-f]{8}$" },
    constraintId: { type: "string", minLength: 1 },
    proposalId: { type: "string", minLength: 1 },
    baseVersion: { type: "string", minLength: 1 },
    validationInputFingerprint: { type: "string", pattern: "^input-[0-9a-f]{8}$" },
    authorId: { type: "string", minLength: 1 },
    reasonCode: { enum: ["operational-acceptance", "temporary-condition", "equivalent-control", "owner-approved-deviation"] },
    createdAt: { type: "string", format: "date-time" },
    acceptedPlanVersion: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
};

export const objectLockSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/object-lock.schema.json",
  title: "VenueMind Object Lock",
  type: "object",
  required: ["id", "objectId", "type", "source", "reasonCode", "authorId", "active"],
  properties: {
    id: { type: "string", minLength: 1 },
    objectId: { type: "string", minLength: 1 },
    type: { enum: ["position", "rotation", "dimension", "deletion", "role"] },
    source: { enum: ["venue-template", "project"] },
    reasonCode: { type: "string", minLength: 1 },
    authorId: { type: "string", minLength: 1 },
    createdAt: { type: "string", format: "date-time" },
    expiresAt: { type: ["string", "null"], format: "date-time" },
    releasedAt: { type: "string", format: "date-time" },
    releasedBy: { type: "string", minLength: 1 },
    active: { type: "boolean" },
  },
  additionalProperties: false,
};

export const venueErrorSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/venue-error.schema.json",
  title: "VenueMind Error",
  type: "object",
  required: ["code", "message", "remediation", "details"],
  properties: {
    code: { enum: Object.keys(errorCatalog) },
    message: { type: "string", minLength: 1 },
    remediation: { type: "string", minLength: 1 },
    details: { type: "object", additionalProperties: true },
  },
  additionalProperties: false,
};

export const spatialEvidenceSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/spatial-evidence.schema.json",
  title: "VenueMind Spatial Evidence",
  type: "object",
  required: ["accessibility", "capacity", "circulation", "sightlines"],
  properties: {
    accessibility: {
      type: "object",
      required: ["source", "graphFingerprint", "connected", "routeObjectIds", "reachableDestinationIds", "unreachableDestinationIds", "minimumClearWidthM", "turningClearanceM", "accessibleSeats", "companionSeats", "seatingDistributed", "accessibleSeatSampleIds", "blockedAccessibleSeatSampleIds", "accessibleSeatSightlineCoverageRatio", "accessibleSeatSightlineSections", "doorClearanceZones", "accessibleDoorObjectIds", "minimumDoorClearWidthM", "obstructedDoorObjectIds", "ramps", "rampPolicy", "nodes", "edges"],
      properties: {
        source: { const: "canonical-geometry" }, graphFingerprint: { pattern: "^graph-[0-9a-f]{8}$" }, connected: { type: "boolean" },
        routeObjectIds: { type: "array", items: { type: "string" } }, reachableDestinationIds: { type: "array", items: { type: "string" } }, unreachableDestinationIds: { type: "array", items: { type: "string" } },
        minimumClearWidthM: { type: "number" }, turningClearanceM: { type: "number" }, accessibleSeats: { type: "integer" }, companionSeats: { type: "integer" }, seatingDistributed: { type: "boolean" },
        accessibleSeatSampleIds: { type: "array", items: { type: "string" } }, blockedAccessibleSeatSampleIds: { type: "array", items: { type: "string" } }, accessibleSeatSightlineCoverageRatio: { type: "number", minimum: 0, maximum: 1 }, accessibleSeatSightlineSections: { type: "array", items: { type: "object" } },
        doorClearanceZones: { type: "array", items: { type: "object" } }, accessibleDoorObjectIds: { type: "array", items: { type: "string" } }, minimumDoorClearWidthM: { type: "number" }, obstructedDoorObjectIds: { type: "array", items: { type: "string" } },
        ramps: { type: "array", items: { type: "object" } }, rampPolicy: { type: "object" },
        nodes: { type: "array", items: { type: "object" } }, edges: { type: "array", items: { type: "object" } },
      },
      additionalProperties: true,
    },
    capacity: {
      type: "object",
      required: ["source", "roomAreaM2", "excludedAreaM2", "usableRoomAreaM2", "occupancyMode", "densityCapacity", "sectionCapacities", "zoneCapacities", "placedCapacity", "venueMaximum", "nonAttendeeLoad", "operationalLoad", "effectiveCapacity", "explanations", "changeDeltas"],
      properties: {
        source: { const: "canonical-geometry" }, roomAreaM2: { type: "number" }, excludedAreaM2: { type: "number" }, usableRoomAreaM2: { type: "number" }, occupancyMode: { type: "string" }, densityCapacity: { type: "integer" },
        sectionCapacities: { type: "array", items: { type: "object", required: ["objectId", "label", "zoneId", "capacity", "minimumCapacity", "maximumCapacity", "status", "deltaFromMinimum", "headroom"], properties: { objectId: { type: "string" }, label: { type: "string" }, zoneId: { type: ["string", "null"] }, capacity: { type: "integer" }, minimumCapacity: { type: "integer" }, maximumCapacity: { type: "integer" }, status: { enum: ["within-limit", "under-target", "over-capacity"] }, deltaFromMinimum: { type: "integer" }, headroom: { type: "integer" } }, additionalProperties: false } },
        zoneCapacities: { type: "array", items: { type: "object", required: ["zoneId", "label", "sectionObjectIds", "capacity", "minimumCapacity", "maximumCapacity", "status", "deltaFromMinimum", "headroom"], properties: { zoneId: { type: "string" }, label: { type: "string" }, sectionObjectIds: { type: "array", items: { type: "string" } }, capacity: { type: "integer" }, minimumCapacity: { type: "integer" }, maximumCapacity: { type: "integer" }, status: { enum: ["within-limit", "under-target", "over-capacity"] }, deltaFromMinimum: { type: "integer" }, headroom: { type: "integer" } }, additionalProperties: false } },
        placedCapacity: { type: "integer" }, venueMaximum: { type: "integer" }, nonAttendeeLoad: { type: "integer" }, operationalLoad: { type: "integer" }, effectiveCapacity: { type: "integer" },
        explanations: { type: "array", items: { type: "object", required: ["code", "scopeKind", "scopeId", "actual", "target", "delta"], properties: { code: { enum: ["SECTION_UNDER_TARGET", "SECTION_OVER_CAPACITY", "ZONE_UNDER_TARGET", "ZONE_OVER_CAPACITY", "PLAN_UNDER_TARGET", "VENUE_OVER_CAPACITY", "DENSITY_OVER_CAPACITY"] }, scopeKind: { enum: ["section", "zone", "plan", "venue"] }, scopeId: { type: "string" }, actual: { type: "integer" }, target: { type: "integer" }, delta: { type: "integer" } }, additionalProperties: false } },
        changeDeltas: { type: "array", items: { type: "object", required: ["changeId", "placedCapacityDelta", "effectiveCapacityDelta", "operationalLoadDelta", "sectionDeltas", "zoneDeltas"], properties: { changeId: { type: "string" }, placedCapacityDelta: { type: "integer" }, effectiveCapacityDelta: { type: "integer" }, operationalLoadDelta: { type: "integer" }, sectionDeltas: { type: "array", items: { type: "object" } }, zoneDeltas: { type: "array", items: { type: "object" } } }, additionalProperties: false } },
      },
      additionalProperties: true,
    },
    circulation: {
      type: "object",
      required: ["source", "graphFingerprint", "connected", "graphNodes", "graphEdges", "blockedRouteObjectIds", "blockingObjectIds", "exitApproachZones", "obstructedExitObjectIds", "criticalRouteEdges", "bottleneckLoads", "bottleneckWidthM", "peakCongestionIndex", "shortestExitPaths", "phaseProfiles", "changeDeltas"],
      properties: {
        source: { const: "canonical-geometry" }, graphFingerprint: { pattern: "^graph-[0-9a-f]{8}$" }, connected: { type: "boolean" }, graphNodes: { type: "array", items: { type: "object" } }, graphEdges: { type: "array", items: { type: "object" } }, blockedRouteObjectIds: { type: "array", items: { type: "string" } }, blockingObjectIds: { type: "array", items: { type: "string" } }, exitApproachZones: { type: "array", items: { type: "object" } }, obstructedExitObjectIds: { type: "array", items: { type: "string" } }, criticalRouteEdges: { type: "array", items: { type: "object" } }, bottleneckLoads: { type: "array", items: { type: "object" } }, bottleneckWidthM: { type: "number" }, peakCongestionIndex: { type: "number" },
        shortestExitPaths: { type: "array", items: { type: "object" } }, phaseProfiles: { type: "array", items: { type: "object" } },
        changeDeltas: { type: "array", items: { type: "object" } },
      },
      additionalProperties: true,
    },
    sightlines: {
      type: "object",
      required: ["source", "evidenceFingerprint", "focalPointId", "sampledSeatIds", "blockedSampleIds", "coverageRatio", "maximumViewingDistanceM", "sectionSummaries", "rays"],
      properties: {
        source: { const: "canonical-geometry" }, evidenceFingerprint: { pattern: "^sightlines-[0-9a-f]{8}$" }, focalPointId: { type: ["string", "null"] }, sampledSeatIds: { type: "array", items: { type: "string" } }, blockedSampleIds: { type: "array", items: { type: "string" } }, coverageRatio: { type: "number", minimum: 0, maximum: 1 }, maximumViewingDistanceM: { type: "number" }, sectionSummaries: { type: "array", items: { type: "object" } }, rays: { type: "array", items: { type: "object" } },
      },
      additionalProperties: true,
    },
  },
  additionalProperties: false,
};

export const validationResultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/validation-result.schema.json",
  title: "VenueMind Validation Result",
  type: "object",
  required: ["validationId", "inputFingerprint", "engineVersion", "evaluatedPlanVersion", "evaluatedProposalId", "status", "checks", "candidateMetrics", "candidateGeometryFingerprint", "spatialEvidence", "productionEvidence", "cateringEvidence", "emergencyEvidence", "evidenceFamilyFingerprints", "planningEvidenceInvalidations", "emergencyReviewRequired", "emergencyChangedObjectIds", "authorizedEmergencyReviewerRoles", "blockingIssues", "waivedWarnings", "unwaivedWarnings", "unresolvedIssues", "inventoryAvailability", "inventoryWarnings"],
  properties: {
    validationId: { type: "string", pattern: "^validation-[0-9a-f]{8}$" },
    inputFingerprint: { type: "string", pattern: "^input-[0-9a-f]{8}$" },
    engineVersion: { type: "string", minLength: 1 },
    evaluatedPlanVersion: { type: "string", minLength: 1 },
    evaluatedProposalId: { type: ["string", "null"] },
    status: { enum: ["pass", "fail"] },
    checks: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "constraintId", "evaluator", "label", "category", "severity", "waivable", "scope", "status", "actual", "threshold", "unit", "evidence", "remediation", "waiver"],
        properties: {
          id: { type: "string", minLength: 1 },
          constraintId: { type: "string", minLength: 1 },
          evaluator: { type: "string", minLength: 1 },
          label: { type: "string", minLength: 1 },
          category: { type: "string", minLength: 1 },
          severity: { enum: ["error", "warning"] },
          waivable: { type: "boolean" },
          scope: { type: "object" },
          status: { enum: ["pass", "warning", "fail", "not-applicable"] },
          actual: { type: ["number", "null"] },
          threshold: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          evidence: { type: "object" },
          remediation: { type: "string" },
          waiver: { anyOf: [{ $ref: warningWaiverSchema.$id }, { type: "null" }] },
        },
        additionalProperties: false,
      },
    },
    candidateMetrics: { type: "object" },
    candidateGeometryFingerprint: { type: "string", pattern: "^geom-[0-9a-f]{8}$" },
    spatialEvidence: { $ref: spatialEvidenceSchema.$id },
    productionEvidence: { type: "object", required: ["schemaVersion", "kind", "planId", "planVersion", "geometryFingerprint", "summary", "evidenceFingerprint"], properties: { schemaVersion: { const: 1 }, kind: { const: "production-planning-result" }, planId: { type: "string" }, planVersion: { type: "string" }, geometryFingerprint: { type: "string" }, summary: { type: "object" }, evidenceFingerprint: { type: "string", pattern: "^production-planning-" } }, additionalProperties: true },
    cateringEvidence: { type: "object", required: ["schemaVersion", "kind", "planId", "planVersion", "geometryFingerprint", "summary", "evidenceFingerprint"], properties: { schemaVersion: { const: 1 }, kind: { const: "catering-planning-result" }, planId: { type: "string" }, planVersion: { type: "string" }, geometryFingerprint: { type: "string" }, summary: { type: "object" }, evidenceFingerprint: { type: "string", pattern: "^catering-planning-" } }, additionalProperties: true },
    emergencyEvidence: { type: "object", required: ["schemaVersion", "kind", "planId", "planVersion", "geometryFingerprint", "summary", "degradedScenarios", "evidenceFingerprint"], properties: { schemaVersion: { const: 1 }, kind: { const: "emergency-planning-result" }, planId: { type: "string" }, planVersion: { type: "string" }, geometryFingerprint: { type: "string" }, summary: { type: "object" }, degradedScenarios: { type: "array", items: { type: "object" } }, evidenceFingerprint: { type: "string", pattern: "^emergency-planning-" } }, additionalProperties: true },
    evidenceFamilyFingerprints: {
      type: "object",
      required: ["accessibility", "capacity", "catering", "emergency", "flow", "operations", "production", "sightlines"],
      properties: Object.fromEntries(["accessibility", "capacity", "catering", "emergency", "flow", "operations", "production", "sightlines"].map((family) => [family, { type: "string", pattern: `^evidence-${family}-[0-9a-f]{8}$` }])),
      additionalProperties: false,
    },
    planningEvidenceInvalidations: {
      type: "object",
      required: ["affectedConstraintIds", "evidenceFamilies"],
      properties: {
        affectedConstraintIds: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
        evidenceFamilies: { type: "array", uniqueItems: true, items: { enum: ["capacity", "flow", "operations"] } },
      },
      additionalProperties: false,
    },
    emergencyReviewRequired: { type: "boolean" },
    emergencyChangedObjectIds: { type: "array", uniqueItems: true, items: { type: "string" } },
    authorizedEmergencyReviewerRoles: { type: "array", uniqueItems: true, items: { enum: ["safety-officer", "venue-administrator"] } },
    blockingIssues: { type: "integer", minimum: 0 },
    waivedWarnings: { type: "integer", minimum: 0 },
    unwaivedWarnings: { type: "integer", minimum: 0 },
    unresolvedIssues: { type: "integer", minimum: 0 },
    inventoryAvailability: { type: "array", items: { type: "object", required: ["id", "templateId", "version", "requested", "available", "status", "shortage"], properties: { id: { type: "string" }, templateId: { type: "string" }, version: { type: "string" }, requested: { type: "integer" }, available: { type: "integer" }, status: { enum: ["available", "warning"] }, shortage: { type: "integer" } }, additionalProperties: false } },
    inventoryWarnings: { type: "integer", minimum: 0 },
  },
  additionalProperties: false,
};

export const commandReceiptSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/command-receipt.schema.json",
  title: "VenueMind Command Receipt",
  type: "object",
  required: ["id", "idempotencyKey", "commandType", "inputFingerprint", "correlationId", "actor", "resultIds", "occurredAt"],
  properties: {
    id: { type: "string", pattern: "^receipt-[0-9]+$" },
    idempotencyKey: { type: "string", minLength: 1 },
    commandType: { type: "string", minLength: 1 },
    inputFingerprint: { type: "string", pattern: "^command-[0-9a-f]{8}$" },
    correlationId: { type: "string", minLength: 1 },
    actor: { enum: ["human", "agent", "system"] },
    resultIds: { type: "object", additionalProperties: { type: "string" } },
    occurredAt: { type: "string", format: "date-time" },
    result: { type: "object", description: "Stored original result used to answer exact retries." },
    error: { type: "object", required: ["code", "message", "remediation", "details"], properties: { code: { type: "string" }, message: { type: "string" }, remediation: { type: "string" }, details: { type: "object" } }, additionalProperties: false },
  },
  additionalProperties: false,
};

export const activityLedgerSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/activity-ledger.schema.json",
  title: "VenueMind Activity Ledger",
  type: "array",
  items: {
    type: "object",
    required: ["id", "schemaVersion", "sequence", "type", "actor", "actorId", "actorType", "source", "sessionId", "occurredAt", "details", "previousHash", "hash"],
    properties: {
      id: { type: "string", pattern: "^ledger-[0-9]+$" },
      schemaVersion: { const: 1 },
      sequence: { type: "integer", minimum: 1 },
      type: { type: "string", minLength: 1 },
      actor: { enum: ["human", "agent", "system"] },
      actorId: { type: "string", minLength: 1 },
      actorType: { enum: ["human", "agent", "system"] },
      source: { enum: ["studio", "webmcp", "mcp", "system", "agent-tool"] },
      sessionId: { type: "string", minLength: 1 },
      occurredAt: { type: "string", format: "date-time" },
      details: { type: "object" },
      previousHash: { anyOf: [{ const: "genesis" }, { type: "string", pattern: "^ledger-[0-9a-f]{8}$" }] },
      hash: { type: "string", pattern: "^ledger-[0-9a-f]{8}$" },
    },
    additionalProperties: false,
  },
};

export const proposalConflictResultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/proposal-conflicts.schema.json",
  title: "VenueMind Proposal Conflicts",
  type: "object",
  required: ["status", "branchId", "proposalId", "stale", "baseVersion", "currentVersion", "conflicts", "blockingConflicts", "validation"],
  properties: {
    status: { enum: ["clear", "conflicts"] },
    branchId: { type: "string", minLength: 1 },
    proposalId: { type: "string", minLength: 1 },
    stale: { type: "boolean" },
    baseVersion: { type: "string", minLength: 1 },
    currentVersion: { type: "string", minLength: 1 },
    conflicts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "type", "severity", "blocking", "baseVersion", "currentVersion", "changeIds", "objectIds", "resolutionOptions"],
        properties: {
          id: { type: "string", minLength: 1 },
          type: { enum: ["stale-base", "deleted-dependency", "lock-conflict", "same-object-edit", "geometry-overlap", "constraint-regression"] },
          severity: { enum: ["error", "warning"] },
          blocking: { type: "boolean" },
          baseVersion: { type: "string" },
          currentVersion: { type: "string" },
          changeIds: { type: "array", items: { type: "string" } },
          objectIds: { type: "array", items: { type: "string" } },
          constraintId: { type: "string" },
          validationId: { type: "string" },
          lockId: { type: "string" },
          lockType: { enum: ["position", "rotation", "dimension", "deletion", "role"] },
          lockSource: { enum: ["venue-template", "project"] },
          resolutionOptions: { type: "array", items: { enum: ["rebase", "drop-change", "keep-proposal", "keep-plan", "manual-resolution", "revise-proposal"] } },
        },
        additionalProperties: false,
      },
    },
    blockingConflicts: { type: "integer", minimum: 0 },
    validation: { $ref: validationResultSchema.$id },
  },
  additionalProperties: false,
};

export const proposalComparisonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/proposal-comparison.schema.json",
  title: "VenueMind Proposal Branch Comparison",
  type: "object",
  required: ["comparisonId", "planVersion", "left", "right", "changeSet", "objectDeltas", "acceptedDeltas", "overlay", "metricDeltas", "constraintDeltas", "improvements", "regressions"],
  properties: {
    comparisonId: { type: "string", pattern: "^comparison-[0-9a-f]{8}$" },
    planVersion: { type: "string", minLength: 1 },
    left: { $ref: "#/$defs/branchSummary" },
    right: { $ref: "#/$defs/branchSummary" },
    changeSet: {
      type: "object",
      required: ["sharedIds", "leftOnlyIds", "rightOnlyIds"],
      properties: {
        sharedIds: { type: "array", items: { type: "string" } },
        leftOnlyIds: { type: "array", items: { type: "string" } },
        rightOnlyIds: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
    objectDeltas: {
      type: "object",
      required: ["addedObjectIds", "removedObjectIds", "movedObjectIds", "rotatedObjectIds", "resizedObjectIds", "metadataObjectIds"],
      properties: Object.fromEntries(["addedObjectIds", "removedObjectIds", "movedObjectIds", "rotatedObjectIds", "resizedObjectIds", "metadataObjectIds"].map((key) => [key, { type: "array", items: { type: "string" } }])),
      additionalProperties: false,
    },
    acceptedDeltas: {
      type: "object",
      required: ["left", "right"],
      properties: {
        left: { $ref: "#/$defs/objectDeltas" },
        right: { $ref: "#/$defs/objectDeltas" },
      },
      additionalProperties: false,
    },
    overlay: {
      type: "object",
      required: ["roomBoundary", "acceptedObjects", "leftObjects", "rightObjects"],
      properties: {
        roomBoundary: { type: "object" },
        acceptedObjects: { type: "array", items: { type: "object" } },
        leftObjects: { type: "array", items: { type: "object" } },
        rightObjects: { type: "array", items: { type: "object" } },
      },
      additionalProperties: false,
    },
    metricDeltas: {
      type: "array",
      items: {
        type: "object",
        required: ["metric", "label", "unit", "left", "right", "delta"],
        properties: { metric: { type: "string" }, label: { type: "string" }, unit: { type: "string" }, left: { type: "number" }, right: { type: "number" }, delta: { type: "number" } },
        additionalProperties: false,
      },
    },
    constraintDeltas: {
      type: "array",
      items: {
        type: "object",
        required: ["constraintId", "label", "category", "leftStatus", "rightStatus", "leftActual", "rightActual", "unit", "outcome"],
        properties: {
          constraintId: { type: "string" }, label: { type: "string" }, category: { type: "string" },
          leftStatus: { enum: ["pass", "warning", "fail", "not-applicable"] }, rightStatus: { enum: ["pass", "warning", "fail", "not-applicable"] },
          leftActual: { type: ["number", "null"] }, rightActual: { type: ["number", "null"] }, unit: { type: ["string", "null"] }, outcome: { enum: ["improved", "regressed", "unchanged"] },
        },
        additionalProperties: false,
      },
    },
    improvements: { type: "array", items: { type: "string" } },
    regressions: { type: "array", items: { type: "string" } },
  },
  $defs: {
    objectDeltas: {
      type: "object",
      required: ["addedObjectIds", "removedObjectIds", "movedObjectIds", "rotatedObjectIds", "resizedObjectIds", "metadataObjectIds"],
      properties: Object.fromEntries(["addedObjectIds", "removedObjectIds", "movedObjectIds", "rotatedObjectIds", "resizedObjectIds", "metadataObjectIds"].map((key) => [key, { type: "array", items: { type: "string" } }])),
      additionalProperties: false,
    },
    branchSummary: {
      type: "object",
      required: ["branchId", "name", "notes", "strategy", "proposalId", "baseVersion", "changedItems", "changeIds", "validationId", "validationStatus", "blockingIssues", "unresolvedIssues", "geometryFingerprint"],
      properties: {
        branchId: { type: "string" }, name: { type: "string" }, notes: { type: "string" }, strategy: { type: "string" }, proposalId: { type: "string" }, baseVersion: { type: "string" }, changedItems: { type: "integer" },
        changeIds: { type: "array", items: { type: "string" } }, validationId: { type: "string" }, validationStatus: { enum: ["pass", "fail"] }, blockingIssues: { type: "integer" }, unresolvedIssues: { type: "integer" }, geometryFingerprint: { pattern: "^geom-[0-9a-f]{8}$" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const eventBriefSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/event-brief.schema.json",
  title: "VenueMind Event Brief",
  type: "object",
  required: ["id", "eventName", "date", "timezone", "venueId", "roomId", "attendeeTarget", "occupancyMode", "requirements"],
  properties: {
    id: { type: "string", minLength: 1 },
    eventName: { type: "string", minLength: 1 },
    date: { type: ["string", "null"], format: "date" },
    timezone: { type: "string", minLength: 1 },
    venueId: { type: ["string", "null"] },
    roomId: { type: ["string", "null"] },
    attendeeTarget: { type: "integer", minimum: 0 },
    occupancyMode: { enum: ["theater", "classroom", "banquet", "standing", "mixed", "custom"] },
    schedule: {
      anyOf: [
        { type: "null" },
        { type: "object", required: ["startAt", "endAt", "timezone"], properties: { startAt: { type: "string", format: "date-time", pattern: RFC3339_INSTANT_PATTERN_SOURCE }, endAt: { type: "string", format: "date-time", pattern: RFC3339_INSTANT_PATTERN_SOURCE }, timezone: { type: "string", minLength: 1 } }, additionalProperties: false },
      ],
    },
    planningEffectBindings: {
      type: "object",
      properties: {
        set_attendance_target: {
          type: "object",
          required: ["targetRequirementId", "category", "affectedConstraintIds"],
          properties: { targetRequirementId: { type: "string", minLength: 1 }, category: { const: "seating" }, affectedConstraintIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } } },
          additionalProperties: false,
        },
        set_event_schedule: {
          type: "object",
          required: ["targetRequirementId", "category", "affectedConstraintIds"],
          properties: { targetRequirementId: { type: "string", minLength: 1 }, category: { const: "staffing" }, affectedConstraintIds: { type: "array", maxItems: 0 } },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    requirements: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "category", "label", "priority", "owner", "status", "measurable", "constraintIds", "evidenceRefs"],
        properties: {
          id: { type: "string", minLength: 1 },
          category: { enum: ["accessibility", "seating", "production", "catering", "staffing", "security", "emergency", "circulation"] },
          label: { type: "string", minLength: 1 },
          priority: { enum: ["critical", "high", "medium", "low"] },
          owner: { type: ["string", "null"] },
          status: { enum: ["open", "confirmed", "satisfied", "waived"] },
          measurable: { type: "boolean" },
          constraintIds: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
          evidenceRefs: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
};

const eventBriefRequirementSchema = eventBriefSchema.properties.requirements.items;
const eventScheduleSchema = eventBriefSchema.properties.schedule.anyOf[1];
const planningEffectSourceSchema = {
  type: "object",
  required: ["adapterId", "sourceSystem", "entityType", "externalId", "sourceVersion", "checksum", "synchronizedAt"],
  properties: {
    adapterId: { type: "string", minLength: 1 }, sourceSystem: { type: "string", minLength: 1 }, entityType: { type: "string", minLength: 1 }, externalId: { type: "string", minLength: 1 }, sourceVersion: { type: "string", minLength: 1 }, checksum: { type: "string", pattern: "^[0-9a-f]{64}$" }, synchronizedAt: { type: "string", format: "date-time", pattern: CANONICAL_UTC_TIMESTAMP_PATTERN_SOURCE },
  },
  additionalProperties: false,
};

const planningEffectProperties = {
  targetBriefId: { type: "string", minLength: 1 },
  targetRequirementId: { type: "string", minLength: 1 },
  requirement: eventBriefRequirementSchema,
  source: planningEffectSourceSchema,
};

export const planningEffectSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/planning-effect.schema.json",
  title: "VenueMind Planning Effect",
  oneOf: [
    {
      type: "object",
      required: ["operation", "targetBriefId", "targetRequirementId", "before", "after", "requirement", "affectedConstraintIds", "evidenceFamilies", "source"],
      properties: {
        operation: { const: "set_attendance_target" }, ...planningEffectProperties,
        before: { type: "integer", minimum: 0 }, after: { type: "integer", minimum: 0 },
        affectedConstraintIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } },
        evidenceFamilies: { type: "array", minItems: 2, maxItems: 2, prefixItems: [{ const: "capacity" }, { const: "flow" }], items: false },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["operation", "targetBriefId", "targetRequirementId", "before", "after", "requirement", "affectedConstraintIds", "evidenceFamilies", "source"],
      properties: {
        operation: { const: "set_event_schedule" }, ...planningEffectProperties,
        before: { anyOf: [{ type: "null" }, eventScheduleSchema] }, after: eventScheduleSchema,
        affectedConstraintIds: { type: "array", maxItems: 0 },
        evidenceFamilies: { type: "array", minItems: 1, maxItems: 1, prefixItems: [{ const: "operations" }], items: false },
      },
      additionalProperties: false,
    },
  ],
};

export const calendarWebhookEventSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/calendar-webhook-event.schema.json",
  title: "VenueMind Calendar Webhook Event",
  type: "object",
  required: ["sourceSystem", "id", "type", "occurredAt", "event"],
  properties: {
    sourceSystem: { type: "string", minLength: 1 }, id: { type: "string", minLength: 1 }, type: { enum: CALENDAR_WEBHOOK_EVENT_TYPES }, occurredAt: { type: "string", format: "date-time", pattern: CANONICAL_UTC_TIMESTAMP_PATTERN_SOURCE },
    event: {
      type: "object",
      required: ["externalId", "sourceVersion", "title", "startAt", "endAt", "timezone", "location", "attendanceTarget", "organizer"],
      properties: {
        externalId: { type: "string", minLength: 1 }, sourceVersion: { type: "string", minLength: 1 }, title: { type: "string", minLength: 1 }, startAt: { type: "string", format: "date-time", pattern: RFC3339_INSTANT_PATTERN_SOURCE }, endAt: { type: "string", format: "date-time", pattern: RFC3339_INSTANT_PATTERN_SOURCE }, timezone: { type: "string", minLength: 1 }, location: { type: "object", required: ["label"], properties: { label: { type: "string", minLength: 1 } }, additionalProperties: false }, attendanceTarget: { type: "integer", minimum: 0 }, organizer: { type: "object", required: ["displayName", "organization", "role"], properties: { displayName: { type: "string", minLength: 1, pattern: NON_CONTACT_LABEL_PATTERN_SOURCE }, organization: { type: "string", minLength: 1, pattern: NON_CONTACT_LABEL_PATTERN_SOURCE }, role: { type: "string", minLength: 1, pattern: NON_CONTACT_LABEL_PATTERN_SOURCE } }, additionalProperties: false },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const commentAnchorSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/comment-anchor.schema.json",
  title: "VenueMind Comment Anchor",
  oneOf: [
    { type: "object", required: ["kind", "planId", "projectId"], properties: { kind: { const: "project" }, planId: { type: "string", minLength: 1 }, projectId: { type: "string", minLength: 1 } }, additionalProperties: false },
    { type: "object", required: ["kind", "planId", "planVersion"], properties: { kind: { const: "plan-version" }, planId: { type: "string", minLength: 1 }, planVersion: { type: "string", minLength: 1 } }, additionalProperties: false },
    { type: "object", required: ["kind", "planId", "proposalId"], properties: { kind: { const: "proposal" }, planId: { type: "string", minLength: 1 }, proposalId: { type: "string", minLength: 1 } }, additionalProperties: false },
    { type: "object", required: ["kind", "planId", "proposalId", "changeId"], properties: { kind: { const: "change" }, planId: { type: "string", minLength: 1 }, proposalId: { type: "string", minLength: 1 }, changeId: { type: "string", minLength: 1 } }, additionalProperties: false },
    { type: "object", required: ["kind", "planId", "constraintId"], properties: { kind: { const: "constraint" }, planId: { type: "string", minLength: 1 }, constraintId: { type: "string", minLength: 1 } }, additionalProperties: false },
    { type: "object", required: ["kind", "planId", "planVersion", "point"], properties: { kind: { const: "coordinate" }, planId: { type: "string", minLength: 1 }, planVersion: { type: "string", minLength: 1 }, point: pointSchema }, additionalProperties: false },
  ],
};

export const commentSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/comment.schema.json",
  title: "VenueMind Comment",
  type: "object",
  required: ["id", "anchor", "body", "mentions", "decisionRelevant", "status", "authorId", "authorType", "createdAt", "updatedAt", "resolvedAt", "resolvedBy", "editHistory"],
  properties: {
    id: { type: "string", pattern: "^comment-[0-9]+$" },
    anchor: { $ref: commentAnchorSchema.$id },
    body: { type: "string", minLength: 1, maxLength: 5000 },
    mentions: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
    decisionRelevant: { type: "boolean" },
    status: { enum: ["open", "resolved"] },
    authorId: { type: "string", minLength: 1 },
    authorType: { enum: ["human", "agent", "system"] },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    resolvedAt: { type: ["string", "null"], format: "date-time" },
    resolvedBy: { type: ["string", "null"] },
    editHistory: { type: "array", items: { type: "object", required: ["body", "mentions", "decisionRelevant", "editedAt", "editedBy"], properties: { body: { type: "string" }, mentions: { type: "array", items: { type: "string" } }, decisionRelevant: { type: "boolean" }, editedAt: { type: "string", format: "date-time" }, editedBy: { type: "string", minLength: 1 } }, additionalProperties: false } },
  },
  additionalProperties: false,
};

const commentAnchorInputSchema = {
  type: "object",
  required: ["kind"],
  properties: {
    kind: { enum: ["project", "plan-version", "proposal", "change", "constraint", "coordinate"] },
    projectId: { type: "string", minLength: 1 },
    planVersion: { type: "string", minLength: 1 },
    proposalId: { type: "string", minLength: 1 },
    changeId: { type: "string", minLength: 1 },
    constraintId: { type: "string", minLength: 1 },
    point: pointSchema,
  },
  additionalProperties: false,
};

const simulationCurvePointSchema = { type: "object", required: ["second", "cumulativeShare"], properties: { second: { type: "number", minimum: 0 }, cumulativeShare: { type: "number", minimum: 0, maximum: 1 } }, additionalProperties: false };
const mobilityProfileSchema = { type: "object", required: ["id", "share"], properties: { id: { type: "string", minLength: 1 }, label: { type: "string" }, share: { type: "number", exclusiveMinimum: 0, maximum: 1 }, speedFactor: { type: "number", exclusiveMinimum: 0 }, accessibleRouteRequired: { type: "boolean" } }, additionalProperties: false };
const ingressEgressInputSchema = {
  type: "object",
  properties: {
    mode: { enum: ["normal", "emergency"] },
    curves: { type: "object", properties: { arrival: { type: "array", minItems: 2, items: simulationCurvePointSchema }, departure: { type: "array", minItems: 2, items: simulationCurvePointSchema } }, additionalProperties: false },
    mobilityProfiles: { type: "array", minItems: 1, items: mobilityProfileSchema },
    assumptions: { type: "object", properties: { normal: { type: "object", properties: { responseDelaySeconds: { type: "number", minimum: 0 }, flowFactor: { type: "number", exclusiveMinimum: 0 }, elevatorsAvailable: { type: "boolean" } }, additionalProperties: false }, emergency: { type: "object", properties: { responseDelaySeconds: { type: "number", minimum: 0 }, flowFactor: { type: "number", exclusiveMinimum: 0 }, elevatorsAvailable: { type: "boolean" } }, additionalProperties: false } }, additionalProperties: false },
  },
  additionalProperties: false,
};

const queueInputSchema = {
  type: "object",
  properties: {
    category: { enum: ["registration", "security", "cloakroom", "food", "beverage", "restroom", "merchandise", "transport"] },
    arrivalRatePerMinute: { type: "number", exclusiveMinimum: 0 },
    serviceRatePerServerMinute: { type: "number", exclusiveMinimum: 0 },
    servers: { type: "integer", minimum: 1 },
    abandonment: { type: "object", properties: { enabled: { type: "boolean" }, meanPatienceSeconds: { type: "number", exclusiveMinimum: 0 } }, additionalProperties: false },
    priorityLanes: { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string", minLength: 1 }, label: { type: "string" }, arrivalShare: { type: "number", exclusiveMinimum: 0, maximum: 1 }, servers: { type: "integer", minimum: 1 }, serviceRatePerServerMinute: { type: "number", exclusiveMinimum: 0 } }, additionalProperties: false } },
    queueObjectId: { type: ["string", "null"] },
    bufferAreaM2: { type: "number", minimum: 0 },
    personAreaM2: { type: "number", exclusiveMinimum: 0 },
  },
  additionalProperties: false,
};

const scenarioInputSchema = {
  type: "object",
  required: ["id", "seed", "horizonSeconds", "inputs"],
  properties: {
    model: { enum: ["operations", "ingress-egress", "queue"] },
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    seed: { type: "integer", minimum: 0, maximum: 4294967295 },
    horizonSeconds: { type: "number", exclusiveMinimum: 0 },
    sampleCount: { type: "integer", minimum: 1, maximum: 10000 },
    phases: { type: "array", minItems: 1, items: { type: "object", required: ["id", "startSecond", "endSecond"], properties: { id: { type: "string", minLength: 1 }, label: { type: "string" }, startSecond: { type: "number", minimum: 0 }, endSecond: { type: "number", exclusiveMinimum: 0 }, demandShare: { type: "number", exclusiveMinimum: 0 } }, additionalProperties: false } },
    inputs: { type: "object", properties: { population: { type: "integer", minimum: 1 }, arrivalRatePerMinute: { type: "number", exclusiveMinimum: 0 }, serviceRatePerMinute: { type: "number", exclusiveMinimum: 0 }, servers: { type: "integer", minimum: 1 }, mobilityFactor: { type: "number", exclusiveMinimum: 0 } }, required: ["population", "arrivalRatePerMinute", "serviceRatePerMinute", "servers"], additionalProperties: false },
    ingressEgress: ingressEgressInputSchema,
    queue: queueInputSchema,
  },
  additionalProperties: false,
};

const baseVenueToolContracts = [
  {
    name: "venue.list_projects",
    description: "List durable VenueMind Projects available to the current authenticated or local host scope without returning full snapshots.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.open_project",
    description: "Select one durable Project as the active Project for this agent session. This never changes accepted Plan truth.",
    annotations: { destructiveHint: false, idempotentHint: true },
    inputSchema: { type: "object", properties: { projectId: { type: "string", minLength: 1 } }, required: ["projectId"], additionalProperties: false },
  },
  {
    name: "venue.inspect_templates",
    description: "Read versioned Venue, Room, and Inventory Item Templates, including starter room types and current inventory availability metadata.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.get_project_brief",
    description: "Read the structured Event Brief, stable Requirement IDs, priorities, ownership, ambiguity flags, and accepted-Plan versus active-Proposal coverage.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.list_constraints",
    description: "List versioned Constraints with current evaluation status, thresholds, policy sources, and remediation metadata.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { category: { type: "string", minLength: 1 }, severity: { enum: ["error", "warning", "preference"] } }, additionalProperties: false },
  },
  {
    name: "venue.inspect_layout",
    description: "Read the active venue plan, stable object IDs, locked objects, constraints, metrics, proposal state, and branch summaries.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.get_object",
    description: "Read one stable object with scoped accepted or Proposal geometry, operational metadata, and effective Locks.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { objectId: { type: "string", minLength: 1 }, scope: { enum: ["accepted", "proposal"], default: "proposal" } }, required: ["objectId"], additionalProperties: false },
  },
  {
    name: "venue.search_objects",
    description: "Search stable venue objects with bounded text, kind, layer, Lock, and accepted-versus-Proposal filters.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { query: { type: "string", maxLength: 200 }, kinds: { type: "array", maxItems: 10, uniqueItems: true, items: { type: "string", minLength: 1 } }, layers: { type: "array", maxItems: 7, uniqueItems: true, items: { enum: ["architecture", "furniture", "access", "production", "catering", "safety", "annotations"] } }, locked: { type: "boolean" }, scope: { enum: ["accepted", "proposal"], default: "proposal" }, limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }, additionalProperties: false },
  },
  {
    name: "venue.preview_revision",
    description: "Create a non-destructive venue revision preview. The result remains pending until a human approves it in VenueMind.",
    inputSchema: {
      type: "object",
      properties: { goal: { type: "string", minLength: 1, description: "The spatial outcome the revision should achieve." }, ...mutationMetadataProperties },
      required: ["goal", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "venue.preview_template_update",
    description: "Create a non-destructive Proposal containing safe Room Template differences while preserving Project Overrides. Human Approval is always required.",
    inputSchema: {
      type: "object",
      properties: { templateId: { type: "string", minLength: 1 }, toVersion: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" }, ...mutationMetadataProperties },
      required: ["templateId", "toVersion", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "venue.apply_edit",
    description: "Create one non-destructive, undoable spatial editing Change for placement, transform, duplication, alignment, distribution, grouping, zoning, paste, or deletion.",
    inputSchema: {
      type: "object",
      properties: {
        edit: { type: "object", required: ["operation"], properties: { operation: { enum: ["place", "move", "rotate", "resize", "duplicate", "align", "distribute", "delete", "group", "ungroup", "create-zone", "edit-zone-vertices", "paste", "apply-layout"] } }, additionalProperties: true },
        ...mutationMetadataProperties,
      },
      required: ["edit", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "venue.measure_objects",
    description: "Measure deterministic center points and pairwise distances for selected Project objects.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { objectIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } } }, required: ["objectIds"], additionalProperties: false },
  },
  {
    name: "venue.validate_layout",
    description: "Validate the visible proposal or committed plan against locks, accessibility, capacity, sightlines, and circulation constraints.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.get_validation_evidence",
    description: "Read deterministic evidence for the current Validation, optionally restricted to stable Constraint IDs.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { validationId: { type: "string", minLength: 1 }, constraintIds: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1 } }, includeSpatialEvidence: { type: "boolean", default: true } }, additionalProperties: false },
  },
  {
    name: "venue.list_proposal_branches",
    description: "Compare proposal branches by base version, change count, validation status, unresolved issues, and projected metrics.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.compare_proposal_branches",
    description: "Compare two Proposal Branches by spatial object differences, Change membership, projected metrics, and deterministic Constraint improvements or regressions.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { leftBranchId: { type: "string", minLength: 1 }, rightBranchId: { type: "string", minLength: 1 } },
      required: ["leftBranchId", "rightBranchId"],
      additionalProperties: false,
    },
  },
  {
    name: "venue.create_proposal_branch",
    description: "Create and activate a non-destructive proposal branch using a balanced, access-first, circulation-first, or sightlines-first strategy.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1 },
        strategy: { type: "string", enum: ["balanced", "access-first", "circulation-first", "sightlines-first"] },
        goal: { type: "string", minLength: 1 },
        ...mutationMetadataProperties,
      },
      required: ["name", "strategy", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "venue.switch_proposal_branch",
    description: "Activate an existing proposal branch in the visible VenueMind workspace without approving it.",
    inputSchema: {
      type: "object",
      properties: { branchId: { type: "string", minLength: 1 }, ...mutationMetadataProperties },
      required: ["branchId", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "venue.update_proposal_branch",
    description: "Update a Proposal Branch name or review notes without changing its Proposal geometry.",
    inputSchema: { type: "object", properties: { branchId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, notes: { type: "string", maxLength: 2000 }, ...mutationMetadataProperties }, required: ["branchId", "idempotencyKey"], additionalProperties: false },
  },
  {
    name: "venue.duplicate_proposal_branch",
    description: "Duplicate the current or a prior Proposal revision into a new active Branch with preserved stable Change IDs.",
    inputSchema: { type: "object", properties: { branchId: { type: "string", minLength: 1 }, proposalId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, ...mutationMetadataProperties }, required: ["branchId", "idempotencyKey"], additionalProperties: false },
  },
  {
    name: "venue.archive_proposal_branch",
    description: "Archive a Proposal Branch without deleting its revisions or audit history.",
    inputSchema: { type: "object", properties: { branchId: { type: "string", minLength: 1 }, ...mutationMetadataProperties }, required: ["branchId", "idempotencyKey"], additionalProperties: false },
  },
  {
    name: "venue.restore_proposal_branch",
    description: "Restore an archived Proposal Branch to the active comparison set.",
    inputSchema: { type: "object", properties: { branchId: { type: "string", minLength: 1 }, ...mutationMetadataProperties }, required: ["branchId", "idempotencyKey"], additionalProperties: false },
  },
  {
    name: "venue.detect_proposal_conflicts",
    description: "Detect stale-base, deleted-dependency, locked-object, same-object, and Constraint-regression conflicts for a Proposal Branch.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { branchId: { type: "string", minLength: 1 } },
      additionalProperties: false,
    },
  },
  {
    name: "venue.rebase_proposal",
    description: "Rebase a stale Proposal Branch onto the latest accepted Plan Version while preserving unchanged stable Change IDs.",
    inputSchema: {
      type: "object",
      properties: { branchId: { type: "string", minLength: 1 }, ...mutationMetadataProperties },
      required: ["branchId", "idempotencyKey"],
      additionalProperties: false,
    },
  },
  {
    name: "venue.request_adjustment",
    description: "Create a new non-destructive Proposal revision recording an agent-requested adjustment. Human Approval is still required.",
    inputSchema: { type: "object", properties: { instruction: { type: "string", minLength: 1, maxLength: 2000 }, ...mutationMetadataProperties }, required: ["instruction", "idempotencyKey"], additionalProperties: false },
  },
  {
    name: "venue.list_comments",
    description: "Read comments by status, author, subject kind, or decision relevance without changing planning state.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { status: { enum: ["open", "resolved"] }, authorId: { type: "string", minLength: 1 }, subjectKind: { enum: ["project", "plan-version", "proposal", "change", "constraint", "coordinate"] }, decisionRelevant: { type: "boolean" } }, additionalProperties: false },
  },
  {
    name: "venue.add_comment",
    description: "Add a non-planning Comment anchored to an immutable VenueMind subject or spatial coordinate.",
    inputSchema: { type: "object", properties: { anchor: commentAnchorInputSchema, body: { type: "string", minLength: 1, maxLength: 5000 }, mentions: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } }, decisionRelevant: { type: "boolean" }, authorId: { type: "string", minLength: 1 }, ...mutationMetadataProperties }, required: ["anchor", "body", "authorId", "idempotencyKey"], additionalProperties: false },
  },
  {
    name: "venue.edit_comment",
    description: "Edit Comment text, mentions, or decision relevance while retaining immutable edit history.",
    inputSchema: { type: "object", properties: { commentId: { type: "string", minLength: 1 }, body: { type: "string", minLength: 1, maxLength: 5000 }, mentions: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } }, decisionRelevant: { type: "boolean" }, authorId: { type: "string", minLength: 1 }, ...mutationMetadataProperties }, required: ["commentId", "body", "authorId", "idempotencyKey"], additionalProperties: false },
  },
  {
    name: "venue.set_comment_status",
    description: "Resolve or reopen a Comment without changing its immutable anchor or planning state.",
    inputSchema: { type: "object", properties: { commentId: { type: "string", minLength: 1 }, status: { enum: ["open", "resolved"] }, authorId: { type: "string", minLength: 1 }, ...mutationMetadataProperties }, required: ["commentId", "status", "authorId", "idempotencyKey"], additionalProperties: false },
  },
  {
    name: "venue.get_change_log",
    description: "Read the ordered human and agent Activity Ledger for the active Plan.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.replay_history",
    description: "Verify the Activity Ledger hash chain and replay accepted Plan transitions against the current Plan fingerprint.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.list_scenarios",
    description: "Read stored immutable Scenario definitions without running a simulation.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.list_scenario_runs",
    description: "Read queued, running, completed, cancelled, and failed Simulation Runs, including progress and partial results.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.get_scenario_result",
    description: "Read one stable Scenario Run and its completed or partial result, with density frames omitted unless explicitly requested.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { runId: { type: "string", minLength: 1 }, includeDensityFrames: { type: "boolean", default: false } }, required: ["runId"], additionalProperties: false },
  },
  {
    name: "venue.run_scenario",
    description: "Run one seeded operations, ingress-egress, or spatial queue Scenario against an exact Proposal Branch geometry. Results never replace deterministic Validation.",
    inputSchema: { type: "object", properties: { scenario: scenarioInputSchema, branchId: { type: "string", minLength: 1 }, ...mutationMetadataProperties }, required: ["scenario", "idempotencyKey"], additionalProperties: false },
  },
  {
    name: "venue.compare_simulations",
    description: "Compare two completed Runs with matching Scenario fingerprints and engine versions across Proposal Branches, including clearance, bottleneck, and accessible-route deltas for flow models.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { leftRunId: { type: "string", minLength: 1 }, rightRunId: { type: "string", minLength: 1 } }, required: ["leftRunId", "rightRunId"], additionalProperties: false },
  },
  {
    name: "venue.export_simulation",
    description: "Export one completed Simulation Run with its normalized Scenario parameters, engine version, input fingerprint, and confidence metadata.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: "object", properties: { runId: { type: "string", minLength: 1 } }, required: ["runId"], additionalProperties: false },
  },
  {
    name: "venue.export_audit_package",
    description: "Export the portable audit package with Plan, Proposal, Validation, receipts, Comments, replay, and hash-chained Activity Ledger evidence.",
    annotations: { readOnlyHint: true },
    inputSchema: emptyObject,
  },
  {
    name: "venue.export_plan",
    description: "Export the validated Plan as JSON, compact text, layered SVG, print-ready plan or emergency PDF, object, inventory, staffing, production, catering, or replenishment CSV, staffing or production SVG, or a portable audit package.",
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { format: { type: "string", enum: ["json", "text", "svg", "pdf", "pdf-emergency", "csv", "csv-objects", "csv-inventory", "csv-staffing", "svg-post-map", "csv-production", "svg-production", "csv-catering-stations", "csv-replenishment", "audit"], default: "json" } },
      additionalProperties: false,
    },
  },
];

export const VENUE_TOOL_CONTRACT_VERSION = "1.2.0";
export const VENUE_TOOL_AUTHORIZATION_SCOPES = Object.freeze(["venue:read", "venue:propose", "venue:comment", "venue:simulate", "venue:export"]);

const authorizationScopeForTool = (name) => {
  if (["venue.add_comment", "venue.edit_comment", "venue.set_comment_status"].includes(name)) return "venue:comment";
  if (["venue.run_scenario", "venue.get_scenario_result", "venue.compare_simulations"].includes(name)) return "venue:simulate";
  if (["venue.export_plan", "venue.export_simulation", "venue.export_audit_package"].includes(name)) return "venue:export";
  if (["venue.preview_revision", "venue.preview_template_update", "venue.apply_edit", "venue.create_proposal_branch", "venue.switch_proposal_branch", "venue.update_proposal_branch", "venue.duplicate_proposal_branch", "venue.archive_proposal_branch", "venue.restore_proposal_branch", "venue.rebase_proposal", "venue.request_adjustment"].includes(name)) return "venue:propose";
  return "venue:read";
};

const limitsForTool = (name) => Object.freeze({
  maximumInputBytes: name === "venue.apply_edit" ? 262144 : name === "venue.run_scenario" ? 131072 : 65536,
  maximumOutputBytes: ["venue.export_plan", "venue.export_audit_package"].includes(name) ? 2000000 : ["venue.inspect_layout", "venue.validate_layout", "venue.get_validation_evidence", "venue.get_scenario_result"].includes(name) ? 1048576 : 262144,
});

const exampleInputForTool = (name) => ({
  "venue.open_project": { projectId: "project-summit-forward" },
  "venue.get_object": { objectId: "obj-av-desk", scope: "proposal" },
  "venue.search_objects": { query: "route", layers: ["access"], limit: 10 },
  "venue.preview_revision": { goal: "Reduce entrance congestion", idempotencyKey: "example-preview-001", correlationId: "example-001" },
  "venue.preview_template_update": { templateId: "room-template-harborview-main-hall", toVersion: "1.1.0", idempotencyKey: "example-template-001" },
  "venue.apply_edit": { edit: { operation: "move", objectIds: ["obj-av-desk"], delta: { x: 1, y: 0 } }, idempotencyKey: "example-edit-001" },
  "venue.measure_objects": { objectIds: ["obj-stage-west", "obj-av-desk"] },
  "venue.get_validation_evidence": { constraintIds: ["constraint-accessible-route"], includeSpatialEvidence: true },
  "venue.compare_proposal_branches": { leftBranchId: "branch-balanced", rightBranchId: "branch-access" },
  "venue.create_proposal_branch": { name: "Access first", strategy: "access-first", goal: "Protect accessible arrival", idempotencyKey: "example-branch-001" },
  "venue.switch_proposal_branch": { branchId: "branch-balanced", idempotencyKey: "example-switch-001" },
  "venue.update_proposal_branch": { branchId: "branch-balanced", notes: "Review access route", idempotencyKey: "example-branch-note-001" },
  "venue.duplicate_proposal_branch": { branchId: "branch-balanced", name: "Balanced copy", idempotencyKey: "example-duplicate-001" },
  "venue.archive_proposal_branch": { branchId: "branch-balanced", idempotencyKey: "example-archive-001" },
  "venue.restore_proposal_branch": { branchId: "branch-balanced", idempotencyKey: "example-restore-001" },
  "venue.detect_proposal_conflicts": { branchId: "branch-balanced" },
  "venue.rebase_proposal": { branchId: "branch-balanced", idempotencyKey: "example-rebase-001" },
  "venue.request_adjustment": { instruction: "Increase rear clearance", idempotencyKey: "example-adjustment-001" },
  "venue.list_comments": { status: "open", decisionRelevant: true },
  "venue.add_comment": { anchor: { kind: "coordinate", planVersion: "3.2", point: { x: 12, y: 8 } }, body: "Review route intersection", authorId: "agent-reviewer", idempotencyKey: "example-comment-001" },
  "venue.edit_comment": { commentId: "comment-0001", body: "Review route intersection before approval", authorId: "agent-reviewer", idempotencyKey: "example-comment-edit-001" },
  "venue.set_comment_status": { commentId: "comment-0001", status: "resolved", authorId: "agent-reviewer", idempotencyKey: "example-comment-status-001" },
  "venue.get_scenario_result": { runId: "simulation-example", includeDensityFrames: false },
  "venue.run_scenario": { scenario: { id: "scenario-example", name: "Arrival peak", seed: 42, horizonSeconds: 1800, sampleCount: 32, inputs: { population: 400, arrivalRatePerMinute: 30, serviceRatePerMinute: 10, servers: 3 } }, branchId: "branch-balanced", idempotencyKey: "example-scenario-001" },
  "venue.compare_simulations": { leftRunId: "simulation-left", rightRunId: "simulation-right" },
  "venue.export_simulation": { runId: "simulation-example" },
  "venue.export_plan": { format: "json" },
}[name] ?? {});

const errorsForTool = (name, contract) => {
  const errors = ["TOOL_SCOPE_REQUIRED", "AUTHORIZATION_DENIED", "AGENT_GRANT_INVALID", "TOOL_PAYLOAD_TOO_LARGE", "TOOL_CALL_CANCELLED", "VENUE_INTERNAL_ERROR"];
  if (contract.inputSchema.required?.includes("idempotencyKey")) errors.push("IDEMPOTENCY_KEY_REQUIRED", "IDEMPOTENCY_KEY_CONFLICT");
  if (["venue.list_projects", "venue.open_project"].includes(name)) errors.push("PROJECT_TOOL_UNAVAILABLE", "PROJECT_NOT_FOUND");
  if (name === "venue.get_object") errors.push("OBJECT_NOT_FOUND");
  if (name === "venue.get_validation_evidence") errors.push("VALIDATION_NOT_FOUND");
  if (name === "venue.get_scenario_result") errors.push("SCENARIO_RUN_NOT_FOUND");
  return Object.freeze([...new Set(errors)]);
};

export const venueToolContracts = Object.freeze(baseVenueToolContracts.map((contract) => Object.freeze({
  ...contract,
  title: contract.name.split(".").at(-1).split("_").map((word) => word[0].toUpperCase() + word.slice(1)).join(" "),
  contractVersion: VENUE_TOOL_CONTRACT_VERSION,
  authorization: Object.freeze({ requiredScope: authorizationScopeForTool(contract.name) }),
  limits: limitsForTool(contract.name),
  exampleInput: Object.freeze(exampleInputForTool(contract.name)),
  errors: errorsForTool(contract.name, contract),
})));

export const venueToolManifestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/venue-tool-manifest.schema.json",
  title: "VenueMind Tool Manifest",
  type: "array",
  items: {
    type: "object",
    required: ["name", "title", "description", "contractVersion", "authorization", "limits", "inputSchema", "exampleInput", "errors"],
    properties: {
      name: { type: "string", pattern: "^venue\\.[a-z0-9_]+$" },
      title: { type: "string", minLength: 1 },
      description: { type: "string", minLength: 1 },
      contractVersion: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" },
      annotations: { type: "object" },
      authorization: { type: "object", required: ["requiredScope"], properties: { requiredScope: { enum: VENUE_TOOL_AUTHORIZATION_SCOPES } }, additionalProperties: false },
      limits: { type: "object", required: ["maximumInputBytes", "maximumOutputBytes"], properties: { maximumInputBytes: { type: "integer", minimum: 1 }, maximumOutputBytes: { type: "integer", minimum: 1 } }, additionalProperties: false },
      inputSchema: { type: "object" },
      exampleInput: { type: "object" },
      errors: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } },
    },
    additionalProperties: false,
  },
};

export const venueCommandSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/venue-command.schema.json",
  title: "VenueMind Command",
  oneOf: [
    { type: "object", properties: { type: { const: "inspect_templates" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "measure_objects" }, objectIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } } }, required: ["type", "objectIds"], additionalProperties: false },
    { type: "object", properties: { type: { const: "inspect_layout" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "get_project_brief" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "list_constraints" }, category: { type: "string", minLength: 1 }, severity: { enum: ["error", "warning", "preference"] } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "get_validation_evidence" }, validationId: { type: "string", minLength: 1 }, constraintIds: { type: "array", maxItems: 50, uniqueItems: true, items: { type: "string", minLength: 1 } }, includeSpatialEvidence: { type: "boolean" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "get_object" }, objectId: { type: "string", minLength: 1 }, scope: { enum: ["accepted", "proposal"] } }, required: ["type", "objectId"], additionalProperties: false },
    { type: "object", properties: { type: { const: "search_objects" }, query: { type: "string", maxLength: 200 }, kinds: { type: "array", maxItems: 10, uniqueItems: true, items: { type: "string", minLength: 1 } }, layers: { type: "array", maxItems: 7, uniqueItems: true, items: { enum: ["architecture", "furniture", "access", "production", "catering", "safety", "annotations"] } }, locked: { type: "boolean" }, scope: { enum: ["accepted", "proposal"] }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "validate_layout" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "list_branches" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "compare_branches" }, leftBranchId: { type: "string", minLength: 1 }, rightBranchId: { type: "string", minLength: 1 } }, required: ["type", "leftBranchId", "rightBranchId"], additionalProperties: false },
    { type: "object", properties: { type: { const: "get_change_log" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "replay_history" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "list_scenarios" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "list_scenario_runs" } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "get_scenario_result" }, runId: { type: "string", minLength: 1 }, includeDensityFrames: { type: "boolean" } }, required: ["type", "runId"], additionalProperties: false },
    { type: "object", properties: { type: { const: "run_scenario" }, scenario: scenarioInputSchema, branchId: { type: "string", minLength: 1 }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "scenario", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "compare_simulations" }, leftRunId: { type: "string", minLength: 1 }, rightRunId: { type: "string", minLength: 1 } }, required: ["type", "leftRunId", "rightRunId"], additionalProperties: false },
    { type: "object", properties: { type: { const: "export_simulation" }, runId: { type: "string", minLength: 1 } }, required: ["type", "runId"], additionalProperties: false },
    { type: "object", properties: { type: { const: "detect_conflicts" }, branchId: { type: "string", minLength: 1 } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "preview_revision" }, goal: { type: "string", minLength: 1 }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "goal", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "preview_template_update" }, templateId: { type: "string", minLength: 1 }, toVersion: { type: "string", pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+$" }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "templateId", "toVersion", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "apply_edit" }, edit: { type: "object", required: ["operation"], properties: { operation: { enum: ["place", "move", "rotate", "resize", "duplicate", "align", "distribute", "delete", "group", "ungroup", "create-zone", "edit-zone-vertices", "paste", "apply-layout"] } }, additionalProperties: true }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "edit", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "create_branch" }, name: { type: "string", minLength: 1 }, strategy: { enum: ["balanced", "access-first", "circulation-first", "sightlines-first"] }, goal: { type: "string" }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "name", "strategy", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "recover_unsynchronized_branch" }, name: { type: "string", minLength: 1 }, proposal: { type: "object" }, sourceRevision: { type: ["integer", "null"], minimum: 1 }, remoteRevision: { type: ["integer", "null"], minimum: 1 }, actor: { const: "human" }, actorId: { type: "string", minLength: 1 }, ...commandExecutionMetadataProperties }, required: ["type", "proposal", "actor", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "record_share_link_created" }, shareLinkId: { type: "string", minLength: 1 }, scope: { enum: ["read-only", "reviewer"] }, proposalId: { type: ["string", "null"] }, expiresAt: { type: "string", format: "date-time" }, actor: { const: "human" }, actorId: { type: "string", minLength: 1 }, ...commandExecutionMetadataProperties }, required: ["type", "shareLinkId", "scope", "expiresAt", "actor", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "record_share_link_revoked" }, shareLinkId: { type: "string", minLength: 1 }, reasonCode: { type: "string", minLength: 1 }, actor: { const: "human" }, actorId: { type: "string", minLength: 1 }, ...commandExecutionMetadataProperties }, required: ["type", "shareLinkId", "actor", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "switch_branch" }, branchId: { type: "string", minLength: 1 }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "branchId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "update_branch_metadata" }, branchId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, notes: { type: "string", maxLength: 2000 }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "branchId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "duplicate_branch" }, branchId: { type: "string", minLength: 1 }, proposalId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "branchId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "archive_branch" }, branchId: { type: "string", minLength: 1 }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "branchId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "restore_branch" }, branchId: { type: "string", minLength: 1 }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "branchId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "record_branch_decision" }, chosenBranchId: { type: "string", minLength: 1 }, rejectedBranchIds: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", minLength: 1 } }, comparisonId: { type: "string", minLength: 1 }, note: { type: "string", maxLength: 2000 }, actor: { const: "human" }, ...commandExecutionMetadataProperties }, required: ["type", "chosenBranchId", "rejectedBranchIds", "actor", "actorId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "list_comments" }, filters: { type: "object", properties: { status: { enum: ["open", "resolved"] }, authorId: { type: "string", minLength: 1 }, subjectKind: { enum: ["project", "plan-version", "proposal", "change", "constraint", "coordinate"] }, decisionRelevant: { type: "boolean" } }, additionalProperties: false } }, required: ["type"], additionalProperties: false },
    { type: "object", properties: { type: { const: "add_comment" }, anchor: commentAnchorInputSchema, body: { type: "string", minLength: 1, maxLength: 5000 }, mentions: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } }, decisionRelevant: { type: "boolean" }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "anchor", "body", "actorId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "edit_comment" }, commentId: { type: "string", minLength: 1 }, body: { type: "string", minLength: 1, maxLength: 5000 }, mentions: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } }, decisionRelevant: { type: "boolean" }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "commentId", "body", "actorId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "set_comment_status" }, commentId: { type: "string", minLength: 1 }, status: { enum: ["open", "resolved"] }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "commentId", "status", "actorId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "request_adjustment" }, instruction: { type: "string", minLength: 1 }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "instruction", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "revert_change" }, changeId: { type: "string", minLength: 1 }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "changeId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "waive_warning" }, constraintId: { type: "string", minLength: 1 }, reasonCode: { enum: ["operational-acceptance", "temporary-condition", "equivalent-control", "owner-approved-deviation"] }, actor: { const: "human" }, ...commandExecutionMetadataProperties }, required: ["type", "constraintId", "reasonCode", "actor", "actorId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "set_object_lock" }, objectId: { type: "string", minLength: 1 }, lockType: { enum: ["position", "rotation", "dimension", "deletion", "role"] }, reasonCode: { type: "string", minLength: 1 }, expiresAt: { type: ["string", "null"], format: "date-time" }, actor: { const: "human" }, ...commandExecutionMetadataProperties }, required: ["type", "objectId", "lockType", "reasonCode", "actor", "actorId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "release_object_lock" }, lockId: { type: "string", minLength: 1 }, actor: { const: "human" }, ...commandExecutionMetadataProperties }, required: ["type", "lockId", "actor", "actorId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "approve_proposal" }, proposalId: { type: "string" }, baseVersion: { type: "string" }, actor: { const: "human" }, emergencyReview: { type: "object", required: ["reviewerId", "reviewerRole", "assumptionsAccepted"], properties: { reviewerId: { type: "string", minLength: 1 }, reviewerRole: { enum: ["safety-officer", "venue-administrator"] }, assumptionsAccepted: { const: true }, note: { type: "string", maxLength: 2000 } }, additionalProperties: false }, ...commandExecutionMetadataProperties }, required: ["type", "proposalId", "baseVersion", "actor", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { enum: ["undo", "redo"] }, actor: { enum: ["human", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "rebase_proposal" }, branchId: { type: "string", minLength: 1 }, actor: { enum: ["human", "agent", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "branchId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "resolve_conflict" }, branchId: { type: "string", minLength: 1 }, conflictId: { type: "string", minLength: 1 }, outcome: { enum: ["keep-proposal", "keep-plan", "manual-resolution"] }, manualChange: { type: "object", properties: { title: { type: "string" }, shortTitle: { type: "string" }, metrics: { type: "array" }, targetObjectIds: { type: "array", items: { type: "string", minLength: 1 } }, spatialEffects: { type: "array", items: { type: "object" } }, effects: { type: "object" } }, required: ["targetObjectIds", "spatialEffects"], additionalProperties: false }, actor: { const: "human" }, ...commandExecutionMetadataProperties }, required: ["type", "branchId", "conflictId", "outcome", "actor", "actorId", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "update_event_brief" }, brief: { $ref: eventBriefSchema.$id }, actor: { enum: ["human", "system"] }, ...commandExecutionMetadataProperties }, required: ["type", "brief", "actor", "idempotencyKey"], additionalProperties: false },
    { type: "object", properties: { type: { const: "restore_snapshot" }, snapshot: { $ref: "https://venuemind.dev/schemas/planner-snapshot.schema.json" } }, required: ["type", "snapshot"], additionalProperties: false },
    { type: "object", properties: { type: { const: "export_plan" }, format: { enum: ["json", "text", "svg", "pdf", "pdf-emergency", "csv", "csv-objects", "csv-inventory", "csv-staffing", "svg-post-map", "csv-production", "svg-production", "csv-catering-stations", "csv-replenishment", "audit"] } }, required: ["type"], additionalProperties: false },
  ],
};

export const scenarioDefinitionSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/scenario-definition.schema.json",
  title: "VenueMind Scenario",
  type: "object",
  required: ["schemaVersion", "model", "id", "name", "seed", "horizonSeconds", "sampleCount", "phases", "inputs", "confidence"],
  properties: {
    schemaVersion: { const: 1 }, model: { enum: ["operations", "ingress-egress", "queue"] }, id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, seed: { type: "integer", minimum: 0, maximum: 4294967295 }, horizonSeconds: { type: "number", exclusiveMinimum: 0 }, sampleCount: { type: "integer", minimum: 1, maximum: 10000 },
    phases: { type: "array", minItems: 1, items: { type: "object", required: ["id", "label", "startSecond", "endSecond", "demandShare"], properties: { id: { type: "string" }, label: { type: "string" }, startSecond: { type: "number" }, endSecond: { type: "number" }, demandShare: { type: "number", exclusiveMinimum: 0 } }, additionalProperties: false } },
    inputs: { type: "object", required: ["population", "arrivalRatePerMinute", "serviceRatePerMinute", "servers", "mobilityFactor"], properties: { population: { type: "integer", minimum: 1 }, arrivalRatePerMinute: { type: "number", exclusiveMinimum: 0 }, serviceRatePerMinute: { type: "number", exclusiveMinimum: 0 }, servers: { type: "integer", minimum: 1 }, mobilityFactor: { type: "number", exclusiveMinimum: 0 } }, additionalProperties: false },
    ingressEgress: ingressEgressInputSchema,
    queue: queueInputSchema,
    confidence: { type: "object", required: ["method", "level", "uncertaintyDrivers"], properties: { method: { const: "seeded-percentile-sampling" }, level: { type: "number", minimum: 0, maximum: 1 }, uncertaintyDrivers: { type: "array", items: { type: "string" } } }, additionalProperties: false },
  },
  allOf: [{ if: { properties: { model: { const: "ingress-egress" } }, required: ["model"] }, then: { required: ["ingressEgress"] } }, { if: { properties: { model: { const: "queue" } }, required: ["model"] }, then: { required: ["queue"] } }],
  additionalProperties: false,
};

export const simulationResultSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/simulation-result.schema.json",
  title: "VenueMind Simulation Result",
  type: "object",
  required: ["schemaVersion", "kind", "model", "engineVersion", "inputFingerprint", "scenarioFingerprint", "scenarioId", "planId", "planVersion", "geometryFingerprint", "seed", "horizonSeconds", "sampleCount", "confidence", "phases", "summary"],
  properties: {
    schemaVersion: { const: 1 }, kind: { const: "simulation-result" }, model: { enum: ["operations", "ingress-egress", "queue"] }, engineVersion: { type: "string" }, inputFingerprint: { type: "string", pattern: "^simulation-input-" }, scenarioFingerprint: { type: "string", pattern: "^scenario-definition-" }, scenarioId: { type: "string" }, planId: { type: "string" }, planVersion: { type: "string" }, geometryFingerprint: { type: "string" }, branchId: { type: ["string", "null"] }, seed: { type: "integer" }, horizonSeconds: { type: "number" }, sampleCount: { type: "integer" }, completedSamples: { type: "integer", minimum: 1 }, confidence: { type: "object" }, phases: { type: "array", items: { type: "object" } }, summary: { type: "object" },
    infrastructure: { type: "object", required: ["entrances", "exits", "checkpoints", "doors", "stairs", "elevators", "corridors", "sections", "graphFingerprint", "fingerprint"], properties: { entrances: { type: "array", items: { type: "object" } }, exits: { type: "array", items: { type: "object" } }, checkpoints: { type: "array", items: { type: "object" } }, doors: { type: "array", items: { type: "object" } }, stairs: { type: "array", items: { type: "object" } }, elevators: { type: "array", items: { type: "object" } }, corridors: { type: "array", items: { type: "object" } }, sections: { type: "array", items: { type: "object" } }, graphFingerprint: { type: "string" }, fingerprint: { type: "string" } }, additionalProperties: false },
    ingress: { type: "object" },
    egress: { type: "object" },
    assumptions: { type: "object", required: ["normal", "emergency"], properties: { normal: { type: "object" }, emergency: { type: "object" } }, additionalProperties: false },
    assumptionComparison: { type: "object" },
    densityFrames: { type: "array", items: { type: "object", required: ["id", "second", "progress", "cells", "peakDensityPersonsPerM2"], properties: { id: { type: "string" }, second: { type: "number" }, progress: { type: "number", minimum: 0, maximum: 1 }, cells: { type: "array", items: { type: "object", required: ["id", "objectId", "kind", "point", "occupancyPersons", "densityPersonsPerM2", "level"], properties: { id: { type: "string" }, objectId: { type: "string" }, kind: { enum: ["zone", "route"] }, point: pointSchema, occupancyPersons: { type: "number", minimum: 0 }, densityPersonsPerM2: { type: "number", minimum: 0 }, level: { enum: ["low", "medium", "high", "critical"] } }, additionalProperties: false } }, peakDensityPersonsPerM2: { type: "number", minimum: 0 } }, additionalProperties: false } },
    queue: { type: "object" }, lanes: { type: "array", items: { type: "object" } }, timeline: { type: "array", items: { type: "object" } }, spill: { type: "object" }, suggestion: { type: "object" }, evidenceFingerprint: { type: "string" },
  },
  additionalProperties: false,
};

const persistedProposalSchema = {
  type: "object",
  required: ["changes", "waivers"],
  properties: {
    changes: { type: "array", items: { type: "object", properties: { planningEffects: { type: "array", items: { $ref: planningEffectSchema.$id } } }, additionalProperties: true } },
    waivers: { type: "array", items: { $ref: warningWaiverSchema.$id } },
  },
  additionalProperties: true,
};

export const plannerSnapshotSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/planner-snapshot.schema.json",
  title: "VenueMind Planner Snapshot",
  type: "object",
  required: ["plan", "brief", "proposal", "activeBranchId", "branches", "ledger", "receipts", "projectLocks", "scenarios", "scenarioRuns"],
  properties: {
    plan: {
      type: "object",
      required: ["id", "version", "event", "venue", "spatial", "objects", "constraints", "metrics"],
      properties: {
        id: { type: "string", minLength: 1 },
        version: { type: "string", minLength: 1 },
        event: { type: "object" },
        venue: { type: "object" },
        occupancy: occupancyPolicySchema,
        staffing: { type: "object" },
        productionPolicy: { type: "object" },
        cateringPolicy: { type: "object" },
        emergencyPlan: { type: "object" },
        emergencyReviews: { type: "array", items: emergencyReviewSchema },
        spatial: { $ref: spatialGeometrySchema.$id },
        objects: {
          type: "array",
          items: {
            type: "object",
            required: ["id", "kind", "label", "layer", "elevationM", "footprint", "locked", "locks"],
            properties: {
              id: { type: "string", minLength: 1 },
              kind: { enum: ["stage", "screen", "projector", "speaker", "camera", "cable_route", "backstage_zone", "fire_exit", "assembly_point", "emergency_access_lane", "fire_equipment", "first_aid", "command_post", "entrance", "column", "table", "chair", "av_desk", "refreshment", "bar", "buffet", "kitchen", "prep_zone", "waste_point", "water_point", "barrier", "signage", "queue", "staff_post", "checkpoint", "stairs", "elevator", "utility_point", "rigging_point", "accessible_entrance", "seating_section", "accessible_restroom", "accessible_route", "door", "corridor", "aisle", "service_lane", "restricted_zone", "temporary_ramp"] },
              label: { type: "string", minLength: 1 },
              layer: { enum: ["architecture", "furniture", "access", "production", "catering", "safety", "annotations"] },
              elevationM: { type: "number", minimum: 0 },
              footprint: { $ref: `${spatialGeometrySchema.$id}#/$defs/footprint` },
              locked: { type: "boolean" },
              locks: { type: "array", items: { $ref: objectLockSchema.$id } },
              door: doorMetadataSchema,
              exit: exitMetadataSchema,
              route: routeMetadataSchema,
              restriction: restrictionMetadataSchema,
              ramp: rampMetadataSchema,
              placement: placementMetadataSchema,
              circulation: circulationMetadataSchema,
              queue: queueMetadataSchema,
              staffPost: staffPostMetadataSchema,
              utility: utilityMetadataSchema,
              rigging: riggingMetadataSchema,
              productionZone: productionZoneMetadataSchema,
              production: productionMetadataSchema,
              catering: cateringMetadataSchema,
              emergency: emergencyMetadataSchema,
              templateRef: templateRefSchema,
              templateOverrides: { type: "array", uniqueItems: true, items: { type: "string", minLength: 1 } },
              inventoryCount: { type: "integer", minimum: 1 },
            },
            allOf: [
              { if: { properties: { kind: { const: "door" } }, required: ["kind"] }, then: { required: ["door"], properties: { footprint: { type: "object", properties: { kind: { const: "line" } }, required: ["kind"] } } } },
              { if: { properties: { kind: { const: "fire_exit" } }, required: ["kind"] }, then: { required: ["exit"], properties: { footprint: { type: "object", properties: { kind: { const: "line" } }, required: ["kind"] } } } },
              { if: { properties: { kind: { enum: ["accessible_route", "corridor", "aisle", "service_lane"] } }, required: ["kind"] }, then: { required: ["route"], properties: { footprint: { type: "object", properties: { kind: { const: "line" } }, required: ["kind"] } } } },
              { if: { properties: { kind: { const: "restricted_zone" } }, required: ["kind"] }, then: { required: ["restriction"], properties: { footprint: { type: "object", properties: { kind: { enum: ["rectangle", "polygon"] } }, required: ["kind"] } } } },
              { if: { properties: { kind: { const: "temporary_ramp" } }, required: ["kind"] }, then: { required: ["ramp"], properties: { footprint: { type: "object", properties: { kind: { const: "line" } }, required: ["kind"] } } } },
              { if: { properties: { kind: { const: "staff_post" } }, required: ["kind"] }, then: { required: ["staffPost"] } },
              { if: { properties: { kind: { const: "utility_point" } }, required: ["kind"] }, then: { required: ["utility"] } },
              { if: { properties: { kind: { const: "rigging_point" } }, required: ["kind"] }, then: { required: ["rigging"] } },
              { if: { properties: { kind: { const: "backstage_zone" } }, required: ["kind"] }, then: { required: ["productionZone"] } },
              { if: { properties: { kind: { const: "cable_route" } }, required: ["kind"] }, then: { required: ["production"], properties: { footprint: { type: "object", properties: { kind: { const: "line" } }, required: ["kind"] } } } },
              { if: { properties: { kind: { enum: ["bar", "buffet", "kitchen", "prep_zone", "waste_point", "water_point"] } }, required: ["kind"] }, then: { required: ["catering"] } },
              { if: { properties: { kind: { enum: ["assembly_point", "emergency_access_lane", "fire_equipment", "first_aid", "command_post"] } }, required: ["kind"] }, then: { required: ["emergency"] } },
            ],
            additionalProperties: true,
          },
        },
        constraints: { type: "array", items: { $ref: venueConstraintSchema.$id } },
        waivers: { type: "array", items: { $ref: warningWaiverSchema.$id } },
        metrics: { type: "object" },
      },
      additionalProperties: true,
    },
    brief: { $ref: eventBriefSchema.$id },
    proposal: { ...persistedProposalSchema, required: ["id", "baseVersion", "status", "changes", "waivers"] },
    activeBranchId: { type: "string", minLength: 1 },
    branches: { type: "array", minItems: 1, items: { type: "object", required: ["id", "name", "strategy", "proposal"], properties: { proposal: persistedProposalSchema, revisions: { type: "array", items: persistedProposalSchema } }, additionalProperties: true } },
    ledger: { $ref: activityLedgerSchema.$id },
    receipts: { type: "array", items: { $ref: commandReceiptSchema.$id } },
    projectLocks: { type: "array", items: { $ref: objectLockSchema.$id } },
    editHistory: { type: "object", required: ["undo", "redo"], properties: { undo: { type: "array", items: { type: "object" } }, redo: { type: "array", items: { type: "object" } } }, additionalProperties: false },
    comments: { type: "array", items: { $ref: commentSchema.$id } },
    scenarios: { type: "array", items: { $ref: scenarioDefinitionSchema.$id } },
    scenarioRuns: { type: "array", items: { type: "object", required: ["id", "scenarioId", "branchId", "inputFingerprint", "engineVersion", "status", "progress"], properties: { id: { type: "string" }, scenarioId: { type: "string" }, scenarioFingerprint: { type: ["string", "null"] }, scenarioSnapshot: { $ref: scenarioDefinitionSchema.$id }, model: { enum: ["operations", "ingress-egress", "queue"] }, branchId: { type: "string" }, planId: { type: "string" }, planVersion: { type: "string" }, geometryFingerprint: { type: "string" }, inputFingerprint: { type: "string" }, engineVersion: { type: "string" }, status: { enum: ["queued", "running", "completed", "cancelled", "failed"] }, progress: { type: "number", minimum: 0, maximum: 1 }, completedPhaseIds: { type: "array", items: { type: "string" } }, partialResult: { anyOf: [{ $ref: simulationResultSchema.$id }, { type: "null" }] }, result: { anyOf: [{ $ref: simulationResultSchema.$id }, { type: "null" }] }, startedAt: { type: "string", format: "date-time" }, completedAt: { type: ["string", "null"], format: "date-time" }, cancellationReason: { type: ["string", "null"] }, cacheHit: { type: "boolean" } }, additionalProperties: false } },
  },
  additionalProperties: false,
};

export const projectRecordSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/project-record.schema.json",
  title: "VenueMind Project Record",
  type: "object",
  required: ["id", "organizationId", "name", "activePlanId", "schemaVersion", "snapshot", "createdAt", "updatedAt", "revision"],
  properties: {
    id: { type: "string", minLength: 1 },
    organizationId: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    activePlanId: { type: "string", minLength: 1 },
    schemaVersion: { const: 10 },
    snapshot: { $ref: plannerSnapshotSchema.$id },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    revision: { type: "integer", minimum: 1 },
    archivedAt: { type: ["string", "null"], format: "date-time" },
    deletedAt: { type: ["string", "null"], format: "date-time" },
    recoveryUntil: { type: ["string", "null"], format: "date-time" },
    pinned: { type: "boolean" },
    lastOpenedAt: { type: ["string", "null"], format: "date-time" },
    provenance: {
      type: "object",
      required: ["sourceFormat", "formatVersion", "packageId", "payloadSha256", "exportedAt", "importedAt", "originalProjectId", "source"],
      properties: {
        sourceFormat: { const: "venuemind-project" }, formatVersion: { const: 1 }, packageId: { type: "string", pattern: "^package-[0-9a-f]{16}$" }, payloadSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        exportedAt: { type: "string", format: "date-time" }, importedAt: { type: "string", format: "date-time" }, originalProjectId: { type: "string", minLength: 1 }, source: { type: "object" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export const venueProjectPackageSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://venuemind.dev/schemas/venue-project-package.schema.json",
  title: "VenueMind Interchange Package",
  type: "object",
  required: ["format", "formatVersion", "manifest", "project"],
  properties: {
    format: { const: "venuemind-project" },
    formatVersion: { const: 1 },
    manifest: {
      type: "object",
      required: ["packageId", "exportedAt", "payloadBytes", "payloadSha256", "manifestSha256", "source"],
      properties: {
        packageId: { type: "string", pattern: "^package-[0-9a-f]{16}$" },
        exportedAt: { type: "string", format: "date-time" },
        payloadBytes: { type: "integer", minimum: 1, maximum: 2000000 },
        payloadSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        manifestSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
        source: {
          type: "object",
          required: ["application", "projectId", "projectSchemaVersion"],
          properties: {
            application: { type: "string", minLength: 1 }, applicationVersion: { type: "string" }, projectId: { type: "string", minLength: 1 }, projectSchemaVersion: { type: "integer", minimum: 1, maximum: 10 }, external: { type: "object", additionalProperties: true },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    project: {
      type: "object",
      required: ["id", "name", "activePlanId", "schemaVersion", "snapshot", "createdAt", "updatedAt"],
      properties: {
        id: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, activePlanId: { type: "string", minLength: 1 }, schemaVersion: { type: "integer", minimum: 1, maximum: 10 }, snapshot: { $ref: plannerSnapshotSchema.$id }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" }, provenance: projectRecordSchema.properties.provenance,
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

export function commandForVenueTool(name, input = {}, source = "agent-tool") {
  if (name === "venue.inspect_templates") return { type: "inspect_templates" };
  if (name === "venue.get_project_brief") return { type: "get_project_brief" };
  if (name === "venue.list_constraints") return { type: "list_constraints", category: input.category, severity: input.severity };
  if (name === "venue.inspect_layout") return { type: "inspect_layout" };
  if (name === "venue.get_object") return { type: "get_object", objectId: input.objectId, scope: input.scope ?? "proposal" };
  if (name === "venue.search_objects") return { type: "search_objects", query: input.query, kinds: input.kinds, layers: input.layers, locked: input.locked, scope: input.scope ?? "proposal", limit: input.limit ?? 20 };
  if (name === "venue.preview_revision") return { type: "preview_revision", goal: input.goal, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.preview_template_update") return { type: "preview_template_update", templateId: input.templateId, toVersion: input.toVersion, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.apply_edit") return { type: "apply_edit", edit: input.edit, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.measure_objects") return { type: "measure_objects", objectIds: input.objectIds };
  if (name === "venue.validate_layout") return { type: "validate_layout" };
  if (name === "venue.get_validation_evidence") return { type: "get_validation_evidence", validationId: input.validationId, constraintIds: input.constraintIds, includeSpatialEvidence: input.includeSpatialEvidence ?? true };
  if (name === "venue.list_proposal_branches") return { type: "list_branches" };
  if (name === "venue.compare_proposal_branches") return { type: "compare_branches", leftBranchId: input.leftBranchId, rightBranchId: input.rightBranchId };
  if (name === "venue.create_proposal_branch") return { type: "create_branch", name: input.name, strategy: input.strategy, goal: input.goal, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.switch_proposal_branch") return { type: "switch_branch", branchId: input.branchId, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.update_proposal_branch") return { type: "update_branch_metadata", branchId: input.branchId, name: input.name, notes: input.notes, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.duplicate_proposal_branch") return { type: "duplicate_branch", branchId: input.branchId, proposalId: input.proposalId, name: input.name, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.archive_proposal_branch") return { type: "archive_branch", branchId: input.branchId, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.restore_proposal_branch") return { type: "restore_branch", branchId: input.branchId, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.detect_proposal_conflicts") return { type: "detect_conflicts", branchId: input.branchId };
  if (name === "venue.rebase_proposal") return { type: "rebase_proposal", branchId: input.branchId, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.request_adjustment") return { type: "request_adjustment", instruction: input.instruction, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.list_comments") return { type: "list_comments", filters: { status: input.status, authorId: input.authorId, subjectKind: input.subjectKind, decisionRelevant: input.decisionRelevant } };
  if (name === "venue.add_comment") return { type: "add_comment", anchor: input.anchor, body: input.body, mentions: input.mentions, decisionRelevant: input.decisionRelevant, actor: "agent", actorId: input.authorId, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.edit_comment") return { type: "edit_comment", commentId: input.commentId, body: input.body, mentions: input.mentions, decisionRelevant: input.decisionRelevant, actor: "agent", actorId: input.authorId, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.set_comment_status") return { type: "set_comment_status", commentId: input.commentId, status: input.status, actor: "agent", actorId: input.authorId, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.get_change_log") return { type: "get_change_log" };
  if (name === "venue.replay_history") return { type: "replay_history" };
  if (name === "venue.list_scenarios") return { type: "list_scenarios" };
  if (name === "venue.list_scenario_runs") return { type: "list_scenario_runs" };
  if (name === "venue.get_scenario_result") return { type: "get_scenario_result", runId: input.runId, includeDensityFrames: input.includeDensityFrames ?? false };
  if (name === "venue.run_scenario") return { type: "run_scenario", scenario: input.scenario, branchId: input.branchId, actor: "agent", idempotencyKey: input.idempotencyKey, correlationId: input.correlationId, source, sessionId: input.correlationId ?? "agent-session" };
  if (name === "venue.compare_simulations") return { type: "compare_simulations", leftRunId: input.leftRunId, rightRunId: input.rightRunId };
  if (name === "venue.export_simulation") return { type: "export_simulation", runId: input.runId };
  if (name === "venue.export_audit_package") return { type: "export_plan", format: "audit" };
  if (name === "venue.export_plan") return { type: "export_plan", format: input.format ?? "json" };
  throw new Error(`Unsupported VenueMind tool: ${name}`);
}
