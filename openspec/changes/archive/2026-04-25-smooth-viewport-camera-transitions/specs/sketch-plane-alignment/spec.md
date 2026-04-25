## MODIFIED Requirements

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

## ADDED Requirements

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
