import type { EventDayRunbook } from "../domain/operational-types.ts";
import type { RunbookAcknowledgement, RunbookOutboxCommand } from "./runbook-store.ts";

export interface RunbookRemoteResult {
  readonly runbook: EventDayRunbook;
  readonly acknowledgements?: readonly RunbookAcknowledgement[];
  readonly results?: readonly RunbookAcknowledgement[];
}
interface RunbookRemoteOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly organizationId?: string;
}

class RunbookRemoteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: object;
  constructor(message: string, code: string, status: number, details: object) {
    super(message);
    this.name = "RunbookRemoteError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isRunbook = (value: unknown): value is EventDayRunbook =>
  isObject(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["versionId"] === "string" &&
  Array.isArray(value["phases"]) &&
  Array.isArray(value["tasks"]) &&
  Array.isArray(value["ledger"]);
const isAcknowledgement = (value: unknown): value is RunbookAcknowledgement =>
  isObject(value) &&
  typeof value["idempotencyKey"] === "string" &&
  ["applied", "already-applied", "conflict", "rejected"].includes(String(value["status"]));

const decodeResult = (value: unknown): RunbookRemoteResult => {
  if (!isObject(value) || !isRunbook(value["runbook"]))
    throw new RunbookRemoteError("Invalid Runbook response", "RUNBOOK_RESPONSE_INVALID", 502, {});
  const acknowledgementsValue = value["acknowledgements"];
  const resultsValue = value["results"];
  if (
    acknowledgementsValue !== undefined &&
    (!Array.isArray(acknowledgementsValue) || !acknowledgementsValue.every(isAcknowledgement))
  )
    throw new RunbookRemoteError("Invalid Runbook acknowledgements", "RUNBOOK_RESPONSE_INVALID", 502, {});
  if (resultsValue !== undefined && (!Array.isArray(resultsValue) || !resultsValue.every(isAcknowledgement)))
    throw new RunbookRemoteError("Invalid Runbook results", "RUNBOOK_RESPONSE_INVALID", 502, {});
  return {
    runbook: value["runbook"],
    ...(Array.isArray(acknowledgementsValue) ? { acknowledgements: acknowledgementsValue } : {}),
    ...(Array.isArray(resultsValue) ? { results: resultsValue } : {}),
  };
};

const errorDetails = (value: unknown): object => (isObject(value) ? value : {});
const json = async (response: Response): Promise<RunbookRemoteResult> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    throw new RunbookRemoteError("Runbook endpoint unavailable", "RUNBOOK_API_UNAVAILABLE", response.status, {});
  const payload: unknown = await response.json();
  if (response.ok) return decodeResult(payload);
  const record = isObject(payload) ? payload : {};
  const nested = isObject(record["error"]) ? record["error"] : {};
  const message =
    typeof nested["message"] === "string"
      ? nested["message"]
      : typeof record["error"] === "string"
        ? record["error"]
        : "Runbook request failed";
  const code =
    typeof nested["code"] === "string"
      ? nested["code"]
      : typeof record["code"] === "string"
        ? record["code"]
        : "RUNBOOK_REQUEST_FAILED";
  throw new RunbookRemoteError(message, code, response.status, errorDetails(nested["details"] ?? record["details"]));
};

export function createRunbookRemote({
  fetchImpl = globalThis.fetch.bind(globalThis),
  organizationId,
}: RunbookRemoteOptions = {}) {
  if (typeof organizationId !== "string" || !organizationId.trim())
    throw new TypeError("Runbook remote requires an Organization ID");
  const headers = (extra: HeadersInit = {}): Record<string, string> => {
    const result: Record<string, string> = {};
    new Headers(extra).forEach((value, name) => {
      result[name] = value;
    });
    result["accept"] = "application/json";
    result["x-venuemind-organization-id"] = organizationId;
    return result;
  };
  const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/runbooks`;

  return Object.freeze({
    async create(projectId: string, runbook: EventDayRunbook) {
      return json(
        await fetchImpl(base(projectId), {
          method: "POST",
          credentials: "same-origin",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({ runbook }),
        }),
      );
    },
    async get(projectId: string, runbookVersionId: string) {
      return json(
        await fetchImpl(`${base(projectId)}/${encodeURIComponent(runbookVersionId)}`, {
          credentials: "same-origin",
          headers: headers(),
        }),
      );
    },
    async sync(projectId: string, runbookVersionId: string, commands: readonly RunbookOutboxCommand[]) {
      return json(
        await fetchImpl(`${base(projectId)}/${encodeURIComponent(runbookVersionId)}/transitions:sync`, {
          method: "POST",
          credentials: "same-origin",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({ commands }),
        }),
      );
    },
  });
}

export type RunbookRemote = ReturnType<typeof createRunbookRemote>;
