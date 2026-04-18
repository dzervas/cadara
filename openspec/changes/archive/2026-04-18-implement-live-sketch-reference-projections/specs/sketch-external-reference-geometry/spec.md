## ADDED Requirements

### Requirement: Projection SHALL resolve supported external source geometry
The system SHALL resolve authored external sketch references into typed projected sketch geometry for supported model topology and existing sketch sources at the requested document revision.

#### Scenario: Model vertex is projected
- **WHEN** an active sketch references a model vertex that resolves in the current document revision
- **THEN** projection returns a `projected` reference record containing a projected point geometry in the active sketch plane
- **AND** the geometry is keyed by the authored reference ID and a stable projected geometry ID scoped to that reference

#### Scenario: Model edge is projected
- **WHEN** an active sketch references a supported linear, circular, or arc model edge that resolves in the current document revision
- **THEN** projection returns a line segment, circle, or arc projected geometry record that represents that edge in the active sketch plane
- **AND** the projected geometry is not copied into local sketch points or entities

#### Scenario: Existing sketch geometry is projected
- **WHEN** an active sketch references a point, supported entity, or supported geometry from another existing sketch
- **THEN** projection maps the source sketch geometry into the active sketch plane and returns typed projected geometry
- **AND** the source sketch remains the owner of its local points and entities

#### Scenario: Unsupported source is preserved with diagnostics
- **WHEN** an authored reference targets missing topology, unsupported geometry, non-representable face boundaries, or source geometry that cannot be projected into the active sketch plane
- **THEN** projection preserves the authored reference and returns a non-`projected` status with machine-readable diagnostics
- **AND** the editor does not silently delete, remap, or convert the reference into local sketch geometry

### Requirement: Projection SHALL refresh consistently across sketch lifecycle
The system SHALL refresh external sketch reference projections through the same source resolution semantics during active editing, sketch commit, document rebuild, reload, and sketch re-entry.

#### Scenario: Projection refreshes during active editing
- **WHEN** a user accepts an external reference while editing a sketch
- **THEN** the editor requests live projection for the current document revision
- **AND** stale projection responses for older request or revision identifiers are ignored

#### Scenario: Projection is stored with committed sketch snapshot
- **WHEN** a sketch containing authored external references is committed successfully
- **THEN** the persisted sketch snapshot stores the projected reference records produced for that commit revision
- **AND** subsequent sketch re-entry displays the persisted projected geometry until a refreshed projection for the active revision is available

#### Scenario: Projection invalidates after source changes
- **WHEN** source topology or source sketch geometry referenced by an authored external reference is unavailable at a later revision
- **THEN** the refreshed projection reports explicit invalidation diagnostics
- **AND** the authored reference remains in the sketch definition for repair or deletion by the user
