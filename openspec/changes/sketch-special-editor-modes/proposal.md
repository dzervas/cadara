## Why

The sketch editor currently has normal drawing tools, edit tools, and form-like style flows, but no clean contract for committed-operation editing modes that need their own picking, overlays, pointer behavior, and side-panel UI. Without that contract, specialized workflows such as reference-image calibration will be implemented as one-off exceptions and will quickly turn into spaghetti.

## What Changes

- Add a sketch-owned special editor mode contract for committed sketch operations that need dedicated interaction flows separate from ordinary sketch drawing tools.
- Define a viewport-aware mode interface that owns its own hit targets, click/double-click behavior, drag behavior, overlays, hover affordances, and mode-local selection semantics.
- Define a side-panel contract for sketch special modes that feels like a continuation of the feature editor's structured forms while remaining separate from the deprecated SVG-tool UI surfaces and separate from the feature editor implementation.
- Integrate special editor mode lifecycle into the editor runtime so active sketch sessions can enter, update, commit, cancel, and exit a mode without introducing ad hoc React-local orchestration.
- Keep this change generic and infrastructure-focused. It does not define any specific image-calibration behavior by itself.

## Capabilities

### New Capabilities
- `sketch-special-editor-modes`: sketch-owned special editor modes with dedicated viewport interaction, overlays, panel forms, and lifecycle management for committed sketch operations

### Modified Capabilities
- `editor-runtime-orchestration`: extend editor-runtime command orchestration so an active sketch session can host a sketch-owned special editor mode with explicit lifecycle and stale-result safety

## Impact

- Affected areas include editor runtime state, sketch-session transient state, viewport event routing, hover/pick target modeling, and the inspector/panel rendering path for sketch-specific mode UIs.
- This change creates reusable infrastructure intended for later specialized sketch workflows, including but not limited to reference-image calibration and potential future surface-oriented edit modes.
- The feature editor domain remains separate; this change shares shell-level interaction patterns, not feature-session business rules.
