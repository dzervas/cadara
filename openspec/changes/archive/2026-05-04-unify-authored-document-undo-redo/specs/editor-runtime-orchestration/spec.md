## ADDED Requirements

### Requirement: Undo and redo SHALL dispatch through a dedicated durable-history coordination seam
The editor/runtime integration SHALL dispatch Undo and Redo requests through one dedicated durable-history coordination seam instead of splitting history ownership across reducers, workbench-local stacks, and ad hoc modeling-service mutation calls.

#### Scenario: Runtime-integrated undo request
- **WHEN** the user requests Undo through a toolbar or shortcut entrypoint
- **THEN** the application/runtime integration forwards that request through the dedicated durable-history coordination seam
- **AND** the runtime does not delegate authoritative Undo ownership to React-local hook state

#### Scenario: Runtime-integrated redo request
- **WHEN** the user requests Redo through a toolbar or shortcut entrypoint
- **THEN** the application/runtime integration forwards that request through the dedicated durable-history coordination seam
- **AND** covered workbench flows do not maintain separate redo sequencing logic outside that seam

### Requirement: Timeline rollback SHALL remain a separate runtime-owned document action
The editor runtime SHALL continue to own explicit document timeline cursor actions, but those actions SHALL remain separate from Undo and Redo semantics.

#### Scenario: User requests explicit timeline rollback
- **WHEN** the user activates an explicit timeline rollback action
- **THEN** the editor runtime sequences the document cursor mutation through its existing runtime-owned path
- **AND** that action is not invoked implicitly by Undo

#### Scenario: Undo availability differs from timeline rollback availability
- **WHEN** the timeline cursor can move but no durable undo group exists
- **THEN** the runtime may still expose explicit timeline rollback actions
- **AND** Undo remains unavailable
