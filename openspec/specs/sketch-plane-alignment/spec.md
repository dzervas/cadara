# sketch-plane-alignment Specification

## Purpose

Define the plane-owned sketch session behavior that keeps pointer projection, preview rendering, and committed geometry aligned to the active sketch plane.
## Requirements
### Requirement: Sketch sessions preserve an explicit plane definition
The system MUST preserve a sketch session's full `SketchPlaneDefinition` for the entire session lifetime instead of inferring sketch axes from ambient viewport state.

#### Scenario: Open sketch on a construction plane
- **WHEN** a sketch session opens from a construction-plane selection
- **THEN** the session stores the selected durable target, `planeTarget`, `planeKey`, and full `plane: SketchPlaneDefinition`

#### Scenario: Reopen an existing sketch
- **WHEN** a sketch session opens from an existing sketch record
- **THEN** the session reuses the stored sketch plane definition from that sketch

### Requirement: Pointer input is projected through the active sketch plane
The system MUST convert viewport pointer input into sketch-space coordinates using the active sketch plane definition.

#### Scenario: Move pointer during an XY sketch
- **WHEN** the user moves the pointer while an XY sketch session is active
- **THEN** the resulting `sketch.pointerMoved` coordinates are derived from the active XY plane definition

#### Scenario: Move pointer during a non-XY sketch
- **WHEN** the user moves the pointer while a `YZ` or `XZ` sketch session is active
- **THEN** the resulting sketch coordinates are derived from that active non-XY plane definition without switching axes

### Requirement: Sketch preview and accepted geometry remain coplanar with the active session plane
The system MUST render sketch previews and accepted sketch geometry on the active sketch plane for `XY`, `YZ`, and `XZ` sessions.

#### Scenario: Draw a line on the YZ plane
- **WHEN** the user previews and places a line in an active `YZ` sketch
- **THEN** the preview and accepted geometry remain on the `YZ` plane without flicker

#### Scenario: Draw a rectangle on the XZ plane
- **WHEN** the user previews and places a rectangle in an active `XZ` sketch
- **THEN** the preview and accepted geometry remain on the `XZ` plane without collapsing onto the wrong axes

### Requirement: Sketch entry camera aligns to the active sketch plane and visible sketch content
The system MUST capture the pre-entry viewport camera pose before sketch framing begins, MUST orient the camera to a view parallel to the active sketch plane whenever a sketch session opens, and MUST animate to a framed visible extent for that session.

#### Scenario: Start a new sketch
- **WHEN** the user opens a new sketch on any supported sketch plane
- **THEN** the pre-entry camera pose is captured before reframing begins
- **AND** the camera animates to a plane-parallel view fit to a default plane-centered sketch extent

#### Scenario: Edit an existing sketch
- **WHEN** the user opens an existing sketch containing authored entities
- **THEN** the pre-entry camera pose is captured before reframing begins
- **AND** the camera animates to a plane-parallel view zoomed so the full sketch geometry is visible with padding

### Requirement: Sketch exit camera restores the pre-entry workbench view
The system MUST restore the captured pre-entry viewport camera pose whenever a sketch session exits through a supported exit path.

#### Scenario: Finish an edited sketch
- **WHEN** the user exits an active sketch edit session through `Finish Sketch`
- **THEN** the viewport camera animates back to the captured pre-entry pose
- **AND** the restored view matches the orbit target, view direction, projection mode, and zoom or camera distance in effect before sketch entry

#### Scenario: Exit a sketch without finishing
- **WHEN** the user exits an active sketch session through `Cancel`, abort, or sketch-mode `Escape`
- **THEN** the viewport camera animates back to the captured pre-entry pose
- **AND** the restored view matches the orbit target, view direction, projection mode, and zoom or camera distance in effect before sketch entry

