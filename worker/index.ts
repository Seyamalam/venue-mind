import { createD1AccountRepository, isOrganizationAdministrator } from "./account-repository.ts";
import { createStaticIdentityProvider, type IdentityProvider } from "./authentication.ts";
import { createD1ProjectRepository, ProjectRevisionConflict, type ProjectRecord } from "./project-repository.ts";
import { parseProjectEtag, projectEtag } from "../src/domain/project-concurrency.ts";
import { stableFingerprint } from "../src/domain/activity-ledger.ts";
import { collaborationEventPayload, projectCollaborationEventTypes } from "../src/domain/collaboration-events.ts";
import { createD1CollaborationRepository, createMemoryCollaborationRepository } from "./collaboration-repository.ts";
import { createD1SharingRepository, createMemorySharingRepository } from "./sharing-repository.ts";
import { drainNotificationEmail } from "./email-delivery.ts";
import {
  createShareToken,
  hashShareToken,
  safeNotification,
  shareLinkStatus,
  SHARE_SCOPES,
} from "../src/domain/sharing.ts";
import type { NotificationEventType, NotificationRefs, ShareScope } from "../src/domain/sharing.ts";
import { createVenuePlanner } from "../src/domain/venue-planner.ts";
import type { PlannerCommand } from "../src/domain/venue-planner.ts";
import { transitionRunbookTask } from "../src/domain/event-day-runbook.ts";
import { createAuthenticatedIdentity, ORGANIZATION_ROLES } from "../src/domain/accounts.ts";
import type { OrganizationRole } from "../src/domain/accounts.ts";
import {
  createD1RunbookRepository,
  RunbookClientSequenceConflict,
  RunbookIdempotencyConflict,
  RunbookTransitionConflict,
} from "./runbook-repository.ts";
import {
  browserCommandToPersistenceInput,
  browserRunbookToPersistenceInput,
  repositoryRunbookToBrowserSnapshot,
} from "./runbook-http.ts";
import { createD1OccupancyRepository, OccupancyMonitorConflict } from "./occupancy-repository.ts";
import {
  acknowledgeOccupancyAlert,
  createLiveOccupancyMonitor,
  evaluateLiveOccupancy,
  exportLiveOccupancyAudit,
  ingestOccupancySignal,
  refreshLiveOccupancy,
} from "../src/domain/live-occupancy.ts";
import { createIncidentCommandBus } from "../src/domain/incident-command-bus.ts";
import { createD1IncidentRepository, IncidentRegisterConflict } from "./incident-repository.ts";
import { createDeviationCommandBus } from "../src/domain/deviation-command-bus.ts";
import { createD1DeviationRepository, DeviationRegisterConflict } from "./deviation-repository.ts";
import { createD1DataProtectionRepository, DataProtectionConflict } from "./data-protection-repository.ts";
import { safeLogRecord } from "../src/security/data-protection.ts";
import {
  decodeDeviationCreateBody,
  decodeDeviationMutationCommand,
  decodeDeviationSyncBody,
} from "./deviation-http.ts";
import { createPostEventReviewCommandBus } from "../src/domain/post-event-review-command-bus.ts";
import { evaluateLiveOccupancy as evaluateFrozenPostEventOccupancy } from "../src/domain/live-occupancy.ts";
import {
  createD1PostEventReviewRepository,
  PostEventReviewConflict,
} from "./post-event-review-repository.ts";
import {
  decodePostEventReviewCreateBody,
  decodePostEventReviewMutationCommand,
  decodePostEventReviewSyncBody,
} from "./post-event-review-http.ts";
import { venueError } from "../src/domain/errors.ts";
import {
  measureJsonResource,
  VENUE_RATE_LIMIT_WINDOW_SECONDS,
  VENUE_RESOURCE_LIMITS,
} from "../src/security/resource-limits.ts";
import {
  createD1RateLimitRepository,
  createMemoryRateLimitRepository,
  type RateLimitRepository,
} from "./rate-limit-repository.ts";
import { createRateLimitService, mutationEndpointFamily } from "./rate-limit-service.ts";
import { isLocalProjectRecord } from "../src/domain/project-types.ts";
import {
  createStructuredLogSink,
  createTelemetryFanout,
  isSafeCorrelationId,
  safeCorrelationId,
  startTelemetrySpan,
  telemetryErrorCode,
  type TelemetryEvent,
  type TelemetrySink,
} from "../src/observability/telemetry.ts";
import {
  createD1ObservabilityRepository,
  createMemoryObservabilityRepository,
  type ObservabilityRepository,
} from "./observability-repository.ts";
import { inspectDatabaseIntegrity } from "./database-migrations.ts";
import type {
  AggregateOccupancySignal,
  IncidentCategory,
  IncidentCommand,
  IncidentLocationInput,
  IncidentMutationResult,
  IncidentOwner,
  IncidentRegister,
  IncidentRelatedRef,
  IncidentSeverity,
  IncidentStatus,
  DeviationMutationResult,
  LivePlanDeviationRegister,
  LiveOccupancyMonitor,
  OccupancyMutationCommand,
  OccupancyPolicy,
  OccupancySimulationBaseline,
} from "../src/domain/operational-types.ts";
import type { PostEventReview, PostEventReviewMutationResult } from "../src/domain/post-event-review-types.ts";

export { createD1AccountRepository, createMemoryAccountRepository } from "./account-repository.ts";
export { createStaticIdentityProvider } from "./authentication.ts";
export { applyDatabaseMigrations, inspectDatabaseIntegrity, planDatabaseMigrations } from "./database-migrations.ts";
export { createD1CollaborationRepository, createMemoryCollaborationRepository } from "./collaboration-repository.ts";
export { createD1SharingRepository, createMemorySharingRepository } from "./sharing-repository.ts";
export { drainNotificationEmail } from "./email-delivery.ts";
export { createD1RunbookRepository } from "./runbook-repository.ts";
export { createD1OccupancyRepository } from "./occupancy-repository.ts";
export { createD1IncidentRepository } from "./incident-repository.ts";
export { createD1DeviationRepository } from "./deviation-repository.ts";
export { createD1PostEventReviewRepository } from "./post-event-review-repository.ts";
export { createD1RateLimitRepository, createMemoryRateLimitRepository } from "./rate-limit-repository.ts";
export { createD1DataProtectionRepository, DataProtectionConflict } from "./data-protection-repository.ts";
export { createD1ObservabilityRepository, createMemoryObservabilityRepository } from "./observability-repository.ts";

type ProjectRepository = ReturnType<typeof createD1ProjectRepository>;
type AccountRepository = ReturnType<typeof createD1AccountRepository>;
type CollaborationRepository = ReturnType<typeof createD1CollaborationRepository>;
type SharingRepository = ReturnType<typeof createD1SharingRepository>;
type RunbookRepository = ReturnType<typeof createD1RunbookRepository>;
type OccupancyRepository = ReturnType<typeof createD1OccupancyRepository>;
type IncidentRepository = ReturnType<typeof createD1IncidentRepository>;
type DeviationRepository = ReturnType<typeof createD1DeviationRepository>;
type PostEventReviewRepository = ReturnType<typeof createD1PostEventReviewRepository>;
type DataProtectionRepository = ReturnType<typeof createD1DataProtectionRepository>;
type EmailDelivery = {
  send: (message: {
    idempotencyKey: string;
    to: string;
    bodyCode: string;
    refs: NotificationRefs;
  }) => Promise<{ delivered: boolean; providerMessageId?: string }>;
};
type WorkerEnv = CloudflareEnv & { EMAIL_DELIVERY?: EmailDelivery };
type WorkerOptions = {
  createProjectRepository?: (db: D1Database) => ProjectRepository;
  createAccountRepository?: (db: D1Database) => AccountRepository;
  createCollaborationRepository?: (db: D1Database) => CollaborationRepository;
  createSharingRepository?: (db: D1Database) => SharingRepository;
  createRunbookRepository?: (db: D1Database) => RunbookRepository;
  createOccupancyRepository?: (db: D1Database) => OccupancyRepository;
  createIncidentRepository?: (db: D1Database) => IncidentRepository;
  createDeviationRepository?: (db: D1Database) => DeviationRepository;
  createPostEventReviewRepository?: (db: D1Database) => PostEventReviewRepository;
  createRateLimitRepository?: (db: D1Database) => RateLimitRepository;
  createDataProtectionRepository?: (db: D1Database) => DataProtectionRepository;
  createObservabilityRepository?: (db: D1Database, scopeHash: string) => ObservabilityRepository;
  telemetrySink?: TelemetrySink;
  integrityInspector?: (db: D1Database) => Promise<Readonly<{ status: string }>>;
  identityProvider?: IdentityProvider;
  emailDelivery?: EmailDelivery;
  secureCookies?: boolean;
  clock?: () => string;
  log?: (record: Readonly<Record<string, string | number | boolean | null>>) => void;
};

const SESSION_COOKIE = "venuemind_session";
const DEMO_IDENTITY_COOKIE = "venuemind_demo_identity";
const RUNBOOK_WRITE_ROLES: readonly OrganizationRole[] = [
  "planner",
  "venue-administrator",
  "organization-administrator",
];
const INCIDENT_WRITE_ROLES: readonly OrganizationRole[] = [
  "planner",
  "safety-officer",
  "venue-administrator",
  "organization-administrator",
];
const INCIDENT_EXPORT_ROLES: readonly OrganizationRole[] = [
  "reviewer",
  "approver",
  "safety-officer",
  "venue-administrator",
  "organization-administrator",
];
const DEVIATION_WRITE_ROLES: readonly OrganizationRole[] = [
  "planner",
  "safety-officer",
  "venue-administrator",
  "organization-administrator",
];
const DEVIATION_PROPOSAL_ROLES: readonly OrganizationRole[] = [
  "planner",
  "venue-administrator",
  "organization-administrator",
];
const DEVIATION_EXPORT_ROLES: readonly OrganizationRole[] = [
  "planner",
  "reviewer",
  "approver",
  "safety-officer",
  "venue-administrator",
  "organization-administrator",
];
const POST_EVENT_WRITE_ROLES: readonly OrganizationRole[] = [
  "planner",
  "safety-officer",
  "venue-administrator",
  "organization-administrator",
];
const POST_EVENT_PROPOSAL_ROLES: readonly OrganizationRole[] = [
  "planner",
  "venue-administrator",
  "organization-administrator",
];
const POST_EVENT_REVIEW_ROLES: readonly OrganizationRole[] = [
  "approver",
  "venue-administrator",
  "organization-administrator",
];
const POST_EVENT_EXPORT_ROLES: readonly OrganizationRole[] = [
  "planner",
  "reviewer",
  "approver",
  "safety-officer",
  "venue-administrator",
  "organization-administrator",
];
const SHARE_MANAGEMENT_ROLES: readonly OrganizationRole[] = ["venue-administrator", "organization-administrator"];
const hasRole = (available: readonly OrganizationRole[], required: readonly OrganizationRole[]): boolean =>
  required.some((role) => available.includes(role));
const isOrganizationRole = (value: unknown): value is OrganizationRole =>
  typeof value === "string" && ORGANIZATION_ROLES.some((role) => role === value);
const isShareScope = (value: unknown): value is ShareScope => SHARE_SCOPES.some((scope) => scope === value);
const json = (value: unknown, init: ResponseInit = {}) => {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  new Headers(init.headers).forEach((headerValue, headerName) => headers.set(headerName, headerValue));
  return new Response(JSON.stringify(value), { ...init, headers });
};
const apiError = (status: number, code: string, message: string, details?: unknown, headers?: HeadersInit) =>
  json(
    { error: message, code, ...(details === undefined ? {} : { details }) },
    { status, ...(headers === undefined ? {} : { headers }) },
  );
const projectIdFrom = (pathname: string) => decodeURIComponent(pathname.slice("/api/projects/".length));
const pathCapture = (match: RegExpMatchArray, index: number): string => {
  const value = match[index];
  if (value === undefined) throw new TypeError("Route capture is missing");
  return decodeURIComponent(value);
};
const cookieValue = (request: Request, name: string) =>
  request.headers
    .get("cookie")
    ?.split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
    ?.slice(name.length + 1) ?? null;
const sessionCookie = (id: string, secure: boolean) =>
  `${SESSION_COOKIE}=${encodeURIComponent(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure ? "; Secure" : ""}`;
const clearedSessionCookie = (secure: boolean) =>
  `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
const anonymousDemoIdentity = (request: Request, secure: boolean) => {
  const suppliedSubject = cookieValue(request, DEMO_IDENTITY_COOKIE);
  const subject =
    suppliedSubject && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(suppliedSubject)
      ? suppliedSubject
      : crypto.randomUUID();
  return {
    identity: createAuthenticatedIdentity({
      provider: "anonymous-demo",
      subject,
      email: `demo+${subject}@venuemind.invalid`,
      displayName: "Guest Planner",
    }),
    cookie:
      suppliedSubject === subject
        ? null
        : `${DEMO_IDENTITY_COOKIE}=${subject}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure ? "; Secure" : ""}`,
  };
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const parsedRequestBodies = new WeakMap<Request, Promise<unknown>>();
const readBody = async (request: Request): Promise<unknown> => {
  const cached = parsedRequestBodies.get(request);
  if (cached) return cached;
  const pending = (async () => {
    const maximum = VENUE_RESOURCE_LIMITS.apiRequestBytes;
    const declaredBytes = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declaredBytes) && declaredBytes > maximum)
      throw venueError("RESOURCE_LIMIT_EXCEEDED", {
        surface: "api-request",
        resource: "bytes",
        actual: Math.min(Math.floor(declaredBytes), Number.MAX_SAFE_INTEGER),
        maximum,
      });
    const text = await request.text();
    const bytes = new TextEncoder().encode(text).byteLength;
    if (bytes > maximum)
      throw venueError("RESOURCE_LIMIT_EXCEEDED", {
        surface: "api-request",
        resource: "bytes",
        actual: bytes,
        maximum,
      });
    const parsed: unknown = JSON.parse(text);
    measureJsonResource(parsed, {
      surface: "api-request",
      maximumBytes: maximum,
      maximumDepth: VENUE_RESOURCE_LIMITS.maximumJsonDepth,
      maximumNodes: VENUE_RESOURCE_LIMITS.maximumJsonNodes,
      maximumArrayItems: VENUE_RESOURCE_LIMITS.maximumArrayItems,
      maximumObjectKeys: VENUE_RESOURCE_LIMITS.maximumObjectKeys,
    });
    return parsed;
  })();
  parsedRequestBodies.set(request, pending);
  return pending;
};
const readObjectBody = async (request: Request): Promise<Record<string, unknown>> => {
  const body = await readBody(request);
  if (!isRecord(body)) throw new TypeError("JSON body must be an object");
  return body;
};
const hasExactKeys = (value: Record<string, unknown>, expected: readonly string[]): boolean => {
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === [...expected].sort()[index]);
};
const errorInfo = (cause: unknown): { code?: string; message?: string; details?: unknown } => {
  if (!isRecord(cause)) return cause instanceof Error ? { message: cause.message } : {};
  return {
    ...(typeof cause.code === "string" ? { code: cause.code } : {}),
    ...(typeof cause.message === "string" ? { message: cause.message } : {}),
    ...(cause.details === undefined ? {} : { details: cause.details }),
  };
};
const safeResourceLimitDetails = (value: unknown) => {
  if (!isRecord(value)) return undefined;
  const resources = ["bytes", "depth", "nodes", "array-items", "object-keys"] as const;
  const resource = resources.find((candidate) => candidate === value.resource);
  const actual = value.actual;
  const maximum = value.maximum;
  if (
    value.surface !== "api-request" ||
    resource === undefined ||
    typeof actual !== "number" ||
    !Number.isSafeInteger(actual) ||
    actual < 0 ||
    typeof maximum !== "number" ||
    !Number.isSafeInteger(maximum) ||
    maximum < 0
  )
    return undefined;
  return { surface: "api-request", resource, actual, maximum };
};
const requestBodyError = (cause: unknown): Response => {
  const error = errorInfo(cause);
  if (error.code === "RESOURCE_LIMIT_EXCEEDED")
    return apiError(
      413,
      "RESOURCE_LIMIT_EXCEEDED",
      "API request resource limit exceeded",
      safeResourceLimitDetails(error.details),
    );
  return apiError(400, "INVALID_JSON", "Invalid JSON body");
};
const dataProtectionError = (cause: unknown): Response | null => {
  if (!(cause instanceof DataProtectionConflict)) return null;
  const status = cause.code.includes("NOT_FOUND") ? 404
    : cause.code.includes("REVISION") || cause.code.includes("ALREADY") || cause.code.includes("WINDOW") || cause.code.includes("CONFLICT") || cause.code.includes("RECOVERABLE") || cause.code.includes("PURGEABLE") || cause.code.includes("ACTIVE")
      ? 409
      : 400;
  return apiError(status, cause.code, cause.code.toLowerCase().replaceAll("_", " "), cause.details);
};
const occupancySimulation = (value: unknown): OccupancySimulationBaseline | null => {
  if (value == null) return null;
  if (
    !isRecord(value) ||
    typeof value.runId !== "string" ||
    typeof value.planFingerprint !== "string" ||
    !Array.isArray(value.expectedPeakByScope)
  ) {
    throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "simulation-shape-invalid" });
  }
  const expectedPeakByScope = value.expectedPeakByScope.map((item) => {
    if (!isRecord(item) || typeof item.scopeId !== "string" || typeof item.count !== "number")
      throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "simulation-scope-invalid" });
    return { scopeId: item.scopeId, count: item.count };
  });
  return { runId: value.runId, planFingerprint: value.planFingerprint, expectedPeakByScope };
};
const occupancyPolicy = (value: unknown): Partial<OccupancyPolicy> | undefined => {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "policy-shape-invalid" });
  const numeric = (key: keyof OccupancyPolicy): number | undefined => {
    const candidate = value[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate !== "number" || !Number.isFinite(candidate))
      throw venueError("OCCUPANCY_BASELINE_INVALID", { reason: "policy-value-invalid", field: key });
    return candidate;
  };
  const freshAfterSeconds = numeric("freshAfterSeconds");
  const staleAfterSeconds = numeric("staleAfterSeconds");
  const warningRatio = numeric("warningRatio");
  const conflictTolerancePersons = numeric("conflictTolerancePersons");
  const conflictToleranceRatio = numeric("conflictToleranceRatio");
  return {
    ...(freshAfterSeconds === undefined ? {} : { freshAfterSeconds }),
    ...(staleAfterSeconds === undefined ? {} : { staleAfterSeconds }),
    ...(warningRatio === undefined ? {} : { warningRatio }),
    ...(conflictTolerancePersons === undefined ? {} : { conflictTolerancePersons }),
    ...(conflictToleranceRatio === undefined ? {} : { conflictToleranceRatio }),
  };
};
const occupancySignal = (value: unknown): AggregateOccupancySignal => {
  if (
    !isRecord(value) ||
    typeof value.sourceId !== "string" ||
    (value.sourceType !== "registration" && value.sourceType !== "sensor" && value.sourceType !== "manual-counter") ||
    typeof value.sourceVersion !== "string" ||
    (value.kind !== "check-in" && value.kind !== "zone-occupancy") ||
    typeof value.observedAt !== "string" ||
    (value.confidence !== "low" && value.confidence !== "medium" && value.confidence !== "high") ||
    !Array.isArray(value.readings)
  )
    throw venueError("OCCUPANCY_SIGNAL_INVALID", { reason: "signal-shape-invalid" });
  const readings = value.readings.map((item) => {
    if (!isRecord(item) || typeof item.scopeId !== "string" || typeof item.count !== "number")
      throw venueError("OCCUPANCY_SIGNAL_INVALID", { reason: "reading-shape-invalid" });
    return { scopeId: item.scopeId, count: item.count };
  });
  return {
    sourceId: value.sourceId,
    sourceType: value.sourceType,
    sourceVersion: value.sourceVersion,
    kind: value.kind,
    observedAt: value.observedAt,
    confidence: value.confidence,
    readings,
  };
};
const occupancyMutationCommand = (
  value: Record<string, unknown>,
  actorId: string,
  sessionId: string,
  committedAt: string,
): OccupancyMutationCommand => {
  if (
    typeof value.expectedRevision !== "number" ||
    !Number.isSafeInteger(value.expectedRevision) ||
    typeof value.idempotencyKey !== "string"
  ) {
    throw venueError("OCCUPANCY_SIGNAL_INVALID", { reason: "command-context-invalid" });
  }
  const context = {
    expectedRevision: value.expectedRevision,
    idempotencyKey: value.idempotencyKey,
    actorType: "human" as const,
    actorId,
    source: "studio" as const,
    sessionId,
    committedAt,
    ...(typeof value.operationId === "string" ? { operationId: value.operationId } : {}),
    ...(typeof value.correlationId === "string" ? { correlationId: value.correlationId } : {}),
    ...(typeof value.clientId === "string" ? { clientId: value.clientId } : {}),
    ...(typeof value.clientSequence === "number" ? { clientSequence: value.clientSequence } : {}),
    ...(typeof value.clientOccurredAt === "string" ? { clientOccurredAt: value.clientOccurredAt } : {}),
    ...(typeof value.deviceOccurredAt === "string" ? { deviceOccurredAt: value.deviceOccurredAt } : {}),
    ...(typeof value.deviceId === "string" ? { deviceId: value.deviceId } : {}),
  };
  if (value.type === "ingest_occupancy_signal")
    return { ...context, type: value.type, signal: occupancySignal(value.signal) };
  if (value.type === "refresh_live_occupancy") return { ...context, type: value.type, evaluatedAt: committedAt };
  if (
    value.type === "acknowledge_occupancy_alert" &&
    typeof value.alertId === "string" &&
    typeof value.reasonCode === "string"
  )
    return { ...context, type: value.type, alertId: value.alertId, reasonCode: value.reasonCode };
  throw venueError("COMMAND_UNSUPPORTED", { commandType: typeof value.type === "string" ? value.type : null });
};
const requiredIncidentString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim())
    throw venueError("INCIDENT_INVALID", { reason: "field-required", field });
  return value;
};
const requiredIncidentRevision = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw venueError("INCIDENT_INVALID", { reason: "incident-revision-invalid" });
  return value;
};
const incidentSeverity = (value: unknown): IncidentSeverity => {
  if (value !== "low" && value !== "medium" && value !== "high" && value !== "critical")
    throw venueError("INCIDENT_INVALID", { reason: "severity-invalid" });
  return value;
};
const incidentCategory = (value: unknown): IncidentCategory => {
  const categories: readonly IncidentCategory[] = [
    "accessibility",
    "crowd-capacity",
    "medical",
    "security",
    "fire-life-safety",
    "facilities",
    "production-av",
    "catering",
    "staffing",
    "transport",
    "weather",
    "other",
  ];
  const category = categories.find((candidate) => candidate === value);
  if (!category) throw venueError("INCIDENT_INVALID", { reason: "category-invalid" });
  return category;
};
const incidentStatus = (value: unknown): IncidentStatus => {
  if (value !== "open" && value !== "mitigating" && value !== "resolved" && value !== "closed")
    throw venueError("INCIDENT_INVALID", { reason: "status-invalid" });
  return value;
};
const incidentLocation = (value: unknown): IncidentLocationInput => {
  if (!isRecord(value)) throw venueError("INCIDENT_INVALID", { reason: "location-invalid" });
  if (value.kind === "plan-object")
    return { kind: "plan-object", planObjectId: requiredIncidentString(value.planObjectId, "location.planObjectId") };
  if (
    value.kind === "coordinate" &&
    isRecord(value.point) &&
    typeof value.point.x === "number" &&
    Number.isFinite(value.point.x) &&
    typeof value.point.y === "number" &&
    Number.isFinite(value.point.y)
  ) {
    return { kind: "coordinate", point: { x: value.point.x, y: value.point.y } };
  }
  throw venueError("INCIDENT_INVALID", { reason: "location-invalid" });
};
const incidentOwner = (value: unknown, field: string): IncidentOwner => {
  if (!isRecord(value)) throw venueError("INCIDENT_INVALID", { reason: "owner-invalid", field });
  return {
    roleId: requiredIncidentString(value.roleId, `${field}.roleId`),
    ...(typeof value.shiftId === "string" ? { shiftId: value.shiftId } : {}),
    ...(typeof value.staffPostObjectId === "string" ? { staffPostObjectId: value.staffPostObjectId } : {}),
    ...(typeof value.assignmentId === "string" ? { assignmentId: value.assignmentId } : {}),
  };
};
const incidentRelatedRefs = (value: unknown, field: string): readonly IncidentRelatedRef[] => {
  if (!Array.isArray(value)) throw venueError("INCIDENT_INVALID", { reason: "references-invalid", field });
  return value.map((item) => {
    if (
      !isRecord(item) ||
      (item.kind !== "occupancy-alert" && item.kind !== "runbook-task" && item.kind !== "plan-object")
    )
      throw venueError("INCIDENT_INVALID", { reason: "reference-invalid", field });
    return { kind: item.kind, id: requiredIncidentString(item.id, `${field}.id`) };
  });
};
const incidentStrings = (value: unknown, field: string): readonly string[] => {
  if (!Array.isArray(value)) throw venueError("INCIDENT_INVALID", { reason: "list-invalid", field });
  return value.map((item) => requiredIncidentString(item, field));
};
const incidentMutationCommand = (
  value: Record<string, unknown>,
  actorId: string,
  sessionId: string,
  committedAt: string,
  source: "studio" | "webmcp",
  authorityRole: OrganizationRole | null,
): IncidentCommand => {
  const type = value.type;
  const context = {
    actorType: "human" as const,
    actorId,
    source,
    sessionId,
    committedAt,
    idempotencyKey: requiredIncidentString(value.idempotencyKey, "idempotencyKey"),
  };
  const incidentId = requiredIncidentString(value.incidentId, "incidentId");
  if (type === "report_incident") {
    const relatedRefs =
      value.relatedRefs === undefined ? undefined : incidentRelatedRefs(value.relatedRefs, "relatedRefs");
    return {
      ...context,
      type,
      incidentId,
      severity: incidentSeverity(value.severity),
      category: incidentCategory(value.category),
      summaryCode: requiredIncidentString(value.summaryCode, "summaryCode"),
      location: incidentLocation(value.location),
      ...(relatedRefs === undefined ? {} : { relatedRefs }),
    };
  }
  const expectedIncidentRevision = requiredIncidentRevision(value.expectedIncidentRevision);
  const mutationContext = { ...context, incidentId, expectedIncidentRevision };
  if (type === "classify_incident")
    return {
      ...mutationContext,
      type,
      severity: incidentSeverity(value.severity),
      category: incidentCategory(value.category),
      summaryCode: requiredIncidentString(value.summaryCode, "summaryCode"),
    };
  if (type === "set_incident_owner") return { ...mutationContext, type, owner: incidentOwner(value.owner, "owner") };
  if (type === "acknowledge_incident")
    return { ...mutationContext, type, reasonCode: requiredIncidentString(value.reasonCode, "reasonCode") };
  if (
    type === "escalate_incident" &&
    (value.level === "team" || value.level === "venue-command" || value.level === "emergency-response")
  )
    return {
      ...mutationContext,
      type,
      level: value.level,
      reasonCode: requiredIncidentString(value.reasonCode, "reasonCode"),
    };
  if (type === "relocate_incident")
    return {
      ...mutationContext,
      type,
      location: incidentLocation(value.location),
      reasonCode: requiredIncidentString(value.reasonCode, "reasonCode"),
    };
  if (type === "transition_incident_status")
    return {
      ...mutationContext,
      type,
      toStatus: incidentStatus(value.toStatus),
      ...(typeof value.reasonCode === "string" ? { reasonCode: value.reasonCode } : {}),
      ...(typeof value.resolutionCode === "string" ? { resolutionCode: value.resolutionCode } : {}),
    };
  if (type === "handoff_incident")
    return {
      ...mutationContext,
      type,
      fromOwner: incidentOwner(value.fromOwner, "fromOwner"),
      toOwner: incidentOwner(value.toOwner, "toOwner"),
      openActionCodes: incidentStrings(value.openActionCodes, "openActionCodes"),
      evidenceRefs: incidentRelatedRefs(value.evidenceRefs, "evidenceRefs"),
    };
  if (type === "record_incident_emergency_action") {
    if (!authorityRole) throw venueError("AUTHORIZATION_DENIED", { permission: "incident.emergency-act" });
    return {
      ...mutationContext,
      type,
      actionCode: requiredIncidentString(value.actionCode, "actionCode"),
      targetObjectIds: incidentStrings(value.targetObjectIds, "targetObjectIds"),
      ...(typeof value.scenarioDefinitionId === "string" ? { scenarioDefinitionId: value.scenarioDefinitionId } : {}),
      authorityRole,
    };
  }
  throw venueError("COMMAND_UNSUPPORTED", { commandType: typeof type === "string" ? type : null });
};
const isIncidentRegister = (value: unknown): value is IncidentRegister =>
  isRecord(value) &&
  value.schemaVersion === 1 &&
  typeof value.id === "string" &&
  typeof value.projectId === "string" &&
  Array.isArray(value.incidents) &&
  typeof value.revision === "number";
const isIncidentMutationResult = (value: unknown): value is IncidentMutationResult =>
  isRecord(value) &&
  isIncidentRegister(value.register) &&
  isRecord(value.incident) &&
  isRecord(value.receipt) &&
  typeof value.duplicate === "boolean";
const isDeviationRegister = (value: unknown): value is LivePlanDeviationRegister =>
  isRecord(value) &&
  value.schemaVersion === 1 &&
  typeof value.id === "string" &&
  typeof value.projectId === "string" &&
  Array.isArray(value.deviations) &&
  typeof value.revision === "number";
const isDeviationMutationResult = (value: unknown): value is DeviationMutationResult =>
  isRecord(value) &&
  isDeviationRegister(value.register) &&
  isRecord(value.receipt) &&
  typeof value.duplicate === "boolean";
const isPostEventReview = (value: unknown): value is PostEventReview =>
  isRecord(value) && value.schemaVersion === 1 && typeof value.id === "string" && typeof value.revision === "number";
const isPostEventMutationResult = (value: unknown): value is PostEventReviewMutationResult =>
  isRecord(value) &&
  isPostEventReview(value.review) &&
  isRecord(value.subject) &&
  isRecord(value.receipt) &&
  typeof value.duplicate === "boolean";
const safeMutationOrigin = (request: Request, env: WorkerEnv) => {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return true;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const normalized = new URL(origin).origin;
    if (normalized === new URL(request.url).origin) return true;
    return (env.VENUEMIND_APP_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
      .includes(normalized);
  } catch {
    return false;
  }
};
const retainedProposals = (snapshot: {
  proposal?: { id?: string };
  branches?: Array<{ proposal?: { id?: string }; revisions?: Array<{ id?: string }> }>;
}) => {
  const proposals = [
    snapshot.proposal,
    ...(snapshot.branches ?? []).flatMap((branch) => [branch.proposal, ...(branch.revisions ?? [])]),
  ].filter((proposal): proposal is { id?: string } => Boolean(proposal));
  return [...new Map(proposals.filter((proposal) => proposal.id).map((proposal) => [proposal.id, proposal])).values()];
};

const requestAction = (method: string, pathname: string): string => {
  if (pathname === "/api/health") return "health.read";
  if (pathname.startsWith("/api/diagnostics/"))
    return pathname.includes("/traces/") ? "diagnostics.trace" : "diagnostics.read";
  if (pathname.startsWith("/api/projects")) return method === "GET" ? "projects.read" : "projects.write";
  if (pathname.startsWith("/api/share/")) return "sharing.read";
  if (pathname.includes("share-links")) return "sharing.write";
  if (pathname.includes("runbooks")) return "runbook.operation";
  if (pathname.includes("occupancy-monitors")) return "occupancy.operation";
  if (pathname.includes("incident-registers")) return "incident.operation";
  if (pathname.includes("deviation-registers")) return "deviation.operation";
  if (pathname.includes("post-event-reviews")) return "post-event.operation";
  if (pathname.startsWith("/api/session")) return "session.operation";
  return "api.operation";
};

export function createWorker(options: WorkerOptions = {}) {
  const projectRepositoryFactory = options.createProjectRepository ?? createD1ProjectRepository;
  const accountRepositoryFactory = options.createAccountRepository ?? createD1AccountRepository;
  const memoryCollaboration = createMemoryCollaborationRepository({ clock: options.clock });
  const collaborationRepositoryFactory =
    options.createCollaborationRepository ??
    (options.createProjectRepository ? () => memoryCollaboration : createD1CollaborationRepository);
  const memorySharing = createMemorySharingRepository();
  const sharingRepositoryFactory =
    options.createSharingRepository ??
    (options.createProjectRepository ? () => memorySharing : createD1SharingRepository);
  const identityProvider = options.identityProvider ?? createStaticIdentityProvider(null);
  const secureCookies = options.secureCookies ?? true;
  const clock = options.clock ?? (() => new Date().toISOString());
  const runbookRepositoryFactory =
    options.createRunbookRepository ?? ((db) => createD1RunbookRepository(db, { clock }));
  const occupancyRepositoryFactory = options.createOccupancyRepository ?? createD1OccupancyRepository;
  const incidentRepositoryFactory = options.createIncidentRepository ?? createD1IncidentRepository;
  const deviationRepositoryFactory = options.createDeviationRepository ?? createD1DeviationRepository;
  const postEventReviewRepositoryFactory = options.createPostEventReviewRepository ?? createD1PostEventReviewRepository;
  const memoryRateLimits = createMemoryRateLimitRepository();
  const rateLimitRepositoryFactory =
    options.createRateLimitRepository ??
    (options.createProjectRepository || options.createAccountRepository
      ? () => memoryRateLimits
      : createD1RateLimitRepository);
  const dataProtectionRepositoryFactory = options.createDataProtectionRepository ?? ((db: D1Database) => createD1DataProtectionRepository(db, { clock }));
  const logSink = options.log ?? ((record: Readonly<Record<string, string | number | boolean | null>>) => {
    console.info(JSON.stringify(record));
  });
  const log = (fields: Readonly<Record<string, unknown>>): void => {
    logSink(safeLogRecord(fields));
  };
  const memoryObservability = new Map<string, ObservabilityRepository>();
  const memoryObservabilityFactory = (_db: D1Database, scopeHash: string): ObservabilityRepository => {
    const existing = memoryObservability.get(scopeHash);
    if (existing) return existing;
    const created = createMemoryObservabilityRepository({ clock });
    memoryObservability.set(scopeHash, created);
    return created;
  };
  const observabilityRepositoryFactory =
    options.createObservabilityRepository ??
    (options.createProjectRepository || options.createAccountRepository
      ? memoryObservabilityFactory
      : createD1ObservabilityRepository);
  const structuredLog = options.telemetrySink ?? createStructuredLogSink();
  const integrityInspector =
    options.integrityInspector ??
    (options.createProjectRepository || options.createAccountRepository
      ? async () => ({ status: "pass" })
      : inspectDatabaseIntegrity);

  const appendShareLedger = async (
    env: WorkerEnv,
    organizationId: string,
    actorUserId: string,
    sessionId: string,
    record: ProjectRecord,
    command: PlannerCommand,
  ) => {
    const projects = projectRepositoryFactory(env.DB);
    let current = record;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const snapshot = current.snapshot;
      const planner = createVenuePlanner(
        { ...snapshot.plan, brief: snapshot.brief, proposal: snapshot.proposal },
        { projectId: current.id },
      );
      await planner.execute({ type: "restore_snapshot", snapshot: current.snapshot });
      await planner.execute(command);
      try {
        const saved = await projects.put(
          organizationId,
          { ...current, snapshot: planner.getSnapshot(), updatedAt: clock() },
          { expectedRevision: current.revision },
        );
        await collaborationRepositoryFactory(env.DB).append({
          organizationId,
          projectId: current.id,
          type: "ledger.appended",
          actorUserId,
          sessionId,
          projectRevision: saved.revision,
          payload: collaborationEventPayload("ledger.appended", current, saved),
          occurredAt: clock(),
        });
        return saved;
      } catch (cause) {
        if (
          !(cause instanceof ProjectRevisionConflict) &&
          (!(cause instanceof Error) || cause.message !== "PROJECT_REVISION_CONFLICT")
        )
          throw cause;
        const latest = await projects.get(organizationId, current.id);
        if (!latest) throw cause;
        current = latest;
      }
    }
    throw new ProjectRevisionConflict(await projects.get(organizationId, record.id));
  };

  const reconcileShareOperations = async (
    env: WorkerEnv,
    filter: { organizationId?: string; projectId?: string; linkId?: string; limit?: number } = {},
  ) => {
    const sharing = sharingRepositoryFactory(env.DB);
    const projects = projectRepositoryFactory(env.DB);
    const pending = await sharing.pendingLinkOperations(filter);
    const results = [];
    for (const link of pending) {
      try {
        const current = await projects.get(link.organizationId, link.projectId);
        if (!current) throw new Error("PROJECT_NOT_FOUND");
        if (link.lifecycleState === "pending-create") {
          const saved = await appendShareLedger(
            env,
            link.organizationId,
            link.createdBy,
            `share-reconcile-${link.id}`,
            current,
            {
              type: "record_share_link_created",
              shareLinkId: link.id,
              scope: link.scope,
              ...(link.proposalId === null ? {} : { proposalId: link.proposalId }),
              expiresAt: link.expiresAt,
              actor: "human",
              actorId: link.createdBy,
              idempotencyKey: `share-create-${link.id}`,
              source: "studio",
              sessionId: `share-reconcile-${link.id}`,
            },
          );
          await sharing.markLinkCreated(link.id, clock());
          results.push({ id: link.id, status: "active", projectRevision: saved.revision });
        } else {
          const actorId = link.revokedBy ?? link.createdBy;
          const saved = await appendShareLedger(
            env,
            link.organizationId,
            actorId,
            `share-reconcile-${link.id}`,
            current,
            {
              type: "record_share_link_revoked",
              shareLinkId: link.id,
              reasonCode: "operator-revoked",
              actor: "human",
              actorId,
              idempotencyKey: `share-revoke-${link.id}`,
              source: "studio",
              sessionId: `share-reconcile-${link.id}`,
            },
          );
          await sharing.markLinkRevoked(link.id, clock());
          results.push({ id: link.id, status: "revoked", projectRevision: saved.revision });
        }
      } catch (cause) {
        const code = (cause instanceof Error ? cause.message : "SHARE_RECONCILIATION_FAILED")
          .toUpperCase()
          .replace(/[^A-Z0-9_:-]/g, "_")
          .slice(0, 80);
        try {
          await sharing.recordLinkOperationFailure(link.id, code || "SHARE_RECONCILIATION_FAILED");
        } catch {
          /* a later sweep retries */
        }
        results.push({ id: link.id, status: link.lifecycleState, error: code });
      }
    }
    return results;
  };

  return {
    async fetch(request: Request, env: WorkerEnv) {
      const url = new URL(request.url);
      const correlationId = safeCorrelationId(
        request.headers.get("x-correlation-id"),
        () => `corr-${crypto.randomUUID()}`,
      );
      const requestSpan = startTelemetrySpan(structuredLog, {
        component: "api",
        operation: "request",
        correlationId,
        action: requestAction(request.method, url.pathname),
      });
      let durableObservability: ObservabilityRepository | null = null;
      let requestObservability: TelemetrySink = structuredLog;
      const finishResponse = (response: Response): Response => {
        const outcome =
          response.status === 409 || response.status === 412 ? "conflict" : response.status >= 400 ? "failed" : "ok";
        const terminal = requestSpan.end(outcome, response.status >= 400 ? `HTTP_${response.status}` : undefined);
        if (durableObservability) void durableObservability.record(terminal).catch(() => undefined);
        response.headers.set("x-correlation-id", correlationId);
        return response;
      };
      if (url.pathname === "/api/health" && request.method === "GET")
        return finishResponse(json({ status: "ok", service: "venue-mind-api" }));
      const publicShareMatch = url.pathname.match(/^\/api\/share\/([0-9a-f]{64})$/);
      if (publicShareMatch && request.method === "GET") {
        const sharing = sharingRepositoryFactory(env.DB);
        const tokenHash = await hashShareToken(pathCapture(publicShareMatch, 1));
        let link = await sharing.resolveLink(tokenHash, clock());
        if (link && ["pending-create", "pending-revoke"].includes(link.lifecycleState)) {
          await reconcileShareOperations(env, { linkId: link.id, limit: 1 });
          link = await sharing.resolveLink(tokenHash, clock());
        }
        if (!link || link.status !== "active") return apiError(404, "SHARE_LINK_UNAVAILABLE", "Share link unavailable");
        if ((link.scope === "reviewer") !== Boolean(link.proposalId))
          return apiError(404, "SHARE_LINK_UNAVAILABLE", "Share link unavailable");
        const record = await projectRepositoryFactory(env.DB).get(link.organizationId, link.projectId);
        if (!record) return apiError(404, "SHARE_LINK_UNAVAILABLE", "Share link unavailable");
        const snapshot = record.snapshot;
        const proposals = retainedProposals(snapshot);
        const proposal =
          link.scope === "reviewer"
            ? (proposals.find((item: { id?: string }) => item.id === link.proposalId) ?? null)
            : null;
        if (link.scope === "reviewer" && !proposal)
          return apiError(404, "SHARE_LINK_UNAVAILABLE", "Share link unavailable");
        return json(
          {
            shareLinkId: link.id,
            scope: link.scope,
            expiresAt: link.expiresAt,
            project: { id: record.id, name: record.name, revision: record.revision },
            plan: snapshot.plan,
            ...(proposal ? { proposal } : {}),
          },
          { headers: { "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" } },
        );
      }
      if (!url.pathname.startsWith("/api/"))
        return apiError(404, "API_ROUTE_REQUIRED", "This service exposes VenueMind API routes only");

      if (!safeMutationOrigin(request, env)) return apiError(403, "ORIGIN_DENIED", "Cross-origin mutation denied");
      if (request.body !== null || Number(request.headers.get("content-length") ?? 0) > 0) {
        try {
          await readBody(request);
        } catch (cause) {
          return requestBodyError(cause);
        }
      }
      const accounts = accountRepositoryFactory(env.DB);
      let sessionId = cookieValue(request, SESSION_COOKIE);
      let account = sessionId ? await accounts.resolveSession(decodeURIComponent(sessionId)) : null;
      const setCookies: string[] = [];
      if (!account) {
        let identity = await identityProvider.authenticate(request);
        if (!identity && env.VENUEMIND_AUTH_MODE === "anonymous-demo") {
          const demo = anonymousDemoIdentity(request, secureCookies);
          identity = demo.identity;
          if (demo.cookie) setCookies.push(demo.cookie);
        }
        if (!identity) return apiError(401, "AUTHENTICATION_REQUIRED", "Authentication required");
        try {
          const provisioned = await accounts.provision(identity);
          const session = await accounts.createSession(provisioned.user.id);
          sessionId = session.id;
          account = { session, ...provisioned };
          setCookies.push(sessionCookie(session.id, secureCookies));
        } catch (cause) {
          return apiError(403, cause instanceof Error ? cause.message : "ACCOUNT_UNAVAILABLE", "Account unavailable");
        }
      }

      const respond = (value: unknown, init: ResponseInit = {}) => {
        const response = json(value, init);
        for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
        return finishResponse(response);
      };
      const requestedOrganizationId =
        request.headers.get("x-venuemind-organization-id")?.trim() ||
        (url.pathname.endsWith("/collaboration") || url.pathname.endsWith("/presence")
          ? url.searchParams.get("organizationId")?.trim()
          : null) ||
        null;
      const organization = requestedOrganizationId
        ? account.organizations.find((item) => item.id === requestedOrganizationId)
        : account.organizations[0];
      const observabilityScopeHash = stableFingerprint("observability-scope", {
        organizationId: organization?.id ?? "none",
      });
      durableObservability = observabilityRepositoryFactory(env.DB, observabilityScopeHash);
      requestObservability = createTelemetryFanout(structuredLog, {
        emit: (event: TelemetryEvent) => durableObservability?.record(event),
      });
      const admin = organization ? isOrganizationAdministrator({ status: "active", roles: organization.roles }) : false;

      if (url.pathname === "/api/diagnostics/health" && request.method === "GET") {
        const integritySpan = startTelemetrySpan(structuredLog, {
          component: "repository",
          operation: "integrity",
          correlationId,
          action: "database.integrity",
        });
        try {
          const integrity = await integrityInspector(env.DB);
          const passing = integrity.status === "pass";
          await durableObservability.record(
            integritySpan.end(passing ? "ok" : "failed", passing ? undefined : "DATABASE_INTEGRITY_FAILED"),
          );
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error("DATABASE_INTEGRITY_FAILED");
          await durableObservability.record(integritySpan.end("failed", telemetryErrorCode(error)));
        }
        return respond(await durableObservability.snapshot(clock()));
      }
      const diagnosticsTraceMatch = url.pathname.match(/^\/api\/diagnostics\/traces\/([^/]+)$/);
      if (diagnosticsTraceMatch && request.method === "GET") {
        const requestedCorrelationId = pathCapture(diagnosticsTraceMatch, 1);
        if (!isSafeCorrelationId(requestedCorrelationId))
          return finishResponse(apiError(400, "CORRELATION_ID_INVALID", "Correlation ID is invalid"));
        return respond({
          correlationId: requestedCorrelationId,
          events: await durableObservability.trace(requestedCorrelationId),
        });
      }
      const endpointFamily = mutationEndpointFamily(request.method, url.pathname);
      if (endpointFamily) {
        const decision = await createRateLimitService({ repository: rateLimitRepositoryFactory(env.DB), clock }).consume({
          sessionId: account.session.id,
          organizationId: organization?.id ?? null,
          endpointFamily,
        });
        if (!decision.allowed) {
          const response = apiError(
            429,
            "RESOURCE_RATE_LIMITED",
            "API mutation rate limit exceeded",
            {
              endpointFamily: decision.endpointFamily,
              scope: decision.limitedScope,
              windowSeconds: VENUE_RATE_LIMIT_WINDOW_SECONDS,
            },
            { "retry-after": String(decision.retryAfterSeconds) },
          );
          for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
          return response;
        }
      }

      if (url.pathname === "/api/session" && request.method === "GET")
        return respond({
          user: { id: account.user.id, email: account.user.email, displayName: account.user.displayName },
          session: { id: account.session.id, expiresAt: account.session.expiresAt },
          organizations: account.organizations,
          activeOrganizationId: organization?.id ?? null,
        });

      if (url.pathname === "/api/session/revoke" && request.method === "POST") {
        await accounts.revokeSession(account.session.id);
        const response = respond({ status: "revoked" });
        response.headers.set("set-cookie", clearedSessionCookie(secureCookies));
        return response;
      }

      if (url.pathname === "/api/organizations" && request.method === "POST") {
        const body = await readObjectBody(request);
        if (
          typeof body.name !== "string" ||
          !body.name.trim() ||
          typeof body.slug !== "string" ||
          !/^[a-z0-9][a-z0-9-]{1,62}$/.test(body.slug.trim())
        )
          return apiError(400, "ORGANIZATION_INVALID", "Organization name and slug are required");
        return respond(await accounts.createOrganization(account.user.id, { name: body.name, slug: body.slug }), {
          status: 201,
        });
      }

      if (url.pathname === "/api/invitations/accept" && request.method === "POST") {
        const body = await readObjectBody(request);
        if (typeof body.token !== "string" || !body.token)
          return apiError(400, "INVITATION_INVALID", "Invitation token required");
        try {
          return respond(await accounts.acceptInvitation(account.user.id, account.user.email, body.token));
        } catch {
          return apiError(400, "INVITATION_INVALID", "Invitation is invalid or unavailable");
        }
      }

      if (!organization) return apiError(403, "ORGANIZATION_ACCESS_DENIED", "Active organization membership required");

      if (url.pathname === "/api/memberships" && request.method === "GET") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        return respond({ memberships: await accounts.listMemberships(organization.id) });
      }

      if (url.pathname === "/api/invitations" && request.method === "POST") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        const body = await readObjectBody(request);
        if (
          typeof body.email !== "string" ||
          !Array.isArray(body.roles) ||
          !body.roles.every((role): role is string => typeof role === "string") ||
          body.roles.length === 0 ||
          typeof body.expiresAt !== "string"
        )
          return apiError(400, "INVITATION_INVALID", "Invitation fields are required");
        try {
          return respond(
            await accounts.createInvitation(organization.id, account.user.id, {
              email: body.email,
              roles: body.roles,
              expiresAt: body.expiresAt,
            }),
            { status: 201 },
          );
        } catch {
          return apiError(400, "INVITATION_INVALID", "Invitation is invalid");
        }
      }

      const membershipMatch = url.pathname.match(/^\/api\/memberships\/([^/]+)$/);
      if (membershipMatch && request.method === "PATCH") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        const targetUserId = pathCapture(membershipMatch, 1);
        const body = await readObjectBody(request);
        const roles =
          Array.isArray(body.roles) && body.roles.every((role): role is string => typeof role === "string")
            ? body.roles
            : [];
        try {
          return respond(await accounts.setMembershipRoles(organization.id, account.user.id, targetUserId, roles));
        } catch {
          return apiError(400, "MEMBERSHIP_INVALID", "Membership roles are invalid");
        }
      }
      if (membershipMatch && request.method === "DELETE") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        const targetUserId = pathCapture(membershipMatch, 1);
        if (targetUserId === account.user.id)
          return apiError(409, "SELF_REMOVAL_DENIED", "Transfer administration before leaving");
        await accounts.removeMembership(organization.id, account.user.id, targetUserId);
        return respond({ status: "removed" });
      }

      if (url.pathname === "/api/organization-audit" && request.method === "GET") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        return respond({ events: await accounts.auditEvents(organization.id) });
      }
      if (url.pathname === "/api/account/export" && request.method === "GET") {
        const accountExport = await accounts.exportAccount(account.user.id);
        const repository = projectRepositoryFactory(env.DB);
        const projects = (await Promise.all(account.organizations.map((item) => repository.list(item.id)))).flat();
        // A custom Project repository must provide the matching data-protection repository to expose its aggregates.
        if (options.createProjectRepository && !options.createDataProtectionRepository)
          return respond({ ...accountExport, projects });
        const protection = dataProtectionRepositoryFactory(env.DB);
        const accountData = await protection.exportAccount(
          account.user.id,
          account.organizations.map((item) => item.id),
        );
        const projectScopes = (
          await Promise.all(
            account.organizations.map(async (item) =>
              (await protection.listOrganizationProjectIds(item.id)).map((projectId) => ({ organizationId: item.id, projectId })),
            ),
          )
        ).flat();
        const projectExports = await Promise.all(projectScopes.map((scope) =>
          protection.exportProject(scope.organizationId, scope.projectId, account.user.id)));
        return respond({ ...accountExport, projects, dataProtection: accountData, projectExports });
      }
      if (url.pathname === "/api/account" && request.method === "DELETE") {
        const result = await accounts.requestAccountDeletion(account.user.id);
        const response = respond(result, { status: 202 });
        response.headers.set("set-cookie", clearedSessionCookie(secureCookies));
        return response;
      }

      const projects = projectRepositoryFactory(env.DB);
      const sharing = sharingRepositoryFactory(env.DB);
      const runbooks = runbookRepositoryFactory(env.DB);
      const occupancy = occupancyRepositoryFactory(env.DB);
      const incidents = incidentRepositoryFactory(env.DB);
      const deviations = deviationRepositoryFactory(env.DB);
      const postEventReviews = postEventReviewRepositoryFactory(env.DB);
      const dataProtection = dataProtectionRepositoryFactory(env.DB);

      if (url.pathname === "/api/data-protection/retention-policy" && request.method === "GET") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        return respond(await dataProtection.getPolicy(organization.id, account.user.id));
      }
      if (url.pathname === "/api/data-protection/retention-policy" && request.method === "PUT") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        let body: Record<string, unknown>;
        try {
          body = await readObjectBody(request);
        } catch {
          return apiError(400, "RETENTION_POLICY_INVALID", "Retention policy payload is invalid");
        }
        if (
          !hasExactKeys(body, ["operationalSensitiveDays", "securityEvidenceDays", "projectRecoveryDays"]) ||
          typeof body.operationalSensitiveDays !== "number" ||
          typeof body.securityEvidenceDays !== "number" ||
          typeof body.projectRecoveryDays !== "number"
        ) return apiError(400, "RETENTION_POLICY_INVALID", "Retention policy payload is invalid");
        try {
          const policy = await dataProtection.setPolicy(organization.id, account.user.id, {
            operationalSensitiveDays: body.operationalSensitiveDays,
            securityEvidenceDays: body.securityEvidenceDays,
            projectRecoveryDays: body.projectRecoveryDays,
          });
          log({ event: "retention.policy_updated", route: url.pathname, method: request.method, status: 200, occurredAt: policy.updatedAt });
          return respond(policy);
        } catch (cause) {
          return apiError(400, "RETENTION_POLICY_INVALID", cause instanceof Error ? cause.message : "Retention policy is invalid");
        }
      }
      if (url.pathname === "/api/data-protection/backup-expiry" && request.method === "GET") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        return respond({ expectations: await dataProtection.listBackupExpiryExpectations(organization.id) });
      }
      if (url.pathname === "/api/data-protection/backup-expiry/verify" && request.method === "POST") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        let body: Record<string, unknown>;
        try {
          body = await readObjectBody(request);
        } catch {
          return apiError(400, "BACKUP_EXPIRY_EVIDENCE_INVALID", "Backup expiry evidence payload is invalid");
        }
        if (
          !hasExactKeys(body, ["deletionRequestId", "evidenceRef"]) ||
          typeof body.deletionRequestId !== "string" ||
          typeof body.evidenceRef !== "string"
        ) return apiError(400, "BACKUP_EXPIRY_EVIDENCE_INVALID", "Backup expiry evidence payload is invalid");
        try {
          const evidence = await dataProtection.recordBackupExpiryEvidence(
            organization.id,
            account.user.id,
            body.deletionRequestId,
            body.evidenceRef,
          );
          log({ event: "backup.expiry_evidence_recorded", route: url.pathname, method: request.method, status: 200, projectId: evidence.projectId, occurredAt: evidence.verifiedAt });
          return respond(evidence);
        } catch (cause) {
          return dataProtectionError(cause) ?? apiError(500, "BACKUP_EXPIRY_EVIDENCE_FAILED", "Backup expiry evidence failed");
        }
      }

      const projectExportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
      if (projectExportMatch && request.method === "GET") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        const projectId = pathCapture(projectExportMatch, 1);
        try {
          const exported = await dataProtection.exportProject(organization.id, projectId, account.user.id);
          log({ event: "project.export_generated", route: url.pathname, method: request.method, status: 200, projectId, occurredAt: exported.exportedAt });
          return respond(exported, {
            headers: { "content-disposition": `attachment; filename="venuemind-project-${encodeURIComponent(projectId)}.json"` },
          });
        } catch (cause) {
          return dataProtectionError(cause) ?? apiError(500, "PROJECT_EXPORT_FAILED", "Project export failed");
        }
      }

      const projectDeletionActionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/deletion\/(cache-ack|recover|purge)$/);
      if (projectDeletionActionMatch && request.method === "POST") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        const projectId = pathCapture(projectDeletionActionMatch, 1);
        const action = pathCapture(projectDeletionActionMatch, 2);
        let body: Record<string, unknown>;
        try {
          body = await readObjectBody(request);
        } catch {
          return apiError(400, "PROJECT_DELETION_PAYLOAD_INVALID", "Project deletion payload is invalid");
        }
        const expectedKeys = action === "cache-ack" ? ["deletionRequestId", "directiveId"] : ["deletionRequestId"];
        if (
          !hasExactKeys(body, expectedKeys) ||
          typeof body.deletionRequestId !== "string" ||
          (action === "cache-ack" && typeof body.directiveId !== "string")
        ) return apiError(400, "PROJECT_DELETION_PAYLOAD_INVALID", "Project deletion payload is invalid");
        try {
          const result = action === "cache-ack"
            ? await dataProtection.acknowledgeBrowserCacheDeletion(
                organization.id,
                projectId,
                account.user.id,
                body.deletionRequestId,
                String(body.directiveId),
              )
            : action === "recover"
              ? await dataProtection.recoverProject(organization.id, projectId, account.user.id, body.deletionRequestId)
              : await dataProtection.purgeProject(organization.id, projectId, account.user.id, body.deletionRequestId);
          log({ event: `project.deletion_${action}`, route: url.pathname, method: request.method, status: 200, projectId, occurredAt: clock() });
          return respond(result);
        } catch (cause) {
          return dataProtectionError(cause) ?? apiError(500, "PROJECT_DELETION_FAILED", "Project deletion operation failed");
        }
      }

      const projectDeletionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
      if (projectDeletionMatch && request.method === "DELETE") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        const projectId = pathCapture(projectDeletionMatch, 1);
        const expectedRevision = parseProjectEtag(request.headers.get("if-match") ?? "", projectId);
        if (expectedRevision === null)
          return apiError(428, "PROJECT_PRECONDITION_REQUIRED", "A valid If-Match Project ETag is required");
        let body: Record<string, unknown>;
        try {
          body = await readObjectBody(request);
        } catch {
          return apiError(400, "PROJECT_DELETION_PAYLOAD_INVALID", "Project deletion payload is invalid");
        }
        if (
          !hasExactKeys(body, ["reasonCode"]) ||
          typeof body.reasonCode !== "string" ||
          !/^[A-Z0-9][A-Z0-9_-]{0,79}$/.test(body.reasonCode)
        ) return apiError(400, "PROJECT_DELETION_PAYLOAD_INVALID", "Project deletion payload is invalid");
        try {
          const evidence = await dataProtection.requestProjectDeletion(
            organization.id,
            projectId,
            account.user.id,
            expectedRevision,
            body.reasonCode,
          );
          log({ event: "project.deletion_requested", route: url.pathname, method: request.method, status: 202, projectId, revision: evidence.projectRevision, occurredAt: evidence.requestedAt });
          return respond(evidence, {
            status: 202,
            headers: {
              etag: projectEtag(projectId, evidence.projectRevision),
              "clear-site-data": '"cache"',
              "x-venuemind-cache-directive": evidence.cacheDirective.id,
            },
          });
        } catch (cause) {
          return dataProtectionError(cause) ?? apiError(500, "PROJECT_DELETION_FAILED", "Project deletion request failed");
        }
      }
      const notifyOrganization = async (
        eventType: NotificationEventType,
        record: ProjectRecord,
        refs: NotificationRefs,
        excludeUserId: string | null = account.user.id,
      ) => {
        const recipients = await sharing.notificationRecipients(organization.id, eventType, excludeUserId);
        for (const recipient of recipients) {
          const notification = safeNotification({
            id: `notification-${crypto.randomUUID()}`,
            organizationId: organization.id,
            projectId: record.id,
            userId: recipient.userId,
            eventType,
            refs: { projectId: record.id, revision: record.revision, ...refs },
            createdAt: clock(),
          });
          await sharing.addNotification(notification, {
            inAppEnabled: recipient.inAppEnabled,
            recipientEmail: recipient.emailEnabled ? recipient.email : null,
          });
        }
      };
      const canWriteRunbooks = hasRole(organization.roles, RUNBOOK_WRITE_ROLES);
      const canWriteOccupancy = canWriteRunbooks;
      const canWriteIncidents = hasRole(organization.roles, INCIDENT_WRITE_ROLES);
      const canExportIncidents = hasRole(organization.roles, INCIDENT_EXPORT_ROLES);
      const canWriteDeviations = hasRole(organization.roles, DEVIATION_WRITE_ROLES);
      const canCreateDeviationProposals = hasRole(organization.roles, DEVIATION_PROPOSAL_ROLES);
      const canExportDeviations = hasRole(organization.roles, DEVIATION_EXPORT_ROLES);
      const canWritePostEvent = hasRole(organization.roles, POST_EVENT_WRITE_ROLES);
      const canCreatePostEventProposals = hasRole(organization.roles, POST_EVENT_PROPOSAL_ROLES);
      const canReviewPostEventProposals = hasRole(organization.roles, POST_EVENT_REVIEW_ROLES);
      const canExportPostEvent = hasRole(organization.roles, POST_EVENT_EXPORT_ROLES);
      const runbookCollectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/runbooks$/);
      const runbookItemMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/runbooks\/([^/]+)$/);
      const runbookSyncMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/runbooks\/([^/]+)\/transitions:sync$/);
      if (runbookCollectionMatch && request.method === "POST") {
        if (!canWriteRunbooks) return apiError(403, "RUNBOOK_WRITE_DENIED", "Runbook write role required");
        const projectId = pathCapture(runbookCollectionMatch, 1);
        if (!(await projects.get(organization.id, projectId)))
          return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        let body: unknown;
        try {
          body = await readBody(request);
        } catch (cause) {
          return apiError(
            cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            "RUNBOOK_INVALID",
            "Runbook payload is invalid",
          );
        }
        try {
          const envelope = isRecord(body) ? body : null;
          const input = browserRunbookToPersistenceInput(envelope?.runbook ?? body, account.user.id);
          const existing = await runbooks.getRunbook(organization.id, projectId, input.id);
          const stored = await runbooks.createRunbook(organization.id, projectId, input);
          return respond(
            { status: existing ? "already-applied" : "created", runbook: repositoryRunbookToBrowserSnapshot(stored) },
            { status: existing ? 200 : 201 },
          );
        } catch (cause) {
          const error = errorInfo(cause);
          if (error.code === "RUNBOOK_ID_CONFLICT")
            return apiError(
              409,
              error.code,
              error.message ?? "Runbook version conflicts with stored content",
              error.details,
            );
          if (cause instanceof TypeError) return apiError(400, "RUNBOOK_INVALID", cause.message);
          throw cause;
        }
      }
      if (runbookSyncMatch && request.method === "POST") {
        if (!canWriteRunbooks) return apiError(403, "RUNBOOK_WRITE_DENIED", "Runbook write role required");
        const projectId = pathCapture(runbookSyncMatch, 1);
        const runbookVersionId = pathCapture(runbookSyncMatch, 2);
        if (!(await projects.get(organization.id, projectId)))
          return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        let body: Record<string, unknown>;
        try {
          body = await readObjectBody(request);
        } catch (cause) {
          return apiError(
            cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            "RUNBOOK_SYNC_INVALID",
            "Runbook sync payload is invalid",
          );
        }
        if (!Array.isArray(body.commands) || body.commands.length > 100)
          return apiError(400, "RUNBOOK_SYNC_INVALID", "Runbook sync commands are invalid");
        let current = await runbooks.getRunbook(organization.id, projectId, runbookVersionId);
        if (!current) return apiError(404, "RUNBOOK_NOT_FOUND", "Runbook not found");
        const acknowledgements: Array<Record<string, unknown>> = [];
        for (const candidate of body.commands) {
          const command = isRecord(candidate) ? candidate : {};
          const identity = {
            idempotencyKey: typeof command.idempotencyKey === "string" ? command.idempotencyKey : null,
            operationId: typeof command.operationId === "string" ? command.operationId : null,
          };
          try {
            const storedCommand = browserCommandToPersistenceInput(
              command,
              current,
              account.user.id,
              account.session.id,
            );
            const existing = current.receipts.some(
              (receipt) => receipt.idempotencyKey === storedCommand.idempotencyKey,
            );
            if (!existing) {
              transitionRunbookTask(
                repositoryRunbookToBrowserSnapshot(current),
                {
                  type: "transition_runbook_task",
                  runbookVersionId,
                  taskId: storedCommand.taskId,
                  expectedTaskRevision: storedCommand.expectedTaskRevision,
                  fromStatus: storedCommand.fromStatus,
                  toStatus: storedCommand.toStatus,
                  actorType: storedCommand.actorType,
                  actorId: storedCommand.actorId,
                  source: storedCommand.source,
                  sessionId: storedCommand.sessionId,
                  idempotencyKey: storedCommand.idempotencyKey,
                  evidence: storedCommand.evidence ?? [],
                  operationId: storedCommand.id,
                  clientId: storedCommand.clientId,
                  clientSequence: storedCommand.clientSequence,
                  clientOccurredAt: storedCommand.clientOccurredAt,
                  ...(storedCommand.reasonCode === null ? {} : { reasonCode: storedCommand.reasonCode }),
                  ...(storedCommand.correlationId === null ? {} : { correlationId: storedCommand.correlationId }),
                },
                { committedAt: clock() },
              );
            }
            const applied = await runbooks.applyTransitionBatch(organization.id, projectId, runbookVersionId, [
              storedCommand,
            ]);
            current = applied.runbook;
            acknowledgements.push({
              ...identity,
              ...applied.results[0],
              status: existing ? "already-applied" : "applied",
            });
          } catch (cause) {
            const error = errorInfo(cause);
            if (
              cause instanceof RunbookIdempotencyConflict ||
              cause instanceof RunbookTransitionConflict ||
              cause instanceof RunbookClientSequenceConflict ||
              ["IDEMPOTENCY_KEY_CONFLICT", "RUNBOOK_TASK_REVISION_CONFLICT"].includes(error.code ?? "")
            ) {
              acknowledgements.push({
                ...identity,
                status: "conflict",
                code: error.code ?? "RUNBOOK_TRANSITION_CONFLICT",
                details: error.details,
              });
              continue;
            }
            if (
              cause instanceof TypeError ||
              error.code?.startsWith("RUNBOOK_") ||
              error.code === "IDEMPOTENCY_KEY_REQUIRED"
            ) {
              acknowledgements.push({
                ...identity,
                status: "rejected",
                code: error.code ?? "RUNBOOK_COMMAND_INVALID",
                details: error.details,
                message: error.message,
              });
              continue;
            }
            throw cause;
          }
        }
        return respond({ acknowledgements, runbook: repositoryRunbookToBrowserSnapshot(current) });
      }
      if (runbookItemMatch && request.method === "GET") {
        const projectId = pathCapture(runbookItemMatch, 1);
        const runbookVersionId = pathCapture(runbookItemMatch, 2);
        const runbook = await runbooks.getRunbook(organization.id, projectId, runbookVersionId);
        return runbook
          ? respond({ runbook: repositoryRunbookToBrowserSnapshot(runbook) })
          : apiError(404, "RUNBOOK_NOT_FOUND", "Runbook not found");
      }
      const occupancyCollectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/occupancy-monitors$/);
      const occupancyCommandMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/occupancy-monitors\/([^/]+)\/commands:sync$/,
      );
      const occupancyExportMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/occupancy-monitors\/([^/]+)\/export$/,
      );
      const occupancyItemMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/occupancy-monitors\/([^/]+)$/);
      if (occupancyCollectionMatch && request.method === "POST") {
        if (!canWriteOccupancy) return apiError(403, "OCCUPANCY_WRITE_DENIED", "Live Occupancy write role required");
        const projectId = pathCapture(occupancyCollectionMatch, 1);
        if (!(await projects.get(organization.id, projectId)))
          return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        let body: Record<string, unknown>;
        try {
          body = await readObjectBody(request);
        } catch (cause) {
          return apiError(
            cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            "OCCUPANCY_BASELINE_INVALID",
            "Live Occupancy payload is invalid",
          );
        }
        if (typeof body.runbookVersionId !== "string" || !body.runbookVersionId.trim())
          return apiError(400, "OCCUPANCY_BASELINE_INVALID", "Runbook Version ID is required");
        const storedRunbook = await runbooks.getRunbook(organization.id, projectId, body.runbookVersionId);
        if (!storedRunbook) return apiError(404, "RUNBOOK_NOT_FOUND", "Runbook not found");
        try {
          const existing = await occupancy.getByRunbook(organization.id, projectId, body.runbookVersionId);
          const simulation = occupancySimulation(body.simulation);
          const policy = occupancyPolicy(body.policy);
          const monitor = createLiveOccupancyMonitor({
            projectId,
            runbook: repositoryRunbookToBrowserSnapshot(storedRunbook),
            simulation,
            ...(policy === undefined ? {} : { policy }),
            createdAt: clock(),
            createdBy: account.user.id,
          });
          const saved = await occupancy.create(organization.id, projectId, monitor);
          return respond(
            {
              status: existing ? "already-applied" : "created",
              monitor: saved,
              projection: evaluateLiveOccupancy(saved, { at: clock() }),
            },
            { status: existing ? 200 : 201 },
          );
        } catch (cause) {
          const error = errorInfo(cause);
          if (cause instanceof OccupancyMonitorConflict)
            return apiError(
              409,
              error.code ?? "OCCUPANCY_ID_CONFLICT",
              error.message ?? "Live Occupancy monitor conflicts with stored state",
              error.details,
            );
          if (error.code?.startsWith("OCCUPANCY_"))
            return apiError(400, error.code, error.message ?? "Live Occupancy baseline is invalid", error.details);
          throw cause;
        }
      }
      if (occupancyCommandMatch && request.method === "POST") {
        if (!canWriteOccupancy) return apiError(403, "OCCUPANCY_WRITE_DENIED", "Live Occupancy write role required");
        const projectId = pathCapture(occupancyCommandMatch, 1);
        const monitorId = pathCapture(occupancyCommandMatch, 2);
        if (!(await projects.get(organization.id, projectId)))
          return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        let body: Record<string, unknown>;
        try {
          body = await readObjectBody(request);
        } catch (cause) {
          return apiError(
            cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            "OCCUPANCY_SYNC_INVALID",
            "Live Occupancy sync payload is invalid",
          );
        }
        if (!Array.isArray(body.commands) || body.commands.length > 100)
          return apiError(400, "OCCUPANCY_SYNC_INVALID", "Live Occupancy sync commands are invalid");
        const storedMonitor = await occupancy.get(organization.id, projectId, monitorId);
        if (!storedMonitor) return apiError(404, "OCCUPANCY_MONITOR_NOT_FOUND", "Live Occupancy monitor not found");
        let current: LiveOccupancyMonitor = storedMonitor;
        const acknowledgements: Array<Record<string, unknown>> = [];
        for (const candidate of body.commands) {
          const command = isRecord(candidate) ? candidate : {};
          const identity = {
            idempotencyKey: typeof command.idempotencyKey === "string" ? command.idempotencyKey : null,
            operationId: typeof command.operationId === "string" ? command.operationId : null,
          };
          try {
            const committedAt = clock();
            const trustedCommand = occupancyMutationCommand(command, account.user.id, account.session.id, committedAt);
            const result =
              trustedCommand.type === "ingest_occupancy_signal"
                ? ingestOccupancySignal(current, trustedCommand, { acceptedAt: committedAt })
                : trustedCommand.type === "refresh_live_occupancy"
                  ? refreshLiveOccupancy(current, trustedCommand, { committedAt })
                  : acknowledgeOccupancyAlert(current, trustedCommand, { acknowledgedAt: committedAt });
            if (!result.duplicate) await occupancy.put(organization.id, projectId, result.monitor, current.revision);
            current = result.monitor;
            acknowledgements.push({
              ...identity,
              status: result.duplicate ? "already-applied" : "applied",
              receipt: result.receipt,
            });
          } catch (cause) {
            const error = errorInfo(cause);
            if (
              cause instanceof OccupancyMonitorConflict ||
              ["IDEMPOTENCY_KEY_CONFLICT", "OCCUPANCY_REVISION_CONFLICT"].includes(error.code ?? "")
            ) {
              acknowledgements.push({
                ...identity,
                status: "conflict",
                code: error.code ?? "OCCUPANCY_REVISION_CONFLICT",
                details: error.details,
              });
              continue;
            }
            if (
              error.code === "IDEMPOTENCY_KEY_REQUIRED" ||
              error.code === "COMMAND_UNSUPPORTED" ||
              error.code?.startsWith("OCCUPANCY_")
            ) {
              acknowledgements.push({
                ...identity,
                status: "rejected",
                code: error.code ?? "OCCUPANCY_COMMAND_INVALID",
                details: error.details,
                message: error.message,
              });
              continue;
            }
            throw cause;
          }
        }
        return respond({
          acknowledgements,
          monitor: current,
          projection: evaluateLiveOccupancy(current, { at: clock() }),
        });
      }
      if (occupancyExportMatch && request.method === "GET") {
        const projectId = pathCapture(occupancyExportMatch, 1);
        const monitorId = pathCapture(occupancyExportMatch, 2);
        const monitor = await occupancy.get(organization.id, projectId, monitorId);
        return monitor
          ? respond({ artifact: exportLiveOccupancyAudit(monitor, { exportedAt: clock() }) })
          : apiError(404, "OCCUPANCY_MONITOR_NOT_FOUND", "Live Occupancy monitor not found");
      }
      if (occupancyItemMatch && request.method === "GET") {
        const projectId = pathCapture(occupancyItemMatch, 1);
        const monitorId = pathCapture(occupancyItemMatch, 2);
        const monitor = await occupancy.get(organization.id, projectId, monitorId);
        return monitor
          ? respond({ monitor, projection: evaluateLiveOccupancy(monitor, { at: clock() }) })
          : apiError(404, "OCCUPANCY_MONITOR_NOT_FOUND", "Live Occupancy monitor not found");
      }
      const incidentCollectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/incident-registers$/);
      const incidentCommandMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/incident-registers\/([^/]+)\/commands:sync$/,
      );
      const incidentNestedExportMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/incident-registers\/([^/]+)\/incidents\/([^/]+)\/export$/,
      );
      const incidentExportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/incident-registers\/([^/]+)\/export$/);
      const incidentItemMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/incident-registers\/([^/]+)$/);
      if (incidentCollectionMatch && request.method === "POST") {
        if (!canWriteIncidents) return apiError(403, "INCIDENT_WRITE_DENIED", "Incident write role required");
        const projectId = pathCapture(incidentCollectionMatch, 1);
        if (!(await projects.get(organization.id, projectId)))
          return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        let body: Record<string, unknown>;
        try {
          body = await readObjectBody(request);
        } catch (cause) {
          return apiError(
            cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            "INCIDENT_BASELINE_INVALID",
            "Incident Register payload is invalid",
          );
        }
        if (typeof body.runbookVersionId !== "string" || !body.runbookVersionId.trim())
          return apiError(400, "INCIDENT_BASELINE_INVALID", "Runbook Version ID is required");
        const storedRunbook = await runbooks.getRunbook(organization.id, projectId, body.runbookVersionId);
        if (!storedRunbook) return apiError(404, "RUNBOOK_NOT_FOUND", "Runbook not found");
        try {
          const existing = await incidents.getByRunbook(organization.id, projectId, body.runbookVersionId);
          const bus = createIncidentCommandBus();
          bus.execute({
            type: "create_incident_register",
            projectId,
            runbook: repositoryRunbookToBrowserSnapshot(storedRunbook),
            createdAt: clock(),
            createdBy: account.user.id,
            actorType: "human",
          });
          const created = bus.getSnapshot();
          if (!created) throw venueError("INCIDENT_REGISTER_NOT_FOUND");
          const saved = await incidents.create(organization.id, projectId, created);
          return respond(
            { status: existing ? "already-applied" : "created", register: saved },
            { status: existing ? 200 : 201 },
          );
        } catch (cause) {
          const error = errorInfo(cause);
          if (cause instanceof IncidentRegisterConflict)
            return apiError(
              409,
              cause.code,
              error.message ?? "Incident Register conflicts with stored state",
              error.details,
            );
          if (error.code?.startsWith("INCIDENT_"))
            return apiError(400, error.code, error.message ?? "Incident Register baseline is invalid", error.details);
          throw cause;
        }
      }
      if (incidentCommandMatch && request.method === "POST") {
        if (!canWriteIncidents) return apiError(403, "INCIDENT_WRITE_DENIED", "Incident write role required");
        const projectId = pathCapture(incidentCommandMatch, 1);
        const registerId = pathCapture(incidentCommandMatch, 2);
        if (!(await projects.get(organization.id, projectId)))
          return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        let body: Record<string, unknown>;
        try {
          body = await readObjectBody(request);
        } catch (cause) {
          return apiError(
            cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            "INCIDENT_SYNC_INVALID",
            "Incident sync payload is invalid",
          );
        }
        if (!Array.isArray(body.commands) || body.commands.length > 100)
          return apiError(400, "INCIDENT_SYNC_INVALID", "Incident sync commands are invalid");
        const storedRegister = await incidents.get(organization.id, projectId, registerId);
        if (!storedRegister) return apiError(404, "INCIDENT_REGISTER_NOT_FOUND", "Incident Register not found");
        let current: IncidentRegister = storedRegister;
        const acknowledgements: Array<Record<string, unknown>> = [];
        for (const candidate of body.commands) {
          const command = isRecord(candidate) ? candidate : {};
          const identity = {
            idempotencyKey: typeof command.idempotencyKey === "string" ? command.idempotencyKey : null,
            operationId: typeof command.operationId === "string" ? command.operationId : null,
          };
          try {
            const emergencyAuthorityRole =
              command.type === "record_incident_emergency_action"
                ? ((current.baseline?.emergencyPlan?.authorizedReviewerRoles ?? []).find(
                    (role: unknown): role is OrganizationRole =>
                      isOrganizationRole(role) && organization.roles.includes(role),
                  ) ?? null)
                : null;
            if (command.type === "record_incident_emergency_action" && !emergencyAuthorityRole)
              throw venueError("AUTHORIZATION_DENIED", { permission: "incident.emergency-act" });
            const committedAt = clock();
            const bus = createIncidentCommandBus({ initialRegister: current });
            const isWebMcpReport =
              command.type === "report_incident" &&
              command.actorType === "agent" &&
              command.actorId === "webmcp-agent" &&
              command.source === "webmcp";
            const trustedCommand = incidentMutationCommand(
              command,
              account.user.id,
              account.session.id,
              committedAt,
              isWebMcpReport ? "webmcp" : "studio",
              emergencyAuthorityRole,
            );
            const resultValue: unknown = bus.execute(trustedCommand);
            if (!isIncidentMutationResult(resultValue))
              throw venueError("INCIDENT_INVALID", { reason: "mutation-result-invalid" });
            const result = resultValue;
            if (!result.duplicate) await incidents.put(organization.id, projectId, result.register, current.revision);
            current = result.register;
            acknowledgements.push({
              ...identity,
              status: result.duplicate ? "already-applied" : "applied",
              receipt: result.receipt,
            });
          } catch (cause) {
            const error = errorInfo(cause);
            if (
              cause instanceof IncidentRegisterConflict ||
              ["IDEMPOTENCY_KEY_CONFLICT", "INCIDENT_REVISION_CONFLICT"].includes(error.code ?? "")
            ) {
              acknowledgements.push({
                ...identity,
                status: "conflict",
                code: error.code ?? "INCIDENT_REGISTER_REVISION_CONFLICT",
                details: error.details,
              });
              continue;
            }
            if (
              ["AUTHORIZATION_DENIED", "IDEMPOTENCY_KEY_REQUIRED", "COMMAND_UNSUPPORTED"].includes(error.code ?? "") ||
              error.code?.startsWith("INCIDENT_")
            ) {
              acknowledgements.push({
                ...identity,
                status: "rejected",
                code: error.code ?? "INCIDENT_COMMAND_INVALID",
                details: error.details,
                message: error.message,
              });
              continue;
            }
            throw cause;
          }
        }
        return respond({ acknowledgements, register: current });
      }
      if ((incidentNestedExportMatch || incidentExportMatch) && request.method === "GET") {
        if (!canExportIncidents) return apiError(403, "INCIDENT_EXPORT_DENIED", "Incident export role required");
        const match = incidentNestedExportMatch ?? incidentExportMatch;
        if (!match) return apiError(404, "INCIDENT_EXPORT_ROUTE_INVALID", "Incident export route is invalid");
        const projectId = pathCapture(match, 1);
        const registerId = pathCapture(match, 2);
        const incidentId = incidentNestedExportMatch
          ? pathCapture(match, 3)
          : url.searchParams.get("incidentId")?.trim();
        if (!incidentId) return apiError(400, "INCIDENT_INVALID", "Incident ID is required");
        const current = await incidents.get(organization.id, projectId, registerId);
        if (!current) return apiError(404, "INCIDENT_REGISTER_NOT_FOUND", "Incident Register not found");
        try {
          return respond({
            artifact: createIncidentCommandBus({ initialRegister: current }).execute({
              type: "export_incident_record",
              incidentId,
              exportedAt: clock(),
            }),
          });
        } catch (cause) {
          const error = errorInfo(cause);
          return apiError(
            error.code === "INCIDENT_NOT_FOUND" ? 404 : 409,
            error.code ?? "INCIDENT_EXPORT_FAILED",
            error.message ?? "Incident export failed",
            error.details,
          );
        }
      }
      if (incidentItemMatch && request.method === "GET") {
        const projectId = pathCapture(incidentItemMatch, 1);
        const registerId = pathCapture(incidentItemMatch, 2);
        const register = await incidents.get(organization.id, projectId, registerId);
        return register
          ? respond({ register })
          : apiError(404, "INCIDENT_REGISTER_NOT_FOUND", "Incident Register not found");
      }
      const deviationCollectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/deviation-registers$/);
      const deviationCommandMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/deviation-registers\/([^/]+)\/commands:sync$/,
      );
      const deviationExportMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/deviation-registers\/([^/]+)\/export$/,
      );
      const deviationItemMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/deviation-registers\/([^/]+)$/);
      if (deviationCollectionMatch && request.method === "POST") {
        if (!canWriteDeviations)
          return apiError(403, "DEVIATION_WRITE_DENIED", "Live Plan Deviation write role required");
        const projectId = pathCapture(deviationCollectionMatch, 1);
        if (!(await projects.get(organization.id, projectId)))
          return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        let body: unknown;
        try {
          body = await readBody(request);
        } catch (cause) {
          return apiError(
            cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            "DEVIATION_BASELINE_INVALID",
            "Live Plan Deviation Register payload is invalid",
          );
        }
        try {
          const runbookVersionId = decodeDeviationCreateBody(body);
          const storedRunbook = await runbooks.getRunbook(organization.id, projectId, runbookVersionId);
          if (!storedRunbook) return apiError(404, "RUNBOOK_NOT_FOUND", "Runbook not found");
          const existing = await deviations.getByRunbook(organization.id, projectId, runbookVersionId);
          const bus = createDeviationCommandBus();
          bus.execute({
            type: "create_deviation_register",
            projectId,
            runbook: repositoryRunbookToBrowserSnapshot(storedRunbook),
            createdAt: clock(),
            createdBy: account.user.id,
          });
          const created = bus.getSnapshot();
          if (!created) throw venueError("DEVIATION_REGISTER_NOT_FOUND");
          const saved = await deviations.create(organization.id, projectId, created);
          return respond(
            { status: existing ? "already-applied" : "created", register: saved },
            { status: existing ? 200 : 201 },
          );
        } catch (cause) {
          const error = errorInfo(cause);
          if (cause instanceof DeviationRegisterConflict)
            return apiError(
              409,
              cause.code,
              error.message ?? "Live Plan Deviation Register conflicts with stored state",
              error.details,
            );
          if (error.code?.startsWith("DEVIATION_"))
            return apiError(
              400,
              error.code,
              error.message ?? "Live Plan Deviation Register baseline is invalid",
              error.details,
            );
          throw cause;
        }
      }
      if (deviationCommandMatch && request.method === "POST") {
        if (!canWriteDeviations)
          return apiError(403, "DEVIATION_WRITE_DENIED", "Live Plan Deviation write role required");
        const projectId = pathCapture(deviationCommandMatch, 1);
        const registerId = pathCapture(deviationCommandMatch, 2);
        if (!(await projects.get(organization.id, projectId)))
          return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        let candidates: readonly unknown[];
        try {
          candidates = decodeDeviationSyncBody(await readBody(request));
        } catch (cause) {
          return apiError(
            cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            "DEVIATION_SYNC_INVALID",
            "Live Plan Deviation sync payload is invalid",
            errorInfo(cause).details,
          );
        }
        const storedRegister = await deviations.get(organization.id, projectId, registerId);
        if (!storedRegister)
          return apiError(404, "DEVIATION_REGISTER_NOT_FOUND", "Live Plan Deviation Register not found");
        let current: LivePlanDeviationRegister = storedRegister;
        const acknowledgements: Array<Record<string, unknown>> = [];
        for (const candidate of candidates) {
          const untrusted = isRecord(candidate) ? candidate : {};
          const identity = {
            idempotencyKey: typeof untrusted.idempotencyKey === "string" ? untrusted.idempotencyKey : null,
            operationId: typeof untrusted.operationId === "string" ? untrusted.operationId : null,
          };
          try {
            if (untrusted.type === "create_post_event_deviation_proposal" && !canCreateDeviationProposals)
              throw venueError("AUTHORIZATION_DENIED", { permission: "deviation.post-event-proposal" });
            const committedAt = clock();
            const command = decodeDeviationMutationCommand(untrusted, {
              actorId: account.user.id,
              sessionId: account.session.id,
              committedAt,
            });
            const value: unknown = createDeviationCommandBus({ initialRegister: current }).execute(command);
            if (!isDeviationMutationResult(value))
              throw venueError("DEVIATION_INVALID", { reason: "mutation-result-invalid" });
            if (!value.duplicate)
              await deviations.put(organization.id, projectId, value.register, current.revision);
            current = value.register;
            acknowledgements.push({
              ...identity,
              status: value.duplicate ? "already-applied" : "applied",
              receipt: value.receipt,
              ...(value.proposal ? { proposal: value.proposal } : {}),
            });
          } catch (cause) {
            const error = errorInfo(cause);
            if (
              cause instanceof DeviationRegisterConflict ||
              [
                "IDEMPOTENCY_KEY_CONFLICT",
                "DEVIATION_REVISION_CONFLICT",
                "DEVIATION_REGISTER_REVISION_CONFLICT",
              ].includes(error.code ?? "")
            ) {
              acknowledgements.push({
                ...identity,
                status: "conflict",
                code: error.code ?? "DEVIATION_REGISTER_REVISION_CONFLICT",
                details: error.details,
              });
              continue;
            }
            if (
              ["AUTHORIZATION_DENIED", "IDEMPOTENCY_KEY_REQUIRED", "COMMAND_UNSUPPORTED"].includes(
                error.code ?? "",
              ) ||
              error.code?.startsWith("DEVIATION_")
            ) {
              acknowledgements.push({
                ...identity,
                status: "rejected",
                code: error.code ?? "DEVIATION_COMMAND_INVALID",
                details: error.details,
                message: error.message,
              });
              continue;
            }
            throw cause;
          }
        }
        return respond({
          acknowledgements,
          register: current,
          overlay: createDeviationCommandBus({ initialRegister: current }).execute({
            type: "inspect_live_plan_overlay",
          }),
        });
      }
      if (deviationExportMatch && request.method === "GET") {
        if (!canExportDeviations)
          return apiError(403, "DEVIATION_EXPORT_DENIED", "Live Plan Deviation export role required");
        const projectId = pathCapture(deviationExportMatch, 1);
        const registerId = pathCapture(deviationExportMatch, 2);
        const register = await deviations.get(organization.id, projectId, registerId);
        if (!register)
          return apiError(404, "DEVIATION_REGISTER_NOT_FOUND", "Live Plan Deviation Register not found");
        try {
          return respond({
            artifact: createDeviationCommandBus({ initialRegister: register }).execute({
              type: "export_live_plan_deviations",
              exportedAt: clock(),
            }),
          });
        } catch (cause) {
          const error = errorInfo(cause);
          return apiError(
            409,
            error.code ?? "DEVIATION_EXPORT_FAILED",
            error.message ?? "Live Plan Deviation export failed",
            error.details,
          );
        }
      }
      if (deviationItemMatch && request.method === "GET") {
        const projectId = pathCapture(deviationItemMatch, 1);
        const registerId = pathCapture(deviationItemMatch, 2);
        const register = await deviations.get(organization.id, projectId, registerId);
        return register
          ? respond({
              register,
              overlay: createDeviationCommandBus({ initialRegister: register }).execute({
                type: "inspect_live_plan_overlay",
              }),
            })
          : apiError(404, "DEVIATION_REGISTER_NOT_FOUND", "Live Plan Deviation Register not found");
      }
      const postEventCollectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/post-event-reviews$/);
      const postEventCommandMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/post-event-reviews\/([^/]+)\/commands:sync$/,
      );
      const postEventExportMatch = url.pathname.match(
        /^\/api\/projects\/([^/]+)\/post-event-reviews\/([^/]+)\/export$/,
      );
      const postEventItemMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/post-event-reviews\/([^/]+)$/);
      if (postEventCollectionMatch && request.method === "POST") {
        if (!canWritePostEvent)
          return apiError(403, "POST_EVENT_WRITE_DENIED", "Post-event Review write role required");
        const projectId = pathCapture(postEventCollectionMatch, 1);
        const project = await projects.get(organization.id, projectId);
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        let input;
        try {
          input = decodePostEventReviewCreateBody(await readBody(request));
        } catch (cause) {
          const error = errorInfo(cause);
          return apiError(
            cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            error.code ?? "POST_EVENT_BASELINE_INVALID",
            error.message ?? "Post-event Review payload is invalid",
            error.details,
          );
        }
        const storedRunbook = await runbooks.getRunbook(organization.id, projectId, input.runbookVersionId);
        if (!storedRunbook) return apiError(404, "RUNBOOK_NOT_FOUND", "Runbook not found");
        const occupancyMonitor = await occupancy.get(organization.id, projectId, input.occupancyMonitorId);
        if (!occupancyMonitor) return apiError(404, "OCCUPANCY_MONITOR_NOT_FOUND", "Occupancy Monitor not found");
        const incidentRegister = await incidents.get(organization.id, projectId, input.incidentRegisterId);
        if (!incidentRegister) return apiError(404, "INCIDENT_REGISTER_NOT_FOUND", "Incident Register not found");
        const deviationRegister = await deviations.get(organization.id, projectId, input.deviationRegisterId);
        if (!deviationRegister) return apiError(404, "DEVIATION_REGISTER_NOT_FOUND", "Live Plan Deviation Register not found");
        try {
          const scenarioRuns = input.scenarioRunIds.map((runId) => {
            const run = project.snapshot.scenarioRuns.find(({ id }) => id === runId);
            if (!run) throw venueError("POST_EVENT_BASELINE_INVALID", { reason: "scenario-run-not-found", runId });
            return run;
          });
          const existing = await postEventReviews.getByRunbook(organization.id, projectId, input.runbookVersionId);
          if (existing) {
            const sameDefinition =
              existing.baseline.occupancyMonitor.id === input.occupancyMonitorId &&
              existing.baseline.incidentRegister.id === input.incidentRegisterId &&
              existing.baseline.deviationRegister.id === input.deviationRegisterId &&
              stableFingerprint("post-event-scenario-ids", existing.baseline.scenarioRuns.map(({ id }) => id).sort()) ===
                stableFingerprint("post-event-scenario-ids", [...input.scenarioRunIds].sort()) &&
              stableFingerprint("post-event-predictions", existing.predictions) ===
                stableFingerprint(
                  "post-event-predictions",
                  input.predictions
                    .map((prediction) => ({
                      ...prediction,
                      evidenceRefs: [...prediction.evidenceRefs].sort((left, right) =>
                        `${left.kind}\0${left.id}`.localeCompare(`${right.kind}\0${right.id}`),
                      ),
                    }))
                    .sort((left, right) => left.key.localeCompare(right.key)),
                );
            if (!sameDefinition)
              throw new PostEventReviewConflict("POST_EVENT_REVIEW_ID_CONFLICT", {
                reviewId: existing.id,
                runbookVersionId: existing.runbookVersionId,
              });
            return respond({ status: "already-applied", review: existing });
          }
          const bus = createPostEventReviewCommandBus();
          bus.execute({
            type: "create_post_event_review",
            projectId,
            runbook: repositoryRunbookToBrowserSnapshot(storedRunbook),
            occupancyMonitor,
            occupancyProjection: evaluateFrozenPostEventOccupancy(occupancyMonitor, { at: clock() }),
            incidentRegister,
            deviationRegister,
            scenarioRuns,
            predictions: input.predictions,
            createdAt: clock(),
            createdBy: account.user.id,
          });
          const created = bus.getSnapshot();
          if (!created) throw venueError("POST_EVENT_REVIEW_NOT_FOUND");
          const saved = await postEventReviews.create(organization.id, projectId, created);
          return respond({ status: "created", review: saved }, { status: 201 });
        } catch (cause) {
          const error = errorInfo(cause);
          if (cause instanceof PostEventReviewConflict)
            return apiError(409, cause.code, error.message ?? "Post-event Review conflicts with stored state", error.details);
          if (error.code?.startsWith("POST_EVENT_"))
            return apiError(400, error.code, error.message ?? "Post-event Review baseline is invalid", error.details);
          throw cause;
        }
      }
      if (postEventCommandMatch && request.method === "POST") {
        if (!canWritePostEvent && !canCreatePostEventProposals && !canReviewPostEventProposals)
          return apiError(403, "POST_EVENT_WRITE_DENIED", "Post-event Review write role required");
        const projectId = pathCapture(postEventCommandMatch, 1);
        const reviewId = pathCapture(postEventCommandMatch, 2);
        if (!(await projects.get(organization.id, projectId)))
          return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        let candidates: readonly unknown[];
        try {
          candidates = decodePostEventReviewSyncBody(await readBody(request));
        } catch (cause) {
          const error = errorInfo(cause);
          return apiError(
            cause instanceof Error && cause.message === "PAYLOAD_TOO_LARGE" ? 413 : 400,
            "POST_EVENT_SYNC_INVALID",
            "Post-event Review sync payload is invalid",
            error.details,
          );
        }
        const storedReview = await postEventReviews.get(organization.id, projectId, reviewId);
        if (!storedReview) return apiError(404, "POST_EVENT_REVIEW_NOT_FOUND", "Post-event Review not found");
        let current: PostEventReview = storedReview;
        const acknowledgements: Array<Record<string, unknown>> = [];
        for (const candidate of candidates) {
          const untrusted = isRecord(candidate) ? candidate : {};
          const identity = {
            idempotencyKey: typeof untrusted.idempotencyKey === "string" ? untrusted.idempotencyKey : null,
            operationId: typeof untrusted.operationId === "string" ? untrusted.operationId : null,
          };
          try {
            if (
              (untrusted.type === "record_post_event_observation" || untrusted.type === "record_post_event_lesson") &&
              !canWritePostEvent
            ) throw venueError("AUTHORIZATION_DENIED", { permission: "post-event.write" });
            if (untrusted.type === "create_template_improvement_proposal" && !canCreatePostEventProposals)
              throw venueError("AUTHORIZATION_DENIED", { permission: "post-event.template-proposal.create" });
            if (untrusted.type === "review_template_improvement_proposal" && !canReviewPostEventProposals)
              throw venueError("AUTHORIZATION_DENIED", { permission: "post-event.template-proposal.review" });
            const command = decodePostEventReviewMutationCommand(untrusted, {
              actorId: account.user.id,
              sessionId: account.session.id,
              committedAt: clock(),
            });
            const value: unknown = createPostEventReviewCommandBus({ initialReview: current }).execute(command);
            if (!isPostEventMutationResult(value))
              throw venueError("POST_EVENT_INVALID", { reason: "mutation-result-invalid" });
            if (!value.duplicate)
              await postEventReviews.put(organization.id, projectId, value.review, current.revision);
            current = value.review;
            acknowledgements.push({
              ...identity,
              status: value.duplicate ? "already-applied" : "applied",
              receipt: value.receipt,
              subject: value.subject,
            });
          } catch (cause) {
            const error = errorInfo(cause);
            if (
              cause instanceof PostEventReviewConflict ||
              ["IDEMPOTENCY_KEY_CONFLICT", "POST_EVENT_REVISION_CONFLICT"].includes(error.code ?? "")
            ) {
              acknowledgements.push({ ...identity, status: "conflict", code: error.code ?? "POST_EVENT_REVIEW_REVISION_CONFLICT", details: error.details });
              continue;
            }
            if (
              ["AUTHORIZATION_DENIED", "IDEMPOTENCY_KEY_REQUIRED", "COMMAND_UNSUPPORTED"].includes(error.code ?? "") ||
              error.code?.startsWith("POST_EVENT_")
            ) {
              acknowledgements.push({ ...identity, status: "rejected", code: error.code ?? "POST_EVENT_COMMAND_INVALID", details: error.details, message: error.message });
              continue;
            }
            throw cause;
          }
        }
        const inspected = createPostEventReviewCommandBus({ initialReview: current }).execute({ type: "inspect_post_event_review" });
        return respond({ acknowledgements, ...inspected });
      }
      if (postEventExportMatch && request.method === "GET") {
        if (!canExportPostEvent)
          return apiError(403, "POST_EVENT_EXPORT_DENIED", "Post-event Review export role required");
        const projectId = pathCapture(postEventExportMatch, 1);
        const reviewId = pathCapture(postEventExportMatch, 2);
        const review = await postEventReviews.get(organization.id, projectId, reviewId);
        if (!review) return apiError(404, "POST_EVENT_REVIEW_NOT_FOUND", "Post-event Review not found");
        try {
          return respond({ artifact: createPostEventReviewCommandBus({ initialReview: review }).execute({ type: "export_post_event_report", format: url.searchParams.get("format") === "text" ? "text" : "json", exportedAt: clock() }) });
        } catch (cause) {
          const error = errorInfo(cause);
          return apiError(409, error.code ?? "POST_EVENT_EXPORT_FAILED", error.message ?? "Post-event Review export failed", error.details);
        }
      }
      if (postEventItemMatch && request.method === "GET") {
        const projectId = pathCapture(postEventItemMatch, 1);
        const reviewId = pathCapture(postEventItemMatch, 2);
        const review = await postEventReviews.get(organization.id, projectId, reviewId);
        return review
          ? respond(createPostEventReviewCommandBus({ initialReview: review }).execute({ type: "inspect_post_event_review" }))
          : apiError(404, "POST_EVENT_REVIEW_NOT_FOUND", "Post-event Review not found");
      }
      if (url.pathname === "/api/notifications" && request.method === "GET")
        return respond({ notifications: await sharing.listNotifications(account.user.id, organization.id) });
      if (url.pathname === "/api/notification-preferences" && request.method === "GET")
        return respond(await sharing.preferences(account.user.id));
      if (url.pathname === "/api/notification-preferences" && request.method === "PUT") {
        const body = await readBody(request);
        try {
          return respond(await sharing.setPreferences(account.user.id, body, clock()));
        } catch {
          return apiError(400, "NOTIFICATION_PREFERENCES_INVALID", "Notification preferences are invalid");
        }
      }
      const notificationReadMatch = url.pathname.match(/^\/api\/notifications\/([^/]+)\/read$/);
      if (notificationReadMatch && request.method === "POST") {
        await sharing.markRead(account.user.id, organization.id, pathCapture(notificationReadMatch, 1), clock());
        return respond({ status: "read" });
      }
      if (url.pathname === "/api/notifications/email/drain" && request.method === "POST") {
        if (!admin) return apiError(403, "ORGANIZATION_ADMIN_REQUIRED", "Organization administrator required");
        return respond(
          await drainNotificationEmail({
            repository: sharing,
            delivery: options.emailDelivery ?? env.EMAIL_DELIVERY,
            organizationId: organization.id,
            clock,
          }),
        );
      }

      const shareCollectionMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/share-links$/);
      if (shareCollectionMatch && request.method === "GET") {
        if (!hasRole(organization.roles, SHARE_MANAGEMENT_ROLES))
          return apiError(403, "SHARE_LINK_DENIED", "Share-link management role required");
        const projectId = pathCapture(shareCollectionMatch, 1);
        if (!(await projects.get(organization.id, projectId)))
          return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        await reconcileShareOperations(env, { organizationId: organization.id, projectId });
        return respond({
          links: (await sharing.listLinks(organization.id, projectId)).map(({ tokenHash: _tokenHash, ...link }) => ({
            ...link,
            status:
              link.lifecycleState === "pending-create"
                ? "pending"
                : ["pending-revoke", "revoked"].includes(link.lifecycleState)
                  ? "revoked"
                  : shareLinkStatus(link, clock()),
          })),
        });
      }
      if (shareCollectionMatch && request.method === "POST") {
        if (!hasRole(organization.roles, SHARE_MANAGEMENT_ROLES))
          return apiError(403, "SHARE_LINK_DENIED", "Share-link management role required");
        const projectId = pathCapture(shareCollectionMatch, 1);
        const current = await projects.get(organization.id, projectId);
        if (!current) return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        const body = await readObjectBody(request);
        const nowMs = Date.parse(clock());
        const expiresAt = typeof body.expiresAt === "string" ? body.expiresAt : "";
        const expiresAtMs = Date.parse(expiresAt);
        const canonicalExpiry = Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null;
        if (
          !isShareScope(body.scope) ||
          !expiresAt ||
          canonicalExpiry !== expiresAt ||
          expiresAtMs <= nowMs ||
          expiresAtMs > nowMs + 30 * 24 * 60 * 60 * 1000 ||
          (body.scope === "read-only" && body.proposalId != null)
        )
          return apiError(400, "SHARE_LINK_INVALID", "Share link fields are invalid");
        const snapshot = current.snapshot;
        const proposalIds = new Set(retainedProposals(snapshot).map((proposal) => proposal.id));
        const proposalId = typeof body.proposalId === "string" ? body.proposalId : null;
        if (body.scope === "reviewer" && (!proposalId || !proposalIds.has(proposalId)))
          return apiError(400, "SHARE_PROPOSAL_INVALID", "Reviewer link requires one retained Proposal");
        const id = `share-${crypto.randomUUID()}`;
        const token = createShareToken();
        const tokenHash = await hashShareToken(token);
        const createdAt = clock();
        await sharing.createLink({
          id,
          organizationId: organization.id,
          projectId,
          proposalId: body.scope === "reviewer" ? proposalId : null,
          scope: body.scope,
          tokenHash,
          createdBy: account.user.id,
          createdAt,
          expiresAt,
        });
        const reconciliation = await reconcileShareOperations(env, { linkId: id, limit: 1 });
        const link = (await sharing.listLinks(organization.id, projectId)).find((item) => item.id === id);
        const saved = await projects.get(organization.id, projectId);
        const active = link?.lifecycleState === "active";
        return respond(
          {
            id,
            status: active ? "active" : "pending",
            scope: body.scope,
            proposalId: body.scope === "reviewer" ? proposalId : null,
            expiresAt,
            token,
            url: `/share/${token}`,
            projectRevision: saved?.revision ?? current.revision,
            ...(active ? {} : { recovery: reconciliation[0]?.error ?? "SHARE_RECONCILIATION_PENDING" }),
          },
          { status: active ? 201 : 202 },
        );
      }
      const shareRevokeMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/share-links\/([^/]+)\/revoke$/);
      if (shareRevokeMatch && request.method === "POST") {
        if (!hasRole(organization.roles, SHARE_MANAGEMENT_ROLES))
          return apiError(403, "SHARE_LINK_DENIED", "Share-link management role required");
        const projectId = pathCapture(shareRevokeMatch, 1);
        const linkId = pathCapture(shareRevokeMatch, 2);
        await reconcileShareOperations(env, { organizationId: organization.id, projectId, linkId, limit: 1 });
        const revoked = await sharing.beginRevoke(organization.id, projectId, linkId, account.user.id, clock());
        if (!revoked) return apiError(404, "SHARE_LINK_NOT_FOUND", "Share link not found");
        if (revoked.link.lifecycleState === "revoked") {
          const current = await projects.get(organization.id, projectId);
          return respond({
            status: "already-revoked",
            id: linkId,
            revokedAt: revoked.link.revokedAt,
            projectRevision: current?.revision ?? null,
          });
        }
        const reconciliation = await reconcileShareOperations(env, { linkId, limit: 1 });
        const finalLink = (await sharing.listLinks(organization.id, projectId)).find((item) => item.id === linkId);
        const current = await projects.get(organization.id, projectId);
        const complete = finalLink?.lifecycleState === "revoked";
        return respond(
          {
            status: complete ? "revoked" : "pending-revoke",
            id: linkId,
            revokedAt: finalLink?.revokedAt ?? revoked.link.revokedAt,
            projectRevision: current?.revision ?? null,
            ...(complete ? {} : { recovery: reconciliation[0]?.error ?? "SHARE_RECONCILIATION_PENDING" }),
          },
          { status: complete ? 200 : 202 },
        );
      }
      const collaborationMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/collaboration$/);
      const presenceMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/collaboration\/presence$/);
      if (collaborationMatch && request.method === "GET") {
        const projectId = pathCapture(collaborationMatch, 1);
        const project = await projects.get(organization.id, projectId);
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        const afterValue = request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? "0";
        const after = Number(afterValue);
        if (!Number.isSafeInteger(after) || after < 0)
          return apiError(400, "COLLABORATION_CURSOR_INVALID", "Collaboration cursor is invalid");
        const collaboration = collaborationRepositoryFactory(env.DB);
        const batch = await collaboration.events(organization.id, projectId, after, 100);
        const presence = await collaboration.presence(organization.id, projectId, clock());
        const chunks = ["retry: 1500", `event: presence.snapshot\ndata: ${JSON.stringify({ presence })}`];
        if (batch.missed)
          chunks.push(
            `id: ${batch.cursor}\nevent: sync.reset\ndata: ${JSON.stringify({ projectId, revision: project.revision, cursor: batch.cursor })}`,
          );
        for (const event of batch.events)
          chunks.push(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}`);
        chunks.push(
          `event: sync.cursor\ndata: ${JSON.stringify({ cursor: batch.cursor, revision: project.revision })}`,
        );
        const response = new Response(`${chunks.join("\n\n")}\n\n`, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            "x-collaboration-cursor": String(batch.cursor),
          },
        });
        for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
        return response;
      }
      if (presenceMatch && request.method === "PUT") {
        const projectId = pathCapture(presenceMatch, 1);
        const project = await projects.get(organization.id, projectId);
        if (!project) return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        const body = await readObjectBody(request);
        if (
          typeof body.planVersion !== "string" ||
          !body.planVersion ||
          (body.focusedObjectId !== undefined &&
            body.focusedObjectId !== null &&
            typeof body.focusedObjectId !== "string")
        )
          return apiError(400, "PRESENCE_INVALID", "Presence payload is invalid");
        const focusableIds = new Set([
          ...project.snapshot.plan.objects.map((object) => object.id),
          ...project.snapshot.proposal.changes.flatMap((change) => change.targetObjectIds ?? []),
        ]);
        const focusedObjectId = typeof body.focusedObjectId === "string" ? body.focusedObjectId : null;
        if (focusedObjectId && !focusableIds.has(focusedObjectId))
          return apiError(400, "PRESENCE_FOCUS_INVALID", "Focused object is unavailable");
        const viewport =
          body.viewport === null || body.viewport === undefined ? null : isRecord(body.viewport) ? body.viewport : null;
        if (body.viewport !== null && body.viewport !== undefined && viewport === null)
          return apiError(400, "PRESENCE_VIEWPORT_INVALID", "Presence viewport is invalid");
        if (
          viewport &&
          (Object.keys(viewport).some((key) => !["x", "y", "zoom", "width", "height"].includes(key)) ||
            Object.values(viewport).some((item) => typeof item !== "number" || !Number.isFinite(item)) ||
            (typeof viewport.zoom === "number" && viewport.zoom <= 0))
        )
          return apiError(400, "PRESENCE_VIEWPORT_INVALID", "Presence viewport is invalid");
        const now = clock();
        const expiresAt = new Date(Date.parse(now) + 30_000).toISOString();
        const value = await collaborationRepositoryFactory(env.DB).upsertPresence({
          organizationId: organization.id,
          projectId,
          sessionId: account.session.id,
          userId: account.user.id,
          displayName: account.user.displayName || account.user.email,
          planVersion: body.planVersion,
          focusedObjectId,
          viewport,
          lastSeenAt: now,
          expiresAt,
        });
        return respond(value);
      }
      if (presenceMatch && request.method === "DELETE") {
        const projectId = pathCapture(presenceMatch, 1);
        await collaborationRepositoryFactory(env.DB).removePresence(
          organization.id,
          projectId,
          account.session.id,
          account.user.id,
        );
        return respond({ status: "offline" });
      }
      if (url.pathname === "/api/projects" && request.method === "GET")
        return respond({ organizationId: organization.id, projects: await projects.list(organization.id) });
      if (url.pathname.startsWith("/api/projects/") && request.method === "GET") {
        const projectId = projectIdFrom(url.pathname);
        const record = await projects.get(organization.id, projectId);
        if (!record) return apiError(404, "PROJECT_NOT_FOUND", "Project not found");
        if (record.schemaVersion !== 10)
          return apiError(409, "PROJECT_SCHEMA_UNSUPPORTED", "Project schema is unsupported", {
            schemaVersion: record.schemaVersion,
            supportedSchemaVersion: 10,
          });
        return respond(record, { headers: { etag: projectEtag(record.id, record.revision) } });
      }
      if (url.pathname.startsWith("/api/projects/") && request.method === "PUT") {
        const projectId = projectIdFrom(url.pathname);
        let rawBody: Record<string, unknown>;
        try {
          rawBody = await readObjectBody(request);
        } catch {
          return apiError(413, "PAYLOAD_TOO_LARGE", "Project payload too large");
        }
        if (typeof rawBody.organizationId === "string" && rawBody.organizationId !== organization.id)
          return apiError(403, "ORGANIZATION_ACCESS_DENIED", "Project organization does not match active organization");
        const bodyCandidate = {
          ...rawBody,
          organizationId: organization.id,
          archivedAt: rawBody.archivedAt ?? null,
          deletedAt: rawBody.deletedAt ?? null,
          recoveryUntil: rawBody.recoveryUntil ?? null,
          pinned: rawBody.pinned ?? false,
          lastOpenedAt: rawBody.lastOpenedAt ?? null,
        };
        if (!isLocalProjectRecord(bodyCandidate) || bodyCandidate.id !== projectId)
          return apiError(400, "PROJECT_INVALID", "Invalid project record");
        const body = bodyCandidate;
        if (!hasRole(organization.roles, RUNBOOK_WRITE_ROLES))
          return apiError(403, "PROJECT_WRITE_DENIED", "Project write role required");
        const snapshot = body.snapshot;
        try {
          const planner = createVenuePlanner(
            { ...snapshot.plan, brief: snapshot.brief, proposal: snapshot.proposal },
            { observability: requestObservability },
          );
          await planner.execute({ type: "restore_snapshot", snapshot, correlationId });
        } catch (cause) {
          const error = errorInfo(cause);
          return apiError(
            400,
            error.code ?? "PROJECT_INVALID",
            error.message ?? "Project snapshot is invalid",
            error.details,
          );
        }
        const record = body;
        const current = await projects.get(organization.id, projectId);
        const createOnly = request.headers.get("if-none-match") === "*";
        const ifMatch = request.headers.get("if-match");
        if (createOnly && ifMatch)
          return apiError(400, "PROJECT_PRECONDITION_INVALID", "Choose one Project write precondition");
        if (createOnly && current)
          return apiError(
            409,
            "PROJECT_ID_CONFLICT",
            "Project already exists",
            { current, currentEtag: projectEtag(current.id, current.revision) },
            { etag: projectEtag(current.id, current.revision) },
          );
        if (!createOnly && !current)
          return apiError(412, "PROJECT_REVISION_CONFLICT", "Project revision is unavailable", {
            current: null,
            expectedRevision: null,
          });
        if (!createOnly && !ifMatch)
          return apiError(428, "PROJECT_PRECONDITION_REQUIRED", "If-Match is required for an existing Project");
        const expectedRevision = ifMatch ? parseProjectEtag(ifMatch, projectId) : null;
        if (!createOnly && expectedRevision === null)
          return apiError(400, "PROJECT_ETAG_INVALID", "Project ETag is invalid");
        if (!createOnly && body.revision !== undefined && body.revision !== expectedRevision)
          return apiError(400, "PROJECT_REVISION_INVALID", "Project body revision does not match If-Match");
        const persistenceSpan = startTelemetrySpan(requestObservability, {
          component: "repository",
          operation: "persistence",
          correlationId,
          action: "project.put",
        });
        try {
          const saved = await projects.put(organization.id, record, { createOnly, expectedRevision });
          persistenceSpan.end("ok");
          const collaboration = collaborationRepositoryFactory(env.DB);
          const collaborationTypes = projectCollaborationEventTypes(current, saved);
          for (const type of collaborationTypes) {
            await collaboration.append({
              organizationId: organization.id,
              projectId,
              type,
              actorUserId: account.user.id,
              sessionId: account.session.id,
              projectRevision: saved.revision,
              payload: collaborationEventPayload(type, current, saved),
              occurredAt: clock(),
            });
          }
          const currentLedgerLength = current?.snapshot.ledger.length ?? 0;
          const newLedger = saved.snapshot.ledger.slice(currentLedgerLength);
          if (newLedger.some((entry) => entry.type === "proposal.adjustment_requested"))
            await notifyOrganization("adjustment_requested", saved, { proposalId: saved.snapshot.proposal.id });
          else if (collaborationTypes.includes("approval.committed"))
            await notifyOrganization("approval_completed", saved, { planVersion: saved.snapshot.plan.version });
          else if (collaborationTypes.includes("proposal.updated"))
            await notifyOrganization("review_requested", saved, { proposalId: saved.snapshot.proposal.id });
          return respond(saved, {
            status: createOnly ? 201 : 200,
            headers: {
              etag: projectEtag(saved.id, saved.revision),
              "x-correlation-id": correlationId,
            },
          });
        } catch (cause) {
          if (
            cause instanceof ProjectRevisionConflict ||
            (cause instanceof Error && cause.message === "PROJECT_REVISION_CONFLICT")
          ) {
            persistenceSpan.end("conflict", "PROJECT_REVISION_CONFLICT");
            startTelemetrySpan(requestObservability, {
              component: "repository",
              operation: "conflict",
              correlationId,
              action: "project.revision",
            }).end("conflict", "PROJECT_REVISION_CONFLICT");
            const latest =
              cause instanceof ProjectRevisionConflict ? cause.current : await projects.get(organization.id, projectId);
            const preferences = await sharing.preferences(account.user.id);
            if (
              latest &&
              preferences.eventTypes.includes("conflict_detected") &&
              (preferences.inAppEnabled || preferences.emailEnabled)
            ) {
              const notification = safeNotification({
                id: `notification-${crypto.randomUUID()}`,
                organizationId: organization.id,
                projectId,
                userId: account.user.id,
                eventType: "conflict_detected",
                refs: { projectId, revision: latest.revision, conflictCode: "PROJECT_REVISION_CONFLICT" },
                createdAt: clock(),
              });
              await sharing.addNotification(notification, {
                inAppEnabled: preferences.inAppEnabled,
                recipientEmail: preferences.emailEnabled ? account.user.email : null,
              });
            }
            return apiError(
              412,
              "PROJECT_REVISION_CONFLICT",
              "Project revision is stale",
              {
                current: latest,
                expectedRevision,
                currentRevision: latest?.revision ?? null,
                currentEtag: latest ? projectEtag(latest.id, latest.revision) : null,
              },
              latest ? { etag: projectEtag(latest.id, latest.revision) } : undefined,
            );
          }
          if (cause instanceof Error && cause.message === "PROJECT_ID_CONFLICT") {
            persistenceSpan.end("conflict", "PROJECT_ID_CONFLICT");
            return apiError(409, "PROJECT_ID_CONFLICT", "Project ID belongs to another organization");
          }
          persistenceSpan.end(
            "failed",
            telemetryErrorCode(cause instanceof Error ? cause : new Error("PERSISTENCE_FAILED")),
          );
          throw cause;
        }
      }
      return apiError(404, "NOT_FOUND", "Not found");
    },
    async scheduled(
      _controller: unknown,
      env: WorkerEnv,
      context?: { waitUntil?: (promise: Promise<unknown>) => void },
    ) {
      const retention = options.createProjectRepository && !options.createDataProtectionRepository
        ? Promise.resolve(null)
        : dataProtectionRepositoryFactory(env.DB).sweepRetention(50).then((summary) => {
            log({
              event: "retention.sweep_completed",
              status: 200,
              count: summary.deleted.projects + summary.deleted.runbooks + summary.deleted.securityAuditEvents + summary.deleted.deletionEvidence + summary.deleted.backupEvidence,
              occurredAt: summary.completedAt,
            });
            return summary;
          });
      const task = Promise.all([
        reconcileShareOperations(env, { limit: 100 }),
        drainNotificationEmail({
          repository: sharingRepositoryFactory(env.DB),
          delivery: options.emailDelivery ?? env.EMAIL_DELIVERY,
          clock,
        }),
        retention,
      ]);
      if (context?.waitUntil) {
        context.waitUntil(task);
        return;
      }
      await task;
    },
  };
}

export default createWorker();
