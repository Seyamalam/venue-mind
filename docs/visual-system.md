# Visual system

VenueMind's Design 2 is an operational plan sheet: warm paper surfaces, graphite information, architectural hairlines, and one violet revision layer. Violet belongs to proposed or interactive state; accepted Plan truth stays neutral. Dense utility labels use tabular, terse notation. Space and hierarchy carry the editorial character instead of ornamental copy.

## Tokens

The root token contract in `app/globals.css` owns color, typography, spacing, border, radius, elevation, icon size, motion, and focus. Product CSS may publish route-specific aliases, but those aliases resolve to the `--vm-*` contract for shared semantics.

- Ink: `#1d1e1c`; paper: `#faf9f6`; canvas: `#f0eee8`; line: `#deddd7`.
- Revision violet: `#6845e8`; pale revision field: `#efecfb`; revision line: `#8a73ed`.
- Display and body text use Inter. Codes, status, evidence, and compact controls use the utility monospace stack.
- Spacing follows a 4/8/12/16/24/32/48 progression. Panels use 10px corners; controls use 6px corners.
- Motion is 120ms for response and 180ms for spatial transitions. Reduced-motion mode removes the loading rotation and collapses transitions.

## Status

Status always has a text label or semantic name. Color is redundant evidence.

| State | Text | Field | Use |
| --- | --- | --- | --- |
| Pass | `#286638` | `#e7f3e5` | Validated, accepted, synchronized |
| Warning | `#7a4a0b` | `#fff0da` | Review required, stale |
| Invalid | `#8d2923` | `#fae9e7` | Failed constraint, blocked write |
| Offline | `#4f3aa0` | `#ece8ff` | Verified local recovery only |
| Conflict | invalid pair plus `CONFLICT` label | invalid field | Explicit resolution required |

Every text/background pair is held to WCAG AA contrast for compact text. Focus uses a visible violet ring independent of status color.

## Reusable states

`RouteState` is the shared loading, empty, offline, conflict, invalid, and disabled surface. It keeps route boundaries terse, exposes a live status or alert role, and gives each state a stable `data-state` contract. Workspace controls continue to compose the source-owned shadcn primitives; this contract does not flatten the Studio's plan-sheet identity into a generic component theme.

Critical regression evidence covers the route shell, Project sheets, violet Proposal ghosts, Validation pass/fail, Approval, offline recovery, conflicts, and disabled actions. Token snapshots and semantic selector checks run locally with the ordinary test suite. Pixel/browser snapshots are owned by the browser verification milestone so their rendering engine and viewport are explicit.
