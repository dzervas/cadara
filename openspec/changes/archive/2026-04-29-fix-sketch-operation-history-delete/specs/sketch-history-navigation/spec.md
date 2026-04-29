## ADDED Requirements

### Requirement: Sketch-local history delete SHALL remove authored rows directly
The sketch-local history context menu SHALL treat Delete as a row-removal action for the targeted authoring operation instead of routing through the normal live-selection delete behavior.

#### Scenario: Delete a sketch-history row
- **WHEN** the user selects Delete from the context menu for a sketch-local history operation row
- **THEN** the editor removes that authored row from the sketch's authoring operation list
- **AND** the sketch-local timeline no longer shows the removed row after the rebuild completes
- **AND** the editor does not append a new delete operation for that action

#### Scenario: Repair cursor after sketch-history row deletion
- **WHEN** the current sketch-local history cursor points at the row the user deletes from the sketch-local history context menu
- **THEN** the editor repairs the cursor to the nearest surviving predecessor row when one exists
- **AND** the editor uses the empty sketch-history cursor when no authored rows remain

### Requirement: Sketch-local history delete SHALL stay distinct from selection delete
The sketch editor SHALL preserve separate semantics for sketch-history row deletion and live selection deletion even when both actions can target the same sketch-owned item kinds.

#### Scenario: Delete from sketch-history menu does not reuse selection delete
- **WHEN** the user opens a sketch-local history row context menu and selects Delete
- **THEN** the editor processes that action through the explicit sketch-history delete path
- **AND** the editor does not require the row target to stay selected as live sketch geometry or annotation content
- **AND** existing Delete and Backspace behavior for live sketch selections remains unchanged
