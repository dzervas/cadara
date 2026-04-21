## ADDED Requirements

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
