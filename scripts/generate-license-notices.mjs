import { readFile, writeFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const lockfile = JSON.parse(await readFile(new URL("package-lock.json", root), "utf8"));
const venueMindLicense = await readFile(new URL("LICENSE", root), "utf8");

if (lockfile.lockfileVersion !== 3 || typeof lockfile.packages !== "object" || lockfile.packages === null) {
  throw new Error("Expected a package-lock v3 packages map");
}

const packageName = (path) => path.split("node_modules/").at(-1);
const notices = Object.entries(lockfile.packages)
  .flatMap(([path, record]) => {
    if (!path || typeof record !== "object" || record === null) return [];
    const name = packageName(path);
    const version = record.version;
    const license = record.license;
    if (!name || typeof version !== "string" || typeof license !== "string") return [];
    return [{ name, version, license }];
  })
  .filter(
    (notice, index, entries) =>
      entries.findIndex((candidate) => candidate.name === notice.name && candidate.version === notice.version) === index,
  )
  .sort((left, right) => left.name.localeCompare(right.name) || left.version.localeCompare(right.version));

const inventory = {
  schemaVersion: 1,
  generatedFrom: "package-lock.json",
  generatedFor: lockfile.name,
  packageCount: notices.length,
  packages: notices,
};
const text = [
  "VenueMind third-party notices",
  "",
  "Generated from the exact package-lock.json dependency graph. License identifiers are supplied by each package.",
  "The corresponding source distributions contain the authoritative license texts and notices.",
  "",
  ...notices.map(({ name, version, license }) => `${name}@${version} — ${license}`),
  "",
].join("\n");

await Promise.all([
  writeFile(new URL("public/third-party-licenses.json", root), `${JSON.stringify(inventory, null, 2)}\n`),
  writeFile(new URL("public/THIRD_PARTY_NOTICES.txt", root), text),
  writeFile(new URL("public/LICENSE.txt", root), venueMindLicense),
]);

console.log(`Generated ${notices.length} third-party license notices`);
