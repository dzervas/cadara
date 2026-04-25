## MODIFIED Requirements

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
