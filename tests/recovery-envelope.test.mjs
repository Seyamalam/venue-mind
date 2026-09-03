import assert from "node:assert/strict";
import test from "node:test";
import {
  createRecoveryEnvelope,
  inspectRecoveryEnvelope,
  selectRecoveryEnvelope,
} from "../src/persistence/recovery-envelope.ts";

const isValue = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) && typeof value.id === "string";

test("recovery envelopes detect byte-level corruption", () => {
  const envelope = createRecoveryEnvelope({ id: "project-a", revision: 3 }, 4, "2026-09-03T10:00:00.000Z");
  const encoded = JSON.stringify(envelope);
  assert.equal(inspectRecoveryEnvelope(encoded, isValue).status, "pass");

  const tampered = encoded.replace('"revision":3', '"revision":4');
  const inspection = inspectRecoveryEnvelope(tampered, isValue);
  assert.equal(inspection.status, "quarantined");
  assert.equal(inspection.reason, "checksum-mismatch");
  assert.equal(inspection.envelope, null);
});

test("a newer verified autosave journal wins after an interrupted commit", () => {
  const committed = inspectRecoveryEnvelope(
    JSON.stringify(createRecoveryEnvelope({ id: "project-a", revision: 3 }, 3, "2026-09-03T09:59:00.000Z")),
    isValue,
  );
  const journal = inspectRecoveryEnvelope(
    JSON.stringify(createRecoveryEnvelope({ id: "project-a", revision: 4 }, 4, "2026-09-03T10:00:00.000Z")),
    isValue,
  );
  const selected = selectRecoveryEnvelope(committed, journal);
  assert.equal(selected.status, "recovered");
  assert.equal(selected.envelope.value.revision, 4);
});

test("an invalid journal cannot displace a verified committed recovery", () => {
  const committed = inspectRecoveryEnvelope(
    JSON.stringify(createRecoveryEnvelope({ id: "project-a", revision: 3 }, 3, "2026-09-03T09:59:00.000Z")),
    isValue,
  );
  const selected = selectRecoveryEnvelope(committed, inspectRecoveryEnvelope("{", isValue));
  assert.equal(selected.status, "pass");
  assert.equal(selected.envelope.value.revision, 3);
});
