import { bullets, code, links, prose, steps, type DocsPage, type PublishedDocsPage } from "./blocks.ts";
import { conceptsPage } from "./pages/concepts.ts";
import { clientExamplesPage } from "./pages/examples.ts";
import { contributingPage } from "./pages/contributing.ts";
import { referencePages } from "./pages/reference.ts";
import { tutorialPages } from "./pages/tutorials.ts";

const contentPages: readonly DocsPage[] = [
  {
    slug: "overview",
    group: "Start",
    title: "Venue planning, built for agents and humans",
    eyebrow: "VenueMind docs",
    summary:
      "A versioned spatial-planning system where agents inspect, propose, validate, and compare—while humans retain the commit decision.",
    sections: [
      {
        id: "model",
        title: "The operating model",
        blocks: [
          steps(
            "Inspect the accepted Plan and stable object IDs.",
            "Preview non-destructive Changes on a Proposal branch.",
            "Validate deterministic Constraints.",
            "Review the ghost diff in VenueMind.",
            "Approve into the next immutable Plan Version.",
          ),
        ],
      },
      {
        id: "surfaces",
        title: "One planner, three surfaces",
        blocks: [
          bullets(
            "VenueMind Studio — visible planning, comparison, approval, undo, and export.",
            "Native WebMCP — tools registered directly by the open planning page.",
            "VenueMind MCP server — the same tools over stdio for external agent hosts.",
          ),
        ],
      },
      {
        id: "next",
        title: "Start here",
        blocks: [
          links(
            { label: "Quickstart", href: "/docs/quickstart" },
            { label: "Core concepts", href: "/docs/concepts" },
            { label: "Tool reference", href: "/docs/webmcp" },
          ),
        ],
      },
    ],
  },
  {
    slug: "quickstart",
    group: "Start",
    title: "Quickstart",
    eyebrow: "Five minutes",
    summary: "Open the Studio, inspect the seeded SummitForward Plan, and run the complete supervised Proposal loop.",
    sections: [
      {
        id: "studio",
        title: "Run the Studio",
        blocks: [
          code("npm install\nnpm run dev -- --host 0.0.0.0 --port 4173", "bash"),
          prose(
            "Open the printed local URL. The WebMCP status changes to Native when the browser discovers the registered tools.",
          ),
        ],
      },
      {
        id: "mcp",
        title: "Run the MCP server",
        blocks: [
          code("npm run build:mcp\nnode packages/mcp-server/dist/index.js", "bash"),
          prose(
            "The server uses stdio. Standard output is reserved for MCP protocol messages; operational logs go to standard error.",
          ),
        ],
      },
      {
        id: "loop",
        title: "First planning loop",
        blocks: [
          steps(
            "Call venue.get_project_brief and venue.inspect_layout.",
            "Call venue.preview_revision with a measurable goal.",
            "Call venue.validate_layout.",
            "Review the Proposal in VenueMind.",
            "Approve in the Studio and export the new Plan Version.",
          ),
        ],
      },
    ],
  },
  conceptsPage,
  ...tutorialPages,
  {
    slug: "webmcp",
    group: "Agents",
    title: "WebMCP tools",
    eyebrow: "Native browser tools",
    summary:
      "The active VenueMind page exposes compact tools backed by the same command interface as the visible Studio.",
    sections: [
      {
        id: "runtime",
        title: "Runtime boundary",
        blocks: [
          bullets(
            "Contract version 1.6.0 is attached to every published tool.",
            "Lifecycle states: detecting, registering, ready, failed, unsupported, unregistered.",
            "Every invocation returns a compact text summary and versioned structured content.",
            "Mutation receipts retain caller idempotency and correlation metadata.",
            "Authorization scopes: venue:read, venue:propose, venue:comment, venue:simulate, venue:operate, venue:export.",
            "Input and output byte limits are published per tool and enforced before data crosses the boundary.",
            "Sensitive credentials, contact fields, attendee-record keys, and Incident evidence bytes are excluded from structured results.",
            "Abort signals unregister the page tool suite and cancel active calls where the invoking browser supplies a call signal.",
          ),
        ],
      },
      {
        id: "catalog",
        title: "Generated catalog",
        blocks: [
          prose("Each native browser tool has one canonical reference page shared with the standalone MCP surface."),
          links({ label: "Browse all tool contracts", href: "/docs/reference-tools" }),
        ],
      },
    ],
  },
  {
    slug: "mcp",
    group: "Agents",
    title: "MCP server",
    eyebrow: "External agent hosts",
    summary: "A durable, session-scoped stdio server built on the official Model Context Protocol TypeScript SDK v2.",
    sections: [
      {
        id: "build",
        title: "Build and launch",
        blocks: [
          code("npm run build:mcp\nnode /absolute/path/to/venue-mind/packages/mcp-server/dist/index.js", "bash"),
        ],
      },
      {
        id: "projects",
        title: "Durable Project sessions",
        blocks: [
          bullets(
            "Filesystem repository with atomic writes.",
            "One active Project per MCP connection.",
            "venue.list_projects and venue.open_project select Project scope.",
            "Set VENUEMIND_DATA_DIR to an explicit writable data directory.",
            "Project record schema version 10.",
          ),
        ],
      },
      {
        id: "surfaces",
        title: "Protocol surfaces",
        blocks: [
          bullets(
            "56 tools generated from one shared contract source across WebMCP and standalone MCP.",
            "Current Project, Plan Version, Proposal, schema, documentation, and compatibility resources.",
            "Project and Plan Version resource templates with completion.",
            "Supervised planning and Plan audit prompts.",
            "Progress notifications for Validation and Simulation.",
            "Structured standard-error logs and graceful interruption handling.",
          ),
        ],
      },
      {
        id: "codex",
        title: "Codex",
        blocks: [
          code(
            "codex mcp add venuemind --env VENUEMIND_DATA_DIR=/absolute/path/to/venuemind-data -- node /absolute/path/to/venue-mind/packages/mcp-server/dist/index.js\ncodex mcp get venuemind",
            "bash",
          ),
        ],
      },
      {
        id: "desktop-hosts",
        title: "Claude Desktop, Cursor, and generic clients",
        blocks: [
          code(
            JSON.stringify(
              {
                mcpServers: {
                  venuemind: {
                    command: "node",
                    args: ["/absolute/path/to/venue-mind/packages/mcp-server/dist/index.js"],
                    env: { VENUEMIND_DATA_DIR: "/absolute/path/to/venuemind-data" },
                  },
                },
              },
              null,
              2,
            ),
            "json",
          ),
          bullets(
            "Claude Desktop: add the entry to claude_desktop_config.json and restart.",
            "Cursor: save it as .cursor/mcp.json for Project scope or ~/.cursor/mcp.json for global scope.",
            "Generic local MCP hosts commonly accept the same process configuration.",
          ),
        ],
      },
      {
        id: "inspector",
        title: "Official MCP Inspector",
        blocks: [
          code(
            "npx @modelcontextprotocol/inspector node /absolute/path/to/venue-mind/packages/mcp-server/dist/index.js",
            "bash",
          ),
        ],
      },
      {
        id: "chatgpt",
        title: "ChatGPT-compatible remote deployment",
        blocks: [
          prose(
            "ChatGPT custom MCP apps connect to remote endpoints, not directly to a local stdio process. Put an authenticated Streamable HTTP Adapter or supported secure MCP tunnel in front of the same server Module; never expose the stdio process itself to the network.",
          ),
          bullets(
            "Validate OAuth tokens and token audience.",
            "Publish protected-resource metadata.",
            "Bind Project access to the authenticated principal.",
            "Enforce VenueMind authorization scopes.",
            "Use TLS, restrict origins, and reject caller-supplied organization or actor authority.",
          ),
        ],
      },
      {
        id: "compatibility",
        title: "Compatibility",
        blocks: [
          bullets(
            "MCP server 0.7.0.",
            "Preferred protocol revision 2026-07-28.",
            "Minimum supported revision 2025-03-26.",
            "Tool contract 1.6.0.",
            "Approval, Occupancy Alert acknowledgement, and Incident response authority: human-only. Live Plan Deviation tools create records and review-state post-event Proposals only.",
          ),
        ],
      },
      {
        id: "supervision",
        title: "Human-only approval",
        blocks: [
          prose(
            "The MCP surface can inspect, preview, validate, branch, switch, read, and export. Approval is deliberately absent; the VenueMind Studio owns the human commit decision.",
          ),
        ],
      },
    ],
  },
  {
    slug: "skills",
    group: "Agents",
    title: "Agent skills",
    eyebrow: "Reusable planning behavior",
    summary: "Six versioned skill packages teach supervised VenueMind workflows against tool contract 1.6.0.",
    sections: [
      {
        id: "plan-skill",
        title: "venuemind-plan",
        blocks: [
          prose(
            "Prepare seating, access, circulation, sightline, production, catering, capacity, and queue Proposal branches. Stops at human review.",
          ),
          code("Use $venuemind-plan to create and validate an access-first Proposal branch."),
        ],
      },
      {
        id: "audit-skill",
        title: "venuemind-audit",
        blocks: [
          prose(
            "Reconcile Plan Versions, Constraints, Validation fingerprints, Locks, receipts, approval authorship, and Activity Ledger replay.",
          ),
          code("Use $venuemind-audit to inspect this Plan for stale branches and missing evidence."),
        ],
      },
      {
        id: "access-skill",
        title: "venuemind-access-review",
        blocks: [
          prose(
            "Review routes, doors, ramps, accessible and companion seating, turning space, and access sightlines. It reports policy provenance without claiming legal certification.",
          ),
          code("Use $venuemind-access-review to explain this failed route and prepare a remediation branch."),
        ],
      },
      {
        id: "crowd-skill",
        title: "venuemind-crowd-flow",
        blocks: [
          prose(
            "Run seeded ingress, interval, egress, emergency, queue, and bottleneck scenarios while keeping simulation evidence separate from deterministic Validation.",
          ),
          code("Use $venuemind-crowd-flow to compare these two egress strategies."),
        ],
      },
      {
        id: "production-skill",
        title: "venuemind-production-plan",
        blocks: [
          prose(
            "Plan staging, AV, power points, cable routes, production access, and service lanes while checking audience impacts.",
          ),
          code("Use $venuemind-production-plan to prepare a validated production branch."),
        ],
      },
      {
        id: "event-day-skill",
        title: "venuemind-event-day",
        blocks: [
          prose(
            "Triage live issues with stable incident anchors, current-plan evidence, simulations, and supervised Adjustment Requests.",
          ),
          code("Use $venuemind-event-day to triage this live queue obstruction."),
        ],
      },
      {
        id: "authority",
        title: "Authority boundary",
        blocks: [
          bullets(
            "No skill can accept a Proposal or delete a Project.",
            "No skill may override effective Locks or manufacture a Warning Waiver.",
            "Stale versions, incompatible simulation fingerprints, and missing evidence remain explicit failures.",
            "Emergency response remains with venue operators and local emergency services.",
          ),
        ],
      },
      {
        id: "install",
        title: "Build and install",
        blocks: [
          code(
            "npm run build:skills\ncp -R /absolute/path/to/venue-mind/dist/skills/venuemind-* /absolute/path/to/codex-skills/",
            "bash",
          ),
          links(
            { label: "Skill package manifest", href: "/skills-manifest.json" },
            { label: "Evaluation metrics", href: "/skill-evaluation-metrics.json" },
          ),
        ],
      },
      {
        id: "evaluation",
        title: "Evaluation suite",
        blocks: [
          bullets(
            "14 normal and adversarial workflow cases.",
            "Premature Approval, ignored Locks, stale versions, and missing evidence fixtures.",
            "Required-tool selection accuracy: 100%.",
            "Unnecessary referenced-call rate: 0%.",
            "Every case requires stable evidence and stops at human Approval.",
          ),
        ],
      },
    ],
  },
  clientExamplesPage,
  ...referencePages,
  contributingPage,
  {
    slug: "contracts",
    group: "Reference",
    title: "Schemas and contracts",
    eyebrow: "Machine-readable reference",
    summary: "JSON Schemas are generated from the runtime contract source during every production build.",
    sections: [
      {
        id: "schemas",
        title: "Published schemas",
        blocks: [
          links(
            { label: "Venue command", href: "/schemas/venue-command.schema.json" },
            { label: "Agent Grant", href: "/schemas/agent-grant.schema.json" },
            { label: "Authorization policy", href: "/schemas/authorization-policy.schema.json" },
            { label: "Venue Template catalog", href: "/schemas/venue-template-catalog.schema.json" },
            { label: "Template catalog example", href: "/examples/venue-template-catalog.json" },
            { label: "Event Brief", href: "/schemas/event-brief.schema.json" },
            { label: "Planning Effect", href: "/schemas/planning-effect.schema.json" },
            { label: "Calendar webhook event", href: "/schemas/calendar-webhook-event.schema.json" },
            { label: "Comment anchor", href: "/schemas/comment-anchor.schema.json" },
            { label: "Comment", href: "/schemas/comment.schema.json" },
            { label: "Scenario definition", href: "/schemas/scenario-definition.schema.json" },
            { label: "Simulation result", href: "/schemas/simulation-result.schema.json" },
            { label: "Aggregate Occupancy Signal", href: "/schemas/aggregate-occupancy-signal.schema.json" },
            { label: "Live Occupancy projection", href: "/schemas/live-occupancy-projection.schema.json" },
            { label: "Live Occupancy monitor", href: "/schemas/live-occupancy-monitor.schema.json" },
            { label: "Incident Location Context", href: "/schemas/incident-location-context.schema.json" },
            { label: "Operational Incident", href: "/schemas/operational-incident.schema.json" },
            { label: "Incident Register", href: "/schemas/incident-register.schema.json" },
            { label: "Live Plan Deviation", href: "/schemas/live-plan-deviation.schema.json" },
            { label: "Live Plan Deviation overlay", href: "/schemas/live-plan-deviation-overlay.schema.json" },
            { label: "Live Plan Deviation register", href: "/schemas/live-plan-deviation-register.schema.json" },
            { label: "Post-event Review", href: "/schemas/post-event-review.schema.json" },
            { label: "Project list result", href: "/schemas/project-list-result.schema.json" },
            { label: "Project open result", href: "/schemas/project-open-result.schema.json" },
            { label: "Layout inspection", href: "/schemas/layout-inspection.schema.json" },
            { label: "Preview revision result", href: "/schemas/preview-revision-result.schema.json" },
            { label: "Plan export", href: "/schemas/plan-export.schema.json" },
            { label: "Spatial geometry", href: "/schemas/spatial-geometry.schema.json" },
            { label: "Spatial evidence", href: "/schemas/spatial-evidence.schema.json" },
            { label: "Venue Constraint", href: "/schemas/venue-constraint.schema.json" },
            { label: "Warning Waiver", href: "/schemas/warning-waiver.schema.json" },
            { label: "Object Lock", href: "/schemas/object-lock.schema.json" },
            { label: "Venue error", href: "/schemas/venue-error.schema.json" },
            { label: "Error catalog", href: "/error-catalog.json" },
            { label: "Validation result", href: "/schemas/validation-result.schema.json" },
            { label: "Command receipt", href: "/schemas/command-receipt.schema.json" },
            { label: "Activity Ledger", href: "/schemas/activity-ledger.schema.json" },
            { label: "Proposal conflicts", href: "/schemas/proposal-conflicts.schema.json" },
            { label: "Proposal comparison", href: "/schemas/proposal-comparison.schema.json" },
            { label: "Planner snapshot", href: "/schemas/planner-snapshot.schema.json" },
            { label: "Project record", href: "/schemas/project-record.schema.json" },
            { label: "Interchange Package", href: "/schemas/venue-project-package.schema.json" },
            { label: "Interchange example", href: "/examples/venuemind-project-package.json" },
          ),
        ],
      },
      {
        id: "authorization",
        title: "Authorization policy",
        blocks: [
          prose(
            "Human Roles and Agent Grants are separate authority sources. Policy Decisions are enforced inside planner and tool-service boundaries; denied planner actions append a sanitized Activity Ledger entry without retaining command payloads or protected Project data.",
          ),
          bullets(
            "Human Roles come from server-resolved Organization Memberships: viewer, planner, reviewer, approver, safety officer, venue administrator, organization administrator.",
            "Agent Grants bind one agent to one Organization and one Project, published scopes, issuer, issue time, and expiry of one hour or less.",
            "Approval, Warning Waivers, Lock management, emergency action authority, and conflict decisions remain human-only.",
            "Approval requires an approver, venue administrator, or organization administrator role in addition to passing Validation.",
          ),
          links(
            { label: "Published policy", href: "/authorization-policy.json" },
            { label: "Agent Grant schema", href: "/schemas/agent-grant.schema.json" },
            { label: "Authentication and tenancy", href: "/guides/authentication-and-tenancy.md" },
            { label: "Authorization policy schema", href: "/schemas/authorization-policy.schema.json" },
          ),
        ],
      },
      {
        id: "tool-manifest",
        title: "Generated tool manifest",
        blocks: [
          links(
            { label: "Tool manifest schema", href: "/schemas/venue-tool-manifest.schema.json" },
            { label: "Tool manifest", href: "/venue-tools.json" },
            { label: "Reference manifest", href: "/reference-manifest.json" },
            { label: "Tool examples", href: "/examples/venue-tool-examples.json" },
            { label: "Tool error catalog", href: "/tool-error-catalog.json" },
          ),
        ],
      },
      {
        id: "errors",
        title: "Stable errors",
        blocks: [
          prose(
            "Planner and MCP failures use one error envelope with a stable code, readable message, remediation, and structured details. Unknown internal failures use VENUE_INTERNAL_ERROR without exposing implementation data.",
          ),
          links(
            { label: "Error catalog", href: "/error-catalog.json" },
            { label: "Venue error schema", href: "/schemas/venue-error.schema.json" },
          ),
        ],
      },
      {
        id: "interchange",
        title: "Interchange safety",
        blocks: [
          bullets(
            "Format venuemind-project, version 1.",
            "Maximum package size: 2,000,000 bytes.",
            "SHA-256 binds the canonical Project payload to the manifest.",
            "Import Preview verifies stable IDs, geometry, locks, ledger integrity, replay, and migration before commit.",
            "Import Commit is create-only and returns PROJECT_ID_CONFLICT instead of overwriting an existing Project.",
          ),
        ],
      },
      {
        id: "drawing-adapters",
        title: "DXF and PDF references",
        blocks: [
          prose(
            "VenueMind JSON is the only authoritative import format. DXF and PDF files remain behind an assisted-reference adapter boundary: they require scale calibration, expose confidence and unsupported entities, retain source fingerprints, and can only seed reviewable Proposal Changes through the normal command interface.",
          ),
        ],
      },
      {
        id: "discovery",
        title: "Agent discovery",
        blocks: [links({ label: "llms.txt", href: "/llms.txt" }, { label: "llms-full.txt", href: "/llms-full.txt" })],
      },
      {
        id: "compatibility",
        title: "Compatibility",
        blocks: [links({ label: "Compatibility and deprecation policy", href: "/docs/reference-compatibility" })],
      },
    ],
  },
  {
    slug: "changelog",
    group: "Reference",
    title: "Documentation changelog",
    eyebrow: "Release notes",
    summary: "Visible changes to VenueMind contracts, workflows, compatibility, and operational guidance.",
    sections: [
      {
        id: "tool-contract-1-6-0",
        title: "Tool contract 1.6.0",
        blocks: [
          bullets(
            "Added shared Post-event Review inspection, Observation, Lesson, Template Improvement Proposal, and report-export tools.",
            "Kept Template Improvement Proposal approval, rejection, and publication human-only and outside every agent surface.",
            "Added evidence-traced schemas, standalone MCP Project-session persistence, typed SDK methods, WebMCP parity, and event-day skill guidance.",
          ),
        ],
      },
      {
        id: "tool-contract-1-5-0",
        title: "Tool contract 1.5.0",
        blocks: [
          bullets(
            "Added shared Live Plan Deviation inspection, recording, ending, post-event Proposal, and verified export tools.",
            "Kept the approved Plan immutable; live Changes exist only in the Deviation overlay until a human approves a later Proposal through Studio.",
            "Added exact Deviation schemas, retry-safe browser persistence, MCP Project-session support, typed SDK methods, WebMCP parity, and event-day skill guidance.",
            "Updated MCP 0.7.0, schemas, examples, llms.txt, llms-full.txt, and the generated documentation catalog together.",
          ),
        ],
      },
      {
        id: "tool-contract-1-4-0",
        title: "Tool contract 1.4.0",
        blocks: [
          bullets(
            "Added shared Incident Register inspection, structured Incident reporting, and verified Incident-record export tools.",
            "Kept Incident acknowledgement, escalation, response, ownership, handoff, emergency-action, resolution, closure, and reopening authority human-only.",
            "Added Runbook-bound D1 Incident Register persistence, browser outbox recovery, and a non-modal Studio operations panel.",
            "The current deployment stores structured Incident data only and does not accept file uploads.",
            "Added one actor, one timestamp, one Plan-bound location, one receipt, and one ordered hash-ledger entry for every accepted Incident transition.",
            "Updated MCP 0.6.0, the event-day skill, SDK, schemas, examples, llms.txt, llms-full.txt, and docs catalog together.",
          ),
        ],
      },
      {
        id: "tool-contract-1-3-0",
        title: "Tool contract 1.3.0",
        blocks: [
          bullets(
            "Added four shared Live Occupancy tools for aggregate inspection, signal ingestion, freshness refresh, and verified export.",
            "Added the venue:operate Agent Grant scope while keeping Alert acknowledgement human-only.",
            "Added D1-backed monitor persistence, browser outbox replay, distinct feed states, and an immutable Occupancy Monitor Ledger.",
            "Updated the event-day skill, SDK, schemas, examples, llms.txt, llms-full.txt, and docs catalog together.",
          ),
        ],
      },
      {
        id: "docs-1-2-0",
        title: "Docs 1.2.0",
        blocks: [
          bullets(
            "Generated one contract-bound reference page for every tool and planner command.",
            "Published executable WebMCP, generic MCP, Codex, Claude Desktop, Cursor, TypeScript, retry, failure, and export examples.",
            "Added architecture and persistence diagrams, complete extension paths, migration and testing guides, release checks, recovery runbook, and ADRs for contracts, Validation, ledger integrity, geometry, and authorization.",
            "Expanded generated-file drift coverage to public examples and contributor guides.",
          ),
        ],
      },
      {
        id: "docs-1-1-0",
        title: "Docs 1.1.0",
        blocks: [
          bullets(
            "Added ten end-to-end tutorials for Project creation, the supervised loop, Branch comparison, stale Proposal recovery, auditing, MCP, WebMCP, agent skills, interchange, and offline recovery.",
            "Bound every tutorial to executable production fixtures and explicit completion criteria.",
            "Aligned the production Project API boundary with Project schema 10.",
          ),
        ],
      },
      {
        id: "tool-contract-1-2-0",
        title: "Tool contract 1.2.0",
        blocks: [
          bullets(
            "Published 39 shared WebMCP and MCP tools from one canonical contract source.",
            "Added Project, object, Constraint, Validation evidence, Proposal Branch, adjustment, Scenario, and audit operations.",
            "Added scoped Agent Grants and stable authorization-denial errors.",
            "Kept Approval and destructive Project deletion outside every agent surface.",
          ),
        ],
      },
      {
        id: "skills-1-1-0",
        title: "Agent skills 1.1.0",
        blocks: [
          bullets(
            "Published six installable VenueMind skills.",
            "Added adversarial evaluation cases for premature Approval, ignored Locks, stale versions, and missing evidence.",
            "Published required-tool selection and unnecessary-call metrics.",
          ),
        ],
      },
      {
        id: "project-schema-10",
        title: "Project schema 10",
        blocks: [
          bullets(
            "Added reviewed Emergency Plan evidence and Degraded Scenarios.",
            "Made schema 10 the sole Project runtime format with strict restore and import boundaries.",
            "Kept accepted Plan and Event Brief truth replayable through the hash-chained Activity Ledger.",
          ),
        ],
      },
      {
        id: "docs-policy",
        title: "Documentation policy",
        blocks: [
          prose(
            "Page metadata, navigation, search, deep links, compatibility markers, sitemaps, and agent discovery files are generated from this structured documentation registry. Breaking contract changes must update this changelog in the same release.",
          ),
        ],
      },
    ],
  },
  {
    slug: "safety",
    group: "Reference",
    title: "Safety and supervision",
    eyebrow: "Operational invariants",
    summary: "Agent leverage is high; mutation authority stays narrow and inspectable.",
    sections: [
      {
        id: "preview",
        title: "Preview before commit",
        blocks: [
          prose("Agent-created Changes remain visual ghosts on a Proposal. They do not mutate the accepted Plan."),
        ],
      },
      {
        id: "concurrency",
        title: "Base-version control",
        blocks: [
          prose(
            "Every Proposal names one baseVersion. A stale Proposal is rejected and must be refreshed from a new inspection.",
          ),
        ],
      },
      {
        id: "idempotency",
        title: "Retry safety",
        blocks: [
          prose(
            "Every mutating command carries an idempotency key. Exact retries return the original Command Receipt; reusing a key with different input is rejected before state changes.",
          ),
        ],
      },
      {
        id: "locks",
        title: "Object Locks",
        blocks: [
          prose(
            "Locks protect position, rotation, dimensions, deletion, or role independently. Venue-template Locks are inherited; only humans can add or release temporary Project Locks. Validation and Proposal conflicts identify the exact Lock. Rejected lock attempts receive an idempotent Command Receipt and a hash-chained Activity Ledger record without changing the Plan.",
          ),
        ],
      },
      {
        id: "waivers",
        title: "Warning disposition",
        blocks: [
          prose(
            "Agents cannot create Warning Waivers. A human must select a reason code before Approval; the author, time, Constraint, Proposal, and Validation fingerprint remain in the Activity Ledger and audit export.",
          ),
        ],
      },
      {
        id: "emergency-review",
        title: "Emergency authority",
        blocks: [
          prose(
            "Emergency-affecting Proposals require a separate authorized human Emergency Review before Approval. Reviewer identity, role, accepted assumptions, changed object IDs, base Plan Version, Validation input fingerprint, and emergency evidence fingerprint are committed together; agents cannot supply or bypass this authority.",
          ),
        ],
      },
      {
        id: "trace",
        title: "Traceability",
        blocks: [
          prose(
            "Activity Ledger events are schema-versioned and hash chained. Accepted Plan evidence can be replayed and compared with the current Plan fingerprint; audit export packages the chain, Validation, receipts, branches, and accepted Plan.",
          ),
        ],
      },
    ],
  },
];

const metadataBySlug: Readonly<
  Record<string, Readonly<{ audience: readonly string[]; compatibility: readonly string[] }>>
> = {
  overview: {
    audience: ["operators", "developers", "agents"],
    compatibility: ["Project schema 10", "Tool contract 1.6.0"],
  },
  quickstart: { audience: ["operators", "developers"], compatibility: ["MCP 0.7.0", "Tool contract 1.6.0"] },
  concepts: {
    audience: ["operators", "developers", "agents"],
    compatibility: ["Project schema 10", "Validation 2.7.0"],
  },
  webmcp: { audience: ["agent integrators", "developers"], compatibility: ["WebMCP 1.6.0", "56 tools"] },
  mcp: { audience: ["agent integrators", "developers"], compatibility: ["MCP 0.7.0", "Protocol 2026-07-28"] },
  skills: { audience: ["agents", "developers"], compatibility: ["Skills 1.4.0", "Tool contract 1.6.0"] },
  contracts: {
    audience: ["developers", "agent integrators"],
    compatibility: ["Project schema 10", "Tool contract 1.6.0"],
  },
  changelog: {
    audience: ["operators", "developers", "agent integrators"],
    compatibility: ["Docs 1.0.0", "Reviewed 2026-08-27"],
  },
  safety: {
    audience: ["operators", "reviewers", "agents"],
    compatibility: ["Authorization policy 1", "Ledger schema 1"],
  },
};

export const docsPages: readonly PublishedDocsPage[] = contentPages.map((page) => {
  const metadata = metadataBySlug[page.slug];
  return {
    ...page,
    description: page.summary,
    canonicalPath: page.slug === "overview" ? "/docs" : `/docs/${page.slug}`,
    lastReviewedVersion: "VenueMind 0.7.0",
    audience: metadata?.audience ?? page.audience ?? [],
    compatibility: metadata?.compatibility ?? page.compatibility ?? [],
  };
});

export const docsPageBySlug: Readonly<Record<string, PublishedDocsPage>> = Object.fromEntries(
  docsPages.map((page) => [page.slug, page]),
);

export const publicDocsWorkflows = [
  ...tutorialPages.map((page) => ({ id: page.tutorial.id, href: page.canonicalPath ?? `/docs/${page.slug}` })),
];
