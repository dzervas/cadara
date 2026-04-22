## MODIFIED Requirements

### Requirement: Sketch edit mode SHALL expose sketch-local history
While a sketch is being edited, the history area SHALL show ordered durable sketch authoring operation rows for the active sketch instead of the normal document history items.

#### Scenario: Render sketch-local history
- **WHEN** an active sketch edit session is present
- **THEN** the history area shows sketch authoring operation rows for that sketch in operation order
- **AND** the normal document history items are not interactive during the sketch edit session
- **AND** individual operation child geometry rows are not shown

#### Scenario: Move sketch history cursor
- **WHEN** the user moves the sketch history cursor to an earlier sketch-local operation
- **THEN** sketch-local operations after that cursor are treated as after the current cursor
- **AND** the displayed sketch geometry and annotations reflect the flat sketch graph reconstructed through the active operation cursor

#### Scenario: Insert after sketch cursor
- **WHEN** the user authors new sketch geometry, constraints, or dimensions while the sketch cursor is rolled back
- **THEN** the new sketch-local authoring operation is inserted after the current sketch cursor
- **AND** the sketch cursor advances to the new operation

### Requirement: Sketch history SHALL group inferred constraints with their accepted authoring action
The sketch-local history model SHALL preserve user-facing undo and redo behavior for authoring operations that create geometry together with inferred constraints.

#### Scenario: Undo after inferred constraint commit
- **WHEN** the latest sketch authoring operation created geometry and inferred constraints from accepted snap intent
- **THEN** a single Undo action moves the visible sketch state before both the new geometry and the inferred constraints

### Requirement: Reopened sketch editing SHALL preserve document rollback and sketch-local history
While an existing committed sketch is reopened for editing, the document cursor SHALL remain at the rollback position before that sketch, and the history area SHALL continue to expose durable sketch authoring operation rows for the active sketch session.

#### Scenario: Reopened sketch shows sketch-local history after document rollback
- **WHEN** the user reopens a committed sketch whose document history position has later authored items
- **THEN** the normal document history is rolled back to the item immediately before the sketch
- **AND** the history area shows sketch authoring operation rows for the active sketch instead of interactive document history items

#### Scenario: Sketch-local cursor changes do not overwrite restore cursor
- **WHEN** a reopened sketch edit session captures an entry document cursor
- **AND** the user moves the sketch-local history cursor during the edit
- **THEN** the captured document restore cursor remains unchanged

#### Scenario: Exiting reopened sketch restores document cursor
- **WHEN** a reopened sketch edit session exits by finish sketch or abort sketch
- **THEN** the document cursor is restored to the cursor captured before the sketch edit session began
- **AND** the workbench leaves sketch-local history mode
