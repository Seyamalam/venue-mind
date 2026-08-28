export const FLOOR_PLAN_REFERENCE_AUTHORITY = "reference-only";

const definitions = [
  {
    id: "dxf-reference-v1",
    mediaTypes: ["application/dxf", "image/vnd.dxf"],
    extensions: [".dxf"],
    mode: "vector-reference",
    supportedEntities: ["LINE", "LWPOLYLINE", "POLYLINE", "ARC", "CIRCLE", "INSERT", "TEXT", "MTEXT"],
    limits: { maximumBytes: 20_000_000, maximumEntities: 100_000 },
  },
  {
    id: "pdf-trace-reference-v1",
    mediaTypes: ["application/pdf"],
    extensions: [".pdf"],
    mode: "assisted-trace",
    supportedEntities: ["vector-path", "raster-contour", "ocr-label"],
    limits: { maximumBytes: 20_000_000, maximumPages: 50, maximumSelectedPages: 1, maximumPixels: 40_000_000 },
  },
].map((definition) => Object.freeze({
  ...definition,
  authority: FLOOR_PLAN_REFERENCE_AUTHORITY,
  requiresHumanCalibration: true,
  plannerMutationAllowed: false,
}));

export const floorPlanReferenceAdapters = Object.freeze(definitions);

export const inspectFloorPlanReferenceAdapters = () => definitions.map((definition) => structuredClone(definition));

export function createFloorPlanReferenceIntake(adapterId, source) {
  const adapter = definitions.find((definition) => definition.id === adapterId);
  if (!adapter) throw new Error(`Unknown floor-plan reference adapter: ${adapterId}`);
  if (!source?.fingerprint || typeof source.fingerprint !== "string") throw new Error("Floor-plan reference requires a source fingerprint");
  if (!Number.isInteger(source.bytes) || source.bytes < 1 || source.bytes > adapter.limits.maximumBytes) throw new Error("Floor-plan reference size is invalid");
  if (!adapter.mediaTypes.includes(source.mediaType)) throw new Error(`Unsupported media type for ${adapterId}`);
  return {
    id: `reference-${source.fingerprint.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 24)}`,
    adapterId: adapter.id,
    authority: FLOOR_PLAN_REFERENCE_AUTHORITY,
    status: "calibration-required",
    source: {
      fingerprint: source.fingerprint,
      mediaType: source.mediaType,
      bytes: source.bytes,
      ...(source.filename ? { filename: String(source.filename) } : {}),
    },
    transform: null,
    calibration: null,
    candidateGeometry: null,
    warnings: ["Reference geometry cannot mutate a Plan before calibration, review, Proposal creation, Validation, and human Approval."],
  };
}
