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
The workbench SHALL import a selected `.cadara` or JSON file by validating it as an authored model document before replacing the active document.

#### Scenario: Import valid document
- **WHEN** the user selects Import and chooses a valid authored model document file
- **THEN** the workbench restores the imported document into the active document slot
- **AND** the workbench refreshes to show the imported snapshot
- **AND** the user receives a visible status message confirming the import

#### Scenario: Reject invalid document import
- **WHEN** the user selects Import and chooses a file that is not valid authored model document JSON
- **THEN** the active document is not replaced
- **AND** the workbench shows a visible import failure message

### Requirement: File menu SHALL export the current document
The workbench SHALL export the current authored document as a `.cadara` JSON download from the file menu without requiring an object target selection.

#### Scenario: Export current document
- **WHEN** the user selects Export from the file menu
- **THEN** the workbench downloads one `.cadara` file for the current authored document
- **AND** the downloaded JSON preserves the authored document schema and contract fields
- **AND** the export does not include presentation-only workbench state

### Requirement: Workbench SHALL expose STEP import
The workbench file menu or import surface SHALL allow users to select STEP files for exact solid import.

#### Scenario: User selects STEP import
- **WHEN** the user chooses Import and selects a `.step` or `.stp` file
- **THEN** the workbench starts the STEP import flow with file-type validation, progress feedback, settings review, and error reporting

### Requirement: Workbench SHALL expose STL and 3MF import
The workbench import surface SHALL allow users to select STL and 3MF files for mesh-to-baked-geometry import.

#### Scenario: User imports mesh file
- **WHEN** the user chooses Import and selects an `.stl` or `.3mf` file
- **THEN** the workbench starts the mesh import flow with source-discard warning, file validation, progress feedback, and conversion diagnostics

### Requirement: Workbench SHALL review STEP solids in a Mantine modal before import
The workbench STEP import flow SHALL show a Mantine modal that lists discovered supported solids before committing a STEP import feature.

#### Scenario: Review discovered STEP solids
- **WHEN** the user selects one or more STEP files for import and review preparation succeeds
- **THEN** the workbench opens a Mantine modal listing every discovered supported solid
- **AND** each solid row has a checkbox for inclusion in the import
- **AND** the modal uses existing workbench Mantine theme styling

#### Scenario: Toggle all discovered solids
- **WHEN** the STEP import review modal lists supported solids
- **THEN** the modal shows a global checkbox control at the top of the list
- **AND** activating the global control enables or disables all importable solid rows
- **AND** the global control shows an indeterminate state when only some importable rows are selected

#### Scenario: Import selected solids
- **WHEN** the user accepts the STEP import review with one or more solids selected
- **THEN** the workbench commits an import request containing only the selected solid keys
- **AND** the workbench refreshes to show the imported bodies after the modeling service accepts the request

#### Scenario: Import disabled with no selected solids
- **WHEN** the STEP import review modal has no supported solids selected
- **THEN** the Import action is disabled
- **AND** the modal presents a visible message that at least one solid must be selected

### Requirement: Workbench SHALL support multi-file STEP selection
The workbench import surface SHALL allow users to select a root STEP assembly file and referenced sibling STEP files in one import operation.

#### Scenario: Select multiple STEP files
- **WHEN** the user invokes Import Part and chooses multiple `.step` or `.stp` files
- **THEN** the workbench reads those files as one STEP import review input
- **AND** the first selected STEP file is treated as the root assembly file for the review

#### Scenario: Select mixed supported import files
- **WHEN** the user invokes Import Part and selects files with mixed import formats
- **THEN** the workbench starts the STEP multi-file flow only when the selected set contains STEP files and no mesh or document import files
- **AND** otherwise the workbench reports a visible file-type validation error without committing an import

#### Scenario: Review preparation fails
- **WHEN** STEP import review preparation returns errors for missing references, unreadable files, or unsupported structure
- **THEN** the modal shows the diagnostics in the review flow
- **AND** the active document is not modified

