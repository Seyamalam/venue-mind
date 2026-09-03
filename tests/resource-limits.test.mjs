import assert from "node:assert/strict";
import test from "node:test";
import { VenueError } from "../src/domain/errors.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { measureJsonResource, VENUE_RESOURCE_LIMITS } from "../src/security/resource-limits.ts";

const limitError = (error, resource, surface) =>
  error instanceof VenueError &&
  error.code === "RESOURCE_LIMIT_EXCEEDED" &&
  error.details.resource === resource &&
  error.details.surface === surface;

test("JSON resource measurement is deterministic and bounded without recursive traversal", () => {
  const value = { a: [1, 2], b: { c: true } };
  assert.deepEqual(measureJsonResource(value, { surface: "test", maximumBytes: 100 }), {
    bytes: 26,
    depth: 2,
    nodes: 6,
  });

  let nested = { leaf: true };
  for (let index = 0; index < 65; index += 1) nested = { child: nested };
  assert.throws(
    () => measureJsonResource(nested, { surface: "nested", maximumBytes: 10_000 }),
    (error) => limitError(error, "depth", "nested"),
  );

  const cyclic = {};
  cyclic.self = cyclic;
  assert.throws(
    () => measureJsonResource(cyclic, { surface: "cyclic", maximumBytes: 100 }),
    (error) => limitError(error, "cyclic-reference", "cyclic"),
  );
});

test("planner rejects oversized initial collections and commands before state mutation", () => {
  const excessiveObjects = Array.from({ length: VENUE_RESOURCE_LIMITS.projectObjects + 1 }, (_, index) => ({
    id: `obj-limit-${index}`,
    kind: "chair",
    label: "Chair",
    layer: "furniture",
    elevationM: 0,
    locked: false,
    locks: [],
    placement: { collisionMode: "solid" },
    footprint: { kind: "rectangle", center: { x: 1, y: 1 }, width: 0.5, depth: 0.5, rotationDegrees: 0 },
  }));
  assert.throws(
    () => createVenuePlanner({ ...structuredClone(summitForwardPlan), objects: excessiveObjects }),
    (error) => limitError(error, "plan-objects", "planner-initial-plan"),
  );

  const planner = createVenuePlanner(summitForwardPlan);
  const before = planner.getSnapshot();
  assert.throws(
    () => planner.execute({ type: "preview_revision", goal: "x".repeat(VENUE_RESOURCE_LIMITS.plannerCommandBytes) }),
    (error) => limitError(error, "bytes", "planner-command"),
  );
  assert.deepEqual(planner.getSnapshot(), before);
});

test("published limits are finite positive integers with bounded time budgets", () => {
  for (const [name, value] of Object.entries(VENUE_RESOURCE_LIMITS)) {
    assert.equal(Number.isSafeInteger(value), true, name);
    assert.ok(value > 0, name);
  }
  assert.ok(VENUE_RESOURCE_LIMITS.validationTimeMs < VENUE_RESOURCE_LIMITS.simulationTimeMs);
  assert.ok(VENUE_RESOURCE_LIMITS.simulationTimeMs <= 30_000);
});
