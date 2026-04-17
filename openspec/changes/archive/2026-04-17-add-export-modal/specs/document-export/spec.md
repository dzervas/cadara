## ADDED Requirements

### Requirement: Export modal SHALL select supported file types
The workbench SHALL open an export modal for an exportable Parts & Objects row and SHALL allow the user to select exactly one of STL, STEP, 3MF, or cadara before exporting.

#### Scenario: Open export modal for an object row
- **WHEN** the user invokes Export from a supported Parts & Objects row
- **THEN** the workbench opens an export modal scoped to that row
- **AND** the modal displays STL, STEP, 3MF, and cadara as available file type choices

#### Scenario: Switch file type
- **WHEN** the user selects a different file type in the export modal
- **THEN** the modal updates the visible options to match that file type
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
The export boundary SHALL validate the selected file type and its related options before producing a download payload.

#### Scenario: Reject invalid export options
- **WHEN** the user submits an export request with options that are invalid for the selected file type
- **THEN** the export operation rejects the request with a diagnostic
- **AND** the workbench does not trigger a browser download

#### Scenario: Reject unexportable target
- **WHEN** the selected Parts & Objects row does not resolve to exportable geometry for the selected geometry format
- **THEN** the export operation returns a diagnostic explaining that the target cannot be exported
- **AND** the export modal remains open for retry or cancellation

### Requirement: Geometry formats SHALL download generated files
The workbench SHALL generate and download files for STL, STEP, and 3MF exports using the current document revision and the target selected by the context action.

#### Scenario: Download STL
- **WHEN** the user submits a valid STL export
- **THEN** the workbench downloads a `.stl` file for the selected target
- **AND** the downloaded payload uses the selected STL options

#### Scenario: Download STEP
- **WHEN** the user submits a valid STEP export
- **THEN** the workbench downloads a `.step` or `.stp` file for the selected target
- **AND** the downloaded payload uses the selected STEP options

#### Scenario: Download 3MF
- **WHEN** the user submits a valid 3MF export
- **THEN** the workbench downloads a `.3mf` file for the selected target
- **AND** the downloaded payload uses the selected 3MF options

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
