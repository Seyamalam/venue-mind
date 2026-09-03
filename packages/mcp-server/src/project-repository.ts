import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncidentRegister } from "../../../src/domain/operational-types.ts";
import type { PlannerSnapshot } from "../../../src/domain/venue-planner.ts";

export interface McpProjectRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly activePlanId: string;
  readonly schemaVersion: 10;
  readonly snapshot: PlannerSnapshot;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly recoveryUntil: string | null;
  readonly pinned: boolean;
  readonly lastOpenedAt: string | null;
  readonly incidentRegister?: IncidentRegister;
}

export interface McpProjectRepository {
  readonly organizationId: string;
  readonly storePath?: string;
  list(): Promise<McpProjectRecord[]>;
  load(projectId: string): Promise<McpProjectRecord | null>;
  save(record: McpProjectRecord): Promise<McpProjectRecord>;
}

const clone = <Value>(value: Value): Value => structuredClone(value);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const hasErrorCode = (value: unknown): value is { readonly code: string } =>
  isRecord(value) && typeof value["code"] === "string";

const isPlannerSnapshot = (value: unknown): value is PlannerSnapshot =>
  isRecord(value) &&
  isRecord(value["plan"]) &&
  isRecord(value["brief"]) &&
  isRecord(value["proposal"]) &&
  typeof value["activeBranchId"] === "string" &&
  Array.isArray(value["branches"]) &&
  Array.isArray(value["ledger"]) &&
  Array.isArray(value["receipts"]) &&
  Array.isArray(value["projectLocks"]) &&
  isRecord(value["editHistory"]) &&
  Array.isArray(value["comments"]) &&
  Array.isArray(value["scenarios"]) &&
  Array.isArray(value["scenarioRuns"]);

const isIncidentRegister = (value: unknown): value is IncidentRegister =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["runbookVersionId"] === "string" &&
  isRecord(value["source"]) &&
  isRecord(value["baseline"]) &&
  Array.isArray(value["incidents"]) &&
  Array.isArray(value["transitions"]) &&
  Array.isArray(value["receipts"]) &&
  Array.isArray(value["ledger"]) &&
  typeof value["revision"] === "number" &&
  typeof value["createdAt"] === "string" &&
  typeof value["createdBy"] === "string" &&
  typeof value["updatedAt"] === "string";

const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

const validateRecord = (value: unknown, organizationId = "org-local"): McpProjectRecord => {
  if (
    !isRecord(value) ||
    typeof value["id"] !== "string" ||
    typeof value["organizationId"] !== "string" ||
    typeof value["name"] !== "string" ||
    typeof value["activePlanId"] !== "string" ||
    value["schemaVersion"] !== 10 ||
    !isPlannerSnapshot(value["snapshot"]) ||
    typeof value["createdAt"] !== "string" ||
    typeof value["updatedAt"] !== "string" ||
    !nullableString(value["archivedAt"]) ||
    !nullableString(value["deletedAt"]) ||
    !nullableString(value["recoveryUntil"]) ||
    typeof value["pinned"] !== "boolean" ||
    !nullableString(value["lastOpenedAt"]) ||
    (value["incidentRegister"] !== undefined && !isIncidentRegister(value["incidentRegister"]))
  ) {
    throw new TypeError("Project repository requires a complete Project record");
  }
  if (value["organizationId"] !== organizationId) throw new Error("ORGANIZATION_ACCESS_DENIED");
  const base = {
    id: value["id"],
    organizationId,
    name: value["name"],
    activePlanId: value["activePlanId"],
    schemaVersion: 10,
    snapshot: value["snapshot"],
    createdAt: value["createdAt"],
    updatedAt: value["updatedAt"],
    archivedAt: value["archivedAt"],
    deletedAt: value["deletedAt"],
    recoveryUntil: value["recoveryUntil"],
    pinned: value["pinned"],
    lastOpenedAt: value["lastOpenedAt"],
  } satisfies McpProjectRecord;
  return value["incidentRegister"] === undefined ? base : { ...base, incidentRegister: value["incidentRegister"] };
};

export function createMemoryProjectRepository(
  initialRecords: readonly McpProjectRecord[] = [],
  { organizationId = "org-local" }: { readonly organizationId?: string } = {},
): McpProjectRepository {
  const records = new Map(
    initialRecords
      .filter((record) => record.organizationId === organizationId)
      .map((record) => [record.id, clone(validateRecord(record, organizationId))]),
  );
  return Object.freeze({
    organizationId,
    list() {
      return Promise.resolve([...records.values()].map(clone).sort((left, right) => left.id.localeCompare(right.id)));
    },
    load(projectId: string) {
      const record = records.get(projectId);
      return Promise.resolve(record ? clone(record) : null);
    },
    async save(record: McpProjectRecord) {
      const normalized = clone(validateRecord(record, organizationId));
      records.set(normalized.id, normalized);
      return clone(normalized);
    },
  });
}

interface FileRepositoryOptions {
  readonly directory?: string;
  readonly filename?: string;
  readonly organizationId?: string;
}

export function createFileProjectRepository({
  directory = process.env["VENUEMIND_DATA_DIR"] || path.join(process.cwd(), ".venuemind-mcp"),
  filename = "projects.json",
  organizationId = process.env["VENUEMIND_ORGANIZATION_ID"] || "org-local",
}: FileRepositoryOptions = {}): McpProjectRepository {
  const storePath = path.resolve(directory, filename);
  let writeQueue: Promise<void> = Promise.resolve();
  const readAll = async (): Promise<McpProjectRecord[]> => {
    try {
      const parsed: unknown = JSON.parse(await readFile(storePath, "utf8"));
      if (
        !isRecord(parsed) ||
        ![1, 2].includes(typeof parsed["schemaVersion"] === "number" ? parsed["schemaVersion"] : -1) ||
        !Array.isArray(parsed["projects"])
      )
        return [];
      return parsed["projects"].map((record) => validateRecord(record, organizationId));
    } catch (error) {
      if (hasErrorCode(error) && error.code === "ENOENT") return [];
      throw error;
    }
  };
  const writeAll = async (projects: readonly McpProjectRecord[]): Promise<void> => {
    await mkdir(path.dirname(storePath), { recursive: true });
    const temporaryPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify({ schemaVersion: 2, organizationId, projects }, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, storePath);
  };
  return Object.freeze({
    storePath,
    organizationId,
    async list() {
      return (await readAll()).map(clone).sort((left, right) => left.id.localeCompare(right.id));
    },
    async load(projectId: string) {
      const record = (await readAll()).find((item) => item.id === projectId);
      return record ? clone(record) : null;
    },
    async save(record: McpProjectRecord) {
      const normalized = clone(validateRecord(record, organizationId));
      const operation = writeQueue.then(async () => {
        const records = await readAll();
        const index = records.findIndex((item) => item.id === normalized.id);
        if (index >= 0) records[index] = normalized;
        else records.push(normalized);
        await writeAll(records);
        return clone(normalized);
      });
      writeQueue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  });
}
