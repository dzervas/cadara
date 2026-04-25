## ADDED Requirements

### Requirement: Viewport SHALL pin pending dimension placement before value entry
The viewport SHALL treat normal primary clicks during a pending dimension placement phase as placement confirmation for the floating value-entry prompt.

#### Scenario: User clicks empty viewport while a dimension waits for placement
- **WHEN** the Dimension tool has selected enough targets for a value-backed dimension
- **AND** the pending preview is waiting for annotation placement
- **AND** the user primary-clicks empty viewport space outside a preview drag handle
- **THEN** the viewport pins the pending annotation placement at the clicked sketch-plane point
- **AND** the floating value-entry prompt opens without clearing the selected dimension targets

#### Scenario: User clicks existing sketch geometry while a dimension waits for placement
- **WHEN** the Dimension tool has selected enough targets for a value-backed dimension
- **AND** the pending preview is waiting for annotation placement
- **AND** the user primary-clicks existing selectable sketch geometry outside a preview drag handle
- **THEN** the viewport pins the pending annotation placement at the clicked sketch-plane point
- **AND** the click does not replace the selected dimension targets
