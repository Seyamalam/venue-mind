# Optimistic concurrency

Project Record Revisions protect the full Organization-owned Project record. They are distinct from immutable Plan Versions and Proposal revisions.

## HTTP contract

- `GET /api/projects/:id` returns the current positive `revision` and strong `ETag`.
- Create with `If-None-Match: *`; an existing ID returns `409 PROJECT_ID_CONFLICT` with current record data.
- Update with `If-Match: "venuemind:<encoded-project-id>:<revision>"`.
- An existing Project update without `If-Match` returns `428 PROJECT_PRECONDITION_REQUIRED`.
- A malformed or Project-mismatched ETag returns `400 PROJECT_ETAG_INVALID`.
- A stale write returns `412 PROJECT_REVISION_CONFLICT`, the current record, current revision, and current ETag.

The D1 repository advances the Project revision and writes a unique write token in the same batch. The snapshot update is guarded by that token, preventing a losing stale writer from replacing `project_states` after its metadata compare-and-swap fails.

## Browser reconciliation

The browser retains two Organization-scoped records: the local working copy and the last synchronized base. A stale response triggers a base/local/remote comparison across metadata and planning state.

Independent fields merge onto the current remote record and retry once against its ETag. A second race stops with a conflict. Different values for the same field stop immediately. `snapshot` and `activePlanId` overlaps are planning conflicts.

## Recovery

Every unresolved conflict writes a timestamped Organization-scoped recovery entry before any remote choice. The Studio displays compact state only: `SYNC CONFLICT`, revisions, overlapping fields, `BRANCH`, and `REMOTE`.

`BRANCH` restores current remote truth and appends the local Proposal as a Recovery Branch with `proposal.branch_recovered` ledger evidence. The branch is never approved automatically; stale bases, Locks, geometry overlaps, Constraint regressions, Validation, and Approval keep their normal semantics. `REMOTE` accepts the authoritative record while the separate recovery entry remains available.

## Verification

`tests/organization-isolation.test.mjs` drives two API sessions from the same ETag and proves the second cannot overwrite the first. `tests/project-store.test.mjs` proves independent changes merge and overlapping planning edits fail visibly while retaining recovery state. `tests/project-concurrency.test.mjs` covers ETag binding, merge classification, Recovery Branch creation, and ledger integrity.
