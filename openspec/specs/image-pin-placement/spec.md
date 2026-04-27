# image-pin-placement Specification

## Purpose
TBD - created by archiving change image-calibration-constraints. Update Purpose after archive.

## Requirements
### Requirement: Clicking on an image in the sketch editor SHALL create a pinned point
When the sketch editor is active and contains an image reference entity, clicking on the image quad SHALL create a new sketch point at the clicked position and a `pointOnImage` constraint binding it to the corresponding normalized (u, v) coordinates.

#### Scenario: Click on image creates pin point and constraint
- **WHEN** the user clicks on the image quad during sketch editing
- **THEN** a new sketch point is created at the clicked position in sketch-plane coordinates
- **AND** a new `pointOnImage` constraint is created linking the point to the image entity at the computed (u, v) position
- **AND** the point is marked as construction geometry

#### Scenario: Click outside image does not create pin point
- **WHEN** the user clicks outside the image quad during sketch editing
- **THEN** no pin point or `pointOnImage` constraint is created
- **AND** the click is handled by the normal sketch interaction (point placement, entity selection, etc.)

### Requirement: Normalized (u, v) SHALL be computed from click position relative to current corners
The (u, v) coordinates for a pin point SHALL be computed by projecting the click position into the image quad's current corner positions. For rectangular quads, this is a simple normalization against the quad bounds.

#### Scenario: Click at image center produces (0.5, 0.5)
- **WHEN** the user clicks at the center of the image quad
- **THEN** the computed (u, v) is approximately (0.5, 0.5)

#### Scenario: Click at top-left corner produces (0, 0)
- **WHEN** the user clicks at the top-left corner of the image quad
- **THEN** the computed (u, v) is approximately (0, 0)

### Requirement: Image-pinned points SHALL be usable as normal sketch points
Points created by clicking on the image SHALL behave as regular sketch points after creation. They can be endpoints for line segments, coincident targets, dimension anchors, or targets for any existing constraint kind.

#### Scenario: Draw line between two pin points
- **WHEN** the user creates two pin points on an image and draws a line segment between them
- **THEN** the line segment has the two pin points as its start and end points
- **AND** the line can be constrained with dimension, horizontal, vertical, or any other applicable constraint

#### Scenario: Pin point participates in coincident constraint
- **WHEN** a pin point is constrained coincident with another sketch point
- **THEN** the solver merges the positions of both points
- **AND** the `pointOnImage` constraint keeps the merged position anchored to the image (u, v) location
