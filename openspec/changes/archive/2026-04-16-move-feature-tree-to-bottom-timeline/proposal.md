## Why

The feature tree currently competes with dense navigation content in the sidebar and does not provide the Fusion 360-style timeline affordance needed for rollback-based editing. Moving committed features into a bottom timeline makes feature order and rollback state visible while preserving the sidebar for document navigation.

## What Changes

- Move the feature list out of the sidebar into a new bottom feature timeline bar.
- Render each timeline feature as a single compact icon matching toolbar icon sizing, with reduced vertical padding.
- Reuse the toolbar tooltip mechanics so hovering a feature icon exposes its feature information.
- Keep the remaining sidebar sections visually and behaviorally unchanged.
- Add a timeline cursor that indicates the current applied feature position.
- Add a `cursor` field to the model document that references the last applied feature.
- Default the document cursor to the tail of the feature sequence whenever the document is not rolled back.
- Support rollback by moving the cursor without deleting later features from document state.
- Insert newly created features immediately after the cursor, then move the cursor to the new feature while preserving follow-up features after it.

## Capabilities

### New Capabilities
- `feature-timeline-bar`: Covers the bottom feature timeline bar, feature icon rendering, tooltips, sidebar relocation, and visible cursor placement.
- `model-document-feature-cursor`: Covers the model document cursor contract, rollback semantics, default tail behavior, and feature insertion after a rolled-back cursor.

### Modified Capabilities

## Impact

- Affected UI: sidebar feature tree components, bottom workbench layout, feature icon rendering, tooltip usage, and timeline cursor rendering.
- Affected domain/modeling contracts: model document snapshot shape, feature ordering helpers, feature insertion flows, rollback/application state handling, and any document serialization tests or fixtures.
- Affected behavior: feature creation after rollback must preserve unapplied follow-up features instead of truncating or deleting them.
