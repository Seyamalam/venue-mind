import { bullets, prose, type DocsPage } from "../blocks.ts";

export const conceptsPage = {
  slug: "concepts",
  group: "Build",
  title: "Core concepts",
  eyebrow: "Domain language",
  summary: "VenueMind separates accepted spatial truth from agent-authored possibilities.",
  sections: [
    {
      id: "project-lifecycle",
      title: "Project Lifecycle",
      blocks: [
        prose(
          "Project duplication starts a new version-1 lineage with new Project, Plan, Event Brief, Requirement, Proposal, and Change IDs plus source-Plan provenance. Rename, pin, recent-open, archive, restore, and typed-confirmation soft delete preserve the complete snapshot. Deleted Projects remain recoverable for seven days.",
        ),
      ],
    },
    {
      id: "templates",
      title: "Venue, Room, and Inventory Templates",
      blocks: [
        prose(
          "Venue and Room Templates are reusable, versioned physical definitions. Every Project pins exact template versions while its placed objects keep separate Project-scoped IDs. Inventory Item Templates cover furniture, seating, barriers, staging, AV, catering, signage, and queues with dimensions, weight, power, capacity, cost, and availability metadata.",
        ),
      ],
    },
    {
      id: "template-updates",
      title: "Template Updates and Project Overrides",
      blocks: [
        prose(
          "A newer Room Template produces a reviewable Proposal containing only safe differences. Field-level Project Overrides remain authoritative, unavailable additions and deletions are reported for review, and the accepted Plan remains unchanged until normal Validation and human Approval succeed.",
        ),
      ],
    },
    {
      id: "plan",
      title: "Plan and Plan Version",
      blocks: [
        prose(
          "A Plan is the accepted spatial arrangement for one event in one venue room. Every accepted revision is immutable and identified by a Plan Version.",
        ),
      ],
    },
    {
      id: "brief",
      title: "Event Brief and Requirement",
      blocks: [
        prose(
          "The Event Brief stores event identity, attendance, occupancy mode, and stable prioritized Requirements. Coverage maps measurable Requirements to Constraint evidence for both the accepted Plan and the active Proposal.",
        ),
      ],
    },
    {
      id: "geometry",
      title: "Room Boundary and Footprint",
      blocks: [
        prose(
          "Every Plan uses one real-world spatial frame measured in metres. The Room Boundary defines valid space; each object has a typed Footprint, elevation, layer, and stable ID. Distance is normalized to millimetre precision and rotation to a tenth of a degree.",
        ),
      ],
    },
    {
      id: "operations",
      title: "Operational geometry",
      blocks: [
        prose(
          "Doors and exits are line Footprints with clear-width and access metadata. Corridors, aisles, and service lanes are typed Route Graph edges. Restricted Zones are polygonal or rectangular Footprints with explicit access and placement rules.",
        ),
      ],
    },
    {
      id: "access-infrastructure",
      title: "Accessible infrastructure",
      blocks: [
        prose(
          "Accessible Seat Samples bind designated representative seats to focal-point rays. Door Clearance Zones are derived from Door geometry and maneuvering metadata. Temporary Ramps carry rise, run, clear width, landing, edge-protection, and handrail evidence.",
        ),
      ],
    },
    {
      id: "occupancy-zones",
      title: "Capacity and Occupancy Zones",
      blocks: [
        prose(
          "Capacity evidence reconciles Seating Section counts into stable Occupancy Zones and the full Plan. Each scope has independent minimum and maximum bounds. Every Proposal Change records isolated section, zone, placed, effective, and operational-load deltas against the accepted Plan.",
        ),
      ],
    },
    {
      id: "live-occupancy",
      title: "Live Occupancy Monitor",
      blocks: [
        prose(
          "A Live Occupancy Monitor is an event-day projection anchored to one active Runbook Version and its frozen accepted Plan. It accepts aggregate check-in and zone totals only; person, ticket, contact, device, and individual scan records are rejected before storage.",
        ),
        bullets(
          "Stable source IDs and versions make retries, source rollback, and conflicting feeds explicit.",
          "Every scope reports nominal, warning, exceeded, conflicting, stale, or unavailable state with freshness and confidence.",
          "Approved capacity remains authoritative; optional Simulation assumptions appear only as a separately labeled delta.",
          "Alert open, resolve, and human acknowledgement transitions append to a hash-chained Occupancy Monitor Ledger.",
          "Browser outbox replay preserves idempotency across offline operation and reconnect.",
        ),
      ],
    },
    {
      id: "incident-register",
      title: "Incident Register and Operational Incident",
      blocks: [
        prose(
          "One Incident Register belongs to one active Runbook Version and freezes the accepted Plan, Validation, Approval, Emergency Plan, and Runbook ledger head used on event day. An Operational Incident is a structured issue inside that register; it is never a free-form person record and an Occupancy Alert remains linked evidence rather than becoming the Incident itself.",
        ),
        bullets(
          "Every report and transition carries one stable Incident ID, actor, server-accepted timestamp, Plan-bound object or in-room coordinate, per-Incident revision, receipt, and globally ordered hash-chained ledger entry.",
          "Severity, category, summary code, owner, acknowledgement, escalation, status, handoff, emergency action, and resolution are structured fields.",
          "Agents may inspect, report, and export. Acknowledgement, escalation, ownership, response, handoff, emergency action, resolution, closure, and reopening remain authenticated human actions.",
          "The current deployment stores structured Incident records only and does not accept file uploads.",
          "Browser outbox replay preserves exact idempotency and retains conflicts for operator recovery.",
        ),
      ],
    },
    {
      id: "live-plan-deviations",
      title: "Live Plan Deviation Register",
      blocks: [
        prose(
          "A Live Plan Deviation Register belongs to one active Runbook Version and freezes the approved Plan as immutable historical truth. Event-day spatial Changes are stored as separate, ordered Deviation records and combined only in a deterministic active overlay.",
        ),
        bullets(
          "Every Deviation carries one stable ID, disposition, reason code, Plan-bound location, exact affected objects, author evidence, optimistic revision, receipt, and hash-chained ledger entry.",
          "Each emergency Change is validated against the explicitly available live Constraints before it enters the overlay.",
          "Temporary records can end without becoming planning history. Ended revision-candidate records may seed a normal review-state post-event Proposal.",
          "Agents may inspect, record, end, export, and prepare post-event Proposals. Only humans may approve a Proposal into accepted Plan truth.",
          "The export keeps the approved Plan, live Deviation overlay, and post-event recommendations in separate fields.",
        ),
      ],
    },
    {
      id: "circulation-evidence",
      title: "Circulation and Egress Evidence",
      blocks: [
        prose(
          "The walkable Route Graph excludes edges obstructed by placement geometry. Validation derives Exit Approach Zones, shortest egress paths, Critical Route Edges, component-level Bottleneck Loads, phase profiles, and isolated congestion deltas for every Proposal Change.",
        ),
      ],
    },
    {
      id: "proposal",
      title: "Proposal, Branch, and Change",
      blocks: [
        prose(
          "A Proposal is a non-destructive candidate based on exactly one Plan Version. Branches preserve competing strategies; Changes are stable, inspectable spatial differences inside a Proposal.",
        ),
      ],
    },
    {
      id: "editing",
      title: "Proposal-safe editing",
      blocks: [
        prose(
          "Studio transforms, placement, grouping, zoning, clipboard operations, and layout presets all create Proposal Changes through the same command interface used by agents. The accepted Plan is never edited in place. Each command has a stable Change ID, supports undo and redo, appears in the Activity Ledger, and remains subject to Validation and human Approval.",
        ),
        bullets(
          "Selection, box selection, pan, zoom, grid snapping, alignment, distribution, and numeric transforms share canonical metre-based geometry.",
          "Layer visibility and layer locks are local workspace controls; object Locks are durable Project records enforced by the planner.",
          "Measurements are read-only and evaluate the active Proposal candidate without creating a Change.",
        ),
      ],
    },
    {
      id: "proposal-conflicts",
      title: "Proposal Conflicts",
      blocks: [
        prose(
          "Conflict detection returns stale-base, deleted-dependency, Lock, same-object, geometry-overlap, and Constraint-regression records with stable IDs and permitted outcomes. Human keep-plan and keep-proposal choices preserve unchanged Change IDs. Manual Resolution replaces only transformed Changes with new stable IDs and explicit lineage, then reruns Validation and appends the outcome to the Activity Ledger.",
        ),
      ],
    },
    {
      id: "proposal-comparison",
      title: "Proposal comparison and decisions",
      blocks: [
        prose(
          "Branch comparison overlays the accepted Plan with both candidates and reports added, removed, moved, rotated, resized, and metadata differences. Capacity, access width, circulation load, egress distance, sightline coverage, deterministic risk, estimated inventory cost, and Constraint outcomes are evaluated from each candidate.",
        ),
        prose(
          "Branches keep human notes and Proposal revision history. Any revision can seed a new Branch; archive and restore preserve that history. A human decision checkpoint records the chosen Branch, rejected alternatives, comparison fingerprint, and rationale in the Activity Ledger before Approval.",
        ),
      ],
    },
    {
      id: "comments",
      title: "Comments and immutable anchors",
      blocks: [
        prose(
          "Comments are collaboration records, not planning mutations. Each Comment binds permanently to a Project, Plan Version, Proposal, Change, Constraint, or metre-based coordinate. Branch switches and later Plan Versions never retarget that anchor.",
        ),
        prose(
          "Open, resolved, and reopened states retain author, timestamps, mentions, and complete edit history. Decision-relevant Comments are included in audit exports; coordinate Comments render as numbered annotation pins in the Studio.",
        ),
      ],
    },
    {
      id: "exports",
      title: "Operational exports",
      blocks: [
        prose(
          "The shared export command produces layered SVG with stable object IDs and accessible labels, a two-page vector PDF with Plan and Validation evidence, a one-page print-safe Emergency Plan, RFC4180 object, inventory, staffing, production, catering, and replenishment schedules, staffing and production maps, structured JSON or text, and a portable audit package bound to geometry, ledger, and replay fingerprints.",
        ),
        bullets(
          "PDF output identifies the evaluated Proposal and accepted base Plan Version.",
          "The Emergency Plan PDF renders routes, exits, safety infrastructure, readiness, degraded-scenario outcomes, and its evidence fingerprint without raster dependencies.",
          "Inventory schedules reconcile requested stock, availability, cost, weight, and power.",
          "Operational exports derive from the same accepted Plan and deterministic evidence used by Approval.",
          "Audit packages include decision-relevant Comments, public command receipts, Emergency Reviews, assumptions, and scenario evidence.",
          "Studio and agent tools invoke the same read-only export command.",
        ),
      ],
    },
    {
      id: "constraints",
      title: "Constraint and Validation",
      blocks: [
        prose(
          "Constraints are measurable conditions. Validation deterministically evaluates locks, accessibility, capacity, sightlines, circulation, production, catering, emergency readiness, and congestion against actual and threshold values. Byte-equivalent results are reused only when the immutable Validation input fingerprint and its canonical input both match.",
        ),
      ],
    },
    {
      id: "simulation",
      title: "Scenario and Simulation Run",
      blocks: [
        prose(
          "A Scenario is an immutable set of assumptions, phases, time horizon, sample count, and deterministic seed evaluated against one exact Proposal Branch geometry fingerprint. A Simulation Run stores engine version, progress, partial checkpoints, confidence metadata, and its completed, cancelled, or failed outcome.",
        ),
        prose(
          "Simulation is probabilistic evidence and never becomes Constraint evidence. A changed Proposal cancels its obsolete active Run; identical immutable inputs reuse the cached normalized result. Compatible completed Runs require matching Scenario definition fingerprints and engine versions.",
        ),
      ],
    },
    {
      id: "flow-simulation",
      title: "Ingress and egress",
      blocks: [
        prose(
          "The ingress-egress model combines monotonic arrival and departure curves with aggregate Mobility Profiles. Profiles contain only a stable cohort ID, population share, speed factor, and accessible-route requirement; no person-level records enter the engine.",
        ),
        bullets(
          "Infrastructure is derived from the exact Plan or Proposal Branch: entrances, exits, checkpoints, Doors, stairs, elevators, Corridors, Aisles, accessible routes, occupied Sections, and Route Graph paths.",
          "Every result includes zone and full-venue clearance, bottleneck duration and affected occupancy, accessible-route performance, normal versus emergency assumptions, and time-keyed Density Frames.",
          "Density cells bind aggregate persons-per-square-metre estimates to stable object IDs and can be replayed in the Studio.",
          "Branch comparisons expose total clearance, worst bottleneck, and accessible-route deltas without changing the Plan or Validation.",
        ),
      ],
    },
    {
      id: "queue-simulation",
      title: "Queue simulation",
      blocks: [
        prose(
          "The queue model supports registration, security, cloakroom, food, beverage, restroom, merchandise, and transport operations. Seeded runs model arrivals, service per server, parallel servers, abandonment patience, priority lanes, and spatial buffer capacity.",
        ),
        bullets(
          "Results include average, median, and p95 wait, maximum queue length, abandonment, overflow risk, and lane evidence.",
          "Spill evidence names exact nearby Route and Exit object IDs when p95 queue area exceeds the modeled buffer.",
          "A measurable server and buffer option is emitted only with deterministic spatial preflight and requires explicit human action.",
          "Previewing an option creates an ordinary violet ghost Change and immediately runs deterministic Validation; the Simulation Result never changes or approves the Plan.",
        ),
      ],
    },
    {
      id: "staffing-operations",
      title: "Staffing and operations",
      blocks: [
        prose(
          "A Staffing Plan versions role headcounts, skills, shifts, zone requirements, handoff policy, and maximum walking distance alongside the venue Plan. Staff Posts are typed spatial objects with stable IDs, coverage-zone links, and role assignments by shift.",
        ),
        bullets(
          "Coverage evidence evaluates entrances, exits, accessible routes, stages, and service areas by exact zone and post IDs.",
          "Walking-distance gaps, insufficient role headcount, and short shift handoffs remain explicit auditable results.",
          "Staff-only service routes are modeled separately from attendee circulation and never alter accessible-route Validation.",
          "The shared export command produces an RFC4180 staffing schedule and an SVG post map without mutating Plan truth.",
        ),
      ],
    },
    {
      id: "production-planning",
      title: "AV and production planning",
      blocks: [
        prose(
          "Production Readiness Evidence is deterministic Constraint evidence for the exact visible Plan or Proposal. It binds screens, projectors, speakers, cameras, control desks, Cable Routes, Utility Points, Rigging Points, backstage zones, and inventory instances by stable ID.",
        ),
        bullets(
          "Projector throw ratios use exact projector-to-screen geometry and viewable width.",
          "Seat-to-screen rays, speaker coverage cones, camera ranges, and control sightlines retain their sampled object and obstruction IDs.",
          "Every accessible Cable Crossing requires an allowed overhead or cable-ramp treatment.",
          "Circuit and Rigging Loads reconcile rated infrastructure against placed equipment demand; inventory shortages remain blocking production evidence.",
          "The shared export command produces a production CSV and production-only SVG map without changing accepted Plan truth.",
        ),
      ],
    },
    {
      id: "catering-planning",
      title: "Catering and service planning",
      blocks: [
        prose(
          "Service Capacity Evidence evaluates the exact visible Plan or Proposal across arrival, break, and meal phases. Typed Service Stations link throughput, queue buffers, accessible counter height, support spaces, water, Replenishment Routes, and inventory by stable ID.",
        ),
        bullets(
          "Queue Zones fail when they spill into public circulation or emergency exits.",
          "Service and support objects retain measured separation from production and emergency infrastructure.",
          "Controlled Replenishment Route crossings remain visible circulation impacts; uncontrolled crossings block Approval.",
          "Dietary Options and Allergen Labels describe stations only. Attendee health records are rejected at the geometry boundary.",
          "Branch comparison includes service capacity, queue risk, circulation crossings, and accessible Service Points.",
          "The shared export command produces Service Station and Replenishment Route schedules without changing accepted Plan truth.",
        ),
      ],
    },
    {
      id: "emergency-planning",
      title: "Emergency planning",
      blocks: [
        prose(
          "An Emergency Plan versions exits, assembly points, responder access lanes, fire-equipment coverage, first-aid posts, command posts, operating assumptions, and three required Degraded Scenarios alongside accepted Plan truth.",
        ),
        bullets(
          "Emergency readiness is a deterministic hard Constraint over exact geometry, capacities, infrastructure IDs, and power metadata.",
          "Blocked-exit and unavailable-corridor scenarios remove named graph inputs and retain affected zones, Alternative Emergency Routes, available exit capacity, shortfall, and unresolved hard failures.",
          "Power-loss scenarios remove named circuits and verify backup duration for emergency infrastructure.",
          "Any Proposal that changes emergency infrastructure requires a separate authorized Emergency Review bound to the Proposal, base version, Validation, evidence fingerprint, assumptions, reviewer identity, and role.",
          "The audit package retains every review and scenario fingerprint; the shared export command produces a one-page vector Emergency Plan.",
        ),
      ],
    },
    {
      id: "waivers",
      title: "Warning Waiver",
      blocks: [
        prose(
          "A warning never disappears from Validation evidence. Approval requires a human-authored Warning Waiver bound to its Constraint, Proposal base version, and Validation input fingerprint. Approval carries that disposition into the resulting Plan Version; changed Proposals require a new waiver.",
        ),
      ],
    },
    {
      id: "locks",
      title: "Object Lock",
      blocks: [
        prose(
          "A Lock protects one object property class: position, rotation, dimension, deletion, or role. Venue-template Locks are inherited with the accepted geometry; human Project Locks are temporary, reason-coded records outside the immutable Plan and can be explicitly released. Conflicts expose the Lock ID, type, source, object, and Change.",
        ),
      ],
    },
    {
      id: "evidence",
      title: "Route Graph and Spatial Evidence",
      blocks: [
        prose(
          "Validation derives route paths, clear widths, usable area, section capacity, phase loads, focal-point rays, viewing angles, and obstruction IDs from canonical geometry. Every result carries geometry and evidence fingerprints.",
        ),
      ],
    },
    {
      id: "ledger",
      title: "Approval and Activity Ledger",
      blocks: [
        prose(
          "Approval is the explicit human decision that commits a validated Proposal. Every human and agent action is appended to an ordered Activity Ledger.",
        ),
      ],
    },
  ],
} satisfies DocsPage;
