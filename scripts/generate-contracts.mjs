#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { venueCommandSchema, venueToolManifestSchema, venueTemplateCatalogSchema, spatialGeometrySchema, spatialEvidenceSchema, venueConstraintSchema, warningWaiverSchema, objectLockSchema, venueErrorSchema, validationResultSchema, commandReceiptSchema, activityLedgerSchema, proposalConflictResultSchema, proposalComparisonSchema, eventBriefSchema, planningEffectSchema, calendarWebhookEventSchema, commentAnchorSchema, commentSchema, scenarioDefinitionSchema, simulationResultSchema, aggregateOccupancySignalSchema, liveOccupancyProjectionSchema, liveOccupancyMonitorSchema, planExportSchema, projectListResultSchema, projectOpenResultSchema, layoutInspectionSchema, previewRevisionResultSchema, plannerSnapshotSchema, projectRecordSchema, venueProjectPackageSchema, venueToolContracts } from "../src/contracts/venue-contracts.js";
import { errorCatalog } from "../src/domain/errors.js";
import { sealActivityLedger } from "../src/domain/activity-ledger.js";
import { summitForwardPlan } from "../src/domain/summit-forward.js";
import { createVenuePlanner } from "../src/domain/venue-planner.js";
import { exportProjectPackage } from "../src/interchange/venue-package.js";
import { venueTemplateCatalog } from "../src/domain/venue-templates.js";
import { agentGrantSchema, authorizationPolicySchema, venueAuthorizationPolicy } from "../src/domain/authorization.js";

const schemas = [venueCommandSchema, venueToolManifestSchema, venueTemplateCatalogSchema, spatialGeometrySchema, spatialEvidenceSchema, venueConstraintSchema, warningWaiverSchema, objectLockSchema, venueErrorSchema, validationResultSchema, commandReceiptSchema, activityLedgerSchema, proposalConflictResultSchema, proposalComparisonSchema, eventBriefSchema, planningEffectSchema, calendarWebhookEventSchema, commentAnchorSchema, commentSchema, scenarioDefinitionSchema, simulationResultSchema, aggregateOccupancySignalSchema, liveOccupancyProjectionSchema, liveOccupancyMonitorSchema, planExportSchema, projectListResultSchema, projectOpenResultSchema, layoutInspectionSchema, previewRevisionResultSchema, plannerSnapshotSchema, projectRecordSchema, venueProjectPackageSchema, agentGrantSchema, authorizationPolicySchema];
const canonicalizeTimes = (value) => {
  if (Array.isArray(value)) return value.map(canonicalizeTimes);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /At$/.test(key) && !["startAt", "endAt"].includes(key) && typeof item === "string" ? "2026-08-27T00:00:00.000Z" : canonicalizeTimes(item)]));
};
await mkdir("public/schemas", { recursive: true });
await mkdir("public/examples", { recursive: true });
await mkdir("docs/reference", { recursive: true });
await Promise.all(schemas.map((schema) => {
  const filename = new URL(schema.$id).pathname.split("/").at(-1);
  return writeFile(`public/schemas/${filename}`, `${JSON.stringify(schema, null, 2)}\n`);
}));
await writeFile("docs/reference/webmcp-tools.json", `${JSON.stringify(venueToolContracts, null, 2)}\n`);
await writeFile("public/venue-tools.json", `${JSON.stringify(venueToolContracts, null, 2)}\n`);
await writeFile("public/examples/venue-tool-examples.json", `${JSON.stringify(Object.fromEntries(venueToolContracts.map((tool) => [tool.name, tool.exampleInput])), null, 2)}\n`);
await writeFile("public/tool-error-catalog.json", `${JSON.stringify(Object.fromEntries(venueToolContracts.map((tool) => [tool.name, tool.errors.map((code) => errorCatalog[code])])), null, 2)}\n`);
await writeFile("public/error-catalog.json", `${JSON.stringify(errorCatalog, null, 2)}\n`);
await writeFile("public/examples/venue-template-catalog.json", `${JSON.stringify(venueTemplateCatalog, null, 2)}\n`);
await writeFile("public/authorization-policy.json", `${JSON.stringify(venueAuthorizationPolicy, null, 2)}\n`);

const examplePlanner = createVenuePlanner(summitForwardPlan);
const exampleSnapshot = canonicalizeTimes(structuredClone(examplePlanner.getSnapshot()));
exampleSnapshot.ledger = sealActivityLedger(exampleSnapshot.ledger.map((entry) => ({ ...entry, occurredAt: "2026-08-27T00:00:00.000Z" })));
await writeFile("public/examples/planner-snapshot.json", `${JSON.stringify(exampleSnapshot, null, 2)}\n`);
const examplePackage = await exportProjectPackage({ id: "project-summit-forward", name: "SummitForward 2026", activePlanId: exampleSnapshot.plan.id, schemaVersion: 10, snapshot: exampleSnapshot, createdAt: "2026-08-27T00:00:00.000Z", updatedAt: "2026-08-27T00:00:00.000Z" }, { clock: () => "2026-08-27T00:00:00.000Z" });
await writeFile("public/examples/venuemind-project-package.json", examplePackage.content);
