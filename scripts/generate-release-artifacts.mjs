import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const noteDirectory = new URL("release/notes/", root);
const checksumPaths = [
  "package.json",
  "packages/mcp-server/package.json",
  "packages/sdk/package.json",
  "skills/manifest.json",
  "public/venue-tools.json",
  "db/migrations-manifest.json",
  "wrangler.jsonc",
  "vercel.json",
];

const parse = async (path) => JSON.parse(await readFile(new URL(path, root), "utf8"));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export async function buildReleaseArtifacts() {
  const [versions, environments, noteNames] = await Promise.all([
    parse("release/versions.json"),
    parse("release/environments.json"),
    readdir(noteDirectory),
  ]);
  const notes = await Promise.all(
    noteNames.filter((name) => /^\d+\.\d+\.\d+\.json$/u.test(name)).map(async (name) => parse(`release/notes/${name}`)),
  );
  notes.sort((left, right) => right.version.localeCompare(left.version, undefined, { numeric: true }));
  assert.ok(notes.length > 0, "At least one reviewed release note is required");
  for (const note of notes) {
    assert.equal(note.reviewed, true, `Release ${note.version} has not been reviewed`);
    assert.match(note.version, /^\d+\.\d+\.\d+$/u);
    assert.match(note.date, /^\d{4}-\d{2}-\d{2}$/u);
    assert.ok(note.sections.length > 0);
  }
  assert.equal(notes.at(0).version, versions.product, "Newest release note must match the product version");

  const changelog = [
    "# Changelog",
    "",
    "This file is generated from reviewed JSON notes in `release/notes/`.",
    "",
    ...notes.flatMap((note) => [
      `## ${note.version} — ${note.date}`,
      "",
      note.summary,
      "",
      ...note.sections.flatMap((section) => [
        `### ${section.title}`,
        "",
        ...section.items.map((item) => `- ${item}`),
        "",
      ]),
    ]),
  ].join("\n");

  const artifacts = Object.fromEntries(
    await Promise.all(checksumPaths.map(async (path) => [path, sha256(await readFile(new URL(path, root)))])),
  );
  const manifest = `${JSON.stringify({
    schemaVersion: 1,
    release: versions,
    environments,
    releaseNote: `release/notes/${notes.at(0).version}.json`,
    checksumAlgorithm: "sha256",
    artifacts,
  }, null, 2)}\n`;
  return { changelog: `${changelog.trimEnd()}\n`, manifest };
}

export async function generateReleaseArtifacts({ check = false } = {}) {
  const generated = await buildReleaseArtifacts();
  const outputs = [
    ["CHANGELOG.md", generated.changelog],
    ["release/manifest.json", generated.manifest],
  ];
  if (check) {
    for (const [path, expected] of outputs)
      assert.equal(await readFile(new URL(path, root), "utf8"), expected, `${path} is stale; run npm run generate:release`);
  } else {
    await Promise.all(outputs.map(([path, value]) => writeFile(new URL(path, root), value)));
  }
  return { status: check ? "current" : "generated", paths: outputs.map(([path]) => path) };
}

if (process.argv[1] && new URL(process.argv[1], "file:").href === import.meta.url)
  process.stdout.write(`${JSON.stringify(await generateReleaseArtifacts({ check: process.argv.includes("--check") }), null, 2)}\n`);
