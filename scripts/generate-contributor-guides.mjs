import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const output = new URL("public/guides/", root);
const guideSources = [
  ["CONTRIBUTING.md", "contributing.md", "Contributor entry point"],
  ["SECURITY.md", "security.md", "Security reporting policy"],
  ["docs/architecture.md", "architecture.md", "Architecture and extension paths"],
  ["docs/authentication-and-tenancy.md", "authentication-and-tenancy.md", "Authentication and tenancy"],
  ["docs/persistence-and-recovery.md", "persistence-and-recovery.md", "Persistence and recovery"],
  ["docs/optimistic-concurrency.md", "optimistic-concurrency.md", "Optimistic concurrency"],
  ["docs/realtime-collaboration.md", "realtime-collaboration.md", "Real-time collaboration"],
  ["docs/sharing-and-notifications.md", "sharing-and-notifications.md", "Sharing and notifications"],
  ["docs/registration-and-ticketing.md", "registration-and-ticketing.md", "Registration and ticketing"],
  ["docs/operational-resources.md", "operational-resources.md", "Operational resource adapters"],
  ["docs/database-operations.md", "database-operations.md", "Database operations"],
  ["docs/schema-migrations.md", "schema-migrations.md", "Schema migrations"],
  ["docs/development.md", "development.md", "Local development"],
  ["docs/testing.md", "testing.md", "Testing by layer"],
  ["docs/release-checklist.md", "release-checklist.md", "Release checklist"],
  ["docs/runbooks/failure-recovery.md", "runbooks/failure-recovery.md", "Failure recovery runbook"],
];
const adrNames = (await readdir(new URL("docs/adr/", root))).filter((name) => name.endsWith(".md")).sort();
for (const name of adrNames) guideSources.push([`docs/adr/${name}`, `adr/${name}`, `Architecture decision ${name.slice(0, 4)}`]);

await Promise.all(guideSources.map(async ([sourcePath, publicPath]) => {
  const target = new URL(publicPath, output);
  await mkdir(new URL("./", target), { recursive: true });
  await writeFile(target, await readFile(new URL(sourcePath, root)));
}));

const manifest = {
  schemaVersion: 1,
  generatedFrom: ["CONTRIBUTING.md", "docs/"],
  guides: guideSources.map(([sourcePath, publicPath, title]) => ({ sourcePath, publicPath: `/guides/${publicPath}`, title })),
};
await mkdir(output, { recursive: true });
await writeFile(new URL("manifest.json", output), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Published ${guideSources.length} contributor guides and ADRs`);
