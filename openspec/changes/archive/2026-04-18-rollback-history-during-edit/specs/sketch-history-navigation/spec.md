## ADDED Requirements

### Requirement: Reopened sketch editing SHALL preserve document rollback and sketch-local history
While an existing committed sketch is reopened for editing, the document cursor SHALL remain at the rollback position before that sketch, and the history area SHALL continue to expose sketch-local history for the active sketch session.

#### Scenario: Reopened sketch shows sketch-local history after document rollback
- **WHEN** the user reopens a committed sketch whose document history position has later authored items
- **THEN** the normal document history is rolled back to the item immediately before the sketch
- **AND** the history area shows sketch entities, constraints, and dimensions for the active sketch instead of interactive document history items

#### Scenario: Sketch-local cursor changes do not overwrite restore cursor
- **WHEN** a reopened sketch edit session captures an entry document cursor
- **AND** the user moves the sketch-local history cursor during the edit
- **THEN** the captured document restore cursor remains unchanged

#### Scenario: Exiting reopened sketch restores document cursor
- **WHEN** a reopened sketch edit session exits by finish sketch or abort sketch
- **THEN** the document cursor is restored to the cursor captured before the sketch edit session began
- **AND** the workbench leaves sketch-local history mode
