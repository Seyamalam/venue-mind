# Real-time collaboration

VenueMind collaboration carries awareness and invalidation, not a second planning mutation path. `VenuePlanner.execute` remains the command boundary, Approval remains human-only, and Project Record Revision compare-and-swap serializes durable commits.

## Presence

Each open Studio renews a 30-second Presence Lease every 10 seconds. The lease stores Organization ID, Project ID, User and User Session identity, the Plan Version observed by that session, a focused stable object ID, and an optional bounded viewport. Expired leases are removed before every presence snapshot.

The Studio renders `LIVE n` plus identity initials, Plan Version, and focused object. It deliberately omits free-moving cursor trails: the current venue canvas is a review surface where object focus is useful and pointer telemetry is not. A viewport should be sent and rendered only when a future synchronized pan/zoom control makes it actionable.

## Durable event stream

Every successful Project write appends one or more typed Collaboration Events:

- `comment.updated`
- `ledger.appended`
- `proposal.updated`
- `approval.committed`
- `project.created` or `project.updated`

Events contain stable IDs and revision metadata, never a full protected Project snapshot. The SSE endpoint returns a presence snapshot, up to 100 ordered durable events, a cursor, and a 1.5-second reconnect interval. The browser uses the standard `Last-Event-ID` reconnect cursor.

Each event stores `previous_event_id` for its Project. If the first resumed event does not link to the requested cursor, the server emits `sync.reset`. The client reloads the current authoritative Project record. If local or conflicted work exists, optimistic concurrency remains in control and remote truth is not silently applied.

## Endpoints

- `GET /api/projects/:id/collaboration?organizationId=:organizationId`
- `PUT /api/projects/:id/collaboration/presence`
- `DELETE /api/projects/:id/collaboration/presence`

Authentication is the server-side User Session. Organization membership and Project ownership are checked before events or presence are returned. EventSource uses the Organization query parameter because browser EventSource cannot add the ordinary Organization header; the server resolves it against authenticated Memberships.

## Convergence and load evidence

`tests/collaboration.test.mjs` opens three authenticated sessions on one Project, publishes three distinct focus records, streams Comment and ledger changes, commits Approval through the normal planner plus record-revision boundary, and proves all three reads are byte-identical at Plan v3.3. The same suite verifies missed-link reset detection, browser event routing, 60 concurrent Presence Leases, and 500 ordered Collaboration Events in bounded pages.
