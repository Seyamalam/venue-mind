import { venueToolContracts } from "../../contracts/venue-contracts.js";
import { bullets, code, links, prose, steps } from "../blocks.js";

const toolCall = (name, input) => {
  const contract = venueToolContracts.find((tool) => tool.name === name);
  if (!contract) throw new Error(`Unknown tutorial tool: ${name}`);
  return code(JSON.stringify({ tool: name, input: input ?? contract.exampleInput }, null, 2), "json");
};

const tutorialPage = ({ slug, title, eyebrow, summary, minutes, evidenceFiles, sections, compatibility = ["Project schema 10", "Tool contract 1.2.0"] }) => {
  const verificationCommand = `node --test ${evidenceFiles.join(" ")}`;
  return {
    slug,
    group: "Tutorials",
    title,
    eyebrow,
    summary,
    audience: ["operators", "developers", "agent integrators"],
    compatibility,
    tutorial: { id: slug.replace(/^tutorial-/, ""), minutes, evidenceFiles, verificationCommand },
    sections: [
      ...sections,
      { id: "verify", title: "Verify the workflow", blocks: [prose("Run the executable fixture from the repository root. Completion requires a zero exit code."), code(verificationCommand, "bash")] },
    ],
  };
};

export const tutorialPages = [
  tutorialPage({
    slug: "tutorial-first-project",
    title: "Create your first Project",
    eyebrow: "Tutorial · 5 minutes",
    summary: "Create a durable empty Project, open its canonical Plan, and confirm its first Validation result.",
    minutes: 5,
    evidenceFiles: ["tests/empty-project.test.mjs", "tests/project-store.test.mjs"],
    sections: [
      { id: "prerequisites", title: "Prerequisites", blocks: [code("npm install\nnpm run dev -- --host 0.0.0.0 --port 4173", "bash"), bullets("Keep the development process running.", "Open http://localhost:4173/projects.")] },
      { id: "create", title: "Create and open", blocks: [steps("Select NEW PROJECT.", "Open the new Project card.", "Confirm the Studio header shows Plan v1.0.", "Open the Event Brief and set the event identity, attendance target, occupancy mode, and measurable requirements.", "Save the brief; unresolved measurable requirements remain visible until they map to Constraints.")] },
      { id: "completion", title: "Completion criteria", blocks: [bullets("The Project appears in the Project index after navigation and reload.", "The Plan uses metres, stable Project-scoped IDs, and an empty accepted object set.", "Validation returns pass for the valid empty starting geometry.", "The Project record reports remote persistence or an explicit local recovery state.")] },
      { id: "next", title: "Next workflow", blocks: [links({ label: "Run the supervised planning loop", href: "/docs/tutorial-supervised-loop" })] },
    ],
  }),
  tutorialPage({
    slug: "tutorial-supervised-loop",
    title: "Run the supervised planning loop",
    eyebrow: "Tutorial · 1 minute",
    summary: "Inspect, preview, validate, review, approve, and export one versioned venue revision.",
    minutes: 1,
    evidenceFiles: ["tests/webmcp-conformance.test.mjs", "tests/venue-planner.test.mjs"],
    sections: [
      { id: "prepare", title: "Prepare", blocks: [steps("Open /studio/project-summit-forward in a WebMCP-capable host.", "Confirm the WebMCP diagnostic status is READY.", "Keep the accepted Plan visible while the agent works.")] },
      { id: "inspect", title: "Inspect accepted truth", blocks: [toolCall("venue.get_project_brief"), toolCall("venue.inspect_layout"), prose("Retain the returned Plan Version, Proposal ID, stable object IDs, Locks, and correlation metadata.")] },
      { id: "preview", title: "Preview a measurable outcome", blocks: [toolCall("venue.preview_revision", { goal: "Reduce entrance congestion while preserving accessible routes", idempotencyKey: "tutorial-preview-001", correlationId: "tutorial-loop-001" }), prose("The violet ghosts are Proposal Changes. The accepted Plan remains unchanged.")] },
      { id: "validate", title: "Validate exact evidence", blocks: [toolCall("venue.validate_layout"), bullets("Resolve every hard failure before review.", "A human must disposition every waivable warning.", "The Validation fingerprint must match the visible Proposal candidate.")] },
      { id: "review-approve-export", title: "Review, approve, and export", blocks: [steps("Compare each violet Change with the accepted Plan.", "Select Approve proposal in the Studio only when Validation passes and required reviews are complete.", "Confirm the immutable Plan Version advances and the Approval appears in the Activity Ledger.", "Export VM JSON or PDF from the Studio, or call venue.export_plan after Approval.")] },
      { id: "completion", title: "Completion criteria", blocks: [bullets("The agent never invokes Approval.", "Exactly one human Approval creates exactly one Plan Version.", "The export identifies the new version and carries Validation and ledger evidence.")] },
    ],
  }),
  tutorialPage({
    slug: "tutorial-compare-branches",
    title: "Compare access-first and capacity-first branches",
    eyebrow: "Tutorial · 8 minutes",
    summary: "Create two competing Proposal Branches, validate both, and record a human decision from measurable evidence.",
    minutes: 8,
    evidenceFiles: ["tests/venue-planner.test.mjs"],
    sections: [
      { id: "create-branches", title: "Create both strategies", blocks: [toolCall("venue.create_proposal_branch", { name: "Access first", strategy: "access-first", goal: "Maximize accessible route clearance", idempotencyKey: "tutorial-access-branch-001" }), toolCall("venue.create_proposal_branch", { name: "Capacity first", strategy: "balanced", goal: "Increase usable seating without reducing required clearances", idempotencyKey: "tutorial-capacity-branch-001" })] },
      { id: "develop", title: "Develop and validate independently", blocks: [steps("Switch to Access first, preview its goal, and call venue.validate_layout.", "Switch to Capacity first, preview its goal, and call venue.validate_layout.", "Keep both Branch IDs and Validation fingerprints.", "Do not reuse one Branch result as evidence for the other.")] },
      { id: "compare", title: "Compare evidence", blocks: [prose("Use the Branch IDs returned by the two create calls. In a fresh seeded Project they are branch-2 and branch-3."), toolCall("venue.compare_proposal_branches", { leftBranchId: "branch-2", rightBranchId: "branch-3" }), bullets("Review capacity, access width, circulation, egress, sightlines, risk, inventory cost, and Constraint deltas.", "Open Plan history → Branches → Compare to inspect the spatial overlay.", "Enter a decision note and choose the evidence-backed Branch.")] },
      { id: "completion", title: "Completion criteria", blocks: [bullets("Both Branches retain independent Changes and Validation results.", "The chosen and rejected Branch IDs, comparison fingerprint, and rationale appear in the Activity Ledger.", "The accepted Plan remains unchanged until a separate human Approval.")] },
    ],
  }),
  tutorialPage({
    slug: "tutorial-stale-proposal",
    title: "Resolve a stale Proposal",
    eyebrow: "Tutorial · 10 minutes",
    summary: "Rebase a Proposal onto newer accepted truth without losing stable Change lineage or bypassing conflicts.",
    minutes: 10,
    evidenceFiles: ["tests/venue-planner.test.mjs"],
    sections: [
      { id: "create-stale-state", title: "Create the stale state", blocks: [steps("Create two Proposal Branches from the same accepted Plan Version.", "Validate and approve the first Branch in the Studio.", "Switch to the second Branch; its base version now trails the accepted Plan.", "Confirm the Branch shows STALE before attempting further review.")] },
      { id: "detect", title: "Detect conflicts", blocks: [prose("Use the Branch ID returned when you created the second Branch."), toolCall("venue.detect_proposal_conflicts", { branchId: "branch-3" }), bullets("Read every conflict type, affected object ID, blocking state, and permitted resolution.", "A deleted dependency or effective Lock must remain explicit.")] },
      { id: "rebase", title: "Rebase and resolve", blocks: [toolCall("venue.rebase_proposal", { branchId: "branch-3", idempotencyKey: "tutorial-rebase-001" }), steps("Resolve remaining same-object or geometry conflicts with keep-plan, keep-proposal, or manual resolution only where the conflict permits it.", "Run venue.validate_layout again.", "Review any transformed Change with its new ID and lineage.")] },
      { id: "completion", title: "Completion criteria", blocks: [bullets("Unchanged Changes retain their stable Change IDs.", "Transformed Changes receive new IDs with explicit lineage.", "Validation evaluates the rebased fingerprint.", "Approval is enabled only after all blocking conflicts and hard failures are cleared.")] },
    ],
  }),
  tutorialPage({
    slug: "tutorial-audit-plan",
    title: "Audit an approved Plan Version",
    eyebrow: "Tutorial · 7 minutes",
    summary: "Verify approval authority, deterministic evidence, ledger integrity, and replay for one immutable Plan Version.",
    minutes: 7,
    evidenceFiles: ["tests/venue-planner.test.mjs", "tests/plan-exports.test.mjs", "tests/authorization.test.mjs"],
    sections: [
      { id: "collect", title: "Collect the evidence", blocks: [toolCall("venue.inspect_layout"), toolCall("venue.get_validation_evidence"), toolCall("venue.get_change_log"), prose("Use one exact Plan Version and preserve every returned fingerprint and stable ID.")] },
      { id: "replay", title: "Verify history", blocks: [toolCall("venue.replay_history"), bullets("The ledger hash chain must pass.", "The replayed current Plan fingerprint must match the stored fingerprint.", "The Approval actor must be human and authorized.", "Every waiver and Emergency Review must bind the approved Proposal and Validation fingerprint.")] },
      { id: "export", title: "Export the audit package", blocks: [toolCall("venue.export_audit_package"), prose("Store the package checksum with the review record. The export is read-only and cannot change the Plan.")] },
      { id: "completion", title: "Completion criteria", blocks: [bullets("Ledger integrity and replay both pass.", "The accepted Plan Version, Validation, Approval, reviews, receipts, comments, and geometry fingerprints reconcile.", "No agent-authored Approval or fabricated waiver exists.")] },
    ],
  }),
  tutorialPage({
    slug: "tutorial-mcp-install",
    title: "Install the VenueMind MCP server",
    eyebrow: "Tutorial · 6 minutes",
    summary: "Build the standalone stdio server, connect one host, and open a durable Project-scoped session.",
    minutes: 6,
    evidenceFiles: ["tests/mcp-server.test.mjs"],
    compatibility: ["MCP 0.4.0", "Protocol 2026-07-28"],
    sections: [
      { id: "build", title: "Build the server", blocks: [code("npm install\nnpm run build:mcp", "bash")] },
      { id: "configure", title: "Configure Codex", blocks: [code("mkdir -p ./venuemind-data\ncodex mcp add venuemind --env VENUEMIND_DATA_DIR=$PWD/venuemind-data -- node $PWD/packages/mcp-server/dist/index.js\ncodex mcp get venuemind", "bash"), prose("Other stdio hosts use the same command, arguments, and explicit writable data directory.")] },
      { id: "open", title: "Open a Project session", blocks: [toolCall("venue.list_projects"), toolCall("venue.open_project", { projectId: "project-summit-forward" }), toolCall("venue.inspect_layout")] },
      { id: "completion", title: "Completion criteria", blocks: [bullets("The host lists all 39 tool contracts at version 1.2.0.", "The active session is bound to one Project.", "Project state survives a server restart.", "Approval remains absent from the tool list.")] },
      { id: "clients", title: "Other clients", blocks: [links({ label: "MCP client configurations", href: "/docs/mcp#desktop-hosts" })] },
    ],
  }),
  tutorialPage({
    slug: "tutorial-webmcp",
    title: "Use VenueMind through native WebMCP",
    eyebrow: "Tutorial · 5 minutes",
    summary: "Expose the active Studio as a scoped browser tool surface and complete a safe read-to-Proposal workflow.",
    minutes: 5,
    evidenceFiles: ["tests/webmcp-conformance.test.mjs"],
    compatibility: ["WebMCP 1.2.0", "39 tools"],
    sections: [
      { id: "open", title: "Open the native surface", blocks: [steps("Start the VenueMind development server.", "Open /studio/project-summit-forward in a WebMCP-capable browser host.", "Open WebMCP diagnostics and confirm READY, contract 1.2.0, and 39 registered tools.")] },
      { id: "invoke", title: "Invoke through the browser", blocks: [toolCall("venue.inspect_layout"), toolCall("venue.preview_revision", { goal: "Protect the west accessible route and reduce entrance congestion", idempotencyKey: "tutorial-webmcp-preview-001", correlationId: "tutorial-webmcp-001" }), toolCall("venue.validate_layout")] },
      { id: "observe", title: "Observe the shared state", blocks: [bullets("The Studio displays the same Proposal and violet ghost Changes returned to the caller.", "Tool results contain bounded structured content plus a compact summary.", "The call correlation and idempotency metadata appear in receipts and the Activity Ledger.", "Reloading the page unregisters and safely registers the tool suite again.")] },
      { id: "completion", title: "Completion criteria", blocks: [bullets("Read and Proposal calls succeed within their Agent Grant scopes.", "Missing scope, oversized input, cancellation, and stale state return stable error envelopes.", "The agent cannot approve or delete a Project.")] },
    ],
  }),
  tutorialPage({
    slug: "tutorial-skills",
    title: "Install and invoke VenueMind agent skills",
    eyebrow: "Tutorial · 6 minutes",
    summary: "Build six versioned skill packages and invoke the smallest workflow-specific skill for the task.",
    minutes: 6,
    evidenceFiles: ["tests/skills.test.mjs"],
    compatibility: ["Skills 1.1.0", "Tool contract 1.2.0"],
    sections: [
      { id: "build", title: "Build and inspect", blocks: [code("npm run build:skills\nnpm run validate:skills\nnode -e \"const m=require('./dist/skills/manifest.json'); console.log(m.packages.map(p => p.name+'@'+p.version).join('\\n'))\"", "bash"), prose("Install the desired directory from dist/skills into the skill location used by the agent host.")] },
      { id: "choose", title: "Choose one skill", blocks: [bullets("venuemind-plan — supervised planning and Proposal branches.", "venuemind-audit — evidence, authority, ledger, and replay.", "venuemind-access-review — accessible routes, seating, doors, ramps, and sightlines.", "venuemind-crowd-flow — deterministic Scenario comparison and queue evidence.", "venuemind-production-plan — AV, staging, power, rigging, cable, and service routes.", "venuemind-event-day — live issue triage and supervised adjustments.")] },
      { id: "invoke", title: "Invoke with a bounded outcome", blocks: [code("Use $venuemind-access-review to inspect the active Proposal, explain every failed accessibility Constraint by stable ID, and prepare one validated remediation branch. Stop at human review.", "text")] },
      { id: "completion", title: "Completion criteria", blocks: [bullets("The installed package version and tool contract version match the manifest.", "The skill loads generated schema references only when its workflow needs them.", "Required evidence is present and unnecessary referenced calls remain absent.", "The skill stops at human Approval.")] },
    ],
  }),
  tutorialPage({
    slug: "tutorial-import-export",
    title: "Import, validate, and export a venue plan",
    eyebrow: "Tutorial · 8 minutes",
    summary: "Preview an Interchange Package, commit it as a new Project, validate exact geometry, and produce portable exports.",
    minutes: 8,
    evidenceFiles: ["tests/interchange.test.mjs", "tests/plan-exports.test.mjs"],
    sections: [
      { id: "preview", title: "Preview before import", blocks: [steps("Open /projects and select IMPORT.", "Choose public/examples/venuemind-project-package.json from the repository.", "Review the package ID, schema, checksum, stable-ID checks, geometry checks, Lock checks, ledger integrity, and replay status.", "Confirm the Project ID does not already exist.")] },
      { id: "commit", title: "Commit and validate", blocks: [steps("Select IMPORT PROJECT only when the preview status is ready.", "Open the created Project.", "Run venue.inspect_layout and venue.validate_layout.", "Reconcile the candidate geometry and Validation fingerprints with the import preview.")] },
      { id: "export", title: "Export portable evidence", blocks: [toolCall("venue.export_plan", { format: "package" }), toolCall("venue.export_plan", { format: "pdf" }), toolCall("venue.export_audit_package"), bullets("Use VM JSON for authoritative round-trip interchange.", "Use PDF or layered SVG for human review.", "Use the audit package for ledger, replay, and evidence verification.")] },
      { id: "completion", title: "Completion criteria", blocks: [bullets("Import never overwrites an existing Project ID.", "The clean installation reproduces the same Plan, Constraint, version, and ledger fingerprints.", "Every export identifies the evaluated Plan Version and Validation evidence.")] },
    ],
  }),
  tutorialPage({
    slug: "tutorial-offline-recovery",
    title: "Recover from offline local state",
    eyebrow: "Tutorial · 7 minutes",
    summary: "Preserve Project work when the remote Project endpoint is unavailable and reconcile it without silent data loss.",
    minutes: 7,
    evidenceFiles: ["tests/project-store.test.mjs"],
    sections: [
      { id: "seed", title: "Seed the recovery cache", blocks: [steps("Open a Project while the Project API is available.", "Confirm the Studio save indicator reports REMOTE.", "Make one Proposal-safe change and wait for the remote save.", "The browser now holds a recovery copy under the Project-scoped storage key.")] },
      { id: "work-offline", title: "Continue during an API outage", blocks: [steps("Block requests matching /api/projects while keeping the application assets available.", "Create or adjust a Proposal Change.", "Confirm the save indicator reports LOCAL.", "Navigate to /projects and confirm the cached Project remains discoverable with its complete snapshot.")] },
      { id: "recover", title: "Recover deliberately", blocks: [steps("Restore the Project endpoint before accepting further shared changes.", "Open the locally recovered Project and export VM JSON as a safety copy.", "Compare its updated time, Plan Version, Proposal, and latest receipt with the remote record.", "Preserve divergent work as a Proposal Branch; do not silently replace accepted remote truth.")] },
      { id: "completion", title: "Completion criteria", blocks: [bullets("The local record retains schema version 10 and the exact Project snapshot.", "Remote failure is explicit through the LOCAL status.", "Recovery never changes accepted Plan truth without the ordinary Proposal, Validation, and human Approval path.")] },
    ],
  }),
];

export const tutorialEvidence = tutorialPages.map((page) => ({
  id: page.tutorial.id,
  pageSlug: page.slug,
  ...page.tutorial,
}));
