import { stableFingerprint } from "./activity-ledger.js";
import { venueError } from "./errors.js";
import { normalizeEventSchedule } from "./event-schedule.js";
import { analyzeStaffingOperations } from "./staffing-operations.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const freeze = (value) => {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.values(value).forEach(freeze);
  return Object.freeze(value);
};

export const RUNBOOK_PHASE_KINDS = Object.freeze(["setup", "doors", "live-event", "interval", "egress", "breakdown"]);
export const RUNBOOK_WORKSTREAMS = Object.freeze(["production", "front-of-house", "security", "catering", "venue-operations"]);
export const RUNBOOK_TASK_STATUSES = Object.freeze(["pending", "in-progress", "blocked", "completed", "skipped"]);

const DEFAULT_PHASE_FRACTIONS = Object.freeze([0, 0.25, 0.3125, 0.625, 0.6875, 0.875, 1]);
const TRANSITIONS = Object.freeze({
  pending: Object.freeze(["in-progress", "blocked", "skipped"]),
  "in-progress": Object.freeze(["completed", "blocked"]),
  blocked: Object.freeze(["in-progress", "skipped"]),
  completed: Object.freeze([]),
  skipped: Object.freeze([]),
});

const sourceObjectIds = (plan, candidates) => candidates.filter((id) => plan.objects.some((object) => object.id === id));
const owner = (plan, roleId, shiftId = null, staffPostObjectId = null) => ({
  roleId: plan.staffing?.roles?.some((role) => role.id === roleId) ? roleId : null,
  shiftId: plan.staffing?.shifts?.some((shift) => shift.id === shiftId) ? shiftId : null,
  staffPostObjectId: plan.objects.some((object) => object.id === staffPostObjectId) ? staffPostObjectId : null,
  assigneeId: null,
});

const phaseInstant = (schedule, fraction) => {
  const start = Date.parse(schedule.startAt);
  const end = Date.parse(schedule.endAt);
  return new Date(start + ((end - start) * fraction)).toISOString();
};

export function deriveRunbookPhases(scheduleInput) {
  const schedule = normalizeEventSchedule(scheduleInput, { label: "Event Day Runbook schedule" });
  return RUNBOOK_PHASE_KINDS.map((kind, order) => ({
    id: `runbook-phase-${kind}`,
    kind,
    order,
    startAt: phaseInstant(schedule, DEFAULT_PHASE_FRACTIONS[order]),
    endAt: phaseInstant(schedule, DEFAULT_PHASE_FRACTIONS[order + 1]),
  }));
}

const defaultTaskInputs = (plan) => [
  { key: "site-release", phase: "setup", code: "SITE_RELEASE", workstream: "venue-operations", owner: owner(plan, "role-venue-operations", "shift-a"), objects: [], evidence: ["SITE_RELEASE_CHECK"], required: true },
  { key: "av-line-check", phase: "setup", code: "AV_LINE_CHECK", workstream: "production", owner: owner(plan, "role-stage-manager", "shift-a", "obj-post-stage"), objects: sourceObjectIds(plan, ["obj-av-desk", "obj-screen-stage", "obj-projector-center"]), evidence: ["AV_SIGNAL_CHECK"], required: true, after: ["site-release"] },
  { key: "service-set", phase: "setup", code: "SERVICE_SET", workstream: "catering", owner: owner(plan, "role-service-lead", "shift-a", "obj-post-catering"), objects: sourceObjectIds(plan, ["obj-refreshment-east", "obj-bar-east"]), evidence: ["SERVICE_READINESS_CHECK"], required: true, after: ["site-release"] },
  { key: "accessible-route-check", phase: "doors", code: "ACCESS_ROUTE_CHECK", workstream: "front-of-house", owner: owner(plan, "role-access-steward", "shift-a", "obj-post-access"), objects: sourceObjectIds(plan, ["obj-accessible-entrance-south", "obj-route-main"]), evidence: ["ACCESS_ROUTE_CHECK"], required: true, after: ["site-release"] },
  { key: "exit-posts", phase: "doors", code: "EXIT_POSTS", workstream: "security", owner: owner(plan, "role-security", "shift-a", "obj-post-exit"), objects: sourceObjectIds(plan, ["obj-fire-exit-east", "obj-post-exit"]), evidence: ["EXIT_POST_CHECK"], required: true, after: ["accessible-route-check"] },
  { key: "stage-hold", phase: "live-event", code: "STAGE_HOLD", workstream: "production", owner: owner(plan, "role-stage-manager", "shift-a", "obj-post-stage"), objects: sourceObjectIds(plan, ["obj-stage-west"]), evidence: [], required: true, after: ["av-line-check", "exit-posts"] },
  { key: "service-reset", phase: "interval", code: "SERVICE_RESET", workstream: "catering", owner: owner(plan, "role-service-lead", "shift-b", "obj-post-catering"), objects: sourceObjectIds(plan, ["obj-refreshment-east", "obj-bar-east"]), evidence: ["SERVICE_RESET_CHECK"], required: true, after: ["service-set"] },
  { key: "egress-posts", phase: "egress", code: "EGRESS_POSTS", workstream: "security", owner: owner(plan, "role-security", "shift-b", "obj-post-exit"), objects: sourceObjectIds(plan, ["obj-fire-exit-east", "obj-post-exit"]), evidence: ["EGRESS_POST_CHECK"], required: true, after: ["stage-hold"] },
  { key: "venue-handoff", phase: "breakdown", code: "VENUE_HANDOFF", workstream: "venue-operations", owner: owner(plan, "role-venue-operations", "shift-b"), objects: [], evidence: ["VENUE_HANDOFF_CHECK"], required: true, after: ["service-reset", "egress-posts"] },
];

export function deriveRunbookTasks(plan, phases) {
  const phaseByKind = new Map(phases.map((phase) => [phase.kind, phase]));
  const inputs = defaultTaskInputs(plan);
  const idByKey = new Map(inputs.map((task) => [task.key, `runbook-task-${task.key}`]));
  const counters = new Map();
  return inputs.map((task) => {
    const order = counters.get(task.phase) ?? 0;
    counters.set(task.phase, order + 1);
    return {
      id: idByKey.get(task.key),
      key: task.key,
      phaseId: phaseByKind.get(task.phase)?.id ?? null,
      order,
      code: task.code,
      workstream: task.workstream,
      owner: task.owner,
      dependencyTaskIds: (task.after ?? []).map((key) => idByKey.get(key)).sort(),
      planObjectIds: [...task.objects].sort(),
      requiredEvidenceCodes: [...task.evidence].sort(),
      required: task.required,
      status: "pending",
      revision: 0,
      evidence: [],
    };
  });
}

const failDefinition = (reason, details = {}) => {
  throw venueError("RUNBOOK_DEFINITION_INVALID", { reason, ...details });
};

const assertUnique = (values, reason) => {
  if (values.some((value) => typeof value !== "string" || !value) || new Set(values).size !== values.length) failDefinition(reason);
};

export function validateRunbookDefinition({ plan, phases, tasks }) {
  if (!plan?.id || plan.version === undefined || !Array.isArray(plan.objects)) failDefinition("accepted-plan-invalid");
  if (phases.length !== RUNBOOK_PHASE_KINDS.length) failDefinition("phase-count-invalid");
  assertUnique(phases.map((phase) => phase.id), "phase-id-invalid");
  if (phases.some((phase, order) => phase.kind !== RUNBOOK_PHASE_KINDS[order] || phase.order !== order || Date.parse(phase.endAt) <= Date.parse(phase.startAt))) failDefinition("phase-order-invalid");
  assertUnique(tasks.map((task) => task.id), "task-id-invalid");
  assertUnique(tasks.map((task) => task.key), "task-key-invalid");
  const phaseIds = new Set(phases.map((phase) => phase.id));
  const taskIds = new Set(tasks.map((task) => task.id));
  const objectIds = new Set(plan.objects.map((object) => object.id));
  const roleIds = new Set((plan.staffing?.roles ?? []).map((role) => role.id));
  const shiftIds = new Set((plan.staffing?.shifts ?? []).map((shift) => shift.id));
  if (tasks.some((task) => !phaseIds.has(task.phaseId) || !RUNBOOK_WORKSTREAMS.includes(task.workstream) || !RUNBOOK_TASK_STATUSES.includes(task.status))) failDefinition("task-enum-invalid");
  if (tasks.some((task) => task.dependencyTaskIds.some((id) => !taskIds.has(id)) || task.planObjectIds.some((id) => !objectIds.has(id)))) failDefinition("task-reference-missing");
  if (tasks.some((task) => (task.owner.roleId && !roleIds.has(task.owner.roleId)) || (task.owner.shiftId && !shiftIds.has(task.owner.shiftId)) || (task.owner.staffPostObjectId && !objectIds.has(task.owner.staffPostObjectId)))) failDefinition("task-owner-reference-missing");
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id) => {
    if (visiting.has(id)) failDefinition("task-dependency-cycle", { taskId: id });
    if (visited.has(id)) return;
    visiting.add(id);
    byId.get(id).dependencyTaskIds.forEach(visit);
    visiting.delete(id);
    visited.add(id);
  };
  tasks.forEach((task) => visit(task.id));
  return true;
}

const createLedgerEntry = (runbook, type, details, metadata, committedAt) => {
  const sequence = runbook.ledger.length + 1;
  const previousHash = runbook.ledger.at(-1)?.hash ?? runbook.source.sourceLedgerHeadHash;
  const entry = {
    id: `runbook-ledger-${String(sequence).padStart(6, "0")}`,
    schemaVersion: 1,
    sequence,
    type,
    actorType: metadata.actorType,
    actorId: metadata.actorId,
    source: metadata.source,
    sessionId: metadata.sessionId,
    committedAt,
    details: clone(details),
    previousHash,
  };
  return { ...entry, hash: stableFingerprint("runbook-ledger", entry) };
};

export function createEventDayRunbook({ projectId, plan, brief = plan?.brief, validation, sourceLedgerHeadHash, approvalLedgerEntryId, frozenAt, frozenBy, version = 1, phases: suppliedPhases, tasks: suppliedTasks }) {
  if (!brief?.schedule) throw venueError("RUNBOOK_SCHEDULE_REQUIRED", { projectId, planId: plan?.id ?? null, planVersion: plan?.version ?? null });
  const schedule = normalizeEventSchedule(brief.schedule, { label: "Accepted Event Brief schedule" });
  if (!validation?.validationId || !validation?.inputFingerprint || validation.status !== "pass") failDefinition("accepted-validation-invalid");
  if (!sourceLedgerHeadHash || !approvalLedgerEntryId) failDefinition("accepted-ledger-proof-missing");
  const acceptedPlan = clone(plan);
  const acceptedBrief = clone(brief);
  const staffingEvidence = analyzeStaffingOperations(acceptedPlan);
  const phases = clone(suppliedPhases ?? deriveRunbookPhases(schedule));
  const tasks = clone(suppliedTasks ?? deriveRunbookTasks(acceptedPlan, phases));
  validateRunbookDefinition({ plan: acceptedPlan, phases, tasks });
  const source = {
    projectId,
    planId: acceptedPlan.id,
    planVersion: acceptedPlan.version,
    planFingerprint: stableFingerprint("plan", acceptedPlan),
    briefFingerprint: stableFingerprint("brief", acceptedBrief),
    validationId: validation.validationId,
    validationInputFingerprint: validation.inputFingerprint,
    approvalLedgerEntryId,
    sourceLedgerHeadHash,
  };
  const baseline = { acceptedPlan, acceptedBrief, staffingEvidence };
  baseline.fingerprint = stableFingerprint("runbook-baseline", baseline);
  const definitionFingerprint = stableFingerprint("runbook-definition", { source, baselineFingerprint: baseline.fingerprint, phases, tasks: tasks.map(({ status: _status, revision: _revision, evidence: _evidence, ...task }) => task) });
  const id = `runbook-${projectId}-${acceptedPlan.id}`;
  const versionId = `${id}-${definitionFingerprint.slice(-8)}`;
  const createdAt = frozenAt ?? new Date().toISOString();
  const runbook = {
    schemaVersion: 1,
    id,
    versionId,
    version,
    source,
    baseline,
    definitionFingerprint,
    status: "draft",
    phases,
    tasks,
    transitions: [],
    receipts: [],
    ledger: [],
    revision: 0,
    frozenAt: createdAt,
    frozenBy,
  };
  runbook.ledger = [createLedgerEntry(runbook, "runbook.created", { runbookVersionId: versionId, definitionFingerprint, sourcePlanVersion: source.planVersion }, { actorType: "human", actorId: frozenBy, source: "studio", sessionId: "runbook-create" }, createdAt)];
  return freeze(runbook);
}

export function taskReadiness(runbook, taskId) {
  const task = runbook.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw venueError("RUNBOOK_TASK_NOT_FOUND", { runbookVersionId: runbook.versionId, taskId });
  const byId = new Map(runbook.tasks.map((candidate) => [candidate.id, candidate]));
  const completedDependencyIds = task.dependencyTaskIds.filter((id) => byId.get(id)?.status === "completed");
  return { ready: completedDependencyIds.length === task.dependencyTaskIds.length, dependencyTaskIds: [...task.dependencyTaskIds], completedDependencyIds };
}

const normalizeEvidence = (evidence = []) => {
  if (!Array.isArray(evidence)) throw venueError("RUNBOOK_EVIDENCE_REQUIRED", { reason: "evidence-not-array" });
  const normalized = evidence.map((item) => {
    if (!item || typeof item.code !== "string" || !item.code || typeof item.ref !== "string" || !item.ref || Object.keys(item).some((key) => !["code", "ref"].includes(key))) throw venueError("RUNBOOK_EVIDENCE_REQUIRED", { reason: "evidence-invalid" });
    return { code: item.code, ref: item.ref };
  }).sort((left, right) => left.code.localeCompare(right.code) || left.ref.localeCompare(right.ref));
  return [...new Map(normalized.map((item) => [`${item.code}\u0000${item.ref}`, item])).values()];
};

const transitionInput = (command) => ({
  runbookVersionId: command.runbookVersionId,
  taskId: command.taskId,
  expectedTaskRevision: command.expectedTaskRevision,
  toStatus: command.toStatus,
  reasonCode: command.reasonCode ?? null,
  evidence: normalizeEvidence(command.evidence),
  clientId: command.clientId,
  clientSequence: command.clientSequence,
  clientOccurredAt: command.clientOccurredAt,
  actorType: command.actorType,
  actorId: command.actorId,
  source: command.source,
  sessionId: command.sessionId,
});

export function transitionRunbookTask(runbook, command, { committedAt = new Date().toISOString() } = {}) {
  if (!command?.idempotencyKey) throw venueError("IDEMPOTENCY_KEY_REQUIRED", { commandType: "transition_runbook_task" });
  if (command.runbookVersionId !== runbook.versionId) failDefinition("runbook-version-mismatch", { runbookVersionId: command.runbookVersionId });
  const input = transitionInput(command);
  const inputFingerprint = stableFingerprint("runbook-command", input);
  const existing = runbook.receipts.find((receipt) => receipt.idempotencyKey === command.idempotencyKey);
  if (existing) {
    if (existing.inputFingerprint !== inputFingerprint) throw venueError("IDEMPOTENCY_KEY_CONFLICT", { idempotencyKey: command.idempotencyKey, commandType: "transition_runbook_task" });
    return { runbook, receipt: clone(existing), duplicate: true };
  }
  const task = runbook.tasks.find((candidate) => candidate.id === command.taskId);
  if (!task) throw venueError("RUNBOOK_TASK_NOT_FOUND", { runbookVersionId: runbook.versionId, taskId: command.taskId });
  if (task.revision !== command.expectedTaskRevision) throw venueError("RUNBOOK_TASK_REVISION_CONFLICT", { taskId: task.id, expectedTaskRevision: command.expectedTaskRevision, currentTaskRevision: task.revision, currentStatus: task.status });
  const isReopen = ["completed", "skipped"].includes(task.status) && command.toStatus === "pending";
  const ordinary = TRANSITIONS[task.status]?.includes(command.toStatus);
  if (!ordinary && !(isReopen && command.actorType === "human" && command.reasonCode)) throw venueError("RUNBOOK_TRANSITION_INVALID", { taskId: task.id, fromStatus: task.status, toStatus: command.toStatus });
  if (command.toStatus === "in-progress") {
    const readiness = taskReadiness(runbook, task.id);
    if (!readiness.ready) throw venueError("RUNBOOK_DEPENDENCIES_INCOMPLETE", { taskId: task.id, ...readiness });
  }
  if (command.toStatus === "skipped" && !command.reasonCode) throw venueError("RUNBOOK_TRANSITION_INVALID", { taskId: task.id, fromStatus: task.status, toStatus: command.toStatus, reason: "reason-code-required" });
  const evidence = normalizeEvidence(command.evidence);
  if (command.toStatus === "completed") {
    const present = new Set(evidence.map((item) => item.code));
    const missingEvidenceCodes = task.requiredEvidenceCodes.filter((code) => !present.has(code));
    if (missingEvidenceCodes.length) throw venueError("RUNBOOK_EVIDENCE_REQUIRED", { taskId: task.id, missingEvidenceCodes });
  }
  const nextTask = { ...clone(task), status: command.toStatus, revision: task.revision + 1, evidence };
  const transitionSequence = runbook.transitions.length + 1;
  const transition = {
    id: command.operationId ?? `runbook-transition-${inputFingerprint.slice(-8)}`,
    sequence: transitionSequence,
    taskId: task.id,
    fromStatus: task.status,
    toStatus: command.toStatus,
    fromTaskRevision: task.revision,
    toTaskRevision: nextTask.revision,
    reasonCode: command.reasonCode ?? null,
    evidence,
    clientId: command.clientId,
    clientSequence: command.clientSequence,
    clientOccurredAt: command.clientOccurredAt,
    committedAt,
  };
  const receipt = {
    id: `runbook-receipt-${inputFingerprint.slice(-8)}`,
    idempotencyKey: command.idempotencyKey,
    inputFingerprint,
    correlationId: command.correlationId ?? `corr-${inputFingerprint.slice(-8)}`,
    runbookVersionId: runbook.versionId,
    taskId: task.id,
    taskRevision: nextTask.revision,
    transitionId: transition.id,
    committedAt,
  };
  const eventType = isReopen ? "runbook.task_reopened" : `runbook.task_${command.toStatus.replace("in-progress", "started")}`;
  const next = {
    ...clone(runbook),
    tasks: runbook.tasks.map((candidate) => candidate.id === task.id ? nextTask : clone(candidate)),
    transitions: [...runbook.transitions.map(clone), transition],
    receipts: [...runbook.receipts.map(clone), receipt],
    revision: runbook.revision + 1,
  };
  next.ledger = [...runbook.ledger.map(clone), createLedgerEntry(next, eventType, { runbookVersionId: runbook.versionId, sourcePlanVersion: runbook.source.planVersion, taskId: task.id, fromStatus: task.status, toStatus: nextTask.status, fromTaskRevision: task.revision, toTaskRevision: nextTask.revision, transitionId: transition.id, receiptId: receipt.id, idempotencyKey: command.idempotencyKey, inputFingerprint }, { actorType: command.actorType, actorId: command.actorId, source: command.source, sessionId: command.sessionId }, committedAt)];
  return { runbook: freeze(next), receipt: freeze(receipt), duplicate: false };
}

export function deriveRunbookHandoff(runbook, { at, outgoingAssignmentId, incomingAssignmentId, roleId = null }) {
  const instant = Date.parse(at);
  if (!Number.isFinite(instant)) failDefinition("handoff-instant-invalid");
  const phaseById = new Map(runbook.phases.map((phase) => [phase.id, phase]));
  const filtered = runbook.tasks.filter((task) => !roleId || task.owner.roleId === roleId);
  const ids = (predicate) => filtered.filter(predicate).map((task) => task.id).sort();
  const handoff = {
    schemaVersion: 1,
    runbookVersionId: runbook.versionId,
    sourcePlanVersion: runbook.source.planVersion,
    ledgerSequence: runbook.ledger.length,
    ledgerHeadHash: runbook.ledger.at(-1)?.hash ?? runbook.source.sourceLedgerHeadHash,
    at,
    outgoingAssignmentId,
    incomingAssignmentId,
    roleId,
    taskIds: {
      pending: ids((task) => task.status === "pending"),
      active: ids((task) => task.status === "in-progress"),
      blocked: ids((task) => task.status === "blocked"),
      completed: ids((task) => task.status === "completed"),
      skipped: ids((task) => task.status === "skipped"),
      overdue: ids((task) => !["completed", "skipped"].includes(task.status) && Date.parse(phaseById.get(task.phaseId).endAt) < instant),
      evidenceGap: ids((task) => task.status === "completed" && task.requiredEvidenceCodes.some((code) => !task.evidence.some((item) => item.code === code))),
    },
  };
  return freeze({ ...handoff, fingerprint: stableFingerprint("runbook-handoff", handoff) });
}

export function verifyRunbookLedger(runbook) {
  let previousHash = runbook.source.sourceLedgerHeadHash;
  for (const entry of runbook.ledger) {
    const { hash, ...payload } = entry;
    if (entry.previousHash !== previousHash || stableFingerprint("runbook-ledger", payload) !== hash) return { status: "fail", entries: runbook.ledger.length, headHash: null };
    previousHash = hash;
  }
  return { status: "pass", entries: runbook.ledger.length, headHash: previousHash };
}
