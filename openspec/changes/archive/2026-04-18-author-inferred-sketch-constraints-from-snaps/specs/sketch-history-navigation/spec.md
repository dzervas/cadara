## ADDED Requirements

### Requirement: Sketch history SHALL group inferred constraints with their accepted authoring action
The sketch-local history model SHALL preserve user-facing undo and redo behavior for authoring actions that create geometry together with inferred constraints.

#### Scenario: Undo after inferred constraint commit
- **WHEN** the latest sketch authoring action created geometry and inferred constraints from accepted snap intent
- **THEN** a single Undo action moves the visible sketch state before both the new geometry and the inferred constraints
