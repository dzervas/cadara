## ADDED Requirements

### Requirement: File document actions SHALL create active tabs without replacing existing tabs
The workbench SHALL route file-menu document creation and document-open flows through tab creation so existing open tabs remain intact.

#### Scenario: New creates a browser-only tab
- **WHEN** the user selects New from the document file menu
- **THEN** the workbench creates a new tab for a fresh authored document
- **AND** the new tab becomes the active document session
- **AND** the new tab indicates `storageKind: browser`
- **AND** the previously active tab remains open and unchanged

#### Scenario: Open a copy creates a browser-only tab
- **WHEN** the user selects Open... and completes the Open a copy flow with a valid authored model document
- **THEN** the workbench creates a new tab for the opened document
- **AND** the new tab becomes the active document session
- **AND** the new tab indicates `storageKind: browser`
- **AND** the previously active tab remains open and unchanged

#### Scenario: Open and keep linked creates a filesystem tab
- **WHEN** the user selects Open... and completes the Open and keep linked flow with a valid authored model document
- **THEN** the workbench creates a new tab for the opened document
- **AND** the new tab becomes the active document session
- **AND** the new tab indicates `storageKind: filesystem`
- **AND** the selected file binding belongs to the new tab's document identity
- **AND** the previously active tab remains open and unchanged
