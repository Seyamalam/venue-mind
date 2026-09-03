---
name: venuemind-crowd-flow
description: Run repeatable VenueMind crowd-flow scenarios and compare congestion evidence. Use for ingress, interval, egress, emergency phases, queues, bottlenecks, and circulation strategies.
metadata:
  version: 1.1.0
  tool-contract-version: 1.6.0
---

# VenueMind Crowd Flow

Keep simulation findings separate from deterministic layout Validation.

## Workflow

1. Call `venue.get_project_brief`, `venue.inspect_layout`, `venue.list_constraints`, `venue.list_scenarios`, and `venue.list_scenario_runs`.
2. Use `venue.search_objects` and `venue.get_object` to resolve entrances, exits, aisles, doors, queues, checkpoints, service lanes, and occupied zones. Retain Locks and stable IDs.
3. For a new run, call `venue.run_scenario` with an explicit seed, horizon, sample count, phase inputs, active Plan or Branch fingerprint, and a unique `idempotencyKey`.
4. Call `venue.get_scenario_result`. Cite the run ID, input fingerprint, geometry fingerprint, density frames used, bottleneck IDs, queue percentiles, evacuation times, and uncertainty.
5. Compare only compatible runs with `venue.compare_simulations`. Do not compare runs whose geometry or scenario inputs differ without naming those differences.
6. Call `venue.validate_layout` and `venue.get_validation_evidence` for the corresponding deterministic circulation and egress checks.
7. If the user requests a layout response, call `venue.create_proposal_branch`, then `venue.preview_revision` or `venue.request_adjustment`; rerun both Validation and simulation.
8. Return reproducible inputs, stable IDs, deltas, failed checks, and the human-review next action.

Do not present simulation as a guarantee, emergency certification, or accepted Plan change. Stop before acceptance, waivers, or Lock changes.

Read [generated contracts](references/contracts.md).
