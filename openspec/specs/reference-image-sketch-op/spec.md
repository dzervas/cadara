# reference-image-sketch-op Specification

## Purpose
Defines sketch-owned raster reference images as committed operation-owned state instead of solver-owned sketch geometry.
## Requirements
### Requirement: Sketches SHALL persist committed reference-image operations
The system SHALL allow an active sketch to contain one or more committed `referenceImage` operations. Each committed operation SHALL persist its own durable operation identity, image media type, optional file name, pixel width, pixel height, inline base64 image payload, placement state, and calibration anchor-binding metadata inside the sketch document. Persisted calibration anchor-binding metadata SHALL include a durable anchor identity, image-relative `u/v` coordinates, and the durable local sketch point id bound to that anchor, but SHALL NOT persist a separate calibration-only constraint list.

#### Scenario: Imported image becomes a committed reference-image operation
- **WHEN** the user imports a raster image while editing a sketch
- **THEN** the sketch definition persists one committed `referenceImage` operation containing the image metadata and inline base64 payload
- **AND** the committed image state is owned by that operation rather than by local sketch entities or constraints

#### Scenario: Reference-image operation survives save and reopen
- **WHEN** a document containing one or more committed `referenceImage` operations is saved and reopened
- **THEN** each operation preserves its durable identity, image payload, metadata, placement state, and any persisted anchor-binding metadata

### Requirement: Reference-image placement SHALL be derived from solved bound anchor points
The system SHALL derive reference-image placement from the solved positions of the local sketch points bound to that image operation's anchors plus the persisted image-relative `u/v` coordinates stored on those anchors.

#### Scenario: Solved sketch points drive image placement
- **WHEN** a committed `referenceImage` operation has two or more bound anchors whose local sketch points solve to updated positions
- **THEN** the reference-image operation recomputes its display placement from those solved point positions and the stored anchor `u/v` values
- **AND** the image updates without requiring a separate calibration-only constraint solve

### Requirement: Ambiguous anchor fits SHALL preserve the last stable placement
The system SHALL surface diagnostics and keep the previously stable image placement whenever the solved bound anchor set is insufficient, contradictory, or otherwise invalid for the requested reference-image fit mode.

#### Scenario: Bound anchors do not produce a valid fit
- **WHEN** the solved positions of an image operation's bound anchors cannot produce a valid placement for the active fit mode
- **THEN** the operation reports diagnostics describing the invalid fit
- **AND** the image continues rendering with its last stable placement instead of collapsing or adopting an arbitrary new placement

### Requirement: Reference-image creation SHALL be a sketch-mode tool flow
The sketch editor SHALL expose an `Import Image` tool while editing a sketch. Accepting a supported raster file through that tool SHALL create a committed `referenceImage` operation in the active sketch instead of opening the generic part-mode import session.

#### Scenario: User imports an image while editing a sketch
- **WHEN** the user activates `Import Image` in an active sketch and accepts a supported raster file
- **THEN** the editor creates a committed `referenceImage` operation in that sketch
- **AND** the editor does not enter the generic `importing` workflow

### Requirement: Reference-image import SHALL not author local sketch geometry
Creating a committed `referenceImage` operation in this change SHALL NOT create local sketch points, local sketch entities, local sketch constraints, or local sketch dimensions as part of the image import flow.

#### Scenario: Imported image does not materialize as sketch geometry
- **WHEN** a new `referenceImage` operation is committed
- **THEN** the sketch's local point, entity, constraint, and dimension collections do not gain image-owned graph records from that import

### Requirement: New reference images SHALL receive default centered placement
When a new `referenceImage` operation is created, the system SHALL assign a default placement centered on the active sketch plane with a reasonable initial extent derived from the image dimensions.

#### Scenario: Newly imported image is centered
- **WHEN** the user imports a raster image into an active sketch
- **THEN** the committed `referenceImage` operation is placed centered on the active sketch plane
- **AND** its initial extent preserves the source image aspect ratio

### Requirement: Committed reference-image operations SHALL render as selectable underlays
The sketch viewport SHALL render committed `referenceImage` operations as image underlays behind local sketch geometry and SHALL expose selection and picking by committed operation identity.

#### Scenario: Reference image is visible and selectable
- **WHEN** an active sketch contains a committed `referenceImage` operation
- **THEN** the viewport renders the image behind local sketch geometry
- **AND** selecting the rendered image resolves the owning `referenceImage` operation identity rather than a synthetic local sketch point or entity target

### Requirement: Reference-image operations SHALL support independent history and deletion
Each committed `referenceImage` operation SHALL participate in sketch history as its own operation row. Deleting one reference image from sketch-local history SHALL remove that image operation row and its operation-owned follow-up state without affecting other committed reference images in the sketch.

#### Scenario: Delete one of multiple reference images
- **WHEN** a sketch contains multiple committed `referenceImage` operations and the user deletes one of their sketch-history rows
- **THEN** the targeted reference-image operation row is removed from the sketch definition's authoring operation list
- **AND** the editor does not append a new deletion history step for that action
- **AND** only the targeted image disappears from the sketch
- **AND** the remaining committed reference-image operations are preserved

