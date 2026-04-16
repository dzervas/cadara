## MODIFIED Requirements

### Requirement: Sketch behavior is consistent across entry points
The system MUST keep sketch behavior consistent whether the session was opened from a construction-plane selection, an existing sketch selection, the feature tree, or a direct reopen interaction such as double-clicking a sketch entry.

#### Scenario: Compare viewport and feature-tree entry on the same plane
- **WHEN** the user opens sketches on the same primary plane from the viewport and from the feature tree
- **THEN** both sessions use the same active plane and author geometry with the same orientation

#### Scenario: Continue authoring after reopening a sketch
- **WHEN** the user reopens an existing sketch through a supported reopen interaction and authors additional geometry
- **THEN** the editor continues using the sketch's stored plane definition

### Requirement: Mixed planar targets follow the same sketch-open contract
The system MUST use the same sketch-open flow for datum planes, planar solid faces, planar faces from other sketches, and reopened existing sketches where the sketch's stored plane defines the resumed session.

#### Scenario: Start from a planar solid face
- **WHEN** the user activates `Sketch` and selects a planar solid face
- **THEN** the editor opens a sketch session using the selected face's plane support and the standard sketch-open contract

#### Scenario: Start from a planar face owned by another sketch
- **WHEN** the user activates `Sketch` and selects a planar face from another sketch
- **THEN** the editor opens a sketch session using that face's plane support and the standard sketch-open contract

#### Scenario: Reopen an existing sketch entry
- **WHEN** the user reopens an existing sketch entry directly from the workbench tree
- **THEN** the editor opens that sketch using the same sketch-open contract with the sketch's stored plane support

## ADDED Requirements

### Requirement: Escape exits sketch mode only after active tool state is cleared
The system MUST treat `Escape` as a scoped unwind inside sketch mode by clearing any active tool first and exiting the sketch only when no tool remains active.

#### Scenario: Escape while a sketch tool is active
- **WHEN** the user presses `Escape` while a sketch session is active and a sketch tool is currently active
- **THEN** the active sketch tool is deactivated and the sketch session remains open

#### Scenario: Escape with no active sketch tool
- **WHEN** the user presses `Escape` while a sketch session is active and no sketch tool is active
- **THEN** the editor exits the sketch session and returns to part mode
