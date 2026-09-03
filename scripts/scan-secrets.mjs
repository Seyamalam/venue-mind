#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const secretRules = Object.freeze([
  Object.freeze({ id: "private-key", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g }),
  Object.freeze({ id: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/g }),
  Object.freeze({ id: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g }),
  Object.freeze({ id: "openai-api-key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g }),
  Object.freeze({ id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g }),
]);

export function inspectSecrets(relativePath, source) {
  const findings = [];
  for (const { id, pattern } of secretRules) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const line = source.slice(0, match.index).split("\n").length;
      findings.push(Object.freeze({ file: relativePath, line, rule: id }));
    }
  }
  return findings;
}

export function candidatePaths(root = projectRoot) {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root })
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .sort();
}

async function main() {
  const findings = [];
  let scanned = 0;
  for (const relativePath of candidatePaths()) {
    const content = await readFile(path.join(projectRoot, relativePath));
    if (content.includes(0)) continue;
    scanned += 1;
    findings.push(...inspectSecrets(relativePath, content.toString("utf8")));
  }
  if (findings.length) {
    throw new Error(
      `Secret scan failed (values redacted):\n${findings.map(({ file, line, rule }) => `- ${file}:${line} [${rule}]`).join("\n")}`,
    );
  }
  console.log(`Scanned ${scanned} source files for private keys and provider credential signatures`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
