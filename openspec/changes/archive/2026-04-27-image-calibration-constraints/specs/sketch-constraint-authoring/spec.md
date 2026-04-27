## ADDED Requirements

### Requirement: The constraint definition union SHALL include pointOnImage
The `ConstraintDefinition` discriminated union SHALL include a `pointOnImage` variant with fields: `constraintId`, `kind: 'pointOnImage'`, `label`, `pointId` (the pinned sketch point), `imageEntityId` (the image reference entity), `u` (normalized horizontal coordinate, 0–1), and `v` (normalized vertical coordinate, 0–1).

#### Scenario: pointOnImage constraint is persisted
- **WHEN** a sketch definition contains a `pointOnImage` constraint with valid fields
- **THEN** the constraint is preserved through save, restore, undo, and redo
- **AND** runtime contract validation accepts the constraint

#### Scenario: pointOnImage constraint is solved
- **WHEN** the sketch solver encounters a `pointOnImage` constraint
- **THEN** the solver evaluates it by computing the expected position via bilinear interpolation of the referenced image entity's 4 corner positions
- **AND** the solver applies gradients to the pinned point and all 4 corner points
