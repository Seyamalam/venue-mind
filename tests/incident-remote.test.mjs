import assert from "node:assert/strict";
import test from "node:test";
import { createIncidentRemote } from "../src/persistence/incident-remote.ts";

const register = {
  schemaVersion: 1,
  id: "incident-register-1",
  projectId: "project-alpha",
  runbookVersionId: "runbook-alpha-v1",
  incidents: [],
  transitions: [],
  receipts: [],
  ledger: [],
  revision: 0,
};

test("Incident remote scopes create, get, sync, export, and evidence upload to one Project", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const payload = url.endsWith("/export")
      ? { artifact: { filename: "incident-record.json", mimeType: "application/json", content: "{}" } }
      : url.endsWith("/attachments")
        ? {
            attachment: {
              id: "incident-evidence-1",
              kind: "photo",
              contentType: "image/png",
              byteLength: 4,
              sha256: "a".repeat(64),
            },
            register,
          }
        : url.endsWith("commands:sync")
          ? { acknowledgements: [], register }
          : { register };
    return new Response(JSON.stringify(payload), {
      status: url.endsWith("/incident-registers") ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  };
  const remote = createIncidentRemote({ organizationId: "org-alpha", fetchImpl });
  await remote.create("project-alpha", { runbookVersionId: "runbook-alpha-v1" });
  await remote.get("project-alpha", "incident-register-1");
  await remote.sync("project-alpha", "incident-register-1", [{ type: "report_incident" }]);
  await remote.export("project-alpha", "incident-register-1", "incident-alpha");
  const file = new File([Uint8Array.from([137, 80, 78, 71])], "floor.png", { type: "image/png" });
  await remote.attach("project-alpha", "incident-register-1", "incident-alpha", file);

  assert.deepEqual(
    calls.map((call) => [call.url, call.init.method ?? "GET"]),
    [
      ["/api/projects/project-alpha/incident-registers", "POST"],
      ["/api/projects/project-alpha/incident-registers/incident-register-1", "GET"],
      ["/api/projects/project-alpha/incident-registers/incident-register-1/commands:sync", "POST"],
      ["/api/projects/project-alpha/incident-registers/incident-register-1/incidents/incident-alpha/export", "GET"],
      [
        "/api/projects/project-alpha/incident-registers/incident-register-1/incidents/incident-alpha/attachments",
        "POST",
      ],
    ],
  );
  assert.ok(calls.every((call) => call.init.headers["x-venuemind-organization-id"] === "org-alpha"));
  assert.ok(calls.every((call) => call.init.credentials === "same-origin"));
  assert.ok(calls.at(-1).init.body instanceof FormData);
  assert.equal(calls.at(-1).init.body.get("file").name, file.name);
  assert.equal(calls.at(-1).init.body.get("file").type, file.type);
  assert.equal(Object.hasOwn(calls.at(-1).init.headers, "content-type"), false);
});

test("Incident remote preserves structured API failures and rejects invalid upload input", async () => {
  const remote = createIncidentRemote({
    organizationId: "org-alpha",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({ code: "INCIDENT_REVISION_CONFLICT", error: "Conflict", details: { currentRevision: 4 } }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
  });
  await assert.rejects(
    () => remote.get("project-alpha", "incident-register-1"),
    (error) =>
      error.code === "INCIDENT_REVISION_CONFLICT" && error.details.currentRevision === 4 && error.status === 409,
  );
  await assert.rejects(() => remote.attach("project-alpha", "incident-register-1", "incident-alpha", null), /File/);
});
