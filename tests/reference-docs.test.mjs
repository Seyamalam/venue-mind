import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  eventBriefSchema,
  planningEffectSchema,
  calendarWebhookEventSchema,
  plannerSnapshotSchema,
  validationResultSchema,
  venueCommandSchema,
  venueConstraintSchema,
  venueToolContracts,
} from "../src/contracts/venue-contracts.js";
import { permissionForCommand } from "../src/domain/authorization.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { errorCatalog } from "../src/domain/errors.js";
import {
  commandReferencePages,
  publishedConstraintEvaluators,
  publishedLedgerSchemaVersion,
  referenceManifest,
  toolReferencePages,
} from "../src/docs/pages/reference.js";
import {
  CONSTRAINT_REFERENCE,
  LEDGER_EVENT_REFERENCE,
  TOOL_OUTPUT_REFERENCE,
  VERSION_REFERENCE,
} from "../src/docs/reference-data.js";

const commandSchemas = venueCommandSchema.oneOf.flatMap((schema) => {
  const types = schema.properties.type.enum ?? [schema.properties.type.const];
  return types.map((type) => [type, { ...schema, properties: { ...schema.properties, type: { const: type } } }]);
});
const schemaRegistry = new Map([eventBriefSchema, plannerSnapshotSchema].map((schema) => [schema.$id, schema]));

function validateExample(value, schema, location = "input") {
  if (schema.$ref) return validateExample(value, schemaRegistry.get(schema.$ref), location);
  if (schema.const !== undefined) assert.deepEqual(value, schema.const, location);
  if (schema.enum) assert.ok(schema.enum.includes(value), `${location} must match enum`);
  if (schema.oneOf) assert.doesNotThrow(() => validateExample(value, schema.oneOf[0], location));
  if (schema.anyOf) {
    const matches = schema.anyOf.some((candidate) => {
      try { validateExample(value, candidate, location); return true; } catch { return false; }
    });
    assert.equal(matches, true, `${location} must match anyOf`);
  }
  const allowedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (allowedTypes.length) {
    const actualType = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
    assert.ok(allowedTypes.includes(actualType) || (actualType === "integer" && allowedTypes.includes("number")), `${location} expected ${allowedTypes.join("|")}, got ${actualType}`);
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined) assert.ok(value.length >= schema.minLength, location);
    if (schema.maxLength !== undefined) assert.ok(value.length <= schema.maxLength, location);
    if (schema.pattern) assert.match(value, new RegExp(schema.pattern), location);
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined) assert.ok(value >= schema.minimum, location);
    if (schema.exclusiveMinimum !== undefined) assert.ok(value > schema.exclusiveMinimum, location);
    if (schema.maximum !== undefined) assert.ok(value <= schema.maximum, location);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined) assert.ok(value.length >= schema.minItems, location);
    if (schema.maxItems !== undefined) assert.ok(value.length <= schema.maxItems, location);
    for (const [index, item] of value.entries()) validateExample(item, schema.items ?? {}, `${location}[${index}]`);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const required of schema.required ?? []) assert.ok(Object.hasOwn(value, required), `${location}.${required} is required`);
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) assert.ok(Object.hasOwn(schema.properties ?? {}, key), `${location}.${key} is not allowed`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties?.[key]) validateExample(child, schema.properties[key], `${location}.${key}`);
    }
  }
}

test("reference publishes exactly one page for every runtime tool and command", () => {
  assert.deepEqual(toolReferencePages.map((page) => page.reference.name), venueToolContracts.map((tool) => tool.name));
  assert.deepEqual(commandReferencePages.map((page) => page.reference.name), commandSchemas.map(([type]) => type));
  assert.equal(new Set([...toolReferencePages, ...commandReferencePages].map((page) => page.slug)).size, toolReferencePages.length + commandReferencePages.length);
});

test("tool pages match required inputs, examples, errors, and output references", () => {
  assert.deepEqual(Object.keys(TOOL_OUTPUT_REFERENCE), venueToolContracts.map((tool) => tool.name));
  for (const tool of venueToolContracts) {
    const page = toolReferencePages.find((candidate) => candidate.reference.name === tool.name);
    assert.deepEqual(page.reference.requiredFields, tool.inputSchema.required ?? [], tool.name);
    assert.deepEqual(page.reference.example, tool.exampleInput, tool.name);
    assert.deepEqual(page.reference.errors, tool.errors, tool.name);
    assert.deepEqual(page.reference.output, TOOL_OUTPUT_REFERENCE[tool.name], tool.name);
    assert.ok(page.reference.output.fields.length > 0, `${tool.name} output fields`);
    assert.ok(page.reference.output.stableIds.length > 0, `${tool.name} stable IDs`);
    validateExample(page.reference.example, tool.inputSchema, tool.name);
    for (const code of page.reference.errors) assert.ok(errorCatalog[code], `${tool.name} unknown error ${code}`);
  }
});

test("command pages match schemas, permissions, examples, and published errors", () => {
  for (const [type, schema] of commandSchemas) {
    const page = commandReferencePages.find((candidate) => candidate.reference.name === type);
    assert.deepEqual(page.reference.requiredFields, schema.required, type);
    assert.equal(page.reference.permission, permissionForCommand(type), type);
    assert.ok(page.reference.output.fields.length > 0, `${type} output fields`);
    assert.ok(page.reference.output.stableIds.length > 0, `${type} stable IDs`);
    for (const code of page.reference.errors) assert.ok(errorCatalog[code], `${type} unknown error ${code}`);
    if (type !== "restore_snapshot") validateExample(page.reference.example, schema, type);
  }
});

test("generated Event Brief schedule example executes through the planner", async () => {
  const page = commandReferencePages.find((candidate) => candidate.reference.name === "update_event_brief");
  const schedule = page.reference.example.brief.schedule;
  assert.deepEqual(schedule, { startAt: "2026-09-18T09:00:00+06:00", endAt: "2026-09-18T17:00:00+06:00", timezone: "Asia/Dhaka" });
  assert.ok(Date.parse(schedule.endAt) > Date.parse(schedule.startAt));
  assert.doesNotThrow(() => createVenuePlanner(summitForwardPlan).execute(page.reference.example));
  const generated = await readFile(new URL("../public/llms-full.txt", import.meta.url), "utf8");
  const block = /# update_event_brief[\s\S]*?```json\n([\s\S]*?)\n```/.exec(generated)?.[1];
  assert.ok(block, "generated update_event_brief JSON example");
  const command = JSON.parse(block);
  assert.deepEqual(command.brief.schedule, schedule);
  assert.doesNotThrow(() => createVenuePlanner(summitForwardPlan).execute(command));
});

test("published Validation schema exactly covers every runtime top-level field", () => {
  const validation = createVenuePlanner(summitForwardPlan).execute({ type: "validate_layout" });
  assert.deepEqual(Object.keys(validation).sort(), Object.keys(validationResultSchema.properties).sort());
  assert.deepEqual(validationResultSchema.required.slice().sort(), Object.keys(validationResultSchema.properties).sort());
  assert.equal(validationResultSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(validation.evidenceFamilyFingerprints).sort(), validationResultSchema.properties.evidenceFamilyFingerprints.required.slice().sort());
  assert.deepEqual(validation.planningEvidenceInvalidations, { affectedConstraintIds: [], evidenceFamilies: [] });
});

test("published Planning Effect and calendar webhook contracts are closed and exact", () => {
  assert.deepEqual(planningEffectSchema.oneOf.map((variant) => variant.properties.operation.const), ["set_attendance_target", "set_event_schedule"]);
  assert.equal(planningEffectSchema.oneOf.every((variant) => variant.additionalProperties === false), true);
  assert.deepEqual(calendarWebhookEventSchema.properties.type.enum, ["event.created", "event.updated", "event.cancelled", "event.deleted"]);
  assert.equal(calendarWebhookEventSchema.additionalProperties, false);
});

test("constraint and version references are bound to runtime constants", () => {
  assert.deepEqual(CONSTRAINT_REFERENCE.map((item) => item.evaluator), venueConstraintSchema.properties.evaluator.enum);
  assert.deepEqual(publishedConstraintEvaluators, venueConstraintSchema.properties.evaluator.enum);
  assert.equal(publishedLedgerSchemaVersion, 1);
  assert.equal(VERSION_REFERENCE.find((item) => item.surface === "Project record").current, "10");
  assert.equal(VERSION_REFERENCE.find((item) => item.surface === "Validation engine").current, "2.7.0");
  assert.equal(VERSION_REFERENCE.find((item) => item.surface === "Simulation engine").current, "1.2.1");
});

test("ledger event reference exactly matches events emitted by the planner", async () => {
  const source = await readFile(new URL("../src/domain/venue-planner.js", import.meta.url), "utf8");
  const literalPattern = /(?:appendLedger|createActivityEntry)\([^,]+,\s*"([a-z_]+\.[a-z_]+)"/g;
  const emitted = new Set([...source.matchAll(literalPattern)].map((match) => match[1]));
  for (const event of ["comment.resolved", "comment.reopened", "simulation.completed", "simulation.cancelled"]) emitted.add(event);
  assert.deepEqual([...LEDGER_EVENT_REFERENCE.map((item) => item.type)].sort(), [...emitted].sort());
});

test("generated reference manifest is byte-equivalent to the runtime projection", async () => {
  const generated = JSON.parse(await readFile(new URL("../public/reference-manifest.json", import.meta.url), "utf8"));
  assert.deepEqual(generated, referenceManifest);
  assert.equal(generated.toolPages.length, venueToolContracts.length);
  assert.equal(generated.commandPages.length, commandSchemas.length);
});

test("the documented recovery snapshot restores through the production planner", async () => {
  const snapshot = JSON.parse(await readFile(new URL("../public/examples/planner-snapshot.json", import.meta.url), "utf8"));
  const planner = createVenuePlanner(summitForwardPlan);
  const restored = planner.execute({ type: "restore_snapshot", snapshot });
  assert.equal(restored.status, "restored");
  assert.equal(planner.getSnapshot().plan.id, snapshot.plan.id);
  assert.equal(planner.getSnapshot().plan.version, snapshot.plan.version);
});
