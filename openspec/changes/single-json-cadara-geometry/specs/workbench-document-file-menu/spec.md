## MODIFIED Requirements

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
