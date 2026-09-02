import type { LiveOccupancyMonitor, OccupancyAuditArtifact, OccupancyProjection } from "../domain/operational-types.ts";
import type { OccupancyAcknowledgement, OccupancyOutboxCommand } from "./occupancy-store.ts";

export interface OccupancyRemoteResult {
  readonly status?: "created" | "already-applied";
  readonly monitor: LiveOccupancyMonitor;
  readonly projection: OccupancyProjection;
  readonly acknowledgements?: readonly OccupancyAcknowledgement[];
}
export interface OccupancyRemoteExportResult {
  readonly artifact: OccupancyAuditArtifact;
}
interface OccupancyRemoteOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly organizationId?: string;
}
interface CreateOccupancyInput {
  readonly runbookVersionId: string;
}

export class OccupancyRemoteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: object;
  constructor(message: string, code: string, status: number, details: object) {
    super(message);
    this.name = "OccupancyRemoteError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isMonitor = (value: unknown): value is LiveOccupancyMonitor =>
  isObject(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["runbookVersionId"] === "string" &&
  isObject(value["source"]) &&
  isObject(value["baseline"]) &&
  isObject(value["policy"]) &&
  Array.isArray(value["feeds"]) &&
  Array.isArray(value["observations"]) &&
  Array.isArray(value["activeAlerts"]) &&
  Array.isArray(value["receipts"]) &&
  Array.isArray(value["ledger"]) &&
  typeof value["revision"] === "number" &&
  typeof value["createdAt"] === "string" &&
  typeof value["updatedAt"] === "string";
const isProjection = (value: unknown): value is OccupancyProjection =>
  isObject(value) &&
  typeof value["monitorId"] === "string" &&
  typeof value["runbookVersionId"] === "string" &&
  typeof value["evaluatedAt"] === "string" &&
  ["unavailable", "nominal", "warning", "exceeded", "conflicting", "stale"].includes(String(value["overallStatus"])) &&
  Array.isArray(value["sources"]) &&
  Array.isArray(value["scopes"]) &&
  Array.isArray(value["alerts"]) &&
  isObject(value["privacy"]) &&
  value["privacy"]["mode"] === "aggregate-only";
const isAcknowledgement = (value: unknown): value is OccupancyAcknowledgement =>
  isObject(value) &&
  typeof value["idempotencyKey"] === "string" &&
  (typeof value["operationId"] === "string" || value["operationId"] === null) &&
  ["applied", "already-applied", "conflict", "rejected"].includes(String(value["status"]));
const isArtifact = (value: unknown): value is OccupancyAuditArtifact =>
  isObject(value) &&
  typeof value["filename"] === "string" &&
  value["mimeType"] === "application/json" &&
  typeof value["content"] === "string";
const decodeResult = (value: unknown): OccupancyRemoteResult => {
  if (!isObject(value) || !isMonitor(value["monitor"]) || !isProjection(value["projection"]))
    throw new OccupancyRemoteError("Invalid Live Occupancy response", "OCCUPANCY_RESPONSE_INVALID", 502, {});
  const acknowledgements = value["acknowledgements"];
  if (
    acknowledgements !== undefined &&
    (!Array.isArray(acknowledgements) || !acknowledgements.every(isAcknowledgement))
  )
    throw new OccupancyRemoteError("Invalid Live Occupancy acknowledgements", "OCCUPANCY_RESPONSE_INVALID", 502, {});
  const status = value["status"];
  if (status !== undefined && status !== "created" && status !== "already-applied")
    throw new OccupancyRemoteError("Invalid Live Occupancy status", "OCCUPANCY_RESPONSE_INVALID", 502, {});
  return {
    monitor: value["monitor"],
    projection: value["projection"],
    ...(status !== undefined ? { status } : {}),
    ...(Array.isArray(acknowledgements) ? { acknowledgements } : {}),
  };
};
const decodeExport = (value: unknown): OccupancyRemoteExportResult => {
  if (!isObject(value) || !isArtifact(value["artifact"]))
    throw new OccupancyRemoteError("Invalid Live Occupancy export response", "OCCUPANCY_RESPONSE_INVALID", 502, {});
  return { artifact: value["artifact"] };
};
const details = (value: unknown): object => (isObject(value) ? value : {});
const parse = async <T>(response: Response, decode: (value: unknown) => T): Promise<T> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    throw new OccupancyRemoteError(
      "Live Occupancy endpoint unavailable",
      "OCCUPANCY_API_UNAVAILABLE",
      response.status,
      {},
    );
  const payload: unknown = await response.json();
  if (response.ok) return decode(payload);
  const record = isObject(payload) ? payload : {};
  const nested = isObject(record["error"]) ? record["error"] : {};
  const message =
    typeof nested["message"] === "string"
      ? nested["message"]
      : typeof record["error"] === "string"
        ? record["error"]
        : "Live Occupancy request failed";
  const code =
    typeof nested["code"] === "string"
      ? nested["code"]
      : typeof record["code"] === "string"
        ? record["code"]
        : "OCCUPANCY_REQUEST_FAILED";
  throw new OccupancyRemoteError(message, code, response.status, details(nested["details"] ?? record["details"]));
};

export function createOccupancyRemote({
  fetchImpl = globalThis.fetch.bind(globalThis),
  organizationId,
}: OccupancyRemoteOptions = {}) {
  if (typeof organizationId !== "string" || !organizationId.trim())
    throw new TypeError("Live Occupancy remote requires an Organization ID");
  const headers = (extra: HeadersInit = {}): Record<string, string> => {
    const result: Record<string, string> = {};
    new Headers(extra).forEach((value, name) => {
      result[name] = value;
    });
    result["accept"] = "application/json";
    result["x-venuemind-organization-id"] = organizationId;
    return result;
  };
  const collection = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/occupancy-monitors`;
  const item = (projectId: string, monitorId: string) => `${collection(projectId)}/${encodeURIComponent(monitorId)}`;
  const request = (url: string, init: RequestInit = {}) =>
    fetchImpl(url, { credentials: "same-origin", ...init, headers: headers(init.headers) });
  return Object.freeze({
    async create(projectId: string, input: CreateOccupancyInput) {
      return parse(
        await request(collection(projectId), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
        decodeResult,
      );
    },
    async get(projectId: string, monitorId: string) {
      return parse(await request(item(projectId, monitorId)), decodeResult);
    },
    async sync(projectId: string, monitorId: string, commands: readonly OccupancyOutboxCommand[]) {
      return parse(
        await request(`${item(projectId, monitorId)}/commands:sync`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commands }),
        }),
        decodeResult,
      );
    },
    async export(projectId: string, monitorId: string) {
      return parse(await request(`${item(projectId, monitorId)}/export`), decodeExport);
    },
  });
}

export type OccupancyRemote = ReturnType<typeof createOccupancyRemote>;
