import assert from "node:assert/strict";
import test from "node:test";
import { errorCatalog, errorPayload, venueError } from "../src/domain/errors.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";

test("error catalog exposes stable codes, messages, and remediation metadata", () => {
  const entries = Object.entries(errorCatalog);

  assert.ok(entries.length >= 20);
  assert.ok(entries.every(([code, entry]) => /^[A-Z][A-Z0-9_]+$/.test(code) && entry.code === code));
  assert.ok(entries.every(([, entry]) => entry.message.length > 0 && entry.remediation.length > 0));
  assert.equal(Object.isFrozen(errorCatalog), true);

  const error = venueError("PLAN_VERSION_CONFLICT", { expectedVersion: "3.2", receivedVersion: "3.1" });
  assert.equal(error.code, "PLAN_VERSION_CONFLICT");
  assert.match(error.message, /version/i);
  assert.match(error.remediation, /inspect/i);
  assert.deepEqual(error.details, { expectedVersion: "3.2", receivedVersion: "3.1" });
  assert.deepEqual(errorPayload(error), { error: { code: error.code, message: error.message, remediation: error.remediation, details: error.details } });
});

test("planner command failures retain stable error codes and actionable metadata", () => {
  const planner = createVenuePlanner(summitForwardPlan);
  const proposal = planner.getSnapshot().proposal;

  assert.throws(
    () => planner.execute({ type: "approve_proposal", proposalId: proposal.id, baseVersion: "3.1", actor: "human", idempotencyKey: "stale-coded-error" }),
    (error) => error.code === "PLAN_VERSION_CONFLICT" && error.details.expectedVersion === "3.2" && /inspect/i.test(error.remediation),
  );
  assert.throws(
    () => planner.execute({ type: "switch_branch", branchId: "branch-missing", actor: "human", idempotencyKey: "missing-branch-coded-error" }),
    (error) => error.code === "BRANCH_NOT_FOUND" && error.details.branchId === "branch-missing",
  );
  assert.throws(
    () => planner.execute({ type: "preview_revision", goal: "No retry key", actor: "agent" }),
    (error) => error.code === "IDEMPOTENCY_KEY_REQUIRED" && error.details.commandType === "preview_revision",
  );
});
