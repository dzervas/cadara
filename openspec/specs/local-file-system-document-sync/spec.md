# local-file-system-document-sync Specification

## Purpose
TBD - created by archiving change add-local-file-system-sync. Update Purpose after archive.
## Requirements
### Requirement: Local file open SHALL bind the active document to a filesystem file
The system SHALL allow a user to choose Open... > Open and keep linked, open a local `.cadara` or JSON authored model document through the browser's direct file access, create a new active document tab for that document, and bind that tab's document to the selected file for subsequent automatic direct writes through the selected file handle.

#### Scenario: Linked open picker uses cadara JSON options
- **WHEN** the user chooses Open... > Open and keep linked
- **THEN** the browser file picker is configured for `.cadara` files with JSON content
- **AND** the selected file is parsed directly as one authored model document JSON object before a new document tab is activated

#### Scenario: Open valid linked document
- **WHEN** the user chooses Open... > Open and keep linked and selects a valid authored model document through the browser file picker
- **THEN** the workbench creates a new document tab for the selected document
- **AND** the new tab becomes the active document session
- **AND** the imported document in that tab is bound to the selected file handle for subsequent accepted changes
- **AND** the previously active tab remains open and unchanged
- **AND** the user receives a visible status message confirming that future changes will save to that file

#### Scenario: Reject invalid linked document
- **WHEN** the user chooses Open... > Open and keep linked and selects a file that is not a valid authored model document JSON object
- **THEN** the current active document is not replaced
- **AND** no new tab is created
- **AND** no local file sync binding is created for that file
- **AND** the user receives a visible failure message

#### Scenario: Reject ZIP cadara package
- **WHEN** the user chooses Open... > Open and keep linked and selects a ZIP-backed `.cadara` package
- **THEN** the current active document is not replaced
- **AND** no new tab is created
- **AND** no package extraction or backwards-compatible asset restore path is used
- **AND** the user receives a visible failure message

#### Scenario: Linked open API unsupported
- **WHEN** the user chooses Open... > Open and keep linked in a browser that does not support the required direct file access
- **THEN** the current active document is not replaced
- **AND** no new tab is created
- **AND** the workbench reports that linked file saving is unavailable in the current browser
- **AND** the Open a copy flow remains available as the supported fallback

### Requirement: Local file bindings SHALL remain document-scoped across tabs
The workbench SHALL keep local file bindings keyed to document identity so switching tabs does not transfer or erase filesystem sync state for another document.

#### Scenario: Switch from filesystem tab to browser-only tab
- **WHEN** the user activates a browser-only tab after working in a filesystem-bound tab
- **THEN** the newly active tab reports browser-backed storage state
- **AND** the prior filesystem binding remains associated with its original document

#### Scenario: Switch back to filesystem-bound tab
- **WHEN** the user re-activates a tab whose document has an existing local file binding
- **THEN** that tab reports filesystem-backed storage state again
- **AND** accepted changes from that active session continue syncing to the bound file handle

### Requirement: Save local file SHALL bind the active document to a new filesystem location
The system SHALL allow a user to choose Save As > Save and keep linked, choose a local file once through the browser's direct file access, write the current authored model document JSON object to that file, and bind the active document to that file for subsequent automatic direct writes without additional download prompts.

#### Scenario: Linked save picker uses cadara JSON options
- **WHEN** the user chooses Save As > Save and keep linked
- **THEN** the browser save picker is configured for `.cadara` files with `application/json` content
- **AND** the default save filename uses the `.cadara` extension

#### Scenario: Save current document to a linked file
- **WHEN** the user chooses Save As > Save and keep linked and chooses a destination through the browser save picker
- **THEN** the workbench writes the current normalized authored model document as one JSON object directly to that destination through the selected file handle
- **AND** the selected file handle becomes the direct-write sync target for subsequent accepted changes to the active document
- **AND** the user receives a visible status message confirming that future changes will save to that file

#### Scenario: Linked save is cancelled
- **WHEN** the user chooses Save As > Save and keep linked and cancels the browser save picker
- **THEN** the active document remains unchanged
- **AND** any existing local file sync binding remains unchanged

#### Scenario: Linked save API unsupported
- **WHEN** the user chooses Save As > Save and keep linked in a browser that does not support the required direct file access
- **THEN** no file is written
- **AND** the workbench reports that linked file saving is unavailable in the current browser
- **AND** the Download a copy flow remains available as the supported fallback

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

### Requirement: Local file binding SHALL survive refresh when supported
The system SHALL remember the active document's previously selected local file handle across page refresh or browser restart when the browser supports persistent storage of `FileSystemFileHandle` values.

#### Scenario: Restore previous local file binding
- **WHEN** the app starts and a supported persistent local file binding exists for the active document
- **THEN** the document sync worker restores that file handle as the sync target
- **AND** autosync continues to that file after write permission is available
- **AND** the user receives a visible status message indicating that the previous local file sync target was restored

#### Scenario: Restored binding needs write permission
- **WHEN** the app restores a previous local file binding but write permission is not currently granted
- **THEN** the system requests write permission again for the restored file handle
- **AND** if the browser requires a user gesture before showing the permission prompt, the user receives a visible action to continue local file sync
- **AND** no filesystem write is attempted until write permission is granted

#### Scenario: Persistent binding storage unsupported
- **WHEN** the user opens or saves a local file in a browser that supports live file handles but cannot persist them across sessions
- **THEN** local file sync remains active for the current session
- **AND** the user receives a visible status message if the binding cannot be remembered after refresh

#### Scenario: Authored document remains portable
- **WHEN** the system persists a local file sync binding
- **THEN** the file handle and binding metadata are stored outside the authored model document JSON and Automerge-authored payload
- **AND** exported or synced `.cadara` JSON does not include browser-local file handle data

### Requirement: Local file sync SHALL preserve document safety on failures
The system MUST report local file sync failures explicitly and MUST NOT silently reset, replace, or overwrite the active document as a recovery action.

#### Scenario: Autosync write fails
- **WHEN** the document sync worker cannot write a normalized document to the bound file handle
- **THEN** the active Automerge-backed document remains unchanged
- **AND** the file sync binding is marked failed or paused
- **AND** the user receives a visible sync failure message

#### Scenario: Write permission is unavailable
- **WHEN** the document sync worker lacks permission to write to the bound file handle
- **THEN** the system requests write permission again for the bound file handle
- **AND** no filesystem write is attempted until write permission is granted
- **AND** if the browser requires a user gesture before showing the permission prompt, the user receives a visible action to continue local file sync
- **AND** autosync resumes after write permission is granted

#### Scenario: Rapid changes occur during a write
- **WHEN** additional accepted document changes arrive while a local file write is already in flight
- **THEN** the document sync worker serializes filesystem writes for the bound document
- **AND** the final completed write reflects the latest normalized authored document state rather than an older intermediate state

### Requirement: Import and Export SHALL remain one-shot file operations
The system SHALL keep Open... > Open a copy and Save As > Download a copy as explicit one-shot file operations that do not create or replace the active local filesystem sync binding.

#### Scenario: Open document copy
- **WHEN** the user opens a valid `.cadara` or JSON document through Open... > Open a copy
- **THEN** the workbench creates and activates a new browser-backed document tab for the opened document
- **AND** no local filesystem sync binding is created by the Open a copy action

#### Scenario: Download current document copy
- **WHEN** the user saves the current document through Save As > Download a copy
- **THEN** the workbench downloads or saves the export payload according to the export contract
- **AND** the active local filesystem sync binding remains unchanged

