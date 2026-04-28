# reference-image-anchor-reference-points Specification

## Purpose
TBD - created by archiving change reference-image-calibration-mode. Update Purpose after archive.
## Requirements
### Requirement: Calibrated anchors SHALL export as fixed sketch reference points
Solved anchors from a committed `referenceImage` operation SHALL be exposed to the main sketch as read-only fixed reference points.

#### Scenario: Main sketch consumes a calibrated anchor
- **WHEN** a committed `referenceImage` operation has a solved anchor
- **THEN** the active sketch exposes that anchor as a fixed reference point for snapping and constraint targeting
- **AND** the point is not treated as draggable local sketch geometry

### Requirement: Only anchor points SHALL export from calibrated reference images
This change SHALL export only solved anchor points from a calibrated `referenceImage` operation. It SHALL NOT export guide lines, image boundaries, or other image-owned helper geometry into the main sketch.

#### Scenario: Calibrated image does not export guide geometry
- **WHEN** a committed `referenceImage` operation is calibrated
- **THEN** the main sketch receives only the solved anchor-point exports
- **AND** it does not receive exported image edges, image quads, or image-owned helper lines

### Requirement: Exported anchor points SHALL refresh from calibration results
Exported reference points derived from a committed `referenceImage` operation SHALL refresh whenever that operation's calibration result changes.

#### Scenario: Recalibration moves exported anchor points
- **WHEN** the user changes calibration state for a committed `referenceImage` operation
- **THEN** the exported fixed reference points update to the newly solved anchor positions

### Requirement: Anchor visibility in normal sketch editing SHALL be user-controlled
The calibration panel SHALL expose an anchor-visibility toggle for each committed `referenceImage` operation, and normal sketch editing SHALL default that visibility to off.

#### Scenario: Hidden anchors are the default
- **WHEN** a user imports and later calibrates a new `referenceImage` operation
- **THEN** the operation's exported anchor-point visibility is off by default during normal sketch editing

#### Scenario: User enables anchor visibility
- **WHEN** the user turns on anchor visibility for a committed `referenceImage` operation
- **THEN** the active sketch renders that image's exported anchor reference points during normal sketch editing

