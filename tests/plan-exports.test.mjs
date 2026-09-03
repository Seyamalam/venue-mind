import test from "node:test";
import assert from "node:assert/strict";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const planner = () => createVenuePlanner(summitForwardPlan);

test("layered SVG preserves stable object IDs, canonical layers, metadata, and dimensions", () => {
  const before = planner();
  const ledgerLength = before.getSnapshot().ledger.length;
  const output = before.execute({ type: "export_plan", format: "svg" });

  assert.equal(output.mimeType, "image/svg+xml");
  assert.equal(output.encoding, "utf8");
  assert.match(output.filename, /-v3-2\.svg$/);
  assert.match(output.content, /<g id="layer-architecture"/);
  assert.match(output.content, /<g id="layer-access"/);
  assert.match(output.content, /data-object-id="obj-stage-west"/);
  assert.match(output.content, /geom-[a-f0-9]{8}/);
  assert.match(output.content, />30 m<\/text>/);
  assert.equal((output.content.match(/id="layer-annotations"/g) ?? []).length, 1);
  assert.equal(before.getSnapshot().ledger.length, ledgerLength);
});

test("CSV object schedule is RFC4180, deterministic, and contains one row per stable object", () => {
  const before = planner();
  const first = before.execute({ type: "export_plan", format: "csv" });
  const second = before.execute({ type: "export_plan", format: "csv" });
  const rows = first.content.trim().split("\r\n");

  assert.equal(first.content, second.content);
  assert.equal(first.mimeType, "text/csv;charset=utf-8");
  assert.equal(rows[0], "object_id,label,kind,layer,footprint,center_x_m,center_y_m,rotation_deg,elevation_m,capacity,inventory_count,template_id,template_version,resource_id,resource_kind,resource_quantity,locked");
  assert.equal(rows.length, before.getSnapshot().plan.objects.length + 1);
  assert.match(first.content, /obj-seating-west,West seating,seating_section,furniture/);
});

test("CSV inventory schedule reconciles requested stock, availability, cost, weight, and power", () => {
  const output = planner().execute({ type: "export_plan", format: "csv-inventory" });
  const rows = output.content.trim().split("\r\n");

  assert.match(output.filename, /-inventory\.csv$/);
  assert.equal(rows[0], "template_id,template_version,item_name,category,requested,available,shortage,status,unit_cost,currency,cost_basis,estimated_cost,unit_weight_kg,total_weight_kg,watts_each,total_watts,connector,placed_object_ids,resource_bindings");
  assert.match(rows.find((row) => row.startsWith("inventory-template-banquet-chair,")), /inventory-template-banquet-chair,1\.0\.0,Banquet chair,seating,400,500,0,available,4,USD,day,1600,5,2000,0,0,none,obj-seating-east\|obj-seating-west/);
});

test("CSV exports retain approved Resource Bindings", () => {
  const plan = structuredClone(summitForwardPlan);
  plan.objects.find((object) => object.id === "obj-projector-center").resourceBinding = { schemaVersion: 1, resourceId: "resource-projector-backup", kind: "av", quantity: 1 };
  const bound = createVenuePlanner(plan);
  const objects = bound.execute({ type: "export_plan", format: "csv" }).content;
  const inventory = bound.execute({ type: "export_plan", format: "csv-inventory" }).content;
  assert.match(objects, /obj-projector-center,[^\r\n]*,resource-projector-backup,av,1,false/);
  assert.match(inventory, /inventory-template-laser-projector,[^\r\n]*resource-projector-backup:1/);
});

test("PDF export is a two-page printable vector document encoded for MCP transport", () => {
  const output = planner().execute({ type: "export_plan", format: "pdf" });
  const bytes = Buffer.from(output.content, "base64");
  const text = bytes.toString("ascii");

  assert.equal(output.mimeType, "application/pdf");
  assert.equal(output.encoding, "base64");
  assert.equal(bytes.subarray(0, 8).toString("ascii"), "%PDF-1.4");
  assert.match(text, /\/Count 2/);
  assert.match(text, /PLAN v3\.2/);
  assert.match(text, /VALIDATION/);
  assert.match(text, /startxref/);
});

test("portable audit package binds geometry, ledger, validation, comments, receipts, and replay", () => {
  const before = planner();
  before.execute({ type: "add_comment", anchor: { kind: "project", projectId: before.getSnapshot().plan.id }, body: "Include in decision record", decisionRelevant: true, actorId: "auditor", actor: "human", idempotencyKey: "audit-comment-1" });
  const output = before.execute({ type: "export_plan", format: "audit" });
  const audit = JSON.parse(output.content);

  assert.equal(output.encoding, "utf8");
  assert.match(output.filename, /\.audit\.json$/);
  assert.equal(audit.manifest.format, "venuemind-audit");
  assert.equal(audit.manifest.geometryFingerprint, audit.acceptedPlan.spatial.fingerprint);
  assert.match(audit.manifest.payloadFingerprint, /^audit-/);
  assert.equal(audit.comments[0].body, "Include in decision record");
  assert.equal(audit.commandReceipts.some((receipt) => receipt.result !== undefined), false);
  assert.equal(audit.replay.status, "pass");
});
