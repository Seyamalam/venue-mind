# ADR 0019: Deterministic Validation uses a versioned Constraint registry

## Status

Accepted

## Context

Venue operations combine simple thresholds with geometry-derived access, circulation, sightline, production, catering, and emergency evidence. Ad hoc checks would produce inconsistent ordering, units, remediation, cache keys, and Approval behavior.

## Decision

Every Constraint record names an evaluator from the published enum. `src/domain/constraint-engine.js` maps that name to one pure evaluator and publishes one Validation engine version. Evaluators consume the exact materialized Plan or Proposal, normalized Event Brief, policy inputs, inventory, and Locks. They return ordered evidence with stable IDs, affected object IDs, actual value, threshold, comparator, units, status, and remediation.

Validation caching requires both the canonical immutable input and its fingerprint. Simulation Results stay outside this registry and cannot satisfy or waive a Constraint.

## Consequences

- Unknown evaluators fail with `CONSTRAINT_EVALUATOR_UNSUPPORTED`.
- Relevant input changes invalidate cached Validation.
- Approval revalidates the exact candidate and blocks hard failures.
- New evaluators require pass, fail, not-applicable, fingerprint, ordering, and Approval tests.
