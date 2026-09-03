import { stableFingerprint } from "../src/domain/activity-ledger.ts";
import { verifyPostEventReviewLedger } from "../src/domain/post-event-review.ts";
import type { PostEventReview } from "../src/domain/post-event-review-types.ts";
import { applyDatabaseMigrations } from "./database-migrations.ts";

const initialized = new WeakSet<object>();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isPostEventReview = (value: unknown): value is PostEventReview =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  typeof value["id"] === "string" &&
  typeof value["projectId"] === "string" &&
  typeof value["runbookVersionId"] === "string" &&
  isRecord(value["source"]) &&
  isRecord(value["baseline"]) &&
  Array.isArray(value["predictions"]) &&
  Array.isArray(value["observations"]) &&
  Array.isArray(value["lessons"]) &&
  Array.isArray(value["templateProposals"]) &&
  Array.isArray(value["transitions"]) &&
  Array.isArray(value["receipts"]) &&
  Array.isArray(value["ledger"]) &&
  typeof value["revision"] === "number" &&
  typeof value["createdAt"] === "string" &&
  typeof value["updatedAt"] === "string";
const parse = (value: unknown): PostEventReview => {
  if (typeof value !== "string") throw new TypeError("Stored Post-event Review must be JSON text");
  const parsed: unknown = parseJson(value);
  if (!isPostEventReview(parsed)) throw new TypeError("Stored Post-event Review is invalid");
  return parsed;
};
const undefinedMarker = Object.freeze({ __venuemind_storage_type__: "undefined" });
const json = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) => item === undefined ? undefinedMarker : item);
const restoreUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(restoreUndefined);
  if (!isRecord(value)) return value;
  if (Object.keys(value).length === 1 && value["__venuemind_storage_type__"] === "undefined") return undefined;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, restoreUndefined(item)]));
};
const parseJson = (value: string): unknown => {
  const parsed: unknown = JSON.parse(value);
  return restoreUndefined(parsed);
};
const ledgerHeadHash = (review: PostEventReview): string => {
  const value = review.ledger.at(-1)?.hash ?? review.source.deviationLedgerHeadHash;
  if (!value) throw new TypeError("Post-event Review ledger head hash is required");
  return value;
};
const definitionFingerprint = (review: PostEventReview): string =>
  stableFingerprint("post-event-definition", {
    source: review.source,
    baselineFingerprint: review.baseline.fingerprint,
    predictions: review.predictions,
  });

async function ready(db: D1Database) {
  if (initialized.has(db)) return;
  await applyDatabaseMigrations(db);
  initialized.add(db);
}

export class PostEventReviewConflict extends Error {
  readonly code:
    | "POST_EVENT_REVIEW_ID_CONFLICT"
    | "POST_EVENT_REVIEW_REVISION_CONFLICT"
    | "POST_EVENT_REVIEW_BASELINE_IMMUTABLE"
    | "POST_EVENT_REVIEW_SCOPE_INVALID"
    | "POST_EVENT_REVIEW_INTEGRITY_FAILED";
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: PostEventReviewConflict["code"], details: Readonly<Record<string, unknown>> = {}) {
    super(
      code === "POST_EVENT_REVIEW_ID_CONFLICT"
        ? "Post-event Review conflicts with the stored Runbook baseline"
        : code === "POST_EVENT_REVIEW_SCOPE_INVALID"
          ? "Post-event Review Project scope is invalid"
          : code === "POST_EVENT_REVIEW_INTEGRITY_FAILED"
            ? "Post-event Review integrity verification failed"
            : code === "POST_EVENT_REVIEW_BASELINE_IMMUTABLE"
              ? "Post-event Review baseline is immutable"
              : "Post-event Review revision conflict",
    );
    this.name = "PostEventReviewConflict";
    this.code = code;
    this.details = details;
  }
}

const assertIntegrity = (review: PostEventReview, row?: Readonly<Record<string, unknown>>): PostEventReview => {
  const integrity = verifyPostEventReviewLedger(review);
  const rowMismatch = row !== undefined &&
    (review.id !== row["id"] ||
      review.projectId !== row["project_id"] ||
      review.runbookVersionId !== row["runbook_id"] ||
      review.schemaVersion !== Number(row["schema_version"]) ||
      definitionFingerprint(review) !== row["definition_fingerprint"] ||
      review.revision !== Number(row["revision"]) ||
      ledgerHeadHash(review) !== row["ledger_head_hash"] ||
      review.createdAt !== row["created_at"] ||
      review.updatedAt !== row["updated_at"]);
  if (integrity.status !== "pass" || rowMismatch)
    throw new PostEventReviewConflict("POST_EVENT_REVIEW_INTEGRITY_FAILED", {
      reviewId: review.id,
      reason: integrity.status === "pass" ? "row-review-mismatch" : "ledger-verification-failed",
      sequence: integrity.sequence,
    });
  return review;
};

const map = (row: Record<string, unknown> | null): PostEventReview | null => {
  if (!row) return null;
  const review = parse(row["review_json"]);
  if (typeof row["baseline_json"] !== "string")
    throw new TypeError("Stored Post-event Review baseline must be JSON text");
  const baselineValue: unknown = parseJson(row["baseline_json"]);
  if (!isRecord(baselineValue)) throw new TypeError("Stored Post-event Review baseline must be an object");
  if (json(review.baseline) !== json(baselineValue) || review.baseline.fingerprint !== row["baseline_fingerprint"])
    throw new PostEventReviewConflict("POST_EVENT_REVIEW_BASELINE_IMMUTABLE", { reviewId: review.id });
  return assertIntegrity(review, row);
};
const changed = (result: unknown): number => {
  if (!isRecord(result)) return 0;
  const meta = isRecord(result["meta"]) ? result["meta"] : null;
  const changes = meta?.["changes"] ?? result["changes"];
  return typeof changes === "number" ? changes : 0;
};

export function createD1PostEventReviewRepository(db: D1Database) {
  const get = async (organizationId: string, projectId: string, reviewId: string) => {
    await ready(db);
    return map(await db.prepare(
      "SELECT id,project_id,runbook_id,schema_version,baseline_fingerprint,definition_fingerprint,baseline_json,review_json,revision,ledger_head_hash,created_at,updated_at FROM post_event_reviews WHERE id=? AND organization_id=? AND project_id=?",
    ).bind(reviewId, organizationId, projectId).first<Record<string, unknown>>());
  };
  const getByRunbook = async (organizationId: string, projectId: string, runbookId: string) => {
    await ready(db);
    return map(await db.prepare(
      "SELECT id,project_id,runbook_id,schema_version,baseline_fingerprint,definition_fingerprint,baseline_json,review_json,revision,ledger_head_hash,created_at,updated_at FROM post_event_reviews WHERE runbook_id=? AND organization_id=? AND project_id=?",
    ).bind(runbookId, organizationId, projectId).first<Record<string, unknown>>());
  };
  return Object.freeze({
    async create(organizationId: string, projectId: string, review: PostEventReview) {
      await ready(db);
      if (review.projectId !== projectId)
        throw new PostEventReviewConflict("POST_EVENT_REVIEW_SCOPE_INVALID", {
          projectId,
          reviewProjectId: review.projectId,
        });
      assertIntegrity(review);
      try {
        await db.prepare(
          "INSERT INTO post_event_reviews (id,organization_id,project_id,runbook_id,schema_version,baseline_fingerprint,definition_fingerprint,baseline_json,review_json,revision,ledger_head_hash,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ).bind(
          review.id,
          organizationId,
          projectId,
          review.runbookVersionId,
          review.schemaVersion,
          review.baseline.fingerprint,
          definitionFingerprint(review),
          json(review.baseline),
          json(review),
          review.revision,
          ledgerHeadHash(review),
          review.createdAt,
          review.updatedAt,
        ).run();
        return review;
      } catch (cause) {
        const existing = (await get(organizationId, projectId, review.id)) ??
          (await getByRunbook(organizationId, projectId, review.runbookVersionId));
        if (
          existing &&
          existing.id === review.id &&
          existing.runbookVersionId === review.runbookVersionId &&
          existing.baseline.fingerprint === review.baseline.fingerprint &&
          definitionFingerprint(existing) === definitionFingerprint(review)
        ) return existing;
        if (existing)
          throw new PostEventReviewConflict("POST_EVENT_REVIEW_ID_CONFLICT", {
            reviewId: review.id,
            runbookVersionId: review.runbookVersionId,
          });
        throw cause;
      }
    },
    get,
    getByRunbook,
    async put(organizationId: string, projectId: string, review: PostEventReview, expectedRevision: number) {
      await ready(db);
      if (review.projectId !== projectId)
        throw new PostEventReviewConflict("POST_EVENT_REVIEW_SCOPE_INVALID", {
          projectId,
          reviewProjectId: review.projectId,
        });
      const current = await get(organizationId, projectId, review.id);
      if (
        current &&
        (current.runbookVersionId !== review.runbookVersionId ||
          current.schemaVersion !== review.schemaVersion ||
          current.createdAt !== review.createdAt ||
          json(current.source) !== json(review.source) ||
          json(current.baseline) !== json(review.baseline) ||
          json(current.predictions) !== json(review.predictions))
      ) throw new PostEventReviewConflict("POST_EVENT_REVIEW_BASELINE_IMMUTABLE", { reviewId: review.id });
      assertIntegrity(review);
      const result = await db.prepare(
        "UPDATE post_event_reviews SET review_json=?,revision=?,ledger_head_hash=?,updated_at=? WHERE id=? AND organization_id=? AND project_id=? AND revision=?",
      ).bind(
        json(review),
        review.revision,
        ledgerHeadHash(review),
        review.updatedAt,
        review.id,
        organizationId,
        projectId,
        expectedRevision,
      ).run();
      if (changed(result) === 0)
        throw new PostEventReviewConflict("POST_EVENT_REVIEW_REVISION_CONFLICT", {
          expectedRevision,
          currentRevision: (await get(organizationId, projectId, review.id))?.revision ?? null,
        });
      return review;
    },
  });
}

export type D1PostEventReviewRepository = ReturnType<typeof createD1PostEventReviewRepository>;
