# image-reference-sketch-entity Specification

## Purpose
TBD - created by archiving change image-reference-import. Update Purpose after archive.
## Requirements
### Requirement: Image references SHALL be construction-only sketch entities with 4 corner points
The sketch entity contract SHALL support an `imageReference` entity kind that references an embedded binary asset and defines 4 corner sketch points forming a quad. The entity SHALL always be construction geometry and SHALL NOT contribute to region derivation.

#### Scenario: Valid image reference entity is persisted
- **WHEN** a sketch definition contains an `imageReference` entity with 4 valid corner point IDs, a non-empty embedded binary asset ID, and positive pixel width and height
- **THEN** runtime contract validation accepts the entity
- **AND** the entity is persisted with `isConstruction: true`

#### Scenario: Image reference entity missing corner points
- **WHEN** a sketch definition contains an `imageReference` entity with fewer than 4 corner point IDs or with point IDs that do not resolve in the sketch
- **THEN** runtime contract validation reports a structured diagnostic for that entity

#### Scenario: Image reference entity with missing asset
- **WHEN** a sketch definition contains an `imageReference` entity whose embedded binary asset ID does not resolve in the document's asset store
- **THEN** the sketch renders without the image texture
- **AND** the corner points remain as normal sketch points that participate in the constraint solver

#### Scenario: Image reference entity is excluded from regions
- **WHEN** the sketch solver derives closed profile regions from a sketch containing an `imageReference` entity
- **THEN** the image reference entity and its corner points do not contribute boundary edges to any derived region

### Requirement: Image reference corner points SHALL participate in the constraint solver
The 4 corner points of an `imageReference` entity SHALL be regular sketch points that participate in the constraint graph. Constraints applied to or between these points SHALL be solved like any other sketch point constraints.

#### Scenario: Corner points accept fixPoint constraints
- **WHEN** an `imageReference` entity's corner points have `fixPoint` constraints
- **THEN** the constraint solver pins those corners to their specified positions
- **AND** the image rendering follows the solved corner positions

#### Scenario: Corner points accept dimensional constraints via connected geometry
- **WHEN** a user draws a line segment between two image reference corner points or between a corner point and another sketch point, and constrains that line with a dimension
- **THEN** the constraint solver adjusts the involved points to satisfy the dimension
- **AND** the image rendering updates to reflect the new corner positions

#### Scenario: Corner points accept coincident constraints
- **WHEN** a corner point of an `imageReference` entity is constrained coincident with another sketch point
- **THEN** the constraint solver merges those points
- **AND** the image corner follows the solved position of the merged point

### Requirement: Image reference entities SHALL record pixel dimensions and asset reference
The `imageReference` entity definition SHALL include the original image pixel width, pixel height, and the embedded binary asset ID. These values are immutable after creation — resizing is done by moving corner points, not by editing pixel dimensions.

#### Scenario: Pixel dimensions are preserved across save/restore
- **WHEN** a sketch with an `imageReference` entity is saved and reopened
- **THEN** the entity records the same pixel width, pixel height, and asset ID as when it was created

### Requirement: Image reference entities SHALL render as textured quads on the sketch plane
The sketch viewport SHALL render `imageReference` entities by mapping the referenced image as a texture onto the quad defined by the 4 corner points, in the sketch plane's world-space frame.

#### Scenario: Image renders at initial corner positions
- **WHEN** a sketch contains an `imageReference` entity with 4 corner points at their initial positions
- **THEN** the viewport displays the image as a textured quad on the sketch plane
- **AND** the image is rendered behind all other sketch geometry

#### Scenario: Image renders after corner movement
- **WHEN** the constraint solver adjusts corner point positions in response to calibration constraints
- **THEN** the viewport updates the textured quad to match the new corner positions
- **AND** the image texture is mapped to the updated quad shape

#### Scenario: Image is not rendered when asset is unavailable
- **WHEN** the embedded binary asset referenced by an `imageReference` entity cannot be loaded
- **THEN** the viewport renders the 4 corner points and the quad outline without a texture fill
- **AND** the sketch remains editable with the corner points still participating in constraints

### Requirement: Image reference corner ordering SHALL define a consistent winding
The 4 corner point IDs in an `imageReference` entity SHALL follow a consistent winding order (top-left, top-right, bottom-right, bottom-left in image pixel space) so that UV texture mapping and quad triangulation produce correct results.

#### Scenario: Consistent UV mapping
- **WHEN** an `imageReference` entity is rendered
- **THEN** the first corner maps to the top-left of the image, the second to top-right, the third to bottom-right, and the fourth to bottom-left
- **AND** the image is not mirrored or rotated relative to the corner winding

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
