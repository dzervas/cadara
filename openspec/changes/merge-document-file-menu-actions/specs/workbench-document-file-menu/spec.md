## MODIFIED Requirements

### Requirement: Toolbar SHALL expose a document file menu
The workbench SHALL render an icon-only file button as the first toolbar control and SHALL open a document file menu from that button.

#### Scenario: Open document file menu
- **WHEN** the user clicks the file button at the far left of the toolbar
- **THEN** a workbench-styled menu opens
- **AND** the menu includes exactly New, Open..., and Save As actions
- **AND** the menu does not include separate New document, Open local file, Save local file, Import, or Export document actions

#### Scenario: File button remains outside modeling tools
- **WHEN** the file button is clicked
- **THEN** the workbench opens the file menu
- **AND** no modeling tool action is dispatched for the file button itself

### Requirement: File menu SHALL create a new active document
The workbench SHALL create a new active document tab from the seeded empty authored document when the user invokes New from the file menu.

#### Scenario: Create new document tab
- **WHEN** the user selects New from the file menu
- **THEN** the workbench creates a fresh document tab with no filesystem binding
- **AND** the new tab becomes the active document session
- **AND** the previously active tab remains open and unchanged
- **AND** the workbench refreshes to show the new document snapshot
- **AND** the user receives a visible status message confirming the new document

## ADDED Requirements

### Requirement: Open modal SHALL choose document open storage behavior
The workbench SHALL open a modal from Open... that lets the user choose whether to open a browser-only document copy or a document linked to a file on their computer.

#### Scenario: Open modal explains browser-only copy
- **WHEN** the user selects Open... from the file menu
- **THEN** the workbench opens an Open Document modal
- **AND** the modal includes an Open a copy choice described as "Choose a .cadara file; CADara opens it in a new tab, and future changes stay in browser storage until you save again."

#### Scenario: Open modal explains linked file
- **WHEN** the user selects Open... from the file menu
- **THEN** the workbench opens an Open Document modal
- **AND** the modal includes an Open and keep linked choice described as "Choose a .cadara file; CADara opens it in a new tab and keeps future changes saving to that same file on your computer."

#### Scenario: Open browser-only copy
- **WHEN** the user chooses Open a copy and selects a valid authored model document JSON file
- **THEN** the workbench creates a new document tab for the selected document
- **AND** the new tab becomes active
- **AND** the new tab has browser-backed storage state
- **AND** the previously active tab remains open and unchanged
- **AND** the user receives a visible status message confirming the document opened

#### Scenario: Open linked file
- **WHEN** the user chooses Open and keep linked and selects a valid authored model document through the browser's direct file picker
- **THEN** the workbench creates a new document tab for the selected document
- **AND** the new tab becomes active
- **AND** the selected file handle becomes the direct-write sync target for that new document tab
- **AND** the previously active tab remains open and unchanged
- **AND** the user receives a visible status message confirming that future changes will save to that file

#### Scenario: Reject invalid open file
- **WHEN** the user chooses either Open Document modal option and selects a file that is not valid authored model document JSON
- **THEN** the currently active document is not replaced
- **AND** no new tab is created
- **AND** no filesystem sync binding is created
- **AND** the workbench shows a visible open failure message

### Requirement: Save As modal SHALL choose document save storage behavior
The workbench SHALL open a modal from Save As that lets the user choose whether to download a portable document copy or save the current document to a linked file on their computer.

#### Scenario: Save As modal explains download copy
- **WHEN** the user selects Save As from the file menu
- **THEN** the workbench opens a Save As modal
- **AND** the modal includes a Download a copy choice described as "CADara downloads a portable .cadara file; future changes stay in browser storage until you save again."

#### Scenario: Save As modal explains linked save
- **WHEN** the user selects Save As from the file menu
- **THEN** the workbench opens a Save As modal
- **AND** the modal includes a Save and keep linked choice described as "Choose where to save; CADara writes this document there and keeps future changes saving to that same file on your computer."

#### Scenario: Download document copy
- **WHEN** the user chooses Download a copy from Save As
- **THEN** the workbench downloads one `.cadara` JSON file for the current authored document
- **AND** the downloaded JSON preserves the authored document schema and contract fields
- **AND** the active document's storage binding remains unchanged
- **AND** the user receives a visible status message confirming the download

#### Scenario: Save and link current document
- **WHEN** the user chooses Save and keep linked and selects a destination through the browser's direct save picker
- **THEN** the workbench writes the current normalized authored model document as one JSON object directly to that destination
- **AND** the selected file handle becomes the direct-write sync target for subsequent accepted changes to the active document
- **AND** the active tab reports filesystem-backed storage state
- **AND** the user receives a visible status message confirming that future changes will save to that file

## REMOVED Requirements

### Requirement: File menu SHALL import cadara documents
**Reason**: The top-level Import document action is replaced by Open... with an Open a copy choice.
**Migration**: Use Open... > Open a copy for one-shot document file upload, or Open... > Open and keep linked for direct filesystem open and sync.

### Requirement: File menu SHALL export the current document
**Reason**: The top-level Export document action is replaced by Save As with a Download a copy choice.
**Migration**: Use Save As > Download a copy for one-shot `.cadara` download, or Save As > Save and keep linked for direct filesystem Save As and sync.
