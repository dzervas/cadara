## ADDED Requirements

### Requirement: Viewport clicks SHALL reach active sketch constraint tools
The workbench viewport SHALL dispatch valid click selections to active sketch constraint tools while preserving pointer construction behavior for active sketch drawing tools.

#### Scenario: Active constraint tool receives a picked sketch target
- **WHEN** a sketch constraint tool is active and the user clicks sketch geometry accepted by that tool
- **THEN** the viewport dispatches the selected target to the editor constraint-authoring flow

#### Scenario: Active drawing tool keeps construction behavior
- **WHEN** a sketch drawing tool is active and the user clicks in the viewport to construct geometry
- **THEN** the viewport continues to route the click through the sketch pointer construction flow instead of treating it as an ordinary selection
