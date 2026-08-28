# ADR 0013: Staff-only routes stay outside the attendee graph

Status: accepted

## Context

Venue operations need dedicated service circulation, but a disconnected staff-only edge must not make the attendee accessibility graph appear disconnected or change public egress capacity.

## Decision

Routes with `route.staffOnly: true` remain typed Plan objects and enter Staffing Operations evidence. The deterministic attendee circulation and accessibility graph excludes those edges. Staff Posts reference exact coverage zones and shifts, while walking-distance and handoff checks are evaluated by the Staffing Operations analyzer.

## Consequences

- Staff-only routes remain visible, exportable, and auditable by stable object ID.
- Attendee accessibility, egress, and circulation results are unchanged by a disconnected service-only edge.
- A route intended for both groups must remain in the attendee graph and satisfy its normal Constraints.
