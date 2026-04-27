## ADDED Requirements

### Requirement: The pointOnImage constraint SHALL pin a sketch point to normalized image coordinates
The sketch constraint system SHALL support a `pointOnImage` constraint that binds a sketch point to a fixed fractional position `(u, v)` on an image reference entity's quad. The solver SHALL evaluate the constraint by computing the expected position via bilinear interpolation of the 4 corner points.

#### Scenario: Pin point at image center
- **WHEN** a sketch has an `imageReference` entity and a `pointOnImage` constraint with `u: 0.5, v: 0.5` on a sketch point
- **THEN** the solver positions the point at the bilinear center of the 4 corner positions
- **AND** moving a corner causes the pinned point to follow proportionally

#### Scenario: Pin point at image corner
- **WHEN** a `pointOnImage` constraint has `u: 0, v: 0` (top-left)
- **THEN** the solver positions the point coincident with the top-left corner point
- **AND** the constraint is satisfied with zero residual when the point is exactly at the TL corner

#### Scenario: Pin point between two corners
- **WHEN** a `pointOnImage` constraint has `u: 0.5, v: 0` (midpoint of top edge)
- **THEN** the solver positions the point at the midpoint between TL and TR corner positions

### Requirement: The pointOnImage constraint SHALL propagate gradients to corners and pinned point
The solver evaluation for `pointOnImage` SHALL compute gradients with respect to all 4 corner point coordinates and the pinned point coordinates, enabling the solver to adjust corner positions when calibration constraints conflict with the current image placement.

#### Scenario: Dimension on line between two pinned points adjusts image scale
- **WHEN** two sketch points are pinned to an image at `(0.1, 0.5)` and `(0.9, 0.5)` via `pointOnImage` constraints, a line segment connects them, and a dimension constraint sets the line to 100mm
- **THEN** the solver adjusts the image corner positions so that the distance between the two interpolated (u, v) positions equals 100mm
- **AND** the image scale changes to satisfy the dimension

#### Scenario: Vertical constraint on line between two pinned points adjusts image rotation
- **WHEN** two sketch points are pinned to an image at `(0.5, 0.1)` and `(0.5, 0.9)` via `pointOnImage` constraints, a line segment connects them, and a vertical constraint is applied to the line
- **THEN** the solver adjusts the image corner positions so that the line between the two interpolated positions is vertical
- **AND** the image rotation changes to satisfy the vertical constraint

### Requirement: The pointOnImage constraint SHALL reference the image entity by ID
The `pointOnImage` constraint definition SHALL store the `imageEntityId` (a `SketchEntityId` referencing the `imageReference` entity) and the normalized `u` and `v` coordinates. The solver SHALL resolve corner point IDs from the referenced entity at evaluation time.

#### Scenario: Valid pointOnImage constraint
- **WHEN** a sketch definition contains a `pointOnImage` constraint with a valid `pointId`, `imageEntityId` that resolves to an `imageReference` entity, and `u` and `v` in the range [0, 1]
- **THEN** runtime contract validation accepts the constraint

#### Scenario: Invalid image entity reference
- **WHEN** a `pointOnImage` constraint references an `imageEntityId` that does not exist in the sketch or is not an `imageReference` entity
- **THEN** runtime contract validation reports a structured diagnostic

#### Scenario: Out-of-range coordinates
- **WHEN** a `pointOnImage` constraint has `u` or `v` outside the range [0, 1]
- **THEN** runtime contract validation reports a structured diagnostic
