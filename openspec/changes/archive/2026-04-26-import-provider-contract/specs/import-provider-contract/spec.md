## ADDED Requirements

### Requirement: Import sources SHALL be resolved by the orchestrator before reaching providers
The system SHALL resolve external source transport (local file reads, URL fetches, cloud API calls) into a `ResolvedImportSource` carrying the source bytes, computed fingerprint, and origin metadata before invoking any provider method.

#### Scenario: Local file source resolution
- **WHEN** the user selects a local file for import
- **THEN** the orchestrator reads the file bytes through the browser File System Access API
- **AND** computes a SHA-256 fingerprint of the bytes
- **AND** passes a `ResolvedImportSource` with `origin.kind: 'localFile'`, the file name, detected media type, bytes, and fingerprint to the matched provider

#### Scenario: URL source resolution
- **WHEN** the user provides a URL for import
- **THEN** the orchestrator fetches the URL content
- **AND** computes a SHA-256 fingerprint of the response bytes
- **AND** passes a `ResolvedImportSource` with `origin.kind: 'url'`, the URL, response media type, bytes, and fingerprint to the matched provider

#### Scenario: Cloud object source resolution
- **WHEN** the user selects a cloud object for import
- **THEN** the orchestrator fetches the object content through the appropriate cloud API
- **AND** computes a SHA-256 fingerprint of the bytes
- **AND** passes a `ResolvedImportSource` with `origin.kind: 'cloudObject'`, the service identifier, object ID, bytes, and fingerprint to the matched provider

### Requirement: Import providers SHALL declare file-type acceptance without heavy parsing
The system SHALL determine which provider handles a given source by calling `accepts()` with the resolved source metadata. Acceptance SHALL be based on file extension and/or media type, not on parsing the full byte content.

#### Scenario: Provider accepts by file extension
- **WHEN** a resolved source has a file name ending in an extension the provider supports
- **THEN** `accepts()` returns `true`
- **AND** the provider is offered to the user for that source

#### Scenario: Provider rejects unsupported source
- **WHEN** a resolved source has a file name and media type that no registered provider accepts
- **THEN** no provider is offered
- **AND** the user receives a diagnostic indicating no importer is available for that file type

#### Scenario: Multiple providers accept the same source
- **WHEN** more than one registered provider accepts a given source
- **THEN** the orchestrator presents all matching providers to the user for selection

### Requirement: Import providers SHALL produce a non-mutating review before commit
The system SHALL require providers to implement a `review()` method that analyzes the source bytes and returns a typed review result describing what will be imported, without mutating any document state.

#### Scenario: Review returns selectable items
- **WHEN** the provider's review analyzes source bytes that contain multiple importable items (e.g. solids, layers, sheets)
- **THEN** the review result includes a provider-specific typed payload describing the selectable items
- **AND** the review result includes the proposed action kinds (features, sketches, or variables) the provider will produce
- **AND** no document state is modified

#### Scenario: Review returns diagnostics for problematic sources
- **WHEN** the provider's review encounters warnings or errors in the source data
- **THEN** the review result includes structured diagnostics with severity and message
- **AND** the review completes without throwing, allowing the user to see diagnostics before deciding whether to proceed

### Requirement: Import providers SHALL produce prepared actions through the prepare method
The system SHALL require providers to implement a `prepare()` method that receives the review result, user selections, and the `ImportCapabilities` object, and returns `ImportPreparedActions` containing requests the existing adapter methods accept.

#### Scenario: Provider prepares feature creation requests
- **WHEN** a provider's prepare method produces geometry-backed import results
- **THEN** the returned `ImportPreparedActions` contains `CreateFeatureRequest` payloads with valid `FeatureDefinition` variants
- **AND** any geometry assets needed by those features have been registered through `ImportCapabilities.assets`

#### Scenario: Provider prepares sketch creation requests
- **WHEN** a provider's prepare method produces 2D sketch data (e.g. from DXF or SVG)
- **THEN** the returned `ImportPreparedActions` contains `CommitSketchRequest` payloads with valid sketch entity data

#### Scenario: Provider prepares variable creation requests
- **WHEN** a provider's prepare method produces named variables (e.g. from a spreadsheet)
- **THEN** the returned `ImportPreparedActions` contains `AddDocumentVariableRequest` payloads

#### Scenario: Provider attaches binding metadata
- **WHEN** a provider's prepare method completes for a source that supports refresh
- **THEN** the returned `ImportPreparedActions` includes an `ImportBinding` record matching the source origin kind and fingerprint

### Requirement: The orchestrator SHALL apply prepared actions through existing adapter methods
The system SHALL apply all prepared actions returned by a provider through the existing `ModelingKernelAdapter` mutation methods, not through a parallel mutation path.

#### Scenario: Feature actions are applied through adapter
- **WHEN** the orchestrator receives `ImportPreparedActions` containing feature creation requests
- **THEN** each request is applied through `ModelingKernelAdapter.createFeature()`
- **AND** the adapter validates the request, assigns revision IDs, and records the operation in history
- **AND** undo/redo covers the imported features

#### Scenario: Sketch actions are applied through adapter
- **WHEN** the orchestrator receives `ImportPreparedActions` containing sketch commit requests
- **THEN** each request is applied through `ModelingKernelAdapter.commitSketch()`
- **AND** the adapter validates the request and records the operation in history

#### Scenario: Variable actions are applied through adapter
- **WHEN** the orchestrator receives `ImportPreparedActions` containing variable addition requests
- **THEN** each request is applied through `ModelingKernelAdapter.addDocumentVariable()`

#### Scenario: Adapter rejection propagates as import failure
- **WHEN** the adapter rejects a prepared action (e.g. invalid feature definition, revision conflict)
- **THEN** the orchestrator reports the adapter diagnostics to the user
- **AND** no partial import is committed — either all actions succeed or the import fails atomically

### Requirement: Import providers SHALL receive platform capabilities through dependency injection
The system SHALL inject an `ImportCapabilities` object into provider `review()` and `prepare()` methods. The capabilities object provides access to modeling kernel operations, sketch operations, and asset management without providers importing kernel internals directly.

#### Scenario: Provider uses modeling capabilities for geometry baking
- **WHEN** a provider needs to convert external geometry bytes into native B-rep assets
- **THEN** the provider calls methods on `ImportCapabilities.modeling` (e.g. bake external geometry, reconstruct mesh to B-rep)
- **AND** the provider does not import or instantiate kernel modules directly

#### Scenario: Provider uses sketch capabilities for vector conversion
- **WHEN** a provider needs to convert 2D vector primitives into sketch entities
- **THEN** the provider calls methods on `ImportCapabilities.sketch` (e.g. vector-to-sketch-entities conversion)

#### Scenario: Provider uses asset capabilities for registration
- **WHEN** a provider needs to register a geometry asset or store an embedded binary
- **THEN** the provider calls methods on `ImportCapabilities.assets`
- **AND** receives back an asset ID for use in feature definitions

### Requirement: Import providers SHALL be stateless across review and prepare phases
The system SHALL NOT require providers to maintain state between `review()` and `prepare()` calls. The orchestrator holds the review result and passes it back into `prepare()` along with the source and user selections.

#### Scenario: Provider receives its own review result in prepare
- **WHEN** the user completes review and confirms selections
- **THEN** the orchestrator calls `prepare()` with the original `ResolvedImportSource`, the review result returned by that provider, and the user's selections
- **AND** the provider can re-derive any needed intermediate state from these inputs without relying on cached internal state

#### Scenario: Review is abandoned without prepare
- **WHEN** the user cancels after review but before commit
- **THEN** no cleanup is required on the provider
- **AND** no document state was modified

### Requirement: Import refresh SHALL re-run the provider pipeline with updated source bytes
The system SHALL support refreshing a previously imported entity by re-fetching the source from its binding, running the matched provider's `review()` and `prepare()` pipeline, and applying updates through existing adapter mutation methods.

#### Scenario: Refresh detects source change
- **WHEN** the user triggers refresh on an imported entity that has a binding
- **THEN** the orchestrator re-resolves the source from the binding
- **AND** compares the new fingerprint against the stored fingerprint
- **AND** if changed, runs the provider pipeline and applies updates through `adapter.updateFeature()` or equivalent adapter methods

#### Scenario: Refresh detects no change
- **WHEN** the user triggers refresh and the re-resolved source fingerprint matches the stored fingerprint
- **THEN** no mutations are applied
- **AND** the user is informed that the source is unchanged

#### Scenario: Refresh source is unavailable
- **WHEN** the user triggers refresh but the bound source cannot be resolved (file missing, URL unreachable, cloud object deleted)
- **THEN** the orchestrator reports a diagnostic to the user
- **AND** the existing imported entity remains unchanged
- **AND** the binding is not automatically removed

### Requirement: Import providers SHALL report structured diagnostics
The system SHALL require that provider review and prepare methods report warnings and errors as structured `ImportDiagnostic` records with at minimum a severity level and human-readable message.

#### Scenario: Provider reports warnings during review
- **WHEN** the provider encounters non-fatal issues during review (e.g. unsupported layers in a DXF, skipped metadata in a 3MF)
- **THEN** the review result includes diagnostics with `severity: 'warning'` and descriptive messages
- **AND** the user can still proceed to commit

#### Scenario: Provider reports errors during review
- **WHEN** the provider encounters fatal issues during review (e.g. corrupt file, completely unsupported format variant)
- **THEN** the review result includes diagnostics with `severity: 'error'`
- **AND** the orchestrator presents the errors to the user and does not allow proceeding to prepare
