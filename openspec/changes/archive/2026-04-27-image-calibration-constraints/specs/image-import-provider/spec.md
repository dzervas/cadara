## MODIFIED Requirements

### Requirement: Image import prepare SHALL store the image and produce a sketch
The provider's `prepare()` SHALL store the image bytes as an embedded binary asset via `ImportCapabilities.assets.storeEmbeddedBinary()` and return `ImportPreparedActions` containing a single `CommitSketchRequest` with the image reference sketch. The initial sketch SHALL include structural constraints that anchor position and orientation while leaving scale as a free DOF for calibration.

#### Scenario: Sketch contains image reference entity with structural constraints
- **WHEN** the provider constructs the initial sketch definition
- **THEN** the sketch definition contains 4 `SketchPointDefinition` entries for the image corners
- **AND** contains 1 `imageReference` entity referencing those 4 corner points and the embedded binary asset ID
- **AND** contains 4 construction line segment entities connecting adjacent corners (TL→TR, TR→BR, BR→BL, BL→TL)
- **AND** contains 1 `fixPoint` constraint on the top-left corner (anchoring position)
- **AND** contains 1 `horizontal` constraint on the TL→TR edge (anchoring initial rotation)
- **AND** contains structural constraints to keep the quad rectangular: `parallel` between opposite edges, `perpendicular` between adjacent edges, `equalLength` between opposite edge pairs
- **AND** contains no other fixPoint constraints besides the TL anchor

#### Scenario: Initial corner placement preserves aspect ratio
- **WHEN** the provider computes initial corner positions from the image's pixel dimensions
- **THEN** the aspect ratio of the corner quad matches the image's pixel aspect ratio
- **AND** the longest side of the quad is scaled to a reasonable default extent in sketch-plane units

#### Scenario: Scale is a free DOF
- **WHEN** the initial sketch is committed and opened for editing
- **THEN** the solver reports the system as underconstrained by exactly 1 DOF (scale)
- **AND** adding one dimension constraint between two pinned image points fully constrains the system
