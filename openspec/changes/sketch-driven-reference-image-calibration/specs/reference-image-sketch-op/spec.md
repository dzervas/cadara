## MODIFIED Requirements

### Requirement: Sketches SHALL persist committed reference-image operations
The system SHALL allow an active sketch to contain one or more committed `referenceImage` operations. Each committed operation SHALL persist its own durable operation identity, image media type, optional file name, pixel width, pixel height, inline base64 image payload, placement state, and calibration anchor-binding metadata inside the sketch document. Persisted calibration anchor-binding metadata SHALL include a durable anchor identity, image-relative `u/v` coordinates, and the durable local sketch point id bound to that anchor, but SHALL NOT persist a separate calibration-only constraint list.

#### Scenario: Imported image becomes a committed reference-image operation
- **WHEN** the user imports a raster image while editing a sketch
- **THEN** the sketch definition persists one committed `referenceImage` operation containing the image metadata and inline base64 payload
- **AND** the committed image state is owned by that operation rather than by local sketch entities or constraints

#### Scenario: Reference-image operation survives save and reopen
- **WHEN** a document containing one or more committed `referenceImage` operations is saved and reopened
- **THEN** each operation preserves its durable identity, image payload, metadata, placement state, and any persisted anchor-binding metadata

## ADDED Requirements

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
