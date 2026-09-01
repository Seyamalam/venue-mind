# Venue Planning

VenueMind models human-supervised spatial planning for live events. Its language distinguishes accepted plans from agent-authored previews so automation can remain powerful without becoming ambiguous or unsafe.

## Language

**Project**:
The Organization-owned durable container for one event's accepted Plan, Proposal branches, Constraints, and Activity Ledger.
_Avoid_: File, document

**User**:
A person identified by an external Identity Provider and represented by one VenueMind account across Organizations.
_Avoid_: Member, session, actor

**Organization**:
The tenant boundary that owns Projects, Memberships, Invitations, and organization-scoped audit evidence.
_Avoid_: Account, workspace, Project group

**Organization Membership**:
The durable relationship assigning one User one or more Human Roles inside one Organization.
_Avoid_: User, Agent Grant, session

**Organization Invitation**:
A time-limited invitation for one normalized email address to join one Organization with an initial Human Role; acceptance creates a Membership exactly once.
_Avoid_: Membership, share link

**User Session**:
A server-side, expiring and revocable authorization session bound to one authenticated User and Identity Provider subject.
_Avoid_: browser tab, Agent Grant, login cookie

**Project Ownership**:
The immutable Organization association on a Project. Moving a Project between Organizations is a separate audited administrative operation, never an ordinary metadata edit.
_Avoid_: creator, currently open Organization

**Project Record Revision**:
A server-assigned positive integer identifying one complete authoritative Project record state. Conditional writes advance it exactly once; a client never chooses the next value.
_Avoid_: Plan Version, Proposal revision, save count

**Event Day Runbook**:
A separate operational aggregate whose immutable baseline is bound to one accepted Plan Version, Validation fingerprint, and Activity Ledger head. It contains stable phases, tasks, transitions, receipts, handoffs, and its own anchored ledger.
_Avoid_: Project snapshot field, checklist, Proposal, schedule document

**Runbook Version**:
One immutable Event Day Runbook definition and accepted baseline. A newer accepted Plan creates a new Runbook Version rather than retargeting an active one.
_Avoid_: Project Record Revision, mutable task state, Plan Version

**Runbook Task Revision**:
A server-advanced counter for one task projection used to reject stale event-day transitions without conflicting with other tasks.
_Avoid_: Runbook Version, Project Record Revision, client sequence

**Runbook Transition**:
An append-only, retry-safe status change for one stable Runbook task, ordered by server sequence and bound to a command receipt.
_Avoid_: Activity Ledger entry, narrative update, last-write-wins save

**Runbook Handoff**:
A deterministic structured projection of pending, active, blocked, overdue, evidence-gap, and completed task IDs at one Runbook ledger sequence.
_Avoid_: editable summary, chat message, accepted Plan change

**Synchronization Conflict**:
A structured stale-write result containing base, local, and current remote Project records plus their changed and overlapping fields.
_Avoid_: offline error, validation conflict, last-write-wins

**Recovery Branch**:
An auditable Proposal Branch created from locally preserved unsynchronized planning work after a Project Record Revision conflict. It remains subject to normal conflict detection, rebase, Validation, and human Approval.
_Avoid_: automatic merge, accepted Plan, backup

**Collaboration Event**:
An Organization- and Project-scoped durable notification that references one Project Record Revision and forms a per-Project cursor chain.
_Avoid_: Activity Ledger entry, browser event, chat message

**Collaboration Cursor**:
The durable last-seen Collaboration Event ID used to resume a Project stream and detect a missing link.
_Avoid_: Project Record Revision, ledger sequence, page offset

**Presence Lease**:
A short-lived Project session record containing User identity, observed Plan Version, focused object, and an optional useful viewport. It expires unless renewed.
_Avoid_: Organization Membership, User Session, permanent activity history

**Share Link**:
A time-limited, revocable bearer capability that exposes one bounded public view of a Project without Organization membership. Its raw token is returned once and only its hash is stored. Pending lifecycle states fail closed until their Activity Ledger transition is reconciled.
_Avoid_: invitation, User Session, public Project

**Reviewer Share Link**:
A Share Link scoped to one retained Proposal revision, allowing an external reviewer to inspect the pinned candidate and its accepted Plan baseline without receiving Project-wide access.
_Avoid_: reviewer Membership, Approval link, editable Proposal

**Notification**:
A User- and Organization-scoped signal for one supported review event, represented by a fixed body code and allowlisted stable references rather than event narrative or geometry.
_Avoid_: Collaboration Event, Activity Ledger entry, email body

**Notification Preference**:
One User's selection of enabled notification channels and supported event types, applied when VenueMind creates the delivery records, including in-app visibility.
_Avoid_: Organization policy, alert rule, marketing consent

**Account Export**:
A portable record of one User's profile, Memberships, authored audit events, and owned personal settings; Organization-owned Project data is included only when separately authorized.
_Avoid_: Project export, database backup

**Account Deletion Request**:
A user-initiated lifecycle that revokes Sessions, removes personal profile data where permitted, and preserves legally or operationally required Organization audit evidence under a deleted-user pseudonym.
_Avoid_: Project deletion, immediate row removal

**Human Role**:
A named bundle of VenueMind permissions assigned through an Organization Membership: viewer, planner, reviewer, approver, venue administrator, or organization administrator.
_Avoid_: Agent scope, actor label

**Agent Grant**:
A short-lived capability binding one agent identity to explicit scopes and one Project; it never carries human Approval, waiver, conflict-resolution, or Lock authority.
_Avoid_: API key, Human Role, permanent token

**Policy Decision**:
An allow or deny result for one principal, permission, Project, and point in time, identified for audit without retaining protected request data.
_Avoid_: UI visibility, tool error

**Approval Policy**:
The human-role requirement that must be satisfied in addition to deterministic Validation before a Proposal can create a Plan Version.
_Avoid_: Validation rule, agent permission

**Project Duplicate**:
A new Project lineage rooted in another Project's accepted Plan, with new Project-scoped IDs and immutable source provenance.
_Avoid_: Copy-paste, cloned history

**Venue Template**:
A versioned reusable definition of a physical site and the Room Templates it owns.
_Avoid_: Venue preset, master Project

**Room Template**:
A versioned reusable definition of one room's architectural boundary, fixed infrastructure, and protected zones.
_Avoid_: Floor-plan copy, room Project

**Inventory Item Template**:
A reusable specification for a class of placeable operational objects, including physical, power, capacity, cost, and availability metadata. An external inventory record is not an Inventory Item Template unless a template-specific import explicitly creates one.
_Avoid_: Asset instance, external inventory record, furniture preset

**Template Binding**:
A pinned reference from a Project or Project Object Instance to one exact template ID and version.
_Avoid_: Live link, copied template ID

**Project Object Instance**:
A Project-scoped venue object with its own stable ID, optionally derived from a template object through a Template Binding. A placement imported into one Project becomes a Project Object Instance, never the external record or its ID.
_Avoid_: Template object, external inventory record, clone

**Project Override**:
An explicit field-level divergence on a Project Object Instance that a template update must preserve.
_Avoid_: Local edit, detached copy

**Template Update Proposal**:
A reviewable Proposal containing the safe, non-overridden differences between a Project's pinned Room Template version and a newer version.
_Avoid_: Template sync, automatic update

**Inventory Availability Warning**:
A deterministic notice that Project demand for an Inventory Item Template exceeds its available count.
_Avoid_: Stock error, estimate

**Operational Resource Snapshot**:
A checksum-bound, source-versioned read model of live inventory, AV, power, catering, and staffing supply for one exact Project, Plan Version, Plan fingerprint, and event window. It is evidence, never accepted Plan truth.
_Avoid_: Inventory Template update, accepted allocation, provider cache

**Resource Binding**:
A versioned Project Object Instance reference to one VenueMind stable Resource ID, resource kind, and quantity. Provider resource IDs never become Resource IDs.
_Avoid_: Template Binding, external asset ID, booking

**Operational Resource Conflict**:
Deterministic evidence that an accepted Resource Binding is unavailable, double-booked, insufficient, or incompatible for the trusted event window.
_Avoid_: Proposal Conflict, Validation warning, provider error

**Resource Substitution Option**:
A non-applied compatible Resource Binding candidate tied to one exact Operational Resource Snapshot and Conflict. It becomes a Proposal only after an explicit preview request.
_Avoid_: Automatic replacement, accepted Resource Binding

**Staff Reference**:
An Organization- or Project-scoped opaque reference resolved by trusted server context for the minimum necessary assignment workflow. Raw provider person IDs and contact data do not cross the adapter normalization boundary.
_Avoid_: User ID, staff name, email, provider person ID

**Recovery Window**:
The seven-day period after typed-confirmation deletion during which a Project remains restorable with its full snapshot and Plan history.
_Avoid_: Trash file, undo toast

**Interchange Package**:
A versioned, checksummed representation of one complete Project used for portable import and export.
_Avoid_: Project file, raw snapshot

**Import Preview**:
A read-only integrity, migration, and conflict assessment of an Interchange Package before any Project is created.
_Avoid_: Imported Project, upload result

**Import Commit**:
The explicit human action that creates a missing Project from a passing Import Preview; it never overwrites an existing Project.
_Avoid_: Restore, replace

**Adapter Staging Batch**:
A checksum-bound set of externally sourced Changes for exactly one accepted Plan Version, represented as a normal Proposal awaiting human review.
_Avoid_: Imported Plan, automatic sync, adapter draft

**External ID Mapping**:
Auditable correspondence between one source-system entity ID and one distinct VenueMind stable ID, with source version and synchronization evidence.
_Avoid_: Shared ID, alias, copied external ID

**Registration Snapshot**:
A checksum-bound aggregate view of Ticket Classes, forecasts, zone allocations, accessibility requirements, and optional event-day Check-in Aggregates for one exact Project and Plan Version. It contains no person-level registration record.
_Avoid_: Attendee list, registration database, ticket export

**Ticket Class Forecast**:
The aggregate ticketed count and expected attendance for one source-namespaced Ticket Class, allocated exactly across Project Occupancy Zones.
_Avoid_: Attendee forecast, ticket holder cohort, guest list

**Aggregate Accessibility Requirement**:
A broad access requirement code, count, and set of Occupancy Zone IDs with no identity, diagnosis, free-form note, or person-level health data.
_Avoid_: Attendee accommodation, disability record, accessibility note

**Check-in Aggregate**:
An event-day count by source-namespaced Ticket Class at one timestamp. It contains no scan, barcode, order, payment, device, or attendee identity record.
_Avoid_: Check-in event, attendee timeline, scan log

**Live Occupancy Monitor**:
A Runbook-bound operational aggregate that reconciles aggregate Check-in and Occupancy Signals against the frozen Plan, event target, and simulation assumptions.
_Avoid_: attendee tracker, live Plan, analytics dashboard

**Occupancy Signal**:
A source-versioned aggregate count for the event check-in total, whole venue, or one stable Occupancy Zone at one observed instant, with bounded confidence and no person-level record.
_Avoid_: attendee location, scan event, sensor payload

**Occupancy Alert**:
A typed, deterministic stale-source, conflicting-feed, warning-threshold, or exceeded-capacity state for one Live Occupancy scope.
_Avoid_: notification, free-form incident, Constraint failure

**Occupancy Incident Ledger**:
The append-only hash-chained record of accepted Occupancy Signals and Occupancy Alert openings and resolutions for one Live Occupancy Monitor.
_Avoid_: Activity Ledger, Runbook Ledger, mutable alert history

**Ticket Occupancy Reconciliation**:
Deterministic evidence comparing Ticket Class totals and zone allocations with the Project attendee target and Occupancy Zone limits.
_Avoid_: Capacity Validation, attendee manifest, admission approval

**Calendar Event Snapshot**:
A sanitized, checksum-bound external event record retained as adapter evidence; descriptive title, location, and organizer labels are not planning truth.
_Avoid_: Event Brief, calendar Project, spatial Change

**Planning Effect Binding**:
The Project-owned allocation that authorizes one adapter planning operation to target one stable Requirement and its exact Constraint set.
_Avoid_: Caller-provided Requirement ID, adapter hint

**Webhook Delivery Record**:
The durable checksum-bound receipt for one adapter version, source system, and external event ID; concurrent or restarted delivery resolves against this same identity.
_Avoid_: Process cache, event-ID-only deduplication

**Event Brief**:
The structured Project intent and operating requirements that every Proposal must address.
_Avoid_: Notes, prompt

**Requirement**:
A stable prioritized planning need with an owner, status, evidence references, and optional Constraint links.
_Avoid_: Bullet, request

**Plan**:
The accepted spatial arrangement for one event in one venue room, identified by a stable ID and version.
_Avoid_: Layout, canvas state

**Plan Version**:
An immutable accepted revision of a Plan. Approval creates the next Plan Version.
_Avoid_: Save, edit version

**Room Boundary**:
The accepted two-dimensional enclosure of a venue room, including any internal voids that cannot contain venue objects.
_Avoid_: Canvas bounds, page size

**Footprint**:
The real-world floor area occupied by one venue object within a Room Boundary.
_Avoid_: Bounding box, screen shape

**Door**:
A line Footprint representing a physical opening, with clear width, swing, and accessibility metadata.
_Avoid_: Entrance marker, opening icon

**Exit**:
A line Footprint representing an egress opening, with clear width, emergency role, and rated person capacity.
_Avoid_: Exit label, destination point

**Corridor**:
A bidirectional or one-way traversable Route Graph segment intended for primary circulation.
_Avoid_: Generic route

**Aisle**:
A traversable Route Graph segment serving seating, queues, or work positions.
_Avoid_: Gap, walkway drawing

**Service Lane**:
A traversable Route Graph segment reserved for production, catering, logistics, or staff movement.
_Avoid_: Back route, service path

**Restricted Zone**:
A bounded Footprint whose access rule and reason code limit entry or object placement.
_Avoid_: Red area, blocked box

**Route Graph**:
The connected network of traversable route, aisle, corridor, and service-lane geometry used for access and circulation evidence.
_Avoid_: Drawn path, route overlay

**Exit Approach Zone**:
The room-side clear area derived from an Exit Footprint that must remain unobstructed for egress.
_Avoid_: Exit label area, arbitrary buffer

**Critical Route Edge**:
A traversable edge whose loss disconnects one or more occupied Seating Sections from every valid Exit.
_Avoid_: Busy aisle, important line

**Bottleneck Load**:
Deterministic demand, rated demand, and load index for a route, aisle intersection, Exit, queue, or checkpoint.
_Avoid_: Crowd warning, congestion guess

**Focal Point**:
A stable viewing target on a stage, screen, speaker, exhibit, or demonstration used to calculate sightline evidence.
_Avoid_: Visual target, canvas point

**Accessible Seat Sample**:
A stable representative viewing position designated for accessible-seating sightline evidence within a Seating Section.
_Avoid_: Wheelchair ray, accessible seat count

**Door Clearance Zone**:
The maneuvering area adjoining an accessible Door that must remain free of placement obstructions.
_Avoid_: Door buffer, empty box

**Temporary Ramp**:
A removable accessible route element defined by rise, run, clear width, landing, edge protection, and handrail metadata.
_Avoid_: Incline, sloped route

**Occupancy Zone**:
A stable grouping of Seating Sections with its own minimum target and maximum allowed capacity, validated independently from each Section and the full Plan.
_Avoid_: Seating total, room area

**Capacity Delta**:
The deterministic attendee-capacity difference attributable to one Proposal Change relative to the accepted Plan baseline.
_Avoid_: Impact estimate, capacity guess

**Spatial Evidence**:
Deterministic measurements, paths, rays, object IDs, and fingerprints derived from canonical Plan or Proposal geometry during Validation.
_Avoid_: Summary metric, agent explanation

**Proposal**:
A non-destructive candidate revision based on exactly one Plan Version and awaiting human disposition.
_Avoid_: Draft plan, agent edit

**Proposal Branch**:
A named alternative Proposal lineage based on one Plan Version, used to preserve and compare competing planning strategies.
_Avoid_: Copy, scenario file

**Change**:
One stable, inspectable planning difference contained in a Proposal, expressed through typed Spatial Effects or Planning Effects.
_Avoid_: Adapter record, direct mutation

**Planning Effect**:
An executable, typed Event Brief or Requirement transition carried by a Change and applied only through human Proposal Approval.
_Avoid_: Metadata patch, free-form effect, calendar update
_Avoid_: Mutation, tweak

**Proposal Conflict**:
A typed incompatibility between a Proposal Change and the current Plan, geometry, Locks, dependencies, or Constraint evidence, with explicitly allowed resolution outcomes.
_Avoid_: Error message, merge issue

**Manual Resolution**:
A human-authored replacement Change created for one Proposal Conflict. It receives a new stable Change ID and retains lineage to every transformed Change.
_Avoid_: Force apply, conflict override

**Constraint**:
A measurable condition a Plan or Proposal must satisfy, including accessibility, capacity, circulation, and protected-object rules.
_Avoid_: Preference, prompt

**Lock**:
A typed protection over an object's position, rotation, dimensions, deletion, or operational role, with an explicit venue-template or Project source.
_Avoid_: Locked flag, protected boolean

**Locked Object**:
A venue object governed by one or more active Locks; unlocked properties may still change when its Locks are partial.
_Avoid_: Fixed item, protected element

**Validation**:
A deterministic evaluation of a Plan or Proposal against its Constraints, cached only when its immutable canonical input and fingerprint match exactly.
_Avoid_: Agent opinion, review

**Scenario**:
An immutable set of simulation assumptions, phases, time horizon, and deterministic seed evaluated against one exact Plan or Proposal geometry fingerprint.
_Avoid_: Proposal Branch, test run, forecast settings

**Simulation Run**:
A versioned probabilistic evaluation of one Scenario against one exact geometry input, with progress, confidence metadata, and a terminal completed, cancelled, or failed status.
_Avoid_: Validation, prediction, scenario

**Partial Simulation Result**:
An explicitly incomplete checkpoint emitted while a Simulation Run is active; it never replaces a completed result or becomes Constraint evidence.
_Avoid_: Live Validation, draft result

**Simulation Comparison**:
A normalized comparison of completed Simulation Runs whose Scenario definitions and engine versions are compatible.
_Avoid_: Proposal comparison, metric diff

**Flow Curve**:
A monotonic, cumulative share of Scenario population over time used to model arrivals or departures without storing individual attendee records.
_Avoid_: Person timeline, event log

**Mobility Profile**:
An aggregate Scenario cohort with a population share, relative travel-speed factor, and accessible-route requirement; it never contains person-level identity or health data.
_Avoid_: Attendee profile, disability record

**Clearance Result**:
A probabilistic estimate of time required to move an Occupancy Zone or full venue population through an exact versioned infrastructure and Route Graph input.
_Avoid_: Egress Validation, safety pass

**Density Frame**:
A time-keyed set of aggregate zone and route occupancy densities bound to stable Plan object IDs for Studio overlay rendering.
_Avoid_: Crowd tracking, attendee locations

**Simulation Bottleneck**:
A probabilistic duration, affected occupancy, and flow-capacity estimate for one stable entrance, exit, checkpoint, Door, stair, elevator, Corridor, Aisle, or Route object.
_Avoid_: Bottleneck Load, Constraint failure

**Queue Scenario**:
A seeded simulation definition for one operational queue category, including arrivals, per-server service, parallel servers, abandonment, priority lanes, and spatial buffer assumptions.
_Avoid_: Queue object, waiting list

**Queue Spill Evidence**:
The stable Route and Exit object IDs potentially affected when a simulated maximum queue exceeds its modeled buffer area.
_Avoid_: Congestion Validation, crowd alert

**Queue Proposal Option**:
A non-applied, measurable capacity and buffer Change produced by a Queue Scenario with deterministic spatial preflight; it becomes a Proposal only after an explicit human or agent preview command.

**Staffing Plan**:
A versioned operational record attached to a Plan that defines stable Staff Roles, headcount, skills, Shifts, Coverage Requirements, handoff policy, and maximum walking distance.

**Staff Post**:
A typed spatial Plan object with a stable ID, exact Coverage Zone links, and role-count assignments by Shift. A Staff Post never replaces deterministic circulation or accessibility evidence.

**Coverage Result**:
Deterministic evidence for one Coverage Requirement and Shift, including required and assigned counts, reachable Staff Post IDs, walking distance, and covered or gap status.
_Avoid_: Staffing guess, roster note

**Production Plan**:
The versioned spatial and operational definition of event-production equipment, targets, cable paths, circuits, rigging assignments, backstage zones, and inventory demand.
_Avoid_: AV list, tech rider

**Production Readiness Evidence**:
Deterministic throw, visibility, sound coverage, camera, control sightline, cable crossing, circuit, rigging, and inventory results for one exact Plan or Proposal.
_Avoid_: AV simulation, production approval

**Cable Crossing**:
The intersection of a Cable Route with an accessible circulation object, identified by both stable object IDs and an explicit protective treatment.
_Avoid_: Cable warning, floor cable

**Circuit Load**:
The reconciled equipment demand and rated capacity of one power Circuit referenced by a Utility Point.
_Avoid_: Estimated power, outlet count

**Rigging Load**:
The reconciled suspended equipment weight and safe working load of one Rigging Point.
_Avoid_: Hanging weight, rig estimate

**Catering Plan**:
The versioned service-station, support-space, queue, replenishment, separation, and phase-capacity definition attached to a Plan.
_Avoid_: Food plan, catering note

**Service Station**:
A typed bar, buffet, or counter object with stable queue, capacity, access, replenishment, water, dietary-option, and allergen-label metadata.
_Avoid_: Food table, concession point

**Replenishment Route**:
A staff-only service route from one support source to one or more Service Stations, including exact public-route crossings and their control.
_Avoid_: Restock path, back route

**Service Capacity Evidence**:
Deterministic per-phase demand, throughput, utilization, peak-queue, accessible-service, and circulation evidence for the exact Plan or Proposal.
_Avoid_: Catering simulation, service guess

**Emergency Plan**:
The versioned exits, assembly points, responder access, fire equipment, first-aid posts, command posts, assumptions, and degraded-scenario definitions attached to a Plan.
_Avoid_: Evacuation note, safety overlay

**Degraded Scenario**:
A deterministic emergency availability test that removes named exits, route objects, or power circuits from one exact Plan and reports affected zones, alternatives, capacity impact, and hard failures.
_Avoid_: Emergency Simulation Run, hypothetical warning

**Alternative Emergency Route**:
The exact ordered set of stable Route object IDs connecting an affected Occupancy Zone to an available Exit under a Degraded Scenario.
_Avoid_: Suggested path, agent route

**Emergency Review**:
An explicit authorized human disposition bound to one emergency-affecting Proposal, base Plan Version, Validation fingerprint, evidence fingerprint, assumptions, reviewer identity, role, and time.
_Avoid_: Approval checkbox, safety waiver

**Warning Waiver**:
An explicit human disposition of one waivable warning for one exact Proposal and Validation input, identified by author, reason code, and timestamp. Approval carries it into the resulting immutable Plan Version.
_Avoid_: Ignore, dismiss, override

**Approval**:
The explicit human decision that commits a validated Proposal as a new Plan Version.
_Avoid_: Apply, accept automatically

**Adjustment Request**:
A human instruction that revises the active Proposal without changing the accepted Plan Version.
_Avoid_: Chat message, feedback

**Activity Ledger**:
The ordered record of human and agent actions associated with a Plan.
_Avoid_: Chat history, logs
