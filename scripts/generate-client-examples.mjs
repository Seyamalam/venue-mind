import { mkdir, readFile, writeFile } from "node:fs/promises";
import { CLIENT_CONFIGS, CODEX_TOML, HOST_WORKFLOWS } from "../src/examples/client-catalog.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { errorCatalog, errorPayload, venueError } from "../src/domain/errors.ts";

const output = new URL("../public/examples/client/", import.meta.url);
const source = new URL("../examples/", import.meta.url);
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const rpcRequest = (id, name, args) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
const rpcResponse = (id, value) => ({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value } });
const canonicalizeTimes = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeTimes);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /At$/.test(key) && !["startAt", "endAt"].includes(key) && typeof item === "string" ? "2026-08-27T10:00:00.000Z" : canonicalizeTimes(item)]));
};

const planner = createVenuePlanner(summitForwardPlan, { clock: () => "2026-08-27T10:00:00.000Z" });
const previewInput = { goal: "Protect the west accessible route", idempotencyKey: "fixture-preview-001", correlationId: "fixture-001" };
const preview = planner.execute({ type: "preview_revision", ...previewInput, actor: "agent", source: "mcp" });
const retry = planner.execute({ type: "preview_revision", ...previewInput, actor: "agent", source: "mcp" });
const previewFixture = canonicalizeTimes(preview);
const retryFixture = canonicalizeTimes(retry);
const exported = planner.execute({ type: "export_plan", format: "text" });

const invalidPlan = structuredClone(summitForwardPlan);
invalidPlan.objects.push({
  id: "obj-example-exit-cart",
  kind: "table",
  label: "Exit cart",
  layer: "furniture",
  elevationM: 0.9,
  locked: false,
  footprint: { kind: "circle", center: { x: 29.2, y: 10 }, radius: 0.25 },
});
const failedValidation = createVenuePlanner(invalidPlan, { clock: () => "2026-08-27T10:00:00.000Z" }).execute({ type: "validate_layout" });
const staleError = errorPayload(venueError("PLAN_VERSION_CONFLICT", { expectedVersion: "3.3", receivedVersion: "3.2", proposalId: "proposal-32-b" }));

const artifacts = new Map([
  ["config/generic-stdio.json", json(CLIENT_CONFIGS.generic)],
  ["config/claude-desktop.json", json(CLIENT_CONFIGS.claudeDesktop)],
  ["config/cursor-project.json", json(CLIENT_CONFIGS.cursorProject)],
  ["config/codex.toml", CODEX_TOML],
  ["workflows/host-prompts.json", json(HOST_WORKFLOWS)],
  ["raw/preview-revision.request.json", json(rpcRequest(2, "venue.preview_revision", previewInput))],
  ["raw/preview-revision.response.json", json(rpcResponse(2, previewFixture))],
  ["raw/retry-sequence.json", json({ requests: [rpcRequest(3, "venue.preview_revision", previewInput), rpcRequest(4, "venue.preview_revision", previewInput)], responses: [rpcResponse(3, previewFixture), rpcResponse(4, retryFixture)], invariant: "responses[0].result.structuredContent.receipt.id === responses[1].result.structuredContent.receipt.id" })],
  ["raw/stale-base.error.json", json({ jsonrpc: "2.0", id: 5, error: staleError.error })],
  ["raw/validation-failure.response.json", json(rpcResponse(6, failedValidation))],
  ["raw/export-text.response.json", json(rpcResponse(7, exported))],
  ["webmcp/browser-invocation.mjs", await readFile(new URL("webmcp/browser-invocation.mjs", source), "utf8")],
  ["typescript/supervised-workflow.ts", await readFile(new URL("typescript/supervised-workflow.ts", source), "utf8")],
  ["sdk-adapter/src/index.ts", await readFile(new URL("sdk-adapter/src/index.ts", source), "utf8")],
  ["sdk-adapter/test/contract.test.mjs", await readFile(new URL("sdk-adapter/test/contract.test.mjs", source), "utf8")],
  ["sdk-adapter/package.json", await readFile(new URL("sdk-adapter/package.json", source), "utf8")],
  ["sdk-adapter/tsconfig.json", await readFile(new URL("sdk-adapter/tsconfig.json", source), "utf8")],
]);

const manifest = {
  schemaVersion: 1,
  generatedAt: "2026-08-27",
  safetyBoundary: "Agent examples stop at human Approval.",
  files: [...artifacts.keys()].map((path) => ({
    path,
    validation: path.startsWith("config/") ? "configuration" : path.startsWith("raw/") ? "runtime-contract" : path.startsWith("webmcp/") ? "executed-webmcp" : path.startsWith("typescript/") ? "compiled-and-executed-mcp" : path.startsWith("sdk-adapter/") ? "packed-sdk-contract-suite" : "content",
  })),
  sourceVersions: { projectSchema: 10, toolContract: "1.2.0", mcpServer: "0.4.0", validationEngine: failedValidation.engineVersion },
  expected: {
    retryReceiptId: preview.receipt.id,
    staleErrorCode: staleError.error.code,
    validationStatus: failedValidation.status,
    validationBlockingIssues: failedValidation.blockingIssues,
    exportFormat: exported.format,
  },
};
artifacts.set("manifest.json", json(manifest));

await Promise.all([...artifacts.entries()].map(async ([path, content]) => {
  const target = new URL(path, output);
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(target, content);
}));

if (failedValidation.status !== "fail") throw new Error("Validation-failure fixture did not fail");
if (preview.receipt.id !== retry.receipt.id) throw new Error("Retry fixture did not reuse the original receipt");
if (!errorCatalog[staleError.error.code]) throw new Error("Stale-base fixture uses an unpublished error");
console.log(`Generated ${artifacts.size} executable client example artifacts`);
