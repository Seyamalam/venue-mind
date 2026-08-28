# ADR 0014: Production evidence is deterministic Validation

Status: accepted

## Context

Production readiness depends on exact Plan geometry, rated power and rigging infrastructure, explicit cable treatments, and pinned inventory availability. Treating those checks as Simulation would make identical Plan inputs appear probabilistic and weaken the Approval gate.

## Decision

Projector throw, screen visibility, speaker coverage, camera and control sightlines, cable crossings, circuit loads, rigging loads, and production inventory reconciliation are deterministic Constraint evidence. They run against the exact visible Plan or Proposal and block Approval when they fail. Simulation remains reserved for uncertain time-based operations.

## Consequences

- Every production result retains the stable equipment, target, route, circuit, rigging, and inventory IDs that produced it.
- Proposal validation exposes production failures before accepted Plan truth can change.
- Production CSV and SVG exports can be regenerated from the accepted Plan without hidden state.
