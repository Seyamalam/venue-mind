import {
  activityLedgerSchema,
  commandForVenueTool,
  eventBriefSchema,
  plannerSnapshotSchema,
  venueCommandSchema,
  venueConstraintSchema,
  venueToolContracts,
} from "../../contracts/venue-contracts.ts";
import {
  AGENT_SCOPE_PERMISSIONS,
  AGENT_SCOPES,
  DEFAULT_APPROVAL_POLICY,
  HUMAN_ROLE_PERMISSIONS,
  HUMAN_ROLES,
  MAX_AGENT_GRANT_TTL_MS,
  permissionForCommand,
} from "../../domain/authorization.ts";
import { errorCatalog } from "../../domain/errors.ts";
import { bullets, code, links, prose, table, type DocsPage } from "../blocks.ts";
import {
  CONSTRAINT_REFERENCE,
  DEPRECATION_POLICY,
  LEDGER_EVENT_REFERENCE,
  PERSISTENCE_REFERENCE,
  TOOL_OUTPUT_REFERENCE,
  VERSION_REFERENCE,
  type ToolOutputReference,
} from "../reference-data.ts";

type JsonSchema = Readonly<{
  $id?: string;
  $ref?: string;
  const?: unknown;
  enum?: readonly unknown[];
  oneOf?: readonly JsonSchema[];
  anyOf?: readonly JsonSchema[];
  type?: string | readonly string[];
  items?: JsonSchema;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  default?: unknown;
  description?: string;
  format?: string;
  pattern?: string;
  minimum?: number;
  exclusiveMinimum?: number;
  maximum?: number;
  exclusiveMaximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}>;

type ErrorReference = Readonly<{ code: string; message: string; remediation: string }>;
const errorsByCode = errorCatalog as Readonly<Record<string, ErrorReference>>;
type ToolContract = Readonly<{
  name: string;
  description: string;
  inputSchema: JsonSchema;
  exampleInput: unknown;
  errors: readonly string[];
  contractVersion: string;
  authorization: Readonly<{ requiredScope: string }>;
  annotations?: Readonly<{ readOnlyHint?: boolean }>;
  limits: Readonly<{ maximumInputBytes: number; maximumOutputBytes: number }>;
}>;
const toolContracts = venueToolContracts as readonly ToolContract[];
const humanRolePermissions = HUMAN_ROLE_PERMISSIONS as Readonly<Record<string, readonly string[]>>;
const agentScopePermissions = AGENT_SCOPE_PERMISSIONS as Readonly<Record<string, readonly string[]>>;

const fieldColumns = [
  { key: "name", label: "Field" },
  { key: "type", label: "Type" },
  { key: "required", label: "Required" },
  { key: "defaultValue", label: "Default" },
  { key: "bounds", label: "Bounds" },
  { key: "description", label: "Meaning" },
];
const outputColumns = [
  { key: "name", label: "Output field" },
  { key: "description", label: "Meaning" },
];
const errorColumns = [
  { key: "code", label: "Code" },
  { key: "message", label: "Message" },
  { key: "remediation", label: "Remediation" },
];
const output = (fields: readonly string[], stableIds: readonly string[], semantics: string): ToolOutputReference => ({ fields, stableIds, semantics });
const groupBy = <Item, Key extends string>(items: readonly Item[], keyFor: (item: Item) => Key): Record<Key, Item[]> => items.reduce<Record<Key, Item[]>>((groups, item) => ({
  ...groups,
  [keyFor(item)]: [...(groups[keyFor(item)] ?? []), item],
}), {} as Record<Key, Item[]>);

const titleCase = (value: string): string => value.split(/[._-]/).map((word) => `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`).join(" ");
const slugToken = (value: string): string => value.replaceAll(".", "-").replaceAll("_", "-");
const schemaType = (schema: JsonSchema = {}): string => {
  if (schema.const !== undefined) return `const ${JSON.stringify(schema.const)}`;
  if (schema.enum) return schema.enum.map(String).join(" | ");
  if (schema.$ref) return new URL(schema.$ref).pathname.split("/").at(-1)?.replace(".schema.json", "") ?? schema.$ref;
  if (schema.oneOf) return schema.oneOf.map(schemaType).join(" | ");
  if (schema.anyOf) return schema.anyOf.map(schemaType).join(" | ");
  if (Array.isArray(schema.type)) return schema.type.join(" | ");
  if (schema.type === "array") return `${schemaType(schema.items)}[]`;
  return typeof schema.type === "string" ? schema.type : "object";
};
const schemaBounds = (schema: JsonSchema = {}): string => [
  schema.minimum !== undefined && `≥ ${schema.minimum}`,
  schema.exclusiveMinimum !== undefined && `> ${schema.exclusiveMinimum}`,
  schema.maximum !== undefined && `≤ ${schema.maximum}`,
  schema.exclusiveMaximum !== undefined && `< ${schema.exclusiveMaximum}`,
  schema.minLength !== undefined && `min ${schema.minLength} chars`,
  schema.maxLength !== undefined && `max ${schema.maxLength} chars`,
  schema.minItems !== undefined && `min ${schema.minItems} items`,
  schema.maxItems !== undefined && `max ${schema.maxItems} items`,
  schema.uniqueItems && "unique items",
  schema.pattern && `pattern ${schema.pattern}`,
  schema.format && `format ${schema.format}`,
].filter(Boolean).join("; ") || "—";

const fieldDescriptions: Readonly<Record<string, string>> = {
  type: "Stable command discriminator.", idempotencyKey: "One retry key for one semantic mutation.", correlationId: "Caller trace propagated into receipts and ledger evidence.", actor: "Claimed action source; policy verifies it against the principal.", actorId: "Authenticated or local stable actor identity.", source: "Surface that submitted the command.", sessionId: "Calling session identity.", branchId: "Stable Proposal Branch ID.", proposalId: "Stable Proposal ID.", baseVersion: "Accepted Plan Version on which the Proposal is based.", objectId: "Stable Project-scoped object ID.", constraintId: "Stable Constraint ID.", runId: "Stable Simulation Run ID.", format: "Requested read-only export representation.", snapshot: "Complete canonical Project schema 10 planner snapshot.", brief: "Complete structured Event Brief.", goal: "Measurable Proposal outcome.", limit: "Maximum number of returned records.", scope: "Accepted Plan or visible Proposal candidate.", includeSpatialEvidence: "Include bounded spatial evidence in the response.", includeDensityFrames: "Include time-keyed density cells in the result.",
};

const defaultByField: Readonly<Record<string, string>> = {
  "get_object.scope": "proposal",
  "search_objects.scope": "proposal",
  "search_objects.limit": "20",
  "get_validation_evidence.includeSpatialEvidence": "true",
  "get_scenario_result.includeDensityFrames": "false",
  "export_plan.format": "json",
};

const rowsForSchema = (schema: JsonSchema, commandType = "") => Object.entries(schema.properties ?? {}).map(([name, property]) => ({
  name,
  type: schemaType(property),
  required: schema.required?.includes(name) ? "yes" : "no",
  defaultValue: property.default !== undefined ? JSON.stringify(property.default) : defaultByField[`${commandType}.${name}`] ?? "—",
  bounds: schemaBounds(property),
  description: property.description ?? fieldDescriptions[name] ?? "Published contract field.",
}));

const stringExample = (name: string, schema: JsonSchema): string | undefined => {
  if (name === "idempotencyKey") return "example-command-001";
  if (name === "correlationId") return "corr-example-001";
  if (name === "baseVersion") return "3.2";
  if (name === "toVersion") return "1.1.0";
  if (name === "date") return "2026-09-15";
  if (name === "timezone") return "Asia/Dhaka";
  if (name.endsWith("Ids")) return undefined;
  if (name.endsWith("Id")) return `${name.replace(/Id$/, "").replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-example`;
  if (name === "startAt") return "2026-09-18T09:00:00+06:00";
  if (name === "endAt") return "2026-09-18T17:00:00+06:00";
  if (schema.format === "date-time") return "2026-08-27T10:00:00.000Z";
  return name === "goal" ? "Improve access while preserving capacity" : name === "instruction" ? "Increase rear clearance" : `example-${slugToken(name)}`;
};

const schemaRegistry = new Map<string, JsonSchema>([eventBriefSchema, plannerSnapshotSchema].map((schema) => [String(schema.$id), schema]));
const exampleValue = (schema: JsonSchema = {}, name = "value", depth = 0): unknown => {
  if (depth > 8) return {};
  if (schema.$ref) return exampleValue(schemaRegistry.get(schema.$ref) ?? {}, name, depth + 1);
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return schema.enum[0];
  if (schema.oneOf) return exampleValue(schema.oneOf[0], name, depth + 1);
  if (schema.anyOf) return exampleValue(schema.anyOf.find((entry) => entry.type !== "null") ?? schema.anyOf[0], name, depth + 1);
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type;
  if (type === "string") return stringExample(name, schema);
  if (type === "integer") return Math.max(schema.minimum ?? 0, 1);
  if (type === "number") return Math.max(schema.minimum ?? schema.exclusiveMinimum ?? 0, 1);
  if (type === "boolean") return true;
  if (type === "array") return (schema.minItems ?? 0) > 0 ? [exampleValue(schema.items, name.replace(/s$/, ""), depth + 1)] : [];
  if (type === "object" || schema.properties) return Object.fromEntries((schema.required ?? []).map((key) => [key, exampleValue(schema.properties?.[key] ?? {}, key, depth + 1)]));
  return {};
};

const commandSchemas = (venueCommandSchema.oneOf as readonly JsonSchema[]).flatMap((schema) => {
  const typeSchema = schema.properties?.type;
  const types = typeSchema?.const !== undefined ? [typeSchema.const] : typeSchema?.enum ?? [];
  return types.filter((type): type is string => typeof type === "string").map((type: string) => ({
    type,
    schema: { ...schema, properties: { ...(schema.properties ?? {}), type: { const: type } } } as JsonSchema,
  }));
});

const toolForCommand = new Map<string, string>();
for (const tool of toolContracts) {
  try {
    const command = commandForVenueTool(tool.name, tool.exampleInput);
    if (command?.type && !toolForCommand.has(command.type)) toolForCommand.set(command.type, tool.name);
  } catch {
    // Project service tools intentionally do not map to planner commands.
  }
}

const commandOutputOverrides: Readonly<Record<string, ToolOutputReference>> = {
  restore_snapshot: output(["status", "planId", "planVersion"], ["planId"], "Restored normalized planner state after integrity checks."),
  update_event_brief: output(["status", "briefId", "attendeeTarget", "requirements"], ["briefId"], "Updated Event Brief and invalidated dependent Proposal evidence."),
  revert_change: output(["status", "proposalId", "changeId", "changedItems"], ["proposalId", "changeId"], "Proposal revision with one Change removed."),
  waive_warning: output(["status", "waiverId", "constraintId", "proposalId", "validationInputFingerprint"], ["waiverId", "constraintId", "proposalId"], "Human-authored warning disposition bound to one Validation input."),
  set_object_lock: output(["status", "lockId", "objectId", "lockType", "source"], ["lockId", "objectId"], "Human-authored temporary Project Lock."),
  release_object_lock: output(["status", "lockId", "objectId", "lockType"], ["lockId", "objectId"], "Released Project Lock record."),
  approve_proposal: output(["planId", "planVersion", "proposalId", "status", "validation"], ["planId", "proposalId", "validation.validationId"], "Human Approval creating the next immutable Plan Version."),
  undo: output(["status", "proposalId", "changeId", "changedItems", "planVersion"], ["proposalId", "changeId", "planVersion"], "Undo result for Proposal editing or accepted Plan history."),
  redo: output(["status", "proposalId", "changeId", "changedItems", "planVersion"], ["proposalId", "changeId", "planVersion"], "Redo result for Proposal editing or accepted Plan history."),
  resolve_conflict: output(["status", "branchId", "proposalId", "conflictId", "outcome", "transformedChangeId", "validationId", "validationStatus", "remainingConflicts"], ["branchId", "proposalId", "conflictId", "transformedChangeId", "validationId"], "Human conflict decision followed by deterministic Validation."),
  record_branch_decision: output(["status", "decisionId", "chosenBranchId", "rejectedBranchIds"], ["decisionId", "chosenBranchId", "rejectedBranchIds[]"], "Auditable human branch decision checkpoint."),
};

function outputForCommand(type: string): ToolOutputReference {
  if (commandOutputOverrides[type]) return commandOutputOverrides[type];
  const toolName = toolForCommand.get(type);
  return toolName ? TOOL_OUTPUT_REFERENCE[toolName] : output(["status", "receipt"], ["receipt.id"], "Planner command result and retry-safe receipt where applicable.");
}

const commandErrorCodes = (type: string, schema: JsonSchema): string[] => {
  const codes = new Set(["COMMAND_INVALID", "COMMAND_UNSUPPORTED", "AUTHORIZATION_DENIED"]);
  if (schema.required?.includes("idempotencyKey")) codes.add("IDEMPOTENCY_KEY_REQUIRED").add("IDEMPOTENCY_KEY_CONFLICT");
  if (/branch/.test(type)) codes.add("BRANCH_NOT_FOUND");
  if (/conflict|rebase/.test(type)) codes.add("CONFLICT_NOT_FOUND").add("CONFLICT_RESOLUTION_INVALID");
  if (/lock/.test(type)) codes.add("LOCK_CONFLICT").add("LOCK_NOT_FOUND");
  if (/comment/.test(type)) codes.add("COMMENT_NOT_FOUND").add("COMMENT_INVALID");
  if (/scenario|simulation/.test(type)) codes.add("SCENARIO_RUN_NOT_FOUND");
  if (/warning/.test(type)) codes.add("WARNING_NOT_WAIVABLE").add("WAIVER_REASON_INVALID");
  if (type === "approve_proposal") ["PROPOSAL_MISMATCH", "PROPOSAL_EMPTY", "PLAN_VERSION_CONFLICT", "VALIDATION_FAILED", "WARNING_WAIVER_REQUIRED", "EMERGENCY_REVIEW_REQUIRED"].forEach((codeValue) => codes.add(codeValue));
  if (type === "restore_snapshot") codes.add("SNAPSHOT_INVALID").add("LEDGER_INTEGRITY_FAILED");
  return [...codes].filter((codeValue) => errorsByCode[codeValue]);
};

const commandExample = (type: string, schema: JsonSchema): Record<string, unknown> => {
  const example = Object.fromEntries((schema.required ?? []).map((name) => [name, exampleValue(schema.properties?.[name], name)]));
  if (type === "update_event_brief") {
    const brief = example.brief && typeof example.brief === "object" && !Array.isArray(example.brief)
      ? example.brief as Record<string, unknown>
      : {};
    example.brief = { ...brief, schedule: exampleValue(eventBriefSchema.properties.schedule, "schedule") };
  }
  return example;
};
const pageMetadata = (collection: string, hidden = false) => ({ hidden, collection, parentSlug: `reference-${collection}` });

export const toolReferencePages = toolContracts.map((tool) => {
  const result = TOOL_OUTPUT_REFERENCE[tool.name];
  const errorRows = tool.errors.map((errorCode) => errorsByCode[errorCode]).filter((error): error is ErrorReference => Boolean(error));
  let commandType = "";
  try {
    commandType = commandForVenueTool(tool.name, tool.exampleInput)?.type ?? "";
  } catch {
    // Project service tools intentionally do not map to planner commands.
  }
  return {
    slug: `reference-tool-${slugToken(tool.name)}`,
    group: "Reference",
    title: tool.name,
    eyebrow: "Tool reference",
    summary: tool.description,
    audience: ["developers", "agent integrators"],
    compatibility: [`Contract ${tool.contractVersion}`, `Scope ${tool.authorization.requiredScope}`],
    navigation: pageMetadata("tools", true),
    reference: { kind: "tool", name: tool.name, requiredFields: [...(tool.inputSchema.required ?? [])], example: tool.exampleInput, errors: [...tool.errors], output: result },
    sections: [
      { id: "contract", title: "Contract", blocks: [bullets(`Contract version ${tool.contractVersion}.`, `Required Agent Grant scope ${tool.authorization.requiredScope}.`, `${tool.annotations?.readOnlyHint ? "Read-only" : "State-affecting"} operation.`, `Input limit ${tool.limits.maximumInputBytes} bytes; output limit ${tool.limits.maximumOutputBytes} bytes.`)] },
      { id: "input", title: "Input", blocks: [table(fieldColumns, rowsForSchema(tool.inputSchema, commandType)), code(JSON.stringify(tool.exampleInput, null, 2), "json")] },
      { id: "output", title: "Output", blocks: [prose(result.semantics), table(outputColumns, result.fields.map((name) => ({ name, description: result.stableIds.includes(name) ? "Stable identifier." : "Published result field." }))), bullets(...result.stableIds.map((stableId) => `Stable ID: ${stableId}`))] },
      { id: "errors", title: "Errors", blocks: [table(errorColumns, errorRows)] },
      { id: "surfaces", title: "Surfaces", blocks: [links({ label: "WebMCP runtime", href: "/docs/webmcp#runtime" }, { label: "Standalone MCP", href: "/docs/mcp#surfaces" }, { label: "Complete error catalog", href: "/docs/reference-errors" })] },
    ],
  };
});

export const commandReferencePages = commandSchemas.map(({ type, schema }) => {
  const commandOutput = outputForCommand(type);
  const permission = permissionForCommand(type);
  const errors = commandErrorCodes(type, schema).map((errorCode) => errorsByCode[errorCode]).filter((error): error is ErrorReference => Boolean(error));
  const exampleBlocks = type === "restore_snapshot"
    ? [code("const snapshot = await fetch('/examples/planner-snapshot.json').then((response) => response.json());\nplanner.execute({ type: 'restore_snapshot', snapshot });", "javascript")]
    : [code(JSON.stringify(commandExample(type, schema), null, 2), "json")];
  return {
    slug: `reference-command-${slugToken(type)}`,
    group: "Reference",
    title: type,
    eyebrow: "Command reference",
    summary: `Execute ${titleCase(type)} through the shared VenueMind planner boundary.`,
    audience: ["developers", "agent integrators"],
    compatibility: ["Project schema 10", `Permission ${permission}`],
    navigation: pageMetadata("commands", true),
    reference: { kind: "command", name: type, requiredFields: [...(schema.required ?? [])], example: type === "restore_snapshot" ? null : commandExample(type, schema), errors: commandErrorCodes(type, schema), output: commandOutput, permission },
    sections: [
      { id: "contract", title: "Contract", blocks: [bullets(`Permission ${permission}.`, `${schema.required?.includes("idempotencyKey") ? "Retry-safe mutation with a required idempotency key." : "No idempotency key is required."}`, `${schema.properties?.actor?.const === "human" ? "Human authority is required." : "Authority is evaluated at the service boundary."}`)] },
      { id: "input", title: "Input", blocks: [table(fieldColumns, rowsForSchema(schema, type)), ...exampleBlocks] },
      { id: "output", title: "Output", blocks: [prose(commandOutput.semantics), table(outputColumns, commandOutput.fields.map((name) => ({ name, description: commandOutput.stableIds.includes(name) ? "Stable identifier." : "Published result field." }))), bullets(...commandOutput.stableIds.map((stableId) => `Stable ID: ${stableId}`))] },
      { id: "errors", title: "Applicable errors", blocks: [table(errorColumns, errors), links({ label: "Complete error catalog", href: "/docs/reference-errors" })] },
    ],
  };
});

const toolsByScope = groupBy(toolReferencePages, (page) => toolContracts.find((tool) => tool.name === page.reference.name)?.authorization.requiredScope ?? "unknown");
const commandsByPermission = groupBy(commandReferencePages, (page) => page.reference.permission);

const toolIndexPage = {
  slug: "reference-tools", group: "Reference", title: "Tool reference", eyebrow: "46 shared tools",
  summary: "One generated page per WebMCP and standalone MCP tool, sourced from the runtime contract registry.",
  audience: ["developers", "agent integrators"], compatibility: ["Tool contract 1.4.0", "WebMCP + MCP"], navigation: pageMetadata("tools"),
  sections: Object.entries(toolsByScope).map(([scope, pages]) => ({ id: slugToken(scope), title: scope, blocks: [links(...pages.map((page) => ({ label: page.title, href: `/docs/${page.slug}` })))] })),
};

const commandIndexPage = {
  slug: "reference-commands", group: "Reference", title: "Command reference", eyebrow: `${commandReferencePages.length} planner commands`,
  summary: "One generated page per shared planner command, including internal human and persistence commands that are intentionally absent from agent tools.",
  audience: ["developers", "agent integrators"], compatibility: ["Project schema 10", "Shared planner boundary"], navigation: pageMetadata("commands"),
  sections: Object.entries(commandsByPermission).map(([permission, pages]) => ({ id: slugToken(permission), title: permission, blocks: [links(...pages.map((page) => ({ label: page.title, href: `/docs/${page.slug}` })))] })),
};

const errorPage = {
  slug: "reference-errors", group: "Reference", title: "Error catalog", eyebrow: `${Object.keys(errorCatalog).length} stable codes`,
  summary: "Every stable VenueMind error code, user-safe message, and actionable remediation path.",
  audience: ["developers", "operators", "agents"], compatibility: ["Stable error envelope", "Tool contract 1.4.0"],
  sections: [{ id: "catalog", title: "Published errors", blocks: [table(errorColumns, Object.values(errorsByCode))] }, { id: "envelope", title: "Error envelope", blocks: [code(JSON.stringify({ error: { code: "PLAN_VERSION_CONFLICT", message: errorsByCode.PLAN_VERSION_CONFLICT.message, remediation: errorsByCode.PLAN_VERSION_CONFLICT.remediation, details: { expectedVersion: "3.3", receivedVersion: "3.2" } } }, null, 2), "json"), links({ label: "Venue error schema", href: "/schemas/venue-error.schema.json" })] }],
};

const constraintPage = {
  slug: "reference-constraints", group: "Reference", title: "Constraint and evidence reference", eyebrow: `${CONSTRAINT_REFERENCE.length} evaluators`,
  summary: "All deterministic Constraint evaluators, operational categories, evidence families, and normalized units.",
  audience: ["operators", "developers", "agents"], compatibility: ["Validation 2.7.0", "Spatial evidence 1"],
  sections: [
    { id: "evaluators", title: "Evaluators", blocks: [table([{ key: "evaluator", label: "Evaluator" }, { key: "category", label: "Category" }, { key: "evidence", label: "Evidence" }, { key: "units", label: "Units" }], CONSTRAINT_REFERENCE)] },
    { id: "outcomes", title: "Outcomes and authority", blocks: [bullets("pass — measured evidence meets the threshold.", "warning — reviewable evidence requires an explicit human Warning Waiver when waivable.", "fail — a hard safety or operational threshold blocks Approval.", "not-applicable — the evaluator records why the current scope has no applicable target.", "Simulation Results remain separate from deterministic Constraint evidence.")] },
    { id: "schema", title: "Schemas", blocks: [links({ label: "Constraint schema", href: "/schemas/venue-constraint.schema.json" }, { label: "Validation result schema", href: "/schemas/validation-result.schema.json" }, { label: "Spatial evidence schema", href: "/schemas/spatial-evidence.schema.json" })] },
  ],
};

const ledgerPage = {
  slug: "reference-ledger", group: "Reference", title: "Activity Ledger events", eyebrow: `${LEDGER_EVENT_REFERENCE.length} event types`,
  summary: "The complete event vocabulary for human, agent, system, planning, review, simulation, and integrity activity.",
  audience: ["operators", "developers", "auditors"], compatibility: ["Ledger schema 1", "Hash chained"],
  sections: [
    { id: "events", title: "Event types", blocks: [table([{ key: "type", label: "Event" }, { key: "category", label: "Category" }, { key: "stableReferences", label: "Stable references" }], LEDGER_EVENT_REFERENCE)] },
    { id: "integrity", title: "Integrity and replay", blocks: [bullets("Every entry carries a sequence, previous hash, content hash, actor identity, source, session, and timestamp.", "Load and export verify the complete chain from genesis.", "Replay applies accepted Plan transitions and compares the reconstructed fingerprint with stored current truth.", "A failed chain or Lock-protected replay is blocking."), links({ label: "Activity Ledger schema", href: "/schemas/activity-ledger.schema.json" }, { label: "Audit tutorial", href: "/docs/tutorial-audit-plan" })] },
  ],
};

const lifecyclePage = {
  slug: "reference-plan-lifecycle", group: "Reference", title: "Plan and Proposal lifecycle", eyebrow: "State semantics",
  summary: "Branch, rebase, conflict, Approval, adjustment, undo, redo, and replay behavior at the shared command boundary.",
  audience: ["operators", "developers", "agents"], compatibility: ["Project schema 10", "Ledger schema 1"],
  sections: [
    { id: "truth", title: "Accepted truth", blocks: [bullets("One immutable Plan Version is accepted truth.", "A Proposal names exactly one base Plan Version and contains stable Changes.", "Branches isolate competing Proposal revisions; switching a Branch never changes the accepted Plan.")] },
    { id: "conflicts", title: "Rebase and conflicts", blocks: [bullets("Conflict detection covers stale base, deleted dependency, Lock, same-object edit, geometry overlap, and Constraint regression.", "Rebase retains unchanged Change IDs and creates new IDs only for transformed Changes.", "Human conflict decisions use only the published outcomes for each conflict and trigger fresh Validation.")] },
    { id: "approval", title: "Approval", blocks: [bullets("Approval requires a matching Proposal ID and base version, passing hard Constraints, warning dispositions, and any required Emergency Review.", "Approval is human-only and creates exactly one immutable Plan Version plus one ledger transition.", "Agent tools stop at validated human review.")] },
    { id: "history", title: "Undo, redo, and replay", blocks: [bullets("Proposal editing undo and redo create reviewable Proposal revisions.", "Accepted Plan undo and redo restore immutable prior versions and append ledger transitions.", "Replay reconstructs accepted history without trusting cached summary fields.")] },
    { id: "schemas", title: "Related contracts", blocks: [links({ label: "Proposal conflicts", href: "/schemas/proposal-conflicts.schema.json" }, { label: "Proposal comparison", href: "/schemas/proposal-comparison.schema.json" }, { label: "Command receipt", href: "/schemas/command-receipt.schema.json" })] },
  ],
};

const persistencePage = {
  slug: "reference-persistence", group: "Reference", title: "Persistence and recovery", eyebrow: "Durable Project semantics",
  summary: "Remote authority, browser recovery, import safety, soft deletion, normalization, and integrity behavior.",
  audience: ["operators", "developers"], compatibility: ["Project schema 10", "D1 repository"],
  sections: [
    { id: "semantics", title: "Storage semantics", blocks: [table([{ key: "concern", label: "Concern" }, { key: "behavior", label: "Behavior" }], PERSISTENCE_REFERENCE)] },
    { id: "concurrency", title: "Optimistic concurrency", blocks: [bullets("Creation requires If-None-Match: *; updates require the exact strong Project ETag in If-Match.", "A stale write returns PROJECT_REVISION_CONFLICT with current record and revision data; it never falls back to a successful LOCAL state.", "Independent fields reconcile through one bounded three-way retry. Overlapping layout state becomes a human-controlled Recovery Branch or yields to REMOTE."), links({ label: "Concurrency guide", href: "/guides/optimistic-concurrency.md" })] },
    { id: "collaboration", title: "Real-time collaboration", blocks: [bullets("Presence Leases carry User identity, observed Plan Version, and focused stable object for 30 seconds.", "SSE resumes from a durable per-Project cursor and streams Comment, ledger, Proposal, Approval, and record events.", "A missing cursor link emits sync.reset and reloads authoritative Project state through ordinary revision conflict rules."), links({ label: "Collaboration guide", href: "/guides/realtime-collaboration.md" })] },
    { id: "sharing", title: "Sharing and notifications", blocks: [bullets("Read-only Share Links expose accepted Plan state; Reviewer Share Links expose one retained Proposal revision.", "Bearer tokens are returned once and persisted only as hashes; durable pending lifecycle states reconcile ledger transitions and fail closed.", "Creation-time preferences control in-app visibility; leased email outbox rows are delivered only after injected-provider success."), links({ label: "Sharing guide", href: "/guides/sharing-and-notifications.md" })] },
    { id: "registration", title: "Registration and ticketing", blocks: [bullets("Registration Snapshots contain aggregate Ticket Class totals, forecasts, zone allocations, accessibility requirements, and optional event-day Check-in Aggregates.", "Recursive privacy screening runs before checksums, duplicate storage, dead letters, and atomic webhook replay storage.", "Ticket Occupancy Reconciliation compares provider aggregates with repository-derived Project and Plan requirements without creating planning effects."), links({ label: "Registration guide", href: "/guides/registration-and-ticketing.md" })] },
    { id: "operational-resources", title: "Operational resources", blocks: [bullets("Operational Resource Snapshots reconcile live inventory, AV, power, catering, and staffing supply against one exact accepted Plan and trusted event window.", "Unavailable, double-booked, insufficient, or incompatible bindings produce deterministic conflicts and non-applied compatible options.", "Only an explicitly selected option becomes a reviewable Resource Binding Proposal; accepted Plan truth remains unchanged until human Approval."), links({ label: "Operational resource guide", href: "/guides/operational-resources.md" }, { label: "Operational snapshot ADR", href: "/guides/adr/0025-operational-resource-snapshots-are-not-plan-truth.md" })] },
    { id: "typescript-sdk", title: "TypeScript SDK", blocks: [bullets("@venuemind/sdk publishes canonical schema-derived types and a typed client over the same venue.* tool seam used by WebMCP and MCP.", "Adapter helpers preserve one runtime-owned idempotency and retry layer, bounded pagination, raw-byte webhook verification, and review-only planning imports.", "The client intentionally exposes no Approval operation and no whole-snapshot write shortcut."), links({ label: "SDK guide", href: "/guides/sdk.md" }, { label: "Adapter authoring", href: "/guides/adapter-authoring.md" }, { label: "Generated SDK API", href: "/sdk-api.json" }, { label: "Packed SDK example", href: "/examples/client/sdk-adapter/src/index.ts" })] },
    { id: "recovery", title: "Recovery workflow", blocks: [links({ label: "Offline recovery tutorial", href: "/docs/tutorial-offline-recovery" }, { label: "Interchange tutorial", href: "/docs/tutorial-import-export" }, { label: "Project record schema", href: "/schemas/project-record.schema.json" })] },
  ],
};

const authorizationPage = {
  slug: "reference-authorization", group: "Reference", title: "Authorization reference", eyebrow: "Roles, scopes, and policy",
  summary: "Human Roles, Agent Grant scopes, service-boundary permissions, and Approval authority from the published authorization policy.",
  audience: ["operators", "developers", "security reviewers"], compatibility: ["Authorization policy 1", "Agent Grant ≤ 1 hour"],
  sections: [
    { id: "human-roles", title: "Human Roles", blocks: [table([{ key: "role", label: "Role" }, { key: "permissions", label: "Permissions" }], HUMAN_ROLES.map((role: string) => ({ role, permissions: humanRolePermissions[role]?.join(", ") ?? "" })))] },
    { id: "agent-scopes", title: "Agent Grant scopes", blocks: [table([{ key: "scope", label: "Scope" }, { key: "permissions", label: "Permissions" }], AGENT_SCOPES.map((scope: string) => ({ scope, permissions: agentScopePermissions[scope]?.join(", ") ?? "" })))] },
    { id: "policy", title: "Policy decisions", blocks: [bullets(`Agent Grants bind one agent to one Organization and one Project for at most ${MAX_AGENT_GRANT_TTL_MS / 60000} minutes.`, `Approval requires one of: ${DEFAULT_APPROVAL_POLICY.requiredReviewerRoles.join(", ")}.`, "Approval, Warning Waivers, Project Locks, and conflict decisions remain human-only.", "Denied planner commands append sanitized authorization.denied evidence without retaining protected input payloads."), links({ label: "Published authorization policy", href: "/authorization-policy.json" }, { label: "Agent Grant schema", href: "/schemas/agent-grant.schema.json" }, { label: "Authentication and tenancy", href: "/guides/authentication-and-tenancy.md" })] },
  ],
};

const compatibilityPage = {
  slug: "reference-compatibility", group: "Reference", title: "Compatibility and deprecation", eyebrow: "Version policy",
  summary: "Current public versions, comparison rules, migration guarantees, and the policy for changing stable surfaces.",
  audience: ["developers", "agent integrators", "operators"], compatibility: ["Current release", "No active deprecations"],
  sections: [
    { id: "versions", title: "Compatibility matrix", blocks: [table([{ key: "surface", label: "Surface" }, { key: "current", label: "Current" }, { key: "compatibility", label: "Compatibility rule" }], VERSION_REFERENCE)] },
    { id: "deprecation", title: "Deprecation policy", blocks: [table([{ key: "change", label: "Change" }, { key: "policy", label: "Policy" }], DEPRECATION_POLICY)] },
    { id: "status", title: "Current status", blocks: [bullets("No public tool, command, schema field, or skill is currently deprecated.", "Every future deprecation is machine-readable, visible in the changelog, and covered by contract tests.")] },
  ],
};

export const referencePages: readonly DocsPage[] = [
  toolIndexPage,
  commandIndexPage,
  errorPage,
  constraintPage,
  ledgerPage,
  lifecyclePage,
  persistencePage,
  authorizationPage,
  compatibilityPage,
  ...toolReferencePages,
  ...commandReferencePages,
];

export const referenceManifest = Object.freeze({
  schemaVersion: 1,
  toolPages: toolReferencePages.map((page) => ({ name: page.reference.name, path: `/docs/${page.slug}`, requiredFields: page.reference.requiredFields, errors: page.reference.errors, outputFields: page.reference.output.fields, stableIds: page.reference.output.stableIds })),
  commandPages: commandReferencePages.map((page) => ({ name: page.reference.name, path: `/docs/${page.slug}`, permission: page.reference.permission, requiredFields: page.reference.requiredFields, errors: page.reference.errors, outputFields: page.reference.output.fields, stableIds: page.reference.output.stableIds })),
  constraintEvaluators: CONSTRAINT_REFERENCE,
  ledgerEvents: LEDGER_EVENT_REFERENCE,
  versions: VERSION_REFERENCE,
  deprecationPolicy: DEPRECATION_POLICY,
});

export const publishedConstraintEvaluators = venueConstraintSchema.properties.evaluator.enum;
export const publishedLedgerSchemaVersion = activityLedgerSchema.items.properties.schemaVersion.const;
