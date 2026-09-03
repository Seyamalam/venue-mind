import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelUrl = new URL("../src/RunbookPanel.tsx", import.meta.url);
const stylesUrl = new URL("../src/styles.css", import.meta.url);
const readPanel = () => readFile(panelUrl, "utf8");

test("Runbook uses non-modal shadcn surfaces and no raw form controls", async () => {
  const source = await readPanel();

  for (const component of [
    "Badge",
    "Button",
    "Dialog",
    "DropdownMenu",
    "Empty",
    "Field",
    "Input",
    "Progress",
    "ScrollArea",
    "Select",
    "Separator",
    "Sheet",
    "Tabs",
  ]) {
    assert.match(source, new RegExp(`\\b${component}\\b`), component);
  }
  assert.match(source, /<Sheet\s+open=\{open\}/);
  assert.match(source, /modal=\{false\}/);
  assert.match(source, /showOverlay=\{false\}/);
  assert.match(source, /<SheetTitle asChild>/);
  assert.match(source, /<SheetDescription className="sr-only">/);
  assert.match(source, /<DialogTitle>/);
  assert.match(source, /<DialogDescription className="sr-only">/);
  assert.match(source, /<SelectGroup>/);
  assert.match(source, /<DropdownMenuGroup>/);
  assert.doesNotMatch(source, /<(button|input|select|textarea)\b/);
});

test("Runbook exposes the six event phases, five role filters, and compact views", async () => {
  const source = await readPanel();

  for (const phase of ["SETUP", "DOORS", "LIVE", "INTERVAL", "EGRESS", "BREAKDOWN"])
    assert.match(source, new RegExp(`label: "${phase}"`));
  for (const role of ["PRODUCTION", "FOH", "SECURITY", "CATERING", "VENUE OPS"])
    assert.match(source, new RegExp(`label: "${role}"`));
  assert.match(source, /<TabsTrigger value="tasks">TASKS<\/TabsTrigger>/);
  assert.match(source, /<TabsTrigger value="handoff">HANDOFF<\/TabsTrigger>/);
  assert.match(source, />\s*NO RUNBOOK\s*</);
  assert.match(source, />\s*CREATE\s*</);
  assert.doesNotMatch(source, /Get started|You can|Please |This runbook|Create a runbook to/i);
});

test("Runbook action boundary stays prop-driven and stable-ID scoped", async () => {
  const source = await readPanel();

  for (const action of [
    "onCreate",
    "onPhaseFilterChange",
    "onRoleFilterChange",
    "onTaskTransition",
    "onAddEvidence",
    "onCreateHandoff",
    "onCopyHandoff",
    "onExportHandoff",
    "onSync",
    "onResolveSyncConflict",
  ])
    assert.match(source, new RegExp(`\\b${action}\\b`), action);

  assert.match(source, /onTaskTransition\?\.\(\{\s*taskId:\s*task\.id,\s*toStatus:/);
  assert.match(source, /onAddEvidence\?\.\(\{\s*taskId:\s*task\.id,\s*code,\s*ref:\s*reference\.trim\(\)/);
  assert.match(source, /onCreateHandoff\?\.\(\{\s*outgoingOwnerId,\s*incomingOwnerId,\s*roleId,\s*at\s*\}\)/);
  assert.match(source, /<code>\{task\.id\}<\/code>/);
});

test("Runbook includes keyboard and assistive-technology structure", async () => {
  const source = await readPanel();

  assert.match(source, /aria-label="Runbook views"/);
  assert.match(source, /role="list"/);
  assert.match(source, /role="listitem"/);
  assert.match(source, /aria-labelledby=\{titleId\}/);
  assert.match(source, /aria-label=\{`Start task \$\{task\.id\}`|aria-label=\{`\$\{primary\.label/);
  assert.match(source, /role=\{syncState\.state === "conflict" \? "alert" : "status"\}/);
  assert.match(source, /aria-live=\{syncState\.state === "conflict" \? "assertive" : "polite"\}/);
  assert.match(source, /aria-valuenow=\{progress\}/);
  assert.match(source, /<time dateTime=/);
  assert.match(source, /aria-invalid=\{invalid\}/);
  assert.match(source, /<FieldError>EVIDENCE REQUIRED<\/FieldError>/);
  assert.doesNotMatch(source, /NOTE|Textarea|note:/);
});

test("Runbook panel is viewport-safe and preserves coarse-pointer targets", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  assert.match(styles, /\.runbook-panel \{[^}]*width: min\(420px, calc\(100vw - 32px\)\)/s);
  assert.match(
    styles,
    /@media \(max-width: 880px\)\s*\{\s*\.runbook-panel\s*\{\s*inset:\s*10px !important;\s*width:\s*auto !important;\s*\}/,
  );
  assert.match(
    styles,
    /@media \(pointer: coarse\)\s*\{\s*\.runbook-panel\s*:is\([\s\S]*?\)\s*\{\s*min-height:\s*44px;/,
  );
  assert.match(styles, /\.runbook-task-list\s*\{[^}]*min-height:\s*0;[^}]*flex:\s*1;/s);
});
