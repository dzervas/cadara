## ADDED Requirements

### Requirement: Active sketch display SHALL derive accepted geometry from the current definition
The system SHALL render accepted editable sketch geometry from the active sketch definition instead of from a separately synchronized accepted-entity cache.

#### Scenario: Edited entity no longer has stale display geometry
- **WHEN** a user edits existing sketch geometry and the active sketch definition changes
- **THEN** the viewport displays the geometry derived from the updated sketch definition
- **AND** stale accepted geometry from before the edit is not displayed

#### Scenario: Deleted entity is removed from active sketch display
- **WHEN** a user deletes selected editable local sketch geometry while a sketch remains active
- **THEN** the deleted geometry is absent from the active sketch definition-derived display entities
- **AND** the deleted geometry is not rendered as a stale accepted sketch entity

### Requirement: Direct sketch drag updates SHALL be coalesced to animation frames
The system SHALL coalesce direct sketch geometry drag move events so constraint-backed draft updates run no more than once per animation frame while preserving the latest pointer position for the frame.

#### Scenario: Multiple pointer moves occur before a frame
- **WHEN** several pointer move events occur during one direct sketch geometry drag before the next animation frame
- **THEN** the editor processes one drag update for that frame
- **AND** the processed update uses the latest projected sketch-plane point from those pointer moves

#### Scenario: Drag ends with a pending frame
- **WHEN** a direct sketch geometry drag ends while a coalesced drag update is pending
- **THEN** the pending update is cancelled or ignored
- **AND** no stale drag update is applied after the drag lifecycle ends
