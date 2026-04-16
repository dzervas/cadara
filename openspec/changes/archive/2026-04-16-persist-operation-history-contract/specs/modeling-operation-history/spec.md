## ADDED Requirements

### Requirement: Modeling operation history is a versioned durable contract
The system SHALL define a versioned modeling operation-history payload that is the authoritative persisted and exportable representation of committed document mutations.

#### Scenario: Persisted history is serialized for storage or export
- **WHEN** the application writes the current document history to `localStorage` or prepares it for export
- **THEN** it serializes one operation-history payload with an explicit schema version, document identity metadata, and an ordered list of typed operation entries

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
