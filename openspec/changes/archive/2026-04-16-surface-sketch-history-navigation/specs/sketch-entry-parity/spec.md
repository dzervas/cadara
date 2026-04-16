## ADDED Requirements

### Requirement: Sketch entry SHALL animate to sketch-local history consistently
The workbench SHALL use the same animated history transition whenever a sketch edit session starts, regardless of whether the session starts from a construction plane, a committed sketch row, or another valid sketch entry point.

#### Scenario: Enter sketch edit mode
- **WHEN** the user starts editing a sketch
- **THEN** the normal document history items animate down out of the active history area
- **AND** the sketch-local history items animate into the active history area before they become interactive

#### Scenario: Enter sketch edit mode from an existing sketch
- **WHEN** the user reopens a committed sketch from document navigation or history
- **THEN** the same document-history-to-sketch-history transition runs
- **AND** the sketch-local history is initialized from that committed sketch's authored geometry, constraints, and dimensions

### Requirement: Sketch exit SHALL animate back to normal document history consistently
The workbench SHALL use the same animated history transition whenever a sketch edit session exits, whether the sketch is committed, canceled, or otherwise closed through a supported exit path.

#### Scenario: Exit sketch edit mode
- **WHEN** the active sketch edit session exits
- **THEN** the sketch-local history items animate up out of the active history area
- **AND** the normal document history items animate back into the active history area

#### Scenario: Normal history includes the edited sketch after exit
- **WHEN** the sketch edit session exits after committing sketch changes
- **THEN** the restored normal document history includes the committed sketch item
- **AND** the committed sketch item uses the latest sketch label and durable sketch target
