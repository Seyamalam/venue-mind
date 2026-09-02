import type { IncidentAttachment, IncidentRegister, OperationalIncident } from "../domain/operational-types.ts";
import type { IncidentAcknowledgement, IncidentOutboxCommand } from "./incident-store.ts";

export interface IncidentExportArtifact {
  readonly filename: string;
  readonly mimeType: "application/json";
  readonly content: string;
}
export interface IncidentRemoteResult {
  readonly status?: "created" | "already-applied" | "attached";
  readonly register: IncidentRegister;
  readonly acknowledgements?: readonly IncidentAcknowledgement[];
  readonly incident?: OperationalIncident;
  readonly attachment?: IncidentAttachment;
}
export interface IncidentExportResult {
  readonly artifact: IncidentExportArtifact;
}
interface IncidentRemoteOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly organizationId?: string;
}
interface CreateIncidentRegisterInput {
  readonly runbookVersionId: string;
}

export class IncidentRemoteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: object;
  constructor(message: string, code: string, status: number, details: object) {
    super(message);
    this.name = "IncidentRemoteError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isIncidentRegister = (value: unknown): value is IncidentRegister =>
  isObject(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["runbookVersionId"] === "string" &&
  Array.isArray(value["incidents"]) &&
  Array.isArray(value["transitions"]) &&
  Array.isArray(value["receipts"]) &&
  Array.isArray(value["ledger"]) &&
  typeof value["revision"] === "number";
const isIncident = (value: unknown): value is OperationalIncident =>
  isObject(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["revision"] === "number" &&
  typeof value["status"] === "string" &&
  Array.isArray(value["attachments"]) &&
  Array.isArray(value["handoffs"]);
const isAttachment = (value: unknown): value is IncidentAttachment =>
  isObject(value) &&
  typeof value["id"] === "string" &&
  (value["kind"] === "photo" || value["kind"] === "document") &&
  typeof value["contentType"] === "string" &&
  typeof value["byteLength"] === "number" &&
  typeof value["sha256"] === "string";
const isAcknowledgement = (value: unknown): value is IncidentAcknowledgement =>
  isObject(value) &&
  typeof value["idempotencyKey"] === "string" &&
  (typeof value["operationId"] === "string" || value["operationId"] === null) &&
  ["applied", "already-applied", "conflict", "rejected"].includes(String(value["status"]));
const isArtifact = (value: unknown): value is IncidentExportArtifact =>
  isObject(value) &&
  typeof value["filename"] === "string" &&
  value["mimeType"] === "application/json" &&
  typeof value["content"] === "string";

const decodeResult = (value: unknown): IncidentRemoteResult => {
  if (!isObject(value) || !isIncidentRegister(value["register"]))
    throw new IncidentRemoteError("Invalid Incident response", "INCIDENT_RESPONSE_INVALID", 502, {});
  const acknowledgements = value["acknowledgements"];
  if (
    acknowledgements !== undefined &&
    (!Array.isArray(acknowledgements) || !acknowledgements.every(isAcknowledgement))
  )
    throw new IncidentRemoteError("Invalid Incident acknowledgements", "INCIDENT_RESPONSE_INVALID", 502, {});
  const incident = value["incident"];
  if (incident !== undefined && !isIncident(incident))
    throw new IncidentRemoteError("Invalid Incident payload", "INCIDENT_RESPONSE_INVALID", 502, {});
  const attachment = value["attachment"];
  if (attachment !== undefined && !isAttachment(attachment))
    throw new IncidentRemoteError("Invalid Incident attachment", "INCIDENT_RESPONSE_INVALID", 502, {});
  const status = value["status"];
  if (status !== undefined && status !== "created" && status !== "already-applied" && status !== "attached")
    throw new IncidentRemoteError("Invalid Incident status", "INCIDENT_RESPONSE_INVALID", 502, {});
  return {
    register: value["register"],
    ...(status !== undefined ? { status } : {}),
    ...(Array.isArray(acknowledgements) ? { acknowledgements } : {}),
    ...(isIncident(incident) ? { incident } : {}),
    ...(isAttachment(attachment) ? { attachment } : {}),
  };
};
const decodeExport = (value: unknown): IncidentExportResult => {
  if (!isObject(value) || !isArtifact(value["artifact"]))
    throw new IncidentRemoteError("Invalid Incident export response", "INCIDENT_RESPONSE_INVALID", 502, {});
  return { artifact: value["artifact"] };
};
const details = (value: unknown): object => (isObject(value) ? value : {});
const parse = async <T>(response: Response, decode: (value: unknown) => T): Promise<T> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json"))
    throw new IncidentRemoteError("Incident endpoint unavailable", "INCIDENT_API_UNAVAILABLE", response.status, {});
  const payload: unknown = await response.json();
  if (response.ok) return decode(payload);
  const record = isObject(payload) ? payload : {};
  const nested = isObject(record["error"]) ? record["error"] : {};
  const message =
    typeof nested["message"] === "string"
      ? nested["message"]
      : typeof record["error"] === "string"
        ? record["error"]
        : typeof record["message"] === "string"
          ? record["message"]
          : "Incident request failed";
  const code =
    typeof nested["code"] === "string"
      ? nested["code"]
      : typeof record["code"] === "string"
        ? record["code"]
        : "INCIDENT_REQUEST_FAILED";
  throw new IncidentRemoteError(message, code, response.status, details(nested["details"] ?? record["details"]));
};

const requiredId = (value: string, label: string) => {
  if (!value.trim()) throw new TypeError(`${label} is required`);
  return encodeURIComponent(value);
};

export function createIncidentRemote({
  fetchImpl = globalThis.fetch.bind(globalThis),
  organizationId,
}: IncidentRemoteOptions = {}) {
  if (typeof organizationId !== "string" || !organizationId.trim())
    throw new TypeError("Incident remote requires an Organization ID");
  const headers = (extra: HeadersInit = {}): Record<string, string> => {
    const result: Record<string, string> = {};
    new Headers(extra).forEach((value, name) => {
      result[name] = value;
    });
    result["accept"] = "application/json";
    result["x-venuemind-organization-id"] = organizationId;
    return result;
  };
  const collection = (projectId: string) => `/api/projects/${requiredId(projectId, "Project ID")}/incident-registers`;
  const item = (projectId: string, registerId: string) =>
    `${collection(projectId)}/${requiredId(registerId, "Incident Register ID")}`;
  const incident = (projectId: string, registerId: string, incidentId: string) =>
    `${item(projectId, registerId)}/incidents/${requiredId(incidentId, "Incident ID")}`;
  const request = (url: string, init: RequestInit = {}) =>
    fetchImpl(url, { credentials: "same-origin", ...init, headers: headers(init.headers) });
  return Object.freeze({
    async create(projectId: string, input: CreateIncidentRegisterInput) {
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
    async sync(projectId: string, registerId: string, commands: readonly IncidentOutboxCommand[]) {
      return parse(
        await request(`${item(projectId, registerId)}/commands:sync`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commands }),
        }),
        decodeResult,
      );
    },
    async export(projectId: string, registerId: string, incidentId: string) {
      return parse(await request(`${incident(projectId, registerId, incidentId)}/export`), decodeExport);
    },
    async attach(projectId: string, registerId: string, incidentId: string, file: Blob) {
      if (typeof Blob === "undefined" || !(file instanceof Blob))
        throw new TypeError("Incident attachment must be a File or Blob");
      const body = new FormData();
      const fileName = typeof File !== "undefined" && file instanceof File && file.name ? file.name : "evidence";
      body.append("file", file, fileName);
      return parse(
        await request(`${incident(projectId, registerId, incidentId)}/attachments`, { method: "POST", body }),
        decodeResult,
      );
    },
    async download(projectId: string, registerId: string, incidentId: string, attachmentId: string) {
      return request(
        `${incident(projectId, registerId, incidentId)}/attachments/${requiredId(attachmentId, "Attachment ID")}`,
      );
    },
  });
}

export type IncidentRemote = ReturnType<typeof createIncidentRemote>;
