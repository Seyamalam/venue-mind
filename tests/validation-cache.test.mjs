import assert from "node:assert/strict";
import test from "node:test";
import { createValidationEngine } from "../src/domain/constraint-engine.js";
import { analyzeSpatialPlan } from "../src/domain/spatial-analysis.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";

test("Validation cache returns byte-equivalent results for identical immutable input", () => {
  let analyses = 0;
  const engine = createValidationEngine({
    analyzeSpatial: (input) => {
      analyses += 1;
      return analyzeSpatialPlan(input);
    },
  });
  const state = structuredClone(createVenuePlanner(summitForwardPlan).getSnapshot());

  const first = engine.validate(state);
  first.checks[0].label = "caller mutation";
  const second = engine.validate(state);
  const third = engine.validate(structuredClone(state));
  const independent = createValidationEngine().validate(structuredClone(state));

  assert.equal(analyses, 1);
  assert.equal(second.checks[0].label, "Accessible route");
  assert.equal(JSON.stringify(third), JSON.stringify(second));
  assert.equal(JSON.stringify(independent), JSON.stringify(second));
  assert.equal(third.inputFingerprint, second.inputFingerprint);
});

test("Validation cache ignores ledger noise and invalidates relevant geometry, parameters, and brief input", () => {
  let analyses = 0;
  const engine = createValidationEngine({
    maxEntries: 4,
    analyzeSpatial: (input) => {
      analyses += 1;
      return analyzeSpatialPlan(input);
    },
  });
  const state = structuredClone(createVenuePlanner(summitForwardPlan).getSnapshot());
  const baseline = engine.validate(state);

  const ledgerOnly = structuredClone(state);
  ledgerOnly.ledger.push({ id: "irrelevant-cache-event" });
  assert.equal(engine.validate(ledgerOnly).inputFingerprint, baseline.inputFingerprint);
  assert.equal(analyses, 1);

  const geometryChanged = structuredClone(state);
  geometryChanged.plan.objects.find((object) => object.id === "obj-av-desk").footprint.center.x += 0.5;
  const geometryResult = engine.validate(geometryChanged);
  assert.notEqual(geometryResult.inputFingerprint, baseline.inputFingerprint);

  const parametersChanged = structuredClone(state);
  parametersChanged.plan.constraints.find((constraint) => constraint.id === "constraint-capacity").parameters.minimumAttendeeCapacity = 410;
  const parameterResult = engine.validate(parametersChanged);
  assert.notEqual(parameterResult.inputFingerprint, baseline.inputFingerprint);

  const briefChanged = structuredClone(state);
  briefChanged.brief.attendeeTarget += 1;
  const briefResult = engine.validate(briefChanged);
  assert.notEqual(briefResult.inputFingerprint, baseline.inputFingerprint);
  assert.equal(analyses, 4);
});
