import assert from "node:assert/strict";
import test from "node:test";
import { createEventDayRunbook } from "../src/domain/event-day-runbook.ts";
import { createLivePlanDeviationRegister } from "../src/domain/live-plan-deviations.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";
import { createDeviationRemote } from "../src/persistence/deviation-remote.ts";

const register = createLivePlanDeviationRegister({
  type: "create_deviation_register",
  projectId: "project-summit-forward",
  runbook: createEventDayRunbook({
    projectId: "project-summit-forward",
    plan: summitForwardPlan,
    validation: { validationId: "validation-approved", inputFingerprint: "validation-input", status: "pass" },
    sourceLedgerHeadHash: "activity-ledger-head",
    approvalLedgerEntryId: "approval-ledger-entry",
    frozenAt: "2026-09-12T08:00:00.000Z",
    frozenBy: "user-ops",
  }),
  createdAt: "2026-09-12T09:00:00.000Z",
  createdBy: "user-ops",
});

test("Deviation remote scopes create, get, sync, and export to one Project", async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const payload = url.endsWith("/export")
      ? {
          artifact: {
            filename: "live-plan-deviations.json",
            mediaType: "application/json",
            content: "{}",
            fingerprint: "live-plan-deviation-export-12345678",
          },
        }
      : url.endsWith("commands:sync")
        ? { acknowledgements: [], register }
        : { register };
    return new Response(JSON.stringify(payload), {
      status: url.endsWith("/deviation-registers") ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  };
  const remote = createDeviationRemote({ organizationId: "org-alpha", fetchImpl });
  await remote.create("project-summit-forward", { runbookVersionId: register.runbookVersionId });
  await remote.get("project-summit-forward", register.id);
  await remote.sync("project-summit-forward", register.id, []);
  await remote.export("project-summit-forward", register.id);

  assert.deepEqual(
    calls.map((call) => [call.url, call.init.method ?? "GET"]),
    [
      ["/api/projects/project-summit-forward/deviation-registers", "POST"],
      [`/api/projects/project-summit-forward/deviation-registers/${register.id}`, "GET"],
      [`/api/projects/project-summit-forward/deviation-registers/${register.id}/commands:sync`, "POST"],
      [`/api/projects/project-summit-forward/deviation-registers/${register.id}/export`, "GET"],
    ],
  );
  assert.ok(calls.every((call) => call.init.headers["x-venuemind-organization-id"] === "org-alpha"));
  assert.ok(calls.every((call) => call.init.credentials === "same-origin"));
});

test("Deviation remote rejects malformed success payloads and preserves structured API failures", async () => {
  const malformed = createDeviationRemote({
    organizationId: "org-alpha",
    fetchImpl: async () =>
      new Response(JSON.stringify({ register: { ...register, deviations: [{}] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(
    () => malformed.get("project-summit-forward", register.id),
    (error) => error.code === "DEVIATION_RESPONSE_INVALID" && error.status === 502,
  );

  const failing = createDeviationRemote({
    organizationId: "org-alpha",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          code: "DEVIATION_REGISTER_REVISION_CONFLICT",
          error: "Conflict",
          details: { currentRevision: 4 },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
  });
  await assert.rejects(
    () => failing.get("project-summit-forward", register.id),
    (error) =>
      error.code === "DEVIATION_REGISTER_REVISION_CONFLICT" &&
      error.status === 409 &&
      error.details.currentRevision === 4,
  );
});
