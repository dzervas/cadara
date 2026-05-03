## MODIFIED Requirements

### Requirement: Local file open SHALL bind the active document to a filesystem file
The system SHALL allow a user to open a local `.cadara` or JSON authored model document through the browser File System Access API, create a new active document tab for that document, and bind that tab's document to the selected file for subsequent automatic direct writes through the selected file handle.

#### Scenario: Open picker uses cadara JSON options
- **WHEN** the user selects Open local file
- **THEN** the browser file picker is configured for `.cadara` files with JSON content
- **AND** the selected file is parsed directly as one authored model document JSON object before a new document tab is activated

#### Scenario: Open valid local document
- **WHEN** the user selects Open local file and chooses a valid authored model document through the browser file picker
- **THEN** the workbench creates a new document tab for the selected document
- **AND** the new tab becomes the active document session
- **AND** the imported document in that tab is bound to the selected file handle for subsequent accepted changes
- **AND** the previously active tab remains open and unchanged
- **AND** the user receives a visible status message confirming that local file sync is active

#### Scenario: Reject invalid local document
- **WHEN** the user selects Open local file and chooses a file that is not a valid authored model document JSON object
- **THEN** the current active document is not replaced
- **AND** no new tab is created
- **AND** no local file sync binding is created for that file
- **AND** the user receives a visible failure message

#### Scenario: Reject ZIP cadara package
- **WHEN** the user selects Open local file and chooses a ZIP-backed `.cadara` package
- **THEN** the current active document is not replaced
- **AND** no new tab is created
- **AND** no package extraction or backwards-compatible asset restore path is used
- **AND** the user receives a visible failure message

#### Scenario: Local open API unsupported
- **WHEN** the user selects Open local file in a browser that does not support the required File System Access API
- **THEN** the current active document is not replaced
- **AND** no new tab is created
- **AND** the workbench reports that local file sync is unavailable in the current browser

## ADDED Requirements

### Requirement: Local file bindings SHALL remain document-scoped across tabs
The workbench SHALL keep local file bindings keyed to document identity so switching tabs does not transfer or erase filesystem sync state for another document.

#### Scenario: Switch from filesystem tab to browser-only tab
- **WHEN** the user activates a browser-only tab after working in a filesystem-bound tab
- **THEN** the newly active tab reports browser-backed storage state
- **AND** the prior filesystem binding remains associated with its original document

#### Scenario: Switch back to filesystem-bound tab
- **WHEN** the user re-activates a tab whose document has an existing local file binding
- **THEN** that tab reports filesystem-backed storage state again
- **AND** accepted changes from that active session continue syncing to the bound file handle
