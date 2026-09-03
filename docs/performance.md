# Performance targets

VenueMind measures performance against deterministic, locally generated Projects. The fixtures contain stable geometry, IDs, Constraints, Branches, Comments, and a hash-sealed Activity Ledger. They do not use network services or generated files.

| Target | Objects | Constraints | Ledger | Comments | Branches |
| --- | ---: | ---: | ---: | ---: | ---: |
| Small | 100 | 20 | 250 | 100 | 5 |
| Medium | 500 | 50 | 1,000 | 250 | 15 |
| Large | 1,000 | 100 | 2,000 | 400 | 30 |

The large fixture remains below the product's payload, collection, and JSON-node limits. It represents the supported interactive target, not a way to bypass those limits.

## Local regression budgets

Budgets are median wall-clock time across three isolated operation runs on the local development machine. Setup is excluded. Load includes strict Snapshot decoding, normalization, and recovery publication. Validation is a cold engine run. Approval follows the real workflow and may reuse the exact Validation input already observed by the planner.

| Operation | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Inspection | 75 ms | 120 ms | 300 ms |
| Preview | 40 ms | 100 ms | 250 ms |
| Validation | 250 ms | 800 ms | 2,000 ms |
| Branch switch | 60 ms | 180 ms | 500 ms |
| Approval | 350 ms | 1,100 ms | 2,800 ms |
| Replay | 80 ms | 300 ms | 1,000 ms |
| Load | 180 ms | 650 ms | 1,800 ms |
| Export | 350 ms | 1,200 ms | 3,000 ms |

Run `npm run benchmark:performance` for the large target. Run `npm run check:performance` as the local regression gate. A different target can be selected with `node scripts/benchmark-performance.mjs --target=small`. This project intentionally has no GitHub Actions runner.

Scenario engines keep their existing deterministic seeded benchmark suites and enforce the 15-second product runtime limit. Scenario execution is asynchronous, so it does not block Studio editing.

## Correctness boundaries

The uniform-grid spatial index is an exact broad phase: it returns all bounding-box candidates in stable object-ID order. Accessibility, egress, sightline, and collision consumers still apply the existing exact polygon, circle, or segment predicate. An index result is never accepted as proof of collision or clearance.

Validation uses exact whole-input caching. A cached result is reused only when both the stable input fingerprint and canonical serialized input match. `ValidationEngine.cacheEvidence()` reports hits, misses, evictions, and the exact Constraint IDs reused or recomputed. Partial affected-Constraint reuse is deliberately disabled because accessibility, capacity, circulation, production, catering, emergency, and sightline evidence are coupled through shared geometry. This makes the optimization boundary auditable without risking stale evidence.

Read-only spatial analysis can run through the typed geometry Web Worker client. Unsupported environments use the same deterministic analyzer synchronously. Approval remains authoritative in the command bus and never trusts a worker response as committed Validation evidence.

Studio lists switch to windowed rendering after 50 records. Plan objects are spatially culled against the current canvas viewport with a small interaction margin. Short collections retain ordinary DOM flow and semantics.
