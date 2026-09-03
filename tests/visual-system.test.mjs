import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const globals = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const studio = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");
const projects = await readFile(new URL("../src/project-dashboard.css", import.meta.url), "utf8");
const routeState = await readFile(new URL("../components/route-state.tsx", import.meta.url), "utf8");

const hexToken = (name) => {
  const match = globals.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i"));
  assert.ok(match, `missing ${name}`);
  return match[1].toLowerCase();
};
const channel = (value) => {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex) =>
  0.2126 * channel(Number.parseInt(hex.slice(1, 3), 16)) +
  0.7152 * channel(Number.parseInt(hex.slice(3, 5), 16)) +
  0.0722 * channel(Number.parseInt(hex.slice(5, 7), 16));
const contrast = (foreground, background) => {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

test("Design 2 visual tokens remain an exact reviewed contract", () => {
  const snapshot = Object.fromEntries([
    "vm-color-ink",
    "vm-color-paper",
    "vm-color-canvas",
    "vm-color-line",
    "vm-color-violet",
    "vm-color-violet-soft",
    "vm-color-success-text",
    "vm-color-success-bg",
    "vm-color-warning-text",
    "vm-color-warning-bg",
    "vm-color-danger-text",
    "vm-color-danger-bg",
    "vm-color-offline-text",
    "vm-color-offline-bg",
  ].map((name) => [name, hexToken(name)]));
  assert.deepEqual(snapshot, {
    "vm-color-ink": "#1d1e1c",
    "vm-color-paper": "#faf9f6",
    "vm-color-canvas": "#f0eee8",
    "vm-color-line": "#deddd7",
    "vm-color-violet": "#6845e8",
    "vm-color-violet-soft": "#efecfb",
    "vm-color-success-text": "#286638",
    "vm-color-success-bg": "#e7f3e5",
    "vm-color-warning-text": "#7a4a0b",
    "vm-color-warning-bg": "#fff0da",
    "vm-color-danger-text": "#8d2923",
    "vm-color-danger-bg": "#fae9e7",
    "vm-color-offline-text": "#4f3aa0",
    "vm-color-offline-bg": "#ece8ff",
  });
});

test("semantic status pairs meet compact-text AA contrast", () => {
  for (const kind of ["success", "warning", "danger", "offline"]) {
    const ratio = contrast(hexToken(`vm-color-${kind}-text`), hexToken(`vm-color-${kind}-bg`));
    assert.ok(ratio >= 4.5, `${kind} contrast ${ratio.toFixed(2)}`);
  }
});

test("shared route state exposes every non-narrative product state", () => {
  for (const state of ["loading", "empty", "offline", "conflict", "invalid", "disabled"])
    assert.match(routeState, new RegExp(`"${state}"`));
  assert.match(routeState, /data-state=\{state\}/);
  assert.match(routeState, /aria-live=/);
  for (const state of ["loading", "empty", "offline", "conflict", "invalid", "disabled"])
    assert.match(globals, new RegExp(`data-state="${state}"`));
});

test("critical Studio states retain explicit visual selectors and shared tokens", () => {
  for (const selector of [
    ".proposal-shape",
    ".proposal-shape.is-lock-conflict",
    ".status-button.is-failed",
    ".save-indicator.is-local",
    ".save-indicator.is-conflict",
    ".branch-status.is-pass",
    ".branch-status.is-fail",
    ".primary-action.is-approved",
  ]) assert.match(studio, new RegExp(selector.replaceAll(".", "\\.")));
  assert.match(studio, /--violet: var\(--vm-color-violet\)/);
  assert.match(projects, /var\(--vm-color-canvas\)/);
});
