import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

type JsonSchema = { required?: string[] };
type ToolContract = { name: string; inputSchema: JsonSchema };

const root = process.env.VENUEMIND_ROOT ? path.resolve(process.env.VENUEMIND_ROOT) : process.cwd();
const contracts = JSON.parse(await readFile(path.join(root, "public/venue-tools.json"), "utf8")) as ToolContract[];
const manifestSchema = JSON.parse(await readFile(path.join(root, "public/schemas/venue-tool-manifest.schema.json"), "utf8")) as { items: { required: string[] } };
assert.ok(manifestSchema.items.required.includes("inputSchema"), "generated manifest schema must require inputSchema");
const contractByName = new Map(contracts.map((contract) => [contract.name, contract]));

function assertPublishedInput(name: string, input: Record<string, unknown>) {
  const contract = contractByName.get(name);
  assert.ok(contract, `Unknown published tool: ${name}`);
  for (const field of contract.inputSchema.required ?? []) assert.ok(Object.hasOwn(input, field), `${name}.${field} is required`);
}

const client = new Client({ name: "venuemind-typescript-example", version: "1.0.0" });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(root, "packages/mcp-server/dist/index.js")],
  env: { ...process.env, VENUEMIND_DATA_DIR: process.env.VENUEMIND_DATA_DIR ?? path.join(root, ".venuemind-example-data") } as Record<string, string>,
});

await client.connect(transport);
try {
  const call = async (name: string, input: Record<string, unknown> = {}) => {
    assertPublishedInput(name, input);
    const result = await client.callTool({ name, arguments: input });
    assert.equal(result.isError, undefined, `${name} failed: ${result.content[0]?.type === "text" ? result.content[0].text : "unknown error"}`);
    return JSON.parse(result.content[0].type === "text" ? result.content[0].text : "null");
  };

  await call("venue.open_project", { projectId: "project-summit-forward" });
  const inspection = await call("venue.inspect_layout");
  const previewInput = { goal: "Protect the west accessible route", idempotencyKey: "typescript-example-preview-001", correlationId: "typescript-example-001" };
  const preview = await call("venue.preview_revision", previewInput);
  const retry = await call("venue.preview_revision", previewInput);
  const validation = await call("venue.validate_layout");
  const exported = await call("venue.export_plan", { format: "text" });

  assert.equal(inspection.planId, "plan-summit-forward-2026");
  assert.equal(retry.receipt.id, preview.receipt.id, "exact retry must return the original receipt");
  assert.equal(validation.evaluatedProposalId, preview.proposalId);
  assert.equal(exported.format, "text");
  process.stdout.write(`${JSON.stringify({ planId: inspection.planId, proposalId: preview.proposalId, validationId: validation.validationId, receiptId: preview.receipt.id, export: exported.filename })}\n`);
} finally {
  await client.close();
}
