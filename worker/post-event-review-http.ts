import { venueError } from "../src/domain/errors.ts";
import type { PlanningChange } from "../src/domain/planning-effects.ts";
import type {
  CreateTemplateImprovementProposalCommand,
  PostEventEvidenceKind,
  PostEventEvidenceRef,
  PostEventMetric,
  PostEventMetricUnit,
  PostEventPrediction,
  PostEventReviewCommandContext,
  RecordPostEventLessonCommand,
  RecordPostEventObservationCommand,
  ReviewTemplateImprovementProposalCommand,
} from "../src/domain/post-event-review-types.ts";
import { decodeDeviationPlanningChange } from "./deviation-http.ts";

export interface TrustedPostEventIdentity {
  readonly actorId: string;
  readonly sessionId: string;
  readonly committedAt: string;
}
export interface PostEventReviewCreateInput {
  readonly runbookVersionId: string;
  readonly occupancyMonitorId: string;
  readonly incidentRegisterId: string;
  readonly deviationRegisterId: string;
  readonly scenarioRunIds: readonly string[];
  readonly predictions: readonly PostEventPrediction[];
}
export type TrustedPostEventMutationCommand =
  | RecordPostEventObservationCommand
  | RecordPostEventLessonCommand
  | CreateTemplateImprovementProposalCommand
  | ReviewTemplateImprovementProposalCommand;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const invalid = (reason: string, field?: string): never => {
  throw venueError("POST_EVENT_INVALID", { reason, ...(field ? { field } : {}) });
};
const exact = (value: unknown, allowed: readonly string[], field: string): Record<string, unknown> => {
  if (!isRecord(value)) return invalid("object-required", field);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unexpected.length) return invalid("unknown-fields", field);
  return value;
};
const string = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim()) return invalid("field-required", field);
  return value.trim();
};
const finite = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) return invalid("finite-number-required", field);
  return value;
};
const integer = (value: unknown, field: string): number => {
  const result = finite(value, field);
  if (!Number.isSafeInteger(result) || result < 0) return invalid("non-negative-integer-required", field);
  return result;
};
const strings = (value: unknown, field: string, maximum = 100): string[] => {
  if (!Array.isArray(value) || value.length > maximum) return invalid("list-required", field);
  const result = value.map((item, index) => string(item, `${field}[${index}]`));
  if (new Set(result).size !== result.length) return invalid("duplicate-list-item", field);
  return result;
};

const evidenceKinds: readonly PostEventEvidenceKind[] = [
  "accepted-plan",
  "runbook",
  "occupancy-monitor",
  "occupancy-projection",
  "incident-register",
  "deviation-register",
  "scenario-run",
];
const evidenceRef = (value: unknown, field: string): PostEventEvidenceRef => {
  const record = exact(value, ["kind", "id", "fingerprint"], field);
  const kind = evidenceKinds.find((candidate) => candidate === record["kind"]);
  if (!kind) return invalid("evidence-kind-invalid", `${field}.kind`);
  return { kind, id: string(record["id"], `${field}.id`), fingerprint: string(record["fingerprint"], `${field}.fingerprint`) };
};
const evidenceRefs = (value: unknown, field: string): PostEventEvidenceRef[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) return invalid("evidence-list-invalid", field);
  return value.map((item, index) => evidenceRef(item, `${field}[${index}]`));
};

const metrics: readonly PostEventMetric[] = [
  "peak-persons", "utilization-ratio", "average-wait-seconds", "p95-wait-seconds",
  "maximum-queue-persons", "abandonment-ratio", "clearance-seconds", "peak-congestion-index",
  "backlog-persons", "incident-count", "resolution-seconds",
];
const units: readonly PostEventMetricUnit[] = ["persons", "ratio", "seconds", "index", "incidents"];
const families: readonly PostEventPrediction["family"][] = ["occupancy", "queue", "flow", "incidents"];
const scopeKinds: readonly PostEventPrediction["scope"]["kind"][] = [
  "venue", "occupancy-zone", "queue", "route", "incident-category",
];
const betterDirections: readonly PostEventPrediction["betterWhen"][] = ["lower", "higher", "target"];
const observationConfidences: readonly RecordPostEventObservationCommand["confidence"][] = [
  "measured", "estimated", "unavailable",
];
const prediction = (value: unknown, field: string): PostEventPrediction => {
  const record = exact(value, ["key", "family", "metric", "scope", "value", "unit", "betterWhen", "tolerance", "evidenceRefs"], field);
  const family = families.find((candidate) => candidate === record["family"]);
  const metric = metrics.find((candidate) => candidate === record["metric"]);
  const unit = units.find((candidate) => candidate === record["unit"]);
  const betterWhen = betterDirections.find((candidate) => candidate === record["betterWhen"]);
  if (!family || !metric || !unit || !betterWhen) return invalid("prediction-enum-invalid", field);
  const scopeRecord = exact(record["scope"], ["kind", "id"], `${field}.scope`);
  const scopeKind = scopeKinds.find(
    (candidate) => candidate === scopeRecord["kind"],
  );
  if (!scopeKind) return invalid("scope-kind-invalid", `${field}.scope.kind`);
  const tolerance = exact(record["tolerance"], ["absolute", "relative"], `${field}.tolerance`);
  return {
    key: string(record["key"], `${field}.key`),
    family,
    metric,
    scope: { kind: scopeKind, id: string(scopeRecord["id"], `${field}.scope.id`) },
    value: finite(record["value"], `${field}.value`),
    unit,
    betterWhen,
    tolerance: { absolute: finite(tolerance["absolute"], `${field}.tolerance.absolute`), relative: finite(tolerance["relative"], `${field}.tolerance.relative`) },
    evidenceRefs: evidenceRefs(record["evidenceRefs"], `${field}.evidenceRefs`),
  };
};

const effectValue = (value: unknown, field: string): NonNullable<PlanningChange["effects"]>[string] => {
  if (value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  const record = exact(value, ["kind", "sourceId", "sourceChecksum"], field);
  return {
    kind: string(record["kind"], `${field}.kind`),
    sourceId: string(record["sourceId"], `${field}.sourceId`),
    sourceChecksum: string(record["sourceChecksum"], `${field}.sourceChecksum`),
  };
};
const change = (value: unknown, field: string): PlanningChange => {
  if (isRecord(value) && value["spatialEffects"] !== undefined) return decodeDeviationPlanningChange(value, field);
  const record = exact(value, ["id", "title", "shortTitle", "label", "targetObjectIds", "targetRequirementIds", "effects"], field);
  const effectsRecord = record["effects"] === undefined
    ? undefined
    : isRecord(record["effects"])
      ? record["effects"]
      : invalid("object-required", `${field}.effects`);
  return {
    id: string(record["id"], `${field}.id`),
    ...(record["title"] === undefined ? {} : { title: string(record["title"], `${field}.title`) }),
    ...(record["shortTitle"] === undefined ? {} : { shortTitle: string(record["shortTitle"], `${field}.shortTitle`) }),
    ...(record["label"] === undefined ? {} : { label: string(record["label"], `${field}.label`) }),
    ...(record["targetObjectIds"] === undefined ? {} : { targetObjectIds: strings(record["targetObjectIds"], `${field}.targetObjectIds`) }),
    ...(record["targetRequirementIds"] === undefined ? {} : { targetRequirementIds: strings(record["targetRequirementIds"], `${field}.targetRequirementIds`) }),
    ...(effectsRecord === undefined ? {} : { effects: Object.fromEntries(Object.entries(effectsRecord).map(([key, item]) => [key, effectValue(item, `${field}.effects.${key}`)])) }),
  };
};

export function decodePostEventReviewCreateBody(value: unknown): PostEventReviewCreateInput {
  const body = exact(value, ["runbookVersionId", "occupancyMonitorId", "incidentRegisterId", "deviationRegisterId", "scenarioRunIds", "predictions"], "body");
  if (!Array.isArray(body["predictions"]) || body["predictions"].length === 0 || body["predictions"].length > 100)
    return invalid("predictions-invalid", "predictions");
  return {
    runbookVersionId: string(body["runbookVersionId"], "runbookVersionId"),
    occupancyMonitorId: string(body["occupancyMonitorId"], "occupancyMonitorId"),
    incidentRegisterId: string(body["incidentRegisterId"], "incidentRegisterId"),
    deviationRegisterId: string(body["deviationRegisterId"], "deviationRegisterId"),
    scenarioRunIds: strings(body["scenarioRunIds"], "scenarioRunIds"),
    predictions: body["predictions"].map((item, index) => prediction(item, `predictions[${index}]`)),
  };
}

export function decodePostEventReviewSyncBody(value: unknown): readonly unknown[] {
  const body = exact(value, ["commands"], "body");
  if (!Array.isArray(body["commands"]) || body["commands"].length > 100) return invalid("commands-invalid", "commands");
  return body["commands"];
}

export function decodePostEventReviewMutationCommand(
  value: unknown,
  identity: TrustedPostEventIdentity,
): TrustedPostEventMutationCommand {
  if (!isRecord(value) || typeof value["type"] !== "string") return invalid("command-type-required", "type");
  const common: Pick<PostEventReviewCommandContext, "actorType" | "actorId" | "source" | "sessionId" | "committedAt"> = {
    actorType: "human",
    actorId: identity.actorId,
    source: "studio",
    sessionId: identity.sessionId,
    committedAt: identity.committedAt,
  };
  if (value["type"] === "record_post_event_observation") {
    const record = exact(value, ["type", "observationId", "predictionKey", "value", "confidence", "evidenceRefs", "idempotencyKey", "expectedRevision", "operationId"], "command");
    const confidence = observationConfidences.find((candidate) => candidate === record["confidence"]);
    if (!confidence) return invalid("confidence-invalid", "confidence");
    if (record["value"] !== null && typeof record["value"] !== "number") return invalid("observation-value-invalid", "value");
    return { ...common, type: "record_post_event_observation", observationId: string(record["observationId"], "observationId"), predictionKey: string(record["predictionKey"], "predictionKey"), value: record["value"] === null ? null : finite(record["value"], "value"), confidence, evidenceRefs: evidenceRefs(record["evidenceRefs"], "evidenceRefs"), idempotencyKey: string(record["idempotencyKey"], "idempotencyKey"), expectedRevision: integer(record["expectedRevision"], "expectedRevision") };
  }
  if (value["type"] === "record_post_event_lesson") {
    const record = exact(value, ["type", "lessonId", "comparisonKey", "lessonCode", "findingCode", "recommendedActionCode", "requirementIds", "constraintIds", "idempotencyKey", "expectedRevision", "operationId"], "command");
    return { ...common, type: "record_post_event_lesson", lessonId: string(record["lessonId"], "lessonId"), comparisonKey: string(record["comparisonKey"], "comparisonKey"), lessonCode: string(record["lessonCode"], "lessonCode"), findingCode: string(record["findingCode"], "findingCode"), recommendedActionCode: string(record["recommendedActionCode"], "recommendedActionCode"), requirementIds: strings(record["requirementIds"], "requirementIds"), constraintIds: strings(record["constraintIds"], "constraintIds"), idempotencyKey: string(record["idempotencyKey"], "idempotencyKey"), expectedRevision: integer(record["expectedRevision"], "expectedRevision") };
  }
  if (value["type"] === "create_template_improvement_proposal") {
    const record = exact(value, ["type", "proposalId", "goal", "target", "changes", "changeLessonLinks", "idempotencyKey", "expectedRevision", "operationId"], "command");
    const targetRecord = exact(record["target"], ["kind", "templateId", "version"], "target");
    if (targetRecord["kind"] !== "venue" && targetRecord["kind"] !== "room") return invalid("target-kind-invalid", "target.kind");
    if (!Array.isArray(record["changes"]) || !Array.isArray(record["changeLessonLinks"])) return invalid("proposal-lists-invalid", "command");
    return { ...common, type: "create_template_improvement_proposal", proposalId: string(record["proposalId"], "proposalId"), goal: string(record["goal"], "goal"), target: { kind: targetRecord["kind"], templateId: string(targetRecord["templateId"], "target.templateId"), version: string(targetRecord["version"], "target.version") }, changes: record["changes"].map((item, index) => change(item, `changes[${index}]`)), changeLessonLinks: record["changeLessonLinks"].map((item, index) => { const link = exact(item, ["changeId", "lessonIds"], `changeLessonLinks[${index}]`); return { changeId: string(link["changeId"], `changeLessonLinks[${index}].changeId`), lessonIds: strings(link["lessonIds"], `changeLessonLinks[${index}].lessonIds`) }; }), idempotencyKey: string(record["idempotencyKey"], "idempotencyKey"), expectedRevision: integer(record["expectedRevision"], "expectedRevision") };
  }
  if (value["type"] === "review_template_improvement_proposal") {
    const record = exact(value, ["type", "proposalId", "expectedProposalRevision", "decision", "reasonCode", "idempotencyKey", "expectedRevision", "operationId"], "command");
    if (record["decision"] !== "approved" && record["decision"] !== "rejected") return invalid("decision-invalid", "decision");
    return { ...common, type: "review_template_improvement_proposal", proposalId: string(record["proposalId"], "proposalId"), expectedProposalRevision: integer(record["expectedProposalRevision"], "expectedProposalRevision"), decision: record["decision"], reasonCode: string(record["reasonCode"], "reasonCode"), idempotencyKey: string(record["idempotencyKey"], "idempotencyKey"), expectedRevision: integer(record["expectedRevision"], "expectedRevision") };
  }
  throw venueError("COMMAND_UNSUPPORTED", { commandType: value["type"] });
}
