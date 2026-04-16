## 1. Presentation Contracts

- [x] 1.1 Extend object/navigation presentation types so committed sketch rows can appear in `Parts & Objects` with durable sketch targets.
- [x] 1.2 Add a document history item view model that represents committed sketches and committed features in authored document order.
- [x] 1.3 Add snapshot-builder coverage for mock and OCC paths proving sketches appear in object navigation and document history.

## 2. Visibility Filtering

- [x] 2.1 Include sketch targets in the workbench hidden-target key lifecycle so hidden sketch state is retained only for valid committed sketches.
- [x] 2.2 Filter sketch-owned viewport renderables, hover targets, and selection targets when a committed sketch is hidden.
- [x] 2.3 Add tests for hiding and showing committed sketches from `Parts & Objects`.

## 3. Document History UI

- [x] 3.1 Update the bottom history/timeline component to render document history items for both sketches and features with accessible icon-only controls and shared tooltips.
- [x] 3.2 Preserve selection, double-click edit reentry, and cursor placement behavior for sketch and feature history items.
- [x] 3.3 Add timeline rendering tests for mixed sketch/feature histories, after-cursor treatment, and sketch item reentry.

## 4. Sketch-Local History

- [x] 4.1 Add sketch-session history helpers for ordered sketch entities, constraints, dimensions, cursor indexing, and valid cursor targets.
- [x] 4.2 Apply sketch-local rollback and replay to draft sketch display state without mutating committed sketch state before commit.
- [x] 4.3 Insert newly authored sketch items after the active sketch history cursor and advance the cursor.
- [x] 4.4 Add unit tests for sketch-local cursor movement, after-cursor filtering, and insert-after-cursor behavior.

## 5. Animated History Swap

- [x] 5.1 Move history-area composition into a shell component that can switch between document history and active sketch history.
- [x] 5.2 Implement sketch-entry animation where document history items slide down/out and sketch-local history becomes interactive after entry.
- [x] 5.3 Implement sketch-exit animation where sketch-local history slides up/out and normal document history returns with the committed sketch item.
- [x] 5.4 Add reduced-motion-friendly rendering tests that verify transition state and interaction gating without depending on exact animation timing.

## 6. Verification

- [x] 6.1 Run `bun run test` and fix failures.
- [x] 6.2 Run `bun run lint` and fix failures.
