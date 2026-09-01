import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildAgentDocuments } from "../src/docs/agent-documents.ts";
import { defaultPublicOrigin } from "../src/docs/public-origin.ts";

const outputDirectory = new URL("../public/", import.meta.url);
const skillsManifest = JSON.parse(await readFile(new URL("../skills/manifest.json", import.meta.url), "utf8"));
const documents = buildAgentDocuments({
  origin: process.env.VENUEMIND_PUBLIC_ORIGIN?.trim() || defaultPublicOrigin,
  skillPackages: skillsManifest.packages,
});

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(new URL("llms.txt", outputDirectory), documents.compact),
  writeFile(new URL("llms-full.txt", outputDirectory), documents.full),
]);

console.log(`Generated llms.txt and llms-full.txt${documents.origin ? ` for ${documents.origin}` : ""}`);
