## MODIFIED Requirements

### Requirement: Local file open SHALL bind the active document to a filesystem file
The system SHALL allow a user to choose Open... > Open and keep linked, open a local `.cadara` or JSON authored model document through the browser's direct file access, create a new active document tab for that document, and bind that tab's document to the selected file for subsequent automatic direct writes through the selected file handle.

#### Scenario: Linked open picker uses cadara JSON options
- **WHEN** the user chooses Open... > Open and keep linked
- **THEN** the browser file picker is configured for `.cadara` files with JSON content
- **AND** the selected file is parsed directly as one authored model document JSON object before a new document tab is activated

#### Scenario: Open valid linked document
- **WHEN** the user chooses Open... > Open and keep linked and selects a valid authored model document through the browser file picker
- **THEN** the workbench creates a new document tab for the selected document
- **AND** the new tab becomes the active document session
- **AND** the imported document in that tab is bound to the selected file handle for subsequent accepted changes
- **AND** the previously active tab remains open and unchanged
- **AND** the user receives a visible status message confirming that future changes will save to that file

#### Scenario: Reject invalid linked document
- **WHEN** the user chooses Open... > Open and keep linked and selects a file that is not a valid authored model document JSON object
- **THEN** the current active document is not replaced
- **AND** no new tab is created
- **AND** no local file sync binding is created for that file
- **AND** the user receives a visible failure message

#### Scenario: Reject ZIP cadara package
- **WHEN** the user chooses Open... > Open and keep linked and selects a ZIP-backed `.cadara` package
- **THEN** the current active document is not replaced
- **AND** no new tab is created
- **AND** no package extraction or backwards-compatible asset restore path is used
- **AND** the user receives a visible failure message

#### Scenario: Linked open API unsupported
- **WHEN** the user chooses Open... > Open and keep linked in a browser that does not support the required direct file access
- **THEN** the current active document is not replaced
- **AND** no new tab is created
- **AND** the workbench reports that linked file saving is unavailable in the current browser
- **AND** the Open a copy flow remains available as the supported fallback

### Requirement: Save local file SHALL bind the active document to a new filesystem location
The system SHALL allow a user to choose Save As > Save and keep linked, choose a local file once through the browser's direct file access, write the current authored model document JSON object to that file, and bind the active document to that file for subsequent automatic direct writes without additional download prompts.

#### Scenario: Linked save picker uses cadara JSON options
- **WHEN** the user chooses Save As > Save and keep linked
- **THEN** the browser save picker is configured for `.cadara` files with `application/json` content
- **AND** the default save filename uses the `.cadara` extension

#### Scenario: Save current document to a linked file
- **WHEN** the user chooses Save As > Save and keep linked and chooses a destination through the browser save picker
- **THEN** the workbench writes the current normalized authored model document as one JSON object directly to that destination through the selected file handle
- **AND** the selected file handle becomes the direct-write sync target for subsequent accepted changes to the active document
- **AND** the user receives a visible status message confirming that future changes will save to that file

#### Scenario: Linked save is cancelled
- **WHEN** the user chooses Save As > Save and keep linked and cancels the browser save picker
- **THEN** the active document remains unchanged
- **AND** any existing local file sync binding remains unchanged

#### Scenario: Linked save API unsupported
- **WHEN** the user chooses Save As > Save and keep linked in a browser that does not support the required direct file access
- **THEN** no file is written
- **AND** the workbench reports that linked file saving is unavailable in the current browser
- **AND** the Download a copy flow remains available as the supported fallback

### Requirement: Import and Export SHALL remain one-shot file operations
The system SHALL keep Open... > Open a copy and Save As > Download a copy as explicit one-shot file operations that do not create or replace the active local filesystem sync binding.

#### Scenario: Open document copy
- **WHEN** the user opens a valid `.cadara` or JSON document through Open... > Open a copy
- **THEN** the workbench creates and activates a new browser-backed document tab for the opened document
- **AND** no local filesystem sync binding is created by the Open a copy action

#### Scenario: Download current document copy
- **WHEN** the user saves the current document through Save As > Download a copy
- **THEN** the workbench downloads or saves the export payload according to the export contract
- **AND** the active local filesystem sync binding remains unchanged
