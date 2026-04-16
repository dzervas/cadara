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
The workbench viewport SHALL preserve orbit, pan, framing, and orientation-gizmo camera behavior after the runtime migration.

#### Scenario: Use the orientation cube
- **WHEN** the user activates a face of the orientation cube
- **THEN** the camera snaps to the corresponding canonical view direction

#### Scenario: Enter a framed sketch session
- **WHEN** the editor requests sketch camera framing for an active sketch session
- **THEN** the viewport applies the same framing outcome through the migrated runtime without changing the sketch-open behavior contract

