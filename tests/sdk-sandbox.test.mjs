import assert from "node:assert/strict";
import test from "node:test";
import { createVenueAdapter, defineAdapter } from "../packages/sdk/dist/adapter.js";
import { createAdapterSandboxServer } from "../packages/sdk/dist/sandbox.js";

test("adapter sandbox binds to loopback and exposes no Approval route", async (context) => {
  const definition = defineAdapter({
    contractVersion: 1,
    id: "sandbox-export",
    displayName: "Sandbox export",
    version: "1.0.0",
    capabilities: ["export"],
    scopes: { export: ["inventory:write"] },
  });
  const adapter = createVenueAdapter(definition, {
    async export() {
      return { sourceSystem: "sandbox", mediaType: "application/json", sourceVersion: "fixture-v1", data: { ok: true } };
    },
  });
  const sandbox = await createAdapterSandboxServer({
    adapter,
    fixtures: [{ id: "fixture-safe" }],
    authorization: { grantedScopes: ["inventory:write"] },
  });
  context.after(() => sandbox.close());

  assert.match(sandbox.url, /^http:\/\/(127\.0\.0\.1|\[::1\]|localhost):\d+$/);
  const health = await fetch(`${sandbox.url}/health`).then((response) => response.json());
  assert.deepEqual(health, { status: "ok", adapterId: "sandbox-export", adapterVersion: "1.0.0" });
  const exported = await fetch(`${sandbox.url}/invoke/export`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((response) => response.json());
  assert.equal(exported.status, "succeeded");
  assert.equal(exported.output.data.ok, true);
  const approval = await fetch(`${sandbox.url}/approve`, { method: "POST", body: "{}" });
  assert.equal(approval.status, 404);
});

test("adapter sandbox rejects public network binds", async () => {
  await assert.rejects(
    createAdapterSandboxServer({ adapter: { definition: { id: "x" } } }, { host: "0.0.0.0" }),
    /loopback/,
  );
});
