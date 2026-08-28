import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyVenuePlan } from "../src/domain/empty-project.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";

test("an empty Project starts as a valid canonical Plan with stable IDs", () => {
  const plan = createEmptyVenuePlan({ projectId: "project-autumn-forum", name: "Autumn Forum" });
  const planner = createVenuePlanner(plan);
  const inspection = planner.execute({ type: "inspect_layout" });

  assert.equal(plan.id, "plan-project-autumn-forum");
  assert.equal(plan.event.id, "event-project-autumn-forum");
  assert.equal(plan.event.name, "Autumn Forum");
  assert.equal(inspection.spatial.unit, "m");
  assert.equal(inspection.spatialObjects.length, 0);
  assert.equal(inspection.proposal.changedItems, 0);
  assert.equal(planner.execute({ type: "validate_layout" }).status, "pass");
});
