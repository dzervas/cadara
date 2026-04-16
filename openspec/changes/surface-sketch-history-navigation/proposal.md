## Why

Committed sketches are currently hard to treat as first-class document objects: they can exist in snapshots and feature-tree data, but they are not consistently exposed alongside parts/objects or the feature history controls the user uses for rollback and edit reentry. Sketch editing also needs a clear local history context so entering a sketch does not leave the user manipulating the document feature timeline by mistake.

## What Changes

- Show committed sketches in `Parts & Objects` with the same dense row treatment as bodies and construction geometry.
- Add sketch visibility controls so hiding a sketch removes its sketch-owned viewport geometry from selection and render output while keeping the sketch row visible.
- Represent committed sketches in the normal feature history/timeline alongside solid features so they can be selected and reopened from document history.
- When sketch editing starts, animate the normal feature-history items down/out of the history area and reveal a sketch-local history view.
- Give the sketch-local history view the same core timeline behavior as feature history: rollback and replay through valid cursor positions, cursor placement, selection, and edit reentry for sketch history items.
- When sketch editing exits, animate the sketch-local history view up/out and restore the normal feature history, including the committed sketch row.

## Capabilities

### New Capabilities
- `sketch-history-navigation`: Committed sketches appear in document navigation/history surfaces, support visibility toggling, and expose sketch-local history controls during edit sessions.

### Modified Capabilities
- `sketch-entry-parity`: Sketch entry and exit must consistently swap between document feature history and sketch-local history regardless of how the sketch session starts.

## Impact

- Affects document snapshot presentation records for object rows, feature/history rows, and sketch-owned visibility semantics.
- Affects `FeatureSidebar`, `FeatureTimelineBar`, sketch session state, modeling operation history, and workbench shell composition.
- Requires tests for sketch rows in `Parts & Objects`, sketch visibility filtering, document history rendering that includes sketches, and animated history context transitions on sketch entry/exit.
- May require a new sketch-history cursor contract parallel to the document feature cursor if current sketch session state cannot already express rollback and replay positions.
