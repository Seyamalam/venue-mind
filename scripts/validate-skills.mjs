import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { VENUE_TOOL_CONTRACT_VERSION, venueToolContracts } from "../src/contracts/venue-contracts.ts";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = path.join(projectRoot, "skills");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(target) : [target];
  }));
  return nested.flat();
};

const scalar = (source, key, indent = "") => {
  const match = source.match(new RegExp(`^${indent}${key}:\\s*["']?([^\\n"']+)["']?\\s*$`, "m"));
  return match?.[1]?.trim();
};

const frontmatter = (source) => {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) throw new Error("SKILL.md must start with YAML frontmatter");
  return match[1];
};

const toolNamesIn = (source) => [...source.matchAll(/`(venue\.[a-z0-9_]+)`/g)].map((match) => match[1]);

export async function validateSkills() {
  const manifest = await readJson(path.join(skillsRoot, "manifest.json"));
  const evaluation = await readJson(path.join(skillsRoot, "evals/cases.json"));
  const publishedTools = new Set(venueToolContracts.map((tool) => tool.name));
  const packageNames = new Set(manifest.packages.map((item) => item.name));
  const failures = [];
  const skillTools = new Map();

  const check = (condition, message) => {
    if (!condition) failures.push(message);
  };

  check(manifest.schemaVersion === 1, "skills/manifest.json schemaVersion must be 1");
  check(manifest.toolContractVersion === VENUE_TOOL_CONTRACT_VERSION, `Skill tool contract ${manifest.toolContractVersion} does not match ${VENUE_TOOL_CONTRACT_VERSION}`);
  check(new Set(manifest.packages.map((item) => item.name)).size === manifest.packages.length, "Skill package names must be unique");

  for (const pkg of manifest.packages) {
    const packageRoot = path.join(skillsRoot, pkg.path);
    const entrypoint = path.join(packageRoot, pkg.entrypoint);
    const agentConfigPath = path.join(packageRoot, "agents/openai.yaml");
    let skillSource = "";
    let agentSource = "";
    try {
      skillSource = await readFile(entrypoint, "utf8");
      agentSource = await readFile(agentConfigPath, "utf8");
    } catch (error) {
      failures.push(`${pkg.name}: ${error.message}`);
      continue;
    }

    const yaml = frontmatter(skillSource);
    const skillName = scalar(yaml, "name");
    const description = scalar(yaml, "description");
    const version = scalar(yaml, "version", "  ");
    const contractVersion = scalar(yaml, "tool-contract-version", "  ");
    const shortDescription = scalar(agentSource, "short_description", "  ");
    const defaultPrompt = scalar(agentSource, "default_prompt", "  ");

    check(skillName === pkg.name, `${pkg.name}: frontmatter name must match package name`);
    check(pkg.path === pkg.name, `${pkg.name}: package path must match package name`);
    check(/^\d+\.\d+\.\d+$/.test(pkg.version), `${pkg.name}: package version must use semver`);
    check(version === pkg.version, `${pkg.name}: frontmatter version must match manifest`);
    check(contractVersion === manifest.toolContractVersion, `${pkg.name}: tool contract version must match manifest`);
    check(Boolean(description) && description.length <= 1024, `${pkg.name}: description must be present and no longer than 1024 characters`);
    check(Boolean(shortDescription) && shortDescription.length >= 25 && shortDescription.length <= 64, `${pkg.name}: short_description must be 25-64 characters`);
    check(defaultPrompt?.includes(`$${pkg.name}`), `${pkg.name}: default_prompt must mention $${pkg.name}`);

    const packageFiles = await collectFiles(packageRoot);
    const markdownFiles = packageFiles.filter((file) => file.endsWith(".md"));
    const markdownSources = await Promise.all(markdownFiles.map((file) => readFile(file, "utf8")));
    const combinedMarkdown = markdownSources.join("\n");
    const referencedTools = new Set(toolNamesIn(combinedMarkdown));
    skillTools.set(pkg.name, referencedTools);
    for (const tool of referencedTools) check(publishedTools.has(tool), `${pkg.name}: references unpublished tool ${tool}`);

    for (let index = 0; index < markdownFiles.length; index += 1) {
      const source = markdownSources[index];
      for (const match of source.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
        const href = match[1].split("#")[0];
        if (!href || href.startsWith("/") || /^[a-z]+:/i.test(href)) continue;
        const target = path.resolve(path.dirname(markdownFiles[index]), href);
        try {
          check((await stat(target)).isFile(), `${pkg.name}: reference is not a file: ${href}`);
        } catch {
          failures.push(`${pkg.name}: broken reference ${href}`);
        }
      }
    }
  }

  const coveredSkills = new Set(evaluation.cases.map((item) => item.skill));
  for (const name of packageNames) check(coveredSkills.has(name), `${name}: no evaluation cases`);
  for (const item of evaluation.cases) check(packageNames.has(item.skill), `${item.id}: unknown skill ${item.skill}`);

  const adversarialTags = new Set(evaluation.cases.flatMap((item) => item.tags ?? []));
  for (const tag of ["premature-approval", "ignored-locks", "stale-versions", "missing-evidence"]) {
    check(adversarialTags.has(tag), `Evaluation suite is missing adversarial fixture: ${tag}`);
  }

  let requiredToolTotal = 0;
  let requiredToolHits = 0;
  const allowedBySkill = new Map();
  for (const item of evaluation.cases) {
    const allowed = allowedBySkill.get(item.skill) ?? new Set();
    for (const tool of item.allowedTools) allowed.add(tool);
    allowedBySkill.set(item.skill, allowed);
    check(item.requiredEvidence.length > 0, `${item.id}: requiredEvidence must not be empty`);
    check(item.invariants.includes("stopsBeforeApproval"), `${item.id}: must stop before human approval`);
    check(item.invariants.includes("preservesAcceptedPlan"), `${item.id}: must preserve the accepted Plan`);
    for (const tool of [...item.requiredTools, ...item.allowedTools]) check(publishedTools.has(tool), `${item.id}: unknown published tool ${tool}`);
    for (const tool of item.forbiddenTools) check(!publishedTools.has(tool), `${item.id}: forbidden authority tool is published: ${tool}`);
    for (const tool of item.requiredTools) {
      requiredToolTotal += 1;
      if (skillTools.get(item.skill)?.has(tool)) requiredToolHits += 1;
      else failures.push(`${item.id}: required tool ${tool} is not taught by ${item.skill}`);
    }
  }

  const unnecessary = [];
  let referencedToolTotal = 0;
  for (const [skill, tools] of skillTools) {
    const allowed = allowedBySkill.get(skill) ?? new Set();
    for (const tool of tools) {
      referencedToolTotal += 1;
      if (!allowed.has(tool)) unnecessary.push(`${skill}:${tool}`);
    }
  }
  const metrics = {
    cases: evaluation.cases.length,
    packages: manifest.packages.length,
    requiredToolSelections: requiredToolTotal,
    toolSelectionAccuracy: requiredToolTotal === 0 ? 0 : requiredToolHits / requiredToolTotal,
    referencedTools: referencedToolTotal,
    unnecessaryCalls: unnecessary.length,
    unnecessaryCallRate: referencedToolTotal === 0 ? 0 : unnecessary.length / referencedToolTotal,
  };
  check(metrics.toolSelectionAccuracy >= evaluation.thresholds.toolSelectionAccuracy, `Tool-selection accuracy ${metrics.toolSelectionAccuracy} is below ${evaluation.thresholds.toolSelectionAccuracy}`);
  check(metrics.unnecessaryCallRate <= evaluation.thresholds.maximumUnnecessaryCallRate, `Unnecessary-call rate ${metrics.unnecessaryCallRate} exceeds ${evaluation.thresholds.maximumUnnecessaryCallRate}: ${unnecessary.join(", ")}`);

  if (failures.length) throw new Error(`Skill validation failed:\n- ${failures.join("\n- ")}`);
  return { manifest, evaluation, metrics };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { metrics } = await validateSkills();
  console.log(JSON.stringify(metrics, null, 2));
}
