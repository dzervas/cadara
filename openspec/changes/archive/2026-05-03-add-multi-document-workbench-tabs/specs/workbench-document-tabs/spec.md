## ADDED Requirements

### Requirement: Workbench SHALL persist the tab workspace across page reloads
The workbench SHALL persist the open tab list, tab order, and active tab in browser-local workspace state so the same multi-document workspace is restored after a page reload.

#### Scenario: Reload restores open tabs and active tab
- **WHEN** the user has multiple open document tabs and reloads the page
- **THEN** the workbench restores the same tab list and tab order from browser-local workspace state
- **AND** the previously active tab becomes active again
- **AND** the active document session loads the restored active tab's document

#### Scenario: No persisted tabs exist
- **WHEN** the workbench starts without persisted tab workspace state
- **THEN** it opens one default document tab
- **AND** that tab becomes the active document session

### Requirement: Tab titles SHALL mirror durable document names
The workbench SHALL treat the tab title as a presentation of the durable document name rather than as independent UI-only metadata.

#### Scenario: Loaded document seeds tab title
- **WHEN** a document session loads an authored document with a durable document name
- **THEN** the corresponding tab title matches that durable document name

#### Scenario: Renaming a tab renames the document
- **WHEN** the user renames a tab
- **THEN** the workbench applies the same new name to the underlying durable document
- **AND** reloading or reopening that document shows the renamed title again

### Requirement: Tabs SHALL expose document storage kind
Each workbench tab SHALL show the storage location of its document using the existing `storageKind` model.

#### Scenario: Browser-only document is shown
- **WHEN** an open document exists only in browser-backed repository storage
- **THEN** its tab indicates `storageKind: browser`

#### Scenario: Filesystem-bound document is shown
- **WHEN** an open document is bound to a local file handle
- **THEN** its tab indicates `storageKind: filesystem`

#### Scenario: Cloud-backed document is shown
- **WHEN** an open document is backed by a cloud persistence provider
- **THEN** its tab indicates `storageKind: cloud`

### Requirement: Activating a tab SHALL switch the active document session
The workbench SHALL treat tab activation as an active-document session change rather than as a visual selection-only change.

#### Scenario: User activates another tab
- **WHEN** the user activates a different document tab
- **THEN** the workbench switches the active document session to that tab's `documentId`
- **AND** the editor/runtime snapshot is rebuilt for that document through the normal kernel-backed load path

#### Scenario: Previously active tab remains open
- **WHEN** the user activates a different tab
- **THEN** the previously active tab remains open in the tab strip
- **AND** only the active document session changes
