import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const clone = (value) => structuredClone(value);

const validateRecord = (record, organizationId = "org-local") => {
  if (!record?.id || !record?.activePlanId || !record?.snapshot?.plan?.id) {
    throw new TypeError("Project repository requires a complete Project record");
  }
  if (record.organizationId && record.organizationId !== organizationId) throw new Error("ORGANIZATION_ACCESS_DENIED");
  return { ...record, organizationId };
};

export function createMemoryProjectRepository(initialRecords = [], { organizationId = "org-local" } = {}) {
  const records = new Map(initialRecords.filter((record) => !record.organizationId || record.organizationId === organizationId).map((record) => [record.id, clone(validateRecord(record, organizationId))]));
  return Object.freeze({
    organizationId,
    async list() {
      return [...records.values()].map(clone).sort((left, right) => left.id.localeCompare(right.id));
    },
    async load(projectId) {
      const record = records.get(projectId);
      return record ? clone(record) : null;
    },
    async save(record) {
      const normalized = clone(validateRecord(record, organizationId));
      records.set(normalized.id, normalized);
      return clone(normalized);
    },
  });
}

export function createFileProjectRepository({
  directory = process.env.VENUEMIND_DATA_DIR || path.join(process.cwd(), ".venuemind-mcp"),
  filename = "projects.json",
  organizationId = process.env.VENUEMIND_ORGANIZATION_ID || "org-local",
} = {}) {
  const storePath = path.resolve(directory, filename);
  let writeQueue = Promise.resolve();

  const readAll = async () => {
    try {
      const parsed = JSON.parse(await readFile(storePath, "utf8"));
      if (!parsed || ![1, 2].includes(parsed.schemaVersion) || !Array.isArray(parsed.projects)) return [];
      return parsed.projects.filter((record) => !record.organizationId || record.organizationId === organizationId).map((record) => validateRecord(record, organizationId));
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  };

  const writeAll = async (projects) => {
    await mkdir(path.dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ schemaVersion: 2, organizationId, projects }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, storePath);
  };

  return Object.freeze({
    storePath,
    organizationId,
    async list() {
      return (await readAll()).map(clone).sort((left, right) => left.id.localeCompare(right.id));
    },
    async load(projectId) {
      const record = (await readAll()).find((item) => item.id === projectId);
      return record ? clone(record) : null;
    },
    async save(record) {
      const normalized = clone(validateRecord(record, organizationId));
      const operation = writeQueue.then(async () => {
        const records = await readAll();
        const index = records.findIndex((item) => item.id === normalized.id);
        if (index >= 0) records[index] = normalized;
        else records.push(normalized);
        await writeAll(records);
        return clone(normalized);
      });
      writeQueue = operation.catch(() => {});
      return operation;
    },
  });
}
