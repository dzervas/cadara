# sketch-external-reference-geometry Specification

## Purpose
TBD - created by archiving change add-sketch-reference-geometry-authoring. Update Purpose after archive.
## Requirements
### Requirement: Sketches SHALL author durable external reference records
The system SHALL allow users editing a sketch to create durable authored reference records for supported external model topology and existing sketch geometry without converting the referenced geometry into local sketch-owned entities.

#### Scenario: User references model geometry from a sketch
- **WHEN** the user accepts a supported model vertex, edge, or planar face as reference geometry while editing a sketch
- **THEN** the sketch definition records a stable authored external reference for that source
- **AND** the accepted reference is routed through the modeling boundary

#### Scenario: User references existing sketch geometry
- **WHEN** the user accepts supported geometry from another existing sketch as reference geometry
- **THEN** the active sketch stores an authored reference to that external source rather than copying its points or entities into the active sketch

### Requirement: External sketch references SHALL project through the solver boundary
The system SHALL resolve authored external sketch references through the sketch solver projection boundary and treat the returned projected geometry and diagnostics as authoritative for the active revision.

#### Scenario: Reference projection succeeds
- **WHEN** an active sketch contains an authored external reference that can be projected into the sketch plane
- **THEN** the editor receives solver-owned projected geometry for that reference
- **AND** the projected geometry is keyed by stable projected geometry identifiers scoped to the authored reference

#### Scenario: Reference projection fails
- **WHEN** an authored external reference is missing, unsupported, out of plane, or ambiguous
- **THEN** the editor preserves the authored reference
- **AND** the editor surfaces the solver-owned projection status and diagnostics without silently deleting or remapping the reference

### Requirement: Projected reference geometry SHALL be read-only sketch context
The system SHALL render projected reference geometry while editing the owning sketch as selectable read-only sketch context distinct from normal and construction sketch geometry.

#### Scenario: Projected geometry is visible during sketch editing
- **WHEN** the user edits a sketch that contains successfully projected external references
- **THEN** the viewport shows the projected reference geometry with a distinct read-only reference style

#### Scenario: Projected geometry is selected
- **WHEN** the user selects projected reference geometry while editing the owning sketch
- **THEN** the editor records a reference-geometry selection target
- **AND** the editor does not treat the projected geometry as a draggable local sketch point or entity

### Requirement: Projected reference geometry SHALL not produce profile boundaries in this change
The system SHALL keep projected reference geometry out of profile and region boundary generation until projected-profile-boundary support is implemented explicitly.

#### Scenario: Sketch contains only projected boundary geometry
- **WHEN** a sketch contains projected reference geometry but no local closed profile-producing boundary
- **THEN** the sketch does not produce a selectable profile region from the projected geometry alone

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

