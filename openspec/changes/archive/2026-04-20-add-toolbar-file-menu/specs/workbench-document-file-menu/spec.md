## ADDED Requirements

### Requirement: Toolbar SHALL expose a document file menu
The workbench SHALL render an icon-only file button as the first toolbar control and SHALL open a document file menu from that button.

#### Scenario: Open document file menu
- **WHEN** the user clicks the file button at the far left of the toolbar
- **THEN** a workbench-styled menu opens
- **AND** the menu includes New, Import, and Export document actions

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
