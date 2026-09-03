import { createActivityEntry, sealActivityLedger } from "../domain/activity-ledger.ts";
import { summitForwardPlan } from "../domain/summit-forward.ts";
import { createVenuePlanner, type PlannerSnapshot } from "../domain/venue-planner.ts";
import type { VenueComment } from "../domain/comments.ts";
import type { VenueObject, VenuePlanDocument } from "../domain/geometry.ts";
import type { PlanPerformanceTarget } from "./performance-targets.ts";

const occurredAt = "2026-09-03T12:00:00.000Z";

const benchmarkObject = (index: number): VenueObject => ({
  id: `obj-benchmark-${String(index).padStart(5, "0")}`,
  kind: "annotation",
  label: `B${index}`,
  layer: "annotations",
  accessibility: { clearanceExempt: true },
  circulation: { blocksExitApproach: false },
  footprint: {
    kind: "circle",
    center: { x: 0.2 + ((index * 37) % 296) / 10, y: 0.2 + ((index * 53) % 196) / 10 },
    radius: 0.025,
  },
});

export function createBenchmarkPlan(target: PlanPerformanceTarget): VenuePlanDocument {
  const plan = structuredClone(summitForwardPlan);
  const extras = Math.max(0, target.objects - plan.objects.length);
  plan.id = `plan-benchmark-${target.name}`;
  plan.event = { ...plan.event, id: `event-benchmark-${target.name}`, name: `Benchmark ${target.name}` };
  plan.brief = { ...plan.brief, id: `brief-benchmark-${target.name}`, eventName: `Benchmark ${target.name}` };
  plan.objects = [...plan.objects, ...Array.from({ length: extras }, (_, index) => benchmarkObject(index + 1))];
  const baseConstraint = plan.constraints[0];
  if (!baseConstraint) throw new Error("Benchmark fixture requires a base Constraint");
  plan.constraints = [
    ...plan.constraints,
    ...Array.from({ length: Math.max(0, target.constraints - plan.constraints.length) }, (_, index) => ({
      ...structuredClone(baseConstraint),
      id: `constraint-benchmark-${String(index + 1).padStart(3, "0")}`,
      checkId: `check-benchmark-${String(index + 1).padStart(3, "0")}`,
      label: `B${index + 1}`,
      enabled: false,
    })),
  ];
  return plan;
}

const benchmarkComment = (planId: string, planVersion: string, index: number): VenueComment => ({
  id: `comment-benchmark-${String(index).padStart(5, "0")}`,
  anchor: { kind: "coordinate", planId, planVersion, point: { x: index % 30, y: index % 20 } },
  body: `B${index}`,
  mentions: [],
  decisionRelevant: false,
  status: "open",
  authorId: "benchmark",
  authorType: "system",
  createdAt: occurredAt,
  updatedAt: occurredAt,
  resolvedAt: null,
  resolvedBy: null,
  editHistory: [],
});

export function createBenchmarkSnapshot(target: PlanPerformanceTarget): PlannerSnapshot {
  const planner = createVenuePlanner(createBenchmarkPlan(target));
  const snapshot = structuredClone(planner.getSnapshot());
  const fillerCount = Math.max(0, target.ledgerEntries - snapshot.ledger.length);
  const fillerEntries = Array.from({ length: fillerCount }, (_, index) =>
    createActivityEntry(
      snapshot.ledger.length + index + 1,
      "benchmark.observed",
      "system",
      { source: "benchmark", reasonCode: String(index) },
      { occurredAt },
    ),
  );
  snapshot.ledger = sealActivityLedger([...snapshot.ledger, ...fillerEntries]);
  snapshot.comments = Array.from({ length: target.comments }, (_, index) =>
    benchmarkComment(snapshot.plan.id, snapshot.plan.version, index + 1),
  );
  const baseBranch = snapshot.branches[0];
  if (!baseBranch) throw new Error("Benchmark fixture requires a base branch");
  snapshot.branches = Array.from({ length: target.branches }, (_, index) => {
    if (index === 0) return baseBranch;
    return {
      ...structuredClone(baseBranch),
      id: `branch-benchmark-${index + 1}`,
      name: `B${index + 1}`,
      proposal: { ...structuredClone(baseBranch.proposal), id: `proposal-benchmark-${index + 1}` },
      createdAt: occurredAt,
    };
  });
  return snapshot;
}
