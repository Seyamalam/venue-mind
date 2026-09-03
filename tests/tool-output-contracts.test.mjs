import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { venueToolContracts } from "../src/contracts/venue-contracts.ts";

const root = path.resolve(new URL("../", import.meta.url).pathname);

test("every canonical tool has a concrete output schema and generated SDK output", async () => {
  assert.equal(venueToolContracts.length, 56);
  for (const contract of venueToolContracts) {
    assert.equal(typeof contract.outputSchema, "object", contract.name);
    assert.ok(
      "type" in contract.outputSchema || "$ref" in contract.outputSchema || "oneOf" in contract.outputSchema,
      `${contract.name} must publish a concrete output schema`,
    );
    assert.notDeepEqual(contract.outputSchema, {}, contract.name);
  }

  const generated = await readFile(path.join(root, "packages/sdk/src/generated/tool-outputs.ts"), "utf8");
  for (const { name } of venueToolContracts)
    assert.doesNotMatch(generated, new RegExp(`${name.replaceAll(".", "\\.")}\": unknown;`), name);
});

test("venue.apply_edit publishes an exact discriminated schema for every editor operation", () => {
  const contract = venueToolContracts.find(({ name }) => name === "venue.apply_edit");
  assert.ok(contract);
  const variants = contract.inputSchema.properties.edit.oneOf;
  assert.equal(variants.length, 14);
  assert.deepEqual(variants.map(({ properties }) => properties.operation.const).sort(), [
    "align",
    "apply-layout",
    "create-zone",
    "delete",
    "distribute",
    "duplicate",
    "edit-zone-vertices",
    "group",
    "move",
    "paste",
    "place",
    "resize",
    "rotate",
    "ungroup",
  ]);
  for (const variant of variants) {
    assert.equal(variant.additionalProperties, false, variant.properties.operation.const);
    assert.ok(variant.required.includes("operation"), variant.properties.operation.const);
  }

  const move = variants.find(({ properties }) => properties.operation.const === "move");
  assert.deepEqual(move.required, ["operation", "objectIds", "delta"]);
  assert.deepEqual(Object.keys(move.properties).sort(), [
    "delta",
    "label",
    "metrics",
    "objectIds",
    "operation",
    "shortLabel",
    "snap",
  ]);
});
