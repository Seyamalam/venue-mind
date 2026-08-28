# ADR 0015: Service capacity is Plan evidence

Status: accepted

## Context

Service throughput, queue buffers, counter access, separation, and replenishment crossings use explicit Plan geometry and phase assumptions. They must block a visibly unsafe Proposal without being confused with the probabilistic queue Simulation engine.

## Decision

VenueMind evaluates catering service capacity as deterministic Constraint evidence for the exact Plan or Proposal. Each phase fixes duration and demand ratio; each Service Station fixes servers, service rate, demand share, and queue capacity. Replenishment crossings and separation checks use stable geometry IDs. Probabilistic attendee queue behavior remains a separate Scenario.

## Consequences

- Approval sees reproducible catering failures before accepted Plan truth changes.
- Branches compare the same four service metrics from normalized inputs.
- Dietary and allergen metadata remains station-level operational data; attendee health records are rejected.
