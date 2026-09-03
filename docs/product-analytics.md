# Product analytics

VenueMind product analytics measures aggregate workflow friction. It does not measure operator performance, make decisions, grant automation authority, or change the human Approval boundary.

## Collection boundary

Collection is off by default. A browser sends analytics only after an operator selects `OPT IN` in Settings. `OPT OUT` takes effect before the next request and does not change product behavior.

Every accepted event contains exactly five fields:

| Field | Bound |
| --- | --- |
| `schemaVersion` | `1` |
| `eventName` | One of seven canonical event names |
| `outcome` | One canonical outcome allowed for that event |
| `stage` | One canonical workflow stage allowed for that event |
| `errorCategory` | `null` or one canonical category for `product.error` |

The canonical events are `golden-loop.completed`, `validation.completed`, `adjustment.cycle`, `branch.compared`, `export.completed`, `product.error`, and `workflow.abandoned`. Outcomes, stages, and error categories are fixed in `src/analytics/product-analytics.ts`; unexpected keys or combinations are rejected.

The analytics body never includes raw geometry, event or Project content, comments, object identifiers, Project identifiers, user identifiers, URLs, free text, credentials, identity attributes, or arbitrary error messages. Arbitrary runtime errors collapse into one of six fixed categories before collection.

## Aggregate persistence

The Worker validates the exact event and increments a daily D1 counter. It does not store an event stream. Counters are partitioned by a one-way organization scope hash and the fixed dimensions `event_name`, `outcome`, `stage`, and `error_category`. Counts are bounded integers. Query results are limited to 90 days and 256 dimension rows; stored aggregates expire after 180 days.

Organization administrators may read their aggregate window at `GET /api/analytics/metrics?days=30`. The response never returns the scope hash or any Project, object, user, or event-row identifier.

## Interpretation

Metrics answer where a workflow stops or repeats. They support product-friction review only:

- `purpose`: `friction-only`
- `automationAuthority`: `none`
- `supervisionPolicy`: `unchanged`

A low completion rate, failed Validation count, or repeated Adjustment count is not evidence about an individual operator and must not be used to bypass review, loosen constraints, automate Approval, rank users, or infer venue safety.

## Observability boundary

Product analytics and observability are separate. Observability provides operational timing, failure, integrity, and correlation diagnostics. Product analytics contains no correlation IDs, durations, routes, request metadata, traces, payloads, or raw failures. Disabling product analytics does not disable essential security, integrity, audit, or reliability signals.

## Retention and deletion

Daily analytics aggregates expire after 180 days, with provider backups expiring under the documented 30-day backup boundary. Because the aggregates contain no account, user, Project, or object identifier, they are not part of account or Project export and cannot be selected for individual deletion. Opting out stops future collection from that browser immediately.
