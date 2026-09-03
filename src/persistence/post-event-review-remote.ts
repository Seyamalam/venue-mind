import type { PostEventPrediction, PostEventReview } from "../domain/post-event-review-types.ts";
import {
  isPostEventReview,
  isPostEventReviewAcknowledgement,
  isPostEventReviewOutboxCommand,
  type PostEventReviewAcknowledgement,
  type PostEventReviewOutboxCommand,
} from "./post-event-review-store.ts";

export interface CreatePostEventReviewInput {
  readonly runbookVersionId: string;
  readonly occupancyMonitorId: string;
  readonly incidentRegisterId: string;
  readonly deviationRegisterId: string;
  readonly scenarioRunIds: readonly string[];
  readonly predictions: readonly PostEventPrediction[];
}
export interface PostEventReviewExportArtifact {
  readonly filename: string;
  readonly mimeType: "application/json" | "text/plain";
  readonly content: string;
}
export interface PostEventReviewRemoteResult {
  readonly status?: "created" | "already-applied";
  readonly review: PostEventReview;
  readonly acknowledgements?: readonly PostEventReviewAcknowledgement[];
}
export interface PostEventReviewExportResult {
  readonly artifact: PostEventReviewExportArtifact;
}
interface PostEventReviewRemoteOptions {
  readonly fetchImpl?: typeof globalThis.fetch;
  readonly organizationId?: string;
}

export class PostEventReviewRemoteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: object;
  constructor(message: string, code: string, status: number, details: object) {
    super(message);
    this.name = "PostEventReviewRemoteError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const isArtifact = (value: unknown): value is PostEventReviewExportArtifact =>
  isRecord(value) &&
  isNonEmptyString(value["filename"]) &&
  (value["mimeType"] === "application/json" || value["mimeType"] === "text/plain") &&
  typeof value["content"] === "string";
const invalidResponse = (message: string): never => {
  throw new PostEventReviewRemoteError(message, "POST_EVENT_REVIEW_RESPONSE_INVALID", 502, {});
};
const decodeResult = (value: unknown): PostEventReviewRemoteResult => {
  if (!isRecord(value) || !isPostEventReview(value["review"]))
    return invalidResponse("Invalid Post-Event Review response");
  const acknowledgements = value["acknowledgements"];
  if (
    acknowledgements !== undefined &&
    (!Array.isArray(acknowledgements) || !acknowledgements.every(isPostEventReviewAcknowledgement))
  ) return invalidResponse("Invalid Post-Event Review acknowledgements");
  const status = value["status"];
  if (status !== undefined && status !== "created" && status !== "already-applied")
    return invalidResponse("Invalid Post-Event Review status");
  return {
    review: value["review"],
    ...(status !== undefined ? { status } : {}),
    ...(Array.isArray(acknowledgements) ? { acknowledgements } : {}),
  };
};
const decodeExport = (value: unknown): PostEventReviewExportResult => {
  if (!isRecord(value) || !isArtifact(value["artifact"]))
    return invalidResponse("Invalid Post-Event Review export response");
  return { artifact: value["artifact"] };
};
const errorDetails = (value: unknown): object => (isRecord(value) ? value : {});
const parse = async <Value>(response: Response, decoder: (value: unknown) => Value): Promise<Value> => {
  if (!(response.headers.get("content-type") ?? "").includes("application/json"))
    throw new PostEventReviewRemoteError(
      "Post-Event Review endpoint unavailable",
      "POST_EVENT_REVIEW_API_UNAVAILABLE",
      response.status,
      {},
    );
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PostEventReviewRemoteError("Invalid JSON response", "POST_EVENT_REVIEW_RESPONSE_INVALID", 502, {});
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
          : "Post-Event Review request failed";
  const code =
    typeof nested["code"] === "string"
      ? nested["code"]
      : typeof record["code"] === "string"
        ? record["code"]
        : "POST_EVENT_REVIEW_REQUEST_FAILED";
  throw new PostEventReviewRemoteError(
    message,
    code,
    response.status,
    errorDetails(nested["details"] ?? record["details"]),
  );
};
const requiredId = (value: string, label: string): string => {
  if (!value.trim()) throw new TypeError(`${label} is required`);
  return encodeURIComponent(value);
};
const assertCreateInput = (input: CreatePostEventReviewInput): void => {
  const ids = [
    ["Runbook Version ID", input.runbookVersionId],
    ["Occupancy Monitor ID", input.occupancyMonitorId],
    ["Incident Register ID", input.incidentRegisterId],
    ["Deviation Register ID", input.deviationRegisterId],
  ] as const;
  for (const [label, value] of ids) if (!isNonEmptyString(value)) throw new TypeError(`${label} is required`);
  if (
    !Array.isArray(input.scenarioRunIds) ||
    input.scenarioRunIds.length > 100 ||
    input.scenarioRunIds.some((id) => !isNonEmptyString(id)) ||
    new Set(input.scenarioRunIds).size !== input.scenarioRunIds.length
  )
    throw new TypeError("Scenario Run IDs must be non-empty strings");
  if (!Array.isArray(input.predictions) || input.predictions.length === 0 || input.predictions.length > 100)
    throw new TypeError("Predictions must contain between 1 and 100 items");
};
const wireCommand = (command: PostEventReviewOutboxCommand): object => {
  const common = {
    type: command.type,
    idempotencyKey: command.idempotencyKey,
    expectedRevision: command.expectedRevision,
    operationId: command.operationId,
  };
  if (command.type === "record_post_event_observation")
    return {
      ...common,
      observationId: command.observationId,
      predictionKey: command.predictionKey,
      value: command.value,
      confidence: command.confidence,
      evidenceRefs: command.evidenceRefs,
    };
  if (command.type === "record_post_event_lesson")
    return {
      ...common,
      lessonId: command.lessonId,
      comparisonKey: command.comparisonKey,
      lessonCode: command.lessonCode,
      findingCode: command.findingCode,
      recommendedActionCode: command.recommendedActionCode,
      requirementIds: command.requirementIds,
      constraintIds: command.constraintIds,
    };
  if (command.type === "create_template_improvement_proposal")
    return {
      ...common,
      proposalId: command.proposalId,
      goal: command.goal,
      target: command.target,
      changes: command.changes,
      changeLessonLinks: command.changeLessonLinks,
    };
  return {
    ...common,
    proposalId: command.proposalId,
    expectedProposalRevision: command.expectedProposalRevision,
    decision: command.decision,
    reasonCode: command.reasonCode,
  };
};

export function createPostEventReviewRemote({
  fetchImpl = globalThis.fetch.bind(globalThis),
  organizationId,
}: PostEventReviewRemoteOptions = {}) {
  if (!isNonEmptyString(organizationId)) throw new TypeError("Post-Event Review remote requires an Organization ID");
  const headers = (extra: HeadersInit = {}): Record<string, string> => {
    const result: Record<string, string> = {};
    new Headers(extra).forEach((value, name) => { result[name] = value; });
    result["accept"] = "application/json";
    result["x-venuemind-organization-id"] = organizationId;
    return result;
  };
  const collection = (projectId: string): string =>
    `/api/projects/${requiredId(projectId, "Project ID")}/post-event-reviews`;
  const item = (projectId: string, reviewId: string): string =>
    `${collection(projectId)}/${requiredId(reviewId, "Post-Event Review ID")}`;
  const request = (url: string, init: RequestInit = {}): Promise<Response> =>
    fetchImpl(url, { credentials: "same-origin", ...init, headers: headers(init.headers) });
  return Object.freeze({
    async create(projectId: string, input: CreatePostEventReviewInput) {
      assertCreateInput(input);
      return parse(
        await request(collection(projectId), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(input),
        }),
        decodeResult,
      );
    },
    async get(projectId: string, reviewId: string) {
      return parse(await request(item(projectId, reviewId)), decodeResult);
    },
    async sync(projectId: string, reviewId: string, commands: readonly PostEventReviewOutboxCommand[]) {
      if (!Array.isArray(commands) || !commands.every(isPostEventReviewOutboxCommand))
        throw new TypeError("Post-Event Review commands are invalid");
      return parse(
        await request(`${item(projectId, reviewId)}/commands:sync`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ commands: commands.map(wireCommand) }),
        }),
        decodeResult,
      );
    },
    async export(projectId: string, reviewId: string, format: "json" | "text") {
      if (format !== "json" && format !== "text") throw new TypeError("Post-Event Review export format is invalid");
      return parse(
        await request(`${item(projectId, reviewId)}/export?format=${format}`),
        decodeExport,
      );
    },
  });
}

export type PostEventReviewRemote = ReturnType<typeof createPostEventReviewRemote>;
