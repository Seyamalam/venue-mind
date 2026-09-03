import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as z from "zod/v4";
import { venueToolContracts } from "../src/contracts/venue-contracts.ts";

const publishedContracts = JSON.parse(
  await readFile(new URL("../public/venue-tools.json", import.meta.url), "utf8"),
);

test("every generated tool example satisfies its exact published command input schema", () => {
  assert.equal(publishedContracts.length, venueToolContracts.length);
  for (const contract of venueToolContracts) {
    const published = publishedContracts.find(({ name }) => name === contract.name);
    assert.ok(published, contract.name);
    assert.deepEqual(published.inputSchema, contract.inputSchema, `${contract.name} generated input drift`);
    assert.deepEqual(published.exampleInput, contract.exampleInput, `${contract.name} generated example drift`);
    const schema = z.fromJSONSchema(published.inputSchema);
    assert.equal(schema.safeParse(structuredClone(published.exampleInput)).success, true, contract.name);
  }
});

test("generated schemas reject absent required fields and unknown command fields", () => {
  for (const contract of publishedContracts) {
    const schema = z.fromJSONSchema(contract.inputSchema);
    const required = contract.inputSchema.required ?? [];
    for (const field of required) {
      const candidate = Object.fromEntries(
        Object.entries(structuredClone(contract.exampleInput)).filter(([key]) => key !== field),
      );
      assert.equal(schema.safeParse(candidate).success, false, `${contract.name} accepted missing ${field}`);
    }
    assert.equal(
      schema.safeParse({ ...structuredClone(contract.exampleInput), unexpectedCommandField: true }).success,
      false,
      `${contract.name} accepted an unknown field`,
    );
  }
});
