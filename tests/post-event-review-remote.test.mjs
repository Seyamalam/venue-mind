import assert from "node:assert/strict";
import test from "node:test";
import { createPostEventReviewRemote } from "../src/persistence/post-event-review-remote.ts";
import {
  makePostEventReviewFixture,
  observationCommand,
  projectId,
} from "./post-event-review-persistence-fixture.mjs";

test("Post-Event Review remote sends exact create, get, sync, and on-demand export requests", async () => {
  const { review, runbook, occupancyMonitor, incidentRegister, deviationRegister, scenarioRun, predictions } =
    makePostEventReviewFixture();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    const payload = url.includes("/export?")
      ? { artifact: { filename: `${review.id}.txt`, mimeType: "text/plain", content: "POST-EVENT REVIEW" } }
      : url.endsWith("commands:sync")
        ? { review, acknowledgements: [] }
        : { review };
    return new Response(JSON.stringify(payload), {
      status: url.endsWith("/post-event-reviews") ? 201 : 200,
      headers: { "content-type": "application/json" },
    });
  };
  const remote = createPostEventReviewRemote({ organizationId: "org-alpha", fetchImpl });
  const createInput = {
    runbookVersionId: runbook.versionId,
    occupancyMonitorId: occupancyMonitor.id,
    incidentRegisterId: incidentRegister.id,
    deviationRegisterId: deviationRegister.id,
    scenarioRunIds: [scenarioRun.id],
    predictions,
  };
  await remote.create(projectId, createInput);
  await remote.get(projectId, review.id);
  await remote.sync(projectId, review.id, [observationCommand(1, "remote-observation")]);
  await remote.export(projectId, review.id, "text");

  assert.deepEqual(JSON.parse(calls[0].init.body), createInput);
  assert.deepEqual(Object.keys(JSON.parse(calls[2].init.body).commands[0]).sort(), [
    "confidence",
    "evidenceRefs",
    "expectedRevision",
    "idempotencyKey",
    "observationId",
    "operationId",
    "predictionKey",
    "type",
    "value",
  ]);
  assert.deepEqual(
    calls.map((call) => [call.url, call.init.method ?? "GET"]),
    [
      [`/api/projects/${projectId}/post-event-reviews`, "POST"],
      [`/api/projects/${projectId}/post-event-reviews/${review.id}`, "GET"],
      [`/api/projects/${projectId}/post-event-reviews/${review.id}/commands:sync`, "POST"],
      [`/api/projects/${projectId}/post-event-reviews/${review.id}/export?format=text`, "GET"],
    ],
  );
  assert.ok(calls.every((call) => call.init.headers["x-venuemind-organization-id"] === "org-alpha"));
  assert.ok(calls.every((call) => call.init.credentials === "same-origin"));
});

test("Post-Event Review remote rejects corrupt success data and preserves structured conflicts", async () => {
  const { review } = makePostEventReviewFixture();
  const malformed = createPostEventReviewRemote({
    organizationId: "org-alpha",
    fetchImpl: async () =>
      new Response(JSON.stringify({ review: { ...review, predictions: [{}] } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  await assert.rejects(
    () => malformed.get(projectId, review.id),
    (error) => error.code === "POST_EVENT_REVIEW_RESPONSE_INVALID" && error.status === 502,
  );

  const failing = createPostEventReviewRemote({
    organizationId: "org-alpha",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "POST_EVENT_REVISION_CONFLICT",
            message: "Conflict",
            details: { currentRevision: 4 },
          },
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
  });
  await assert.rejects(
    () => failing.get(projectId, review.id),
    (error) =>
      error.code === "POST_EVENT_REVISION_CONFLICT" &&
      error.status === 409 &&
      error.details.currentRevision === 4,
  );
});
