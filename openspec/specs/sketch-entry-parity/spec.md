# sketch-entry-parity Specification

## Purpose

Define consistent sketch behavior across all supported entry points, including viewport selection, feature-tree selection, and reopened sketches.
## Requirements
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

### Requirement: Escape exits sketch mode only after active tool state is cleared
The system MUST treat `Escape` as a scoped unwind inside sketch mode by clearing any active tool first and exiting the sketch only when no tool remains active.

#### Scenario: Escape while a sketch tool is active
- **WHEN** the user presses `Escape` while a sketch session is active and a sketch tool is currently active
- **THEN** the active sketch tool is deactivated and the sketch session remains open

#### Scenario: Escape with no active sketch tool
- **WHEN** the user presses `Escape` while a sketch session is active and no sketch tool is active
- **THEN** the editor exits the sketch session and returns to part mode

### Requirement: Sketch camera transitions SHALL stay consistent across entry points
The system MUST use the same camera-capture and animated framing contract whether a sketch session starts from a construction plane, a planar face, the feature tree, or a reopen interaction for an existing sketch.

#### Scenario: Compare viewport and feature-tree sketch entry
- **WHEN** the user opens equivalent sketch sessions from the viewport and from the feature tree
- **THEN** each session captures the current viewport camera pose before reframing
- **AND** each session animates to the same plane-aligned framed outcome for that sketch target

#### Scenario: Reopen an existing sketch from a committed entry
- **WHEN** the user reopens an existing sketch through a supported direct interaction
- **THEN** the session uses the same camera-capture and animated framing contract as any other supported sketch entry path
- **AND** the resulting camera framing uses the sketch's stored plane definition and visible sketch geometry

### Requirement: Sketch exit camera restoration SHALL stay consistent across exit paths
The system MUST restore the captured pre-entry viewport camera pose through the same animated transition whenever a sketch session exits through a supported path.

#### Scenario: Finish sketch after editing
- **WHEN** the user exits a sketch edit session through `Finish Sketch`
- **THEN** the viewport animates back to the same pre-entry camera pose that was captured when the session opened

#### Scenario: Exit sketch through a non-commit path
- **WHEN** the user exits a sketch session through `Cancel`, abort, or sketch-mode `Escape`
- **THEN** the viewport animates back to the same pre-entry camera pose that was captured when the session opened

