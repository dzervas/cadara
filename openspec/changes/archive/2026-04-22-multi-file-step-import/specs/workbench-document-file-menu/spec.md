## ADDED Requirements

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
