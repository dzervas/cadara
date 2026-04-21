## ADDED Requirements

### Requirement: Editor refresh SHALL preserve the last rendered scene during recoverable edit failures
The editor-facing modeling flow SHALL keep the currently rendered scene active after an in-session edit introduces a recoverable rebuild failure, and SHALL swap render data only after a successful replacement snapshot is available.

#### Scenario: Feature edit causes rebuild failure
- **WHEN** a user edit changes a feature field to an invalid reference or parameter
- **THEN** the authored change and feature diagnostics are surfaced through the editor state
- **AND** the viewport continues to display the previously successful render records
- **AND** the editor does not replace the viewport with an empty or failed render result

#### Scenario: User fixes failed field
- **WHEN** the user corrects the invalid feature field and the next rebuild succeeds
- **THEN** the editor swaps the viewport to the newly generated render records
- **AND** the feature error state is cleared from the editor-facing presentation

#### Scenario: Reload uses partial rebuild output
- **WHEN** the application reloads and no previous in-session render is available
- **THEN** the editor displays the partial rebuild snapshot supplied by the modeling service
- **AND** it exposes all independently discovered failed feature diagnostics for repair
