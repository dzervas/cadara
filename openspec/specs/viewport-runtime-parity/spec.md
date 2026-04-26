# viewport-runtime-parity Specification

## Purpose
TBD - created by archiving change migrate-viewport-to-react-three-fiber. Update Purpose after archive.
## Requirements
### Requirement: Viewport runtime SHALL preserve interaction behavior during declarative renderer migration
The workbench viewport SHALL preserve its existing interaction behavior for hover, selection, and click-to-target resolution while using a declarative React Three Fiber runtime.

#### Scenario: Hover a valid target
- **WHEN** the pointer moves across a renderable target that is valid for the current selection context
- **THEN** the viewport resolves the same bound target and dispatches the same hover behavior as before the runtime migration

#### Scenario: Select a valid target
- **WHEN** the user clicks a renderable target that is valid for the current selection context
- **THEN** the viewport resolves and dispatches that same bound target for selection

### Requirement: Sketch pointer projection SHALL remain derived from the active sketch plane
The workbench viewport SHALL continue projecting pointer input through the active `SketchPlaneDefinition` when a sketch session is open, regardless of the underlying rendering runtime.

#### Scenario: Move pointer during an active sketch
- **WHEN** the user moves the pointer while an active sketch session is open
- **THEN** the emitted sketch pointer coordinates are derived from the active sketch plane rather than screen-space heuristics or camera orientation

#### Scenario: Release pointer during sketch authoring
- **WHEN** the user releases the primary pointer while an active sketch tool is drawing
- **THEN** the viewport emits sketch release coordinates derived from the same active sketch plane

### Requirement: View navigation SHALL preserve current workbench affordances
The workbench viewport SHALL preserve orbit, pan, framing, orientation-gizmo camera behavior, and sketch camera restoration behavior after the runtime migration.

#### Scenario: Use the orientation cube
- **WHEN** the user activates a face of the orientation cube
- **THEN** the camera animates to the corresponding canonical view direction through the migrated runtime without an instantaneous jump

#### Scenario: Enter a framed sketch session
- **WHEN** the editor requests sketch camera framing for an active sketch session
- **THEN** the viewport applies the same framing outcome through the migrated runtime using the shared animated programmatic camera path without changing the sketch-open behavior contract

#### Scenario: Exit a framed sketch session
- **WHEN** the editor requests sketch exit camera restoration for a closing sketch session
- **THEN** the viewport restores the captured pre-sketch camera pose through the migrated runtime using that same programmatic camera path

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
