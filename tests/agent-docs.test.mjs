import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { previewProjectImport } from "../src/interchange/venue-package.js";
import { venueToolContracts } from "../src/contracts/venue-contracts.js";
import { buildAgentDocuments } from "../src/docs/agent-documents.js";
import { docsPages } from "../src/docs/content.js";

const publicFile = (name) => new URL(`../public/${name}`, import.meta.url);

test("llms.txt advertises the supervised golden loop and every agent tool", async () => {
  const content = await readFile(publicFile("llms.txt"), "utf8");
  assert.match(content, /human approves/i);
  assert.match(content, /venue\.inspect_layout/);
  assert.match(content, /venue\.get_project_brief/);
  assert.match(content, /venue\.preview_revision/);
  assert.match(content, /venue\.validate_layout/);
  assert.doesNotMatch(content, /venue\.approve/);
});

test("agent discovery files stay bounded, complete, and production-linkable", async () => {
  const skillsManifest = JSON.parse(await readFile(new URL("../skills/manifest.json", import.meta.url), "utf8"));
  const compact = await readFile(publicFile("llms.txt"), "utf8");
  const full = await readFile(publicFile("llms-full.txt"), "utf8");
  assert.ok(Buffer.byteLength(compact) <= 16 * 1024, "llms.txt must remain concise");
  assert.ok(Buffer.byteLength(full) <= 512 * 1024, "llms-full.txt exceeded the published ceiling");
  assert.ok(Buffer.byteLength(full) > Buffer.byteLength(compact) * 10, "llms-full.txt should remain the complete reference");

  const toolSection = compact.split("## Tools\n\n")[1].split("\n\n## Agent skills")[0];
  for (const tool of venueToolContracts) {
    assert.equal(toolSection.split(tool.name).length - 1, 1, `${tool.name} must appear exactly once in the tool index`);
  }
  for (const skill of skillsManifest.packages) assert.match(compact, new RegExp(`- ${skill.name} ${skill.version}`));
  for (const page of docsPages.filter((candidate) => candidate.public !== false && !candidate.deprecated)) {
    assert.match(full, new RegExp(`^# ${page.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), page.slug);
  }

  const production = buildAgentDocuments({ origin: "https://venue.example/deploy-path", skillPackages: skillsManifest.packages });
  assert.equal(production.origin, "https://venue.example");
  assert.doesNotMatch(production.compact, /\]\(\//);
  assert.doesNotMatch(production.full, /\]\(\//);
  assert.match(production.compact, /https:\/\/venue\.example\/schemas\/venue-command\.schema\.json/);
  assert.match(production.full, /https:\/\/venue\.example\/docs\/reference-tools/);
  assert.throws(() => buildAgentDocuments({ origin: "file:///private/path" }), /HTTP\(S\) origin/);
});

test("llms-full.txt contains the documentation reference", async () => {
  const content = await readFile(publicFile("llms-full.txt"), "utf8");
  assert.match(content, /# VenueMind complete agent reference/);
  assert.match(content, /# WebMCP tools/);
  assert.match(content, /# Safety and supervision/);
  assert.match(content, /\| Project record \| 10 \|/);
  assert.match(content, /\| Simulation engine \| 1\.2\.1 \|/);
  assert.match(content, /Ingress and egress/);
  assert.match(content, /Queue simulation/);
  for (const skill of ["venuemind-plan", "venuemind-audit", "venuemind-access-review", "venuemind-crowd-flow", "venuemind-production-plan", "venuemind-event-day"]) {
    assert.match(content, new RegExp(skill));
  }
});

test("agent skill package metadata and evaluation metrics are published", async () => {
  const manifest = JSON.parse(await readFile(publicFile("skills-manifest.json"), "utf8"));
  const metrics = JSON.parse(await readFile(publicFile("skill-evaluation-metrics.json"), "utf8"));
  assert.equal(manifest.packages.length, 6);
  assert.equal(manifest.toolContractVersion, "1.2.0");
  assert.equal(metrics.cases, 12);
  assert.equal(metrics.toolSelectionAccuracy, 1);
  assert.equal(metrics.unnecessaryCallRate, 0);
});

test("generated agent contracts include spatial and validation schemas", async () => {
  const spatial = JSON.parse(await readFile(publicFile("schemas/spatial-geometry.schema.json"), "utf8"));
  const evidence = JSON.parse(await readFile(publicFile("schemas/spatial-evidence.schema.json"), "utf8"));
  const constraint = JSON.parse(await readFile(publicFile("schemas/venue-constraint.schema.json"), "utf8"));
  const waiver = JSON.parse(await readFile(publicFile("schemas/warning-waiver.schema.json"), "utf8"));
  const objectLock = JSON.parse(await readFile(publicFile("schemas/object-lock.schema.json"), "utf8"));
  const venueError = JSON.parse(await readFile(publicFile("schemas/venue-error.schema.json"), "utf8"));
  const errorCatalog = JSON.parse(await readFile(publicFile("error-catalog.json"), "utf8"));
  const validation = JSON.parse(await readFile(publicFile("schemas/validation-result.schema.json"), "utf8"));
  const templates = JSON.parse(await readFile(publicFile("schemas/venue-template-catalog.schema.json"), "utf8"));
  const receipt = JSON.parse(await readFile(publicFile("schemas/command-receipt.schema.json"), "utf8"));
  const ledger = JSON.parse(await readFile(publicFile("schemas/activity-ledger.schema.json"), "utf8"));
  const conflicts = JSON.parse(await readFile(publicFile("schemas/proposal-conflicts.schema.json"), "utf8"));
  const comparison = JSON.parse(await readFile(publicFile("schemas/proposal-comparison.schema.json"), "utf8"));
  const brief = JSON.parse(await readFile(publicFile("schemas/event-brief.schema.json"), "utf8"));
  const planningEffect = JSON.parse(await readFile(publicFile("schemas/planning-effect.schema.json"), "utf8"));
  const calendarWebhook = JSON.parse(await readFile(publicFile("schemas/calendar-webhook-event.schema.json"), "utf8"));
  const commentAnchor = JSON.parse(await readFile(publicFile("schemas/comment-anchor.schema.json"), "utf8"));
  const comment = JSON.parse(await readFile(publicFile("schemas/comment.schema.json"), "utf8"));
  const scenario = JSON.parse(await readFile(publicFile("schemas/scenario-definition.schema.json"), "utf8"));
  const simulation = JSON.parse(await readFile(publicFile("schemas/simulation-result.schema.json"), "utf8"));
  const snapshot = JSON.parse(await readFile(publicFile("schemas/planner-snapshot.schema.json"), "utf8"));
  const project = JSON.parse(await readFile(publicFile("schemas/project-record.schema.json"), "utf8"));
  const interchange = JSON.parse(await readFile(publicFile("schemas/venue-project-package.schema.json"), "utf8"));
  const agentGrant = JSON.parse(await readFile(publicFile("schemas/agent-grant.schema.json"), "utf8"));
  const authorizationPolicy = JSON.parse(await readFile(publicFile("schemas/authorization-policy.schema.json"), "utf8"));
  const publishedAuthorization = JSON.parse(await readFile(publicFile("authorization-policy.json"), "utf8"));

  assert.equal(spatial.properties.unit.const, "m");
  assert.equal(evidence.required.includes("sightlines"), true);
  assert.equal(constraint.properties.severity.enum.includes("warning"), true);
  assert.equal(constraint.required.includes("waivable"), true);
  assert.equal(waiver.properties.reasonCode.enum.includes("operational-acceptance"), true);
  assert.deepEqual(objectLock.properties.type.enum, ["position", "rotation", "dimension", "deletion", "role"]);
  assert.equal(objectLock.properties.source.enum.includes("project"), true);
  assert.equal(venueError.properties.code.enum.includes("PLAN_VERSION_CONFLICT"), true);
  assert.match(errorCatalog.PLAN_VERSION_CONFLICT.remediation, /inspect/i);
  assert.equal(constraint.properties.evaluator.enum.includes("sightline_raycast"), true);
  assert.equal(constraint.properties.evaluator.enum.includes("accessible_seating_sightlines"), true);
  assert.equal(constraint.properties.evaluator.enum.includes("door_clearance"), true);
  assert.equal(constraint.properties.evaluator.enum.includes("temporary_ramp"), true);
  assert.equal(evidence.properties.accessibility.required.includes("doorClearanceZones"), true);
  assert.equal(evidence.properties.accessibility.required.includes("accessibleSeatSightlineSections"), true);
  assert.equal(evidence.properties.capacity.required.includes("zoneCapacities"), true);
  assert.equal(evidence.properties.capacity.required.includes("changeDeltas"), true);
  assert.equal(evidence.properties.capacity.required.includes("explanations"), true);
  assert.equal(evidence.properties.circulation.required.includes("exitApproachZones"), true);
  assert.equal(evidence.properties.circulation.required.includes("criticalRouteEdges"), true);
  assert.equal(evidence.properties.circulation.required.includes("bottleneckLoads"), true);
  assert.equal(evidence.properties.circulation.required.includes("changeDeltas"), true);
  assert.equal(validation.properties.checks.items.properties.status.enum.includes("not-applicable"), true);
  assert.equal(validation.required.includes("inventoryAvailability"), true);
  assert.equal(templates.properties.inventoryTemplates.items.properties.category.enum.includes("queue"), true);
  assert.equal(validation.required.includes("candidateGeometryFingerprint"), true);
  assert.equal(validation.required.includes("unwaivedWarnings"), true);
  assert.equal(validation.required.includes("evidenceFamilyFingerprints"), true);
  assert.equal(validation.required.includes("planningEvidenceInvalidations"), true);
  assert.deepEqual(planningEffect.oneOf.map((variant) => variant.properties.operation.const), ["set_attendance_target", "set_event_schedule"]);
  assert.equal(planningEffect.oneOf.every((variant) => variant.additionalProperties === false), true);
  assert.deepEqual(planningEffect.oneOf[0].properties.evidenceFamilies.prefixItems.map((item) => item.const), ["capacity", "flow"]);
  assert.deepEqual(calendarWebhook.properties.type.enum, ["event.created", "event.updated", "event.cancelled", "event.deleted"]);
  assert.equal(calendarWebhook.additionalProperties, false);
  assert.equal(snapshot.properties.proposal.properties.changes.items.properties.planningEffects.items.$ref, planningEffect.$id);
  assert.equal(brief.required.includes("schedule"), false);
  assert.match(brief.properties.schedule.anyOf[1].properties.startAt.pattern, /T/);
  assert.equal(validation.properties.checks.items.required.includes("waiver"), true);
  assert.match(receipt.properties.inputFingerprint.pattern, /command/);
  assert.equal(ledger.items.properties.schemaVersion.const, 1);
  assert.equal(conflicts.properties.conflicts.items.properties.type.enum.includes("same-object-edit"), true);
  assert.equal(conflicts.properties.conflicts.items.properties.type.enum.includes("geometry-overlap"), true);
  assert.equal(conflicts.properties.conflicts.items.required.includes("blocking"), true);
  assert.equal(comparison.properties.constraintDeltas.items.properties.outcome.enum.includes("regressed"), true);
  assert.equal(brief.properties.requirements.items.properties.priority.enum.includes("critical"), true);
  assert.equal(commentAnchor.oneOf.length, 6);
  assert.deepEqual(comment.properties.status.enum, ["open", "resolved"]);
  assert.equal(comment.required.includes("editHistory"), true);
  assert.equal(snapshot.properties.plan.properties.objects.items.properties.kind.enum.includes("restricted_zone"), true);
  assert.equal(snapshot.properties.plan.properties.objects.items.properties.kind.enum.includes("temporary_ramp"), true);
  for (const kind of ["barrier", "signage", "queue", "utility_point", "rigging_point"]) {
    assert.equal(snapshot.properties.plan.properties.objects.items.properties.kind.enum.includes(kind), true);
  }
  for (const kind of ["entrance", "checkpoint", "stairs", "elevator"]) assert.equal(snapshot.properties.plan.properties.objects.items.properties.kind.enum.includes(kind), true);
  assert.deepEqual(snapshot.properties.plan.properties.occupancy.required, ["venueMaximum", "staff", "performers", "vendors", "sections", "zones"]);
  assert.equal(snapshot.required.includes("projectLocks"), true);
  assert.equal(snapshot.properties.comments.items.$ref.endsWith("comment.schema.json"), true);
  assert.deepEqual(snapshot.properties.plan.properties.objects.items.properties.door.required, ["clearWidthM", "swing", "accessible"]);
  assert.deepEqual(snapshot.properties.plan.properties.objects.items.properties.ramp.required, ["riseM", "runM", "clearWidthM", "landingLengthM", "edgeProtectionHeightM", "handrails"]);
  assert.equal(snapshot.properties.plan.properties.objects.items.properties.placement.properties.collisionMode.const, "solid");
  assert.deepEqual(snapshot.properties.plan.properties.objects.items.properties.circulation.properties.role.enum, ["queue", "checkpoint"]);
  assert.deepEqual(scenario.properties.model.enum, ["operations", "ingress-egress", "queue"]);
  assert.equal(scenario.properties.ingressEgress.properties.curves.properties.arrival.items.required.includes("cumulativeShare"), true);
  assert.equal(simulation.required.includes("scenarioFingerprint"), true);
  assert.deepEqual(simulation.properties.densityFrames.items.properties.cells.items.properties.level.enum, ["low", "medium", "high", "critical"]);
  assert.equal(scenario.properties.queue.properties.category.enum.includes("transport"), true);
  assert.equal(project.properties.schemaVersion.const, 10);
  assert.equal(interchange.properties.format.const, "venuemind-project");
  assert.equal(interchange.properties.manifest.properties.payloadBytes.maximum, 2000000);
  assert.equal(agentGrant.properties.scopes.items.enum.includes("venue:propose"), true);
  assert.equal(authorizationPolicy.properties.humanRoles.items.enum.includes("approver"), true);
  assert.equal(publishedAuthorization.rolePermissions.approver.includes("approval.approve"), true);
  assert.equal(Object.values(publishedAuthorization.agentScopePermissions).flat().includes("approval.approve"), false);
});

test("published Interchange Package example passes the production Import Preview", async () => {
  const content = await readFile(publicFile("examples/venuemind-project-package.json"), "utf8");
  const preview = await previewProjectImport(content, { clock: () => "2026-08-27T01:00:00.000Z" });
  assert.equal(preview.status, "ready");
  assert.equal(preview.integrity.checksum, "pass");
  assert.equal(preview.integrity.replay, "pass");
});

test("every shared tool is generated into the public manifest, examples, errors, schemas, and agent docs", async () => {
  const manifest = JSON.parse(await readFile(publicFile("venue-tools.json"), "utf8"));
  const examples = JSON.parse(await readFile(publicFile("examples/venue-tool-examples.json"), "utf8"));
  const errors = JSON.parse(await readFile(publicFile("tool-error-catalog.json"), "utf8"));
  const schema = JSON.parse(await readFile(publicFile("schemas/venue-tool-manifest.schema.json"), "utf8"));
  const llms = await readFile(publicFile("llms.txt"), "utf8");
  const expectedNames = venueToolContracts.map((tool) => tool.name).sort();

  assert.equal(manifest.length, 39);
  assert.deepEqual(manifest.map((tool) => tool.name).sort(), expectedNames);
  assert.deepEqual(Object.keys(examples).sort(), expectedNames);
  assert.deepEqual(Object.keys(errors).sort(), expectedNames);
  assert.equal(schema.items.required.includes("exampleInput"), true);
  assert.equal(schema.items.required.includes("errors"), true);
  for (const tool of venueToolContracts) {
    assert.equal(typeof examples[tool.name], "object");
    assert.equal(errors[tool.name].every((entry) => entry?.code && entry?.remediation), true);
    assert.match(llms, new RegExp(tool.name.replace(".", "\\.")));
  }
  assert.equal(expectedNames.some((name) => /approve|delete_project/.test(name)), false);
});
