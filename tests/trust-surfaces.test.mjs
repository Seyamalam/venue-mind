import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DATA_COLLECTION_BOUNDARIES, DEFAULT_RETENTION_RULES } from "../src/security/data-protection.ts";
import { trustPages } from "../src/docs/pages/trust.ts";

const page = (slug) => trustPages.find((candidate) => candidate.slug === slug);
const text = (value) => JSON.stringify(value);

test("public privacy claims match enforced collection and retention boundaries", () => {
  const privacy = page("privacy");
  assert.ok(privacy);
  const claims = text(privacy);
  assert.equal(DATA_COLLECTION_BOUNDARIES.attendeeRecords, false);
  assert.equal(DATA_COLLECTION_BOUNDARIES.individualOccupancyEvents, false);
  assert.equal(DATA_COLLECTION_BOUNDARIES.rawIntegrationCredentials, false);
  assert.equal(DATA_COLLECTION_BOUNDARIES.serverStoredExports, false);
  assert.equal(DEFAULT_RETENTION_RULES["operational-sensitive"].activeDays, 365);
  assert.equal(DEFAULT_RETENTION_RULES["security-evidence"].activeDays, 400);
  assert.match(claims, /attendee records/);
  assert.match(claims, /365 days/);
  assert.match(claims, /400 days/);
  assert.match(claims, /not retained by VenueMind/);
});

test("trust pages publish authority, reporting, deletion, and license surfaces", () => {
  assert.deepEqual(trustPages.map(({ slug }) => slug), ["privacy", "terms", "trust-safety"]);
  const claims = text(trustPages);
  assert.match(claims, /Only an authorized human approves/);
  assert.match(claims, /not a certification/);
  assert.match(claims, /Account deletion/);
  assert.match(claims, /private vulnerability reporting/);
  assert.match(claims, /third-party-licenses\.json/);
});

test("generated third-party notices cover the exact lockfile inventory", async () => {
  const [inventorySource, lockfileSource, noticeText, licenseText] = await Promise.all([
    readFile(new URL("../public/third-party-licenses.json", import.meta.url), "utf8"),
    readFile(new URL("../package-lock.json", import.meta.url), "utf8"),
    readFile(new URL("../public/THIRD_PARTY_NOTICES.txt", import.meta.url), "utf8"),
    readFile(new URL("../public/LICENSE.txt", import.meta.url), "utf8"),
  ]);
  const inventory = JSON.parse(inventorySource);
  const lockfile = JSON.parse(lockfileSource);
  const lockPackages = Object.entries(lockfile.packages).filter(
    ([path, record]) => path && typeof record?.version === "string" && typeof record?.license === "string",
  );
  assert.ok(inventory.packageCount > 500);
  assert.ok(inventory.packageCount <= lockPackages.length);
  assert.equal(inventory.packageCount, inventory.packages.length);
  assert.match(noticeText, /next@16\.3\.4/);
  assert.match(noticeText, /react@19\.2\.8/);
  assert.match(licenseText, /^MIT License/);
});
