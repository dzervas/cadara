# authored-model-document Specification

## Purpose
TBD - created by archiving change introduce-local-automerge-document-repository. Update Purpose after archive.
## Requirements
### Requirement: Authored model document SHALL be the canonical persisted CAD state
The system SHALL define a versioned authored model document as the canonical persisted state for local documents, containing only user-authored and durable rebuild inputs, including the durable document name.

#### Scenario: Authored document is stored
- **WHEN** the repository persists a local document
- **THEN** the persisted authored model document includes document identity, durable document name, schema version, settings, variables, sketches, features, feature ordering, feature cursor state, and authored labels needed to rebuild the model

#### Scenario: Authored document is validated
- **WHEN** the repository loads an authored model document
- **THEN** it validates the document identity, durable document name, schema version, required authored collections, feature references, sketch references, variable records, and cursor shape before exposing it to the modeling service

### Requirement: Authored model document SHALL exclude derived runtime and presentation state
The authored model document MUST NOT persist derived render exports, feature tree rows, object tree rows, selection catalogs, preview state, diagnostics, OpenCascade runtime objects, transient editor state, repository-local durable undo metadata, or local draft-history bookkeeping.

#### Scenario: Snapshot is rebuilt from authored state
- **WHEN** the modeling service exposes a current document snapshot
- **THEN** it derives the kernel snapshot, presentation rows, diagnostics, and render export from the authored model document and rebuild runtime
- **AND** those derived values are not read as persisted Automerge document fields

#### Scenario: Preview is evaluated
- **WHEN** a feature preview is evaluated
- **THEN** preview geometry and preview diagnostics remain transient
- **AND** they are not written into the authored model document

#### Scenario: Local durable history is restored
- **WHEN** the local editing context restores repository-backed durable undo metadata or draft-history bookkeeping
- **THEN** that metadata is restored through repository-local persistence behavior
- **AND** it is not treated as authored model document content

### Requirement: Authored model document SHALL support schema migration
The system SHALL version authored model documents and provide explicit migrations from supported older authored schemas into the current schema.

#### Scenario: Supported older authored schema is loaded
- **WHEN** the repository loads an authored document with a supported older schema version
- **THEN** it migrates the document to the current authored schema before exposing it to modeling code

#### Scenario: Unsupported authored schema is loaded
- **WHEN** the repository loads an authored document with an unsupported schema version
- **THEN** it rejects the document with an explicit migration diagnostic
- **AND** it preserves the stored data until the user explicitly resets or a later migration supports it

### Requirement: Authored model documents SHALL preserve repairable feature errors
The system SHALL treat a document with a structurally valid authored envelope and history as a valid authored model document even when one or more feature definitions contain repairable rebuild-time errors.

#### Scenario: Load document with invalid feature reference
- **WHEN** an authored model document contains a feature whose durable reference no longer resolves during rebuild
- **THEN** authored document validation accepts the document structure
- **AND** the invalid feature record remains in authored history for editing
- **AND** the failure is represented as a generated diagnostic rather than by deleting or replacing authored records

#### Scenario: Reject malformed document envelope
- **WHEN** an authored model document has an unsupported schema version, invalid top-level discriminant, or missing required authored collection
- **THEN** authored document validation rejects the document explicitly
- **AND** the rejection is not converted into a repairable feature diagnostic

#### Scenario: Persist repairable broken feature
- **WHEN** a user edit leaves a feature in a repairable broken state
- **THEN** persistence stores the authored feature values that the user entered
- **AND** persistence does not store derived render exports or generated diagnostics in the authored model document

### Requirement: Authored documents SHALL carry a geometry asset manifest
The authored model document contract SHALL include a versioned geometry asset manifest for immutable imported or generated geometry assets.

#### Scenario: Parse document without assets
- **WHEN** an existing authored model document has no geometry asset manifest
- **THEN** migration normalizes it with an empty asset manifest
- **AND** existing sketches, features, history order, cursor, variables, and body labels are preserved

#### Scenario: Parse document with asset manifest
- **WHEN** an authored model document includes geometry asset records
- **THEN** runtime validation accepts only records with valid ids, hashes, byte lengths, formats, and provenance values
- **AND** validation rejects duplicate asset ids with conflicting content metadata

### Requirement: Authored feature records SHALL persist explicit suppression state
The authored model document SHALL store an explicit `suppressed` boolean on every authored feature record. This state SHALL be durable authored replay metadata and SHALL NOT be embedded inside feature definitions or derived render state.

#### Scenario: Persist active feature
- **WHEN** an authored feature is not suppressed
- **THEN** the authored model document stores that feature record with `suppressed: false`
- **AND** the feature definition remains unchanged by the suppression field

#### Scenario: Persist suppressed feature
- **WHEN** an authored feature is suppressed
- **THEN** the authored model document stores that feature record with `suppressed: true`
- **AND** the feature remains present in feature order and document history
- **AND** derived geometry generated before suppression is not persisted as authored model document state

#### Scenario: Validate missing suppression state
- **WHEN** an authored model document feature record omits `suppressed`
- **THEN** authored document validation rejects the document as structurally invalid for the current schema
- **AND** validation does not silently infer an active or suppressed state

### Requirement: Snapshot feature records SHALL expose suppression state
The rebuilt model snapshot SHALL expose explicit suppression state for each durable feature row so application and presentation layers can distinguish active, suppressed, and rolled-back history.

#### Scenario: Snapshot includes suppressed feature row
- **WHEN** a suppressed feature is present in authored history
- **THEN** the rebuilt document snapshot includes that feature record with `suppressed: true`
- **AND** the feature record has no produced targets for geometry bypassed by suppression in that revision

#### Scenario: Snapshot includes active feature row
- **WHEN** an unsuppressed feature is present in authored history
- **THEN** the rebuilt document snapshot includes that feature record with `suppressed: false`
- **AND** produced targets reflect the current rebuild result for that feature when it is applied by the cursor

