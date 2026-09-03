#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { compileFromFile } from "json-schema-to-typescript";
import { compile } from "json-schema-to-typescript";
import { VENUE_TOOL_CONTRACT_VERSION, venueToolContracts } from "../src/contracts/venue-contracts.ts";

const root = path.resolve(new URL("../", import.meta.url).pathname);
const schemaDirectory = path.join(root, "public/schemas");
const outputDirectory = path.join(root, "packages/sdk/src/generated");
const sdkPackage = JSON.parse(await readFile(path.join(root, "packages/sdk/package.json"), "utf8"));
const schemas = [
  ["project-record", "VenueMindProjectRecord"],
  ["planner-snapshot", "VenueMindPlannerSnapshot"],
  ["validation-result", "VenueMindValidationResult"],
  ["activity-ledger", "VenueMindActivityLedger"],
  ["venue-error", "VenueMindError"],
  ["plan-export", "VenueMindPlanExport"],
  ["project-list-result", "VenueMindProjectListResult"],
  ["project-open-result", "VenueMindProjectOpenResult"],
  ["layout-inspection", "VenueMindLayoutInspection"],
  ["preview-revision-result", "VenueMindPreviewRevisionResult"],
  ["live-plan-deviation", "VenueMindLivePlanDeviation"],
  ["live-plan-deviation-register", "VenueMindLivePlanDeviationRegister"],
  ["live-plan-deviation-overlay", "VenueMindLivePlanDeviationOverlay"],
];

const venueMindResolver = {
  order: 1,
  canRead: /^https:\/\/venuemind\.dev\/schemas\//,
  async read(file) {
    const filename = new URL(file.url).pathname.split("/").at(-1);
    return readFile(path.join(schemaDirectory, filename), "utf8");
  },
};

await mkdir(outputDirectory, { recursive: true });
for (const [filename] of schemas) {
  const source = path.join(schemaDirectory, `${filename}.schema.json`);
  const output = await compileFromFile(source, {
    cwd: schemaDirectory,
    bannerComment: "/* Generated from VenueMind canonical JSON Schemas. Do not edit. */",
    style: { singleQuote: false, semi: true, tabWidth: 2 },
    $refOptions: { resolve: { venueMind: venueMindResolver } },
  });
  await writeFile(path.join(outputDirectory, `${filename}.ts`), output);
}

const toolInputMapSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "VenueMind Tool Input Map",
  type: "object",
  required: venueToolContracts.map(({ name }) => name),
  properties: Object.fromEntries(venueToolContracts.map(({ name, inputSchema }) => [name, inputSchema])),
  additionalProperties: false,
};
const toolInputMap = await compile(toolInputMapSchema, "VenueMindToolInputMap", {
  bannerComment: "/* Generated from VenueMind canonical tool contracts. Do not edit. */",
  style: { singleQuote: false, semi: true, tabWidth: 2 },
});
await writeFile(path.join(outputDirectory, "tool-inputs.ts"), toolInputMap);
const toolOutputMapSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "VenueMind Tool Output Map",
  type: "object",
  required: venueToolContracts.map(({ name }) => name),
  properties: Object.fromEntries(venueToolContracts.map(({ name, outputSchema }) => [name, outputSchema])),
  additionalProperties: false,
};
const toolOutputMap = await compile(toolOutputMapSchema, "VenueMindToolOutputMap", {
  bannerComment: "/* Generated from VenueMind canonical tool output contracts. Do not edit. */",
  style: { singleQuote: false, semi: true, tabWidth: 2 },
  $refOptions: { resolve: { venueMind: venueMindResolver } },
});
await writeFile(path.join(outputDirectory, "tool-outputs.ts"), toolOutputMap);
await writeFile(path.join(outputDirectory, "tool-metadata.ts"), [
  "/* Generated from VenueMind canonical tool contracts. Do not edit. */",
  `export const VENUE_TOOL_CONTRACT_VERSION = ${JSON.stringify(VENUE_TOOL_CONTRACT_VERSION)} as const;`,
  `export const VENUE_TOOL_NAMES = ${JSON.stringify(venueToolContracts.map(({ name }) => name), null, 2)} as const;`,
  "export type VenueToolName = typeof VENUE_TOOL_NAMES[number];",
  "",
].join("\n"));

const index = `${schemas.map(([filename, type]) => `export type { ${type} } from "./${filename}.js";`).join("\n")}
export type { VenueMindToolInputMap } from "./tool-inputs.js";
export type { VenueMindToolOutputMap } from "./tool-outputs.js";
export { VENUE_TOOL_CONTRACT_VERSION, VENUE_TOOL_NAMES } from "./tool-metadata.js";
export type { VenueToolName } from "./tool-metadata.js";
`;
await writeFile(path.join(outputDirectory, "index.ts"), index);

const apiReference = {
  schemaVersion: 1,
  package: sdkPackage.name,
  sdkVersion: sdkPackage.version,
  runtime: { module: "ESM", node: ">=22" },
  contractVersion: VENUE_TOOL_CONTRACT_VERSION,
  entryPoints: Object.keys(sdkPackage.exports),
  client: {
    transport: "VenueMindTransport.callTool(name, input, options)",
    methods: [
      { method: "projects.list", tool: "venue.list_projects" },
      { method: "projects.open", tool: "venue.open_project" },
      { method: "plans.inspect", tool: "venue.inspect_layout" },
      { method: "proposals.preview", tool: "venue.preview_revision" },
      { method: "validations.run", tool: "venue.validate_layout" },
      { method: "ledger.list", tool: "venue.get_change_log" },
      { method: "deviations.inspect", tool: "venue.inspect_live_plan_deviations" },
      { method: "deviations.record", tool: "venue.record_live_plan_deviation" },
      { method: "deviations.end", tool: "venue.end_live_plan_deviation" },
      { method: "deviations.createPostEventProposal", tool: "venue.create_post_event_deviation_proposal" },
      { method: "exports.plan", tool: "venue.export_plan" },
      { method: "exports.audit", tool: "venue.export_audit_package" },
      { method: "exports.deviations", tool: "venue.export_live_plan_deviations" },
    ],
    approval: "intentionally-absent",
  },
  adapter: {
    lifecycle: ["defineAdapter", "createVenueAdapter", "createAdapterRuntime"],
    helpers: ["collectAdapterPages", "adapterHttpError", "normalizeRetryAfter", "verifyWebhookHmac", "createSyncCursor", "verifySyncCursor", "sha256Checksum"],
  },
  testSurfaces: ["assertAdapterConformance", "createAdapterSandboxServer"],
};
await mkdir(path.join(root, "docs/reference"), { recursive: true });
await writeFile(path.join(root, "docs/reference/sdk-api.json"), `${JSON.stringify(apiReference, null, 2)}\n`);
await writeFile(path.join(root, "public/sdk-api.json"), `${JSON.stringify(apiReference, null, 2)}\n`);
