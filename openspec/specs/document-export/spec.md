# document-export Specification

## Purpose
Defines the workbench document export flow, including the export modal, format-specific options, export request validation, generated file downloads, and cadara document JSON export.
## Requirements
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

### Requirement: Mesh exports SHALL expose accuracy options
The workbench SHALL expose mesh accuracy controls for tessellated export formats and SHALL submit those controls only for formats that use tessellation.

#### Scenario: Configure STL accuracy
- **WHEN** the user selects STL in the export modal
- **THEN** the modal shows mesh accuracy options for the STL export
- **AND** exporting submits the selected STL accuracy options with the export request

#### Scenario: Configure 3MF accuracy
- **WHEN** the user selects 3MF in the export modal
- **THEN** the modal shows mesh accuracy options for the 3MF export
- **AND** exporting submits the selected 3MF accuracy options with the export request

#### Scenario: STEP omits mesh accuracy
- **WHEN** the user selects STEP in the export modal
- **THEN** the modal does not show mesh accuracy controls
- **AND** exporting submits STEP-specific options without tessellation accuracy fields

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

### Requirement: Cadara export SHALL download raw document JSON
The workbench SHALL export cadara as the raw durable JSON document payload for the current document revision.

#### Scenario: Download cadara document
- **WHEN** the user submits a valid cadara export
- **THEN** the workbench downloads a `.cadara` file
- **AND** the file contents are JSON for the current durable document payload
- **AND** the export preserves the document contract and schema version fields

#### Scenario: Cadara export does not include presentation-only state
- **WHEN** the user submits a valid cadara export
- **THEN** the exported JSON does not include presentation-only workbench rows or transient modal state

### Requirement: Export modal SHALL report progress and failures
The export modal SHALL prevent duplicate submissions while an export is running and SHALL show export failures without closing the modal.

#### Scenario: Export is pending
- **WHEN** the user submits an export request
- **THEN** the export button enters a pending state
- **AND** duplicate export submissions are blocked until the request finishes

#### Scenario: Export fails
- **WHEN** the export operation returns a diagnostic or throws an error
- **THEN** the export modal shows the failure message
- **AND** no file download is triggered
- **AND** the user can change options and retry

#### Scenario: Export succeeds
- **WHEN** the export operation returns a successful payload
- **THEN** the workbench triggers one browser download using the result filename, MIME type, and file contents
- **AND** the export modal closes after the download is started

