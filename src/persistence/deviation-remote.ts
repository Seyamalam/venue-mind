import type { VenueProposal } from "../domain/geometry.ts";
import type { LivePlanDeviationRegister } from "../domain/operational-types.ts";
import {
  isLivePlanDeviationRegister,
  type DeviationAcknowledgement,
  type DeviationOutboxCommand,
} from "./deviation-store.ts";

export interface DeviationExportArtifact {
  readonly filename: string;
  readonly mediaType: "application/json";
  readonly content: string;
  readonly fingerprint: string;
}
export interface DeviationRemoteResult {
  readonly status?: "created" | "already-applied";
  readonly register: LivePlanDeviationRegister;
  readonly acknowledgements?: readonly DeviationAcknowledgement[];
  readonly proposal?: VenueProposal;
}
export interface DeviationExportResult {
  readonly artifact: DeviationExportArtifact;
}
interface DeviationRemoteOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly organizationId?: string;
}
interface CreateDeviationRegisterInput {
  readonly runbookVersionId: string;
}

export class DeviationRemoteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: object;
  constructor(message: string, code: string, status: number, details: object) {
    super(message);
    this.name = "DeviationRemoteError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isAcknowledgement = (value: unknown): value is DeviationAcknowledgement =>
  isRecord(value) &&
  isNonEmptyString(value["idempotencyKey"]) &&
  (value["operationId"] === null || isNonEmptyString(value["operationId"])) &&
  (value["status"] === "applied" ||
    value["status"] === "already-applied" ||
    value["status"] === "conflict" ||
    value["status"] === "rejected") &&
  (value["code"] === undefined || typeof value["code"] === "string") &&
  (value["message"] === undefined || typeof value["message"] === "string") &&
  (value["details"] === undefined || isRecord(value["details"]));
const isProposal = (value: unknown): value is VenueProposal =>
  isRecord(value) &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["baseVersion"]) &&
  Number.isSafeInteger(value["revision"]) &&
  typeof value["status"] === "string" &&
  isNonEmptyString(value["goal"]) &&
  Array.isArray(value["changes"]) &&
  Array.isArray(value["waivers"]) &&
  (value["validation"] === null || isRecord(value["validation"]));
const isArtifact = (value: unknown): value is DeviationExportArtifact =>
  isRecord(value) &&
  isNonEmptyString(value["filename"]) &&
  value["mediaType"] === "application/json" &&
  typeof value["content"] === "string" &&
  isNonEmptyString(value["fingerprint"]);

const invalidResponse = (message: string): never => {
  throw new DeviationRemoteError(message, "DEVIATION_RESPONSE_INVALID", 502, {});
};
const decodeResult = (value: unknown): DeviationRemoteResult => {
  if (!isRecord(value) || !isLivePlanDeviationRegister(value["register"]))
    return invalidResponse("Invalid Live Plan Deviation response");
  const acknowledgements = value["acknowledgements"];
  if (acknowledgements !== undefined && (!Array.isArray(acknowledgements) || !acknowledgements.every(isAcknowledgement)))
    return invalidResponse("Invalid Live Plan Deviation acknowledgements");
  const proposal = value["proposal"];
  if (proposal !== undefined && !isProposal(proposal)) return invalidResponse("Invalid post-event Proposal response");
  const status = value["status"];
  if (status !== undefined && status !== "created" && status !== "already-applied")
    return invalidResponse("Invalid Live Plan Deviation status");
  return {
    register: value["register"],
    ...(status !== undefined ? { status } : {}),
    ...(Array.isArray(acknowledgements) ? { acknowledgements } : {}),
    ...(isProposal(proposal) ? { proposal } : {}),
  };
};
const decodeExport = (value: unknown): DeviationExportResult => {
  if (!isRecord(value) || !isArtifact(value["artifact"]))
    return invalidResponse("Invalid Live Plan Deviation export response");
  return { artifact: value["artifact"] };
};
const errorDetails = (value: unknown): object => (isRecord(value) ? value : {});
const parse = async <Value>(response: Response, decoder: (value: unknown) => Value): Promise<Value> => {
  if (!(response.headers.get("content-type") ?? "").includes("application/json"))
    throw new DeviationRemoteError(
      "Live Plan Deviation endpoint unavailable",
      "DEVIATION_API_UNAVAILABLE",
      response.status,
      {},
    );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new DeviationRemoteError("Invalid JSON response", "DEVIATION_RESPONSE_INVALID", 502, {});
  }
  if (response.ok) return decoder(payload);
  const record = isRecord(payload) ? payload : {};
  const nested = isRecord(record["error"]) ? record["error"] : {};
  const message =
    typeof nested["message"] === "string"
      ? nested["message"]
      : typeof record["error"] === "string"
        ? record["error"]
        : typeof record["message"] === "string"
          ? record["message"]
          : "Live Plan Deviation request failed";
  const code =
    typeof nested["code"] === "string"
      ? nested["code"]
      : typeof record["code"] === "string"
        ? record["code"]
        : "DEVIATION_REQUEST_FAILED";
  throw new DeviationRemoteError(message, code, response.status, errorDetails(nested["details"] ?? record["details"]));
};
const requiredId = (value: string, label: string): string => {
  if (!value.trim()) throw new TypeError(`${label} is required`);
  return encodeURIComponent(value);
};

export function createDeviationRemote({
  fetchImpl = globalThis.fetch.bind(globalThis),
  organizationId,
}: DeviationRemoteOptions = {}) {
  if (!isNonEmptyString(organizationId)) throw new TypeError("Deviation remote requires an Organization ID");
  const headers = (extra: HeadersInit = {}): Record<string, string> => {
    const result: Record<string, string> = {};
    new Headers(extra).forEach((value, name) => {
      result[name] = value;
    });
    result["accept"] = "application/json";
    result["x-venuemind-organization-id"] = organizationId;
    return result;
  };
  const collection = (projectId: string): string =>
    `/api/projects/${requiredId(projectId, "Project ID")}/deviation-registers`;
  const item = (projectId: string, registerId: string): string =>
    `${collection(projectId)}/${requiredId(registerId, "Deviation Register ID")}`;
  const request = (url: string, init: RequestInit = {}): Promise<Response> =>
    fetchImpl(url, { credentials: "same-origin", ...init, headers: headers(init.headers) });
  return Object.freeze({
    async create(projectId: string, input: CreateDeviationRegisterInput) {
      if (!isNonEmptyString(input.runbookVersionId)) throw new TypeError("Runbook Version ID is required");
      return parse(
        await request(collection(projectId), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
        decodeResult,
      );
    },
    async get(projectId: string, registerId: string) {
      return parse(await request(item(projectId, registerId)), decodeResult);
    },
    async sync(projectId: string, registerId: string, commands: readonly DeviationOutboxCommand[]) {
      return parse(
        await request(`${item(projectId, registerId)}/commands:sync`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commands }),
        }),
        decodeResult,
      );
    },
    async export(projectId: string, registerId: string) {
      return parse(await request(`${item(projectId, registerId)}/export`), decodeExport);
    },
  });
}

export type DeviationRemote = ReturnType<typeof createDeviationRemote>;
