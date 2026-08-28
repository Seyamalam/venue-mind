# ADR 0011: Flow simulation uses aggregate cohorts and stable spatial evidence

- Status: Accepted
- Date: 2026-08-27

## Context

Ingress and egress forecasting needs arrival and departure timing, mobility variation, vertical circulation, route capacity, and time-based density. Person-level attendee records would add privacy risk without improving venue-layout decisions. Simulation output must also remain distinct from deterministic Constraint Validation and must be comparable across Proposal Branches.

## Decision

VenueMind models ingress and egress as a versioned `ingress-egress` Scenario model inside the existing Simulation Run boundary.

Every normalized Scenario contains:

- Monotonic cumulative arrival and departure Flow Curves.
- Aggregate Mobility Profiles identified by stable cohort ID, population share, relative speed factor, and accessible-route requirement.
- Explicit normal and emergency assumptions, including response delay, flow factor, and elevator availability.
- A deterministic seed, engine version, sample count, horizon, and immutable Scenario fingerprint.

The engine derives entrances, exits, checkpoints, Doors, stairs, elevators, Corridors, Aisles, accessible routes, occupied Sections, and paths from the exact materialized Plan or Proposal Branch geometry. Results bind every zone, bottleneck, and Density Frame cell to stable object IDs and include the infrastructure and geometry fingerprints.

Mobility Profiles cannot contain person IDs, names, contact data, medical conditions, or event-level location traces. Density Frames contain only aggregate occupancy and persons-per-square-metre estimates for canonical zones and routes.

Normal and emergency assumptions are evaluated together in one result. The selected mode determines the primary summary, while both assumption results and their deltas remain available for audit. Elevators default to unavailable during emergency assumptions.

Simulation Comparisons require an exact Scenario definition fingerprint and engine version match. Branch geometry may differ; Scenario parameters may not.

## Consequences

- The Studio can compare total clearance, bottleneck duration, affected occupancy, and accessible-route performance across branches.
- Density overlays are replayable from exported Simulation Results and do not represent tracked people.
- Changing a curve, cohort, assumption, seed, or sample count creates a new immutable input fingerprint and invalidates cache compatibility.
- Simulation can inform a Proposal but cannot pass, fail, waive, or replace deterministic Validation.
- New infrastructure types can join the simulation adapter without changing the accepted Plan mutation boundary.

## Non-goals

- Individual attendee tracking or evacuation instructions.
- Real-time life-safety certification.
- Replacing jurisdictional egress calculations or professional review.
- Automatically changing a Plan from a Simulation Result.
