import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyWorkspaceViewport,
  detectBrowserCapabilities,
  requestBrowserPrint,
  SUPPORTED_BROWSERS,
  SUPPORTED_VIEWPORTS,
  writeClipboardText,
} from "../src/browser-platform.ts";

test("workspace modes preserve desktop editing, tablet Approval, and mobile read-only review", () => {
  assert.equal(classifyWorkspaceViewport(1440), "desktop");
  assert.equal(classifyWorkspaceViewport(1024), "desktop");
  assert.equal(classifyWorkspaceViewport(768), "tablet");
  assert.equal(classifyWorkspaceViewport(767), "mobile");
  assert.equal(classifyWorkspaceViewport(360), "mobile");
  assert.equal(SUPPORTED_VIEWPORTS.desktop.editing, true);
  assert.equal(SUPPORTED_VIEWPORTS.tablet.editing, false);
  assert.equal(SUPPORTED_VIEWPORTS.tablet.approval, true);
  assert.equal(SUPPORTED_VIEWPORTS.mobile.approval, false);
});

test("browser matrix covers Chromium, Safari, and Firefox with explicit WebMCP fallback", () => {
  assert.deepEqual(SUPPORTED_BROWSERS.map((browser) => browser.family), ["Chromium", "Safari", "Firefox"]);
  assert.equal(SUPPORTED_BROWSERS.find((browser) => browser.family === "Chromium").webMcp, "detected");
  assert.equal(SUPPORTED_BROWSERS.find((browser) => browser.family === "Safari").webMcp, "fallback");
  assert.equal(SUPPORTED_BROWSERS.find((browser) => browser.family === "Firefox").webMcp, "fallback");
});

test("capability detection reports density, pointer, clipboard, download, print, recovery, and WebMCP", () => {
  const complete = detectBrowserCapabilities({
    document: { modelContext: { registerTool() {} }, createElement() {}, execCommand() {}, body: {} },
    navigator: { clipboard: { readText() {}, writeText() {} } },
    URL: { createObjectURL() {}, revokeObjectURL() {} },
    indexedDB: {},
    print() {},
    devicePixelRatio: 2,
    matchMedia: () => ({ matches: true }),
  });
  assert.deepEqual(complete, {
    webMcp: "available",
    clipboardRead: true,
    clipboardWrite: "native",
    download: true,
    print: true,
    localRecovery: "indexeddb",
    pointer: "coarse",
    density: "high",
  });
  assert.deepEqual(detectBrowserCapabilities({}), {
    webMcp: "fallback",
    clipboardRead: false,
    clipboardWrite: "unavailable",
    download: false,
    print: false,
    localRecovery: "memory",
    pointer: "fine",
    density: "standard",
  });
});

test("clipboard and print helpers expose success and fallback without throwing", async () => {
  let copied = "";
  const method = await writeClipboardText("venue", {
    navigator: { clipboard: { writeText(value) { copied = value; } } },
  });
  assert.equal(method, "native");
  assert.equal(copied, "venue");
  assert.equal(await writeClipboardText("venue", {}), "unavailable");
  let printed = false;
  assert.equal(requestBrowserPrint({ print() { printed = true; } }), true);
  assert.equal(printed, true);
  assert.equal(requestBrowserPrint({}), false);
});
