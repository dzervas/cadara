## ADDED Requirements

### Requirement: Mesh-imported solids SHALL undergo bounded surface domain unification
The kernel SHALL apply `ShapeUpgrade_UnifySameDomain` to mesh-imported solids after conversion from baked mesh data when the import is not a faceted fallback and the source triangle count is within the bounded unification limit, merging adjacent triangular faces that share the same analytical surface within tolerance.

#### Scenario: Planar faces are merged
- **WHEN** a mesh-imported solid contains adjacent triangular faces that lie on the same plane within linear and angular tolerance
- **THEN** the unification pass merges those triangles into a single planar face
- **AND** the resulting solid has fewer faces than the source triangle count

#### Scenario: Cylindrical faces are merged
- **WHEN** a mesh-imported solid is a simple full cylinder with planar caps and side vertices that share one radius within tolerance
- **THEN** the restore path rebuilds it as an analytical OCC cylinder
- **AND** the resulting topology includes one cylindrical side face and planar cap faces

#### Scenario: Organic mesh with no analytical surfaces
- **WHEN** a faceted fallback mesh-imported solid contains faces that do not share any common analytical surface
- **THEN** restore completes without running the expensive same-domain merge pass
- **AND** the face count remains unchanged

#### Scenario: Large mesh commit remains bounded
- **WHEN** a mesh-imported solid has more triangles than the same-domain unification limit
- **THEN** restore records face diagnostics without applying `ShapeUpgrade_UnifySameDomain`
- **AND** import commit is not blocked by triangle-scale face merging

#### Scenario: Faceted fallback commit defers worker rebuild
- **WHEN** a browser worker-backed import commits a faceted fallback mesh
- **THEN** commit validation stages the authored document and asset bytes without synchronously rebuilding the raw triangle BRep
- **AND** the normal snapshot refresh path remains responsible for rebuilding viewport geometry

### Requirement: Unification SHALL use mesh-appropriate tolerances
The unification pass SHALL use default tolerances suitable for mesh discretization error, not boolean floating-point error.

#### Scenario: Default mesh unification tolerances
- **WHEN** a mesh import uses default reconstruction settings
- **THEN** the unification pass uses linear tolerance of 0.01 and angular tolerance of 0.01 radians

#### Scenario: Custom unification tolerances
- **WHEN** a mesh import specifies custom unification tolerance overrides in reconstruction settings
- **THEN** the unification pass uses the overridden tolerance values

### Requirement: Unification diagnostics SHALL be recorded in provenance
The system SHALL record pre-unification and post-unification face counts and merged surface type summary in the reconstruction provenance.

#### Scenario: Provenance records unification results
- **WHEN** a mesh import completes with unification
- **THEN** the baked asset provenance includes the face count before unification, the face count after unification, and a summary of merged surface types (plane, cylinder, cone, sphere, torus)

### Requirement: Mesh-imported solids SHALL have selectable face references
The system SHALL assign face IDs to all mesh-imported solids. Recovered analytical mesh imports SHALL use topology seed naming, while faceted fallback imports SHALL use lightweight deterministic topology IDs without OCC selector-name seeding.

#### Scenario: Faceted fallback solid has selectable faces
- **WHEN** a faceted fallback mesh import is restored
- **THEN** the resulting solid has deterministic face IDs
- **AND** faces are selectable in the viewport
