import assert from "node:assert/strict";
import test from "node:test";
import { createOccupancyRemote } from "../src/persistence/occupancy-remote.js";

test("Live Occupancy remote scopes create, get, sync, and export requests to one Project", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(url.endsWith("/export") ? { artifact: { filename: "occupancy.audit.json" } } : url.endsWith("commands:sync") ? { acknowledgements: [], monitor: { id: "occupancy-1" }, projection: {} } : { monitor: { id: "occupancy-1" }, projection: {} }), { status: url.endsWith("/occupancy-monitors") ? 201 : 200, headers: { "content-type": "application/json" } });
  };
  const remote = createOccupancyRemote({ organizationId: "org-alpha", fetchImpl });
  await remote.create("project-alpha", { runbookVersionId: "runbook-alpha-v1" });
  await remote.get("project-alpha", "occupancy-alpha");
  await remote.sync("project-alpha", "occupancy-alpha", [{ type: "refresh_live_occupancy" }]);
  await remote.export("project-alpha", "occupancy-alpha");
  assert.deepEqual(calls.map((call) => [call.url, call.init.method ?? "GET"]), [
    ["/api/projects/project-alpha/occupancy-monitors", "POST"],
    ["/api/projects/project-alpha/occupancy-monitors/occupancy-alpha", "GET"],
    ["/api/projects/project-alpha/occupancy-monitors/occupancy-alpha/commands:sync", "POST"],
    ["/api/projects/project-alpha/occupancy-monitors/occupancy-alpha/export", "GET"],
  ]);
  assert.ok(calls.every((call) => call.init.headers["x-venuemind-organization-id"] === "org-alpha"));
  assert.ok(calls.every((call) => call.init.credentials === "same-origin"));
});

test("Live Occupancy remote preserves structured API failures", async () => {
  const remote = createOccupancyRemote({ organizationId: "org-alpha", fetchImpl: async () => new Response(JSON.stringify({ code: "OCCUPANCY_REVISION_CONFLICT", error: "Conflict", details: { currentRevision: 4 } }), { status: 409, headers: { "content-type": "application/json" } }) });
  await assert.rejects(() => remote.get("project-alpha", "occupancy-alpha"), (error) => error.code === "OCCUPANCY_REVISION_CONFLICT" && error.details.currentRevision === 4 && error.status === 409);
});
