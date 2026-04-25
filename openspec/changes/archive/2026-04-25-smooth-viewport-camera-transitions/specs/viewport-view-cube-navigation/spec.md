## MODIFIED Requirements

### Requirement: Face buttons SHALL snap the camera to principal views
The system SHALL treat each major face as a clickable navigation target that animates the active viewport camera to the corresponding principal orientation while preserving the shared orbit-control camera ownership.

#### Scenario: User clicks a labeled face
- **WHEN** the user clicks the `Front`, `Back`, `Left`, `Right`, `Top`, or `Bottom` face target on the navigation cube
- **THEN** the viewport camera animates from its current pose to the corresponding principal view direction without an instantaneous jump
- **AND** the camera update is routed through the shared viewport navigation control path

### Requirement: Corner buttons SHALL snap the camera to isometric views
The system SHALL expose clickable corner targets on the navigation cube, and each corner target SHALL animate the active viewport camera to the corresponding cube-corner isometric orientation.

#### Scenario: User clicks a corner target
- **WHEN** the user clicks a corner target on the navigation cube
- **THEN** the viewport camera animates to the isometric orientation associated with that cube corner without an instantaneous jump
- **AND** the corner target behaves as a button even though the cube body remains transparent

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
- **WHEN** the user animates the camera with a view cube face or corner target
- **THEN** the viewport reaches the requested view direction without changing the active projection mode
- **AND** subsequent orbit, pan, and view-cube navigation continue using that same projection
