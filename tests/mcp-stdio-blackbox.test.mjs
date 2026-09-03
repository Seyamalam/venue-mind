import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = path.resolve(new URL("../", import.meta.url).pathname);
const decodeText = (result) => {
  const content = result.content.find((item) => item.type === "text");
  assert.ok(content);
  return JSON.parse(content.text);
};

test("stdio MCP is a black box with schema rejection and no partial Project mutation", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "venuemind-mcp-blackbox-"));
  const environment = Object.fromEntries(
    Object.entries(process.env).filter((entry) => entry[1] !== undefined),
  );
  environment.VENUEMIND_DATA_DIR = directory;
  const client = new Client({ name: "venuemind-blackbox-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, "packages/mcp-server/dist/index.js")],
    env: environment,
  });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.ok(tools.tools.some(({ name }) => name === "venue.preview_revision"));
    assert.equal(tools.tools.some(({ name }) => /approve/i.test(name)), false);
    const before = decodeText(await client.callTool({ name: "venue.inspect_layout", arguments: {} }));
    const invalid = await client.callTool({
      name: "venue.preview_revision",
      arguments: { goal: "Missing retry identity" },
    });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content.find((item) => item.type === "text")?.text ?? "", /idempotencyKey|invalid/i);
    const after = decodeText(await client.callTool({ name: "venue.inspect_layout", arguments: {} }));
    assert.equal(after.planVersion, before.planVersion);
    assert.deepEqual(after.proposal, before.proposal);
    assert.deepEqual(after.objects, before.objects);
  } finally {
    await client.close();
    await rm(directory, { recursive: true, force: true });
  }
});
