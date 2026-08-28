# ADR 0003: Use metres in one canonical spatial frame

## Status

Accepted

## Context

Venue sources use pixels, paper coordinates, CAD units, and different origins or rotation conventions. Mixing those frames would make geometry fingerprints, Validation, Proposal comparison, and exports non-reproducible.

## Decision

VenueMind stores every Room Boundary and Footprint in metres. The room origin is southwest, x increases east, y increases north, and positive rotation is clockwise. Serialization normalizes distance to millimetre precision and rotation to a tenth of a degree.

UI display units and import adapters convert at their seam. Source transforms and fingerprints remain provenance; accepted Plan geometry uses only the canonical frame.

## Consequences

- Deterministic geometry and evidence fingerprints are portable across clients.
- Pixels, paper size, and source-file coordinates cannot leak into accepted truth.
- Unitless DXF or PDF references require human calibration before they can seed Proposal Changes.
- Every geometry test can compare normalized numeric output directly.
