## ADDED Requirements

### Requirement: Measure tool SHALL run as a transient measurement-selection workflow
The system SHALL activate `Measure` as a part-mode temporary inspect workflow that accepts measurable geometry targets, keeps the results transient, and derives its output from the current active measurement selection instead of durable document edits.

#### Scenario: Activate Measure from the toolbar
- **WHEN** the user activates the `Measure` tool
- **THEN** the editor runtime enters a measurement-selection command session
- **AND** the viewport begins routing accepted geometry picks to the active measurement selection

#### Scenario: Select the first measurable target
- **WHEN** the `Measure` tool is active and the user selects one measurable geometry target
- **THEN** the command session stores that target as the current measurement selection
- **AND** the system computes the single-target measurement readouts and retained feedback geometry for that target

#### Scenario: Select a second measurable target
- **WHEN** the `Measure` tool is active and the current measurement selection contains one target
- **THEN** the system accepts a second measurable target when that combination supports pairwise measurement
- **AND** it computes pairwise measurement readouts and retained feedback geometry from the two-target selection

### Requirement: Measure readouts SHALL appear in a debugger-adjacent panel and hide inapplicable fields
While the `Measure` tool is active and the current measurement selection is non-empty, the system SHALL render a compact measurement panel in the bottom-left viewport area to the right of the state debugger. The panel SHALL show only populated values that apply to the current selection and SHALL omit labels for non-applicable measurements.

#### Scenario: Inspect one edge
- **WHEN** the user selects a single linear edge while `Measure` is active
- **THEN** the measurement panel shows edge-specific values such as edge length
- **AND** it does not render unrelated fields such as radius, diameter, or volume

#### Scenario: Inspect two vertices
- **WHEN** the user selects two vertices while `Measure` is active
- **THEN** the measurement panel shows the populated pairwise distance readout for the two-target selection
- **AND** it omits non-applicable labels instead of showing zero or placeholder values

#### Scenario: No active measurement selection
- **WHEN** the `Measure` tool is inactive or the current measurement selection is empty
- **THEN** the measurement panel is not shown

### Requirement: Measure tool SHALL resolve geometry-specific measurements for bodies, faces, curves, and pairwise selections
The measurement workflow SHALL resolve geometry-specific values for the active selection, including intrinsic properties for single targets and distance-style values for supported two-target selections.

#### Scenario: Inspect an arc or circle
- **WHEN** the user selects a circular edge, sketch circle, projected circle, arc edge, sketch arc, or projected arc while `Measure` is active
- **THEN** the measurement panel shows the populated circular properties that apply to that target
- **AND** circles expose radius, diameter, and circumference
- **AND** arcs expose radius, diameter, sweep angle, chord length, and arc length

#### Scenario: Inspect a spline
- **WHEN** the user selects a spline edge, sketch spline, or projected spline while `Measure` is active
- **THEN** the measurement panel shows the spline curve length
- **AND** it shows spline state such as open/closed classification and any exposed degree or control-point metadata when that source geometry provides it

#### Scenario: Inspect a face
- **WHEN** the user selects one face while `Measure` is active
- **THEN** the measurement panel shows the face surface area
- **AND** it shows the face perimeter and boundary edge lengths when those values can be resolved from the selected face

#### Scenario: Inspect a solid body
- **WHEN** the user selects one solid body while `Measure` is active
- **THEN** the measurement panel shows the body volume
- **AND** it shows the body surface area

#### Scenario: Inspect two measurable targets
- **WHEN** the user selects two supported measurable targets such as vertices, edges, or faces while `Measure` is active
- **THEN** the measurement panel shows the populated minimum-distance-style pairwise readouts for that selection
- **AND** it does not repeat unrelated single-target fields that no longer apply to the pairwise result set

### Requirement: Measure feedback SHALL retain emphasized bright-yellow witness geometry in the viewport
The system SHALL retain the current measurement feedback in the viewport as emphasized witness geometry using a bright yellow visual treatment that is thicker than normal wire geometry and includes a soft halo.

#### Scenario: Inspect one edge with retained feedback
- **WHEN** the user selects a single measurable edge while `Measure` is active
- **THEN** the viewport renders retained bright-yellow emphasized feedback on the measured edge or its derived measurement witness geometry
- **AND** that feedback remains visible while the current measurement selection stays active

#### Scenario: Inspect two targets with retained feedback
- **WHEN** the user selects two measurable targets while `Measure` is active
- **THEN** the viewport renders retained bright-yellow emphasized witness geometry for the active pairwise measurement
- **AND** the retained feedback corresponds to the resolved measured relationship rather than a generic selection tint

### Requirement: Measure workflow SHALL clear stale feedback when the measurement lifecycle resets
The system SHALL remove prior measurement witness geometry and stale readouts whenever the active measurement selection is replaced, cleared, or exited.

#### Scenario: Start a new measurement selection
- **WHEN** a prior one-target or two-target measurement is active and the user starts a new measurement selection
- **THEN** the viewport clears the previous measurement feedback before rendering the new measurement result
- **AND** the panel updates to only the new selection's applicable values

#### Scenario: Disable the Measure tool
- **WHEN** the user exits or disables the `Measure` tool while measurement feedback is visible
- **THEN** the viewport clears the retained measurement witness geometry
- **AND** the measurement panel is removed

#### Scenario: Clear selection while Measure is active
- **WHEN** the current measurement selection is cleared while the `Measure` tool remains active
- **THEN** the viewport clears the retained measurement witness geometry
- **AND** the measurement panel is removed until a new measurable target is selected
