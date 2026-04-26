## ADDED Requirements

### Requirement: Non-portable binding capabilities SHALL be stored outside the document
The system SHALL maintain a workspace-level `ImportBindingStore` that holds browser-local binding capabilities (such as `FileSystemFileHandle` references) outside the portable document JSON.

#### Scenario: Store local file handle after import
- **WHEN** an import from a local file completes successfully and the provider returns an `ImportBinding` with `kind: 'localFile'`
- **THEN** the orchestrator stores the `FileSystemFileHandle` in the `ImportBindingStore` keyed by the created entity's identifier
- **AND** the document's binding record contains only the display path hint and fingerprint, not the handle itself

#### Scenario: Retrieve stored file handle for refresh
- **WHEN** the user triggers refresh on an entity with a `localFile` binding
- **THEN** the orchestrator retrieves the `FileSystemFileHandle` from the `ImportBindingStore`
- **AND** uses it to read updated file bytes for the provider pipeline

#### Scenario: File handle is missing from store
- **WHEN** the user triggers refresh on an entity with a `localFile` binding but the `ImportBindingStore` has no handle for that entity
- **THEN** the orchestrator prompts the user to re-select the file through the browser file picker
- **AND** upon selection, stores the new handle in the `ImportBindingStore` for future refresh

#### Scenario: Clear binding handle on entity deletion
- **WHEN** an imported entity with a stored file handle is deleted from the document
- **THEN** the `ImportBindingStore` removes the associated handle entry

### Requirement: Binding store SHALL NOT persist into document JSON
The `ImportBindingStore` SHALL NOT serialize its contents into the authored model document or any portable document payload.

#### Scenario: Save document with local file bindings
- **WHEN** the user saves a document that contains entities with `localFile` bindings
- **THEN** the saved `.cadara` file contains the binding metadata (display path hint, fingerprint) on the entity records
- **AND** the saved file does not contain `FileSystemFileHandle` objects or any browser-local capability references

#### Scenario: Open document on different machine
- **WHEN** a document with `localFile` bindings is opened on a machine that did not perform the original import
- **THEN** the entity records show the binding metadata with the display path hint
- **AND** the `ImportBindingStore` has no handle for those entities
- **AND** refresh requires the user to re-select the local file through the browser file picker

### Requirement: URL and cloud object bindings SHALL be portable in document JSON
The system SHALL store URL and cloud object binding metadata directly on entity records in the document, since these bindings are portable across machines and do not require browser-local capabilities.

#### Scenario: Save document with URL binding
- **WHEN** the user saves a document containing an entity imported from a URL
- **THEN** the entity record includes the URL, fingerprint, and refresh policy
- **AND** opening the document on any machine allows refresh by re-fetching the URL

#### Scenario: Save document with cloud object binding
- **WHEN** the user saves a document containing an entity imported from a cloud object
- **THEN** the entity record includes the service identifier, object ID, and fingerprint
- **AND** opening the document on any machine with appropriate cloud credentials allows refresh
