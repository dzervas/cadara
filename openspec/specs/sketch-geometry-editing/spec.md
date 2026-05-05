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

### Requirement: Active sketch display SHALL derive accepted geometry from the current definition
The system SHALL render accepted editable sketch geometry from the active sketch definition instead of from a separately synchronized accepted-entity cache.

#### Scenario: Edited entity no longer has stale display geometry
- **WHEN** a user edits existing sketch geometry and the active sketch definition changes
- **THEN** the viewport displays the geometry derived from the updated sketch definition
- **AND** stale accepted geometry from before the edit is not displayed
- **AND** committed snapshot renderables (regions, edges, and points) for the active sketch are hidden from the document layer

#### Scenario: Deleted entity is removed from active sketch display
- **WHEN** a user deletes selected editable local sketch geometry while a sketch remains active
- **THEN** the deleted geometry is absent from the active sketch definition-derived display entities
- **AND** the deleted geometry is not rendered as a stale accepted sketch entity
- **AND** committed snapshot regions that depended on the deleted geometry are not visible as stale artifacts

### Requirement: Direct sketch drag updates SHALL be coalesced to animation frames
The system SHALL coalesce direct sketch geometry drag move events so constraint-backed draft updates run no more than once per animation frame while preserving the latest pointer position for the frame.

#### Scenario: Multiple pointer moves occur before a frame
- **WHEN** several pointer move events occur during one direct sketch geometry drag before the next animation frame
- **THEN** the editor processes one drag update for that frame
- **AND** the processed update uses the latest projected sketch-plane point from those pointer moves

#### Scenario: Drag ends with a pending frame
- **WHEN** a direct sketch geometry drag ends while a coalesced drag update is pending
- **THEN** the pending update is cancelled or ignored
- **AND** no stale drag update is applied after the drag lifecycle ends

### Requirement: Connected sketch geometry SHALL be selectable by double-click
The system SHALL allow users editing a sketch to double-click an editable local sketch entity and select every editable local sketch entity in the same connected component. Connectivity SHALL be derived from shared sketch point records in the active sketch definition.

#### Scenario: User double-clicks one of two connected lines
- **WHEN** the user is editing a sketch containing two editable local line entities that share an endpoint point record
- **AND** the user double-clicks either line entity in the viewport
- **THEN** the editor selects both line entities
- **AND** the active sketch session remains open

#### Scenario: User double-clicks one edge of a rectangle
- **WHEN** the user is editing a sketch containing a rectangle represented by four editable local line entities connected through shared corner point records
- **AND** the user double-clicks any one rectangle edge in the viewport
- **THEN** the editor selects all four rectangle edge entities
- **AND** the selection is based on graph connectivity rather than rectangle authoring operation metadata

#### Scenario: Branching connected geometry is selected as one component
- **WHEN** the user is editing a sketch containing editable local entities that form a branching connected component through shared point records
- **AND** the user double-clicks any entity in that component
- **THEN** the editor selects every editable local entity reachable through the shared point graph

#### Scenario: Projected reference geometry is not expanded
- **WHEN** the user is editing a sketch and double-clicks projected reference geometry
- **THEN** the editor does not add connected local sketch entities through the connected-geometry selection path
- **AND** projected reference geometry keeps its existing read-only selection behavior

### Requirement: Direct constrained drag SHALL use warm-started interactive solves
The editor SHALL use warm-started interactive solve sessions for constrained direct sketch drags when the active sketch has supported constraints or dimensions.

#### Scenario: Constrained drag begins
- **WHEN** the user begins dragging a constrained editable sketch point
- **THEN** the editor starts an interactive solve session using the current active sketch definition, projected references, tolerances, and most recent compatible solved state

#### Scenario: Constrained drag moves
- **WHEN** the user moves the pointer during an active constrained sketch drag
- **THEN** the editor submits the latest projected sketch-plane target to the active interactive solve session
- **AND** accepted solved point positions update the sketch draft without rebuilding unrelated solver components

#### Scenario: Constrained drag ends
- **WHEN** the user releases the pointer after an active constrained sketch drag
- **THEN** the editor finalizes the latest accepted interactive solve result or leaves the draft unchanged if the final target is blocked
- **AND** the interactive solve session is no longer updated after the drag lifecycle ends

### Requirement: Unaffected sketch components SHALL remain stable during direct drag
Direct sketch drag editing SHALL preserve solved values for independent unaffected sketch components while solving the component affected by the drag.

#### Scenario: User drags one of two independent constrained profiles
- **WHEN** the active sketch contains two independent constrained profiles and the user drags a point in one profile
- **THEN** the dragged profile updates through the solver-backed direct edit path
- **AND** points and entities in the independent profile keep their previous solved positions

#### Scenario: Drag is blocked by affected component only
- **WHEN** a direct drag target cannot be satisfied because of constraints in the affected component
- **THEN** the editor shows constrained-movement feedback
- **AND** independent unaffected components are not re-solved or moved

### Requirement: Live region extraction SHALL be deferred during active drag movement
Active sketch editing SHALL defer live region extraction during rapid direct drag movement and SHALL refresh regions after the sketch becomes static, at drag end, or before profile-dependent workflows consume regions.

#### Scenario: Drag updates arrive rapidly
- **WHEN** direct sketch drag updates continue arriving before the live-region debounce interval elapses
- **THEN** the editor updates solved sketch geometry for accepted drag frames
- **AND** it does not run region extraction for every accepted drag frame

#### Scenario: Drag becomes static
- **WHEN** the sketch has no new accepted drag update for the configured live-region debounce interval
- **THEN** the editor refreshes live derived regions from the latest solved sketch state

#### Scenario: Profile workflow needs current regions
- **WHEN** a profile-dependent workflow such as feature selection or sketch commit requires current derived regions while a debounced refresh is pending
- **THEN** the editor derives regions immediately from the latest solved sketch state before that workflow consumes them

### Requirement: Deferred region diagnostics SHALL remain available after refresh
The editor SHALL preserve live region diagnostics from deferred region extraction once the refresh runs.

#### Scenario: Open profile remains after drag settles
- **WHEN** a direct sketch drag leaves an open boundary and live region extraction runs after the debounce interval or drag end
- **THEN** the editor exposes the corresponding region diagnostic for viewport feedback

#### Scenario: Blocked drag leaves prior region state intact
- **WHEN** a direct sketch drag update is blocked and the sketch draft does not change
- **THEN** the editor does not replace current live regions with diagnostics from invalid unaccepted geometry

