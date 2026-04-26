## Why

Profile-based operations currently leave their source sketches visible after commit, which clutters the viewport and breaks the expected CAD workflow where a consumed sketch is treated as spent by default. Refresh and document restore should reapply that same behavior from authored model state instead of depending on leftover UI visibility state.

## What Changes

- Auto-hide a committed sketch after a successful applied profile-based feature consumes one or more profiles owned by that sketch.
- Recompute consumed-sketch auto-hide during rebuild and document restore so used sketches hide again after reload without requiring manual cleanup.
- Keep auto-hidden sketches present in `Parts & Objects` and document history with hidden-state treatment so the user can show them again from the sidebar.
- Treat manual re-show of an auto-hidden sketch as a session-scoped visibility override; reload reapplies the derived auto-hide behavior from the authored model.

## Capabilities

### New Capabilities
<!-- None. -->

### Modified Capabilities
- `profile-based-feature-contract`: Profile-consuming features must expose enough durable ownership metadata for the runtime to determine which committed sketches have been consumed by applied profile references during commit and replay.
- `sketch-history-navigation`: Committed sketches must enter hidden-state treatment automatically when consumed by applied profile-based features, remain visible in navigation, and become showable again from `Parts & Objects`.

## Impact

- Affected code likely includes profile-based feature commit/replay helpers, snapshot or presentation builders that already surface `consumedByFeatureIds`, editor/runtime visibility state, `Parts & Objects` row rendering, and viewport visibility filtering.
- Focused `bun:test` coverage will be needed for commit-time auto-hide, reload-time re-derivation, and sidebar show/hide sync for consumed sketches.
- No authored feature-definition shape change is required if consumed-sketch detection can be derived from existing durable profile ownership data.
