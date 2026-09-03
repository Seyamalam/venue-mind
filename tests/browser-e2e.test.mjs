import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const executeFile = promisify(execFile);
const root = path.resolve(new URL("../", import.meta.url).pathname);
const baseUrl = process.env.VENUEMIND_BROWSER_BASE_URL;
assert.ok(baseUrl, "VENUEMIND_BROWSER_BASE_URL is required; run npm run test:browser");
const session = `venuemind-browser-${process.pid}`;
const visualSession = `${session}-visual`;
const artifacts = await mkdtemp(path.join(tmpdir(), "venuemind-browser-artifacts-"));

const browser = async (activeSession, ...arguments_) => {
  const result = await executeFile("agent-browser", ["--session", activeSession, ...arguments_], {
    cwd: root,
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout.trim();
};

const evaluate = async (activeSession, expression) => {
  const output = await browser(activeSession, "eval", expression);
  const decoded = JSON.parse(output);
  return typeof decoded === "string" ? JSON.parse(decoded) : decoded;
};

const closeSessions = async () => {
  await Promise.allSettled([
    browser(session, "close"),
    browser(visualSession, "close"),
  ]);
  await rm(artifacts, { recursive: true, force: true });
};

test.after(closeSessions);

test("real browser registers WebMCP tools and completes the human-supervised golden loop", async () => {
  await browser(session, "open", `${baseUrl}/projects`);
  await browser(session, "set", "viewport", "1440", "900");
  await browser(session, "wait", ".projects-brand");
  await evaluate(
    session,
    `(() => {
      const tools = new Map();
      Object.defineProperty(window, "__venueMindBrowserTools", { configurable: true, value: tools });
      Object.defineProperty(document, "modelContext", {
        configurable: true,
        value: {
          registerTool(tool) {
            tools.set(tool.name, tool);
            return { unregister() { tools.delete(tool.name); } };
          }
        }
      });
      return JSON.stringify({ installed: true });
    })()`,
  );
  await browser(session, "click", ".projects-brand");
  await browser(session, "wait", ".app-shell");
  const agentResult = await evaluate(
    session,
    `(async () => {
      const tools = window.__venueMindBrowserTools;
      const inspect = await tools.get("venue.inspect_layout").execute({});
      const preview = await tools.get("venue.preview_revision").execute({
        goal: "Protect accessible circulation",
        idempotencyKey: "browser-golden-preview",
        correlationId: "corr-browser-golden"
      });
      const validation = await tools.get("venue.validate_layout").execute({});
      return JSON.stringify({
        count: tools.size,
        inspect,
        preview,
        validation
      });
    })()`,
  );
  assert.equal(agentResult.count, 56);
  assert.ok(agentResult.inspect.structuredContent.data, JSON.stringify(agentResult.inspect));
  assert.ok(agentResult.preview.structuredContent.data, JSON.stringify(agentResult.preview));
  assert.ok(agentResult.validation.structuredContent.data, JSON.stringify(agentResult.validation));
  assert.equal(agentResult.inspect.structuredContent.data.planVersion, "3.2");
  assert.equal(agentResult.preview.structuredContent.data.requiresHumanApproval, true);
  assert.equal(agentResult.validation.structuredContent.data.status, "pass");
  assert.equal(agentResult.validation.structuredContent.data.unwaivedWarnings, 0);
  await browser(session, "wait", "500");
  const approvalState = await evaluate(
    session,
    `JSON.stringify({ buttons: [...document.querySelectorAll("button")].map((node) => ({ text: node.textContent?.trim(), disabled: node.disabled })), emergency: document.querySelector('[aria-label="Emergency Review"]') !== null })`,
  );

  if (agentResult.validation.structuredContent.data.emergencyReviewRequired === true) {
    await browser(session, "find", "label", "Emergency reviewer ID", "fill", "reviewer-browser");
    await browser(session, "find", "role", "checkbox", "check", "--name", "Emergency assumptions accepted");
  }
  assert.ok(
    approvalState.buttons.some((button) => button.text?.includes("Approve proposal") && button.disabled === false),
    JSON.stringify({ validation: agentResult.validation.structuredContent.data, approvalState }),
  );
  const approvalClick = await evaluate(
    session,
    `(() => {
      const button = [...document.querySelectorAll("button")].find((node) => node.textContent?.includes("Approve proposal"));
      if (!button) return JSON.stringify({ clicked: false });
      button.click();
      return JSON.stringify({ clicked: true, disabled: button.disabled });
    })()`,
  );
  assert.deepEqual(approvalClick, { clicked: true, disabled: false });
  await browser(session, "wait", "500");
  const finalResult = await evaluate(
    session,
    `(async () => {
      const tools = window.__venueMindBrowserTools;
      const inspect = await tools.get("venue.inspect_layout").execute({});
      const replay = await tools.get("venue.replay_history").execute({});
      const exported = await tools.get("venue.export_plan").execute({ format: "json" });
      return JSON.stringify({
        planVersion: inspect.structuredContent.data.planVersion,
        replayStatus: replay.structuredContent.data.status,
        filename: exported.structuredContent.data.filename,
        status: document.querySelector('[role="status"]')?.textContent ?? null
      });
    })()`,
  );
  assert.equal(finalResult.planVersion, "3.3", JSON.stringify(finalResult));
  assert.equal(finalResult.replayStatus, "pass");
  assert.match(finalResult.filename, /v3-3\.json$/);
  assert.match(finalResult.status ?? "", /Plan v3\.3 applied/);
});

test("critical routes expose named interactive controls and keyboard-reachable landmarks", async () => {
  await browser(visualSession, "open", `${baseUrl}/docs`);
  await browser(visualSession, "set", "viewport", "1440", "900");
  const docs = await evaluate(
    visualSession,
    `JSON.stringify({
      main: document.querySelectorAll("main").length,
      navigation: document.querySelectorAll("nav[aria-label], aside[aria-label]").length,
      unnamed: [...document.querySelectorAll("a,button,input")].filter((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return !(node.getAttribute("aria-label") || node.textContent?.trim() || node.getAttribute("title"));
      }).length
    })`,
  );
  assert.equal(docs.main, 1);
  assert.ok(docs.navigation >= 2);
  assert.equal(docs.unnamed, 0);
  await browser(visualSession, "press", "Tab");
  assert.equal(
    (await evaluate(visualSession, "JSON.stringify({ focused: document.activeElement !== document.body })")).focused,
    true,
  );

  await browser(visualSession, "goto", `${baseUrl}/studio/project-summit-forward`);
  await browser(visualSession, "wait", ".app-shell");
  const studio = await evaluate(
    visualSession,
    `JSON.stringify({
      workspace: document.querySelectorAll('[aria-label="Venue plan workspace"]').length,
      proposalActions: [...document.querySelectorAll("button")].filter((node) => /Approve proposal|Request adjustment/.test(node.textContent ?? "")).length,
      unnamed: [...document.querySelectorAll("a,button,input,textarea")].filter((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        return !(node.getAttribute("aria-label") || node.textContent?.trim() || node.getAttribute("title"));
      }).length
    })`,
  );
  assert.equal(studio.workspace, 1);
  assert.equal(studio.proposalActions, 2);
  assert.equal(studio.unnamed, 0);
});

test("critical docs and Studio review pixels match reviewed baselines", async () => {
  const cases = [
    { name: "docs-overview", url: `${baseUrl}/docs`, selector: ".docs-shell" },
    { name: "studio-review", url: `${baseUrl}/studio/project-summit-forward`, selector: ".app-shell" },
  ];
  for (const visual of cases) {
    await browser(visualSession, "goto", visual.url);
    await browser(visualSession, "wait", visual.selector);
    const actual = path.join(artifacts, `${visual.name}.png`);
    const baseline = path.join(root, "tests/fixtures/visual", `${visual.name}.png`);
    await browser(visualSession, "screenshot", visual.selector, actual);
    if (process.env.UPDATE_VISUAL_BASELINES === "1") {
      await copyFile(actual, baseline);
      continue;
    }
    const output = await browser(
      visualSession,
      "diff",
      "screenshot",
      "--baseline",
      baseline,
      "--selector",
      visual.selector,
      "--threshold",
      "0.04",
      "--json",
    );
    const result = JSON.parse(output);
    assert.equal(result.success, true, `${visual.name}: ${output}`);
    assert.equal(result.data?.match, true, `${visual.name}: ${output}`);
  }
});
