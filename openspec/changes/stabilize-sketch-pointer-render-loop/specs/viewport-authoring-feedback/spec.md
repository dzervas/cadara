## ADDED Requirements

### Requirement: Viewport rendering SHALL be demand-driven while idle
The workbench viewport SHALL avoid continuous rendering when no viewport-visible state is changing, and SHALL explicitly request renders when authoring feedback, camera state, selection state, renderables, or viewport presentation state changes.

#### Scenario: Viewport becomes idle
- **WHEN** the viewport has no active camera motion, pointer drag, camera transition, transient animation, async renderable update, or visible authoring feedback change pending
- **THEN** the viewport stops scheduling continuous render frames
- **AND** the last rendered scene remains visible

#### Scenario: Camera interaction changes the view
- **WHEN** the user pans, rotates, zooms, uses the view cube, fits the view, resets the camera, or a camera transition advances
- **THEN** the viewport requests render frames for the changed camera state
- **AND** the visible scene updates without requiring continuous idle rendering

#### Scenario: Renderable or presentation inputs change
- **WHEN** model renderables, active sketch renderables, section view state, clipping state, LOD tier, theme/material inputs, viewport size, or projection inputs change
- **THEN** the viewport requests a render for the changed scene
- **AND** the visible scene reflects the new inputs

#### Scenario: Sketch authoring feedback changes
- **WHEN** active sketch pointer preview, snap feedback, dimension placement, direct drag feedback, hover, or selection changes visible viewport feedback
- **THEN** the viewport requests a render for that feedback change
- **AND** sketch authoring feedback remains visually live while the viewport otherwise renders on demand

#### Scenario: Empty idle time does not render new frames
- **WHEN** the viewport is idle and no invalidating state changes occur
- **THEN** the viewport does not produce additional render frames solely because the canvas is mounted
