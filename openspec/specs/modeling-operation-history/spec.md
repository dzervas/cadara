# modeling-operation-history Specification

## Purpose
TBD - created by archiving change persist-operation-history-contract. Update Purpose after archive.
## Requirements
### Requirement: Modeling operation history is a versioned durable contract
The system SHALL define a versioned modeling operation-history payload that remains a deterministic compatibility, migration, and diagnostic representation of committed document mutations, but it SHALL NOT be the primary local durability source when `DocumentRepository` persistence is enabled.

#### Scenario: Persisted history is serialized for storage or export
- **WHEN** the application writes a compatibility operation history or prepares one for export
- **THEN** it serializes one operation-history payload with an explicit schema version, document identity metadata, and an ordered list of typed operation entries

#### Scenario: DocumentRepository persistence is enabled
- **WHEN** the application starts with `DocumentRepository` local persistence enabled
- **THEN** it restores the current authored document through `DocumentRepository`
- **AND** it does not treat localStorage operation history as the authoritative local document source

### Requirement: Operation history records every committed sketch and feature mutation
The system SHALL record every successful committed modeling mutation as one typed operation entry in committed order, and SHALL exclude previews, rejected mutations, and transient UI events.

#### Scenario: User commits a sketch
- **WHEN** a sketch commit succeeds through the modeling service
- **THEN** the persisted history appends one `commitSketch` entry carrying the authoritative committed sketch payload needed for replay

#### Scenario: User mutates features
- **WHEN** a feature create, update, delete, or reorder operation succeeds through the modeling service
- **THEN** the persisted history appends exactly one matching typed operation entry that carries the authoritative feature mutation payload needed for replay

### Requirement: Refresh restore replays persisted history through the kernel
The system SHALL restore document state after refresh by validating the persisted operation-history payload and replaying its entries sequentially through the modeling kernel/service boundary before exposing the rebuilt snapshot to the editor runtime.

#### Scenario: Application starts with valid persisted history
- **WHEN** the application initializes and finds a valid operation-history payload in `localStorage`
- **THEN** it creates a fresh document basis, replays the stored entries in order through the kernel, and exposes the recalculated snapshot produced by replay

### Requirement: Replay preserves deterministic mutation order
The system SHALL treat operation entry order as semantically significant and SHALL replay entries without reordering, collapsing, or inferring omitted mutations.

#### Scenario: Feature reorder affects later rebuilds
- **WHEN** a persisted history contains a feature reorder followed by later feature mutations
- **THEN** refresh replay applies the reorder at its recorded position so the rebuilt document reflects the same feature order dependencies as the original authoring session

### Requirement: Invalid or unsupported history fails explicitly
The system MUST reject persisted histories that do not match the declared schema version or that contain invalid operation entries, and it MUST surface explicit diagnostics instead of silently producing an assumed partial restore.

#### Scenario: Stored history uses an unsupported schema version
- **WHEN** startup reads a persisted operation-history payload whose schema version is not supported by the current application build
- **THEN** restore fails explicitly with an invalid-history condition and the system does not silently replay or coerce the payload

#### Scenario: Stored history contains an unreplayable operation entry
- **WHEN** kernel replay rejects a persisted operation entry because its payload is invalid or unsupported
- **THEN** the system reports replay failure explicitly and does not present the resulting document state as a successful restore

#### Scenario: Stored history is malformed before replay
- **WHEN** startup reads persisted operation-history data that is valid JSON but structurally invalid for the operation-history contract
- **THEN** schema validation fails before replay begins and surfaces an actionable invalid-history message

#### Scenario: Stored history omits a required non-empty contract field
- **WHEN** startup reads persisted operation-history data whose operation payload violates a required non-empty or positive-value contract rule
- **THEN** schema validation rejects the payload explicitly rather than allowing replay to fail later through incidental runtime errors

### Requirement: Valid operation history MAY migrate into the authored document repository
The system SHALL be able to convert a valid supported operation-history payload into an authored model document through the modeling boundary when a local authored document does not already exist.

#### Scenario: Existing history migrates on first repository load
- **WHEN** startup finds no persisted authored document but finds a valid supported operation-history payload for the active document
- **THEN** the system replays the history through the modeling boundary
- **AND** stores the resulting authored document through `DocumentRepository`

#### Scenario: Existing history migration fails
- **WHEN** operation-history migration fails validation or replay
- **THEN** the system reports the migration failure explicitly
- **AND** it does not silently create a replacement authored document over the user's existing persisted data

### Requirement: Operation history SHALL record document history reorder mutations
The system SHALL record each accepted document history reorder mutation as one typed operation entry that can move either a committed sketch or committed feature within the shared authored history order.

#### Scenario: Persist accepted sketch reorder
- **WHEN** a committed sketch is reordered in document history and the modeling mutation is accepted
- **THEN** persisted operation history appends one document history reorder entry containing the moved sketch identity and accepted insertion anchor

#### Scenario: Persist accepted feature reorder
- **WHEN** a committed feature is reordered in document history and the modeling mutation is accepted
- **THEN** persisted operation history appends one document history reorder entry containing the moved feature identity and accepted insertion anchor

#### Scenario: Rejected reorder is not persisted
- **WHEN** a document history reorder mutation is rejected or conflicts
- **THEN** persisted operation history does not append a document history reorder entry for that mutation

### Requirement: Operation history replay SHALL preserve mixed document order mutations
Operation history replay SHALL apply persisted document history reorder entries in sequence so rebuilt authored documents preserve accepted sketch and feature order changes.

#### Scenario: Replay sketch and feature reorder sequence
- **WHEN** a persisted operation history contains committed sketches, committed features, and later document history reorder entries
- **THEN** refresh replay applies those reorder entries in their recorded order
- **AND** the rebuilt document history matches the accepted authored order from the original session

#### Scenario: Replay invalid reorder entry
- **WHEN** replay encounters a document history reorder entry that references a missing moved item or missing insertion anchor
- **THEN** restore fails explicitly with diagnostics
- **AND** the system does not silently drop, coerce, or partially apply the invalid reorder entry

#### Scenario: Replay legacy feature reorder entry
- **WHEN** operation history replay reads an existing feature-only reorder entry
- **THEN** it continues to replay that entry as a feature reorder
- **AND** valid existing histories do not require manual migration

