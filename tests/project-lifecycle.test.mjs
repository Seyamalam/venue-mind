import assert from "node:assert/strict";
import test from "node:test";
import { fingerprintPlan } from "../src/domain/activity-ledger.js";
import { duplicateProjectRecord } from "../src/domain/project-lifecycle.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";

test("Project duplication creates a new lineage root with new Project-scoped stable IDs", () => {
  const sourcePlanner = createVenuePlanner(summitForwardPlan);
  const source = { id: "project-summit-forward", name: "SummitForward 2026", activePlanId: summitForwardPlan.id, schemaVersion: 10, snapshot: sourcePlanner.getSnapshot(), createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" };
  const duplicate = duplicateProjectRecord(source, { projectId: "project-copy-001", name: "Summit Copy", clock: () => "2026-08-27T02:00:00.000Z" });

  assert.equal(duplicate.id, "project-copy-001");
  assert.equal(duplicate.activePlanId, "plan-copy-001");
  assert.equal(duplicate.snapshot.plan.version, "1.0");
  assert.equal(duplicate.snapshot.plan.event.id, "event-copy-001");
  assert.equal(duplicate.snapshot.brief.id, "brief-copy-001");
  assert.equal(duplicate.snapshot.proposal.id, "proposal-copy-001-001");
  assert.equal(duplicate.snapshot.proposal.changes.every((change) => change.id.startsWith("chg-copy-001-")), true);
  assert.equal(duplicate.snapshot.brief.requirements.every((requirement) => requirement.id.startsWith("req-copy-001-")), true);
  assert.equal(duplicate.snapshot.ledger.length, 1);
  assert.equal(duplicate.snapshot.ledger[0].type, "plan.opened");
  assert.equal(duplicate.provenance.sourceProjectId, source.id);
  assert.equal(duplicate.provenance.sourcePlanFingerprint, fingerprintPlan(source.snapshot.plan));
  assert.equal(duplicate.pinned, false);
});
