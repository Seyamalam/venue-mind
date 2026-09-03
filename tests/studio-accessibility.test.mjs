import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  contrastRatio,
  describeVenueObject,
  nextRovingIndex,
  relativeLuminance,
  validationAnnouncement,
} from "../src/accessibility/studio-accessibility.ts";

test("canvas roving focus wraps and supports first and last", () => {
  assert.equal(nextRovingIndex(4, 0, "previous"), 3);
  assert.equal(nextRovingIndex(4, 3, "next"), 0);
  assert.equal(nextRovingIndex(4, 2, "first"), 0);
  assert.equal(nextRovingIndex(4, 1, "last"), 3);
  assert.equal(nextRovingIndex(0, 0, "next"), -1);
});

test("object descriptions expose identity, geometry, layer, and lock state", () => {
  const description = describeVenueObject({
    id: "obj-registration",
    label: "Registration",
    kind: "service_desk",
    layer: "furniture",
    footprint: {
      kind: "rectangle",
      center: { x: 2.125, y: 4 },
      width: 1.8,
      depth: 0.8,
      rotationDegrees: 90,
    },
    locks: [
      {
        id: "lock-registration",
        objectId: "obj-registration",
        type: "position",
        source: "project",
        reasonCode: "operator-hold",
        active: true,
        createdAt: "2026-09-03T00:00:00.000Z",
        createdBy: "operator",
      },
    ],
  });

  assert.equal(
    description,
    "Registration; service desk; furniture; 2.13, 4 metres; 1.8 by 0.8 metres; 90 degrees; 1 active lock",
  );
});

test("validation announcements never rely on color", () => {
  assert.equal(
    validationAnnouncement({ status: "fail", blockingIssues: 2, unwaivedWarnings: 0 }),
    "Validation failed with 2 blocking issues",
  );
  assert.equal(
    validationAnnouncement({ status: "pass", blockingIssues: 0, unwaivedWarnings: 1 }),
    "Validation passed with 1 open warning",
  );
  assert.equal(
    validationAnnouncement({ status: "pass", blockingIssues: 0, unwaivedWarnings: 0 }),
    "Validation passed",
  );
});

test("Studio text and action tokens meet WCAG AA contrast", () => {
  assert.ok(relativeLuminance("#ffffff") > relativeLuminance("#000000"));
  assert.ok(contrastRatio("#1d1e1c", "#faf9f6") >= 4.5, "ink on paper");
  assert.ok(contrastRatio("#6f706d", "#faf9f6") >= 4.5, "muted text on paper");
  assert.ok(contrastRatio("#6845e8", "#faf9f6") >= 4.5, "violet text on paper");
  assert.ok(contrastRatio("#ffffff", "#6845e8") >= 4.5, "white on violet action");
  assert.ok(contrastRatio("#286638", "#faf9f6") >= 4.5, "success text on paper");
  assert.ok(contrastRatio("#ffffff", "#286638") >= 4.5, "white on success action");
  assert.throws(() => relativeLuminance("#fff"), /COLOR_HEX_INVALID/u);
});

test("Studio sources include keyboard canvas, equivalent object views, announcements, and focus recovery", async () => {
  const [app, editor, history, styles] = await Promise.all([
    readFile(new URL("../src/App.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/PlanEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/HistoryPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/styles.css", import.meta.url), "utf8"),
  ]);

  assert.match(editor, /aria-labelledby="plan-editor-canvas-title"/u);
  assert.match(editor, /Control plus arrow moves selected objects/u);
  assert.match(editor, /handleObjectKeyDown/u);
  assert.match(editor, /"aria-pressed": selected/u);
  assert.match(editor, /className="accessible-object-panel"/u);
  assert.match(editor, /aria-live="polite" aria-atomic="true"/u);

  assert.match(app, /className="canvas-object-index"/u);
  assert.match(app, /id="validation-summary" role="status" aria-live="polite"/u);
  assert.match(app, /aria-describedby="validation-summary"/u);
  assert.match(app, /aria-controls="spatial-analysis-panel"/u);
  assert.match(app, /analysisTriggerRef\.current\?\.focus\(\)/u);

  assert.match(history, /aria-current=\{branch\.active \? "true" : undefined\}/u);
  assert.match(history, /role="list" aria-label="Proposal branches"/u);

  assert.match(styles, /button:focus-visible,[\s\S]*\[tabindex\]:focus-visible/u);
  assert.match(styles, /outline: 3px solid var\(--vm-color-violet\)/u);
  assert.match(styles, /--green: var\(--vm-color-success-text\)/u);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important/u);
  assert.match(styles, /@media \(max-width: 880px\)[\s\S]*\.top-actions[\s\S]*flex-wrap: wrap/u);
});
