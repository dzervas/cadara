# sketch-geometry-editing Specification

## Purpose
TBD - created by archiving change enable-basic-sketch-geometry-editing. Update Purpose after archive.
## Requirements
### Requirement: Sketch geometry SHALL be directly selectable for editing
The system SHALL allow users editing a sketch to select existing sketch points or supported sketch geometry handles in the viewport for direct edit operations.

#### Scenario: User selects a sketch point
- **WHEN** the user is editing a sketch and clicks a selectable sketch point without an active drawing or constraint placement conflict
- **THEN** the editor records that sketch point as the active edit target

### Requirement: Under-constrained sketch geometry SHALL support direct drag updates
The system SHALL allow direct drag movement for sketch geometry whose authored constraints do not prevent the requested movement.

#### Scenario: User drags an unconstrained point
- **WHEN** the user drags an unconstrained sketch point to a new sketch-plane position
- **THEN** the sketch draft updates that point position and prepares the corresponding authored sketch mutation

### Requirement: Constrained geometry SHALL move through solver-backed degrees of freedom
The system SHALL use the sketch solver to apply direct drags when constraints define shape relationships but still leave a valid degree of freedom for the requested movement.

#### Scenario: User drags a fully shaped square with free position
- **WHEN** a square is constrained enough to preserve its shape but has no constraints fixing its X and Y position
- **THEN** dragging one vertex moves the entire square through a valid solved translation rather than blocking the edit

### Requirement: Constraint-blocked edits SHALL provide feedback without corrupting the draft
The system SHALL reject, block, or no-op direct edits that cannot satisfy the authored constraints, and SHALL show feedback that the requested movement is constrained.

#### Scenario: User drags immovable constrained geometry
- **WHEN** the user drags sketch geometry whose constraints prevent the requested movement
- **THEN** the editor leaves the authored sketch draft unchanged and shows constrained-movement feedback

### Requirement: Existing sketch geometry SHALL support construction toggling
The system SHALL allow users editing a sketch to toggle supported selected sketch vertices/points and edges/entities between normal and construction geometry.

#### Scenario: User toggles a normal edge to construction
- **WHEN** the user activates Construction while editing a sketch and selects a normal supported sketch edge or entity
- **THEN** the editor prepares an authored sketch mutation that sets the selected entity `isConstruction` flag to true

#### Scenario: User toggles a construction edge to normal
- **WHEN** the user activates Construction while editing a sketch and selects a supported sketch edge or entity whose `isConstruction` flag is true
- **THEN** the editor prepares an authored sketch mutation that sets the selected entity `isConstruction` flag to false

#### Scenario: User toggles a normal vertex to construction
- **WHEN** the user activates Construction while editing a sketch and selects a normal supported sketch vertex or point
- **THEN** the editor prepares an authored sketch mutation that marks the selected point or point entity construction-only

#### Scenario: User toggles a construction vertex to normal
- **WHEN** the user activates Construction while editing a sketch and selects a supported sketch vertex or point whose authored construction flag is true
- **THEN** the editor prepares an authored sketch mutation that marks the selected point or point entity normal

### Requirement: Construction edge toggles SHALL not mutate unrelated shared points
The system MUST NOT automatically toggle endpoint point records when toggling an edge or curve entity to or from construction unless the selected target itself is that point.

#### Scenario: Edge shares endpoints with normal geometry
- **WHEN** the user toggles a sketch edge that shares one or more endpoint records with normal sketch geometry
- **THEN** only the selected edge entity construction flag changes
- **AND** the shared endpoint point records keep their previous construction flags

### Requirement: Construction toggle interactions SHALL preserve direct edit behavior
The system SHALL keep construction toggling separate from drag editing so Construction target picks do not start direct drag updates.

#### Scenario: Construction target pick does not start drag editing
- **WHEN** the user activates Construction and clicks a supported sketch edge or vertex
- **THEN** the editor toggles construction status for the selected target
- **AND** the editor does not enter a geometry drag state for that click

#### Scenario: Direct edit still works after construction toggle
- **WHEN** the user finishes toggling a sketch target with Construction and then selects the same target without Construction active
- **THEN** the existing direct selection and drag editing behavior remains available for that target

### Requirement: Active sketch editing SHALL include selectable projected reference geometry
The system SHALL allow projected external reference geometry to participate in active sketch hover and selection flows as read-only reference targets.

#### Scenario: User hovers projected reference geometry
- **WHEN** the user is editing a sketch and points at projected reference geometry
- **THEN** the viewport shows hover feedback for the projected reference target
- **AND** the editor does not offer direct drag editing for that target

#### Scenario: Local and projected targets overlap
- **WHEN** local sketch geometry and projected reference geometry overlap under the pointer
- **THEN** editing workflows that require local geometry prioritize the local editable target
- **AND** workflows that accept reference geometry can still resolve the projected reference target

### Requirement: Active sketch editing SHALL support trim mutations
The system SHALL include Trim as an active sketch edit operation that can mutate supported authored sketch entities while preserving sketch editing state.

#### Scenario: Trim mutation is accepted
- **WHEN** a valid trim operation is accepted
- **THEN** the authored sketch draft changes through sketch-session domain logic
- **AND** the active sketch session remains open for further editing

### Requirement: Active sketch editing SHALL support offset mutations
The system SHALL include Offset as an active sketch edit operation that can add supported offset geometry while preserving sketch editing state.

#### Scenario: Offset mutation is accepted
- **WHEN** a valid offset operation is accepted
- **THEN** the authored sketch draft adds the offset geometry through sketch-session domain logic
- **AND** the active sketch session remains open for further editing

### Requirement: Selected sketch geometry SHALL be deletable from an active sketch
The system SHALL allow users editing a sketch to delete selected editable local sketch geometry with Delete or Backspace while keeping the sketch session active.

#### Scenario: User deletes selected sketch entity with Delete
- **WHEN** the user is editing a sketch, a local editable sketch entity is selected, and the user presses Delete
- **THEN** the selected entity is removed from the active sketch definition
- **AND** the sketch session remains active for continued editing
- **AND** the deleted entity is no longer selected or shown as an active edit target

#### Scenario: User deletes selected sketch point with Backspace
- **WHEN** the user is editing a sketch, a local editable sketch point is selected, and the user presses Backspace
- **THEN** the selected point is removed from the active sketch definition
- **AND** the sketch session remains active for continued editing
- **AND** the deleted point is no longer selected or shown as an active edit target

#### Scenario: Delete ignores non-editable sketch selections
- **WHEN** the user is editing a sketch and the current selection is not editable local sketch geometry
- **THEN** invoking Delete does not remove local sketch geometry through the geometry deletion path

