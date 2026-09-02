import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelUrl = new URL("../src/IncidentPanel.tsx", import.meta.url);
const stylesUrl = new URL("../src/styles.css", import.meta.url);
const appUrl = new URL("../src/App.tsx", import.meta.url);

test("Incident Studio is a non-modal prop-driven operational surface", async () => {
  const [source, styles] = await Promise.all([readFile(panelUrl, "utf8"), readFile(stylesUrl, "utf8")]);

  for (const component of [
    "Badge",
    "Button",
    "Empty",
    "Field",
    "Input",
    "ScrollArea",
    "Select",
    "Separator",
    "Sheet",
    "Tabs",
    "Textarea",
    "ToggleGroup",
  ]) {
    assert.match(source, new RegExp(`\\b${component}\\b`), component);
  }
  assert.match(source, /<Sheet\s+open=\{open\}/);
  assert.match(source, /modal=\{false\}/);
  assert.match(source, /showOverlay=\{false\}/);
  assert.match(source, /<SheetTitle asChild>/);
  assert.match(source, /<SheetDescription className="sr-only">/);
  assert.match(source, />\s*LIVE · INCIDENTS\s*</);
  for (const view of ["new", "issues", "handoff", "ledger"])
    assert.match(source, new RegExp(`<TabsTrigger value="${view}">`));
  for (const field of ["SEVERITY", "CATEGORY", "OWNER", "SUMMARY", "ANCHOR"])
    assert.match(source, new RegExp(`>\\s*${field}\\s*<`));
  for (const action of [
    "ACK",
    "ESCALATE",
    "EMERGENCY",
    "MITIGATE",
    "RESOLVE",
    "CLOSE",
    "REOPEN",
    "HANDOFF",
    "ATTACH",
    "GET",
    "DISCARD",
  ])
    assert.match(source, new RegExp(`>\\s*${action}\\s*<`));
  for (const callback of [
    "onCreate",
    "onSelectIncident",
    "onSelectAnchor",
    "onAcknowledge",
    "onEscalate",
    "onEmergencyAction",
    "onResolve",
    "onCreateHandoff",
    "onAttach",
    "onDownloadAttachment",
    "onDiscardConflicts",
    "onSync",
    "onExport",
  ])
    assert.match(source, new RegExp(`\\b${callback}\\b`));
  for (const category of [
    "accessibility",
    "crowd-capacity",
    "fire-life-safety",
    "production-av",
    "transport",
    "weather",
  ])
    assert.match(source, new RegExp(`id: "${category}"`));
  assert.match(source, /summaryCode/);
  assert.match(source, /kind: "plan-object", planObjectId/);
  assert.match(source, /expectedIncidentRevision/);
  assert.match(source, /reasonCode: "OPS_ACK"/);
  assert.match(source, /resolutionCode: "CONTROL_COMPLETE"/);
  assert.match(source, /openActionCodes: \["CONTINUE_RESPONSE"\]/);
  assert.match(source, /incident\.location\?\.kind === "plan-object"/);
  assert.doesNotMatch(source, /<(button|select|textarea)\b/);
  assert.doesNotMatch(source, /Get started|You can|Please |Create an incident to|Track incidents/i);

  assert.match(styles, /\.incident-panel \{[^}]*width: min\(480px, calc\(100vw - 32px\)\)/s);
  assert.match(styles, /@media \(max-width: 440px\) \{[^}]*\.incident-panel \{[^}]*width: 100vw !important;/s);
  assert.match(styles, /@media \(pointer: coarse\) \{[^}]*\.incident-panel :is\([^}]*min-height: 44px;/s);
});

test("Incident Studio is lazy-wired through OPS, recovery, shared tools, and human actions", async () => {
  const source = await readFile(appUrl, "utf8");
  assert.match(source, /createIncidentCommandBus/);
  assert.match(source, /createIncidentStore/);
  assert.match(source, /createIncidentRemote/);
  assert.match(source, /synchronizeIncidents/);
  assert.match(source, /const LazyIncidentPanel = lazy/);
  assert.match(source, /<b>INCIDENTS<\/b>/);
  assert.match(source, /incidentOperations=\{incidentOperations\}/);
  assert.match(source, /<LazyIncidentPanel/);
  for (const command of [
    "report_incident",
    "set_incident_owner",
    "acknowledge_incident",
    "escalate_incident",
    "record_incident_emergency_action",
    "transition_incident_status",
    "handoff_incident",
  ])
    assert.match(source, new RegExp(command));
  assert.match(source, /incidentRemote\.attach/);
  assert.match(source, /incidentRemote\.download/);
  assert.match(source, /incidentStore\.discardConflicts/);
  assert.match(source, /incidentRemote\.export/);
});
