import assert from "node:assert/strict";
import test from "node:test";
import { permissionForTool } from "../src/domain/authorization.ts";
import { VENUE_TOOL_CONTRACT_VERSION, venueToolContracts } from "../src/contracts/venue-contracts.ts";

test("shared Incident tools expose report, inspection, and export without human response authority", () => {
  const byName = new Map(venueToolContracts.map((contract) => [contract.name, contract]));
  assert.equal(VENUE_TOOL_CONTRACT_VERSION, "1.5.0");
  assert.equal(venueToolContracts.length, 51);
  assert.equal(byName.get("venue.inspect_incidents")?.authorization.requiredScope, "venue:read");
  assert.equal(byName.get("venue.report_incident")?.authorization.requiredScope, "venue:operate");
  assert.equal(byName.get("venue.export_incident_record")?.authorization.requiredScope, "venue:export");
  assert.equal(permissionForTool("venue.inspect_incidents"), "incident.read");
  assert.equal(permissionForTool("venue.report_incident"), "incident.report");
  assert.equal(permissionForTool("venue.export_incident_record"), "incident.export");
  for (const prohibited of ["acknowledge", "escalate", "resolve", "handoff", "attachment", "emergency_action"]) {
    assert.equal(venueToolContracts.some((contract) => contract.name.includes(prohibited) && contract.name.includes("incident")), false, prohibited);
  }
});

test("Incident reporting is structured, location-bound, retry-safe, and person-data-free", () => {
  const report = venueToolContracts.find((contract) => contract.name === "venue.report_incident");
  assert.deepEqual(report.inputSchema.required, ["severity", "category", "summaryCode", "location", "idempotencyKey"]);
  assert.deepEqual(report.inputSchema.properties.severity.enum, ["low", "medium", "high", "critical"]);
  assert.ok(report.inputSchema.properties.location.oneOf.every((variant) => variant.required.includes("kind")));
  assert.equal("name" in report.inputSchema.properties, false);
  assert.equal("email" in report.inputSchema.properties, false);
  assert.equal("medicalNotes" in report.inputSchema.properties, false);
  assert.ok(report.errors.includes("INCIDENT_PRIVACY_REJECTED"));
  assert.ok(report.errors.includes("INCIDENT_LOCATION_INVALID"));
});
