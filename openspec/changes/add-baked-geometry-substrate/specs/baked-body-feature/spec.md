## ADDED Requirements

### Requirement: The modeling contract SHALL support baked-body features materialized from geometry assets
The system SHALL provide a `bakedBody` feature definition referencing a registered geometry asset by id and format; committing it SHALL materialize a durable kernel body from the asset.

#### Scenario: Baked mesh body commits
- **WHEN** a `bakedBody` feature referencing a valid `baked-mesh` asset is created
- **THEN** the kernel materializes a faceted body with durable topology identity
- **AND** the body renders, is selectable, participates in exports, and can serve as a boolean or reference target

#### Scenario: Asset is missing or invalid
- **WHEN** the referenced asset cannot be loaded or fails format validation
- **THEN** the feature rebuild reports a structured diagnostic naming the asset id and reason
- **AND** no placeholder geometry is fabricated

#### Scenario: Baked bodies are honest about editability
- **WHEN** a baked body feature is inspected or edited
- **THEN** its parameters expose the asset reference and provenance, not pseudo-parametric geometry controls
- **AND** downstream features referencing the body rebuild normally

### Requirement: Baked mesh body membership SHALL be explicit or conservatively singular

A newly baked mesh asset SHALL carry ordered, contiguous component triangle ranges from its authoritative source body/component grouping. OCC SHALL materialize only those declared components and SHALL NOT infer source identity from coincident vertices, shared edges, orientation, or spatial connectivity. A legacy v1 asset without component metadata SHALL be treated as exactly one declared component; it SHALL fail materialization unless that complete buffer is one connected, closed, orientable two-manifold shell.

#### Scenario: Coincident source bodies remain distinct
- **GIVEN** a baked mesh declares two component ranges whose geometry shares an edge or is coincident
- **WHEN** the baked body is rebuilt
- **THEN** OCC materializes two durable bodies in declared component order
- **AND** it does not merge them from geometric coincidence

#### Scenario: Declared membership cannot make a solid
- **WHEN** a declared component is open, non-manifold, inconsistently oriented, or contains disconnected shells without explicit per-solid groups
- **THEN** rebuild reports `baked-body-materializationFailed` with the structured feature diagnostic
- **AND** no partial or guessed body is fabricated

#### Scenario: Legacy unpartitioned mesh is ambiguous
- **WHEN** a legacy v1 baked mesh without components contains multiple disconnected closed shells
- **THEN** rebuild fails with `baked-body-materializationFailed`
- **AND** the system does not split the soup into inferred bodies

### Requirement: Kernel adapters SHALL resolve baked geometry assets through an injected seam
Kernel adapters SHALL materialize `bakedBody` features by resolving the feature definition's self-describing asset reference (asset id, format, content hash, byte length) through an injected geometry asset source rather than embedding bytes in create-feature requests, relying on session-scoped registries, or fabricating fallback geometry. The reference SHALL be sufficient to reconstruct the store record without any session state, so resolution is a pure store read that succeeds after reload.

#### Scenario: Reopened document rebuilds baked body from persisted asset
- **GIVEN** `bakeGeometry` persisted a valid `baked-mesh` asset through the platform `GeometryAssetStore`
- **AND** a document history contains a `bakedBody` feature referencing that asset id
- **WHEN** the document is reopened and rebuilt with a kernel adapter wired to the persisted asset resolver
- **THEN** the baked body is materialized from the persisted asset bytes
- **AND** the create-feature request/history entry remains by-reference and does not contain the blob

#### Scenario: Resolver unavailable or asset missing
- **WHEN** a `bakedBody` feature is rebuilt without a resolver or the resolver cannot find the referenced asset
- **THEN** the rebuild reports a structured baked-body diagnostic naming the asset id and reason
- **AND** no placeholder geometry is fabricated

### Requirement: Geometry baking SHALL be implemented through the asset store
`ImportCapabilities.bakeGeometry` SHALL validate input bytes for the declared format, deduplicate by content hash, persist through the existing `GeometryAssetStore`, and return a self-describing asset reference (asset id, format, content hash, byte length); failures SHALL surface as structured errors, never as silently absent assets. The import baking capability (writer) and the kernel asset resolver (reader) SHALL be composed from one shared `GeometryAssetStore` through a single composition seam.

#### Scenario: Duplicate bake
- **WHEN** the same bytes are baked twice
- **THEN** both calls return the same asset id and the store holds one copy

#### Scenario: Unsupported format on this platform
- **WHEN** a format the platform cannot materialize (e.g. `step` without a STEP reader) is baked
- **THEN** the call fails with a structured capability error naming the format
- **AND** the provider can degrade its plan accordingly
