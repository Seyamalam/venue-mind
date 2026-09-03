import assert from "node:assert/strict";
import test from "node:test";
import { footprintsIntersect } from "../src/domain/spatial-analysis.ts";
import { createSpatialIndex, footprintBounds, spatialBoundsOverlap } from "../src/domain/spatial-index.ts";

const objects = [
  { id: "rotated", footprint: { kind: "rectangle", center: { x: 2, y: 2 }, width: 3, depth: 1, rotationDegrees: 45 } },
  { id: "circle", footprint: { kind: "circle", center: { x: 6, y: 2 }, radius: 1 } },
  { id: "line", footprint: { kind: "line", start: { x: 0, y: 5 }, end: { x: 8, y: 5 }, width: 0.4 } },
  { id: "polygon", footprint: { kind: "polygon", points: [{ x: 9, y: 1 }, { x: 11, y: 1 }, { x: 10, y: 3 }], rotationDegrees: 0 } },
];

test("spatial index returns every exact intersection in stable ID order", () => {
  const index = createSpatialIndex(objects, { cellSizeM: 2 });
  const query = { kind: "circle", center: { x: 3, y: 2 }, radius: 1 };
  const expected = objects.filter((object) => footprintsIntersect(query, object.footprint)).map((object) => object.id).sort();
  assert.deepEqual(index.queryCollisions(query, footprintsIntersect).map((object) => object.id), expected);
  assert.deepEqual(index.queryFootprint({ kind: "line", start: { x: 0, y: 5 }, end: { x: 8, y: 5 }, width: 0.1 }).map((object) => object.id), ["line"]);
  assert.deepEqual(index.evidence(), { objectCount: 4, cellCount: index.evidence().cellCount, cellSizeM: 2 });
});

test("broad-phase bounds include rotated geometry and may be narrowed by exact geometry", () => {
  const bounds = footprintBounds(objects[0].footprint);
  assert.ok(bounds.minX < 1 && bounds.maxX > 3);
  const query = { kind: "circle", center: { x: 0.6, y: 0.6 }, radius: 0.05 };
  assert.equal(spatialBoundsOverlap(bounds, footprintBounds(query)), true);
  assert.equal(footprintsIntersect(objects[0].footprint, query), false);
  assert.deepEqual(createSpatialIndex(objects).queryCollisions(query, footprintsIntersect), []);
});

test("spatial index rejects duplicate IDs and invalid cell sizes", () => {
  assert.throws(() => createSpatialIndex([objects[0], objects[0]]), /Duplicate spatial object ID/);
  assert.throws(() => createSpatialIndex(objects, { cellSizeM: 0 }), /must be positive/);
});
