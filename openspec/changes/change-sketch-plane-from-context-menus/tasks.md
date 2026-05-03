## 1. Menu entry points

- [x] 1.1 Add `Change Sketch Plane` to eligible committed sketch context menus in `src/components/layout/feature-sidebar.tsx` and `src/components/layout/floating-parts-tree.tsx`
- [x] 1.2 Extend the bottom history-bar menu descriptors and handlers in `src/components/layout/feature-timeline-bar.helpers.ts` and `src/components/layout/feature-timeline-bar.tsx` to surface the sketch-only action without changing feature-only actions
- [x] 1.3 Add or update UI-lane coverage for sketch menu affordances and item lists in the existing layout specs

## 2. Editor runtime session

- [x] 2.1 Add a dedicated sketch-plane edit request and session model to the editor runtime instead of routing the flow through feature authoring or full sketch reopen
- [x] 2.2 Reuse the committed-item rollback/restore cursor lifecycle for sketch-plane edit entry when the target sketch is not already at the active document cursor
- [x] 2.3 Add logic-lane coverage for sketch-plane edit entry, cancel, and cursor-lifecycle behavior

## 3. Inspector and draft editing

- [x] 3.1 Extract or generalize the inspector shell so it can render the sketch-plane edit session through the existing form primitives
- [x] 3.2 Implement the origin-plane selector draft state, including current-plane hydration and supported origin-plane option resolution from the active snapshot
- [x] 3.3 Add UI or logic coverage for plane-option rendering and patch application in the dedicated sketch-plane editor flow

## 4. Commit and rebuild behavior

- [x] 4.1 Recommit sketches with the updated plane and existing authored definition through the existing `commitSketch` modeling path
- [x] 4.2 Refresh the accepted snapshot and preserve downstream rebuild diagnostics behavior after sketch-plane reassignment
- [x] 4.3 Add logic-lane coverage for accepted plane reassignment and unchanged-document behavior on cancel
