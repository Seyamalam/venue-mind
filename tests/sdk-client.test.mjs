import assert from "node:assert/strict";
import test from "node:test";
import { createVenueMindClient } from "../packages/sdk/dist/client.js";

test("typed client delegates every namespace to the canonical tool seam", async () => {
  const calls = [];
  const transport = {
    async callTool(name, input, options) {
      calls.push({ name, input, signal: options?.signal ?? null });
      if (name === "venue.list_projects") return [];
      if (name === "venue.open_project") return { id: input.projectId };
      if (name === "venue.inspect_layout") return { planId: "plan-main" };
      if (name === "venue.preview_revision") return { proposalId: "proposal-next" };
      if (name === "venue.validate_layout") return { status: "pass" };
      if (name === "venue.get_change_log") return [];
      return { format: input.format ?? "audit" };
    },
  };
  const client = createVenueMindClient({ transport });
  const controller = new AbortController();

  await client.projects.list();
  await client.projects.open("project-main");
  await client.plans.inspect();
  await client.proposals.preview({ goal: "Protect access", idempotencyKey: "preview-001" });
  await client.validations.run({ signal: controller.signal });
  await client.ledger.list();
  await client.exports.plan("svg");
  await client.exports.audit();

  assert.deepEqual(calls.map(({ name }) => name), [
    "venue.list_projects",
    "venue.open_project",
    "venue.inspect_layout",
    "venue.preview_revision",
    "venue.validate_layout",
    "venue.get_change_log",
    "venue.export_plan",
    "venue.export_audit_package",
  ]);
  assert.deepEqual(calls[1].input, { projectId: "project-main" });
  assert.deepEqual(calls[6].input, { format: "svg" });
  assert.equal(calls[4].signal, controller.signal);
  assert.equal("approve" in client, false);
  assert.ok(Object.isFrozen(client));
});

test("client rejects an invalid transport before any tool call", () => {
  assert.throws(() => createVenueMindClient({ transport: {} }), /requires a transport/);
});
