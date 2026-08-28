import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { build } from "esbuild";
import { venueToolContracts } from "../src/contracts/venue-contracts.js";
import { errorCatalog } from "../src/domain/errors.js";
import { CLIENT_CONFIGS, CODEX_TOML, HOST_WORKFLOWS, PLACEHOLDERS } from "../src/examples/client-catalog.js";
import { runBrowserExample } from "../examples/webmcp/browser-invocation.mjs";

const executeFile = promisify(execFile);
const root = path.resolve(new URL("../", import.meta.url).pathname);
const publishedRoot = path.join(root, "public/examples/client");
const readJson = async (relative) => JSON.parse(await readFile(path.join(publishedRoot, relative), "utf8"));

async function filesBelow(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path.join(directory, entry.name), relative));
    else files.push(relative);
  }
  return files.sort();
}

function assertToolInput(name, input) {
  const contract = venueToolContracts.find((tool) => tool.name === name);
  assert.ok(contract, name);
  for (const field of contract.inputSchema.required ?? []) assert.ok(Object.hasOwn(input, field), `${name}.${field}`);
  if (contract.inputSchema.additionalProperties === false) {
    for (const field of Object.keys(input)) assert.ok(Object.hasOwn(contract.inputSchema.properties ?? {}, field), `${name}.${field} is not published`);
  }
}

test("every published client example is declared and free of local paths or secrets", async () => {
  const manifest = await readJson("manifest.json");
  const files = await filesBelow(publishedRoot);
  assert.deepEqual(files, [...manifest.files.map((item) => item.path), "manifest.json"].sort());
  assert.equal(new Set(manifest.files.map((item) => item.validation)).has("compiled-and-executed-mcp"), true);
  assert.equal(manifest.safetyBoundary, "Agent examples stop at human Approval.");
  for (const relative of files) {
    const content = await readFile(path.join(publishedRoot, relative), "utf8");
    assert.doesNotMatch(content, /\/Users\/|\/home\/[a-z0-9_-]+|[A-Z]:\\Users\\|sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]+/i, relative);
  }
});

test("generic, Codex, Claude Desktop, and Cursor configurations share one safe stdio definition", async () => {
  assert.deepEqual(await readJson("config/generic-stdio.json"), CLIENT_CONFIGS.generic);
  assert.deepEqual(await readJson("config/claude-desktop.json"), CLIENT_CONFIGS.claudeDesktop);
  assert.deepEqual(await readJson("config/cursor-project.json"), CLIENT_CONFIGS.cursorProject);
  assert.deepEqual(CLIENT_CONFIGS.claudeDesktop.mcpServers.venuemind, CLIENT_CONFIGS.cursorProject.mcpServers.venuemind);
  assert.equal(CLIENT_CONFIGS.generic.command, "node");
  assert.equal(CLIENT_CONFIGS.generic.transport, "stdio");
  assert.match(CLIENT_CONFIGS.generic.args[0], new RegExp(`^${PLACEHOLDERS.root.replace(/[<>]/g, "\\$&")}`));
  assert.equal(await readFile(path.join(publishedRoot, "config/codex.toml"), "utf8"), CODEX_TOML);
  assert.match(CODEX_TOML, /^\[mcp_servers\.venuemind\]$/m);
  assert.match(CODEX_TOML, /VENUEMIND_DATA_DIR/);
  assert.match(CODEX_TOML, /VENUEMIND_ORGANIZATION_ID/);
  assert.deepEqual(Object.keys(HOST_WORKFLOWS).sort(), ["claudeDesktop", "codex", "cursor"]);
  for (const prompt of Object.values(HOST_WORKFLOWS)) assert.match(prompt, /human Approval|human reviewer/);
});

test("raw JSON-RPC fixtures match tool inputs and runtime invariants", async () => {
  const request = await readJson("raw/preview-revision.request.json");
  const response = await readJson("raw/preview-revision.response.json");
  const retry = await readJson("raw/retry-sequence.json");
  const stale = await readJson("raw/stale-base.error.json");
  const failure = await readJson("raw/validation-failure.response.json");
  const exported = await readJson("raw/export-text.response.json");
  assert.equal(request.jsonrpc, "2.0");
  assert.equal(request.method, "tools/call");
  assertToolInput(request.params.name, request.params.arguments);
  assert.equal(response.result.structuredContent.requiresHumanApproval, true);
  for (const item of retry.requests) assertToolInput(item.params.name, item.params.arguments);
  assert.deepEqual(retry.requests[0].params, retry.requests[1].params);
  assert.equal(retry.responses[0].result.structuredContent.receipt.id, retry.responses[1].result.structuredContent.receipt.id);
  assert.deepEqual(stale.error, { ...errorCatalog.PLAN_VERSION_CONFLICT, details: stale.error.details });
  assert.equal(failure.result.structuredContent.status, "fail");
  assert.ok(failure.result.structuredContent.blockingIssues > 0);
  assert.ok(failure.result.structuredContent.checks.some((check) => check.status === "fail" && check.evidence.affectedObjectIds.includes("obj-example-exit-cart")));
  assert.equal(exported.result.structuredContent.format, "text");
  assert.match(exported.result.structuredContent.content, /Plan v3\.2/);
});

test("published WebMCP browser example executes registration, retry, Validation, export, and cleanup", async () => {
  const result = await runBrowserExample();
  assert.equal(result.registeredBeforeAbort, venueToolContracts.length);
  assert.equal(result.registeredAfterAbort, 0);
  assert.equal(result.inspection.isError, undefined);
  assert.equal(result.preview.structuredContent.data.receipt.id, result.retry.structuredContent.data.receipt.id);
  assert.equal(result.validation.structuredContent.data.evaluatedProposalId, result.preview.structuredContent.data.proposalId);
  assert.equal(result.exported.structuredContent.data.format, "text");
});

test("published TypeScript client compiles and completes the real stdio MCP workflow", async () => {
  const directory = await mkdtemp(path.join(root, ".venuemind-client-example-"));
  try {
    const outfile = path.join(directory, "supervised-workflow.mjs");
    await build({ entryPoints: [path.join(root, "examples/typescript/supervised-workflow.ts")], outfile, bundle: true, packages: "external", platform: "node", format: "esm", logLevel: "silent" });
    const { stdout } = await executeFile(process.execPath, [outfile], { cwd: root, env: { ...process.env, VENUEMIND_ROOT: root, VENUEMIND_DATA_DIR: path.join(directory, "data") }, timeout: 20_000 });
    const result = JSON.parse(stdout.trim());
    assert.equal(result.planId, "plan-summit-forward-2026");
    assert.match(result.proposalId, /^proposal-/);
    assert.match(result.validationId, /^validation-/);
    assert.match(result.receiptId, /^receipt-/);
    assert.match(result.export, /\.txt$/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
