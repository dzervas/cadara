## ADDED Requirements

### Requirement: Feature suppression mutations SHALL participate in durable document history
Suppressing or unsuppressing a feature SHALL be recorded as one repository-backed durable document history group and SHALL use the same undo/redo coordination boundary as other accepted document-changing mutations.

#### Scenario: Suppression records undo group
- **WHEN** a feature suppression mutation is accepted
- **THEN** durable document history records one undo group for that suppression state change
- **AND** undo restores the previous suppression state and refreshes the rebuilt snapshot

#### Scenario: Unsuppression records undo group
- **WHEN** a feature unsuppression mutation is accepted
- **THEN** durable document history records one undo group for that suppression state change
- **AND** undo restores the previous suppression state and refreshes the rebuilt snapshot

#### Scenario: Suppression no-op does not record history
- **WHEN** a suppression mutation requests the feature's existing suppression state
- **THEN** no durable undo group is recorded
- **AND** redo history is not changed
