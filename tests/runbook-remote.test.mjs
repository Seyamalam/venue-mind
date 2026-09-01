import assert from "node:assert/strict";
import test from "node:test";
import { createRunbookRemote } from "../src/persistence/runbook-remote.js";

const response = (body, { status = 200, contentType = "application/json" } = {}) => new Response(contentType === "application/json" ? JSON.stringify(body) : String(body), { status, headers: { "content-type": contentType } });

test("Runbook remote scopes create, get, and ordered transition sync requests", async () => {
  const requests = [];
  const remote = createRunbookRemote({
    organizationId: "org-a",
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, init });
      return response(url.endsWith("transitions:sync") ? { acknowledgements: [], runbook: { versionId: "runbook-v1" } } : { runbook: { versionId: "runbook-v1" } });
    },
  });
  const runbook = { versionId: "runbook-v1" };
  await remote.create("project/a", runbook);
  await remote.get("project/a", "runbook/v1");
  await remote.sync("project/a", "runbook/v1", [{ clientSequence: 1 }, { clientSequence: 2 }]);

  assert.deepEqual(requests.map(({ url }) => url), [
    "/api/projects/project%2Fa/runbooks",
    "/api/projects/project%2Fa/runbooks/runbook%2Fv1",
    "/api/projects/project%2Fa/runbooks/runbook%2Fv1/transitions:sync",
  ]);
  assert.deepEqual(requests.map(({ init }) => init.headers["x-venuemind-organization-id"]), ["org-a", "org-a", "org-a"]);
  assert.deepEqual(JSON.parse(requests[0].init.body), { runbook });
  assert.deepEqual(JSON.parse(requests[2].init.body).commands.map((command) => command.clientSequence), [1, 2]);
});

test("Runbook remote preserves structured API failures and rejects non-JSON endpoints", async () => {
  const denied = createRunbookRemote({ organizationId: "org-a", fetchImpl: async () => response({ error: { code: "AUTHORIZATION_DENIED", message: "Denied", details: { permission: "project.manage" } } }, { status: 403 }) });
  await assert.rejects(() => denied.get("project-a", "runbook-v1"), (error) => error.code === "AUTHORIZATION_DENIED" && error.status === 403 && error.details.permission === "project.manage");

  const unavailable = createRunbookRemote({ organizationId: "org-a", fetchImpl: async () => response("not found", { status: 404, contentType: "text/html" }) });
  await assert.rejects(() => unavailable.create("project-a", { versionId: "runbook-v1" }), (error) => error.code === "RUNBOOK_API_UNAVAILABLE" && error.status === 404);
});
