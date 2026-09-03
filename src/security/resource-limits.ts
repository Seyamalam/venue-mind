import { venueError } from "../domain/errors.ts";

export const VENUE_RESOURCE_LIMITS = Object.freeze({
  apiRequestBytes: 2_000_000,
  projectRecordBytes: 2_000_000,
  plannerCommandBytes: 262_144,
  plannerRestoreCommandBytes: 2_100_000,
  maximumJsonDepth: 64,
  maximumJsonNodes: 100_000,
  maximumArrayItems: 10_000,
  maximumObjectKeys: 1_000,
  projectObjects: 5_000,
  projectConstraints: 1_000,
  proposalChanges: 1_000,
  proposalBranches: 64,
  branchRevisions: 256,
  comments: 5_000,
  ledgerEntries: 50_000,
  commandReceipts: 50_000,
  scenarios: 256,
  scenarioRuns: 2_000,
  validationTimeMs: 5_000,
  simulationTimeMs: 15_000,
});

export interface JsonResourceBudget {
  readonly surface: string;
  readonly maximumBytes: number;
  readonly maximumDepth?: number;
  readonly maximumNodes?: number;
  readonly maximumArrayItems?: number;
  readonly maximumObjectKeys?: number;
  readonly errorCode?: "RESOURCE_LIMIT_EXCEEDED" | "TOOL_PAYLOAD_TOO_LARGE";
}

export interface JsonResourceMeasurement {
  readonly bytes: number;
  readonly depth: number;
  readonly nodes: number;
}

const fail = (
  surface: string,
  resource: "bytes" | "depth" | "nodes" | "array-items" | "object-keys" | "cyclic-reference",
  actual: number,
  maximum: number,
  errorCode: "RESOURCE_LIMIT_EXCEEDED" | "TOOL_PAYLOAD_TOO_LARGE",
): never => {
  throw venueError(
    errorCode,
    errorCode === "TOOL_PAYLOAD_TOO_LARGE"
      ? {
          surface,
          resource,
          direction: surface.endsWith("-output") ? "output" : "input",
          actualBytes: actual,
          maximumBytes: maximum,
        }
      : { surface, resource, actual, maximum },
  );
};

export const measureJsonResource = (
  value: unknown,
  {
    surface,
    maximumBytes,
    maximumDepth = VENUE_RESOURCE_LIMITS.maximumJsonDepth,
    maximumNodes = VENUE_RESOURCE_LIMITS.maximumJsonNodes,
    maximumArrayItems = VENUE_RESOURCE_LIMITS.maximumArrayItems,
    maximumObjectKeys = VENUE_RESOURCE_LIMITS.maximumObjectKeys,
    errorCode = "RESOURCE_LIMIT_EXCEEDED",
  }: JsonResourceBudget,
): JsonResourceMeasurement => {
  const pending: Array<Readonly<{ value: unknown; depth: number; exit: boolean }>> = [
    { value, depth: 0, exit: false },
  ];
  const active = new WeakSet<object>();
  let nodes = 0;
  let depth = 0;
  while (pending.length > 0) {
    const item = pending.pop();
    if (!item) break;
    if (item.exit) {
      if (typeof item.value === "object" && item.value !== null) active.delete(item.value);
      continue;
    }
    nodes += 1;
    if (nodes > maximumNodes) fail(surface, "nodes", nodes, maximumNodes, errorCode);
    depth = Math.max(depth, item.depth);
    if (item.depth > maximumDepth) fail(surface, "depth", item.depth, maximumDepth, errorCode);
    if (typeof item.value !== "object" || item.value === null) continue;
    if (active.has(item.value)) fail(surface, "cyclic-reference", 1, 0, errorCode);
    active.add(item.value);
    pending.push({ value: item.value, depth: item.depth, exit: true });
    if (Array.isArray(item.value)) {
      if (item.value.length > maximumArrayItems)
        fail(surface, "array-items", item.value.length, maximumArrayItems, errorCode);
      for (let index = item.value.length - 1; index >= 0; index -= 1)
        pending.push({ value: item.value[index], depth: item.depth + 1, exit: false });
      continue;
    }
    const entries = Object.entries(item.value);
    if (entries.length > maximumObjectKeys) fail(surface, "object-keys", entries.length, maximumObjectKeys, errorCode);
    for (let index = entries.length - 1; index >= 0; index -= 1)
      pending.push({ value: entries[index]?.[1], depth: item.depth + 1, exit: false });
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) fail(surface, "bytes", maximumBytes + 1, maximumBytes, errorCode);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  if (bytes > maximumBytes) fail(surface, "bytes", bytes, maximumBytes, errorCode);
  return Object.freeze({ bytes, depth, nodes });
};

export const assertCollectionLimit = (
  surface: string,
  resource: string,
  actual: number,
  maximum: number,
): void => {
  if (actual > maximum) throw venueError("RESOURCE_LIMIT_EXCEEDED", { surface, resource, actual, maximum });
};
