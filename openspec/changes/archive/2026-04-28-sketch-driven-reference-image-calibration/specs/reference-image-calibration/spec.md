## MODIFIED Requirements

### Requirement: Reference-image operations SHALL open a dedicated calibration mode
The sketch editor SHALL allow a committed `referenceImage` operation to enter a dedicated calibration mode without leaving sketch editing. That mode SHALL focus on placing, selecting, rebinding, and removing image-anchor bindings rather than on running a calibration-specific geometric constraint workflow.

#### Scenario: User opens calibration for a reference image
- **WHEN** the user double-clicks a committed `referenceImage` operation while editing a sketch
- **THEN** the sketch editor enters calibration mode for that operation
- **AND** the surrounding sketch session remains active

### Requirement: Calibration SHALL use a dedicated reference-image solver
Reference-image calibration SHALL use the normal sketch solver for bound anchor geometry and SHALL restrict reference-image-specific solving to recovering image placement from solved bound anchor points plus stored image-relative anchor coordinates. The main sketch solver SHALL remain the only owner of geometric constraints and dimensions applied to those bound anchor points.

#### Scenario: Image calibration updates from solved sketch anchors
- **WHEN** the user edits normal sketch constraints or dimensions that affect points bound to a committed `referenceImage` operation
- **THEN** the normal sketch solver updates those point positions
- **AND** the reference-image calibration flow recomputes only the image placement from the solved anchor positions rather than solving a separate image-owned geometric constraint graph

### Requirement: Calibration SHALL solve only operation-local image state
The reference-image calibration flow SHALL derive only operation-local image placement and diagnostics from the solved positions of bound sketch anchor points. It SHALL NOT own or persist calibration-only geometric constraints between anchors.

#### Scenario: Anchor dimension changes image placement through the sketch solver
- **WHEN** the user dimensions or constrains points bound to a committed `referenceImage` operation
- **THEN** the normal sketch solver resolves the anchor geometry
- **AND** the reference-image operation updates only its derived image placement and diagnostics from those solved point positions

### Requirement: Calibration mode SHALL support scale-mode control
The calibration panel SHALL provide a scale-mode toggle that allows the user to switch between locked-aspect scaling and independent X/Y scaling for the active `referenceImage` operation.

#### Scenario: User toggles scale mode
- **WHEN** the user changes the scale-mode toggle while calibrating a reference image
- **THEN** the active calibration mode updates the image-placement recovery rules for that image
- **AND** the toggle state is preserved with the operation's calibration state

### Requirement: Calibration mode SHALL support anchor management
The calibration mode SHALL allow the user to create and manage anchors on the active reference image for calibration purposes by binding each anchor to a durable local sketch point while preserving the anchor's normalized image coordinates.

#### Scenario: User adds an anchor in calibration mode
- **WHEN** the user places an anchor while calibrating a committed `referenceImage` operation
- **THEN** the operation stores that anchor's normalized image coordinates and bound local point identity
- **AND** the bound point remains available to ordinary sketch constraints and dimensions after calibration mode exits

### Requirement: Calibration mode SHALL preserve anchor UVs when replacing the image
Replacing the source image for a committed `referenceImage` operation in calibration mode SHALL preserve the existing anchors' normalized image coordinates and their bound local sketch point identities.

#### Scenario: User replaces the calibrated image
- **WHEN** the user replaces the image payload for a committed `referenceImage` operation that already has anchors
- **THEN** the operation preserves each anchor's normalized image coordinates
- **AND** the calibration workflow reuses those coordinates and bound sketch points against the replacement image
