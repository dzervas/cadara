# sketch-datum-reference-geometry Specification

## Purpose
TBD - created by archiving change add-origin-sketch-constraint-targets. Update Purpose after archive.
## Requirements
### Requirement: Active sketches SHALL expose implicit datum reference geometry
The system SHALL expose the active sketch origin point and the sketch-local X and Y axes as implicit read-only datum reference geometry while the user is editing a sketch.

#### Scenario: Opening a sketch exposes origin datum references
- **WHEN** the user opens any sketch for editing
- **THEN** the active sketch session exposes one selectable origin-point datum reference and two selectable axis datum references for the sketch-local X and Y axes
- **AND** each datum reference has a stable identity that does not depend on transient renderable IDs

#### Scenario: Reopening a non-XY sketch preserves sketch-local datum orientation
- **WHEN** the user reopens a sketch whose support plane is face-backed or otherwise not aligned to the world XY plane
- **THEN** the active sketch session still exposes origin, X-axis, and Y-axis datum references derived from that sketch plane
- **AND** those datum references preserve sketch-local orientation rather than reinterpreting the axes in world-space

### Requirement: Datum reference geometry SHALL remain read-only sketch context
The system SHALL treat origin datum references as selectable sketch context rather than authored local sketch geometry.

#### Scenario: User selects the sketch origin during constraint authoring
- **WHEN** a compatible constraint or dimension workflow is active and the user clicks the origin datum point
- **THEN** the editor records a datum-reference target for the active workflow
- **AND** it does not create or select a draggable local sketch point as a stand-in

#### Scenario: User attempts to edit datum axis geometry directly
- **WHEN** the user hovers, selects, or otherwise interacts with a datum axis outside a compatible reference-target workflow
- **THEN** the axis remains non-draggable and non-deletable
- **AND** it does not become profile-producing sketch geometry

### Requirement: Datum axes SHALL use finite pick guides with infinite axis semantics
The system SHALL render visible pick guides for the sketch-local X and Y axes while preserving the mathematical meaning of those axes as infinite lines through the sketch origin.

#### Scenario: User constrains against a visible datum axis guide
- **WHEN** the user selects a visible X-axis or Y-axis guide as a reference target for a supported constraint or dimension
- **THEN** the resulting committed record references the corresponding sketch datum axis
- **AND** downstream solving and dimension evaluation treat that target as the full sketch-local axis rather than as the clipped visible guide segment

