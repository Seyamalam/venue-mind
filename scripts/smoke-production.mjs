import assert from "node:assert/strict";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import { summitForwardPlan } from "../src/domain/summit-forward.ts";

const origin = new URL(process.env.VENUEMIND_PRODUCTION_ORIGIN ?? "https://venue-mind-jet.vercel.app").origin;
const workerOrigin = new URL(process.env.VENUEMIND_WORKER_ORIGIN ?? "https://venue-mind-api.seyamalam41.workers.dev").origin;
const mutate = process.argv.includes("--write");

class CookieJar {
  #values = new Map();
  constructor(initial = {}) {
    for (const [name, value] of Object.entries(initial)) this.#values.set(name, value);
  }
  header() {
    return [...this.#values].map(([name, value]) => `${name}=${value}`).join("; ");
  }
  capture(response) {
    for (const value of response.headers.getSetCookie()) {
      const [pair] = value.split(";", 1);
      const separator = pair.indexOf("=");
      if (separator > 0) this.#values.set(pair.slice(0, separator), pair.slice(separator + 1));
    }
  }
}

const expectResponse = async (path, expectedStatus, options = {}) => {
  const response = await fetch(`${origin}${path}`, { redirect: "manual", ...options });
  assert.equal(response.status, expectedStatus, `${path} returned ${response.status}`);
  return response;
};

const requiredSecurityHeaders = [
  "content-security-policy",
  "permissions-policy",
  "referrer-policy",
  "strict-transport-security",
  "x-content-type-options",
];

for (const path of ["/", "/docs", "/llms.txt", "/llms-full.txt", "/schemas/venue-command.schema.json"])
  await expectResponse(path, 200);
const frontend = await expectResponse("/", 200);
for (const name of requiredSecurityHeaders) assert.ok(frontend.headers.get(name), `production response misses ${name}`);
const contracts = await expectResponse("/schemas/venue-command.schema.json", 200);
assert.match(contracts.headers.get("cache-control") ?? "", /s-maxage=3600/u);
const health = await expectResponse("/api/health", 200);
assert.deepEqual(await health.json(), { status: "ok", service: "venue-mind-api" });
const missingApi = await expectResponse("/api/not-a-route", 404);
assert.match((await missingApi.json()).code, /(?:API_ROUTE_REQUIRED|NOT_FOUND)/u);
const workerFrontend = await fetch(`${workerOrigin}/`, { redirect: "manual" });
assert.equal(workerFrontend.status, 404);
assert.equal((await workerFrontend.json()).code, "API_ROUTE_REQUIRED");

const evidence = {
  schemaVersion: 1,
  origin,
  workerOrigin,
  publicArtifacts: "pass",
  securityHeaders: "pass",
  cachePolicy: "pass",
  apiRouting: "pass",
  goldenLoop: "not-requested",
};

if (mutate) {
  const demoIdentity = "4d43de5d-9527-4cc8-b495-b99771995683";
  const browserOne = new CookieJar({ venuemind_demo_identity: demoIdentity });
  const request = async (path, options = {}) => {
    const response = await fetch(`${origin}${path}`, {
      ...options,
      headers: { accept: "application/json", cookie: browserOne.header(), origin, ...options.headers },
    });
    browserOne.capture(response);
    return response;
  };
  await request("/api/projects");
  const planner = createVenuePlanner(summitForwardPlan);
  const inspection = planner.execute({ type: "inspect_layout" });
  const preview = planner.execute({
    type: "preview_revision",
    goal: "Protect access and reduce peak congestion",
    actor: "agent",
    actorId: "production-smoke-agent",
    idempotencyKey: `production-smoke-preview-${Date.now()}`,
  });
  const validation = planner.execute({ type: "validate_layout" });
  assert.equal(validation.status, "pass");
  const proposal = planner.getSnapshot().proposal;
  const approval = planner.execute({
    type: "approve_proposal",
    proposalId: proposal.id,
    baseVersion: proposal.baseVersion,
    actor: "human",
    actorId: "production-smoke-human",
    idempotencyKey: `production-smoke-approval-${Date.now()}`,
  });
  const exported = planner.execute({ type: "export_plan", format: "audit" });
  const snapshot = planner.getSnapshot();
  const id = "project-production-smoke";
  const current = await request(`/api/projects/${id}`);
  const existing = current.status === 200 ? await current.json() : null;
  assert.ok(current.status === 200 || current.status === 404);
  const record = {
    id,
    name: "PRODUCTION SMOKE",
    activePlanId: snapshot.plan.id,
    schemaVersion: 10,
    snapshot,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...(existing ? { revision: existing.revision } : {}),
  };
  const saved = await request(`/api/projects/${id}`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(existing
        ? { "x-venuemind-expected-revision": String(existing.revision) }
        : { "x-venuemind-create-only": "1" }),
    },
    body: JSON.stringify(record),
  });
  if (saved.status !== 200 && saved.status !== 201)
    assert.fail(`Project persistence returned ${saved.status}: ${await saved.text()}`);
  const stored = await saved.json();

  const browserTwo = new CookieJar({ venuemind_demo_identity: demoIdentity });
  const reloaded = await fetch(`${origin}/api/projects/${id}`, {
    headers: { accept: "application/json", cookie: browserTwo.header() },
  });
  browserTwo.capture(reloaded);
  assert.equal(reloaded.status, 200);
  const durable = await reloaded.json();
  assert.equal(durable.revision, stored.revision);
  assert.equal(durable.snapshot.plan.version, approval.planVersion);
  assert.equal(durable.snapshot.ledger.at(-1).type, "proposal.approved");
  assert.ok(JSON.parse(exported.content).activityLedger.length > 1);
  Object.assign(evidence, {
    goldenLoop: "pass",
    plan: `${inspection.planVersion}->${approval.planVersion}`,
    proposalId: preview.proposalId,
    validationId: validation.validationId,
    durableRevision: stored.revision,
    secondSessionReload: "pass",
  });
}

process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
