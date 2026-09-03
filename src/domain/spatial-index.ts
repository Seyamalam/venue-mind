import type { Footprint, Point, VenueObject } from "./geometry.ts";

export interface SpatialBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface SpatialIndexEvidence {
  readonly objectCount: number;
  readonly cellCount: number;
  readonly cellSizeM: number;
}

const rotate = (point: Point, center: Point, degrees: number): Point => {
  const radians = (-degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine };
};

export const spatialBoundsFromPoints = (points: readonly Point[]): SpatialBounds => {
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
};

export function footprintBounds(footprint: Footprint): SpatialBounds {
  if (footprint.kind === "circle")
    return {
      minX: footprint.center.x - footprint.radius,
      minY: footprint.center.y - footprint.radius,
      maxX: footprint.center.x + footprint.radius,
      maxY: footprint.center.y + footprint.radius,
    };
  if (footprint.kind === "line") {
    const halfWidth = footprint.width / 2;
    return {
      minX: Math.min(footprint.start.x, footprint.end.x) - halfWidth,
      minY: Math.min(footprint.start.y, footprint.end.y) - halfWidth,
      maxX: Math.max(footprint.start.x, footprint.end.x) + halfWidth,
      maxY: Math.max(footprint.start.y, footprint.end.y) + halfWidth,
    };
  }
  if (footprint.kind === "polygon") return spatialBoundsFromPoints(footprint.points);
  const halfWidth = footprint.width / 2;
  const halfDepth = footprint.depth / 2;
  return spatialBoundsFromPoints(
    [
      { x: footprint.center.x - halfWidth, y: footprint.center.y - halfDepth },
      { x: footprint.center.x + halfWidth, y: footprint.center.y - halfDepth },
      { x: footprint.center.x + halfWidth, y: footprint.center.y + halfDepth },
      { x: footprint.center.x - halfWidth, y: footprint.center.y + halfDepth },
    ].map((point) => rotate(point, footprint.center, footprint.rotationDegrees)),
  );
}

export const spatialBoundsOverlap = (left: SpatialBounds, right: SpatialBounds): boolean =>
  left.minX <= right.maxX && left.maxX >= right.minX && left.minY <= right.maxY && left.maxY >= right.minY;

const cellKey = (x: number, y: number): string => `${x}:${y}`;

export interface SpatialIndex<Item extends { readonly id: string; readonly footprint: Footprint }> {
  queryBounds(bounds: SpatialBounds): Item[];
  queryFootprint(footprint: Footprint): Item[];
  queryPoint(point: Point): Item[];
  queryCollisions(
    footprint: Footprint,
    exactIntersection: (left: Footprint, right: Footprint) => boolean,
    excludedId?: string,
  ): Item[];
  evidence(): SpatialIndexEvidence;
}

export function createSpatialIndex<Item extends { readonly id: string; readonly footprint: Footprint }>(
  items: readonly Item[],
  { cellSizeM = 4 }: { readonly cellSizeM?: number } = {},
): SpatialIndex<Item> {
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) throw new Error("Spatial index cellSizeM must be positive");
  const cells = new Map<string, Item[]>();
  const boundsById = new Map<string, SpatialBounds>();
  const cellRange = (bounds: SpatialBounds): readonly [number, number, number, number] => [
    Math.floor(bounds.minX / cellSizeM),
    Math.floor(bounds.maxX / cellSizeM),
    Math.floor(bounds.minY / cellSizeM),
    Math.floor(bounds.maxY / cellSizeM),
  ];
  for (const item of items) {
    if (boundsById.has(item.id)) throw new Error(`Duplicate spatial object ID: ${item.id}`);
    const bounds = footprintBounds(item.footprint);
    boundsById.set(item.id, bounds);
    const [minCellX, maxCellX, minCellY, maxCellY] = cellRange(bounds);
    for (let x = minCellX; x <= maxCellX; x += 1)
      for (let y = minCellY; y <= maxCellY; y += 1) {
        const key = cellKey(x, y);
        cells.set(key, [...(cells.get(key) ?? []), item]);
      }
  }
  const queryBounds = (bounds: SpatialBounds): Item[] => {
    const candidates = new Map<string, Item>();
    const [minCellX, maxCellX, minCellY, maxCellY] = cellRange(bounds);
    for (let x = minCellX; x <= maxCellX; x += 1)
      for (let y = minCellY; y <= maxCellY; y += 1)
        for (const item of cells.get(cellKey(x, y)) ?? []) {
          const itemBounds = boundsById.get(item.id);
          if (itemBounds && spatialBoundsOverlap(bounds, itemBounds)) candidates.set(item.id, item);
        }
    return [...candidates.values()].sort((left, right) => left.id.localeCompare(right.id));
  };
  return Object.freeze({
    queryBounds,
    queryFootprint: (footprint: Footprint) => queryBounds(footprintBounds(footprint)),
    queryPoint: (point: Point) => queryBounds({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }),
    queryCollisions: (
      footprint: Footprint,
      exactIntersection: (left: Footprint, right: Footprint) => boolean,
      excludedId?: string,
    ) =>
      queryBounds(footprintBounds(footprint)).filter(
        (item) => item.id !== excludedId && exactIntersection(footprint, item.footprint),
      ),
    evidence: () => Object.freeze({ objectCount: items.length, cellCount: cells.size, cellSizeM }),
  });
}

export const createVenueObjectSpatialIndex = (
  objects: readonly VenueObject[],
  options?: { readonly cellSizeM?: number },
): SpatialIndex<VenueObject> => createSpatialIndex(objects, options);
