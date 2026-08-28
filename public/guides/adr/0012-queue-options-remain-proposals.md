# ADR 0012: Queue capacity options remain non-destructive Proposals

- Status: Accepted
- Date: 2026-08-27

## Context

Queue simulation can identify service-rate and buffer shortfalls, but automatically changing stations or queue geometry would violate VenueMind's Proposal and human Approval boundaries. A queue option also needs spatial evidence: added capacity is not useful when its buffer blocks circulation, an accessible route, or an Exit approach.

## Decision

VenueMind models registration, security, cloakroom, food, beverage, restroom, merchandise, and transport queues through the versioned `queue` Scenario model.

Each Queue Scenario includes arrival rate, service rate per server, parallel servers, abandonment patience, optional priority lanes, person-area allowance, and a stable queue or service-object reference. Results include average, median, and p95 wait; p95 maximum queue length; abandonment; buffer demand; overflow risk; lane evidence; and stable Route and Exit IDs at risk of spill.

The simulation may emit one Queue Proposal Option containing:

- A measurable server-count change.
- A canonical queue-buffer object with a stable ID and metre-based Footprint.
- Expected p95 wait and required buffer area.
- Deterministic spatial preflight over the exact Plan or Proposal Branch geometry.
- `requiresHumanAction: true`.

The engine never applies the option. A human or agent must preview its ordinary `add_object` Change through the shared command interface. VenueMind immediately runs normal deterministic Validation over the resulting Proposal. Human Approval remains required to create a Plan Version.

Simulation comparisons require matching Scenario definition and engine fingerprints. A service-rate change is therefore a new Scenario input, not a geometry-only Branch comparison.

## Consequences

- Operational capacity suggestions remain inspectable, undoable violet ghost Changes.
- Queue spill evidence identifies exact circulation and Exit objects without claiming a deterministic safety failure.
- A spatially invalid buffer option is marked blocked and cannot be previewed from the Studio shortcut.
- Agents can reproduce the same workflow with `venue.run_scenario`, `venue.list_scenario_runs`, `venue.apply_edit`, and `venue.validate_layout`.

## Non-goals

- Automatic purchasing, staffing, or Plan mutation.
- Person-level queue tracking.
- Treating wait estimates as deterministic Constraints.
- Approving a Queue Proposal Option from WebMCP or MCP.
