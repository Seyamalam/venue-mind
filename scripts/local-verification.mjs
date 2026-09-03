#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { displayCommand, LOCAL_VERIFICATION_PHASES } from "./local-verification-plan.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export class LocalVerificationError extends Error {
  constructor(message, summary) {
    super(message);
    this.name = "LocalVerificationError";
    this.summary = summary;
  }
}

const artifactId = (date) => date.toISOString().replace(/[-:.]/g, "");
const relativeTo = (root, target) => path.relative(root, target).split(path.sep).join("/");

export async function executePhase({ phase, cwd, logPath }) {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(logPath, { flags: "a" });
    let settled = false;
    const child = spawn(phase.executable, phase.args, {
      cwd,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", VENUEMIND_LOCAL_VERIFICATION: "1" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.stdout.pipe(process.stdout, { end: false });
    child.stderr.pipe(process.stderr, { end: false });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      log.end();
      reject(error);
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      log.end(() => {
        if (signal) reject(new Error(`${phase.id} terminated by ${signal}`));
        else resolve(exitCode ?? 1);
      });
    });
  });
}

export async function runLocalVerification({
  root = projectRoot,
  artifactRoot = path.join(root, ".artifacts", "local-verification"),
  phases = LOCAL_VERIFICATION_PHASES,
  execute = executePhase,
  now = () => new Date(),
} = {}) {
  const startedAt = now();
  const runDirectory = path.join(artifactRoot, `${artifactId(startedAt)}-${process.pid}`);
  await mkdir(runDirectory, { recursive: true });
  const summaryPath = path.join(runDirectory, "summary.json");
  const latestPath = path.join(artifactRoot, "latest.json");
  const summary = {
    schemaVersion: 1,
    status: "running",
    startedAt: startedAt.toISOString(),
    finishedAt: null,
    runDirectory: relativeTo(root, runDirectory),
    phases: phases.map((phase, index) => ({
      id: phase.id,
      label: phase.label,
      command: displayCommand(phase),
      status: "pending",
      exitCode: null,
      durationMs: null,
      log: relativeTo(root, path.join(runDirectory, `${String(index + 1).padStart(2, "0")}-${phase.id}.log`)),
    })),
  };
  const persist = async () => {
    const serialized = `${JSON.stringify(summary, null, 2)}\n`;
    await Promise.all([
      writeFile(summaryPath, serialized),
      writeFile(latestPath, `${JSON.stringify({ schemaVersion: 1, summary: relativeTo(root, summaryPath) }, null, 2)}\n`),
    ]);
  };
  await persist();

  for (const [index, phase] of phases.entries()) {
    const phaseSummary = summary.phases[index];
    const phaseStartedAt = now();
    phaseSummary.status = "running";
    await persist();
    const logPath = path.join(root, phaseSummary.log);
    await writeFile(logPath, `$ ${phaseSummary.command}\n`);
    process.stdout.write(`\n[${index + 1}/${phases.length}] ${phase.label}\n`);
    let exitCode;
    try {
      exitCode = await execute({ phase, cwd: root, logPath });
    } catch (error) {
      await writeFile(logPath, `${error instanceof Error ? error.message : String(error)}\n`, { flag: "a" });
      exitCode = 1;
    }
    phaseSummary.exitCode = exitCode;
    phaseSummary.durationMs = Math.max(0, now().getTime() - phaseStartedAt.getTime());
    phaseSummary.status = exitCode === 0 ? "passed" : "failed";
    if (exitCode !== 0) {
      for (const remaining of summary.phases.slice(index + 1)) remaining.status = "skipped";
      summary.status = "failed";
      summary.finishedAt = now().toISOString();
      await persist();
      throw new LocalVerificationError(`${phase.label} failed; evidence: ${relativeTo(root, summaryPath)}`, summary);
    }
    await persist();
  }
  summary.status = "passed";
  summary.finishedAt = now().toISOString();
  await persist();
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const summary = await runLocalVerification();
    console.log(`\nLocal verification passed; evidence: ${summary.runDirectory}/summary.json`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
