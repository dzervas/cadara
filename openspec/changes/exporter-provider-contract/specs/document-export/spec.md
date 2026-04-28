## MODIFIED Requirements

### Requirement: Export modal SHALL select supported file types
The workbench SHALL open an export modal for an exportable Parts & Objects row and SHALL allow the user to select from geometry formats discovered through the export provider registry, plus cadara, before exporting.

#### Scenario: Open export modal for an object row
- **WHEN** the user invokes Export from a supported Parts & Objects row
- **THEN** the workbench opens an export modal scoped to that row
- **AND** the modal queries the export provider registry for available geometry formats
- **AND** displays those formats plus cadara as file type choices

#### Scenario: Switch file type
- **WHEN** the user selects a different file type in the export modal
- **THEN** the modal calls `getOptionFormSchema(options)` on the matched provider to get the new option form
- **AND** renders the provider's option schema instead of hard-coded format-specific option panels
- **AND** incompatible options from the prior file type are not submitted

### Requirement: Export requests SHALL validate format-specific options
The export boundary SHALL validate the selected file type and its related options before producing a download payload, delegating geometry format validation to the matched provider.

#### Scenario: Reject invalid export options
- **WHEN** the user submits an export request with options that are invalid for the selected file type
- **THEN** the matched export provider rejects the request with a diagnostic
- **AND** the workbench does not trigger a browser download

#### Scenario: Reject unexportable target
- **WHEN** the selected Parts & Objects row does not resolve to exportable geometry for the selected geometry format
- **THEN** the export provider returns a failure result with a diagnostic explaining that the target cannot be exported
- **AND** the export modal remains open for retry or cancellation

### Requirement: Geometry formats SHALL download generated files
The workbench SHALL generate and download files for geometry exports by delegating to the matched export provider using the current document revision and the target selected by the context action.

#### Scenario: Download geometry export
- **WHEN** the user submits a valid geometry export for any registered format
- **THEN** the orchestrator delegates to the matched export provider
- **AND** the workbench downloads the file with the provider's declared extension and MIME type
- **AND** the downloaded payload uses the user-selected options
