## MODIFIED Requirements

### Requirement: Export modal SHALL select supported file types
The workbench SHALL open an export modal for an exportable Parts & Objects row or committed sketch history item and SHALL allow the user to select only file types compatible with the selected target. Body-compatible formats SHALL be discovered through the export provider registry, sketch-compatible formats SHALL be discovered through the same registry, and cadara SHALL remain available only where the document export contract supports raw document export for that flow.

#### Scenario: Open export modal for an object row
- **WHEN** the user invokes Export from a supported Parts & Objects row
- **THEN** the workbench opens an export modal scoped to that row
- **AND** the modal queries the export provider registry for formats compatible with the selected row target
- **AND** displays only compatible file type choices for that target

#### Scenario: Open export modal for a sketch row
- **WHEN** the user invokes Export from a committed sketch row in Parts & Objects
- **THEN** the workbench opens an export modal scoped to that sketch
- **AND** the modal displays SVG and DXF as the available sketch file type choices
- **AND** the modal does not display body-only formats such as STL, STEP, or 3MF for that sketch target

#### Scenario: Open export modal for a sketch history item
- **WHEN** the user invokes Export from a committed sketch item in the document history context menu
- **THEN** the workbench opens the same export modal scoped to that sketch
- **AND** the modal displays the same SVG and DXF choices as the Parts & Objects sketch export flow

#### Scenario: Switch file type
- **WHEN** the user selects a different file type in the export modal
- **THEN** the modal calls `getOptionFormSchema(options)` on the matched provider to get the new option form
- **AND** renders the provider's option schema instead of hard-coded format-specific option panels
- **AND** incompatible options from the prior file type are not submitted

### Requirement: Geometry formats SHALL download generated files
The workbench SHALL generate and download files for provider-backed exports by delegating to the matched export provider using the current document revision and the target selected by the context action.

#### Scenario: Download geometry export
- **WHEN** the user submits a valid provider-backed export for any registered compatible format
- **THEN** the orchestrator delegates to the matched export provider
- **AND** the workbench downloads the file with the provider's declared extension and MIME type
- **AND** the downloaded payload uses the user-selected options

#### Scenario: Download sketch vector export
- **WHEN** the user submits a valid SVG or DXF export for a committed sketch target
- **THEN** the orchestrator delegates to the matched sketch-compatible export provider
- **AND** the workbench downloads the file with the provider's declared extension and MIME type
- **AND** the downloaded payload is generated from the sketch at the modal's captured document revision
