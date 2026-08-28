# ADR 0009: Floor-plan files are assisted references, not authoritative geometry

- Status: Accepted
- Date: 2026-08-27

## Context

Venue operators often receive drawings as DXF or PDF. These formats can contain incomplete units, arbitrary layer names, flattened vectors, raster scans, OCR errors, unsupported entities, and stale annotations. Treating their contents as accepted VenueMind geometry would bypass stable IDs, typed Footprints, canonical metres, Constraints, Proposal review, and human Approval.

## Decision

VenueMind's versioned JSON interchange remains the only authoritative import path. DXF and PDF enter through a separate `FloorPlanReferenceAdapter` boundary and can only produce an assisted trace candidate.

Every adapter result must contain:

- Adapter ID and version.
- Source file fingerprint, media type, byte size, and selected page or model space.
- Declared or calibrated source units and the conversion to metres.
- Candidate Room Boundary, holes, reference lines, labels, and source entity references.
- A confidence value and warnings for every inferred element.
- Unsupported or ignored entities.
- A transform from source coordinates into the VenueMind southwest-origin spatial frame.
- `authority: reference-only` and `requiresHumanCalibration: true`.

An adapter cannot call planner mutations. After calibration and operator review, a separate translator may create ordinary Proposal Changes through the shared command bus. Validation and human Approval remain mandatory before any geometry becomes an accepted Plan Version.

## DXF adapter boundary

The future DXF adapter may read model-space `LINE`, `LWPOLYLINE`, `POLYLINE`, `ARC`, `CIRCLE`, `INSERT`, `TEXT`, and `MTEXT` entities. Paper space, proxy objects, external references, 3D solids, splines, hatches, and blocks with unsupported transforms must be reported, not silently flattened. Unitless drawings require a two-point calibration before translation.

Layer mapping is explicit and reviewable. Source handles remain provenance only; VenueMind assigns new stable object IDs when reviewed traces become Proposal Changes.

## PDF tracing boundary

The future PDF adapter accepts one selected page at a time. Vector extraction and raster tracing are both reference workflows. The operator must set two known points and a real-world distance, confirm orientation, and select or draw the Room Boundary. OCR labels are annotations and never determine object type without review.

Encrypted files, embedded scripts, attachments, and remote references are rejected. Extraction is sandboxed with byte, page, pixel, path, and processing-time limits.

## Consequences

- Imported references cannot overwrite a Project or accepted Plan.
- Scale and orientation uncertainty are visible instead of hidden.
- Trace results are reproducible from a source fingerprint and adapter version.
- DXF/PDF support can evolve independently of the canonical VenueMind JSON schema.
- The first supported workflow will be calibration plus boundary/reference-line tracing, not automatic floor-plan acceptance.

## Non-goals

- CAD round-tripping.
- Building-information-model ingestion.
- Automatic code compliance from drawing labels.
- Treating OCR or raster contours as authoritative measurements.
