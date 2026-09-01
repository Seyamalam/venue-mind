import assert from "node:assert/strict";
import test from "node:test";
import { createVenueAdapter, defineAdapter } from "../packages/sdk/dist/adapter.js";
import { createAdapterSandboxServer } from "../packages/sdk/dist/sandbox.js";

test("adapter sandbox binds to loopback and exposes no Approval route", async (context) => {
  let exportCalls = 0;
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
      exportCalls += 1;
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
  const exported = await fetch(`${sandbox.url}/invoke/export`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: sandbox.url },
    body: "{}",
  }).then((response) => response.json());
  assert.equal(exported.status, "succeeded");
  assert.equal(exported.output.data.ok, true);
  assert.equal(exportCalls, 1);

  const crossOrigin = await fetch(`${sandbox.url}/invoke/export`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://attacker.example" },
    body: "{}",
  });
  assert.equal(crossOrigin.status, 403);
  assert.deepEqual(await crossOrigin.json(), { error: { code: "SANDBOX_ORIGIN_DENIED" } });
  assert.equal(exportCalls, 1);

  const wrongMediaType = await fetch(`${sandbox.url}/invoke/export`, {
    method: "POST",
    headers: { "content-type": "text/plain", origin: sandbox.url },
    body: "{}",
  });
  assert.equal(wrongMediaType.status, 415);
  assert.deepEqual(await wrongMediaType.json(), { error: { code: "SANDBOX_MEDIA_TYPE_REQUIRED" } });
  assert.equal(exportCalls, 1);

  const approval = await fetch(`${sandbox.url}/approve`, { method: "POST", body: "{}" });
  assert.equal(approval.status, 404);
});

test("adapter sandbox rejects public network binds", async () => {
  await assert.rejects(
    createAdapterSandboxServer({ adapter: { definition: { id: "x" } } }, { host: "0.0.0.0" }),
    /loopback/,
  );
});
