import test from "node:test";
import assert from "node:assert/strict";
import { createFloorPlanReferenceIntake, inspectFloorPlanReferenceAdapters } from "../src/interchange/floor-plan-reference.ts";

test("DXF and PDF adapters are explicit reference-only boundaries", () => {
  const adapters = inspectFloorPlanReferenceAdapters();
  assert.deepEqual(adapters.map((adapter) => adapter.id), ["dxf-reference-v1", "pdf-trace-reference-v1"]);
  assert.equal(adapters.every((adapter) => adapter.authority === "reference-only" && adapter.requiresHumanCalibration && !adapter.plannerMutationAllowed), true);
  assert.equal(adapters[0].supportedEntities.includes("LWPOLYLINE"), true);
  assert.equal(adapters[1].limits.maximumSelectedPages, 1);
});

test("reference intake requires a fingerprint, bounded bytes, and matching media type", () => {
  const intake = createFloorPlanReferenceIntake("pdf-trace-reference-v1", { fingerprint: "sha256-1234", mediaType: "application/pdf", bytes: 2048, filename: "hall.pdf" });
  assert.equal(intake.status, "calibration-required");
  assert.equal(intake.candidateGeometry, null);
  assert.equal(intake.transform, null);
  assert.throws(() => createFloorPlanReferenceIntake("dxf-reference-v1", { fingerprint: "sha256-1", mediaType: "application/pdf", bytes: 12 }), /Unsupported media type/);
  assert.throws(() => createFloorPlanReferenceIntake("pdf-trace-reference-v1", { fingerprint: "", mediaType: "application\/pdf", bytes: 12 }), /fingerprint/);
});
