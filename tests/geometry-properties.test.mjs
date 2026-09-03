import assert from "node:assert/strict";
import test from "node:test";
import { footprintsIntersect } from "../src/domain/spatial-analysis.ts";
import { createSpatialIndex, footprintBounds, spatialBoundsOverlap } from "../src/domain/spatial-index.ts";

const randomSource = (initialSeed) => {
  let seed = initialSeed >>> 0;
  return () => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed / 4_294_967_296;
  };
};

const between = (random, minimum, maximum) => minimum + random() * (maximum - minimum);

const footprint = (random) =>
  random() < 0.5
    ? {
        kind: "rectangle",
        center: { x: between(random, -20, 20), y: between(random, -20, 20) },
        width: between(random, 0.1, 5),
        depth: between(random, 0.1, 5),
        rotationDegrees: between(random, -180, 180),
      }
    : {
        kind: "circle",
        center: { x: between(random, -20, 20), y: between(random, -20, 20) },
        radius: between(random, 0.05, 3),
      };

const translate = (shape, x, y) => ({
  ...shape,
  center: { x: shape.center.x + x, y: shape.center.y + y },
});

test("exact geometry intersection is symmetric and translation invariant across deterministic generated cases", () => {
  const random = randomSource(0x51a7e);
  for (let index = 0; index < 500; index += 1) {
    const left = footprint(random);
    const right = footprint(random);
    const expected = footprintsIntersect(left, right);
    assert.equal(footprintsIntersect(right, left), expected, `symmetry case ${index}`);
    const delta = { x: between(random, -50, 50), y: between(random, -50, 50) };
    assert.equal(
      footprintsIntersect(translate(left, delta.x, delta.y), translate(right, delta.x, delta.y)),
      expected,
      `translation case ${index}`,
    );
    if (expected) {
      assert.equal(
        spatialBoundsOverlap(footprintBounds(left), footprintBounds(right)),
        true,
        `broad phase must contain exact collision ${index}`,
      );
    }
  }
});

test("spatial index remains byte-equivalent to brute-force collision queries across generated plans", () => {
  const random = randomSource(0xc0111de);
  for (let planIndex = 0; planIndex < 24; planIndex += 1) {
    const objects = Array.from({ length: 36 }, (_, objectIndex) => ({
      id: `plan-${planIndex}-object-${objectIndex.toString().padStart(2, "0")}`,
      footprint: footprint(random),
    }));
    const index = createSpatialIndex(objects, { cellSizeM: between(random, 0.5, 4) });
    for (let queryIndex = 0; queryIndex < 12; queryIndex += 1) {
      const query = footprint(random);
      const expected = objects
        .filter((object) => footprintsIntersect(query, object.footprint))
        .map((object) => object.id)
        .sort();
      assert.deepEqual(
        index.queryCollisions(query, footprintsIntersect).map((object) => object.id),
        expected,
        `plan ${planIndex}, query ${queryIndex}`,
      );
    }
  }
});
