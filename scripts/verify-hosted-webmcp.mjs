import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Opt-in: creates a fresh guest Organization and persists its sample on the target.
const baseUrl = process.env.VENUEMIND_HOSTED_BASE_URL;
if (!baseUrl) throw new Error("Set VENUEMIND_HOSTED_BASE_URL to explicitly authorize the hosted write test");
const execute = promisify(execFile);
const session = `venuemind-hosted-${process.pid}`;
const secondSession = `${session}-second-guest`;
const browser = async (name, ...args) =>
  (
    await execute("agent-browser", ["--session", name, ...args], {
      timeout: 35_000,
      maxBuffer: 8_000_000,
    })
  ).stdout.trim();
const evaluate = async (name, code) => JSON.parse(await browser(name, "eval", code));
const waitForSaved = async (name) =>
  browser(
    name,
    "wait",
    "--fn",
    `document.querySelector('[aria-label="Open plan history"]')?.textContent.includes('SAVED') && !document.body.innerText.includes('SYNC CONFLICT')`,
  );

const openNativeStudio = async () => {
  await browser(session, "open", `${baseUrl}/projects`);
  await browser(session, "set", "viewport", "1920", "1080");
  await browser(session, "wait", ".projects-brand");
  const adapter = await evaluate(
    session,
    `(() => {
    if (!document.modelContext?.getTools || !document.modelContext?.executeTool) throw Error('Native document.modelContext unavailable; use current Chrome with WebMCP enabled');
    return 'document.modelContext, no shim or alias';
  })()`,
  );
  console.log(`Native API: ${adapter}`);
  await browser(session, "click", ".projects-brand");
  await browser(session, "wait", ".app-shell");
  await waitForSaved(session);
  await browser(
    session,
    "wait",
    "--fn",
    `(async () => (await document.modelContext.getTools()).some(t => t.name === 'venue.inspect_layout'))()`,
  );
};

const call = async (name, input = {}) => {
  const result = await evaluate(
    session,
    `(async () => {
    const tool = (await document.modelContext.getTools()).find(t => t.name === ${JSON.stringify(name)});
    if (!tool) throw Error('Missing native tool');
    return JSON.parse(await document.modelContext.executeTool(tool, JSON.stringify(${JSON.stringify(input)})));
  })()`,
  );
  assert.notEqual(result.isError, true, JSON.stringify(result));
  assert.ok(result.structuredContent?.data, JSON.stringify(result));
  console.log(`${name}: ${result.structuredContent.summary}`);
  return result.structuredContent.data;
};

const projectIdentity = async (name) =>
  evaluate(
    name,
    `(() => {
  const organizationId = localStorage.getItem('venuemind.active-organization');
  return {organizationId, projectId:'project-summit-forward-' + organizationId};
})()`,
  );

try {
  await openNativeStudio();
  const first = await projectIdentity(session);
  assert.equal((await call("venue.inspect_layout")).planVersion, "3.2");
  const preview = await call("venue.preview_revision", {
    goal: "Keep 400 seats, widen the center aisle to six feet, improve sightlines, and preserve locked objects.",
    idempotencyKey: `hosted-preview-${process.pid}`,
  });
  assert.equal(preview.requiresHumanApproval, true);
  const validation = await call("venue.validate_layout");
  assert.equal(validation.status, "pass");
  await waitForSaved(session);
  await browser(session, "find", "role", "button", "click", "--name", "Approve proposal", "--exact");
  await browser(
    session,
    "wait",
    "--fn",
    `document.querySelector('[aria-label="Open plan history"]')?.textContent.includes('3.3')`,
  );
  assert.equal((await call("venue.inspect_layout")).planVersion, "3.3");
  await call("venue.get_change_log");
  assert.equal((await call("venue.replay_history")).status, "pass");
  const exported = await call("venue.export_plan", { format: "json" });
  assert.match(exported.filename, /v3-3\.json$/);
  await waitForSaved(session);
  await browser(
    session,
    "wait",
    "--fn",
    `(async () => {
    const response = await fetch('/api/projects/${first.projectId}', {headers:{'x-venuemind-organization-id':'${first.organizationId}'}});
    if (!response.ok) return false;
    return (await response.json()).snapshot.plan.version === '3.3';
  })()`,
  );
  console.log("D1 readback: persisted Plan v3.3");
  await openNativeStudio();
  assert.deepEqual(await projectIdentity(session), first);
  assert.equal((await call("venue.inspect_layout")).planVersion, "3.3");
  console.log("Reload: same sample identity and persisted Plan v3.3");

  await browser(secondSession, "open", baseUrl);
  await browser(secondSession, "wait", ".app-shell");
  await waitForSaved(secondSession);
  const second = await projectIdentity(secondSession);
  assert.notEqual(first.organizationId, second.organizationId);
  assert.notEqual(first.projectId, second.projectId);
  const isolation = await evaluate(
    secondSession,
    `(async () => {
    const response = await fetch('/api/projects/${first.projectId}', {headers:{'x-venuemind-organization-id':'${second.organizationId}'}});
    return response.status;
  })()`,
  );
  assert.equal(isolation, 404);
  console.log("Second guest: independent saved sample; other Organization's project returns 404");
  console.log("PASS: hosted native WebMCP loop, durable reload, and guest isolation");
} finally {
  await Promise.allSettled([browser(session, "close"), browser(secondSession, "close")]);
}
