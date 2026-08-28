import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateSkills } from "./validate-skills.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = path.join(projectRoot, "skills");
const outputRoot = path.join(projectRoot, "dist/skills");
const publicRoot = path.join(projectRoot, "public");
const { manifest, evaluation, metrics } = await validateSkills();

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
for (const pkg of manifest.packages) {
  await cp(path.join(sourceRoot, pkg.path), path.join(outputRoot, pkg.path), { recursive: true });
}
await mkdir(path.join(outputRoot, "evals"), { recursive: true });
await writeFile(path.join(outputRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(outputRoot, "evals/cases.json"), `${JSON.stringify(evaluation, null, 2)}\n`);
await writeFile(path.join(outputRoot, "evaluation-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
await mkdir(publicRoot, { recursive: true });
await writeFile(path.join(publicRoot, "skills-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(path.join(publicRoot, "skill-evaluation-metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);

console.log(`Packaged ${manifest.packages.length} skills in ${path.relative(projectRoot, outputRoot)}`);
