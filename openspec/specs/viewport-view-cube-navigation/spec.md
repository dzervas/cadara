# viewport-view-cube-navigation Specification

## Purpose
TBD - created by archiving change transparent-labeled-view-cube. Update Purpose after archive.
## Requirements
### Requirement: The viewport SHALL render a transparent navigation cube overlay
The system SHALL render the top-right navigation cube without a background panel and SHALL keep the cube visually transparent except for its edge framing and button affordance outlines.

#### Scenario: Viewport renders the navigation cube
- **WHEN** the workbench viewport renders the navigation cube overlay
- **THEN** the overlay does not render an opaque or tinted background panel behind the cube
- **AND** the cube body remains visually transparent rather than appearing as a filled solid
- **AND** the cube still exposes visible edge framing so its orientation remains readable over the scene

### Requirement: The viewport SHALL label each face with its orientation
The system SHALL render a centered orientation label for each major navigation face: `Front`, `Back`, `Left`, `Right`, `Top`, and `Bottom`.

#### Scenario: User inspects the navigation cube
- **WHEN** the navigation cube is visible in the viewport
- **THEN** each major face has a readable orientation label centered within that face target
- **AND** the labels identify the corresponding principal view direction

### Requirement: Face buttons SHALL snap the camera to principal views
The system SHALL treat each major face as a clickable navigation target that snaps the active viewport camera to the corresponding principal orientation while preserving the shared orbit-control camera ownership.

#### Scenario: User clicks a labeled face
- **WHEN** the user clicks the `Front`, `Back`, `Left`, `Right`, `Top`, or `Bottom` face target on the navigation cube
- **THEN** the viewport camera snaps to the corresponding principal view direction
- **AND** the camera update is routed through the shared viewport navigation control path

### Requirement: Corner buttons SHALL snap the camera to isometric views
The system SHALL expose clickable corner targets on the navigation cube, and each corner target SHALL snap the camera to the corresponding cube-corner isometric orientation.

#### Scenario: User clicks a corner target
- **WHEN** the user clicks a corner target on the navigation cube
- **THEN** the viewport camera snaps to the isometric orientation associated with that cube corner
- **AND** the corner target behaves as a button even though the cube body remains transparent

### Requirement: Projection selector SHALL be colocated with the view cube
The viewport SHALL render a compact projection selector under and right-aligned with the navigation cube overlay, using `public/icons/view-cube.svg` as the selector trigger icon.

#### Scenario: Projection selector renders near the navigation cube
- **WHEN** the workbench viewport renders the navigation cube overlay
- **THEN** a projection selector trigger is visible under the cube and aligned to the cube's right edge
- **AND** the trigger uses the `public/icons/view-cube.svg` icon

#### Scenario: User opens projection selector
- **WHEN** the user activates the projection selector trigger
- **THEN** the viewport shows projection options for `Orthographic` and `Perspective`

### Requirement: Viewport camera projection SHALL be user-switchable
The viewport SHALL default to orthographic camera projection and SHALL allow the user to switch the active viewport camera between orthographic and perspective projection without changing the current view orientation.

#### Scenario: Viewport starts in orthographic projection
- **WHEN** the workbench viewport first renders
- **THEN** the active viewport camera uses orthographic projection
- **AND** orbit, pan, picking, and view-cube navigation are available

#### Scenario: User switches to perspective projection
- **WHEN** the viewport is using orthographic projection
- **AND** the user selects `Perspective` from the projection selector
- **THEN** the active viewport camera uses perspective projection
- **AND** the viewport preserves the current orbit target, camera direction, and camera up vector

#### Scenario: User switches back to orthographic projection
- **WHEN** the viewport is using perspective projection
- **AND** the user selects `Orthographic` from the projection selector
- **THEN** the active viewport camera uses orthographic projection
- **AND** the viewport preserves the current orbit target, camera direction, and camera up vector

#### Scenario: View cube navigation preserves active projection
- **WHEN** the user snaps the camera with a view cube face or corner target
- **THEN** the viewport camera snaps to the requested view direction
- **AND** the active projection mode remains unchanged

