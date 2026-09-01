import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const clone: any = (value: any) => structuredClone(value);

const validateRecord: any = (record: any, organizationId: any = "org-local") => {
  if (!record?.id || !record?.activePlanId || !record?.snapshot?.plan?.id) {
    throw new TypeError("Project repository requires a complete Project record");
  }
  if (record.organizationId && record.organizationId !== organizationId) throw new Error("ORGANIZATION_ACCESS_DENIED");
  return { ...record, organizationId };
};

export function createMemoryProjectRepository(initialRecords: any = [], { organizationId = "org-local" }: any = {}) {
  const records: any = new Map(initialRecords.filter((record: any) => !record.organizationId || record.organizationId === organizationId).map((record: any) => [record.id, clone(validateRecord(record, organizationId))]));
  return Object.freeze({
    organizationId,
    async list() {
      return [...records.values()].map(clone).sort((left: any, right: any) => left.id.localeCompare(right.id));
    },
    async load(projectId: any) {
      const record: any = records.get(projectId);
      return record ? clone(record) : null;
    },
    async save(record: any) {
      const normalized: any = clone(validateRecord(record, organizationId));
      records.set(normalized.id, normalized);
      return clone(normalized);
    },
  });
}

export function createFileProjectRepository({
  directory = process.env.VENUEMIND_DATA_DIR || path.join(process.cwd(), ".venuemind-mcp"),
  filename = "projects.json",
  organizationId = process.env.VENUEMIND_ORGANIZATION_ID || "org-local",
}: any = {}) {
  const storePath: any = path.resolve(directory, filename);
  let writeQueue: any = Promise.resolve();

  const readAll: any = async () => {
    try {
      const parsed: any = JSON.parse(await readFile(storePath, "utf8"));
      if (!parsed || ![1, 2].includes(parsed.schemaVersion) || !Array.isArray(parsed.projects)) return [];
      return parsed.projects.filter((record: any) => !record.organizationId || record.organizationId === organizationId).map((record: any) => validateRecord(record, organizationId));
    } catch (error: any) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  };

  const writeAll: any = async (projects: any) => {
    await mkdir(path.dirname(storePath), { recursive: true });
    const temporaryPath: any = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ schemaVersion: 2, organizationId, projects }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, storePath);
  };

  return Object.freeze({
    storePath,
    organizationId,
    async list() {
      return (await readAll()).map(clone).sort((left: any, right: any) => left.id.localeCompare(right.id));
    },
    async load(projectId: any) {
      const record: any = (await readAll()).find((item: any) => item.id === projectId);
      return record ? clone(record) : null;
    },
    async save(record: any) {
      const normalized: any = clone(validateRecord(record, organizationId));
      const operation: any = writeQueue.then(async () => {
        const records: any = await readAll();
        const index: any = records.findIndex((item: any) => item.id === normalized.id);
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
