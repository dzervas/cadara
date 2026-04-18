## ADDED Requirements

### Requirement: Edit previews SHALL render against the rolled-back document basis
When a committed feature or sketch is edited after edit-session rollback, preview geometry SHALL be evaluated and rendered against the document state through the rollback cursor, not against later authored items.

#### Scenario: Edit feature before later history
- **WHEN** document history is `sketch - extrude - sketch2 - revolve`
- **AND** the user starts editing `extrude`
- **THEN** the committed scene is rebuilt through `sketch`
- **AND** the draft preview for `extrude` is shown as transient preview geometry
- **AND** `sketch2` and `revolve` are not applied to the committed scene while the edit session is active

#### Scenario: Preview updates preserve rollback basis
- **WHEN** an active edit preview is recomputed after draft input changes
- **THEN** the preview is recomputed against the same rollback cursor used to enter the edit session
- **AND** later authored history remains excluded until the edit session exits

#### Scenario: Exit clears preview and restores committed scene
- **WHEN** an edit session exits by commit, cancel, finish sketch, or abort sketch
- **THEN** transient preview geometry for the edit session is cleared
- **AND** the committed scene is rebuilt from the restored entry cursor
