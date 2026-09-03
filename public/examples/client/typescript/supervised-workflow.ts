import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

type JsonSchema = { required?: string[] };
type ToolContract = { name: string; inputSchema: JsonSchema };
type ManifestSchema = { items: { required: string[] } };
type InspectionResult = { planId: string };
type PreviewResult = { proposalId: string; receipt: { id: string } };
type ValidationResult = { evaluatedProposalId: string | null; validationId: string };
type ExportResult = { format: string; filename: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredString = (record: Record<string, unknown>, field: string): string => {
  const value = record[field];
  if (typeof value !== "string") throw new TypeError(`Expected ${field} to be a string`);
  return value;
};

const decodeStringArray = (value: unknown, field: string): string[] => {
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string"))
    throw new TypeError(`Expected ${field} to be a string array`);
  return value;
};

const decodeToolContract = (value: unknown): ToolContract => {
  if (!isRecord(value) || !isRecord(value["inputSchema"])) throw new TypeError("Invalid published tool contract");
  const required = value["inputSchema"]["required"];
  return {
    name: requiredString(value, "name"),
    inputSchema: required === undefined ? {} : { required: decodeStringArray(required, "inputSchema.required") },
  };
};

const decodeToolContracts = (value: unknown): ToolContract[] => {
  if (!Array.isArray(value)) throw new TypeError("Published tool contracts must be an array");
  return value.map(decodeToolContract);
};

const decodeManifestSchema = (value: unknown): ManifestSchema => {
  if (!isRecord(value) || !isRecord(value["items"])) throw new TypeError("Invalid tool manifest schema");
  return { items: { required: decodeStringArray(value["items"]["required"], "items.required") } };
};

const decodeInspection = (value: unknown): InspectionResult => {
  if (!isRecord(value)) throw new TypeError("Invalid layout inspection response");
  return { planId: requiredString(value, "planId") };
};

const decodeObject = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) throw new TypeError("Expected an object response");
  return value;
};

const decodePreview = (value: unknown): PreviewResult => {
  if (!isRecord(value) || !isRecord(value["receipt"])) throw new TypeError("Invalid preview response");
  return {
    proposalId: requiredString(value, "proposalId"),
    receipt: { id: requiredString(value["receipt"], "id") },
  };
};

const decodeValidation = (value: unknown): ValidationResult => {
  if (!isRecord(value)) throw new TypeError("Invalid validation response");
  const evaluatedProposalId = value["evaluatedProposalId"];
  if (evaluatedProposalId !== null && typeof evaluatedProposalId !== "string")
    throw new TypeError("Expected evaluatedProposalId to be a string or null");
  return { evaluatedProposalId, validationId: requiredString(value, "validationId") };
};

const decodeExport = (value: unknown): ExportResult => {
  if (!isRecord(value)) throw new TypeError("Invalid export response");
  return { format: requiredString(value, "format"), filename: requiredString(value, "filename") };
};

const parseJson = (source: string): unknown => JSON.parse(source);

const root = process.env.VENUEMIND_ROOT ? path.resolve(process.env.VENUEMIND_ROOT) : process.cwd();
const contracts = decodeToolContracts(parseJson(await readFile(path.join(root, "public/venue-tools.json"), "utf8")));
const manifestSchema = decodeManifestSchema(
  parseJson(await readFile(path.join(root, "public/schemas/venue-tool-manifest.schema.json"), "utf8")),
);
assert.ok(manifestSchema.items.required.includes("inputSchema"), "generated manifest schema must require inputSchema");
const contractByName = new Map(contracts.map((contract) => [contract.name, contract]));

function assertPublishedInput(name: string, input: Record<string, unknown>) {
  const contract = contractByName.get(name);
  assert.ok(contract, `Unknown published tool: ${name}`);
  for (const field of contract.inputSchema.required ?? [])
    assert.ok(Object.hasOwn(input, field), `${name}.${field} is required`);
}

const client = new Client({ name: "venuemind-typescript-example", version: "1.0.0" });
const childEnvironment: Record<string, string> = {};
for (const [name, value] of Object.entries(process.env)) {
  if (value !== undefined) childEnvironment[name] = value;
}
childEnvironment["VENUEMIND_DATA_DIR"] = process.env.VENUEMIND_DATA_DIR ?? path.join(root, ".venuemind-example-data");
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "packages/mcp-server/dist/index.js")],
  env: childEnvironment,
});

await client.connect(transport);
try {
  const call = async <Result>(
    name: string,
    decode: (value: unknown) => Result,
    input: Record<string, unknown> = {},
  ): Promise<Result> => {
    assertPublishedInput(name, input);
    const result = await client.callTool({ name, arguments: input });
    const textContent = result.content.find((content) => content.type === "text");
    assert.equal(result.isError, undefined, `${name} failed: ${textContent?.text ?? "unknown error"}`);
    if (!textContent) throw new TypeError(`${name} returned no text content`);
    return decode(parseJson(textContent.text));
  };

  await call("venue.open_project", decodeObject, { projectId: "project-summit-forward" });
  const inspection = await call("venue.inspect_layout", decodeInspection);
  const previewInput = {
    goal: "Protect the west accessible route",
    idempotencyKey: "typescript-example-preview-001",
    correlationId: "typescript-example-001",
  };
  const preview = await call("venue.preview_revision", decodePreview, previewInput);
  const retry = await call("venue.preview_revision", decodePreview, previewInput);
  const validation = await call("venue.validate_layout", decodeValidation);
  const exported = await call("venue.export_plan", decodeExport, { format: "text" });

  assert.equal(inspection.planId, "plan-summit-forward-2026");
  assert.equal(retry.receipt.id, preview.receipt.id, "exact retry must return the original receipt");
  assert.equal(validation.evaluatedProposalId, preview.proposalId);
  assert.equal(exported.format, "text");
  process.stdout.write(
    `${JSON.stringify({ planId: inspection.planId, proposalId: preview.proposalId, validationId: validation.validationId, receiptId: preview.receipt.id, export: exported.filename })}\n`,
  );
} finally {
  await client.close();
}
