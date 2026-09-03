import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const panelUrl = new URL("../src/PostEventReviewPanel.tsx", import.meta.url);
const appUrl = new URL("../src/App.tsx", import.meta.url);
const stylesUrl = new URL("../src/styles.css", import.meta.url);

test("Post-Event Review is a lazy non-modal operational surface with stable evidence IDs", async () => {
  const [panel, app] = await Promise.all([readFile(panelUrl, "utf8"), readFile(appUrl, "utf8")]);
  for (const component of ["Badge", "Button", "Empty", "Field", "Input", "ScrollArea", "Select", "Separator", "Sheet", "Tabs"])
    assert.match(panel, new RegExp(`\\b${component}\\b`), component);
  assert.match(panel, /<Sheet open=\{open\}/);
  assert.match(panel, /modal=\{false\}/);
  assert.match(panel, /showOverlay=\{false\}/);
  assert.match(panel, /data-comparison-key=\{item\.key\}/);
  assert.match(panel, /data-lesson-id=\{lesson\.id\}/);
  assert.match(panel, /data-proposal-id=\{proposal\.id\}/);
  assert.match(panel, /data-ledger-id=\{entry\.id\}/);
  assert.doesNotMatch(panel, /<(button|input|select|textarea)\b/);
  assert.doesNotMatch(panel, /Get started|You can|Please |This review|Track outcomes|Upload|Attachment/i);

  assert.match(app, /const loadPostEventReviewPanel = \(\) =>/);
  assert.match(app, /const LazyPostEventReviewPanel = lazy\(loadPostEventReviewPanel\)/);
  assert.match(app, /postEventReviewMounted\s*&&\s*\(\s*<Suspense/);
  assert.match(app, /<b>POST-EVENT<\/b>/);
  assert.match(app, /disabled=\{!runbook\}[\s\S]*?<b>POST-EVENT<\/b>/);
  assert.match(app, /<LazyPostEventReviewPanel/);
});

test("Post-Event Review Studio wires frozen evidence, lessons, templates, human review, recovery, and export", async () => {
  const [panel, app] = await Promise.all([readFile(panelUrl, "utf8"), readFile(appUrl, "utf8")]);
  for (const callback of [
    "onRecordObservation",
    "onRecordLesson",
    "onCreateTemplateProposal",
    "onReviewTemplateProposal",
    "onRecover",
    "onDiscardConflicts",
    "onSync",
    "onExport",
  ]) assert.match(panel, new RegExp(`\\b${callback}\\b`), callback);
  for (const command of [
    "create_post_event_review",
    "record_post_event_observation",
    "record_post_event_lesson",
    "create_template_improvement_proposal",
    "review_template_improvement_proposal",
    "export_post_event_report",
  ]) assert.match(app, new RegExp(command), command);
  assert.match(app, /fingerprint: review\.source\.occupancyProjectionFingerprint/);
  assert.match(app, /fingerprint: review\.source\.incidentRegisterFingerprint/);
  assert.match(app, /fingerprint: review\.source\.deviationRegisterFingerprint/);
  assert.match(app, /requirementIds: input\.linkKind === "requirement" \? \[input\.linkId\] : \[\]/);
  assert.match(app, /constraintIds: input\.linkKind === "constraint" \? \[input\.linkId\] : \[\]/);
  assert.match(app, /changeLessonLinks: changes\.map/);
  assert.match(app, /actorType: "human" as const/);
  assert.match(app, /postEventReviewStore\.discardConflicts\(\)/);
  assert.match(app, /synchronizePostEventReview\(\{/);
  assert.match(app, /postEventReviewRemote\.export/);
  assert.doesNotMatch(panel, /type="file"|onAttach|R2|Blob/);
});

test("Post-Event Review panel is viewport-safe with coarse-pointer controls", async () => {
  const styles = await readFile(stylesUrl, "utf8");
  assert.match(styles, /\.post-event-panel \{[^}]*width: min\(520px, calc\(100vw - 32px\)\)/s);
  assert.match(styles, /@media \(max-width: 880px\) \{[^}]*\.post-event-panel/s);
  assert.match(styles, /@media \(max-width: 440px\) \{[^}]*\.post-event-panel \{[^}]*width: 100vw !important;/s);
  assert.match(styles, /@media \(pointer: coarse\) \{[^}]*\.post-event-panel/s);
  assert.match(styles, /\.post-event-tabs \{[^}]*grid-template-rows: auto minmax\(0, 1fr\)/s);
});
