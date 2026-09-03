import { stableFingerprint } from "../domain/activity-ledger.ts";
import { venueError } from "../domain/errors.ts";
import type {
  CreateTemplateImprovementProposalCommand,
  PostEventReview,
  RecordPostEventLessonCommand,
  RecordPostEventObservationCommand,
  ReviewTemplateImprovementProposalCommand,
} from "../domain/post-event-review-types.ts";

type PostEventMutationCommand =
  | RecordPostEventObservationCommand
  | RecordPostEventLessonCommand
  | CreateTemplateImprovementProposalCommand
  | ReviewTemplateImprovementProposalCommand;

export type PostEventReviewOutboxCommand = PostEventMutationCommand &
  Readonly<{
    operationId: string;
    correlationId: string;
    clientId: string;
    clientSequence: number;
    clientOccurredAt: string;
    deviceOccurredAt?: string;
    deviceId?: string;
    projectId?: string;
  }>;

export type PostEventReviewAcknowledgementStatus = "applied" | "already-applied" | "conflict" | "rejected";
export interface PostEventReviewAcknowledgement {
  readonly idempotencyKey: string;
  readonly operationId: string | null;
  readonly status: PostEventReviewAcknowledgementStatus;
  readonly code?: string;
  readonly message?: string;
  readonly details?: object;
}
export interface PostEventReviewOutboxEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly scopeKey: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly reviewId: string;
  readonly idempotencyKey: string;
  readonly inputFingerprint: string;
  readonly command: PostEventReviewOutboxCommand;
  readonly syncStatus: "pending" | "conflict" | "rejected";
  readonly attempts: number;
  readonly enqueuedAt: string;
  readonly lastAttemptAt: string | null;
  readonly lastResult: PostEventReviewAcknowledgement | null;
}

export interface StoredPostEventReview {
  readonly schemaVersion: 1;
  readonly scopeKey: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly reviewId: string;
  readonly review: unknown;
}
export interface PostEventReviewRecoveryEntry {
  readonly id: string;
  readonly schemaVersion: 1;
  readonly scopeKey: string;
  readonly code: "POST_EVENT_REVIEW_CACHE_INVALID";
  readonly quarantinedAt: string;
  readonly stored: StoredPostEventReview;
}
export interface PostEventReviewPersistenceAdapter {
  readonly kind?: string;
  getReview(scopeKey: string): Promise<StoredPostEventReview | null>;
  putReview(stored: StoredPostEventReview): Promise<StoredPostEventReview>;
  deleteReview(scopeKey: string): Promise<void>;
  listOutbox(scopeKey: string): Promise<PostEventReviewOutboxEntry[]>;
  putOutboxIfAbsent(
    entry: PostEventReviewOutboxEntry,
  ): Promise<{
    inserted: boolean;
    entry?: PostEventReviewOutboxEntry;
    sequenceConflict?: PostEventReviewOutboxEntry;
  }>;
  putOutbox(entry: PostEventReviewOutboxEntry): Promise<PostEventReviewOutboxEntry>;
  deleteOutbox(id: string): Promise<void>;
  putRecovery(entry: PostEventReviewRecoveryEntry): Promise<PostEventReviewRecoveryEntry>;
  listRecovery(scopeKey: string): Promise<PostEventReviewRecoveryEntry[]>;
  clear(scopeKey: string): Promise<void>;
}
interface MemoryPostEventReviewAdapterInitial {
  readonly reviews?: readonly StoredPostEventReview[];
  readonly outbox?: readonly PostEventReviewOutboxEntry[];
  readonly recovery?: readonly PostEventReviewRecoveryEntry[];
}
interface IndexedDbPostEventReviewAdapterOptions {
  readonly indexedDB?: IDBFactory | null;
  readonly databaseName?: string;
}
interface PostEventReviewStoreOptions extends IndexedDbPostEventReviewAdapterOptions {
  readonly organizationId?: string;
  readonly projectId?: string;
  readonly reviewId?: string;
  readonly adapter?: PostEventReviewPersistenceAdapter;
  readonly clock?: () => string;
}

const clone = <Value>(value: Value): Value => (value == null ? value : structuredClone(value));
const DEFAULT_DATABASE_NAME = "venuemind-post-event-reviews";
const DATABASE_VERSION = 1;
const REVIEW_STORE = "post-event-reviews";
const OUTBOX_STORE = "post-event-review-outbox";
const RECOVERY_STORE = "post-event-review-recovery";
const REMOVABLE_STATUSES: ReadonlySet<PostEventReviewAcknowledgementStatus> = new Set([
  "applied",
  "already-applied",
]);
const RETAINED_STATUSES: ReadonlySet<PostEventReviewOutboxEntry["syncStatus"]> = new Set([
  "conflict",
  "rejected",
]);
const scopeKey = (organizationId: string, projectId: string, reviewId: string): string =>
  [organizationId, projectId, reviewId].map(encodeURIComponent).join("::");
const outboxId = (scope: string, idempotencyKey: string): string =>
  `${scope}::${encodeURIComponent(idempotencyKey)}`;
const commandFingerprint = (command: PostEventReviewOutboxCommand): string =>
  stableFingerprint(
    "post-event-review-outbox-command",
    Object.fromEntries(
      Object.entries(command).filter(([key]) => !["correlationId", "idempotencyKey"].includes(key)),
    ),
  );
const compareOutbox = (left: PostEventReviewOutboxEntry, right: PostEventReviewOutboxEntry): number =>
  left.command.clientId.localeCompare(right.command.clientId) ||
  left.command.clientSequence - right.command.clientSequence ||
  left.idempotencyKey.localeCompare(right.idempotencyKey);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;
const isIsoInstant = (value: unknown): value is string => {
  if (!isNonEmptyString(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
};
const isNonNegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;
const isPositiveInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isNonEmptyString) && new Set(value).size === value.length;
const isRecordArray = (value: unknown): value is Record<string, unknown>[] =>
  Array.isArray(value) && value.every(isRecord);
const hasNonEmptyStringFields = (value: unknown, fields: readonly string[]): boolean =>
  isRecord(value) && fields.every((field) => isNonEmptyString(value[field]));
const isActorType = (value: unknown): value is "human" | "agent" | "system" =>
  value === "human" || value === "agent" || value === "system";
const isOperationalSource = (value: unknown): boolean =>
  value === "studio" || value === "webmcp" || value === "mcp" || value === "system" || value === "agent-tool";
const isEvidenceRef = (value: unknown): boolean =>
  isRecord(value) &&
  [
    "accepted-plan",
    "runbook",
    "occupancy-monitor",
    "occupancy-projection",
    "incident-register",
    "deviation-register",
    "scenario-run",
  ].includes(String(value["kind"])) &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["fingerprint"]);
const isActorEvidence = (value: unknown): boolean =>
  isRecord(value) &&
  isActorType(value["actorType"]) &&
  isNonEmptyString(value["actorId"]) &&
  isOperationalSource(value["source"]) &&
  isNonEmptyString(value["sessionId"]) &&
  isIsoInstant(value["occurredAt"]);
const isPrediction = (value: unknown): boolean =>
  isRecord(value) &&
  isNonEmptyString(value["key"]) &&
  ["occupancy", "queue", "flow", "incidents"].includes(String(value["family"])) &&
  isNonEmptyString(value["metric"]) &&
  isRecord(value["scope"]) &&
  ["venue", "occupancy-zone", "queue", "route", "incident-category"].includes(String(value["scope"]["kind"])) &&
  isNonEmptyString(value["scope"]["id"]) &&
  isFiniteNumber(value["value"]) &&
  ["persons", "ratio", "seconds", "index", "incidents"].includes(String(value["unit"])) &&
  ["lower", "higher", "target"].includes(String(value["betterWhen"])) &&
  isRecord(value["tolerance"]) &&
  isFiniteNumber(value["tolerance"]["absolute"]) &&
  isFiniteNumber(value["tolerance"]["relative"]) &&
  Array.isArray(value["evidenceRefs"]) &&
  value["evidenceRefs"].every(isEvidenceRef);
const isObservation = (value: unknown): boolean =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["predictionKey"]) &&
  ["occupancy", "queue", "flow", "incidents"].includes(String(value["family"])) &&
  isNonEmptyString(value["metric"]) &&
  isRecord(value["scope"]) &&
  isNonEmptyString(value["scope"]["id"]) &&
  (value["value"] === null || isFiniteNumber(value["value"])) &&
  ["persons", "ratio", "seconds", "index", "incidents"].includes(String(value["unit"])) &&
  ["measured", "estimated", "unavailable"].includes(String(value["confidence"])) &&
  Array.isArray(value["evidenceRefs"]) &&
  value["evidenceRefs"].every(isEvidenceRef) &&
  isActorEvidence(value["recorded"]);
const isLesson = (value: unknown): boolean =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["comparisonKey"]) &&
  ["occupancy", "queue", "flow", "incidents"].includes(String(value["family"])) &&
  isNonEmptyString(value["lessonCode"]) &&
  isNonEmptyString(value["findingCode"]) &&
  isNonEmptyString(value["recommendedActionCode"]) &&
  isStringArray(value["requirementIds"]) &&
  isStringArray(value["constraintIds"]) &&
  isActorEvidence(value["recorded"]);
const isTemplateProposal = (value: unknown): boolean =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isPositiveInteger(value["revision"]) &&
  ["pending-human-review", "approved-recommendation", "rejected"].includes(String(value["status"])) &&
  isRecord(value["target"]) &&
  (value["target"]["kind"] === "venue" || value["target"]["kind"] === "room") &&
  isNonEmptyString(value["target"]["templateId"]) &&
  isNonEmptyString(value["target"]["version"]) &&
  isRecord(value["proposal"]) &&
  isRecordArray(value["traces"]) &&
  isActorEvidence(value["created"]) &&
  (value["review"] === null || isActorEvidence(value["review"])) &&
  value["publicationStatus"] === "not-published";
const isReceipt = (value: unknown): boolean =>
  isRecord(value) &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["idempotencyKey"]) &&
  isNonEmptyString(value["inputFingerprint"]) &&
  ["record-observation", "record-lesson", "create-template-proposal", "review-template-proposal"].includes(
    String(value["operation"]),
  ) &&
  isNonEmptyString(value["subjectId"]) &&
  isPositiveInteger(value["aggregateRevision"]) &&
  isPositiveInteger(value["ledgerSequence"]) &&
  isIsoInstant(value["acceptedAt"]);
const isTransition = (value: unknown): boolean =>
  isRecord(value) &&
  isNonEmptyString(value["id"]) &&
  isPositiveInteger(value["sequence"]) &&
  [
    "post-event.observation-recorded",
    "post-event.lesson-recorded",
    "post-event.template-proposal-created",
    "post-event.template-proposal-reviewed",
  ].includes(String(value["type"])) &&
  isNonEmptyString(value["subjectId"]) &&
  isNonNegativeInteger(value["fromRevision"]) &&
  isPositiveInteger(value["toRevision"]) &&
  isActorEvidence(value["actor"]) &&
  isRecord(value["details"]) &&
  isNonEmptyString(value["resultingStateFingerprint"]) &&
  isNonEmptyString(value["receiptFingerprint"]);
const isLedgerEntry = (value: unknown): boolean =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isPositiveInteger(value["sequence"]) &&
  isNonEmptyString(value["transitionId"]) &&
  isNonEmptyString(value["subjectId"]) &&
  isActorEvidence(value["actor"]) &&
  isRecord(value["details"]) &&
  isNonEmptyString(value["resultingStateFingerprint"]) &&
  isNonEmptyString(value["receiptFingerprint"]) &&
  isNonEmptyString(value["previousHash"]) &&
  isNonEmptyString(value["hash"]);

const isPostEventReviewShape = (value: unknown): value is PostEventReview =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["projectId"]) &&
  isNonEmptyString(value["runbookVersionId"]) &&
  isRecord(value["source"]) &&
  isNonEmptyString(value["source"]["planId"]) &&
  (isNonEmptyString(value["source"]["planVersion"]) || isFiniteNumber(value["source"]["planVersion"])) &&
  hasNonEmptyStringFields(value["source"], [
    "planFingerprint",
    "runbookFingerprint",
    "runbookLedgerHeadHash",
    "occupancyMonitorFingerprint",
    "occupancyProjectionFingerprint",
    "occupancyLedgerHeadHash",
    "incidentRegisterFingerprint",
    "incidentLedgerHeadHash",
    "deviationRegisterFingerprint",
    "deviationLedgerHeadHash",
  ]) &&
  isRecord(value["source"]["scenarioRunFingerprints"]) &&
  Object.values(value["source"]["scenarioRunFingerprints"]).every(isNonEmptyString) &&
  isRecord(value["baseline"]) &&
  isRecord(value["baseline"]["runbook"]) &&
  isRecord(value["baseline"]["occupancyMonitor"]) &&
  isRecord(value["baseline"]["occupancyProjection"]) &&
  isRecord(value["baseline"]["incidentRegister"]) &&
  isRecord(value["baseline"]["deviationRegister"]) &&
  isRecordArray(value["baseline"]["scenarioRuns"]) &&
  isNonEmptyString(value["baseline"]["fingerprint"]) &&
  Array.isArray(value["predictions"]) &&
  value["predictions"].every(isPrediction) &&
  Array.isArray(value["observations"]) &&
  value["observations"].every(isObservation) &&
  Array.isArray(value["lessons"]) &&
  value["lessons"].every(isLesson) &&
  Array.isArray(value["templateProposals"]) &&
  value["templateProposals"].every(isTemplateProposal) &&
  Array.isArray(value["transitions"]) &&
  value["transitions"].every(isTransition) &&
  Array.isArray(value["receipts"]) &&
  value["receipts"].every(isReceipt) &&
  Array.isArray(value["ledger"]) &&
  value["ledger"].every(isLedgerEntry) &&
  isNonNegativeInteger(value["revision"]) &&
  isIsoInstant(value["createdAt"]) &&
  isNonEmptyString(value["createdBy"]) &&
  isIsoInstant(value["updatedAt"]);

export const isPostEventReview = (value: unknown): value is PostEventReview => {
  return isPostEventReviewShape(value);
};

export const isPostEventReviewAcknowledgement = (value: unknown): value is PostEventReviewAcknowledgement =>
  isRecord(value) &&
  isNonEmptyString(value["idempotencyKey"]) &&
  (value["operationId"] === null || isNonEmptyString(value["operationId"])) &&
  (value["status"] === "applied" ||
    value["status"] === "already-applied" ||
    value["status"] === "conflict" ||
    value["status"] === "rejected") &&
  (value["code"] === undefined || isNonEmptyString(value["code"])) &&
  (value["message"] === undefined || typeof value["message"] === "string") &&
  (value["details"] === undefined || isRecord(value["details"]));

export const isPostEventReviewOutboxCommand = (value: unknown): value is PostEventReviewOutboxCommand => {
  if (
    !isRecord(value) ||
    !isNonEmptyString(value["operationId"]) ||
    !isNonEmptyString(value["correlationId"]) ||
    !isNonEmptyString(value["clientId"]) ||
    !isPositiveInteger(value["clientSequence"]) ||
    !isIsoInstant(value["clientOccurredAt"]) ||
    !isNonEmptyString(value["idempotencyKey"]) ||
    !isNonNegativeInteger(value["expectedRevision"]) ||
    !isActorType(value["actorType"]) ||
    !isNonEmptyString(value["actorId"]) ||
    !isOperationalSource(value["source"]) ||
    !isNonEmptyString(value["sessionId"]) ||
    (value["committedAt"] !== undefined && !isIsoInstant(value["committedAt"])) ||
    (value["deviceOccurredAt"] !== undefined && !isIsoInstant(value["deviceOccurredAt"])) ||
    (value["deviceId"] !== undefined && !isNonEmptyString(value["deviceId"])) ||
    (value["projectId"] !== undefined && !isNonEmptyString(value["projectId"]))
  ) return false;
  if (value["type"] === "record_post_event_observation")
    return (
      isNonEmptyString(value["observationId"]) &&
      isNonEmptyString(value["predictionKey"]) &&
      (value["value"] === null || isFiniteNumber(value["value"])) &&
      (value["confidence"] === "measured" || value["confidence"] === "estimated" || value["confidence"] === "unavailable") &&
      Array.isArray(value["evidenceRefs"]) &&
      value["evidenceRefs"].every(isEvidenceRef)
    );
  if (value["type"] === "record_post_event_lesson")
    return (
      isNonEmptyString(value["lessonId"]) &&
      isNonEmptyString(value["comparisonKey"]) &&
      isNonEmptyString(value["lessonCode"]) &&
      isNonEmptyString(value["findingCode"]) &&
      isNonEmptyString(value["recommendedActionCode"]) &&
      isStringArray(value["requirementIds"]) &&
      isStringArray(value["constraintIds"])
    );
  if (value["type"] === "create_template_improvement_proposal")
    return (
      isNonEmptyString(value["proposalId"]) &&
      isNonEmptyString(value["goal"]) &&
      isRecord(value["target"]) &&
      (value["target"]["kind"] === "venue" || value["target"]["kind"] === "room") &&
      isNonEmptyString(value["target"]["templateId"]) &&
      isNonEmptyString(value["target"]["version"]) &&
      isRecordArray(value["changes"]) &&
      value["changes"].length > 0 &&
      isRecordArray(value["changeLessonLinks"]) &&
      value["changeLessonLinks"].every(
        (link) => isNonEmptyString(link["changeId"]) && isStringArray(link["lessonIds"]),
      )
    );
  return (
    value["type"] === "review_template_improvement_proposal" &&
    isNonEmptyString(value["proposalId"]) &&
    isPositiveInteger(value["expectedProposalRevision"]) &&
    (value["decision"] === "approved" || value["decision"] === "rejected") &&
    isNonEmptyString(value["reasonCode"])
  );
};

const isStoredReview = (value: unknown): value is StoredPostEventReview =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["scopeKey"]) &&
  isNonEmptyString(value["organizationId"]) &&
  isNonEmptyString(value["projectId"]) &&
  isNonEmptyString(value["reviewId"]) &&
  "review" in value;
const isOutboxEntry = (value: unknown): value is PostEventReviewOutboxEntry =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["scopeKey"]) &&
  isNonEmptyString(value["organizationId"]) &&
  isNonEmptyString(value["projectId"]) &&
  isNonEmptyString(value["reviewId"]) &&
  isNonEmptyString(value["idempotencyKey"]) &&
  isNonEmptyString(value["inputFingerprint"]) &&
  isPostEventReviewOutboxCommand(value["command"]) &&
  (value["syncStatus"] === "pending" || value["syncStatus"] === "conflict" || value["syncStatus"] === "rejected") &&
  isNonNegativeInteger(value["attempts"]) &&
  isIsoInstant(value["enqueuedAt"]) &&
  (value["lastAttemptAt"] === null || isIsoInstant(value["lastAttemptAt"])) &&
  (value["lastResult"] === null || isPostEventReviewAcknowledgement(value["lastResult"]));
const isRecovery = (value: unknown): value is PostEventReviewRecoveryEntry =>
  isRecord(value) &&
  value["schemaVersion"] === 1 &&
  isNonEmptyString(value["id"]) &&
  isNonEmptyString(value["scopeKey"]) &&
  value["code"] === "POST_EVENT_REVIEW_CACHE_INVALID" &&
  isIsoInstant(value["quarantinedAt"]) &&
  isStoredReview(value["stored"]);

const assertCommand = (command: PostEventReviewOutboxCommand, projectId: string): void => {
  if (!isPostEventReviewOutboxCommand(command))
    throw venueError("COMMAND_INVALID", { reason: "post-event-review-outbox-command-invalid" });
  if (command.projectId !== undefined && command.projectId !== projectId)
    throw venueError("COMMAND_INVALID", { reason: "post-event-review-command-project-mismatch" });
};
const assertReview = (review: PostEventReview, projectId: string, reviewId: string): void => {
  if (!isPostEventReview(review))
    throw venueError("COMMAND_INVALID", { reason: "post-event-review-cache-shape-invalid" });
  if (review.projectId !== projectId || review.id !== reviewId)
    throw venueError("COMMAND_INVALID", { reason: "post-event-review-cache-scope-invalid" });
};

export function createMemoryPostEventReviewPersistenceAdapter(
  initial: MemoryPostEventReviewAdapterInitial = {},
): PostEventReviewPersistenceAdapter {
  const reviews = new Map((initial.reviews ?? []).map((stored) => [stored.scopeKey, clone(stored)]));
  const outbox = new Map((initial.outbox ?? []).map((entry) => [entry.id, clone(entry)]));
  const recovery = new Map((initial.recovery ?? []).map((entry) => [entry.id, clone(entry)]));
  return Object.freeze({
    kind: "memory",
    async getReview(key: string) { return clone(reviews.get(key) ?? null); },
    async putReview(stored: StoredPostEventReview) {
      reviews.set(stored.scopeKey, clone(stored));
      return clone(stored);
    },
    async deleteReview(key: string) { reviews.delete(key); },
    async listOutbox(key: string) {
      return [...outbox.values()].filter((entry) => entry.scopeKey === key).map(clone);
    },
    async putOutboxIfAbsent(entry: PostEventReviewOutboxEntry) {
      const existing = outbox.get(entry.id);
      if (existing) return { inserted: false, entry: clone(existing) };
      const sequenceConflict = [...outbox.values()].find(
        (candidate) =>
          candidate.scopeKey === entry.scopeKey &&
          candidate.command.clientId === entry.command.clientId &&
          candidate.command.clientSequence === entry.command.clientSequence,
      );
      if (sequenceConflict) return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      outbox.set(entry.id, clone(entry));
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry: PostEventReviewOutboxEntry) {
      outbox.set(entry.id, clone(entry));
      return clone(entry);
    },
    async deleteOutbox(id: string) { outbox.delete(id); },
    async putRecovery(entry: PostEventReviewRecoveryEntry) {
      recovery.set(entry.id, clone(entry));
      return clone(entry);
    },
    async listRecovery(key: string) {
      return [...recovery.values()].filter((entry) => entry.scopeKey === key).map(clone);
    },
    async clear(key: string) {
      reviews.delete(key);
      for (const [id, entry] of outbox) if (entry.scopeKey === key) outbox.delete(id);
    },
  });
}

const requestUnknown = (request: IDBRequest): Promise<unknown> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
const readOptional = async <Value>(
  request: IDBRequest,
  guard: (value: unknown) => value is Value,
  label: string,
): Promise<Value | undefined> => {
  const value = await requestUnknown(request);
  if (value === undefined) return undefined;
  if (!guard(value)) throw venueError("COMMAND_INVALID", { reason: `${label}-invalid` });
  return value;
};
const readArray = async <Value>(
  request: IDBRequest,
  guard: (value: unknown) => value is Value,
  label: string,
): Promise<Value[]> => {
  const value = await requestUnknown(request);
  if (!Array.isArray(value) || !value.every(guard))
    throw venueError("COMMAND_INVALID", { reason: `${label}-invalid` });
  return value;
};
const transactionDone = (transaction: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });

export function createIndexedDbPostEventReviewPersistenceAdapter({
  indexedDB: indexedDBImpl = globalThis.indexedDB,
  databaseName = DEFAULT_DATABASE_NAME,
}: IndexedDbPostEventReviewAdapterOptions = {}): PostEventReviewPersistenceAdapter {
  if (!indexedDBImpl?.open) throw new TypeError("IndexedDB is unavailable");
  let databasePromise: Promise<IDBDatabase> | null = null;
  const database = (): Promise<IDBDatabase> => {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDBImpl.open(databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(REVIEW_STORE))
          database.createObjectStore(REVIEW_STORE, { keyPath: "scopeKey" });
        if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
          const store = database.createObjectStore(OUTBOX_STORE, { keyPath: "id" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
          store.createIndex("clientSequence", ["scopeKey", "command.clientId", "command.clientSequence"], {
            unique: true,
          });
        }
        if (!database.objectStoreNames.contains(RECOVERY_STORE)) {
          const store = database.createObjectStore(RECOVERY_STORE, { keyPath: "id" });
          store.createIndex("scopeKey", "scopeKey", { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
    });
    return databasePromise;
  };
  return Object.freeze({
    kind: "indexeddb",
    async getReview(key: string) {
      const transaction = (await database()).transaction(REVIEW_STORE, "readonly");
      return clone((await readOptional(transaction.objectStore(REVIEW_STORE).get(key), isStoredReview, "post-event-review")) ?? null);
    },
    async putReview(stored: StoredPostEventReview) {
      const transaction = (await database()).transaction(REVIEW_STORE, "readwrite");
      transaction.objectStore(REVIEW_STORE).put(clone(stored));
      await transactionDone(transaction);
      return clone(stored);
    },
    async deleteReview(key: string) {
      const transaction = (await database()).transaction(REVIEW_STORE, "readwrite");
      transaction.objectStore(REVIEW_STORE).delete(key);
      await transactionDone(transaction);
    },
    async listOutbox(key: string) {
      const transaction = (await database()).transaction(OUTBOX_STORE, "readonly");
      return clone(await readArray(transaction.objectStore(OUTBOX_STORE).index("scopeKey").getAll(key), isOutboxEntry, "post-event-review-outbox"));
    },
    async putOutboxIfAbsent(entry: PostEventReviewOutboxEntry) {
      const transaction = (await database()).transaction(OUTBOX_STORE, "readwrite");
      const store = transaction.objectStore(OUTBOX_STORE);
      const existing = await readOptional(store.get(entry.id), isOutboxEntry, "post-event-review-outbox-entry");
      if (existing) {
        await transactionDone(transaction);
        return { inserted: false, entry: clone(existing) };
      }
      const sequenceConflict = await readOptional(
        store.index("clientSequence").get([entry.scopeKey, entry.command.clientId, entry.command.clientSequence]),
        isOutboxEntry,
        "post-event-review-outbox-entry",
      );
      if (sequenceConflict) {
        await transactionDone(transaction);
        return { inserted: false, sequenceConflict: clone(sequenceConflict) };
      }
      store.add(clone(entry));
      await transactionDone(transaction);
      return { inserted: true, entry: clone(entry) };
    },
    async putOutbox(entry: PostEventReviewOutboxEntry) {
      const transaction = (await database()).transaction(OUTBOX_STORE, "readwrite");
      transaction.objectStore(OUTBOX_STORE).put(clone(entry));
      await transactionDone(transaction);
      return clone(entry);
    },
    async deleteOutbox(id: string) {
      const transaction = (await database()).transaction(OUTBOX_STORE, "readwrite");
      transaction.objectStore(OUTBOX_STORE).delete(id);
      await transactionDone(transaction);
    },
    async putRecovery(entry: PostEventReviewRecoveryEntry) {
      const transaction = (await database()).transaction(RECOVERY_STORE, "readwrite");
      transaction.objectStore(RECOVERY_STORE).put(clone(entry));
      await transactionDone(transaction);
      return clone(entry);
    },
    async listRecovery(key: string) {
      const transaction = (await database()).transaction(RECOVERY_STORE, "readonly");
      return clone(await readArray(transaction.objectStore(RECOVERY_STORE).index("scopeKey").getAll(key), isRecovery, "post-event-review-recovery"));
    },
    async clear(key: string) {
      const transaction = (await database()).transaction([REVIEW_STORE, OUTBOX_STORE], "readwrite");
      transaction.objectStore(REVIEW_STORE).delete(key);
      const store = transaction.objectStore(OUTBOX_STORE);
      const entries = await readArray(store.index("scopeKey").getAll(key), isOutboxEntry, "post-event-review-outbox");
      for (const entry of entries) store.delete(entry.id);
      await transactionDone(transaction);
    },
  });
}

const defaultAdapter = (options: IndexedDbPostEventReviewAdapterOptions): PostEventReviewPersistenceAdapter => {
  try {
    return createIndexedDbPostEventReviewPersistenceAdapter(options);
  } catch {
    return createMemoryPostEventReviewPersistenceAdapter();
  }
};

export function createPostEventReviewStore({
  organizationId,
  projectId,
  reviewId,
  adapter,
  indexedDB,
  databaseName,
  clock = () => new Date().toISOString(),
}: PostEventReviewStoreOptions = {}) {
  if (!isNonEmptyString(organizationId) || !isNonEmptyString(projectId) || !isNonEmptyString(reviewId))
    throw new TypeError("Post-event review store requires Organization, Project, and Review IDs");
  const persistence = adapter ?? defaultAdapter({
    ...(indexedDB !== undefined ? { indexedDB } : {}),
    ...(databaseName !== undefined ? { databaseName } : {}),
  });
  const key = scopeKey(organizationId, projectId, reviewId);
  const listOutbox = async (): Promise<PostEventReviewOutboxEntry[]> =>
    (await persistence.listOutbox(key)).sort(compareOutbox);
  const persistReview = async (review: PostEventReview, authoritative: boolean): Promise<PostEventReview> => {
    assertReview(review, projectId, reviewId);
    const current = await persistence.getReview(key);
    if (!authoritative && current && isPostEventReview(current.review) && current.review.revision > review.revision)
      return clone(current.review);
    await persistence.putReview({
      schemaVersion: 1,
      scopeKey: key,
      organizationId,
      projectId,
      reviewId,
      review: clone(review),
    });
    return clone(review);
  };
  return Object.freeze({
    persistenceKind: persistence.kind ?? "custom",
    async hydrate() {
      const [stored, outbox] = await Promise.all([persistence.getReview(key), listOutbox()]);
      if (!stored) return { source: "local" as const, review: null, outbox, recovery: null };
      if (!isPostEventReview(stored.review) || stored.review.projectId !== projectId || stored.review.id !== reviewId) {
        const quarantinedAt = clock();
        const recovery: PostEventReviewRecoveryEntry = {
          id: `${key}::${encodeURIComponent(quarantinedAt)}`,
          schemaVersion: 1,
          scopeKey: key,
          code: "POST_EVENT_REVIEW_CACHE_INVALID",
          quarantinedAt,
          stored: clone(stored),
        };
        await persistence.putRecovery(recovery);
        await persistence.deleteReview(key);
        return {
          source: "local" as const,
          review: null,
          outbox,
          recovery: { id: recovery.id, code: recovery.code, quarantinedAt },
        };
      }
      return { source: "local" as const, review: clone(stored.review), outbox, recovery: null };
    },
    async saveReview(review: PostEventReview, options: { readonly authoritative?: boolean } = {}) {
      return persistReview(review, options.authoritative === true);
    },
    async enqueue(command: PostEventReviewOutboxCommand) {
      assertCommand(command, projectId);
      const normalized = clone(command);
      const inputFingerprint = commandFingerprint(normalized);
      const entry: PostEventReviewOutboxEntry = {
        id: outboxId(key, normalized.idempotencyKey),
        schemaVersion: 1,
        scopeKey: key,
        organizationId,
        projectId,
        reviewId,
        idempotencyKey: normalized.idempotencyKey,
        inputFingerprint,
        command: normalized,
        syncStatus: "pending",
        attempts: 0,
        enqueuedAt: clock(),
        lastAttemptAt: null,
        lastResult: null,
      };
      const stored = await persistence.putOutboxIfAbsent(entry);
      if (stored.sequenceConflict)
        throw venueError("COMMAND_INVALID", {
          reason: "post-event-review-client-sequence-conflict",
          clientId: normalized.clientId,
          clientSequence: normalized.clientSequence,
          existingIdempotencyKey: stored.sequenceConflict.idempotencyKey,
        });
      if (!stored.inserted && stored.entry) {
        if (stored.entry.inputFingerprint !== inputFingerprint)
          throw venueError("IDEMPOTENCY_KEY_CONFLICT", {
            idempotencyKey: normalized.idempotencyKey,
            commandType: normalized.type,
          });
        return clone(stored.entry);
      }
      return clone(entry);
    },
    async listOutbox() { return listOutbox(); },
    async markAttempted(idempotencyKeys: readonly string[]) {
      const requested = new Set(idempotencyKeys);
      const attemptedAt = clock();
      const updated: PostEventReviewOutboxEntry[] = [];
      for (const entry of await listOutbox()) {
        if (!requested.has(entry.idempotencyKey)) continue;
        const next = { ...entry, attempts: entry.attempts + 1, lastAttemptAt: attemptedAt };
        await persistence.putOutbox(next);
        updated.push(clone(next));
      }
      return updated;
    },
    async acknowledge(acknowledgements: readonly PostEventReviewAcknowledgement[]) {
      const entries = await listOutbox();
      const byKey = new Map(entries.map((entry) => [entry.idempotencyKey, entry]));
      const summary: { removed: string[]; retained: string[]; ignored: (string | null)[] } = {
        removed: [], retained: [], ignored: [],
      };
      for (const acknowledgement of acknowledgements) {
        if (!isPostEventReviewAcknowledgement(acknowledgement)) {
          summary.ignored.push(null);
          continue;
        }
        const entry = byKey.get(acknowledgement.idempotencyKey);
        if (!entry) {
          summary.ignored.push(acknowledgement.idempotencyKey);
          continue;
        }
        if (REMOVABLE_STATUSES.has(acknowledgement.status)) {
          await persistence.deleteOutbox(entry.id);
          summary.removed.push(entry.idempotencyKey);
          continue;
        }
        if (acknowledgement.status !== "conflict" && acknowledgement.status !== "rejected") {
          summary.ignored.push(entry.idempotencyKey);
          continue;
        }
        await persistence.putOutbox({
          ...entry,
          syncStatus: acknowledgement.status,
          lastResult: clone(acknowledgement),
        });
        summary.retained.push(entry.idempotencyKey);
      }
      return summary;
    },
    async discardConflicts() {
      const removed: string[] = [];
      for (const entry of await listOutbox()) {
        if (!RETAINED_STATUSES.has(entry.syncStatus)) continue;
        await persistence.deleteOutbox(entry.id);
        removed.push(entry.idempotencyKey);
      }
      return removed;
    },
    async clear() { await persistence.clear(key); },
  });
}

export type PostEventReviewStore = ReturnType<typeof createPostEventReviewStore>;
