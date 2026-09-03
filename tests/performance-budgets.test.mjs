import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runPerformanceBenchmarks } from "../src/performance/benchmark.ts";
import { PERFORMANCE_OPERATIONS, PLAN_PERFORMANCE_TARGETS } from "../src/performance/performance-targets.ts";

test("performance targets scale monotonically and budget every golden-loop operation", () => {
  const { small, medium, large } = PLAN_PERFORMANCE_TARGETS;
  for (const key of ["objects", "constraints", "ledgerEntries", "comments", "branches"])
    assert.ok(small[key] < medium[key] && medium[key] < large[key]);
  for (const target of [small, medium, large]) {
    assert.deepEqual(Object.keys(target.budgetsMs).sort(), [...PERFORMANCE_OPERATIONS].sort());
    assert.ok(Object.values(target.budgetsMs).every((budget) => Number.isFinite(budget) && budget > 0));
  }
});

test("small deterministic workload remains inside local regression budgets", () => {
  const report = runPerformanceBenchmarks({ targetName: "small", iterations: 1 });
  assert.equal(report.measurements.length, PERFORMANCE_OPERATIONS.length);
  assert.equal(report.passed, true, JSON.stringify(report.measurements, null, 2));
});

test("long operational lists and canvas objects use bounded rendering", async () => {
  const [virtualList, history, comments, editor] = await Promise.all([
    readFile(new URL("../src/VirtualList.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/HistoryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/CommentsPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/PlanEditor.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(virtualList, /items\.slice\(range\.first, range\.last\)/);
  assert.match(history, /<VirtualList/);
  assert.match(comments, /<VirtualList/);
  assert.match(editor, /visiblePlanObjects/);
  assert.match(editor, /objectIndex\.queryBounds/);
});
