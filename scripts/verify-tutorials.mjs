#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { tutorialEvidence } from "../src/docs/pages/tutorials.ts";

const evidenceFiles = [...new Set(tutorialEvidence.flatMap((tutorial) => tutorial.evidenceFiles))];
const result = spawnSync(process.execPath, ["--test", ...evidenceFiles], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
