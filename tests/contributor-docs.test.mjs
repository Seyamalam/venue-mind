import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(new URL("../", import.meta.url).pathname);
const read = (relative) => readFile(path.join(root, relative), "utf8");
const requiredGuides = [
  "CONTRIBUTING.md",
  "SECURITY.md",
  "docs/architecture.md",
  "docs/threat-model.md",
  "docs/persistence-and-recovery.md",
  "docs/database-operations.md",
  "docs/registration-and-ticketing.md",
  "docs/operational-resources.md",
  "docs/schema-migrations.md",
  "docs/development.md",
  "docs/testing.md",
  "docs/release-checklist.md",
  "docs/runbooks/failure-recovery.md",
];

test("contributor entry point routes every change and recovery path without oral guidance", async () => {
  const contributing = await read("CONTRIBUTING.md");
  for (const guide of requiredGuides) await access(path.join(root, guide));
  for (const link of ["docs/architecture.md", "docs/database-operations.md", "docs/schema-migrations.md", "docs/testing.md", "docs/release-checklist.md", "docs/runbooks/failure-recovery.md"]) assert.match(contributing, new RegExp(link.replaceAll("/", "\\/")));
  for (const command of ["npm ci", "npm run generate:docs", "npm test", "npm run build", "npm run check:generated"]) assert.match(contributing, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("architecture guide identifies every runtime boundary and complete extension paths", async () => {
  const architecture = await read("docs/architecture.md");
  for (const source of ["src/contracts/venue-contracts.ts", "src/domain/venue-planner.ts", "src/domain/constraint-engine.ts", "src/domain/authorization.ts", "src/domain/activity-ledger.ts", "src/tools/venue-tool-service.ts", "src/webmcp/", "packages/mcp-server/src/", "src/persistence/project-store.ts", "worker/index.ts", "src/docs/"]) assert.match(architecture, new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), source);
  assert.ok((architecture.match(/```mermaid/g) ?? []).length >= 2);
  assert.match(architecture, /sequenceDiagram/);
  const commandSection = architecture.split("## Add a command")[1].split("## Add a Constraint")[0];
  for (const requirement of ["venueCommandSchema", "VenuePlanner.execute", "COMMAND_PERMISSION", "venueToolContracts", "commandForVenueTool", "Activity Ledger", "generate:contracts", "check:generated"]) assert.match(commandSection, new RegExp(requirement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const constraintSection = architecture.split("## Add a Constraint")[1];
  for (const requirement of ["evaluator.enum", "constraint-engine.ts", "stable object", "CONSTRAINT_REFERENCE", "not-applicable", "fingerprint"]) assert.match(constraintSection, new RegExp(requirement.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
});

test("persistence, migration, testing, release, and recovery guides carry executable completion criteria", async () => {
  const persistence = await read("docs/persistence-and-recovery.md");
  const migrations = await read("docs/schema-migrations.md");
  const databaseOperations = await read("docs/database-operations.md");
  const testing = await read("docs/testing.md");
  const release = await read("docs/release-checklist.md");
  const recovery = await read("docs/runbooks/failure-recovery.md");
  assert.match(persistence, /```mermaid/);
  assert.match(persistence, /REMOTE/);
  assert.match(persistence, /LOCAL/);
  assert.match(migrations, /accepts Project schema 10 only/i);
  assert.match(migrations, /without adding fields, rewriting geometry/i);
  for (const evidence of ["dry run", "checksum", "Project safety export", "staged restore", "Point-in-Time Recovery", "ledger fingerprints"]) assert.match(databaseOperations, new RegExp(evidence, "i"));
  for (const layer of ["Planner and domain", "WebMCP", "MCP server", "Persistence and worker", "Docs and examples", "Whole product"]) assert.match(testing, new RegExp(layer));
  for (const command of ["npm run generate:contracts", "npm run generate:migrations", "npm run generate:docs", "npm run check:generated", "npm test", "npm run build"]) assert.match(release, new RegExp(command.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  for (const failure of ["Project API unavailable", "Ledger or replay failure", "database migration failure", "Database restore", "MCP client failure", "Generated documentation drift"]) assert.match(recovery, new RegExp(failure));
});

test("required architecture decisions use the complete ADR structure", async () => {
  const adrs = [
    "docs/adr/0003-canonical-spatial-frame.md",
    "docs/adr/0017-human-roles-and-agent-grants.md",
    "docs/adr/0018-shared-runtime-contracts.md",
    "docs/adr/0019-versioned-constraint-registry.md",
    "docs/adr/0020-hash-chained-ledger-and-replay.md",
    "docs/adr/0021-server-owned-tenancy.md",
  ];
  for (const adr of adrs) {
    const content = await read(adr);
    for (const heading of ["## Status", "## Context", "## Decision", "## Consequences"]) assert.match(content, new RegExp(`^${heading}$`, "m"), `${adr} ${heading}`);
    assert.match(content, /Accepted/);
  }
});

test("published contributor guide manifest matches every source and public artifact", async () => {
  const manifest = JSON.parse(await read("public/guides/manifest.json"));
  assert.equal(manifest.schemaVersion, 1);
  for (const guide of requiredGuides) assert.ok(manifest.guides.some((item) => item.sourcePath === guide), guide);
  for (const item of manifest.guides) {
    const source = await read(item.sourcePath);
    const published = await read(`public${item.publicPath}`);
    assert.equal(published, source, item.sourcePath);
  }
});

test("registration guide preserves the aggregate-only privacy and reconciliation boundary", async () => {
  const guide = await read("docs/registration-and-ticketing.md");
  for (const evidence of ["before adapter invocation IDs", "Aggregate Accessibility Requirements", "Check-in Aggregates", "Ticket Occupancy Reconciliation", "cannot mutate the Event Brief", "400-ticket class total"]) assert.match(guide, new RegExp(evidence, "i"));
});

test("security reporting policy defines a private, bounded disclosure path", async () => {
  const security = await read("SECURITY.md");
  assert.match(security, /Report privately/);
  assert.match(security, /Security → Report a vulnerability/);
  assert.match(security, /Do not put exploit details.*public issue/i);
  assert.match(security, /Cross-organization/);
  assert.match(security, /Approval bypass/);
  assert.match(security, /coordinated/i);
});

test("threat model maps every high-risk boundary to an implemented control, test, and owner", async () => {
  const threatModel = await read("docs/threat-model.md");
  for (const section of ["Assets", "Actors", "Trust boundaries and entry points", "High-risk abuse cases and controls", "Verification ownership", "Residual risk and response"]) assert.match(threatModel, new RegExp(`## ${section}`));
  for (const threat of ["Prompt injection", "Malicious geometry", "Oversized tool", "cross a tenant boundary", "share token", "forges, removes, or reorders ledger", "Replayed or concurrent mutations", "confused deputy", "export, error, log, metric", "forges or replays webhook", "Cross-origin", "changed migration"]) assert.match(threatModel, new RegExp(threat, "i"));
  const rows = threatModel.match(/^\| TM-\d{2} \|.*$/gm) ?? [];
  assert.equal(rows.length, 12);
  for (const row of rows) {
    assert.match(row, /`tests\/.+\.test\.mjs`/);
    assert.doesNotMatch(row, /\|\s*(TBD|unassigned)\s*\|$/i);
  }
  const evidencePaths = [...threatModel.matchAll(/`(tests\/[a-z0-9-]+\.test\.mjs)`/g)].map((match) => match[1]);
  for (const evidencePath of new Set(evidencePaths)) await access(path.join(root, evidencePath));
});
