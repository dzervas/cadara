## MODIFIED Requirements

### Requirement: File menu SHALL import cadara documents
The workbench SHALL import a selected `.cadara` or JSON file by validating it as one authored model document JSON object and opening it in a newly created active document tab rather than replacing the currently active tab in place.

#### Scenario: Import valid document
- **WHEN** the user selects Import and chooses a valid authored model document JSON file
- **THEN** the workbench creates a new document tab for the imported document
- **AND** the newly created tab becomes active
- **AND** the previously active tab remains open and unchanged
- **AND** the workbench refreshes to show the imported snapshot
- **AND** the user receives a visible status message confirming the import

#### Scenario: Reject invalid document import
- **WHEN** the user selects Import and chooses a file that is not valid authored model document JSON
- **THEN** the currently active document is not replaced
- **AND** no new tab is created
- **AND** the workbench shows a visible import failure message

#### Scenario: Reject packaged cadara import
- **WHEN** the user selects Import and chooses a ZIP-backed `.cadara` package
- **THEN** the currently active document is not replaced
- **AND** no new tab is created
- **AND** the workbench does not extract package members or restore packaged geometry blobs
- **AND** the workbench shows a visible import failure message
