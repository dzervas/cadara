# workbench-document-file-menu Specification

## Purpose
TBD - created by archiving change add-toolbar-file-menu. Update Purpose after archive.
## Requirements
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

### Requirement: Workbench SHALL expose STL and 3MF import
The workbench import surface SHALL allow users to select STL and 3MF files for mesh-to-baked-geometry import while clearly marking the current mesh import review flow as probably broken.

#### Scenario: User imports mesh file
- **WHEN** the user chooses Import and selects an `.stl` or `.3mf` file
- **THEN** the workbench starts the mesh import flow with source-discard warning, file validation, progress feedback, and conversion diagnostics

#### Scenario: Mesh import modal title shows broken-state chip
- **WHEN** the workbench shows the STL or 3MF import review modal
- **THEN** a “Probably Broken” chip appears near the modal title
- **AND** the chip is visible before commit and cancel actions

### Requirement: Workbench SHALL run STEP import baking off the UI thread
The workbench SHALL route STEP review and Cadara geometry baking through the OpenCascade worker when worker support is available, so accepted imports do not keep the STEP modal open while large STEP files are translated.

#### Scenario: User imports STEP file with worker support
- **WHEN** the user chooses Import and selects a `.step` or `.stp` file in a browser that supports module workers
- **THEN** STEP review and Cadara geometry baking are requested through the OpenCascade worker
- **AND** the workbench does not initialize or run OpenCascade STEP baking on the UI thread for that import

#### Scenario: STEP import commit is pending
- **WHEN** the user accepts a STEP import review
- **THEN** the STEP review modal closes
- **AND** the workbench shows lower-right import progress labeled “Baking Cadara geometry”
- **AND** the workbench refreshes and fits the viewport after the translated solids are committed

### Requirement: Workbench SHALL complete accepted STEP import flow without waiting for full OCC materialization
The workbench SHALL treat authored-document persistence and initial imported-body presentation as the completion point for the user-visible STEP import flow, while any heavier OCC materialization continues separately.

#### Scenario: Accepted STEP import clears progress after persisted presentation is ready
- **WHEN** a STEP import has baked translated Cadara B-rep data and persisted the authored document successfully
- **THEN** the lower-right import progress surface completes and disappears without waiting for a full OCC materialization pass
- **AND** the viewport refresh shows the imported body through an available persisted faceted presentation path
- **AND** the workbench does not leave the import flow visibly pending forever

#### Scenario: Background materialization degrades without blocking import completion
- **WHEN** the workbench is still materializing a persisted STEP import through OCC after the imported body is already visible
- **THEN** that work runs as a background phase rather than as a blocking import-progress phase
- **AND** any failure or timeout surfaces as a visible diagnostic or status message for the imported feature
- **AND** the already persisted imported body remains visible to the user

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

