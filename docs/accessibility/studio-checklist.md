# Studio accessibility checklist

Milestone 10.1 targets WCAG 2.2 AA for the planning Studio. Product labels stay operational and terse; this checklist records the longer verification procedure.

## Automated gates

- [x] Canvas object focus wraps deterministically with Arrow keys, Home, and End.
- [x] Canvas objects expose identity, type, layer, geometry, selection, and lock state.
- [x] Review and edit modes provide a semantic object index independent of the visual plan.
- [x] Validation and command outcomes use text and live-region announcements.
- [x] Active branches expose `aria-current`; branch, version, and ledger collections expose list structure.
- [x] Focus-visible styles cover buttons, links, form controls, summaries, and custom tab stops.
- [x] Reduced-motion CSS removes motion without hiding content.
- [x] Core paper, ink, muted, violet, and success color pairs meet 4.5:1 contrast.
- [x] Narrow/200%-zoom layout keeps top actions available and wraps them instead of hiding them.

Run:

```sh
node --test tests/studio-accessibility.test.mjs
npm run typecheck:app
npm run lint
npm run build:next
```

## Keyboard pass

- [ ] Tab from browser chrome through organization, sharing, status, history, edit, comments, operations, undo, redo, and export controls.
- [x] Open History; verify focus enters the sheet and returns to `Plan v…` when it closes.
- [ ] Use Left/Right arrows across Versions, Ledger, Branches, and Locks.
- [ ] In Branches, switch branches, choose revisions, compare, archive/restore, and create a branch without a pointer.
- [ ] Open the editor and Tab to the plan canvas.
- [x] Use Arrow keys to traverse visible objects.
- [ ] Use Enter or Space to select an object; use Shift+Enter/Space for additive selection.
- [ ] Use Control/Command+Arrow to move; add Shift for a 1 m step. Confirm locked objects announce `locked`.
- [ ] Delete an editable object, then undo and redo from the top bar.
- [ ] Open Layers, Library, Objects, Inspector, and Shortcuts; close each with its labeled close control.
- [ ] Open Spatial analysis; verify focus moves to Close and returns to View analysis.
- [ ] Tab to approval, hear the validation summary, approve a passing proposal, and hear the applied version.

## Screen reader pass

- [ ] macOS VoiceOver + Safari: navigate landmarks, top actions, Event brief, Plan analysis, Venue plan workspace, object index, and comparison controls.
- [ ] NVDA + Firefox or Chrome: repeat the same pass on Windows.
- [ ] Confirm SVG canvas objects announce label, kind, layer, coordinates/dimensions, lock state, and selected state.
- [ ] Confirm validation failure is announced immediately and pass/warning changes are announced politely.
- [ ] Confirm no icon-only control is announced as an unlabeled `button`.
- [ ] Confirm visual plan evidence is duplicated in status text/object data and is not conveyed by color alone.

## Reflow and display pass

- [ ] At 200% browser zoom on a 1280 × 720 viewport, complete edit, history, validation, and approval without two-dimensional page scrolling.
- [ ] At 320 CSS pixels wide, verify top actions wrap, drawers fit the viewport, and object lists scroll internally.
- [ ] With `prefers-reduced-motion: reduce`, verify sheets, menus, object selection, and toasts do not visibly animate.
- [ ] In Windows High Contrast/forced-colors mode, verify focus and selected objects remain visible.
- [ ] At 400% zoom, verify reading order and controls remain operable for the WCAG reflow exception applicable to the spatial canvas.

## Evidence record

Record date, browser/AT versions, viewport, failures, and issue links below. Unchecked manual items are not claimed as verified.

| Date | Environment | Result | Evidence |
| --- | --- | --- | --- |
| 2026-09-03 | Chrome accessibility tree, local production-equivalent Studio | Pass | History focus entered Close and returned to Plan; ArrowRight moved canvas focus from Stage position to Stage screen; all top actions and Approval remained exposed. |
