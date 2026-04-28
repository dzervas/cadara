# reference-image-calibration Specification

## Purpose
TBD - created by archiving change reference-image-calibration-mode. Update Purpose after archive.
## Requirements
### Requirement: Reference-image operations SHALL open a dedicated calibration mode
The sketch editor SHALL allow a committed `referenceImage` operation to enter a dedicated calibration mode without leaving sketch editing.

#### Scenario: User opens calibration for a reference image
- **WHEN** the user double-clicks a committed `referenceImage` operation while editing a sketch
- **THEN** the sketch editor enters calibration mode for that operation
- **AND** the surrounding sketch session remains active

### Requirement: Calibration SHALL use a dedicated reference-image solver
Reference-image calibration SHALL be solved by a dedicated reference-image calibration solver that is separate from the main sketch solver. The main sketch solver SHALL NOT solve image transform state, image anchors, or image calibration constraints directly.

#### Scenario: Image calibration updates without main sketch solver ownership
- **WHEN** the user edits calibration inputs for a committed `referenceImage` operation
- **THEN** the dedicated reference-image calibration solver computes the updated calibration result
- **AND** the main sketch solver does not receive image-owned solver state as local sketch geometry

### Requirement: Calibration SHALL solve only operation-local image state
The dedicated calibration solver SHALL solve only operation-local reference-image state, including image transform, anchor definitions, and calibration constraints.

#### Scenario: Distance constraint changes image scale
- **WHEN** the user applies a calibration distance constraint between anchors on a committed `referenceImage` operation
- **THEN** the dedicated calibration solver updates that operation's solved transform state
- **AND** the main sketch's local geometry is not mutated as part of that solve

### Requirement: Calibration mode SHALL support scale-mode control
The calibration panel SHALL provide a scale-mode toggle that allows the user to switch between locked-aspect scaling and independent X/Y scaling for the active `referenceImage` operation.

#### Scenario: User toggles scale mode
- **WHEN** the user changes the scale-mode toggle while calibrating a reference image
- **THEN** the active calibration mode updates the operation-local solving rules for that image
- **AND** the toggle state is preserved with the operation's calibration state

### Requirement: Calibration mode SHALL support anchor management
The calibration mode SHALL allow the user to create and manage anchors on the active reference image for calibration purposes.

#### Scenario: User adds an anchor in calibration mode
- **WHEN** the user places an anchor while calibrating a committed `referenceImage` operation
- **THEN** the operation stores that anchor in operation-local calibration state
- **AND** the anchor is available to calibration constraints and later fixed-reference export

### Requirement: Calibration mode SHALL preserve anchor UVs when replacing the image
Replacing the source image for a committed `referenceImage` operation in calibration mode SHALL preserve the existing anchors' normalized image coordinates.

#### Scenario: User replaces the calibrated image
- **WHEN** the user replaces the image payload for a committed `referenceImage` operation that already has anchors
- **THEN** the operation preserves each anchor's normalized image coordinates
- **AND** the calibration workflow reuses those anchors against the replacement image

