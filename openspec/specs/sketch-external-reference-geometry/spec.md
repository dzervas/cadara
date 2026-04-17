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

