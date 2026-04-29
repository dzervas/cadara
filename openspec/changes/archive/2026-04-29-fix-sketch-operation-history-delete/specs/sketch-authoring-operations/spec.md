## MODIFIED Requirements

### Requirement: Deletions SHALL append authoring operations
Deletion of live sketch geometry, constraints, dimensions, or annotations through the normal sketch selection delete path SHALL append a new sketch authoring operation instead of mutating or removing the original operation that created the deleted members.

#### Scenario: Delete one edge from a rectangle
- **WHEN** the user deletes one edge created by a rectangle operation from the active sketch selection
- **THEN** the sketch definition removes that edge and dependent live constraints or dimensions from the current flat graph
- **AND** the authoring operation list appends a delete operation after the rectangle operation
- **AND** the original rectangle operation remains available as historical metadata

## ADDED Requirements

### Requirement: Explicit operation deletion SHALL remove the targeted authoring operation
When the user explicitly deletes an authored row from sketch-local history, the system SHALL remove the targeted authoring operation from the sketch definition and rebuild the visible sketch state from the remaining authored operations instead of appending a new delete operation.

#### Scenario: Delete a rectangle operation row from sketch history
- **WHEN** the user selects Delete from the sketch-local history context menu for a rectangle authoring operation
- **THEN** the targeted rectangle operation is removed from the sketch definition's authoring operation list
- **AND** no new delete operation is appended for that history action
- **AND** the rebuilt sketch state reflects only the surviving authoring operations

#### Scenario: Delete a delete-operation row from sketch history
- **WHEN** the user selects Delete from the sketch-local history context menu for an existing delete authoring operation
- **THEN** the targeted delete operation is removed from the sketch definition's authoring operation list
- **AND** no replacement delete operation is appended
- **AND** any sketch members that only that removed delete operation had taken out of the rebuilt graph become visible again after replay
