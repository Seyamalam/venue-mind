import { runPerformanceBenchmarks } from "../src/performance/benchmark.ts";
import { PLAN_PERFORMANCE_TARGETS } from "../src/performance/performance-targets.ts";

const targetArg = process.argv.find((argument) => argument.startsWith("--target="))?.split("=")[1] ?? "large";
if (!(targetArg in PLAN_PERFORMANCE_TARGETS)) throw new Error(`Unknown performance target: ${targetArg}`);
const iterationsArg = process.argv.find((argument) => argument.startsWith("--iterations="))?.split("=")[1];
const iterations = iterationsArg ? Number(iterationsArg) : 3;
const report = runPerformanceBenchmarks({ targetName: targetArg, iterations });
for (const measurement of report.measurements)
  process.stdout.write(
    `${measurement.passed ? "PASS" : "FAIL"} ${measurement.operation.padEnd(13)} ${measurement.medianMs.toFixed(3).padStart(10)} ms / ${String(measurement.budgetMs).padStart(4)} ms\n`,
  );
if (!report.passed) process.exitCode = 1;
