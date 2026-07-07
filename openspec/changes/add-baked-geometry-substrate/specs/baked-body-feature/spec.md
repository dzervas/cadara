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

### Requirement: Geometry baking SHALL be implemented through the asset store
`ImportCapabilities.bakeGeometry` SHALL validate input bytes for the declared format, deduplicate by content hash, persist through the existing `GeometryAssetStore`, and return the asset id; failures SHALL surface as structured errors, never as silently absent assets.

#### Scenario: Duplicate bake
- **WHEN** the same bytes are baked twice
- **THEN** both calls return the same asset id and the store holds one copy

#### Scenario: Unsupported format on this platform
- **WHEN** a format the platform cannot materialize (e.g. `step` without a STEP reader) is baked
- **THEN** the call fails with a structured capability error naming the format
- **AND** the provider can degrade its plan accordingly
