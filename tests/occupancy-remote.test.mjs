import assert from "node:assert/strict";
import test from "node:test";
import { createOccupancyRemote } from "../src/persistence/occupancy-remote.ts";

const monitor = {
  schemaVersion: 1,
  id: "occupancy-1",
  projectId: "project-alpha",
  runbookVersionId: "runbook-alpha-v1",
  source: {},
  baseline: {},
  policy: {},
  feeds: [],
  observations: [],
  activeAlerts: [],
  receipts: [],
  ledger: [],
  revision: 0,
  createdAt: "2026-09-01T10:00:00.000Z",
  updatedAt: "2026-09-01T10:00:00.000Z",
};
const projection = {
  monitorId: "occupancy-1",
  runbookVersionId: "runbook-alpha-v1",
  evaluatedAt: "2026-09-01T10:00:00.000Z",
  overallStatus: "nominal",
  sources: [],
  scopes: [],
  alerts: [],
  privacy: { mode: "aggregate-only" },
};

test("Live Occupancy remote scopes create, get, sync, and export requests to one Project", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify(
        url.endsWith("/export")
          ? { artifact: { filename: "occupancy.audit.json", mimeType: "application/json", content: "{}" } }
          : url.endsWith("commands:sync")
            ? { acknowledgements: [], monitor, projection }
            : { monitor, projection },
      ),
      { status: url.endsWith("/occupancy-monitors") ? 201 : 200, headers: { "content-type": "application/json" } },
    );
  };
  const remote = createOccupancyRemote({ organizationId: "org-alpha", fetchImpl });
  await remote.create("project-alpha", { runbookVersionId: "runbook-alpha-v1" });
  await remote.get("project-alpha", "occupancy-alpha");
  await remote.sync("project-alpha", "occupancy-alpha", [{ type: "refresh_live_occupancy" }]);
  await remote.export("project-alpha", "occupancy-alpha");
  assert.deepEqual(
    calls.map((call) => [call.url, call.init.method ?? "GET"]),
    [
      ["/api/projects/project-alpha/occupancy-monitors", "POST"],
      ["/api/projects/project-alpha/occupancy-monitors/occupancy-alpha", "GET"],
      ["/api/projects/project-alpha/occupancy-monitors/occupancy-alpha/commands:sync", "POST"],
      ["/api/projects/project-alpha/occupancy-monitors/occupancy-alpha/export", "GET"],
    ],
  );
  assert.ok(calls.every((call) => call.init.headers["x-venuemind-organization-id"] === "org-alpha"));
  assert.ok(calls.every((call) => call.init.credentials === "same-origin"));
});

test("Live Occupancy remote preserves structured API failures", async () => {
  const remote = createOccupancyRemote({
    organizationId: "org-alpha",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ code: "OCCUPANCY_REVISION_CONFLICT", error: "Conflict", details: { currentRevision: 4 } }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
  });
  await assert.rejects(
    () => remote.get("project-alpha", "occupancy-alpha"),
    (error) =>
      error.code === "OCCUPANCY_REVISION_CONFLICT" && error.details.currentRevision === 4 && error.status === 409,
  );
});
