## ADDED Requirements

### Requirement: Viewport runtime SHALL support temporary section-plane overlays and clipping
The workbench viewport SHALL support rendering and interacting with a temporary section plane, including its drag handle, clipping behavior, and retained-side updates, while preserving existing non-section camera controls and durable picking behavior.

#### Scenario: Active section renders an overlay handle
- **WHEN** the editor runtime exposes an active section-view state
- **THEN** the viewport renders the active section plane overlay and its drag handle
- **AND** the currently visible model is clipped against that section plane

#### Scenario: Drag the section handle
- **WHEN** the user starts a primary-pointer drag on the section handle
- **THEN** the viewport interprets that gesture as section-plane movement along the section normal
- **AND** it does not reinterpret the same drag as ordinary camera orbit, pan, or generic model selection

#### Scenario: Drag outside the section handle
- **WHEN** an active section exists but the user drags somewhere other than the section handle
- **THEN** the viewport preserves its normal camera/navigation interaction behavior for that gesture

#### Scenario: Flip retained side
- **WHEN** the editor runtime flips the retained side of an active section
- **THEN** the viewport updates the visible retained half and cut-surface rendering using the same section-plane position
- **AND** it does not mutate or rebuild the underlying authored model
