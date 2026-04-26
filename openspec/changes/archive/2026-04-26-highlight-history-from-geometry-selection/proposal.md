## Why

Viewport picking already resolves durable geometry targets, but the history bar only has direct feature-selection behavior. That leaves users without authoring context for downstream geometry edits, especially when a later feature such as `Shell` transforms only part of an earlier `Extrude` result and the selected face should point back to both features instead of whichever body record happens to own the current solid.

## What Changes

- Add durable contributor-ancestry metadata for selectable body topology so a selected body, face, edge, or vertex can surface which committed features contributed to that geometry in authored order.
- Use that contributor ancestry to drive non-cursor history-bar highlighting from accepted viewport selections.
- Clear the derived history highlight when viewport selection is cleared, without reopening features or moving the document-history cursor.
- Keep the behavior rebuild-safe so reload and replay produce the same highlight ancestry for the same selected topology.

## Capabilities

### New Capabilities
- `feature-selection-ancestry`: Rebuilt selectable topology must expose contributing feature ancestry precise enough to distinguish untouched upstream faces from topology newly created by later features.

### Modified Capabilities
- `feature-timeline-bar`: The history bar must render derived highlight state for all committed features that contribute to the current selected geometry.
- `viewport-authoring-feedback`: Accepted viewport selections must update and clear the history-bar contributor highlight set together with normal selection behavior.

## Impact

- Affected code likely includes OCC topology replacement/snapshot builders, snapshot entity schema/runtime validation, editor selection-derived view state, and the feature timeline presentation layer.
- Focused `bun:test` coverage will be needed for shell-versus-extrude ancestry cases, reload parity, and history-bar highlight rendering.
- No authored feature-definition migration is required if contributor ancestry can be derived from rebuild-time topology lineage rather than persisted in authored document state.
