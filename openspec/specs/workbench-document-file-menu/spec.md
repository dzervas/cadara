# workbench-document-file-menu Specification

## Purpose
TBD - created by archiving change add-toolbar-file-menu. Update Purpose after archive.
## Requirements
### Requirement: Toolbar SHALL expose a document file menu
The workbench SHALL render an icon-only file button as the first toolbar control and SHALL open a document file menu from that button.

#### Scenario: Open document file menu
- **WHEN** the user clicks the file button at the far left of the toolbar
- **THEN** a workbench-styled menu opens
- **AND** the menu includes New, Open local file, Save local file, Import, and Export document actions

#### Scenario: File button remains outside modeling tools
- **WHEN** the file button is clicked
- **THEN** the workbench opens the file menu
- **AND** no modeling tool action is dispatched for the file button itself

### Requirement: File menu SHALL create a new active document
The workbench SHALL create a new active document from the seeded empty authored document when the user invokes New from the file menu.

#### Scenario: Create new document
- **WHEN** the user selects New from the file menu
- **THEN** the active document is restored to the seeded document state
- **AND** the workbench refreshes to show the new document snapshot
- **AND** the user receives a visible status message confirming the new document

### Requirement: File menu SHALL import cadara documents
The workbench SHALL import a selected `.cadara` or JSON file by validating it as one authored model document JSON object before replacing the active document.

#### Scenario: Import valid document
- **WHEN** the user selects Import and chooses a valid authored model document JSON file
- **THEN** the workbench restores the imported document into the active document slot
- **AND** the workbench refreshes to show the imported snapshot
- **AND** the user receives a visible status message confirming the import

#### Scenario: Reject invalid document import
- **WHEN** the user selects Import and chooses a file that is not valid authored model document JSON
- **THEN** the active document is not replaced
- **AND** the workbench shows a visible import failure message

#### Scenario: Reject packaged cadara import
- **WHEN** the user selects Import and chooses a ZIP-backed `.cadara` package
- **THEN** the active document is not replaced
- **AND** the workbench does not extract package members or restore packaged geometry blobs
- **AND** the workbench shows a visible import failure message

### Requirement: File menu SHALL export the current document
The workbench SHALL export the current authored document as a single-object `.cadara` JSON download from the file menu without requiring an object target selection.

#### Scenario: Export current document
- **WHEN** the user selects Export from the file menu
- **THEN** the workbench downloads one `.cadara` JSON file for the current authored document
- **AND** the downloaded JSON preserves the authored document schema and contract fields
- **AND** the export does not include presentation-only workbench state
- **AND** the export does not include ZIP package members, sidecar files, or standalone geometry blob bytes

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
