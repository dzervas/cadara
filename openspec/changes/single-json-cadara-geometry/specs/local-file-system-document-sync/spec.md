## MODIFIED Requirements

### Requirement: Local file open SHALL bind the active document to a filesystem file
The system SHALL allow a user to open a local `.cadara` or JSON authored model document through the browser File System Access API and SHALL bind the active document to that file for subsequent automatic direct writes through the selected file handle after a successful open.

#### Scenario: Open picker uses cadara JSON options
- **WHEN** the user selects Open local file
- **THEN** the browser file picker is configured for `.cadara` files with JSON content
- **AND** the selected file is parsed directly as one authored model document JSON object before replacing the active document

#### Scenario: Open valid local document
- **WHEN** the user selects Open local file and chooses a valid authored model document through the browser file picker
- **THEN** the workbench replaces the active document with the normalized selected document
- **AND** the selected file handle becomes the direct-write sync target for subsequent accepted changes to the active document
- **AND** the user receives a visible status message confirming that local file sync is active

#### Scenario: Reject invalid local document
- **WHEN** the user selects Open local file and chooses a file that is not a valid authored model document JSON object
- **THEN** the active document is not replaced
- **AND** no local file sync binding is created for that file
- **AND** the user receives a visible failure message

#### Scenario: Reject ZIP cadara package
- **WHEN** the user selects Open local file and chooses a ZIP-backed `.cadara` package
- **THEN** the active document is not replaced
- **AND** no package extraction or backwards-compatible asset restore path is used
- **AND** the user receives a visible failure message

#### Scenario: Local open API unsupported
- **WHEN** the user selects Open local file in a browser that does not support the required File System Access API
- **THEN** the active document is not replaced
- **AND** the workbench reports that local file sync is unavailable in the current browser

### Requirement: Save local file SHALL bind the active document to a new filesystem location
The system SHALL allow a user to choose a local file once through the browser File System Access API, write the current authored model document JSON object to that file, and bind the active document to that file for subsequent automatic direct writes without additional save-as or download prompts.

#### Scenario: Save picker uses cadara JSON options
- **WHEN** the user selects Save local file
- **THEN** the browser save picker is configured for `.cadara` files with JSON content
- **AND** the default save filename uses the `.cadara` extension

#### Scenario: Save current document to a local file
- **WHEN** the user selects Save local file and chooses a destination through the browser save picker
- **THEN** the workbench writes the current normalized authored model document as one JSON object directly to that destination through the selected file handle
- **AND** the selected file handle becomes the direct-write sync target for subsequent accepted changes to the active document
- **AND** the user receives a visible status message confirming that local file sync is active

#### Scenario: Save local file is cancelled
- **WHEN** the user selects Save local file and cancels the browser save picker
- **THEN** the active document remains unchanged
- **AND** any existing local file sync binding remains unchanged

#### Scenario: Save local API unsupported
- **WHEN** the user selects Save local file in a browser that does not support the required File System Access API
- **THEN** no file is written
- **AND** the workbench reports that local file sync is unavailable in the current browser

### Requirement: Document sync worker SHALL own Automerge normalization and file writes
The system SHALL run Automerge-to-authored-document normalization and bound filesystem sync writes in a dedicated document sync Web Worker rather than on the main thread.

#### Scenario: Repository document changes
- **WHEN** the Automerge-backed active document changes through a local mutation, restore, seed, reset, or peer update
- **THEN** the document sync worker normalizes the Automerge document into the authored model document contract
- **AND** the main thread receives only the worker-normalized authored document, diagnostics, and repository metadata needed for modeling restore and freshness checks

#### Scenario: Bound file receives normalized changes
- **WHEN** the active document has a local filesystem sync binding and the worker normalizes an accepted document change
- **THEN** the worker writes the normalized authored model document as one JSON object directly to the bound file handle through a writable stream
- **AND** the written payload excludes ZIP package members, sidecar geometry blobs, derived render exports, feature tree rows, object tree rows, diagnostics, preview state, and transient editor state

#### Scenario: Autosync does not use download export
- **WHEN** the worker syncs an accepted document change to a bound local file
- **THEN** the sync write updates the previously granted file handle directly
- **AND** the sync write does not trigger a browser download, hidden anchor download, import file input, or repeated save-as picker

#### Scenario: Main thread normalization path is absent
- **WHEN** the modeling service restores a repository-backed or peer-updated authored document
- **THEN** it consumes the document sync worker's normalized result
- **AND** it does not run a separate main-thread Automerge-to-authored-document normalization path before OCC restore

## REMOVED Requirements

### Requirement: Local file sync SHALL write self-contained ZIP packages
**Reason**: Bound local `.cadara` writes must produce one authored JSON object, not a ZIP package containing `document.json` and geometry asset members.
**Migration**: None. Existing ZIP-backed `.cadara` files are intentionally unsupported.

### Requirement: Local open SHALL restore packaged geometry assets
**Reason**: Local open must parse one authored JSON object and must not restore geometry blobs from package members.
**Migration**: None. Existing ZIP-backed `.cadara` files with packaged geometry assets are intentionally unsupported.
