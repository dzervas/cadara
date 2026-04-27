## ADDED Requirements

### Requirement: Image reference sketches SHALL include structural edge entities between corners
The image reference sketch SHALL contain 4 construction line segment entities connecting adjacent corner points in winding order (TL→TR, TR→BR, BR→BL, BL→TL). These edges serve as constraint operands for the rectangular quad constraints and as visual indicators of the image boundary.

#### Scenario: Edge entities are construction geometry
- **WHEN** the image reference sketch is committed or opened for editing
- **THEN** the 4 edge line segments are marked `isConstruction: true`
- **AND** they do not contribute to region derivation

#### Scenario: Edge entities are visible during editing
- **WHEN** the user edits the image reference sketch
- **THEN** the 4 edge line segments render as construction geometry (dashed or lighter style)
- **AND** they outline the image boundary

#### Scenario: Edge entities serve as constraint operands
- **WHEN** the rectangular quad constraints (parallel, perpendicular, equalLength) reference the edge entities
- **THEN** the solver evaluates those constraints using the edge line segment entity IDs
